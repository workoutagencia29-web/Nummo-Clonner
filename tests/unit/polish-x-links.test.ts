/**
 * Fase 6 (polimento) — endereços dos links da oferta: "pay.kiwify" (sem o
 * .com.br) é recusado com uma mensagem que diz o que faltou; checkout sem o
 * código do produto ganha um aviso que não bloqueia.
 */
import { describe, expect, it } from "vitest";
import { linkUrlHint, linkUrlProblem, normalizeLinkUrl } from "@/lib/link-url";

const ok = (v: string) => expect(linkUrlProblem(normalizeLinkUrl(v))).toBeNull();
const bad = (v: string) => {
  const problem = linkUrlProblem(normalizeLinkUrl(v));
  expect(problem).toBeTruthy();
  return problem as string;
};

describe("linkUrlProblem", () => {
  it("aceita endereços completos, vazio, mailto: e tel:", () => {
    ok("");
    ok("https://pay.hotmart.com/X123456");
    ok("pay.kiwify.com.br/abc");
    ok("https://wa.me/5511999999999");
    ok("https://checkout.ticto.app/ABC");
    ok("https://loja.minhamarca.store/produto");
    ok("https://xn--caf-dma.com.br/");
    ok("mailto:contato@empresa.com.br");
    ok("tel:+5511999999999");
  });

  it("recusa domínio incompleto de plataforma conhecida, dizendo o que faltou", () => {
    expect(bad("pay.kiwify")).toBe(
      "O endereço parece incompleto: faltou o final depois de “kiwify” (ex.: https://pay.kiwify.com.br/…). Copie o link inteiro do checkout.",
    );
    expect(bad("https://pay.hotmart/X1")).toContain("https://pay.hotmart.com/");
    expect(bad("go.perfectpay")).toContain("perfectpay");
  });

  it("recusa endereço sem domínio de verdade ou mal formado", () => {
    expect(bad("checkout")).toBe("Digite um link completo, como https://pay.hotmart.com/…");
    expect(bad("https://pay.loja.c")).toContain("não termina num domínio");
    // Fim numérico: o navegador lê como endereço IP inválido (mensagem geral).
    bad("https://pay.loja.123");
    bad("https://pay..com");
    bad("ftp://arquivos.com.br/x");
    bad("https://pay hotmart.com");
  });
});

describe("linkUrlHint", () => {
  it("checkout conhecido sem o código do produto → aviso; com código ou outro site → nada", () => {
    expect(linkUrlHint("https://pay.hotmart.com")).toContain("código do produto");
    expect(linkUrlHint("pay.kiwify.com.br/")).toContain("código do produto");
    expect(linkUrlHint("https://pay.hotmart.com/X123")).toBeNull();
    expect(linkUrlHint("https://pay.hotmart.com/?off=abc")).toBeNull();
    expect(linkUrlHint("https://minhaloja.com.br")).toBeNull();
    expect(linkUrlHint("pay.kiwify")).toBeNull();
    expect(linkUrlHint("")).toBeNull();
  });
});
