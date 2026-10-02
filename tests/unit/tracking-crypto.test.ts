/**
 * Fase 4 — criptografia dos tokens de API (src/lib/crypto.ts).
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, maskSecret, SECRET_UNREADABLE_MESSAGE, tryDecryptSecret } from "@/lib/crypto";
import { UserError } from "@/lib/errors";

const TOKEN = "EAAGm0PX4ZCpsBAKZCZBy1234567890abcdefghijklmnopqrstuvwxyz";

function expectUnreadable(fn: () => unknown) {
  let err: unknown;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(UserError);
  expect((err as UserError).message).toBe(SECRET_UNREADABLE_MESSAGE);
  expect((err as UserError).message).toMatch(/Cole o token de novo/);
}

/** Troca um byte do conteúdo cifrado (depois do "v1:"). */
function tamper(value: string, index: number) {
  const raw = Buffer.from(value.slice(3), "base64");
  raw[index] ^= 0x01;
  return `v1:${raw.toString("base64")}`;
}

describe("encryptSecret / decryptSecret", () => {
  it("ida e volta com a chave do .env, no formato versionado v1:base64", () => {
    const enc = encryptSecret(TOKEN);
    expect(enc).toMatch(/^v1:[A-Za-z0-9+/]+=*$/);
    expect(enc).not.toContain(TOKEN);
    expect(decryptSecret(enc)).toBe(TOKEN);
    // iv (12) + tag (16) + texto
    expect(Buffer.from(enc.slice(3), "base64").length).toBe(12 + 16 + Buffer.byteLength(TOKEN));
  });

  it("IV aleatório: o mesmo texto gera resultados diferentes", () => {
    const a = encryptSecret(TOKEN);
    const b = encryptSecret(TOKEN);
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it("aceita acentos, emoji e texto vazio", () => {
    for (const text of ["", "ação ☕ 🚀", "x".repeat(5000)]) {
      expect(decryptSecret(encryptSecret(text))).toBe(text);
    }
  });

  it("dado alterado (IV, tag ou texto cifrado) → erro em português", () => {
    const enc = encryptSecret(TOKEN);
    expectUnreadable(() => decryptSecret(tamper(enc, 0))); // IV
    expectUnreadable(() => decryptSecret(tamper(enc, 14))); // tag
    expectUnreadable(() => decryptSecret(tamper(enc, 30))); // texto cifrado
    // Cortado no meio.
    expectUnreadable(() => decryptSecret(enc.slice(0, 20)));
  });

  it("chave diferente → erro em português (não devolve lixo)", () => {
    const otherKey = randomBytes(32).toString("base64");
    const enc = encryptSecret(TOKEN, otherKey);
    expect(decryptSecret(enc, otherKey)).toBe(TOKEN);
    expectUnreadable(() => decryptSecret(enc));
  });

  it("formato desconhecido → erro em português", () => {
    expectUnreadable(() => decryptSecret(TOKEN));
    expectUnreadable(() => decryptSecret("v2:AAAA"));
    expectUnreadable(() => decryptSecret("v1:"));
    expectUnreadable(() => decryptSecret("v1:não-é-base64!"));
    expectUnreadable(() => decryptSecret(`${encryptSecret(TOKEN)}:extra`));
  });

  it("chave inválida no parâmetro é erro de configuração (não UserError)", () => {
    expect(() => encryptSecret(TOKEN, Buffer.alloc(16).toString("base64"))).toThrow(/32 bytes/);
  });

  it("tryDecryptSecret devolve null em vez de lançar; maskSecret só mostra o final", () => {
    expect(tryDecryptSecret(null)).toBeNull();
    expect(tryDecryptSecret("lixo")).toBeNull();
    expect(tryDecryptSecret(encryptSecret(TOKEN))).toBe(TOKEN);
    expect(maskSecret(TOKEN)).toBe("••••••wxyz");
    expect(maskSecret("curto")).toBe("••••••");
    expect(maskSecret(TOKEN)).not.toContain(TOKEN.slice(0, 10));
  });
});
