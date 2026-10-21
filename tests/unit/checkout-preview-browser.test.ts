/**
 * Página de checkout do Offer Studio de ponta a ponta na PRÉVIA do app
 * (sempre simulação): sobe o servidor de prévia de verdade
 * (src/preview/server.ts) com o banco de testes e abre num Chromium, no
 * computador e no celular. Da página de vendas ao checkout; validação com os
 * erros em português; CEP pela BrasilAPI (SIMULADA aqui: a rota é atendida
 * pelo próprio teste); frete e order bumps mudando o total; PIX com o QR
 * gerado na página a partir do "copia e cola"; recarregar volta ao PIX;
 * aprovado → página de obrigado com o acesso do produto e do bump comprado;
 * expirado → novo PIX; recusado → tentar de novo; Kyvo (peso) com SPEI e
 * cartão simulados. Eventos dos pixels (os:purchase): InitiateCheckout uma
 * vez, AddPaymentInfo e Purchase sem repetir. Nada sai para a internet.
 *
 * Capturas (computador e celular) em OS_CHECKOUT_SHOTS, quando definido.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { type Browser, chromium, type Page } from "playwright";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ACCESS_CSS, accessDef } from "@/editor/widgets/access-content";
import { defToHtml } from "@/editor/widgets/quiz-content";
import { type CheckoutConfigDraft, checkoutConfigDraft, parseCheckoutConfig } from "@/lib/checkout/config";
import { prisma } from "@/lib/db";
import { createPreviewToken } from "@/lib/preview";
import { putContentAddressed } from "@/lib/storage";
import { saveCheckoutProduct } from "@/server/services/checkout/products";
import { createOfferLink } from "@/server/services/offer-links";
import { createOffer } from "@/server/services/offers";
import { createPage } from "@/server/services/pages";
import { savePaymentGatewayKey } from "@/server/services/payments/gateways";
import { createUpsellPage, saveUpsellFlow } from "@/server/services/upsell";
import { resetDatabase } from "../setup/per-file";
import { FAKE_PIX_CODE, type FakePix, FLEVO_KEY, startFakeFlevopay } from "./pix-fakes";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SHOTS = process.env.OS_CHECKOUT_SHOTS ?? "";
let port = 0;
let child: ChildProcess | null = null;
let flevo: FakePix;
let output = "";
let browser: Browser;

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const p = (srv.address() as { port: number }).port;
      srv.close(() => resolve(p));
    });
  });
}

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toMatch(/\/offerstudio_test_\d+$/);
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  // FlevoPay FALSA: o processo da prévia cobra nela quando a oferta tem a chave salva.
  flevo = await startFakeFlevopay();
  port = await freePort();
  child = spawn(path.join(ROOT, "node_modules/.bin/tsx"), ["src/preview/server.ts"], {
    cwd: ROOT,
    env: { ...process.env, PREVIEW_PORT: String(port), OS_FLEVOPAY_API_BASE: flevo.base },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (c) => {
    output += String(c);
  });
  child.stderr?.on("data", (c) => {
    output += String(c);
  });
  const deadline = Date.now() + 30_000;
  while (!output.includes("servidor de prévia")) {
    if (Date.now() > deadline || child.exitCode !== null) throw new Error(`prévia não subiu:\n${output}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  child?.kill("SIGTERM");
  await flevo?.close();
});

beforeEach(async () => {
  await resetDatabase();
});

const PRODUCT_ACCESS = "https://area.exemplo.com/confeitaria";
const BUMP_ACCESS = "https://drive.exemplo.com/apostila";
const CEP_REPLY = {
  cep: "01310100",
  state: "SP",
  city: "São Paulo",
  neighborhood: "Bela Vista",
  street: "Avenida Paulista",
  service: "open-cep",
};

/** Imagem de exemplo (gradiente com texto) na biblioteca da oferta. */
async function image(offerId: string, w: number, h: number, colors: [string, string], text: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="54%" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(h / 6)}" font-weight="700" fill="#fff" text-anchor="middle">${text}</text></svg>`;
  const data = await sharp(Buffer.from(svg)).webp({ quality: 90 }).toBuffer();
  const stored = await putContentAddressed(data, "webp");
  await prisma.asset.upsert({
    where: { offerId_key: { offerId, key: stored.key } },
    create: { offerId, sha256: stored.sha256, key: stored.key, kind: "IMAGE", mime: "image/webp", bytes: stored.bytes },
    update: {},
  });
  return `/os-assets/${stored.key.split("/")[2]}`;
}

