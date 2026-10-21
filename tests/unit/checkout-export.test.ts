/**
 * Checkout do Offer Studio no ZIP (fase 3), com o banco de testes:
 *
 * - a página de checkout vai no ZIP (checkout/<chave>/index.html; "checkout-2/"
 *   se uma página da oferta já usa "checkout/"), com o script do checkout em
 *   assets/, o pagamento.php relativo a ela, a página de obrigado e as imagens;
 *   os botões e os prêmios de cada página levam a ela com o caminho relativo
 *   à pasta da página; a página de obrigado leva o #os-pagamento (o bloco
 *   "Acesso ao produto" pergunta ao pagamento.php);
 * - pagamento.php + pagamento-dados/config.php (chave da FlevoPay e o
 *   checkout com bumps e frete) + .htaccess, mesmo sem pagamento na página;
 *   a chave e os links de acesso SÓ no config.php; LEIA-ME com o webhook;
 *   avisos (hospedagem, chave, Purchase repetido, cupom).
 * - Com PHP de verdade (OS_PHP_BIN, ver export-php.test.ts) e a FlevoPay
 *   FALSA: o ZIP descompactado numa SUBPASTA e servido pelo `php -S`; um
 *   Chromium sai da página de vendas, preenche o checkout (BrasilAPI simulada
 *   pelo teste), gera o PIX, a FlevoPay falsa aprova e a página leva à de
 *   obrigado com o acesso do produto e do bump — nada sai para a internet.
 */
import type { ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type Browser, chromium } from "playwright";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ACCESS_CSS, accessDef } from "@/editor/widgets/access-content";
import { defToHtml } from "@/editor/widgets/quiz-content";
import { DEFAULT_WHEEL, wheelDef } from "@/editor/widgets/wheel-content";
import { type CheckoutConfigDraft, checkoutConfigDraft, parseCheckoutConfig } from "@/lib/checkout/config";
import { CHECKOUT_CONFIG_ID, type PublicCheckoutConfig } from "@/lib/checkout/contract";
import { prisma } from "@/lib/db";
import { rebaseCheckoutLinks, zipCheckoutHref, zipCheckoutRoot } from "@/lib/export/checkout-pages";
import { PAGAMENTO_CONFIG_FILE, PAGAMENTO_FILE, PAGAMENTO_HTACCESS_FILE } from "@/lib/export/payment-php";
import { leiaMe } from "@/lib/export/readme";
import { checkoutHostingWarning, exportWarningFix } from "@/lib/export/warnings";
import { PAYMENT_CONFIG_ID, type PaymentPageConfig } from "@/lib/payments/contract";
import { putContentAddressed } from "@/lib/storage";
import { PRIZE_MAP_ID } from "@/lib/wheel";
import { saveCheckoutProduct } from "@/server/services/checkout/products";
import { buildExport } from "@/server/services/export/build";
import { exportPlan, parseExportOptions } from "@/server/services/export/plan";
import { createOfferLink } from "@/server/services/offer-links";
import { createOffer } from "@/server/services/offers";
import { createPage } from "@/server/services/pages";
import { savePaymentGatewayKey } from "@/server/services/payments/gateways";
import { createEventRule } from "@/server/services/tracking";
import { createUpsellPage, saveUpsellFlow } from "@/server/services/upsell";
import { resetDatabase } from "../setup/per-file";
import { readZip } from "./export-fixture";
import { type FakeKyvo, KYVO_KEY, startFakeKyvo } from "./kyvo-fake";
import { findPhp, instrumentCheckout, startPhp } from "./php-server";
import { FAKE_PIX_CODE, type FakePix, FLEVO_KEY, startFakeFlevopay } from "./pix-fakes";

const PHP = findPhp();
/** Pasta para capturas do fluxo publicado (opcional, como em checkout-preview-browser.test.ts). */
const SHOTS = process.env.OS_CHECKOUT_SHOTS ?? "";

async function shot(page: import("playwright").Page, name: string) {
  if (!SHOTS) return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}
