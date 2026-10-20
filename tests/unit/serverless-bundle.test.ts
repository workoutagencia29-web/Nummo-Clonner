/**
 * Fase 2: a função serverless empacotada (Vercel/Netlify) de verdade — o
 * esbuild gera o .mjs, nós carregamos e chamamos como a plataforma chamaria,
 * cobrando contra os gateways FALSOS. Confere as defesas de borda (mesma
 * origem, tamanho, cabeçalhos), que o segredo NÃO entra no arquivo e que a
 * config (com os links de acesso) fica só dentro da função.
 */

import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseCheckoutConfig } from "@/lib/checkout/config";
import {
  GATEWAY_ENV_NAME,
  paymentEndpoint,
  serverlessEnvExample,
  serverlessManifest,
  serverlessReservedPaths,
} from "@/lib/export/serverless";
import { serverlessFunctionJs } from "@/lib/runtime-bundle";
import type { ServerlessConfig } from "@/server/services/payments/serverless/config";
import { type FakeKyvo, KYVO_KEY, startFakeKyvo } from "./kyvo-fake";
import { type FakePix, FLEVO_KEY, startFakeFlevopay } from "./pix-fakes";

const SECRET_B64 = randomBytes(32).toString("base64");
const BUYER = { nome: "João Silva", email: "joao@exemplo.com.br", telefone: "11987654321", documento: "52998224725" };

function baseConfig(): ServerlessConfig {
  const curso = parseCheckoutConfig({ maxQuantity: 1 });
  return {
    v: 1,
    payments: [],
    checkouts: [
      {
        key: "curso",
        linkId: "link_curso_0001",
        provider: "FLEVOPAY",
        name: "Curso completo",
        amountCents: 4990,
        currency: "BRL",
        methods: ["PIX"],
        locale: "PT",
        accessUrl: "https://curso.exemplo/acesso-secreto",
        config: {
          fields: curso.fields,
          address: curso.address,
          shipping: curso.shipping,
          bumps: curso.bumps,
          maxQuantity: curso.maxQuantity,
        },
      },
    ],
  };
}

let flevo: FakePix;
let kyvo: FakeKyvo;
let dir: string;

beforeAll(async () => {
  flevo = await startFakeFlevopay();
  kyvo = await startFakeKyvo();
  process.env.OS_FLEVOPAY_API_BASE = flevo.base;
  process.env.OS_KYVO_API_BASE = kyvo.base;
  process.env.OS_PAY_SECRET = SECRET_B64;
  process.env.OS_FLEVOPAY_KEY = FLEVO_KEY;
  process.env.OS_KYVO_KEY = KYVO_KEY;
  dir = await mkdtemp(path.join(tmpdir(), "os-serverless-"));
});

afterAll(async () => {
  for (const k of ["OS_FLEVOPAY_API_BASE", "OS_KYVO_API_BASE", "OS_PAY_SECRET", "OS_FLEVOPAY_KEY", "OS_KYVO_KEY"]) {
    delete process.env[k];
  }
  await flevo.close();
  await kyvo.close();
  await rm(dir, { recursive: true, force: true });
});

async function loadBundle(target: "vercel" | "netlify", name: string): Promise<Record<string, unknown>> {
  const js = serverlessFunctionJs(target, baseConfig());
  const file = path.join(dir, `${name}.mjs`);
  await writeFile(file, js, "utf8");
  return (await import(pathToFileURL(file).href)) as Record<string, unknown>;
}

describe("função empacotada da Vercel", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const mod = await loadBundle("vercel", "vercel");
    const handler = mod.default as (req: unknown, res: unknown) => Promise<void>;
    server = createServer((req, res) => {
      handler(req, res).catch(() => {
        res.statusCode = 500;
        res.end("{}");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("GET devolve o resumo de saúde (sem segredo), com as chaves presentes", async () => {
    const res = await fetch(base);
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      ok: boolean;
      segredo: boolean;
      checkout: number;
      chaves: Record<string, boolean>;
    };
    expect(j.ok).toBe(true);
    expect(j.segredo).toBe(true);
    expect(j.checkout).toBe(1);
    expect(j.chaves.FLEVOPAY).toBe(true);
  });

  it("checkout_criar da mesma origem cobra de verdade (PIX pela FlevoPay falsa)", async () => {
    const res = await fetch(`${base}/api/pagamento`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({
        acao: "checkout_criar",
        checkout: "curso",
        metodo: "pix",
        bumps: [],
        frete: null,
        ...BUYER,
      }),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const j = (await res.json()) as { ok: boolean; pedido: string; pix: { codigo: string } };
    expect(j.ok).toBe(true);
    expect(j.pedido.startsWith("ck_")).toBe(true);
    expect(j.pix.codigo.length).toBeGreaterThan(20);
  });

  it("pedido de outro site é recusado (origem)", async () => {
    const res = await fetch(`${base}/api/pagamento`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://site-do-mal.example" },
      body: JSON.stringify({
        acao: "checkout_criar",
        checkout: "curso",
        metodo: "pix",
        bumps: [],
        frete: null,
        ...BUYER,
      }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { erro: string }).erro).toBe("origem");
  });

  it("corpo grande demais é recusado antes de parsear (corpo_grande)", async () => {
    const res = await fetch(`${base}/api/pagamento`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ acao: "checkout_criar", lixo: "x".repeat(9000) }),
    });
    expect(res.status).toBe(413);
  });
});