async function brlOffer() {
  const offer = await createOffer({ name: "Confeitaria", currency: "BRL" });
  const home = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id, isHome: true } });
  const thanks = await createPage({ offerId: offer.id, name: "Obrigado", type: "THANK_YOU" });
  const link = await createOfferLink(offer.id, { label: "Checkout principal", url: "", kind: "CHECKOUT" });
  const sales = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Vendas</title></head><body><h1>Curso</h1><a id="comprar" data-os-link="${link.key}" href="https://pay.hotmart.com/ANTIGO">Comprar</a></body></html>`;
  const thanksHtml = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Obrigado</title><style>${ACCESS_CSS}</style></head><body>${defToHtml(accessDef("pt"))}</body></html>`;
  await prisma.pageDocument.updateMany({ where: { variant: { pageId: home.id } }, data: { html: sales } });
  await prisma.pageDocument.updateMany({ where: { variant: { pageId: thanks.id } }, data: { html: thanksHtml } });
  const [photo, bannerD, bannerM, bump1, bump2] = await Promise.all([
    image(offer.id, 300, 300, ["#f472b6", "#be185d"], "Curso"),
    image(offer.id, 1100, 180, ["#be185d", "#7c2d12"], "Confeitaria Profissional — oferta de lançamento"),
    image(offer.id, 780, 300, ["#be185d", "#7c2d12"], "Oferta de lançamento"),
    image(offer.id, 200, 200, ["#fb923c", "#c2410c"], "PDF"),
    image(offer.id, 200, 200, ["#60a5fa", "#1d4ed8"], "Live"),
  ]);
  const config: CheckoutConfigDraft = {
    ...checkoutConfigDraft(parseCheckoutConfig({})),
    description: "Mais de 80 aulas em vídeo, do básico ao bolo de casamento.",
    compareAt: "297,00",
    imageSrc: photo,
    address: true,
    shipping: [
      { id: "pac000001", name: "Correios PAC", eta: "5 a 9 dias úteis", price: "" },
      { id: "sedex0001", name: "Sedex", eta: "1 a 3 dias úteis", price: "29,90" },
    ],
    shippingDefault: "pac000001",
    bumps: [
      {
        id: "bump0001",
        title: "Apostila de receitas (PDF)",
        description: "120 receitas testadas para imprimir.",
        price: "27,00",
        compareAt: "47,00",
        imageSrc: bump1,
        accessUrl: BUMP_ACCESS,
      },
      {
        id: "bump0002",
        title: "Mentoria ao vivo",
        description: "Uma aula ao vivo por mês para tirar dúvidas.",
        price: "49,90",
        compareAt: "",
        imageSrc: bump2,
        accessUrl: "",
      },
    ],
    bannerDesktopSrc: bannerD,
    bannerMobileSrc: bannerM,
    color: "#db2777",
    timer: "15",
    testimonials: [
      {
        id: "dep00001",
        text: "Comecei a vender bolos no segundo mês. Vale cada centavo!",
        name: "Ana Paula",
        photoSrc: null,
      },
      { id: "dep00002", text: "Didática ótima, receitas que dão certo de primeira.", name: "Carla M.", photoSrc: null },
    ],
  };
  await saveCheckoutProduct(link.id, {
    name: "Curso de Confeitaria Profissional",
    amount: "197,00",
    provider: "FLEVOPAY",
    methods: ["PIX"],
    locale: "PT",
    thankYouPageId: thanks.id,
    accessUrl: PRODUCT_ACCESS,
    config,
  });
  const token = await createPreviewToken({ kind: "offer", offerId: offer.id });
  return { offerId: offer.id, key: link.key, thanksId: thanks.id, base: `http://${token}.localhost:${port}` };
}

async function mxnOffer() {
  const offer = await createOffer({ name: "Repostería", currency: "MXN" });
  const thanks = await createPage({ offerId: offer.id, name: "Gracias", type: "THANK_YOU" });
  const thanksHtml = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Gracias</title><style>${ACCESS_CSS}</style></head><body>${defToHtml(accessDef("es"))}</body></html>`;
  await prisma.pageDocument.updateMany({ where: { variant: { pageId: thanks.id } }, data: { html: thanksHtml } });
  const link = await createOfferLink(offer.id, { label: "Checkout", url: "", kind: "CHECKOUT" });
  await saveCheckoutProduct(link.id, {
    name: "Curso de Repostería",
    amount: "497,00",
    provider: "KYVO",
    methods: ["SPEI", "CARD"],
    locale: "ES",
    thankYouPageId: thanks.id,
    accessUrl: PRODUCT_ACCESS,
    config: {
      ...checkoutConfigDraft(parseCheckoutConfig({})),
      fields: { name: true, email: true, phone: false, document: false },
    },
  });
  const token = await createPreviewToken({ kind: "offer", offerId: offer.id });
  return { key: link.key, thanksId: thanks.id, base: `http://${token}.localhost:${port}` };
}

/** Oferta em peso com produto FÍSICO: endereço de entrega genérico + frete (como no real). */
async function mxnAddressOffer() {
  const offer = await createOffer({ name: "Repostería", currency: "MXN" });
  const thanks = await createPage({ offerId: offer.id, name: "Gracias", type: "THANK_YOU" });
  const thanksHtml = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Gracias</title><style>${ACCESS_CSS}</style></head><body>${defToHtml(accessDef("es"))}</body></html>`;
  await prisma.pageDocument.updateMany({ where: { variant: { pageId: thanks.id } }, data: { html: thanksHtml } });
  const link = await createOfferLink(offer.id, { label: "Checkout", url: "", kind: "CHECKOUT" });
  await saveCheckoutProduct(link.id, {
    name: "Molde de Silicón",
    amount: "497,00",
    provider: "KYVO",
    methods: ["SPEI", "CARD"],
    locale: "ES",
    thankYouPageId: thanks.id,
    accessUrl: PRODUCT_ACCESS,
    config: {
      ...checkoutConfigDraft(parseCheckoutConfig({})),
      fields: { name: true, email: true, phone: false, document: false },
      address: true,
      shipping: [{ id: "envio0001", name: "Envío estándar", eta: "3 a 5 días", price: "99,00" }],
      shippingDefault: "envio0001",
    },
  });
  const token = await createPreviewToken({ kind: "offer", offerId: offer.id });
  return { key: link.key, thanksId: thanks.id, base: `http://${token}.localhost:${port}` };
}

