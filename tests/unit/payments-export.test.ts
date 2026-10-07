/**
 * Pagamento na página no ZIP (Etapa 3), com o banco de testes:
 *
 * - oferta sem pagamento: nada de pagamento.php nem do script da janela;
 * - oferta pronta: pagamento.php + pagamento-dados/config.php (chave e
 *   produtos) + .htaccess da pasta; o script da janela em assets/; cada página
 *   com o #os-pagamento apontando para o pagamento.php e para a página de
 *   obrigado com caminhos relativos à pasta dela; a chave e o link de acesso
 *   SÓ no config.php (nem nas páginas, nem no LEIA-ME, nem no script); avisos
 *   e LEIA-ME com PHP/HTTPS e o teste com valor baixo;
 * - o que falta (chave, página de obrigado, link de acesso, bloco "Acesso ao
 *   produto", regra de Purchase repetida, chave ilegível) vira aviso do ZIP com
 *   conserto e passo do "Próximos passos".
 * - Com PHP de verdade (OS_PHP_BIN, ver export-php.test.ts) e a Kyvo FALSA: o
 *   ZIP descompactado numa SUBPASTA e servido pelo `php -S`; um Chromium compra
 *   por SPEI e por cartão (SDK da Kyvo trocado por um falso) e chega à página
 *   de obrigado com o acesso — nada sai para a internet.
 */
import type { ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Engine as PhpParser } from "php-parser";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ACCESS_CSS, accessDef } from "@/editor/widgets/access-content";
import { defToHtml } from "@/editor/widgets/quiz-content";
import { prisma } from "@/lib/db";
import { PAGAMENTO_CONFIG_FILE, PAGAMENTO_FILE, PAGAMENTO_HTACCESS_FILE } from "@/lib/export/payment-php";
import { exportWarningFix, PAYMENT_HOSTING_WARNING } from "@/lib/export/warnings";
import { PAYMENT_CONFIG_ID, type PaymentPageConfig } from "@/lib/payments/contract";
import { computeReadiness } from "@/lib/readiness";
import { buildExport } from "@/server/services/export/build";
import { exportPlan, parseExportOptions } from "@/server/services/export/plan";
import { createOfferLink, listOfferLinks } from "@/server/services/offer-links";
import { createOffer } from "@/server/services/offers";
import { createPage } from "@/server/services/pages";
import { offerPaymentCheck } from "@/server/services/payments/checks";
import { savePaymentGatewayKey } from "@/server/services/payments/gateways";
import { savePaymentProduct } from "@/server/services/payments/products";
import { getOfferReadiness } from "@/server/services/readiness";
import { createEventRule } from "@/server/services/tracking";
import { resetDatabase } from "../setup/per-file";
import { readZip } from "./export-fixture";
import { type FakeKyvo, KYVO_KEY, startFakeKyvo } from "./kyvo-fake";
import { findPhp, instrumentPagamento, startPhp } from "./php-server";

const parser = new PhpParser({ parser: { version: "7.4", extractDoc: false }, ast: { withPositions: false } });
const PHP = findPhp();

const SALES =
  '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Oferta</title></head><body><h1>Curso</h1><a id="comprar" data-os-link="checkout-principal" href="https://pay.hotmart.com/ANTIGO" style="display:inline-block;padding:16px;background:#db2777;color:#fff">Comprar</a></body></html>';