const PRODUCT_ACCESS = "https://area.exemplo.com/confeitaria?token=segredo";
const BUMP_ACCESS = "https://drive.exemplo.com/apostila";

let tmp = "";

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "os-checkout-zip-"));
});

afterAll(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
  await resetDatabase();
});

async function image(offerId: string, color: string) {
  const data = await sharp({ create: { width: 40, height: 40, channels: 3, background: color } })
    .webp()
    .toBuffer();
  const stored = await putContentAddressed(data, "webp");
  await prisma.asset.upsert({
    where: { offerId_key: { offerId, key: stored.key } },
    create: { offerId, sha256: stored.sha256, key: stored.key, kind: "IMAGE", mime: "image/webp", bytes: stored.bytes },
    update: {},
  });
  return `/os-assets/${stored.key.split("/")[2]}`;
}

const wheelPage = (key: string) =>
  `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Roleta</title></head><body>${defToHtml(
    wheelDef(
      {
        ...DEFAULT_WHEEL,
        slices: [
          { text: "30% OFF", color: "#ec4899", chance: 50, link: key, coupon: "ROLETA30" },
          { text: "Não foi dessa vez", color: "#64748b", chance: 50, link: "", coupon: "", lose: true },
        ],
      },
      { html: true },
    ),
  )}</body></html>`;

async function checkoutOffer(opts: { slugCheckout?: boolean } = {}) {
  const offer = await createOffer({ name: "Confeitaria", currency: "BRL" });
  const home = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id, isHome: true } });
  const thanks = await createPage({ offerId: offer.id, name: "Obrigado", type: "THANK_YOU" });
  const upsell = await createPage({ offerId: offer.id, name: "Roleta", type: "UPSELL" });
  if (opts.slugCheckout) await createPage({ offerId: offer.id, name: "Checkout", type: "SALES" });
  const link = await createOfferLink(offer.id, { label: "Checkout principal", url: "", kind: "CHECKOUT" });
  const sales = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Vendas</title></head><body><h1>Curso</h1><a id="comprar" data-os-link="${link.key}" href="https://pay.hotmart.com/ANTIGO" style="display:inline-block;padding:16px">Comprar</a></body></html>`;
  const thanksHtml = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Obrigado</title><style>${ACCESS_CSS}</style></head><body>${defToHtml(accessDef("pt"))}</body></html>`;
  await prisma.pageDocument.updateMany({ where: { variant: { pageId: home.id } }, data: { html: sales } });
  await prisma.pageDocument.updateMany({ where: { variant: { pageId: thanks.id } }, data: { html: thanksHtml } });
  await prisma.pageDocument.updateMany({
    where: { variant: { pageId: upsell.id } },
    data: { html: wheelPage(link.key) },
  });
  const [photo, bump] = await Promise.all([image(offer.id, "#be185d"), image(offer.id, "#fb923c")]);
  const config: CheckoutConfigDraft = {
    ...checkoutConfigDraft(parseCheckoutConfig({})),
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
        description: "120 receitas.",
        price: "27,00",
        compareAt: "",
        imageSrc: bump,
        accessUrl: BUMP_ACCESS,
      },
    ],
  };
  await savePaymentGatewayKey(offer.id, "FLEVOPAY", FLEVO_KEY);
  await saveCheckoutProduct(link.id, {
    name: "Curso de Confeitaria",
    amount: "197,00",
    provider: "FLEVOPAY",
    methods: ["PIX"],
    locale: "PT",
    thankYouPageId: thanks.id,
    accessUrl: PRODUCT_ACCESS,
    config,
  });
  return { offerId: offer.id, key: link.key, photo, bump };
}

async function zip(offerId: string, name = "oferta.zip") {
  const target = path.join(tmp, `${Date.now()}-${name}`);
  const result = await buildExport({ offerId, options: parseExportOptions({}), target });
  const entries = await readZip(target);
  const text = (p: string) => entries.get(p)?.data.toString("utf8") ?? "";
  return { result, entries, text };
}