interface Session {
  page: Page;
  outside: string[];
  errors: string[];
  cepCalls: string[];
  events: () => Promise<{ std?: string; id: string; value: number; currency: string; x?: Record<string, unknown> }[]>;
  close: () => Promise<void>;
}

async function open(url: string, mobile = false): Promise<Session> {
  const context = await browser.newContext(
    mobile
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
      : { viewport: { width: 1280, height: 900 } },
  );
  // Os avisos "os:purchase" (eventos dos pixels) ficam guardados entre as páginas.
  await context.addInitScript(() => {
    document.addEventListener("os:purchase", (e) => {
      const list = JSON.parse(localStorage.getItem("__ev") || "[]");
      list.push((e as CustomEvent).detail);
      localStorage.setItem("__ev", JSON.stringify(list));
    });
  });
  const page = await context.newPage();
  const outside: string[] = [];
  const cepCalls: string[] = [];
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname.endsWith(".localhost")) return route.continue();
    if (u.hostname === "brasilapi.com.br") {
      cepCalls.push(u.pathname);
      const ok = u.pathname === "/api/cep/v2/01310100";
      return route.fulfill({
        status: ok ? 200 : 404,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify(ok ? CEP_REPLY : { message: "CEP não encontrado" }),
      });
    }
    outside.push(u.href);
    return route.fulfill({ status: 204, body: "" });
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(url);
  return {
    page,
    outside,
    errors,
    cepCalls,
    events: () => page.evaluate(() => JSON.parse(localStorage.getItem("__ev") || "[]")),
    close: () => context.close(),
  };
}

