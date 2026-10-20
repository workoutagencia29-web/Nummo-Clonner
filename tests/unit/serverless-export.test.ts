/**
 * Fases 3 e 4: exportar para hospedagem SEM PHP (Vercel/Netlify), com o banco.
 *
 * - O ZIP leva a função (api/pagamento.mjs ou netlify/functions/pagamento.mjs),
 *   o manifesto e o .env.example — e NUNCA o pagamento.php nem o config.php nem
 *   a chave do gateway (o destino "php" continua levando o pagamento.php).
 * - As páginas chamam o endpoint da plataforma (/api/pagamento …).
 * - Ponta a ponta: a função EMPACOTADA do ZIP roda num servidor local e cobra
 *   de verdade contra a FlevoPay FALSA (criar → PIX → pagar → acesso), com a
 *   chave vindo só do ambiente. Nada sai para a internet.
 */

import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type CheckoutConfigDraft, checkoutConfigDraft, parseCheckoutConfig } from "@/lib/checkout/config";
import { CHECKOUT_CONFIG_ID, type PublicCheckoutConfig } from "@/lib/checkout/contract";
import { prisma } from "@/lib/db";
import { PAYMENT_CONFIG_ID, type PaymentPageConfig } from "@/lib/payments/contract";
import { saveCheckoutProduct } from "@/server/services/checkout/products";
import { buildExport } from "@/server/services/export/build";
import { exportPlan, parseExportOptions } from "@/server/services/export/plan";
import { createOfferLink } from "@/server/services/offer-links";
import { createOffer } from "@/server/services/offers";
import { createPage } from "@/server/services/pages";
import { resetDatabase } from "../setup/per-file";
import { readZip } from "./export-fixture";
import { FAKE_PIX_CODE, type FakePix, FLEVO_KEY, startFakeFlevopay } from "./pix-fakes";

const PRODUCT_ACCESS = "https://area.exemplo.com/curso?token=segredo";
const BUMP_ACCESS = "https://drive.exemplo.com/apostila";
const BUYER = { nome: "João Silva", email: "joao@exemplo.com.br", telefone: "11987654321", documento: "52998224725" };

let tmp = "";
let flevo: FakePix;

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "os-serverless-zip-"));
  flevo = await startFakeFlevopay();
});

afterAll(async () => {
  await flevo.close();
  if (tmp) await rm(tmp, { recursive: true, force: true });
  await resetDatabase();
});

async function checkoutOffer() {
  const offer = await createOffer({ name: "Curso", currency: "BRL" });
  const home = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id, isHome: true } });
  const thanks = await createPage({ offerId: offer.id, name: "Obrigado", type: "THANK_YOU" });
  const link = await createOfferLink(offer.id, { label: "Checkout principal", url: "", kind: "CHECKOUT" });
  const sales = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Vendas</title></head><body><a data-os-link="${link.key}" href="#">Comprar</a></body></html>`;
  await prisma.pageDocument.updateMany({ where: { variant: { pageId: home.id } }, data: { html: sales } });
  const config: CheckoutConfigDraft = {
    ...checkoutConfigDraft(parseCheckoutConfig({})),
    address: false,
    shipping: [],
    bumps: [
      {
        id: "bump0001",
        title: "Apostila (PDF)",
        description: "Bônus.",
        price: "27,00",
        compareAt: "",
        imageSrc: null,
        accessUrl: BUMP_ACCESS,
      },
    ],
  };
  await saveCheckoutProduct(link.id, {
    name: "Curso completo",
    amount: "197,00",
    provider: "FLEVOPAY",
    methods: ["PIX"],
    locale: "PT",
    thankYouPageId: thanks.id,
    accessUrl: PRODUCT_ACCESS,
    config,
  });
  return { offerId: offer.id, key: link.key };
}

async function build(offerId: string, target: "php" | "vercel" | "netlify") {
  const file = path.join(tmp, `${target}-${Date.now()}.zip`);
  await buildExport({ offerId, options: parseExportOptions({ target }), target: file });
  const entries = await readZip(file);
  const text = (p: string) => entries.get(p)?.data.toString("utf8") ?? "";
  return { entries, text };
}

function jsonOf<T>(html: string, id: string): T {
  const m = new RegExp(`<script type="application/json" id="${id}"[^>]*>([\\s\\S]*?)</script>`).exec(html);
  expect(m, `sem #${id}`).not.toBeNull();
  return JSON.parse((m as RegExpExecArray)[1].replace(/\\u003c/g, "<").replace(/\\u0026/g, "&"));
}