function jsonOf<T>(html: string, id: string): T {
  const m = new RegExp(`<script type="application/json" id="${id}"[^>]*>([\\s\\S]*?)</script>`).exec(html);
  expect(m, `página sem #${id}`).not.toBeNull();
  return JSON.parse((m as RegExpExecArray)[1].replace(/\\u003c/g, "<").replace(/\\u0026/g, "&"));
}

describe("pastas das páginas de checkout no ZIP (regras puras)", () => {
  it("checkout/ (ou checkout-2/ quando uma página já usa o nome) e endereço relativo a cada pasta", () => {
    expect(zipCheckoutRoot([{ slug: "obrigado", isHome: false }])).toBe("checkout/");
    expect(zipCheckoutRoot([{ slug: "checkout", isHome: true }])).toBe("checkout/");
    expect(zipCheckoutRoot([{ slug: "checkout", isHome: false }])).toBe("checkout-2/");
    expect(zipCheckoutHref("", "checkout/", "principal")).toBe("./checkout/principal/");
    expect(zipCheckoutHref("upsell/", "checkout/", "principal")).toBe("../checkout/principal/");
    expect(zipCheckoutHref("upsell/oferta-b/", "checkout/", "principal")).toBe("../../checkout/principal/");
    const links = [
      { key: "principal", url: "./checkout/principal/", kind: "CHECKOUT", pay: false, checkout: true },
      { key: "vazio", url: "", kind: "CHECKOUT", pay: false, checkout: false },
      { key: "hotmart", url: "https://pay.hotmart.com/X", kind: "CHECKOUT", pay: false },
    ];
    expect(rebaseCheckoutLinks(links, "upsell/", "checkout/").map((l) => l.url)).toEqual([
      "../checkout/principal/",
      "",
      "https://pay.hotmart.com/X",
    ]);
  });
});

describe("LEIA-ME do checkout (regras puras)", () => {
  const base = {
    offerName: "Oferta",
    date: "11/10/2026",
    pages: [{ name: "Vendas", dir: "", mobile: false }],
    splits: [],
    serverEvents: [],
    preserveJs: [],
    warnings: [],
    checkouts: [{ name: "Kit", dir: "checkout/kit/", price: "R$ 89,00", gateway: "BlackCat" }],
    checkoutGateways: ["BlackCat"],
  };
  const flat = (text: string) => text.replace(/\s+/g, " ");

  it("só com checkout: a troca do trust_proxy (CDN que não é a Cloudflare) e quando os pedidos são apagados", () => {
    const text = flat(leiaMe(base));
    expect(text).toContain("'trust_proxy' => false por 'trust_proxy' => true");
    expect(text).toContain("os não pagos depois de 30 dias; os pagos, depois de 180");
    expect(text).not.toContain("Pedidos com mais de 180 dias são apagados sozinhos");
  });

  it("com pagamento na página também: o aviso do trust_proxy aparece uma vez só", () => {
    const text = leiaMe({ ...base, payments: [{ name: "Curso", price: "$497.00 MXN", methods: ["SPEI"] }] });
    expect(text.split("'trust_proxy' => true").length - 1).toBe(1);
  });
});