/** Texto do elemento com espaços comuns (o valor em reais vem com espaço sem quebra: "R$ 197,00"). */
async function text(page: Page, selector: string) {
  return ((await page.locator(selector).first().textContent()) ?? "").replace(/\u00a0/g, " ");
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  // Página inteira a partir do topo (a faixa do cronômetro gruda no alto da tela).
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

async function fillBuyer(page: Page) {
  await page.locator("#osc-nome").fill("Maria da Silva");
  await page.locator("#osc-email").fill("maria@exemplo.com");
  await page.locator("#osc-telefone").pressSequentially("11987654321");
  await page.locator("#osc-documento").pressSequentially("52998224725");
}

async function fillAddress(page: Page) {
  await page.locator("#osc-cep").pressSequentially("01310100");
  await expect.poll(() => page.locator("#osc-rua").inputValue()).toBe("Avenida Paulista");
  await page.locator("#osc-numero").fill("1000");
}

describe("página de checkout na prévia (PIX)", () => {
  for (const device of ["computador", "celular"] as const) {
    it(`do botão de compra ao acesso, no ${device}`, async () => {
      const o = await brlOffer();
      const s = await open(`${o.base}/?utm_source=facebook&utm_campaign=lancamento`, device === "celular");
      const { page } = s;
      // A chegada com UTMs pede permissão de cookies (na frente das capturas): aceita na página de vendas.
      await page.getByRole("button", { name: "Aceitar" }).click();
      // A página de vendas leva à página de checkout (nunca ao endereço antigo do link), com as UTMs da chegada.
      await expect
        .poll(() => page.locator("#comprar").getAttribute("href"))
        .toBe(`/checkout/${o.key}?utm_source=facebook&utm_campaign=lancamento`);
      const sent: Record<string, unknown>[] = [];
      page.on("request", (r) => {
        if (r.method() === "POST" && r.url().endsWith("/__os/pagamento")) sent.push(r.postDataJSON());
      });
      await page.locator("#comprar").click();
      await page.waitForURL(new RegExp(`/checkout/${o.key}`));
      await expect.poll(() => text(page, "[data-osc-total]")).toBe("R$ 197,00");
      expect(await page.locator("html").getAttribute("lang")).toBe("pt-BR");
      expect(await page.locator("[data-osc-clock]").textContent()).toMatch(/^1[45]:\d\d$/);
      await shot(page, `${device}-1-checkout-vazio`);

      // Erros em português, foco no primeiro, nada de recarregar.
      await page.locator("#osc-telefone").pressSequentially("1198765");
      await page.locator("#osc-documento").pressSequentially("11111111111");
      await page.locator("[data-osc-pay]").click();
      await expect.poll(() => page.locator("#osc-nome-e").textContent()).toBe("Digite o nome completo.");
      expect(await page.evaluate(() => document.activeElement?.id)).toBe("osc-nome");
      expect(await page.locator("#osc-telefone-e").textContent()).toBe("Telefone inválido. Use o DDD e o número.");
      expect(await page.locator("#osc-documento-e").textContent()).toBe("CPF inválido. Confira os números.");
      expect(await page.locator("#osc-documento").inputValue()).toBe("111.111.111-11");
      expect(await page.locator("#osc-cep-e").textContent()).toBe("Preencha este campo.");
      expect(await page.locator("[data-osc-error]").textContent()).toBe("Confira os campos marcados em vermelho.");
      await shot(page, `${device}-2-erros`);

      await page.locator("#osc-telefone").fill("");
      await page.locator("#osc-documento").fill("");
      await fillBuyer(page);
      expect(await page.locator("#osc-telefone").inputValue()).toBe("(11) 98765-4321");
      expect(await page.locator("#osc-documento").inputValue()).toBe("529.982.247-25");
      // Entrega: no começo só o CEP; rua/bairro/cidade/UF escondidos e o frete pedindo o CEP.
      expect(await page.locator("#osc-cep").isVisible()).toBe(true);
      expect(await page.locator("#osc-rua").isVisible()).toBe(false);
      expect(await page.locator("[data-osc-ship-empty]").isVisible()).toBe(true);
      await fillAddress(page);
      // Depois do CEP, os campos de endereço aparecem (preenchidos pela BrasilAPI).
      expect(await page.locator("#osc-rua").isVisible()).toBe(true);
      expect(await page.locator("#osc-bairro").inputValue()).toBe("Bela Vista");
      expect(await page.locator("#osc-cidade").inputValue()).toBe("São Paulo");
      expect(await page.locator("#osc-uf").inputValue()).toBe("SP");
      expect(s.cepCalls).toEqual(["/api/cep/v2/01310100"]);
      await shot(page, `${device}-3-cep-preenchido`);

      // Bumps e frete mudam o total na hora.
      await page.locator(".osc-bump", { hasText: "Apostila" }).click();
      await page.locator(".osc-bump", { hasText: "Mentoria" }).click();
      await page.locator(".osc-opt", { hasText: "Sedex" }).click();
      await expect.poll(() => text(page, "[data-osc-total]")).toBe("R$ 303,80");
      expect(await text(page, "[data-osc-pay-amount]")).toBe("R$ 303,80");
      expect(
        (await page.locator("[data-osc-lines] li").allTextContents()).map((t) => t.replace(/\u00a0/g, " ")),
      ).toEqual([
        "SubtotalR$ 273,90",
        "Apostila de receitas (PDF)R$ 27,00",
        "Mentoria ao vivoR$ 49,90",
        "FreteR$ 29,90",
      ]);
      // Desmarcar um bump tira do total.
      await page.locator(".osc-bump", { hasText: "Mentoria" }).click();
      await expect.poll(() => text(page, "[data-osc-total]")).toBe("R$ 253,90");
      await shot(page, `${device}-4-bumps-marcados`);

      await page.locator("[data-osc-pay]").click();
      await expect.poll(() => page.locator("[data-osc-flow]").isVisible()).toBe(true);
      expect(await page.locator("[data-osc-form]").isVisible()).toBe(false);
      // O navegador manda só os ids (bump, frete) e os dados de quem compra; nada de preço. UTMs na metadata.
      const create = sent.find((b) => b.acao === "checkout_criar") as Record<string, unknown>;
      expect(create).toMatchObject({
        checkout: o.key,
        metodo: "pix",
        nome: "Maria da Silva",
        telefone: "11987654321",
        documento: "52998224725",
        bumps: ["bump0001"],
        frete: "sedex0001",
        endereco: { cep: "01310100", rua: "Avenida Paulista", numero: "1000", uf: "SP" },
        metadata: { utm_source: "facebook", utm_campaign: "lancamento" },
      });
      expect(Object.keys(create).sort()).toEqual([
        "acao",
        "bumps",
        "checkout",
        "documento",
        "email",
        "endereco",
        "frete",
        "metadata",
        "metodo",
        "nome",
        "quantidade",
        "telefone",
      ]);
      expect(await text(page, ".osc-amount")).toContain("R$ 253,90");
      const code = await page.locator(".osc-code input").inputValue();
      expect(code).toMatch(/^000201.*5406253\.90.*6304[0-9A-F]{4}$/);
      expect(await page.locator(".osc-qr svg path").count()).toBe(1);
      expect(await page.locator(".osc-exp b").textContent()).toMatch(/^(30:00|29:5\d)$/);
      expect(await page.locator(".osc-wait").textContent()).toBe("Aguardando o pagamento…");
      // Tela de PIX voltada para conversão: copiar é o botão principal (grande), com passo a passo
      // numerado e a garantia de que a liberação é automática (reduz o abandono "pago depois").
      expect(await page.locator(".osc-code .osc-copy-big[data-osc-copy]").isVisible()).toBe(true);
      expect(await page.locator(".osc-steps li").count()).toBe(3);
      expect(await page.locator(".osc-reassure").textContent()).toContain("Não precisa enviar comprovante");
      await shot(page, `${device}-5-pix-gerado`);

      // Recarregar com o PIX aberto volta para ele (e não conta outro InitiateCheckout).
      await page.reload();
      await expect.poll(() => page.locator(".osc-code input").inputValue()).toBe(code);
      expect(await page.locator("[data-osc-form]").isVisible()).toBe(false);
      // O resumo volta com o que foi escolhido (o bump e o Sedex).
      expect(await text(page, "[data-osc-total]")).toBe("R$ 253,90");

      await page.getByRole("button", { name: "Simular pagamento aprovado" }).click();
      await expect.poll(() => page.locator("[data-osc-flow] h2").textContent()).toBe("Pagamento aprovado!");
      await shot(page, `${device}-6-aprovado`);
      await page.waitForURL(new RegExp(`/p/${o.thanksId}$`), { timeout: 10_000 });
      await expect.poll(() => page.locator("[data-os-ac-go]").isVisible(), { timeout: 10_000 }).toBe(true);
      expect(await page.locator("[data-os-ac-go]").getAttribute("href")).toBe(PRODUCT_ACCESS);
      const extra = page.locator("[data-os-ac-extra]");
      expect(await extra.count()).toBe(1);
      expect(await extra.textContent()).toBe("Acessar “Apostila de receitas (PDF)”");
      expect(await extra.getAttribute("href")).toBe(BUMP_ACCESS);
      await shot(page, `${device}-7-obrigado`);

      // Eventos: InitiateCheckout (valor do produto) uma vez, AddPaymentInfo e Purchase (total) uma vez.
      await page.reload();
      await expect.poll(() => page.locator("[data-os-ac-go]").isVisible(), { timeout: 10_000 }).toBe(true);
      const events = await s.events();
      expect(events.map((e) => e.std)).toEqual(["INITIATE_CHECKOUT", "ADD_PAYMENT_INFO", "PURCHASE"]);
      expect(events[0]).toMatchObject({ value: 197, currency: "BRL" });
      expect(events[2]).toMatchObject({ value: 253.9, currency: "BRL" });
      expect(events[2].id).toMatch(/^os_checkout-principal-[a-z0-9]+_[a-z0-9]{20}$/);
      expect(events[2].x).toMatchObject({
        content_ids: [o.key, `${o.key}-bump0001`],
        num_items: 2,
        content_type: "product",
      });
      // Voltar ao checkout depois de pagar: formulário de novo, sem o PIX antigo nem outro InitiateCheckout.
      await page.goto(`${o.base}/checkout/${o.key}`);
      await expect.poll(() => page.locator("[data-osc-form]").isVisible()).toBe(true);
      expect((await s.events()).length).toBe(3);
      expect(s.outside).toEqual([]);
      expect(s.errors).toEqual([]);
      await s.close();
    }, 90_000);
  }

  it("quantidade muda o subtotal e o total; o frete só aparece depois do CEP", async () => {
    const o = await brlOffer();
    const s = await open(`${o.base}/checkout/${o.key}`);
    const { page } = s;
    const read = (sel: string) =>
      page.evaluate((x) => (document.querySelector(x)?.textContent ?? "").replace(/\u00a0/g, " "), sel);
    const shown = (sel: string) =>
      page.evaluate((x) => (document.querySelector(x) as HTMLElement | null)?.offsetParent != null, sel);
    await expect.poll(() => read("[data-osc-qtd]")).toBe("1");
    // Sem o CEP, o frete fica escondido e o aviso "Preencha seu CEP…" aparece.
    expect(await shown("[data-osc-ship-empty]")).toBe(true);
    expect(await shown("[data-osc-ship]")).toBe(false);
    expect(await read("[data-osc-subtotal]")).toBe("R$ 197,00");
    expect(await read("[data-osc-total]")).toBe("R$ 197,00");
    // "+" leva a 2 unidades: subtotal e total dobram.
    await page.locator('[data-osc-qty="+"]').click();
    await expect.poll(() => read("[data-osc-qtd]")).toBe("2");
    await expect.poll(() => read("[data-osc-subtotal]")).toBe("R$ 394,00");
    await expect.poll(() => read("[data-osc-total]")).toBe("R$ 394,00");
    // "-" volta para 1.
    await page.locator('[data-osc-qty="-"]').click();
    await expect.poll(() => read("[data-osc-qtd]")).toBe("1");
    // CEP preenchido: o frete aparece (e some o aviso).
    await page.locator("#osc-cep").pressSequentially("01310100");
    await expect.poll(() => shown("[data-osc-ship]")).toBe(true);
    expect(await shown("[data-osc-ship-empty]")).toBe(false);
    await shot(page, "quantidade-e-frete");
    expect(s.errors).toEqual([]);
    await s.close();
  }, 90_000);

  it("autocomplete de e-mail e ✓ de válido (menos fricção)", async () => {
    const o = await brlOffer();
    const s = await open(`${o.base}/checkout/${o.key}`);
    const { page } = s;
    const okClass = (sel: string) =>
      page.locator(sel).evaluate((el) => el.closest(".osc-f")?.classList.contains("osc-valid") ?? false);

    // Autocomplete: digita o começo do domínio e aparecem as sugestões.
    await page.locator("#osc-email").click();
    await page.locator("#osc-email").pressSequentially("maria@g");
    await expect.poll(() => page.locator(".osc-ac-i").first().textContent()).toBe("maria@gmail.com");
    await shot(page, "email-autocomplete");
    await page.locator(".osc-ac-i", { hasText: "maria@gmail.com" }).click();
    expect(await page.locator("#osc-email").inputValue()).toBe("maria@gmail.com");
    // A sugestão escolhida é um e-mail válido → ganha o ✓.
    await expect.poll(() => okClass("#osc-email")).toBe(true);

    // CPF válido ganha o ✓; inválido não.
    await page.locator("#osc-documento").pressSequentially("52998224725");
    await expect.poll(() => okClass("#osc-documento")).toBe(true);
    await page.locator("#osc-documento").fill("");
    await page.locator("#osc-documento").pressSequentially("11111111111");
    expect(await okClass("#osc-documento")).toBe(false);

    // Telefone válido ganha o ✓.
    await page.locator("#osc-telefone").pressSequentially("11987654321");
    await expect.poll(() => okClass("#osc-telefone")).toBe(true);
    await page.locator("#osc-nome").fill("Maria da Silva");
    await page.locator("#osc-documento").fill("");
    await page.locator("#osc-documento").pressSequentially("52998224725");
    await shot(page, "campos-validos");
    expect(s.errors).toEqual([]);
    await s.close();
  }, 60_000);

  it("PIX expirado → novo PIX; recusado → tentar de novo; CEP não encontrado deixa digitar", async () => {
    const o = await brlOffer();
    const s = await open(`${o.base}/checkout/${o.key}`);
    const { page } = s;
    await fillBuyer(page);
    await page.locator("#osc-cep").pressSequentially("99999999");
    await expect
      .poll(() => page.locator("[data-osc-cep-status]").textContent())
      .toBe("Não encontramos o CEP. Preencha o endereço.");
    for (const [id, value] of [
      ["#osc-rua", "Rua A"],
      ["#osc-numero", "10"],
      ["#osc-bairro", "Centro"],
      ["#osc-cidade", "Cidade"],
    ]) {
      await page.locator(id).fill(value);
    }
    await page.locator("#osc-uf").selectOption("MG");
    await page.locator("[data-osc-pay]").click();
    await expect.poll(() => page.locator(".osc-code input").isVisible()).toBe(true);
    const first = await page.locator(".osc-code input").inputValue();
    await page.getByRole("button", { name: "Simular PIX expirado" }).click();
    await expect.poll(() => page.locator("[data-osc-flow] h2").textContent()).toBe("O código PIX expirou.");
    await page.getByRole("button", { name: "Gerar novo PIX" }).click();
    await expect.poll(() => page.locator(".osc-code input").isVisible()).toBe(true);
    expect(await page.locator(".osc-code input").inputValue()).not.toBe(first);
    await page.getByRole("button", { name: "Simular pagamento recusado" }).click();
    await expect.poll(() => page.locator("[data-osc-flow] h2").textContent()).toBe("O pagamento não foi aprovado.");
    await page.getByRole("button", { name: "Alterar meus dados" }).click();
    await expect.poll(() => page.locator("[data-osc-form]").isVisible()).toBe(true);
    expect(await page.locator("#osc-nome").inputValue()).toBe("Maria da Silva");
    await page.locator("[data-osc-pay]").click();
    await expect.poll(() => page.locator(".osc-code input").isVisible()).toBe(true);
    expect(s.outside).toEqual([]);
    expect(s.errors).toEqual([]);
    await s.close();
  }, 60_000);
});

describe("página de checkout na prévia (Kyvo)", () => {
  it("peso mexicano: espanhol, SPEI simulado → aprovado → acesso; cartão recusado → outro cartão", async () => {
    const o = await mxnOffer();
    const s = await open(`${o.base}/checkout/${o.key}`, true);
    const { page } = s;
    expect(await page.locator("html").getAttribute("lang")).toBe("es");
    expect(await page.locator("#osc-telefone").count()).toBe(0);
    await page.locator("[data-osc-pay]").click();
    await expect.poll(() => page.locator("#osc-nome-e").textContent()).toBe("Completa este campo.");
    await page.locator("#osc-nome").fill("María López");
    await page.locator("#osc-email").fill("maria@ejemplo.mx");
    await page.locator(".osc-method", { hasText: "Tarjeta" }).click();
    await page.locator("[data-osc-pay]").click();
    await expect.poll(() => page.locator(".osc-cardbox .osc-sim").isVisible()).toBe(true);
    await page.getByRole("button", { name: "Simular pagamento recusado" }).click();
    await expect.poll(() => page.locator("[data-osc-flow] h2").textContent()).toBe("Pago no aprobado");
    await page.getByRole("button", { name: "Intentar con otra tarjeta" }).click();
    await expect.poll(() => page.locator(".osc-cardbox .osc-sim").isVisible()).toBe(true);
    await page.getByRole("button", { name: "Cambiar forma de pago" }).first().click();
    await page.locator(".osc-method", { hasText: "SPEI" }).click();
    await page.locator("[data-osc-pay]").click();
    await expect.poll(() => page.locator(".osc-rows").isVisible()).toBe(true);
    expect(await page.locator(".osc-r dd").nth(2).textContent()).toContain("SIMULACIÓN");
    await shot(page, "celular-kyvo-spei");
    await page.getByRole("button", { name: "Simular pagamento aprovado" }).click();
    await page.waitForURL(new RegExp(`/p/${o.thanksId}$`), { timeout: 10_000 });
    await expect.poll(() => page.locator("[data-os-ac-go]").isVisible(), { timeout: 10_000 }).toBe(true);
    expect(await page.locator("[data-os-ac-go]").getAttribute("href")).toBe(PRODUCT_ACCESS);
    expect(await page.locator("[data-os-ac-extra]").count()).toBe(0);
    const events = await s.events();
    expect(events.map((e) => e.std)).toEqual([
      "INITIATE_CHECKOUT",
      "ADD_PAYMENT_INFO",
      "ADD_PAYMENT_INFO",
      "ADD_PAYMENT_INFO",
      "PURCHASE",
    ]);
    expect(events[4]).toMatchObject({ value: 497, currency: "MXN" });
    expect(s.outside).toEqual([]);
    expect(s.errors).toEqual([]);
    await s.close();
  }, 60_000);

  it("peso mexicano com produto físico: endereço genérico (sem busca de CEP) e frete depois do código postal", async () => {
    const o = await mxnAddressOffer();
    const s = await open(`${o.base}/checkout/${o.key}`, true);
    const { page } = s;
    const sent: Record<string, unknown>[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().endsWith("/__os/pagamento")) sent.push(r.postDataJSON());
    });
    await expect.poll(() => page.locator("[data-osc-form]").isVisible(), { timeout: 20_000 }).toBe(true);
    // O estado é texto livre (não a lista de UF do Brasil) e os campos de endereço já aparecem.
    expect(await page.locator("#osc-uf").evaluate((el) => el.tagName)).toBe("INPUT");
    expect(await page.locator("[data-osc-addr]").isVisible()).toBe(true);
    // Sem o código postal, o frete fica escondido (o aviso "preencha o código postal" aparece).
    expect(await page.locator("[data-osc-ship-empty]").isVisible()).toBe(true);
    expect(await page.locator("[data-osc-ship]").isVisible()).toBe(false);
    // Código postal de 5 dígitos do México revela o frete (sem chamar a BrasilAPI).
    await page.locator("#osc-cep").fill("06600");
    await page.locator("#osc-cep").dispatchEvent("input");
    await expect.poll(() => page.locator("[data-osc-ship]").isVisible()).toBe(true);
    expect(await page.locator("[data-osc-ship-empty]").isVisible()).toBe(false);
    // Produto + frete no total ($497.00 + $99.00 na página em peso).
    await expect.poll(() => text(page, "[data-osc-total]")).toBe("$596.00");
    await page.locator("#osc-nome").fill("María López");
    await page.locator("#osc-email").fill("maria@ejemplo.mx");
    await page.locator("#osc-rua").fill("Av. Reforma");
    await page.locator("#osc-numero").fill("222");
    await page.locator("#osc-bairro").fill("Juárez");
    await page.locator("#osc-cidade").fill("Ciudad de México");
    await page.locator("#osc-uf").fill("CDMX");
    await page.locator(".osc-method", { hasText: "SPEI" }).click();
    await shot(page, "celular-kyvo-endereco");
    await page.locator("[data-osc-pay]").click();
    await expect.poll(() => page.locator(".osc-rows").isVisible(), { timeout: 20_000 }).toBe(true);
    // A página manda o endereço genérico e o frete (o total é calculado no servidor).
    const create = sent.find((b) => b.acao === "checkout_criar") as Record<string, unknown>;
    expect(create).toMatchObject({
      checkout: o.key,
      metodo: "spei",
      nome: "María López",
      frete: "envio0001",
      endereco: {
        cep: "06600",
        rua: "Av. Reforma",
        numero: "222",
        bairro: "Juárez",
        cidade: "Ciudad de México",
        uf: "CDMX",
      },
    });
    // Nenhuma busca de CEP fora do Brasil.
    expect(s.cepCalls).toEqual([]);
    expect(s.errors).toEqual([]);
    await s.close();
  }, 60_000);
});