const THANKS = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Obrigado</title><style>${ACCESS_CSS}</style></head><body>${defToHtml(accessDef("es"))}</body></html>`;
const THANKS_NO_BLOCK =
  '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Obrigado</title></head><body><h1>Gracias</h1></body></html>';
const ACCESS_URL = "https://membros.exemplo.com/reposteria?token=segredo";

let tmp = "";

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "os-pagamento-zip-"));
});

afterAll(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
  await resetDatabase();
});

beforeEach(async () => {
  await resetDatabase();
});

interface Setup {
  key?: boolean;
  thanks?: boolean;
  access?: string;
  block?: boolean;
}

async function paymentOffer(opts: Setup = {}) {
  const { key = true, thanks = true, access = ACCESS_URL, block = true } = opts;
  const offer = await createOffer({ name: "Oferta" });
  const home = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id, isHome: true } });
  const thanksPage = await createPage({ offerId: offer.id, name: "Obrigado", type: "THANK_YOU" });
  await prisma.pageDocument.updateMany({ where: { variant: { pageId: home.id } }, data: { html: SALES } });
  await prisma.pageDocument.updateMany({
    where: { variant: { pageId: thanksPage.id } },
    data: { html: block ? THANKS : THANKS_NO_BLOCK },
  });
  const link = await createOfferLink(offer.id, { label: "Checkout principal", url: "", kind: "CHECKOUT" });
  // A chave fica na tabela do gateway: entre testes, o resetDatabase limpa.
  if (key) await savePaymentGatewayKey("KYVO", KYVO_KEY);
  await savePaymentProduct(link.id, {
    name: "Curso de Repostería",
    amount: "497",
    currency: "MXN",
    methods: ["SPEI", "CARD"],
    locale: "ES",
    thankYouPageId: thanks ? thanksPage.id : null,
    accessUrl: access,
  });
  return { offerId: offer.id, homeId: home.id, thanksId: thanksPage.id, linkId: link.id };
}

async function zip(offerId: string, name = "oferta.zip") {
  const target = path.join(tmp, `${Date.now()}-${name}`);
  const result = await buildExport({ offerId, options: parseExportOptions({}), target });
  const entries = await readZip(target);
  const text = (p: string) => entries.get(p)?.data.toString("utf8") ?? "";
  return { result, entries, text, target };
}

function pageConfig(html: string): PaymentPageConfig {
  const m = new RegExp(`<script type="application/json" id="${PAYMENT_CONFIG_ID}">([\\s\\S]*?)</script>`).exec(html);
  expect(m, "página sem #os-pagamento").not.toBeNull();
  return JSON.parse((m as RegExpExecArray)[1].replace(/\\u003c/g, "<"));
}

describe("pagamento na página no ZIP", () => {
  it("oferta sem pagamento: sem pagamento.php nem script da janela", async () => {
    const offer = await createOffer({ name: "Sem pagamento" });
    const plan = await exportPlan(offer.id);
    expect(plan.hasPayments).toBeUndefined();
    expect(plan.tree.some((t) => t.path === PAGAMENTO_FILE)).toBe(false);
    expect(plan.warnings).not.toContain(PAYMENT_HOSTING_WARNING);
    const { result } = await zip(offer.id);
    expect(result.entries.some((e) => e.startsWith("pagamento"))).toBe(false);
    expect(result.entries.some((e) => /os-pagamento-/.test(e))).toBe(false);
  });

  it("oferta pronta: arquivos, caminhos relativos e segredos só no config.php", async () => {
    const o = await paymentOffer();
    const plan = await exportPlan(o.offerId);
    expect(plan.hasPayments).toBe(true);
    expect(plan.paymentLinks).toBeUndefined();
    expect(plan.accessBlockPages).toBeUndefined();
    expect(plan.warnings).toContain(PAYMENT_HOSTING_WARNING);
    expect(plan.warnings.filter((w) => /pagamento|Kyvo|Purchase/i.test(w))).toEqual([PAYMENT_HOSTING_WARNING]);
    const paths = plan.tree.map((t) => t.path);
    expect(paths).toEqual(expect.arrayContaining([PAGAMENTO_FILE, PAGAMENTO_CONFIG_FILE, PAGAMENTO_HTACCESS_FILE]));
    expect(plan.tree.find((t) => t.path === PAGAMENTO_FILE)?.label).toMatch(/PHP e HTTPS/);

    const { result, entries, text } = await zip(o.offerId);
    expect(result.warnings).toContain(PAYMENT_HOSTING_WARNING);
    for (const p of [PAGAMENTO_FILE, PAGAMENTO_CONFIG_FILE, PAGAMENTO_HTACCESS_FILE]) expect(entries.has(p)).toBe(true);
    // Nada de .htaccess na raiz (substituiria o da hospedagem).
    expect(entries.has(".htaccess")).toBe(false);
    const script = [...entries.keys()].find((e) => /^assets\/os-pagamento-[0-9a-f]{12}\.js$/.test(e));
    expect(script).toBeDefined();

    expect(() => parser.parseCode(text(PAGAMENTO_FILE), "pagamento.php")).not.toThrow();
    const config = text(PAGAMENTO_CONFIG_FILE);
    expect(() => parser.parseCode(config, "config.php")).not.toThrow();
    expect(config).toContain(`'chave' => '${KYVO_KEY}',`);
    expect(config).toContain(`'acesso' => '${ACCESS_URL}',`);
    expect(config).toContain("'checkout-principal' => array(");
    expect(config).toContain("'valor' => 49700,");
    expect(config).toContain("'moeda' => 'MXN',");
    expect(config).toContain("'metodos' => array('spei', 'card'),");
    expect(config).toContain("'obrigado' => 'obrigado/',");

    // Segredos: a chave e o link de acesso só no config.php.
    for (const [name, item] of entries) {
      if (name === PAGAMENTO_CONFIG_FILE) continue;
      const body = item.data.toString("utf8");
      expect(body.includes(KYVO_KEY), name).toBe(false);
      expect(body.includes("membros.exemplo.com"), name).toBe(false);
    }

    // Página inicial (raiz): pagamento.php e obrigado/ relativos; o botão abre a janela.
    const home = text("index.html");
    const cfg = pageConfig(home);
    expect(cfg).toEqual({
      v: 1,
      endpoint: "pagamento.php",
      simulacao: false,
      produtos: {
        "checkout-principal": {
          nome: "Curso de Repostería",
          valor: 49700,
          moeda: "MXN",
          metodos: ["spei", "card"],
          idioma: "es",
          obrigado: "obrigado/",
        },
      },
    });
    expect(home).toContain(`<script src="${script}" data-os-pay-script></script>`);
    expect(home).toMatch(/<a id="comprar"[^>]*data-os-pay="checkout-principal"/);
    expect(home).not.toContain("pay.hotmart.com/ANTIGO");
    // Página de obrigado (subpasta): ../pagamento.php e o bloco de acesso sem o link.
    const thanks = text("obrigado/index.html");
    expect(pageConfig(thanks).endpoint).toBe("../pagamento.php");
    expect(pageConfig(thanks).produtos["checkout-principal"].obrigado).toBe("./");
    expect(thanks).toContain(`<script src="../${script}" data-os-pay-script></script>`);
    expect(thanks).toContain('data-os-widget="access"');

    const readme = text("LEIA-ME.txt");
    expect(readme).toContain("PAGAMENTO NA PÁGINA (pagamento.php)");
    expect(readme).toContain("Produtos: Curso de Repostería (MX$ 497,00 · SPEI e Cartão).");
    expect(readme).toContain("PHP 7.4 OU MAIS NOVO, COM cURL, E O SITE EM");
    expect(readme).toContain("com um valor baixo");
    expect(readme).toContain("painel da Kyvo, na lista de transações");
    expect(readme).toContain("conecte a UTMify e os pixels");
    expect(readme).toContain("pagamento-dados/config.php  →  chave da Kyvo e produtos (NÃO compartilhe)");

    // "Próximos passos": pronto.
    const links = await listOfferLinks(o.offerId);
    const readiness = await getOfferReadiness({ id: o.offerId, liveUrl: null, links });
    expect(readiness.items.find((i) => i.id === "pagamento")).toMatchObject({
      title: "Pagamento na página pronto",
      done: true,
    });
  });

  it("o que falta vira aviso com conserto e passo do “Próximos passos”", async () => {
    const o = await paymentOffer({ key: false, thanks: false, access: "" });
    const plan = await exportPlan(o.offerId);
    const keyWarning = plan.warnings.find((w) => w.includes("ainda não tem a chave da Kyvo"));
    expect(keyWarning).toBeDefined();
    expect(exportWarningFix(keyWarning as string)).toEqual({ kind: "paymentKey" });
    const linkWarning = plan.warnings.find((w) => w.startsWith("O link “Checkout principal”"));
    expect(linkWarning).toContain("está sem página de obrigado e sem link de acesso");
    expect(linkWarning).toContain("o pagamento.php não cobra esse produto");
    expect(exportWarningFix(linkWarning as string)).toEqual({ kind: "paymentLink" });
    expect(plan.paymentLinks).toEqual([{ linkId: o.linkId, label: "Checkout principal" }]);

    let check = await offerPaymentCheck(o.offerId);
    let r = computeReadiness(
      {
        htmls: [SALES],
        links: [{ key: "checkout-principal", url: "", kind: "CHECKOUT", pay: true }],
        clonedCheckoutUrls: [],
        pixelCount: 0,
        company: { name: "", document: "", email: "", phone: "", address: "" },
        liveUrl: null,
        lastZipAt: null,
        payments: check,
      },
      () => "",
    );
    expect(r.items.find((i) => i.id === "pagamento")).toMatchObject({
      title: "Cadastrar a chave da Kyvo",
      detail:
        "O pagamento na página precisa da chave da API da Kyvo para cobrar no site publicado. Depois, falta mais 1 ajuste no pagamento.",
      done: false,
      optional: false,
      cta: "Abrir Configurações",
      target: { settings: "pagamentos" },
    });

    // O ZIP sai mesmo assim, com a chave vazia (o pagamento.php responde "configuracao").
    const { result, text } = await zip(o.offerId);
    expect(text(PAGAMENTO_CONFIG_FILE)).toContain("'chave' => '',");
    expect(text(PAGAMENTO_CONFIG_FILE)).toContain("'obrigado' => null,");
    expect(result.warnings).toContain(keyWarning);
    expect(text("LEIA-ME.txt")).toContain("ainda não tem a chave da Kyvo");

    await savePaymentGatewayKey("KYVO", KYVO_KEY);
    check = await offerPaymentCheck(o.offerId);
    r = computeReadiness(
      {
        htmls: [SALES],
        links: [{ key: "checkout-principal", url: "", kind: "CHECKOUT", pay: true }],
        clonedCheckoutUrls: [],
        pixelCount: 0,
        company: { name: "", document: "", email: "", phone: "", address: "" },
        liveUrl: null,
        lastZipAt: null,
        payments: check,
      },
      () => "",
    );
    expect(r.items.find((i) => i.id === "pagamento")).toMatchObject({
      title: "Completar o pagamento de “Checkout principal”",
      detail: "Falta a página de obrigado e o link de acesso: sem eles, quem pagar não recebe o acesso ao produto.",
      cta: "Abrir o link",
      target: { link: o.linkId },
    });
  });

  it("página de obrigado sem o bloco de acesso, regra de Purchase repetida e chave ilegível", async () => {
    const o = await paymentOffer({ block: false });
    await createEventRule(o.offerId, { event: "PURCHASE", trigger: "PAGE_LOAD", pageId: o.thanksId });
    const plan = await exportPlan(o.offerId);
    const block = plan.warnings.find((w) => w.startsWith("A página de obrigado “Obrigado”"));
    expect(block).toContain("não tem o bloco “Acesso ao produto”");
    expect(exportWarningFix(block as string)).toEqual({ kind: "accessBlock" });
    const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId: o.thanksId } } });
    expect(plan.accessBlockPages).toEqual([{ name: "Obrigado", documentId: doc.id }]);
    const rule = plan.warnings.find((w) => w.includes("regra de evento Purchase"));
    expect(rule).toContain("na página “Obrigado”");
    expect(exportWarningFix(rule as string)).toEqual({ kind: "purchaseRule" });

    const links = await listOfferLinks(o.offerId);
    const readiness = await getOfferReadiness({ id: o.offerId, liveUrl: null, links });
    expect(readiness.items.find((i) => i.id === "pagamento")).toMatchObject({
      title: "Pôr o acesso na página de obrigado",
      cta: "Abrir no editor",
      target: { editor: doc.id },
    });

    // Chave salva com outra APP_ENCRYPTION_KEY (backup de outro Mac sem a chave): ilegível.
    await prisma.paymentGateway.update({ where: { provider: "KYVO" }, data: { apiKeyEnc: "v1:lixo:lixo:lixo" } });
    const again = await exportPlan(o.offerId);
    const unreadable = again.warnings.find((w) => w.includes("não pôde ser lida"));
    expect(unreadable).toBeDefined();
    expect(exportWarningFix(unreadable as string)).toEqual({ kind: "paymentKey" });
    const { text } = await zip(o.offerId);
    expect(text(PAGAMENTO_CONFIG_FILE)).toContain("'chave' => '',");
  });
});

describe("idioma do bloco de acesso", () => {
  it("produto em outro idioma que o bloco da página de obrigado: aviso no ZIP e passo com “Abrir no editor”", async () => {
    const o = await paymentOffer();
    const links = await listOfferLinks(o.offerId);
    const step = async () =>
      (await getOfferReadiness({ id: o.offerId, liveUrl: null, links })).items.find((i) => i.id === "pagamento");
    expect(await step()).toMatchObject({ title: "Pagamento na página pronto", done: true });
    // O bloco nasceu em Español; o produto passa a ser em Português.
    await prisma.paymentProduct.update({ where: { linkId: o.linkId }, data: { locale: "PT" } });
    const plan = await exportPlan(o.offerId);
    const warning = plan.warnings.find((w) => w.includes("está em Español"));
    expect(warning).toContain("“Checkout principal” (Português)");
    expect(exportWarningFix(warning as string)).toEqual({ kind: "accessBlock" });
    const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId: o.thanksId } } });
    expect(plan.accessBlockPages).toEqual([{ name: "Obrigado", documentId: doc.id }]);
    expect(await step()).toMatchObject({
      title: "Ajustar o idioma do acesso",
      done: false,
      cta: "Abrir no editor",
      target: { editor: doc.id },
    });
  });
});

describe("chave recusada no “Testar conexão”", () => {
  it("recusada ou sem transactions:read: aviso no ZIP, passo não fica pronto; trocar a chave resolve", async () => {
    const o = await paymentOffer();
    const links = await listOfferLinks(o.offerId);
    const step = async () =>
      (await getOfferReadiness({ id: o.offerId, liveUrl: null, links })).items.find((i) => i.id === "pagamento");
    expect(await step()).toMatchObject({ title: "Pagamento na página pronto", done: true });

    await prisma.paymentGateway.update({ where: { provider: "KYVO" }, data: { checkStatus: "invalid_key" } });
    let plan = await exportPlan(o.offerId);
    const rejected = plan.warnings.find((w) => w.includes("recusou a chave"));
    expect(rejected).toBeDefined();
    expect(exportWarningFix(rejected as string)).toEqual({ kind: "paymentKey" });
    expect(await step()).toMatchObject({
      title: "Trocar a chave da Kyvo",
      done: false,
      cta: "Abrir Configurações",
      target: { settings: "pagamentos" },
    });
    // Não vai uma chave recusada para o site: o pagamento.php responde "configuracao" em vez de cobrar.
    const { text } = await zip(o.offerId);
    expect(text(PAGAMENTO_CONFIG_FILE)).toContain("'chave' => '',");

    await prisma.paymentGateway.update({ where: { provider: "KYVO" }, data: { checkStatus: "missing_scope" } });
    plan = await exportPlan(o.offerId);
    const scope = plan.warnings.find((w) => w.includes("transactions:read"));
    expect(scope).toBeDefined();
    expect(exportWarningFix(scope as string)).toEqual({ kind: "paymentKey" });
    expect(await step()).toMatchObject({ title: "Trocar a chave da Kyvo", done: false });

    // Passageiros (sem conexão, Kyvo fora do ar) não bloqueiam.
    await prisma.paymentGateway.update({ where: { provider: "KYVO" }, data: { checkStatus: "offline" } });
    expect(await step()).toMatchObject({ title: "Pagamento na página pronto", done: true });

    await prisma.paymentGateway.update({ where: { provider: "KYVO" }, data: { checkStatus: "invalid_key" } });
    // Chave nova: o resultado do teste antigo deixa de valer.
    await savePaymentGatewayKey("KYVO", `${KYVO_KEY}x`);
    expect(await step()).toMatchObject({ title: "Pagamento na página pronto", done: true });
    expect((await exportPlan(o.offerId)).warnings.some((w) => w.includes("recusou a chave"))).toBe(false);
  });
});

// ── De ponta a ponta: ZIP numa subpasta, PHP de verdade, Kyvo falsa ─────────

const FAKE_SDK = `(function(){
  window.KyvoCard = { mount: function (o) {
    window.__kyvoSession = o.session;
    o.container.innerHTML = '<div class="fake-sdk"><button type="button" id="sdk-pay">Pagar com cartão</button></div>';
    o.container.querySelector('#sdk-pay').onclick = function () { o.onSuccess({ status: 'processing' }); };
    return { unmount: function () {} };
  } };
})();`;

describe.skipIf(!PHP)("ZIP publicado numa subpasta (PHP de verdade + Kyvo falsa)", () => {
  let kyvo: FakeKyvo;
  let site = "";
  let server: ChildProcess | null = null;
  let browser: Browser;
  let base = "";

  beforeAll(async () => {
    await resetDatabase();
    kyvo = await startFakeKyvo();
    const o = await paymentOffer();
    const { entries } = await zip(o.offerId, "publicado.zip");
    site = await mkdtemp(path.join(os.tmpdir(), "os-pagamento-site-"));
    for (const [name, item] of entries) {
      const target = path.join(site, "loja", name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, item.data);
    }
    const php = path.join(site, "loja", PAGAMENTO_FILE);
    await writeFile(php, instrumentPagamento(await readFile(php, "utf8"), kyvo.base));
    let origin = "";
    ({ server, origin } = await startPhp(PHP as string, site, `/loja/${PAGAMENTO_FILE}`));
    base = `${origin}/loja/`;
    browser = await chromium.launch();
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    server?.kill();
    await kyvo?.close();
    if (site) await rm(site, { recursive: true, force: true });
  });

  async function open(url: string) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const outside: string[] = [];
    await page.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === "127.0.0.1") return route.continue();
      if (u.href === "https://kyvopay.com/sdk/card.js?v=1") {
        return route.fulfill({ status: 200, contentType: "text/javascript", body: FAKE_SDK });
      }
      outside.push(u.href);
      return route.fulfill({ status: 204, body: "" });
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(url);
    return { page, outside, errors, close: () => context.close() };
  }

  async function fill(page: Page) {
    await page.locator("input[name=nome]").fill("María López");
    await page.locator("input[name=email]").fill("maria@ejemplo.mx");
  }

  it("SPEI: CLABE da Kyvo → pago → página de obrigado com o acesso", async () => {
    const s = await open(`${base}?utm_source=facebook&utm_campaign=lancamento`);
    const { page } = s;
    await page.locator("#comprar").click();
    await expect.poll(() => page.getByRole("dialog").isVisible()).toBe(true);
    expect(await page.locator(".os-pw-sim").count()).toBe(0);
    await fill(page);
    await page.getByRole("button", { name: "Generar datos de transferencia" }).click();
    await expect.poll(() => page.locator(".os-pw-rows").isVisible(), { timeout: 20_000 }).toBe(true);
    expect((await page.locator(".os-pw-rows").textContent())?.replace(/\s/g, "")).toContain("646180157000000004");

    const charge = [...kyvo.requests].reverse().find((r) => r.method === "POST");
    const body = charge?.body as Record<string, Record<string, string>>;
    expect(charge?.path).toBe("/api/v1/spei/charges");
    expect(body.amount).toBe(49700);
    expect(body.metadata.utm_source).toBe("facebook");
    expect(body.metadata.utm_campaign).toBe("lancamento");
    expect(body.metadata.ip).toBe("127.0.0.1");
    expect(body.metadata.ua).toContain("Mozilla/5.0");
    expect(body.sourceUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/loja\//);
    const tx = [...kyvo.transactions.values()].at(-1);
    expect(tx?.externalOrderId).toMatch(/^os_checkout-principal-[0-9a-f]{10}_[a-z0-9]{20}$/);
    // Sem a query (fbclid, e-mail…): só a página.
    expect(body.sourceUrl).not.toContain("?");

    kyvo.setStatus(tx?.id as string, "paid");
    await expect.poll(() => page.locator(".os-pw-h").textContent(), { timeout: 20_000 }).toBe("¡Pago confirmado!");
    // O ?pedido= sai do endereço (credencial do acesso); o bloco usa o que o script do <head> guardou.
    await page.waitForURL(/\/loja\/obrigado\/$/, { timeout: 20_000 });
    await expect.poll(() => kyvo.requests.some((r) => r.path === `/api/v1/transactions/${tx?.id}`)).toBe(true);
    await expect.poll(() => page.locator("[data-os-ac-go]").isVisible(), { timeout: 20_000 }).toBe(true);
    expect(await page.locator("[data-os-ac-go]").getAttribute("href")).toBe(ACCESS_URL);
    expect(await page.content()).not.toContain(KYVO_KEY);

    // A página de obrigado aberta direto (em outra aba/navegador, sem o pedido) não dá acesso.
    await page.evaluate(() => sessionStorage.clear());
    await page.goto(`${base}obrigado/`);
    await expect.poll(() => page.locator("[data-os-ac-none]").isVisible(), { timeout: 20_000 }).toBe(true);
    expect(await page.locator("[data-os-ac-go]").getAttribute("href")).toBe("#");
    expect(s.outside).toEqual([]);
    expect(s.errors).toEqual([]);
    await s.close();
  }, 120_000);

  it("cartão: SDK (falso) montado com a sessão da Kyvo → pago → acesso", async () => {
    const s = await open(base);
    const { page } = s;
    await page.locator("#comprar").click();
    await page.locator(".os-pw-m", { hasText: "Tarjeta" }).click();
    await fill(page);
    await page.getByRole("button", { name: "Continuar al pago" }).click();
    await expect.poll(() => page.locator("#sdk-pay").isVisible(), { timeout: 20_000 }).toBe(true);
    const tx = [...kyvo.transactions.values()].at(-1);
    expect(tx?.paymentMethod).toBe("card");
    expect(await page.evaluate(() => (window as unknown as { __kyvoSession: unknown }).__kyvoSession)).toEqual({
      client_secret: `cs_${tx?.id}`,
      public_key: "pk_fake",
      account: "acct_fake",
      transaction_id: tx?.id,
    });
    await page.locator("#sdk-pay").click();
    // "Tentativa aceita" ainda não é pago: só com a confirmação da Kyvo.
    await expect.poll(() => page.locator(".os-pw-h").textContent(), { timeout: 10_000 }).toBe("Confirmando tu pago…");
    kyvo.setStatus(tx?.id as string, "paid");
    await page.waitForURL(/\/loja\/obrigado\/$/, { timeout: 30_000 });
    await expect.poll(() => page.locator("[data-os-ac-go]").isVisible(), { timeout: 20_000 }).toBe(true);
    expect(await page.locator("[data-os-ac-go]").getAttribute("href")).toBe(ACCESS_URL);
    expect(s.outside).toEqual([]);
    expect(s.errors).toEqual([]);
    await s.close();
  }, 120_000);
});
