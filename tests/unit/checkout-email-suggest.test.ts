/**
 * Autocomplete de e-mail do checkout (src/runtime/checkout/form.ts,
 * `emailSuggestions`): conforme a pessoa digita, sugere "<o que escreveu>@" +
 * os domínios mais comuns. Só a regra pura (a interação na página está em
 * checkout-preview-browser).
 */
import { describe, expect, it } from "vitest";
import { EMAIL_DOMAINS, emailSuggestions } from "@/runtime/checkout/form";

describe("sugestões de e-mail", () => {
  it("sugere os domínios que começam com o que foi digitado, com o nome na frente", () => {
    expect(emailSuggestions("maria@g")).toEqual(["maria@gmail.com", "maria@globo.com"]);
    expect(emailSuggestions("maria@gma")).toEqual(["maria@gmail.com"]);
    expect(emailSuggestions("joao@h")).toEqual(["joao@hotmail.com", "joao@hotmail.com.br"]);
  });

  it("com o @ sem domínio, mostra os principais (no máximo 6)", () => {
    const all = emailSuggestions("ana@");
    expect(all.length).toBe(6);
    expect(all[0]).toBe("ana@gmail.com");
    expect(all.every((s) => s.indexOf("ana@") === 0)).toBe(true);
  });

  it("nada a sugerir: sem @, parte local vazia, mais de um @ ou domínio já completo", () => {
    expect(emailSuggestions("maria")).toEqual([]);
    expect(emailSuggestions("@gmail.com")).toEqual([]);
    expect(emailSuggestions("maria@gmail.com@")).toEqual([]);
    // "gmail.com" já é um domínio da lista: não sugere ele de novo.
    expect(emailSuggestions("maria@gmail.com")).toEqual([]);
    // Domínio que não casa com nenhum conhecido.
    expect(emailSuggestions("maria@empresa")).toEqual([]);
  });

  it("todos os domínios da lista são válidos e sem repetição", () => {
    expect(new Set(EMAIL_DOMAINS).size).toBe(EMAIL_DOMAINS.length);
    expect(EMAIL_DOMAINS.every((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))).toBe(true);
  });
});