describe("upsell: o checkout seguinte abre pré-preenchido", () => {
  it("comprou no principal → o checkout do upsell já vem com nome, e-mail, telefone, CPF e endereço", async () => {
    const o = await brlOffer();
    // Segundo checkout (o do upsell) na MESMA oferta → mesmo endpoint → mesmo stash do comprador.
    const up = await createOfferLink(o.offerId, { label: "Upsell E-book", url: "", kind: "CHECKOUT" });
    await saveCheckoutProduct(up.id, {
      name: "E-book bônus",
      amount: "47,00",
      provider: "FLEVOPAY",
      methods: ["PIX"],
      locale: "PT",
      thankYouPageId: o.thanksId,
      accessUrl: "",
      config: {
        ...checkoutConfigDraft(parseCheckoutConfig({})),
        address: true,
        shipping: [{ id: "frete001", name: "Correios PAC", eta: "5 a 9 dias úteis", price: "" }],
        shippingDefault: "frete001",
      },
    });

    const s = await open(`${o.base}/checkout/${o.key}`);
    const { page } = s;
    // Compra o principal: preenche tudo e gera o PIX (ao gerar, os dados ficam guardados nesta aba).
    await fillBuyer(page);
    await fillAddress(page);
    await page.locator("[data-osc-pay]").click();
    await expect.poll(() => page.locator(".osc-code input").isVisible()).toBe(true);

    // Vai para o checkout do upsell (mesma aba): já abre com os dados dela.
    await page.goto(`${o.base}/checkout/${up.key}`);
    await expect.poll(() => page.locator("#osc-nome").inputValue()).toBe("Maria da Silva");
    expect(await page.locator("#osc-email").inputValue()).toBe("maria@exemplo.com");
    expect(await page.locator("#osc-telefone").inputValue()).toBe("(11) 98765-4321");
    expect(await page.locator("#osc-documento").inputValue()).toBe("529.982.247-25");
    // O endereço veio junto e já aparece (sem precisar digitar o CEP de novo nem chamar a BrasilAPI).
    expect(await page.locator("#osc-rua").isVisible()).toBe(true);
    expect(await page.locator("#osc-cep").inputValue()).toBe("01310-100");
    expect(await page.locator("#osc-rua").inputValue()).toBe("Avenida Paulista");
    expect(await page.locator("#osc-numero").inputValue()).toBe("1000");
    expect(await page.locator("#osc-uf").inputValue()).toBe("SP");
    // Só a busca de CEP do 1º checkout (A); o do upsell (B) não faz nova busca — o endereço já veio preenchido.
    expect(s.cepCalls).toEqual(["/api/cep/v2/01310100"]);
    expect(s.errors).toEqual([]);
    await s.close();
  }, 90_000);
});