describe("checkout do Offer Studio no ZIP", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("vai no ZIP: página de checkout, scripts, pagamento.php com a chave da FlevoPay e links relativos", async () => {
    const o = await checkoutOffer();
    const { result, entries, text } = await zip(o.offerId);
    const dir = `checkout/${o.key}/`;
    const names = [...entries.keys()];
    expect(names).toEqual(
      expect.arrayContaining([`${dir}index.html`, PAGAMENTO_FILE, PAGAMENTO_CONFIG_FILE, PAGAMENTO_HTACCESS_FILE]),
    );
    const checkoutJs = names.find((n) => /^assets\/os-checkout-[0-9a-f]{12}\.js$/.test(n));
    const paymentJs = names.find((n) => /^assets\/os-pagamento-[0-9a-f]{12}\.js$/.test(n));
    expect(checkoutJs).toBeDefined();
    expect(paymentJs).toBeDefined();

    // Botões e prêmios: a página de checkout relativa à pasta de cada página (nunca o endereço antigo).
    const home = text("index.html");
    expect(home).toContain(`href="./checkout/${o.key}/"`);
    expect(home).not.toContain("pay.hotmart.com/ANTIGO");
    const roleta = text("roleta/index.html");
    const prizes = jsonOf<Record<string, { u?: string; o?: string }>>(roleta, PRIZE_MAP_ID);
    expect(Object.values(prizes)).toEqual([expect.objectContaining({ u: `../checkout/${o.key}/`, o: o.key })]);
    expect(jsonOf<Record<string, { u?: string }>>(home, PRIZE_MAP_ID)).toEqual(
      Object.fromEntries(Object.entries(prizes).map(([id, p]) => [id, { ...p, u: `./checkout/${o.key}/` }])),
    );

    // A página de checkout: pagamento.php, obrigado, imagens e script relativos a ela; sem simulação; fora do Google.
    const page = text(`${dir}index.html`);
    const cfg = jsonOf<PublicCheckoutConfig>(page, CHECKOUT_CONFIG_ID);
    expect(cfg).toMatchObject({
      endpoint: "../../pagamento.php",
      simulacao: false,
      chave: o.key,
      obrigado: "../../obrigado/",
      valor: 19700,
      moeda: "BRL",
      gateway: "pix",
      imagem: `../../assets/${o.photo.split("/").pop()}`,
    });
    expect(cfg.bumps[0].imagem).toBe(`../../assets/${o.bump.split("/").pop()}`);
    expect(entries.has(`assets/${o.photo.split("/").pop()}`)).toBe(true);
    expect(entries.has(`assets/${o.bump.split("/").pop()}`)).toBe(true);
    expect(page).toContain(`<script src="../../${checkoutJs}" data-os-checkout-script></script>`);
    expect(page).toMatch(/<meta name="robots" content="noindex/);
    expect(page).toContain("data-os-export");

    // Página de obrigado: o bloco de acesso pergunta ao pagamento.php (sem produto da janela).
    const thanks = jsonOf<PaymentPageConfig>(text("obrigado/index.html"), PAYMENT_CONFIG_ID);
    expect(thanks).toMatchObject({ endpoint: "../pagamento.php", simulacao: false, produtos: {} });

    // Chave e links de acesso SÓ no config.php.
    const config = text(PAGAMENTO_CONFIG_FILE);
    expect(config).toContain(`'flevopay' => '${FLEVO_KEY}',`);
    expect(config).toContain(`'acesso' => '${PRODUCT_ACCESS}',`);
    expect(config).toContain(
      `'bump0001' => array('titulo' => 'Apostila de receitas (PDF)', 'valor' => 2700, 'acesso' => '${BUMP_ACCESS}')`,
    );
    expect(config).toContain("'sedex0001' => array('nome' => 'Sedex', 'valor' => 2990)");
    for (const [name, item] of entries) {
      if (name === PAGAMENTO_CONFIG_FILE) continue;
      const body = item.data.toString("utf8");
      expect(body, name).not.toContain(FLEVO_KEY);
      expect(body, name).not.toContain("token=segredo");
      expect(body, name).not.toContain(BUMP_ACCESS);
    }

    // LEIA-ME e avisos.
    const readme = text("LEIA-ME.txt");
    expect(readme).toContain("CHECKOUT DO OFFER STUDIO (pagamento.php)");
    expect(readme).toContain(`  ${dir}index.html  →  página de checkout de Curso de Confeitaria`);
    expect(readme).toContain("FlevoPay:  https://meusite.com/pagamento.php?webhook=flevopay");
    expect(readme).toContain("você NÃO precisa cadastrar");
    expect(readme).toContain('"Chave da FlevoPay: cadastrada"');
    expect(result.warnings).toContain(checkoutHostingWarning(["FlevoPay"]));
    // O cupom do prêmio não vale na página de checkout: aviso próprio na prévia do ZIP (com conserto no editor).
    const plan = await exportPlan(o.offerId);
    // Só checkout (sem pagamento na página): o "Como subir na hospedagem" também avisa das chaves.
    expect(plan.hasPayments).toBe(true);
    expect(plan.paymentGateways).toEqual(["FlevoPay"]);
    const couponWarning = plan.warnings.find((w) => w.includes("tem cupom e leva"));
    expect(couponWarning).toMatch(/^O prêmio “30% OFF” da roleta na página “Roleta” tem cupom/);
    expect(exportWarningFix(couponWarning ?? "")).toEqual({ kind: "deadButtons", wheel: true });
    expect(plan.warnings.some((w) => /ainda não vai no ZIP|sem link de checkout/.test(w))).toBe(false);
    expect(plan.tree).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "checkout/",
          label: "Páginas de checkout do Offer Studio (uma pasta por link)",
        }),
        expect.objectContaining({ path: PAGAMENTO_FILE, label: expect.stringContaining("FlevoPay") }),
      ]),
    );
  }, 120_000);

  it("página da oferta com o endereço “checkout”: as páginas de checkout vão para checkout-2/", async () => {
    const o = await checkoutOffer({ slugCheckout: true });
    const { entries, text } = await zip(o.offerId, "slug.zip");
    expect(entries.has("checkout/index.html")).toBe(true);
    expect(entries.has(`checkout-2/${o.key}/index.html`)).toBe(true);
    expect(text("index.html")).toContain(`href="./checkout-2/${o.key}/"`);
  }, 120_000);

  it("regra de Purchase automática na página de obrigado vira aviso do ZIP; sem chave, o config.php sai sem ela", async () => {
    const o = await checkoutOffer();
    await prisma.paymentGateway.deleteMany({ where: { offerId: o.offerId } });
    const thanks = await prisma.page.findFirstOrThrow({ where: { offerId: o.offerId, type: "THANK_YOU" } });
    await createEventRule(o.offerId, { event: "PURCHASE", trigger: "PAGE_LOAD", pageId: thanks.id });
    const { result, text } = await zip(o.offerId, "regra.zip");
    const purchase = result.warnings.find((w) => w.startsWith("Há uma regra de evento Purchase"));
    expect(purchase).toContain("com o checkout do Offer Studio, ela conta cada venda duas vezes");
    expect(exportWarningFix(purchase ?? "")).toEqual({ kind: "purchaseRule" });
    expect(result.warnings.some((w) => w.includes("falta a chave da FlevoPay"))).toBe(true);
    expect(text(PAGAMENTO_CONFIG_FILE)).toContain("'flevopay' => '',");
  }, 120_000);
});

