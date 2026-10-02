import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import {
  deleteObject,
  getObject,
  mimeFromKey,
  objectExists,
  putContentAddressed,
  putObject,
  sha256,
  storagePath,
} from "@/lib/storage";

const ROOT = path.join(env.dataDir, "storage");
const written = new Set<string>();

afterAll(async () => {
  for (const key of written) await deleteObject(key);
});

describe("storagePath", () => {
  it("usa a pasta de dados dos testes, nunca a pasta real", () => {
    expect(env.dataDir).toBe(path.resolve(process.cwd(), "data/test"));
  });

  it("aceita chaves relativas normais", () => {
    expect(storagePath("a/ab/x.webp")).toBe(path.join(ROOT, "a", "ab", "x.webp"));
    expect(storagePath("thumb.png")).toBe(path.join(ROOT, "thumb.png"));
  });

  it.each([
    ["../x"],
    ["a/../../x"],
    ["a/.."],
    ["/abs"],
    ["/etc/passwd"],
    ["a//b"],
    ["a/"],
    [""],
    ["a\0b"],
  ])("recusa a chave %j", (key) => {
    expect(() => storagePath(key)).toThrow("Chave de storage inválida");
  });
});

describe("putContentAddressed", () => {
  it("grava pelo hash do conteúdo e deduplica o mesmo arquivo", async () => {
    const data = new Uint8Array(randomBytes(64));
    const hash = sha256(data);

    const first = await putContentAddressed(data, ".WebP");
    written.add(first.key);

    expect(first).toEqual({ key: `a/${hash.slice(0, 2)}/${hash}.webp`, sha256: hash, bytes: 64 });
    expect(objectExists(first.key)).toBe(true);
    expect(new Uint8Array(readFileSync(storagePath(first.key)))).toEqual(data);

    // Mesmo conteúdo → mesma chave, sem regravar.
    const second = await putContentAddressed(new Uint8Array(data), "webp");
    expect(second).toEqual(first);

    // Conteúdo diferente → outra chave.
    const other = await putContentAddressed(new Uint8Array(randomBytes(64)), "webp");
    written.add(other.key);
    expect(other.key).not.toBe(first.key);
  });

  it('limpa a extensão e usa "bin" quando ela não serve', async () => {
    const data = new Uint8Array(randomBytes(16));
    const bad = await putContentAddressed(data, "../../");
    written.add(bad.key);
    expect(bad.key.endsWith(".bin")).toBe(true);

    const long = await putContentAddressed(data, "extensaomuitolonga");
    written.add(long.key);
    expect(long.key.endsWith(".extensao")).toBe(true);
  });

  it("não deixa arquivos temporários para trás", async () => {
    const data = new Uint8Array(randomBytes(32));
    const { key } = await putContentAddressed(data, "png");
    written.add(key);
    const dir = path.dirname(storagePath(key));
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("putObject / getObject / deleteObject", () => {
  it("grava, lê e apaga", async () => {
    const key = `tmp/teste-${Date.now()}.txt`;
    written.add(key);
    await putObject(key, "Olá, ação!");
    expect((await getObject(key)).toString("utf8")).toBe("Olá, ação!");
    await deleteObject(key);
    expect(existsSync(storagePath(key))).toBe(false);
    // Apagar de novo não dá erro.
    await expect(deleteObject(key)).resolves.toBeUndefined();
  });
});

describe("mimeFromKey", () => {
  it("identifica o tipo pela extensão", () => {
    expect(mimeFromKey("a/ab/x.WEBP")).toBe("image/webp");
    expect(mimeFromKey("index.html")).toBe("text/html; charset=utf-8");
    expect(mimeFromKey("arquivo.desconhecido")).toBe("application/octet-stream");
  });
});