describe("funil de upsell de ponta a ponta na prévia", () => {
  it("paga o principal → cai na página de upsell → SIM abre o checkout (preenchido) → paga → obrigado", async () => {
    const o = await brlOffer();
    // Produto do upsell (2ª cobrança) e a página-modelo de upsell (botões SIM/Não prontos).
    const up = await createOfferLink(o.offerId, { label: "Upsell E-book", url: "", kind: "CHECKOUT" });
    await saveCheckoutProduct(up.id, {
      name: "E-book bônus",
      amount: "47,00",
      provider: "FLEVOPAY",
      methods: ["PIX"],
      locale: "PT",
      thankYouPageId: o.thanksId,
      accessUrl: "",
      config: { ...checkoutConfigDraft(parseCheckoutConfig({})) },
    });
    const upPage = await createUpsellPage(o.offerId, "UPSELL");
    // Liga tudo: principal → página de upsell; SIM → checkout do upsell; Não/fim → obrigado.
    await saveUpsellFlow(o.offerId, {
      startLinkKey: o.key,
      thankYouPageId: o.thanksId,
      steps: [{ id: "s1", kind: "UPSELL", pageId: upPage.id, linkKey: up.key }],
    });

    const s = await open(`${o.base}/checkout/${o.key}`);
    const { page } = s;
    // Compra o principal.
    await fillBuyer(page);
    await fillAddress(page);
    await page.locator("[data-osc-pay]").click();
    await expect.poll(() => page.locator(".osc-code input").isVisible()).toBe(true);
    await page.getByRole("button", { name: "Simular pagamento aprovado" }).click();
    // Pago → vai para a PÁGINA DE UPSELL (o obrigado do produto principal virou a 1ª etapa).
    await page.waitForURL(new RegExp(`/p/${upPage.id}`), { timeout: 10_000 });
    const sim = page.locator("a.os-btn[data-os-link]").first();
    await expect.poll(() => sim.isVisible()).toBe(true);
    // O botão SIM leva ao checkout do upsell; o "Não" (os-decline) leva ao obrigado.
    expect(await sim.getAttribute("href")).toBe(`/checkout/${up.key}`);
    expect(await page.locator("a.os-decline").first().getAttribute("href")).toBe(`/p/${o.thanksId}`);

    // Aceita o upsell: o checkout já abre com os dados de quem acabou de comprar.
    // (force: o botão SIM pulsa — animação os-pulse —, o que o Playwright vê como "instável".)
    await sim.click({ force: true });
    await page.waitForURL(new RegExp(`/checkout/${up.key}`));
    await expect.poll(() => page.locator("#osc-nome").inputValue()).toBe("Maria da Silva");
    expect(await page.locator("#osc-email").inputValue()).toBe("maria@exemplo.com");
    await expect.poll(() => text(page, "[data-osc-total]")).toBe("R$ 47,00");
    // Paga o upsell → obrigado.
    await page.locator("[data-osc-pay]").click();
    await expect.poll(() => page.locator(".osc-code input").isVisible()).toBe(true);
    await page.getByRole("button", { name: "Simular pagamento aprovado" }).click();
    await page.waitForURL(new RegExp(`/p/${o.thanksId}`), { timeout: 10_000 });

    // Duas compras distintas (principal e upsell), cada uma com seu Purchase.
    const events = await s.events();
    const purchases = events.filter((e) => e.std === "PURCHASE");
    expect(purchases.map((e) => e.value)).toEqual([197, 47]);
    expect(s.errors).toEqual([]);
    await s.close();
  }, 120_000);
});