describe("funil de upsell no ZIP (estrutura, sem PHP)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  /** Oferta com produto principal + upsell, página-modelo de upsell e de obrigado, tudo ligado. */
  async function upsellFunnel() {
    const offer = await createOffer({ name: "Funil Upsell", currency: "BRL" });
    const home = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id, isHome: true } });
    const principal = await createOfferLink(offer.id, { label: "Checkout principal", url: "", kind: "CHECKOUT" });
    const up = await createOfferLink(offer.id, { label: "Upsell E-book", url: "", kind: "CHECKOUT" });
    const sales = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Vendas</title></head><body><h1>Curso</h1><a id="comprar" data-os-link="${principal.key}" href="#" style="display:inline-block;padding:16px">Comprar</a></body></html>`;
    await prisma.pageDocument.updateMany({ where: { variant: { pageId: home.id } }, data: { html: sales } });
    await savePaymentGatewayKey(offer.id, "FLEVOPAY", FLEVO_KEY);
    const upPage = await createUpsellPage(offer.id, "UPSELL"); // "Upsell"  → página da etapa
    const obg = await createUpsellPage(offer.id, "THANK_YOU"); // "Obrigado" → fim
    const base: CheckoutConfigDraft = { ...checkoutConfigDraft(parseCheckoutConfig({})) };
    for (const { link, name, amount } of [
      { link: principal, name: "Curso", amount: "197,00" },
      { link: up, name: "E-book", amount: "47,00" },
    ]) {
      await saveCheckoutProduct(link.id, {
        name,
        amount,
        provider: "FLEVOPAY",
        methods: ["PIX"],
        locale: "PT",
        thankYouPageId: obg.id, // placeholder; o saveUpsellFlow encadeia o certo
        accessUrl: "",
        config: base,
      });
    }
    await saveUpsellFlow(offer.id, {
      startLinkKeys: [principal.key],
      thankYouPageId: obg.id,
      steps: [{ id: "s1", kind: "UPSELL", pageId: upPage.id, linkKey: up.key }],
    });
    const pages = await prisma.page.findMany({ where: { offerId: offer.id }, select: { id: true, slug: true } });
    const slugOf = (id: string) => pages.find((p) => p.id === id)?.slug ?? "";
    return {
      offerId: offer.id,
      principalKey: principal.key,
      upKey: up.key,
      upSlug: slugOf(upPage.id),
      obgSlug: slugOf(obg.id),
    };
  }

  it("páginas exportadas; SIM/Não e a cadeia de obrigado com caminhos relativos", async () => {
    const o = await upsellFunnel();
    const { entries, text } = await zip(o.offerId, "upsell.zip");

    // As páginas do funil e os dois checkouts foram para o ZIP.
    expect(entries.has(`${o.upSlug}/index.html`)).toBe(true);
    expect(entries.has(`${o.obgSlug}/index.html`)).toBe(true);
    expect(entries.has(`checkout/${o.principalKey}/index.html`)).toBe(true);
    expect(entries.has(`checkout/${o.upKey}/index.html`)).toBe(true);

    // Página de upsell (um nível fundo): SIM → checkout do upsell; Não (os-decline) → obrigado.
    const upHtml = text(`${o.upSlug}/index.html`);
    expect(upHtml).toContain(`href="../checkout/${o.upKey}/"`); // SIM = data-os-link do produto da etapa
    expect(upHtml).toContain(`href="../${o.obgSlug}/"`); // Não = os-page da próxima (obrigado)
    expect(upHtml).not.toContain("os-page:"); // os-page foi resolvido no ZIP
    // Página de upsell não deve aparecer no Google (vem depois da compra).
    expect(upHtml).toMatch(/<meta name="robots" content="noindex/);

    // Cadeia de obrigado dos produtos (o redirect pós-pagamento): principal → upsell; upsell → obrigado.
    const cfg = (key: string) => jsonOf<PublicCheckoutConfig>(text(`checkout/${key}/index.html`), CHECKOUT_CONFIG_ID);
    expect(cfg(o.principalKey).obrigado).toBe(`../../${o.upSlug}/`);
    expect(cfg(o.upKey).obrigado).toBe(`../../${o.obgSlug}/`);
  }, 120_000);
});

describe.skipIf(!PHP)("checkout no ZIP publicado numa subpasta (PHP de verdade + FlevoPay falsa)", () => {
  let flevo: FakePix;
  let site = "";
  let server: ChildProcess | null = null;
  let browser: Browser;
  let base = "";
  let key = "";

  beforeAll(async () => {
    await resetDatabase();
    flevo = await startFakeFlevopay();
    const o = await checkoutOffer();
    key = o.key;
    const { entries } = await zip(o.offerId, "publicado.zip");
    site = await mkdtemp(path.join(os.tmpdir(), "os-checkout-site-"));
    for (const [name, item] of entries) {
      const target = path.join(site, "loja", name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, item.data);
    }
    const php = path.join(site, "loja", PAGAMENTO_FILE);
    await writeFile(
      php,
      instrumentCheckout(await readFile(php, "utf8"), {
        // Só a FlevoPay é usada: as outras apontam para uma porta fechada deste Mac.
        kyvo: "http://127.0.0.1:9/api",
        flevopay: flevo.base,
        blackcat: "http://127.0.0.1:9/api",
      }),
    );
    let origin = "";
    ({ server, origin } = await startPhp(PHP as string, site, `/loja/${PAGAMENTO_FILE}`));
    base = `${origin}/loja/`;
    browser = await chromium.launch();
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    server?.kill();
    await flevo?.close();
    if (site) await rm(site, { recursive: true, force: true });
  });

  it("da página de vendas ao acesso: PIX da FlevoPay (falsa), aprovado, obrigado com o produto e o bump", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const outside: string[] = [];
    await page.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === "127.0.0.1") return route.continue();
      if (u.hostname === "brasilapi.com.br") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({
            cep: "01310100",
            state: "SP",
            city: "São Paulo",
            neighborhood: "Bela Vista",
            street: "Avenida Paulista",
          }),
        });
      }
      outside.push(u.href);
      return route.fulfill({ status: 204, body: "" });
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${base}?utm_source=facebook&utm_campaign=lancamento`);
    await page.locator("#comprar").click();
    await page.waitForURL(new RegExp(`/loja/checkout/${key}/`));
    await expect.poll(() => page.locator("[data-osc-form]").isVisible(), { timeout: 20_000 }).toBe(true);
    expect(await page.locator(".osc-sim").count()).toBe(0);

    await page.locator("#osc-nome").fill("Maria da Silva");
    await page.locator("#osc-email").fill("maria@exemplo.com");
    await page.locator("#osc-telefone").pressSequentially("11987654321");
    await page.locator("#osc-documento").pressSequentially("52998224725");
    await page.locator("#osc-cep").pressSequentially("01310100");
    await expect.poll(() => page.locator("#osc-rua").inputValue()).toBe("Avenida Paulista");
    await page.locator("#osc-numero").fill("1000");
    await page.locator(".osc-bump", { hasText: "Apostila" }).click();
    await page.locator(".osc-opt", { hasText: "Sedex" }).click();
    await page.locator("[data-osc-pay]").click();

    await expect.poll(() => page.locator(".osc-code input").isVisible(), { timeout: 20_000 }).toBe(true);
    await shot(page, "zip-1-pix-flevopay");
    const tx = [...flevo.transactions.values()].at(-1);
    expect(tx?.amount).toBe(19700 + 2700 + 2990);
    expect(tx?.body).toMatchObject({
      customer: { name: "Maria da Silva", document: "52998224725", phone: "11987654321" },
      address: { zipcode: "01310100", number: "1000", state: "SP" },
      tracking: { utm_source: "facebook", utm_campaign: "lancamento" },
    });
    // O código "copia e cola" é o do gateway (a imagem do QR também veio dele).
    expect(await page.locator(".osc-code input").inputValue()).toBe(FAKE_PIX_CODE);

    flevo.setStatus(String(tx?.id), "approved");
    await page.waitForURL(/\/loja\/obrigado\/$/, { timeout: 30_000 });
    await expect.poll(() => page.locator("[data-os-ac-go]").isVisible(), { timeout: 20_000 }).toBe(true);
    expect(await page.locator("[data-os-ac-go]").getAttribute("href")).toBe(PRODUCT_ACCESS);
    const extra = page.locator("[data-os-ac-extra]");
    expect(await extra.count()).toBe(1);
    expect(await extra.getAttribute("href")).toBe(BUMP_ACCESS);
    await shot(page, "zip-2-obrigado-com-acesso");
    // O pedido do endereço nunca é o id da FlevoPay (sequencial).
    const stored = await page.evaluate(() => Object.entries(sessionStorage).find(([k]) => k.startsWith("os_pedido:")));
    expect(stored?.[1]).toMatch(/^ck_[a-z0-9]{24}$/);
    expect(await page.content()).not.toContain(FLEVO_KEY);
    expect(outside).toEqual([]);
    expect(errors).toEqual([]);
    await context.close();
  }, 120_000);
});