describe("função empacotada da Netlify", () => {
  it("handler(event) cobra de verdade e aplica as defesas", async () => {
    const mod = await loadBundle("netlify", "netlify");
    const handler = mod.handler as (
      e: unknown,
    ) => Promise<{ statusCode: number; headers: Record<string, string>; body: string }>;

    const ok = await handler({
      httpMethod: "POST",
      headers: { "content-type": "application/json", origin: "https://loja.test", host: "loja.test" },
      queryStringParameters: {},
      body: JSON.stringify({
        acao: "checkout_criar",
        checkout: "curso",
        metodo: "pix",
        bumps: [],
        frete: null,
        ...BUYER,
      }),
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.headers["Cache-Control"]).toBe("no-store");
    expect((JSON.parse(ok.body) as { pedido: string }).pedido.startsWith("ck_")).toBe(true);

    const cross = await handler({
      httpMethod: "POST",
      headers: { "content-type": "application/json", origin: "https://outro.test", host: "loja.test" },
      queryStringParameters: {},
      body: JSON.stringify({
        acao: "checkout_criar",
        checkout: "curso",
        metodo: "pix",
        bumps: [],
        frete: null,
        ...BUYER,
      }),
    });
    expect(cross.statusCode).toBe(403);

    const webhook = await handler({
      httpMethod: "POST",
      headers: { host: "loja.test" },
      queryStringParameters: { webhook: "flevopay" },
      body: "{}",
    });
    expect(webhook.statusCode).toBe(200);
  });
});

describe("o segredo nunca vai para o arquivo; a config fica só na função", () => {
  it("o .mjs não contém o segredo nem source map, mas embute a config (links de acesso)", () => {
    const js = serverlessFunctionJs("vercel", baseConfig());
    expect(js).not.toContain(SECRET_B64);
    expect(js).not.toContain("OS_PAY_SECRET=");
    expect(js).not.toContain("sourceMappingURL");
    // A config (inclusive o link de acesso privado) fica DENTRO da função — é código só do servidor.
    expect(js).toContain("curso.exemplo/acesso-secreto");
  });
});

describe("peças puras da exportação serverless", () => {
  it("o endpoint é raiz absoluta no serverless e relativo no PHP", () => {
    expect(paymentEndpoint("vercel", "../")).toBe("/api/pagamento");
    expect(paymentEndpoint("netlify", "../../")).toBe("/.netlify/functions/pagamento");
    expect(paymentEndpoint("php", "../")).toBe("../pagamento.php");
  });

  it("o .env.example só traz os nomes das variáveis usadas (sem valores)", () => {
    const env = serverlessEnvExample(["FLEVOPAY", "KYVO"]);
    expect(env).toContain("OS_PAY_SECRET=");
    expect(env).toContain(`${GATEWAY_ENV_NAME.FLEVOPAY}=`);
    expect(env).toContain(`${GATEWAY_ENV_NAME.KYVO}=`);
    expect(env).not.toContain(GATEWAY_ENV_NAME.BLACKCAT);
    // Nenhum valor depois do "=".
    for (const line of env.split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))) {
      expect(line.trim().endsWith("=")).toBe(true);
    }
  });

  it("os manifestos e os caminhos reservados batem com a plataforma", () => {
    expect(serverlessManifest("vercel")).toContain("api/pagamento.mjs");
    expect(serverlessManifest("netlify")).toContain('directory = "netlify/functions"');
    expect(serverlessManifest("netlify")).toContain('NODE_VERSION = "20"');
    expect(serverlessReservedPaths("vercel")).toEqual(["api/pagamento.mjs", "vercel.json", ".env.example"]);
    expect(serverlessReservedPaths("netlify")).toEqual([
      "netlify/functions/pagamento.mjs",
      "netlify.toml",
      ".env.example",
    ]);
  });
});