describe("exportação Vercel", () => {
  it("leva a função + manifesto + .env.example e NÃO leva PHP nem a chave", async () => {
    const { offerId, key } = await checkoutOffer();
    const { entries, text } = await build(offerId, "vercel");
    const paths = [...entries.keys()];

    expect(paths).toContain("api/pagamento.mjs");
    expect(paths).toContain("vercel.json");
    expect(paths).toContain(".env.example");
    expect(paths).not.toContain("pagamento.php");
    expect(paths.some((p) => p.startsWith("pagamento-dados/"))).toBe(false);

    // O .env.example só com os nomes (vazio) e o gateway usado.
    const env = text(".env.example");
    expect(env).toContain("OS_PAY_SECRET=");
    expect(env).toContain("OS_FLEVOPAY_KEY=");

    // A chave do gateway NUNCA aparece em arquivo nenhum do ZIP.
    for (const [, item] of entries) expect(item.data.toString("utf8")).not.toContain(FLEVO_KEY);

    // A página de checkout chama o endpoint da Vercel.
    const checkoutHtml = text(`checkout/${key}/index.html`);
    const cfg = jsonOf<PublicCheckoutConfig>(checkoutHtml, CHECKOUT_CONFIG_ID);
    expect(cfg.endpoint).toBe("/api/pagamento");

    // A página de obrigado leva o #os-pagamento com o mesmo endpoint.
    const thanks = text("obrigado/index.html");
    const pay = jsonOf<PaymentPageConfig>(thanks, PAYMENT_CONFIG_ID);
    expect(pay.endpoint).toBe("/api/pagamento");

    // O LEIA-ME explica a função da Vercel (sem o "precisa de PHP" do pagamento) e lista as variáveis.
    const readme = text("LEIA-ME.txt");
    expect(readme).toContain("PAGAMENTO NA VERCEL");
    expect(readme).toContain("OS_PAY_SECRET");
    expect(readme).toContain("OS_FLEVOPAY_KEY");
    expect(readme).not.toContain("PAGAMENTO NA PÁGINA (pagamento.php)");
  });

  it("o plano mostra a função (sem “precisa de PHP”) e avisa das variáveis de ambiente", async () => {
    const { offerId } = await checkoutOffer();
    const plan = await exportPlan(offerId, parseExportOptions({ target: "vercel" }));
    expect(plan.tree.some((t) => t.path === "api/pagamento.mjs")).toBe(true);
    expect(plan.tree.some((t) => t.path === "pagamento.php")).toBe(false);
    const hosting = plan.warnings.join("\n");
    expect(hosting).toContain("função da Vercel");
    expect(hosting).toContain("OS_PAY_SECRET");
    expect(hosting).not.toMatch(/precisa de hospedagem com PHP/);
  });
});

describe("exportação Netlify", () => {
  it("leva netlify/functions + netlify.toml e o endpoint da Netlify", async () => {
    const { offerId, key } = await checkoutOffer();
    const { entries, text } = await build(offerId, "netlify");
    const paths = [...entries.keys()];
    expect(paths).toContain("netlify/functions/pagamento.mjs");
    expect(paths).toContain("netlify.toml");
    expect(paths).not.toContain("pagamento.php");
    const cfg = jsonOf<PublicCheckoutConfig>(text(`checkout/${key}/index.html`), CHECKOUT_CONFIG_ID);
    expect(cfg.endpoint).toBe("/.netlify/functions/pagamento");
  });
});

describe("exportação PHP (regressão: continua igual)", () => {
  it("leva o pagamento.php e o config.php", async () => {
    const { offerId } = await checkoutOffer();
    const { entries } = await build(offerId, "php");
    const paths = [...entries.keys()];
    expect(paths).toContain("pagamento.php");
    expect(paths.some((p) => p.startsWith("pagamento-dados/"))).toBe(true);
    expect(paths).not.toContain("api/pagamento.mjs");
  });
});

describe("ponta a ponta: a função do ZIP cobra de verdade (FlevoPay falsa)", () => {
  let server: Server;
  let base: string;
  let checkoutKey = "";
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    const { offerId, key } = await checkoutOffer();
    checkoutKey = key;
    const { entries } = await build(offerId, "vercel");
    const js = entries.get("api/pagamento.mjs")?.data.toString("utf8") ?? "";
    const file = path.join(tmp, "emitida.mjs");
    await writeFile(file, js, "utf8");

    for (const k of ["OS_PAY_SECRET", "OS_FLEVOPAY_KEY", "OS_FLEVOPAY_API_BASE"]) savedEnv[k] = process.env[k];
    process.env.OS_PAY_SECRET = randomBytes(32).toString("base64");
    process.env.OS_FLEVOPAY_KEY = FLEVO_KEY;
    process.env.OS_FLEVOPAY_API_BASE = flevo.base;

    const mod = (await import(pathToFileURL(file).href)) as { default: (req: unknown, res: unknown) => Promise<void> };
    server = createServer((req, res) => {
      mod.default(req, res).catch(() => {
        res.statusCode = 500;
        res.end("{}");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    for (const k of ["OS_PAY_SECRET", "OS_FLEVOPAY_KEY", "OS_FLEVOPAY_API_BASE"]) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  async function post(body: unknown) {
    const res = await fetch(`${base}/api/pagamento`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  }

  it("criar → status(pendente) → pagar → status(pago) → acesso (produto + bump)", async () => {
    const criar = await post({
      acao: "checkout_criar",
      checkout: checkoutKey,
      metodo: "pix",
      bumps: ["bump0001"],
      frete: null,
      ...BUYER,
    });
    expect(criar.status).toBe(201);
    expect((criar.json.pedido as string).startsWith("ck_")).toBe(true);
    expect((criar.json.pix as { codigo: string }).codigo).toBe(FAKE_PIX_CODE);
    expect(criar.json.valor).toBe(22400); // 197,00 + 27,00
    const pedido = criar.json.pedido as string;

    const gid = [...flevo.transactions.values()].at(-1)?.id as string;
    const pend = await post({ acao: "checkout_status", checkout: checkoutKey, pedido });
    expect(pend.json.pago).toBe(false);

    flevo.setStatus(gid, "paid");
    const pago = await post({ acao: "checkout_status", checkout: checkoutKey, pedido });
    expect(pago.json.pago).toBe(true);

    const acesso = await post({ acao: "acesso", pedido });
    expect(acesso.status).toBe(200);
    expect(acesso.json.acesso).toBe(PRODUCT_ACCESS);
    expect(acesso.json.extras).toEqual([{ titulo: "Apostila (PDF)", acesso: BUMP_ACCESS }]);
  });
});