/** SDK de cartão da Kyvo FALSO (o mesmo do teste da janela de pagamento). */
const FAKE_SDK = `(function(){
  window.KyvoCard = { mount: function (o) {
    window.__kyvoSession = o.session;
    o.container.innerHTML = '<div class="fake-sdk"><button type="button" id="sdk-pay">Pagar com cartão</button></div>';
    o.container.querySelector('#sdk-pay').onclick = function () { o.onSuccess({ status: 'processing' }); };
    return { unmount: function () {} };
  } };
})();`;

describe.skipIf(!PHP)("checkout em peso mexicano no ZIP (PHP de verdade + Kyvo e SDK falsos)", () => {
  let kyvo: FakeKyvo;
  let site = "";
  let server: ChildProcess | null = null;
  let browser: Browser;
  let base = "";
  let key = "";

  beforeAll(async () => {
    await resetDatabase();
    kyvo = await startFakeKyvo();
    const offer = await createOffer({ name: "Repostería", currency: "MXN" });
    const thanks = await createPage({ offerId: offer.id, name: "Gracias", type: "THANK_YOU" });
    const thanksHtml = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Gracias</title><style>${ACCESS_CSS}</style></head><body>${defToHtml(accessDef("es"))}</body></html>`;
    await prisma.pageDocument.updateMany({ where: { variant: { pageId: thanks.id } }, data: { html: thanksHtml } });
    const link = await createOfferLink(offer.id, { label: "Checkout", url: "", kind: "CHECKOUT" });
    key = link.key;
    await savePaymentGatewayKey(offer.id, "KYVO", KYVO_KEY);
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
    const { entries } = await zip(offer.id, "mexico.zip");
    site = await mkdtemp(path.join(os.tmpdir(), "os-checkout-mx-"));
    for (const [name, item] of entries) {
      const target = path.join(site, "tienda", name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, item.data);
    }
    const php = path.join(site, "tienda", PAGAMENTO_FILE);
    await writeFile(
      php,
      instrumentCheckout(await readFile(php, "utf8"), {
        kyvo: kyvo.base,
        flevopay: "http://127.0.0.1:9",
        blackcat: "http://127.0.0.1:9/api",
      }),
    );
    let origin = "";
    ({ server, origin } = await startPhp(PHP as string, site, `/tienda/${PAGAMENTO_FILE}`));
    base = `${origin}/tienda/`;
    browser = await chromium.launch();
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    server?.kill();
    await kyvo?.close();
    if (site) await rm(site, { recursive: true, force: true });
  });

  it("cartão: SDK (falso) com a sessão da Kyvo → pago → página de obrigado com o acesso", async () => {
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
    await page.goto(`${base}checkout/${key}/?utm_source=facebook`);
    await expect.poll(() => page.locator("[data-osc-form]").isVisible(), { timeout: 20_000 }).toBe(true);
    await page.locator("#osc-nome").fill("María López");
    await page.locator("#osc-email").fill("maria@ejemplo.mx");
    await page.locator(".osc-method", { hasText: "Tarjeta" }).click();
    await page.locator("[data-osc-pay]").click();
    await expect.poll(() => page.locator("#sdk-pay").isVisible(), { timeout: 20_000 }).toBe(true);
    await shot(page, "zip-3-kyvo-cartao");
    const tx = [...kyvo.transactions.values()].at(-1);
    expect(tx).toMatchObject({ paymentMethod: "card", amount: 49700, currency: "MXN" });
    expect(tx?.externalOrderId).toMatch(/^os_[a-z0-9-]+_[a-z0-9]{20}$/);
    expect(await page.evaluate(() => (window as unknown as { __kyvoSession: unknown }).__kyvoSession)).toMatchObject({
      transaction_id: tx?.id,
    });
    await page.locator("#sdk-pay").click();
    kyvo.setStatus(tx?.id as string, "paid");
    await page.waitForURL(/\/tienda\/gracias\/$/, { timeout: 30_000 });
    await expect.poll(() => page.locator("[data-os-ac-go]").isVisible(), { timeout: 20_000 }).toBe(true);
    expect(await page.locator("[data-os-ac-go]").getAttribute("href")).toBe(PRODUCT_ACCESS);
    // O pedido do endereço é nosso (ck_…), nunca o id da Kyvo.
    const stored = await page.evaluate(() => Object.entries(sessionStorage).find(([k]) => k.startsWith("os_pedido:")));
    expect(stored?.[1]).toMatch(/^ck_[a-z0-9]{24}$/);
    expect(stored?.[1]).not.toBe(tx?.id);
    expect(await page.content()).not.toContain(KYVO_KEY);
    expect(outside).toEqual([]);
    expect(errors).toEqual([]);
    await context.close();
  }, 120_000);
});