describe("prévia com pagamento real (chave do gateway salva)", () => {
  it("FlevoPay: PIX de verdade, sem botões de simular, pago → página de obrigado", async () => {
    const o = await brlOffer();
    await savePaymentGatewayKey(o.offerId, "FLEVOPAY", FLEVO_KEY);
    const s = await open(`${o.base}/checkout/${o.key}`);
    const { page } = s;
    await expect.poll(() => text(page, "[data-osc-total]")).toBe("R$ 197,00");
    await fillBuyer(page);
    await fillAddress(page);
    await page.locator("[data-osc-pay]").click();
    await expect.poll(() => page.locator("[data-osc-flow]").isVisible()).toBe(true);
    // O PIX é o de verdade do gateway (não o de exemplo da simulação).
    await expect.poll(() => page.locator(".osc-code input").inputValue()).toBe(FAKE_PIX_CODE);
    // Nada de botões de simular; e o aviso de pagamento REAL para você.
    expect(await page.getByRole("button", { name: "Simular pagamento aprovado" }).count()).toBe(0);
    expect(await text(page, "[data-osc-flow] .osc-sim")).toContain("pagamento REAL");
    await shot(page, "computador-real-pix");

    // Pago no banco (gateway falso) → a prévia confirma pela API e vai ao obrigado.
    const gid = [...flevo.transactions.keys()].sort((a, b) => Number(b) - Number(a))[0];
    expect(gid).toBeTruthy();
    flevo.setStatus(gid, "approved");
    await expect
      .poll(() => page.locator("[data-osc-flow] h2").textContent(), { timeout: 10_000 })
      .toBe("Pagamento aprovado!");
    await page.waitForURL(new RegExp(`/p/${o.thanksId}$`), { timeout: 10_000 });
    await expect.poll(() => page.locator("[data-os-ac-go]").isVisible(), { timeout: 10_000 }).toBe(true);
    expect(await page.locator("[data-os-ac-go]").getAttribute("href")).toBe(PRODUCT_ACCESS);
    expect(s.errors).toEqual([]);
    await s.close();
  }, 60_000);
});
