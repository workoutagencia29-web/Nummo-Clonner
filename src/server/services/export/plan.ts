/**
 * Prévia do ZIP (ExportPlan): estrutura de pastas, avisos e o que vai dentro,
 * sem montar as páginas (barata: não lê o HTML dos documentos).
 */
import * as cheerio from "cheerio";
import { ZIP_CHECKOUT_DIR } from "@/lib/checkout/contract";
import { offerRoutes } from "@/lib/clone-routes";
import { prisma } from "@/lib/db";
import { zipCheckoutDir } from "@/lib/export/checkout-pages";
import { type Layout, layoutTree, planLayout } from "@/lib/export/layout";
import { deadLegalLinks } from "@/lib/export/legal-links";
import { NOT_FOUND_FILE } from "@/lib/export/not-found";
import {
  type ExportOptions,
  ExportOptionsSchema,
  type ExportPlan,
  type ExportTreeItem,
  type ServerEventVendor,
  serverEventsTreeLabel,
} from "@/lib/export/options";
import { ASSETS_DIR } from "@/lib/export/paths";
import { PAGAMENTO_CONFIG_FILE, PAGAMENTO_FILE, PAGAMENTO_HTACCESS_FILE } from "@/lib/export/payment-php";
import { EVENTOS_CONFIG_FILE, EVENTOS_FILE, HTACCESS_FILE } from "@/lib/export/php";
import { planRouteRedirects, type RouteRedirect } from "@/lib/export/routes";
import {
  COMPANY_MARKER_FIELD,
  checkoutHostingWarning,
  clonedCheckoutWarning,
  companyMarkersWarning,
  deadBackWarning,
  deadButtonsWarning,
  deadCategoriesWarning,
  deadLegalLinksWarning,
  deadMoreWarning,
  deadProductsWarning,
  deadQuizButtonsWarning,
  deadWheelButtonsWarning,
  OG_IMAGE_WARNING,
  ownCheckoutCouponWarning,
  PAYMENT_HOSTING_WARNING,
  REQUIRED_COMPANY_MARKERS,
  storeCurrencyWarning,
  wheelPrizesWarning,
} from "@/lib/export/warnings";
import { OFFER_CURRENCY_NAME } from "@/lib/offer-currency";
import { linkHasDestination } from "@/lib/offer-links";
import { type Company, effectiveSeo, parseOfferSettings, parsePageSeo } from "@/lib/offer-settings";
import { PROVIDER_LABEL } from "@/lib/payments/rules";
import { clonedCheckoutLinks } from "@/lib/readiness";
import { PRODUCT_ATTR } from "@/lib/store";
import {
  BACK_MARK,
  backGap,
  type Catalog,
  categoryGaps,
  mergeProductGaps,
  PRODUCT_MARK,
  type ProductGap,
  productGaps,
  STORE_HEADER_MARK,
  storeCatalog,
} from "@/lib/store-pages";
import { ownCheckoutCoupons, prizesWithoutLink, WHEEL_MARK } from "@/lib/wheel-prizes";
import { storeCurrencyMismatch } from "@/server/services/offer-currency";
import {
  type CheckoutExport,
  checkoutGateways,
  checkoutPlanFixes,
  checkoutWarnings,
  loadCheckoutExport,
} from "./checkout";
import { loadPaymentExport, type PaymentExport, paymentPlanFixes, paymentWarnings } from "./payments";
import { type PreservePlan, planPreserveFiles } from "./preserve";
import { type ExportSource, layoutPages, loadExportSource, serverEventPixels } from "./source";

export const README_FILE = "LEIA-ME.txt";

/** Item do 404.html em "O que vai no ZIP". */
export const NOT_FOUND_TREE_LABEL = "Página “não encontrada” (endereço errado ou antigo)";

export const SERVER_VENDOR_LABEL: Record<ServerEventVendor, string> = {
  META: "Meta (API de Conversões)",
  TIKTOK: "TikTok (Events API)",
};

export { OG_IMAGE_WARNING };

/** Item do pagamento.php em "O que vai no ZIP". */
export const PAYMENT_TREE_LABEL =
  "Precisa de PHP e HTTPS · cria as cobranças da Kyvo e entrega o acesso só a quem pagou";

/** Item do pagamento.php com o checkout do Offer Studio (gateways: "FlevoPay", "BlackCat", "Kyvo"). */
export function paymentTreeLabel(gateways: readonly string[]): string {
  if (!gateways.length) return PAYMENT_TREE_LABEL;
  const names = gateways.length > 1 ? `${gateways.slice(0, -1).join(", ")} e ${gateways.at(-1)}` : gateways[0];
  return `Precisa de PHP e HTTPS · cria as cobranças (${names}), confere o pagamento e entrega o acesso só a quem pagou`;
}

/** Item da pasta das páginas de checkout em "O que vai no ZIP". */
export const CHECKOUT_TREE_LABEL = "Páginas de checkout do Offer Studio (uma pasta por link)";

/** Caminhos do ZIP que não são do "Preservar JS" (prévia: os scripts do Offer Studio entram como "assets/"). */
export function reservedZipPaths(layout: Layout, extra: Iterable<string> = []): string[] {
  return [
    ...layout.files.map((f) => f.path),
    NOT_FOUND_FILE,
    EVENTOS_FILE,
    EVENTOS_CONFIG_FILE,
    HTACCESS_FILE,
    PAGAMENTO_FILE,
    PAGAMENTO_CONFIG_FILE,
    PAGAMENTO_HTACCESS_FILE,
    README_FILE,
    ...extra,
  ];
}

/** Opções válidas (o que faltar vem com o padrão). */
export function parseExportOptions(value: unknown): ExportOptions {
  const parsed = ExportOptionsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : ExportOptionsSchema.parse({});
}

/** Placeholder dos scripts do Offer Studio na prévia (os nomes de verdade têm hash; só marca a pasta assets/). */
const SCRIPT_PLACEHOLDER = `${ASSETS_DIR}os-runtime.js`;

/** Pastas (ou arquivos) de primeiro nível dos caminhos originais do "Preservar JS" de cada página. */
function preserveJsRoots(preserve: PreservePlan): Map<string, string[]> {
  const roots = new Map<string, Set<string>>();
  for (const e of preserve.entries) {
    if (!e.primary) continue;
    const slash = e.zipPath.indexOf("/");
    const root = slash < 0 ? e.zipPath : e.zipPath.slice(0, slash + 1);
    // assets/ já aparece na árvore (com os arquivos do Offer Studio).
    if (root.toLowerCase() === ASSETS_DIR) continue;
    const set = roots.get(e.pageId) ?? new Set<string>();
    set.add(root);
    roots.set(e.pageId, set);
  }
  return new Map([...roots].map(([id, set]) => [id, [...set].sort()]));
}

export interface PlanContext {
  options: ExportOptions;
  layout: Layout;
  /** Plataformas atendidas pelo eventos.php (vazio = sem eventos.php). */
  serverVendors: ServerEventVendor[];
  /** O eventos.php vai no ZIP. */
  serverFiles: boolean;
  preserveJsPages: string[];
  /** Arquivos do "Preservar JS" que vão no ZIP (e os que ficaram de fora). */
  preserve: PreservePlan;
  /** Pagamento na página (null = sem pagamento.php, a não ser pelo checkout). */
  payment: PaymentExport | null;
  /** Páginas de checkout do Offer Studio no ZIP ("checkout/<chave>/index.html"). */
  checkoutPages: string[];
  /**
   * Funil clonado "Com scripts": index.html nos caminhos originais das páginas
   * que ficaram em outra pasta ("produto/camiseta/" → "camiseta/"), só nos
   * caminhos livres (src/lib/export/routes.ts).
   */
  redirects: RouteRedirect[];
  warnings: string[];
  tree: ExportTreeItem[];
}

/** Avisos e árvore comuns à prévia e à montagem. */
export function planFrom(
  source: ExportSource,
  options: ExportOptions,
  serverVendors: ServerEventVendor[],
  payment: PaymentExport | null = null,
  checkout: CheckoutExport | null = null,
): PlanContext {
  const layout = planLayout(layoutPages(source), { splitter: options.splitter });
  const warnings = [...layout.warnings];
  const serverFiles = options.serverEvents && serverVendors.length > 0;

  const preservePages = source.pages.filter((p) => p.cloneMode === "PRESERVE_JS");
  const preserveJsPages = preservePages.map((p) => p.name);
  if (preserveJsPages.length) {
    const names = preserveJsPages.map((n) => `“${n}”`).join(", ");
    warnings.push(
      `${preserveJsPages.length > 1 ? "As páginas" : "A página"} ${names} ${preserveJsPages.length > 1 ? "usam" : "usa"} o modo “Com scripts”: suba a oferta na raiz do domínio (public_html), não numa subpasta, senão os scripts originais não carregam.`,
    );
  }
  for (const page of preservePages) {
    if (page.variants.length > 1) {
      warnings.push(
        `A página “${page.name}” usa o modo “Com scripts” e tem versões A/B: cada versão fica na pasta dela (oferta-a/, oferta-b/…), com cópias dos arquivos originais, mas scripts que leem o endereço da página podem não funcionar lá. Teste cada versão depois de subir.`,
      );
    }
  }

  if (!options.splitter) {
    const tested = source.pages.filter((p) => p.variants.length > 1).map((p) => `“${p.name}”`);
    if (tested.length) {
      warnings.push(
        `Sem o divisor A/B, o teste não roda: todo mundo vê a versão de controle de ${tested.join(", ")}. As outras versões só abrem pelo endereço da pasta delas.`,
      );
    }
  }

  if (options.serverEvents && !serverVendors.length) {
    warnings.push(
      "O eventos.php não foi incluído: nenhum pixel da Meta ou do TikTok tem a API de Conversões/Events API ligada com o token salvo (aba “Pixels e rastreamento”).",
    );
  }
  if (serverFiles) {
    warnings.push(
      "O eventos.php só funciona em hospedagem com PHP (Hostinger, HostGator, cPanel). Em Netlify, Vercel ou outra hospedagem só de arquivos, não suba o eventos.php nem a pasta eventos-dados: os tokens ficariam visíveis.",
    );
  }

  // Com o checkout, o aviso da hospedagem é um só (o do checkout, com todos os gateways).
  warnings.push(...paymentWarnings(payment).filter((w) => !(checkout && w === PAYMENT_HOSTING_WARNING)));
  warnings.push(...checkoutWarnings(checkout, payment?.issues.some((i) => i.kind === "doublePurchase") ?? false));
  if (checkout) warnings.push(checkoutHostingWarning(zipPaymentGateways(payment, checkout)));
  const checkoutRoot = source.checkoutRoot ?? ZIP_CHECKOUT_DIR;
  const checkoutPages = (checkout?.products ?? []).map((p) => `${zipCheckoutDir(checkoutRoot, p.key)}index.html`);

  const settings = parseOfferSettings(source.offer.settings);
  const hasOgImage = source.pages.some((p) => effectiveSeo(settings, parsePageSeo(p.seo)).ogImageKey);
  if (hasOgImage && !source.offer.liveUrl) warnings.push(OG_IMAGE_WARNING);

  const preserve: PreservePlan = preservePages.length
    ? planPreserveFiles(source, layout, reservedZipPaths(layout, [SCRIPT_PLACEHOLDER, ...checkoutPages]))
    : { entries: [], collisions: [], blocked: [] };
  // Por último (nunca no lugar de outro arquivo): os caminhos originais das páginas
  // do funil clonado, que o JavaScript das páginas "Com scripts" ainda usa.
  const redirects = preservePages.length
    ? planRouteRedirects(
        offerRoutes(source.pages),
        source.pages,
        layout.pageDirs,
        [
          ...reservedZipPaths(layout, [SCRIPT_PLACEHOLDER, ...checkoutPages]),
          ...preserve.entries.map((e) => e.zipPath),
        ],
        checkoutPages.length ? [checkoutRoot] : [],
      )
    : [];
  if (preserve.collisions.length) {
    const list = preserve.collisions.slice(0, 3).join(", ");
    warnings.push(
      `${preserve.collisions.length} arquivo(s) das páginas “Com scripts” tinham o mesmo caminho (ou o nome de uma pasta) de outro arquivo da oferta e ficaram de fora (ex.: ${list}).`,
    );
  }
  if (preserve.blocked.length) {
    const list = preserve.blocked.slice(0, 3).join(", ");
    warnings.push(
      `${preserve.blocked.length} arquivo(s) do site original que rodariam como programa na hospedagem (.php, .htaccess…) ficaram de fora por segurança (ex.: ${list}).`,
    );
  }

  const tree: ExportTreeItem[] = layoutTree(layout);
  if (checkoutPages.length) tree.push({ path: checkoutRoot, kind: "file", label: CHECKOUT_TREE_LABEL });
  const roots = preserveJsRoots(preserve);
  for (const page of preservePages) {
    for (const root of roots.get(page.id) ?? []) {
      tree.push({ path: root, kind: "file", label: `Arquivos originais de “${page.name}” (com scripts)` });
    }
  }
  tree.push(
    { path: ASSETS_DIR, kind: "file", label: "Imagens, estilos, fontes, vídeos e scripts" },
    { path: NOT_FOUND_FILE, kind: "file", label: NOT_FOUND_TREE_LABEL },
  );
  if (serverFiles) {
    tree.push(
      { path: EVENTOS_FILE, kind: "file", label: serverEventsTreeLabel(serverVendors) },
      { path: EVENTOS_CONFIG_FILE, kind: "file", label: "Tokens do eventos.php (não compartilhe)" },
      { path: HTACCESS_FILE, kind: "file", label: "Bloqueia a pasta dos tokens (Apache)" },
    );
  }
  if (payment && !checkout) {
    tree.push(
      { path: PAGAMENTO_FILE, kind: "file", label: PAYMENT_TREE_LABEL },
      { path: PAGAMENTO_CONFIG_FILE, kind: "file", label: "Chave da Kyvo e produtos do pagamento (não compartilhe)" },
      { path: PAGAMENTO_HTACCESS_FILE, kind: "file", label: "Bloqueia a pasta da chave (Apache)" },
    );
  } else if (checkout) {
    const all = zipPaymentGateways(payment, checkout);
    tree.push(
      { path: PAGAMENTO_FILE, kind: "file", label: paymentTreeLabel(all) },
      {
        path: PAGAMENTO_CONFIG_FILE,
        kind: "file",
        label: `Chaves (${all.join(", ")}) e produtos do pagamento (não compartilhe)`,
      },
      { path: PAGAMENTO_HTACCESS_FILE, kind: "file", label: "Bloqueia a pasta das chaves e dos pedidos (Apache)" },
    );
  }
  tree.push({ path: README_FILE, kind: "file", label: "Como subir na hospedagem e testar" });

  return {
    options,
    layout,
    serverVendors,
    serverFiles,
    preserveJsPages,
    preserve,
    payment,
    checkoutPages,
    redirects,
    warnings,
    tree,
  };
}

function uniqueVendors(rows: { vendor: ServerEventVendor }[]): ServerEventVendor[] {
  const order: ServerEventVendor[] = ["META", "TIKTOK"];
  return order.filter((v) => rows.some((r) => r.vendor === v));
}

/** Algum documento da oferta tem og:image/twitter:image no HTML (sem ler o HTML inteiro para cá)? */
async function hasShareImageInHtml(offerId: string): Promise<boolean> {
  const where = (text: string) => ({
    html: { contains: text, mode: "insensitive" as const },
    variant: { page: { offerId } },
  });
  const count = await prisma.pageDocument.count({
    where: { OR: [where("og:image"), where("twitter:image")] },
  });
  return count > 0;
}

/**
 * Páginas com {{EMPRESA}}, {{CNPJ}} ou {{EMAIL}} e o campo da empresa vazio
 * (o marcador iria ao ar), sem trazer o HTML para cá. Telefone e endereço
 * vazios saem da página (a montagem confere o HTML final: build.ts).
 */
async function pagesWithUnfilledCompany(offerId: string, company: Company) {
  const missing = REQUIRED_COMPANY_MARKERS.filter((m) => !company[COMPANY_MARKER_FIELD[m]].trim());
  if (!missing.length) return [];
  const byPage = new Map<string, { name: string; position: number; markers: string[] }>();
  for (const marker of missing) {
    const docs = await prisma.pageDocument.findMany({
      where: { html: { contains: marker }, variant: { page: { offerId } } },
      select: { variant: { select: { page: { select: { id: true, name: true, position: true } } } } },
    });
    for (const { variant } of docs) {
      const entry = byPage.get(variant.page.id) ?? {
        name: variant.page.name,
        position: variant.page.position,
        markers: [],
      };
      if (!entry.markers.includes(marker)) entry.markers.push(marker);
      byPage.set(variant.page.id, entry);
    }
  }
  return [...byPage.values()].sort((a, b) => a.position - b.position);
}

/**
 * Links da oferta que ainda levam ao checkout encontrado na página original ao
 * clonar (a mesma regra do "Próximos passos": clonedCheckoutLinks). Pagamento
 * na página não conta: o endereço guardado dele não vai para a página.
 */
export async function clonedCheckoutPlan(offerId: string): Promise<{ linkId: string; label: string }[]> {
  const urls = (await prisma.checkoutLink.findMany({ where: { page: { offerId } }, select: { url: true } })).map(
    (c) => c.url,
  );
  if (!urls.length) return [];
  const links = await prisma.offerLink.findMany({
    where: { offerId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, label: true, url: true, target: true },
  });
  return clonedCheckoutLinks(links, urls).map((l) => ({ linkId: l.id, label: l.label }));
}

/** Documentos que podem ter um link sem destino (href "#", vazio ou javascript:). */
const NO_DESTINATION_HREFS = ['href="#"', "href='#'", 'href=""', "href=''", "javascript:"];

/**
 * Páginas com links de Política, Termos, Contato… sem destino (como o rodapé
 * dos modelos antes de a pessoa escolher as páginas). Páginas "Com scripts"
 * ficam de fora: lá um script da página pode cuidar do clique. Só lê o HTML
 * dos documentos com um href assim.
 */
export async function pagesWithDeadLegalLinks(offerId: string) {
  const docs = await prisma.pageDocument.findMany({
    where: {
      variant: { page: { offerId, cloneMode: { not: "PRESERVE_JS" } } },
      OR: NO_DESTINATION_HREFS.map((text) => ({ html: { contains: text, mode: "insensitive" as const } })),
    },
    orderBy: [{ variant: { isControl: "desc" } }, { device: "asc" }],
    select: {
      id: true,
      html: true,
      variant: { select: { page: { select: { id: true, name: true, position: true } } } },
    },
  });
  const byPage = new Map<string, { name: string; position: number; documentId: string; links: string[] }>();
  for (const doc of docs) {
    const links = deadLegalLinks(doc.html);
    if (!links.length) continue;
    const page = doc.variant.page;
    const entry = byPage.get(page.id);
    if (!entry) {
      byPage.set(page.id, { name: page.name, position: page.position, documentId: doc.id, links });
      continue;
    }
    // O mesmo link em outra versão A/B ou no layout do celular conta uma vez.
    // (Documentos em ordem: a versão de controle e o computador primeiro, que é o que o conserto abre.)
    for (const l of links) if (!entry.links.includes(l)) entry.links.push(l);
  }
  return [...byPage.values()].sort((a, b) => a.position - b.position);
}

const LINK_ATTR = "data-os-link";

/** O elemento leva a algum lugar? (mesma regra de applyOfferLinks/destinationOf: "#" e javascript: não levam.) */
function hasDestination(tag: string, attrs: Record<string, string | undefined>) {
  const dest = (value: string | undefined) => {
    const v = value?.trim() ?? "";
    return Boolean(v) && v !== "#" && !/^javascript:/i.test(v);
  };
  if (tag === "a" || tag === "area") return dest(attrs.href) || dest(attrs["data-os-href"]);
  if (tag === "form") return dest(attrs.action) || dest(attrs["data-os-href"]);
  return dest(attrs["data-os-href"]);
}

/**
 * Botões ligados a "nenhum" link da oferta (data-os-link="", como o botão de
 * compra dos modelos) ou a um link sem endereço, que iriam ao ar sem destino.
 * O botão final do quiz (data-os-qz-go) e o "Resgatar" da roleta
 * (data-os-wh-go) ficam em listas à parte: levam à próxima página do funil, não
 * ao checkout (o aviso deles é outro). Também junta os prêmios de roleta sem
 * link de checkout e, da loja (listas à parte: o conserto é no editor), os
 * cartões da vitrine sem destino, o "Ver todas" ligado sem destino, as
 * categorias do cabeçalho de loja que não mostram nenhum produto e o "‹ Voltar
 * para a loja" sem destino numa página sem a página da loja. Carrinho e
 * "Entre" desligados no cabeçalho não vão ao ar: não contam. Só lê o HTML das
 * páginas que têm um botão assim, roleta, vitrine ou cabeçalho de loja.
 */
async function pagesWithDeadButtons(
  offerId: string,
  links: { key: string; url: string; pay?: boolean; checkout?: boolean }[],
) {
  // Link de pagamento na página tem destino (a janela de pagamento), mesmo sem URL.
  const emptyKeys = links.filter((l) => !linkHasDestination(l)).map((l) => l.key);
  const dead = new Set(["", ...emptyKeys]);
  // Ligados a um "Checkout do Offer Studio" sem o produto salvo: o render tira o endereço que o elemento
  // tinha (o checkout da página clonada), então contam mesmo com href próprio.
  const ownDead = new Set(links.filter((l) => l.checkout !== undefined && !linkHasDestination(l)).map((l) => l.key));
  // "Checkout do Offer Studio" salvo: leva à página de checkout do ZIP (o cupom do prêmio não vale lá).
  const ownKeys = links.filter((l) => l.checkout === true && linkHasDestination(l)).map((l) => l.key);
  const docs = await prisma.pageDocument.findMany({
    where: {
      variant: { page: { offerId } },
      OR: [
        ...[...dead].map((key) => ({ html: { contains: `${LINK_ATTR}="${key}"` } })),
        { html: { contains: WHEEL_MARK } },
        { html: { contains: PRODUCT_MARK } },
        { html: { contains: STORE_HEADER_MARK } },
        { html: { contains: BACK_MARK } },
      ],
    },
    select: {
      id: true,
      device: true,
      html: true,
      variant: { select: { isControl: true, page: { select: { id: true, name: true, position: true } } } },
    },
  });
  // Produtos de cada página (uma entrada por versão): onde as categorias de uma
  // página sem vitrine buscam (a página da loja, destino do logo).
  const catalogs = new Map<string, Catalog[]>();
  for (const doc of docs) {
    const catalog = storeCatalog(doc.html);
    const pageId = doc.variant.page.id;
    if (catalog) catalogs.set(pageId, [...(catalogs.get(pageId) ?? []), catalog]);
  }
  const catalogsOf = (pageId: string) => catalogs.get(pageId) ?? [];
  const byPage = new Map<string, DeadPage>();
  for (const doc of docs) {
    if (!doc.html) continue;
    const $ = cheerio.load(doc.html);
    const found: Pick<
      DeadPage,
      "buttons" | "quizButtons" | "wheelButtons" | "prizes" | "products" | "categories" | "coupons"
    > = {
      buttons: [],
      quizButtons: [],
      wheelButtons: [],
      // Roleta com prêmio sem link de checkout (ou com link sem endereço).
      prizes: prizesWithoutLink(doc.html, links),
      // Prêmios com cupom que levam ao checkout do Offer Studio (sem campo de cupom).
      coupons: ownKeys.length ? ownCheckoutCoupons(doc.html, ownKeys) : [],
      // Cartões da vitrine sem a página do produto (nem link da oferta com destino) e "Ver todas" sem destino.
      products: productGaps(doc.html, links),
      // Categorias do cabeçalho de loja sem destino que não mostram nenhum produto.
      categories: categoryGaps(doc.html, links, catalogsOf),
    };
    // "‹ Voltar para a loja" sem destino e sem a página da loja no logo.
    const back = backGap(doc.html, links);
    $(`[${LINK_ATTR}]`).each((_, el) => {
      const node = $(el);
      if (!dead.has(node.attr(LINK_ATTR) ?? "")) return;
      // Cartão da vitrine: entra na lista dos produtos (acima), não na dos botões de compra.
      if (node.attr(PRODUCT_ATTR) !== undefined) return;
      if (!ownDead.has(node.attr(LINK_ATTR) ?? "") && hasDestination(el.tagName, node.attr() ?? {})) return;
      // Carrinho/"Entre" desligados no cabeçalho de loja (mesmo com o pedido de link): não vão ao ar.
      const header = node.closest(`[${STORE_HEADER_MARK}]`);
      if (
        header.length &&
        ((node.hasClass("os-sh-cart") && header.attr("data-os-sh-cart") === "0") ||
          (node.hasClass("os-sh-acc") && header.attr("data-os-sh-account") !== "1"))
      )
        return;
      const label = node.text() || node.attr("value") || node.attr("aria-label") || "";
      const list =
        node.attr("data-os-qz-go") !== undefined
          ? found.quizButtons
          : node.attr("data-os-wh-go") !== undefined
            ? found.wheelButtons
            : found.buttons;
      list.push(label);
    });
    if (!back && !Object.values(found).some((list) => list.length)) continue;
    const page = doc.variant.page;
    const entry = byPage.get(page.id);
    if (!entry) {
      byPage.set(page.id, { name: page.name, position: page.position, documentId: doc.id, back, ...found });
      continue;
    }
    entry.back = entry.back || back;
    // O mesmo botão (ou prêmio) em outra versão A/B ou no layout do celular conta uma vez.
    for (const k of ["buttons", "quizButtons", "wheelButtons", "prizes", "categories", "coupons"] as const) {
      for (const b of found[k]) if (!entry[k].includes(b)) entry[k].push(b);
    }
    mergeProductGaps(entry.products, found.products);
    if (doc.variant.isControl && doc.device !== "MOBILE") entry.documentId = doc.id;
  }
  return [...byPage.values()].sort((a, b) => a.position - b.position);
}

interface DeadPage {
  name: string;
  position: number;
  documentId: string;
  /** Botões de compra sem destino. */
  buttons: string[];
  /** Botões finais de quiz sem destino. */
  quizButtons: string[];
  /** "Resgatar" da roleta sem destino. */
  wheelButtons: string[];
  /** Prêmios da roleta sem link de checkout. */
  prizes: string[];
  /** Vitrines com cartões (ou "Ver todas") sem destino. */
  products: ProductGap[];
  /** Categorias do cabeçalho de loja que não mostram nenhum produto. */
  categories: string[];
  /** "‹ Voltar para a loja" sem destino (e sem a página da loja no logo). */
  back: boolean;
  /** Prêmios com cupom que levam a um "Checkout do Offer Studio" (a página de checkout não tem campo de cupom). */
  coupons: string[];
}

/** Prévia do ZIP com as opções escolhidas (padrão: ExportOptionsSchema). */
export async function exportPlan(offerId: string, rawOptions?: unknown): Promise<ExportPlan> {
  const options = parseExportOptions(rawOptions);
  const source = await loadExportSource(offerId, { withHtml: false });
  const [pixels, payment, checkout] = await Promise.all([
    serverEventPixels(offerId),
    loadPaymentExport(offerId),
    loadCheckoutExport(offerId),
  ]);
  const serverVendors = uniqueVendors(pixels);
  const ctx = planFrom(source, options, serverVendors, payment, checkout);
  const warnings = [...ctx.warnings];
  // Página clonada com imagem de compartilhamento própria e sem o endereço no
  // ar: sem endereço completo, o WhatsApp/Facebook não mostram a imagem.
  if (!source.offer.liveUrl && !warnings.includes(OG_IMAGE_WARNING) && (await hasShareImageInHtml(offerId))) {
    warnings.push(OG_IMAGE_WARNING);
  }
  // Checkout do dono da página clonada: o aviso mais grave (a venda vai para outra pessoa) vem antes.
  const cloned = await clonedCheckoutPlan(offerId);
  const clonedWarning = clonedCheckoutWarning(cloned.map((l) => l.label));
  if (clonedWarning) warnings.unshift(clonedWarning);
  const company = companyMarkersWarning(
    await pagesWithUnfilledCompany(offerId, parseOfferSettings(source.offer.settings).company),
  );
  if (company) warnings.push(company);
  const deadPages = await pagesWithDeadButtons(offerId, source.links);
  const dead = deadButtonsWarning(deadPages);
  if (dead) warnings.push(dead);
  const deadQuiz = deadQuizButtonsWarning(deadPages.map((p) => ({ name: p.name, buttons: p.quizButtons })));
  if (deadQuiz) warnings.push(deadQuiz);
  const prizes = wheelPrizesWarning(deadPages);
  if (prizes) warnings.push(prizes);
  const coupons = ownCheckoutCouponWarning(deadPages.map((p) => ({ name: p.name, prizes: p.coupons })));
  if (coupons) warnings.push(coupons);
  const deadWheel = deadWheelButtonsWarning(deadPages.map((p) => ({ name: p.name, buttons: p.wheelButtons })));
  if (deadWheel) warnings.push(deadWheel);
  const deadProducts = deadProductsWarning(deadPages.map((p) => ({ name: p.name, showcases: p.products })));
  if (deadProducts) warnings.push(deadProducts);
  const deadMore = deadMoreWarning(deadPages.map((p) => ({ name: p.name, showcases: p.products })));
  if (deadMore) warnings.push(deadMore);
  const deadCategories = deadCategoriesWarning(deadPages.map((p) => ({ name: p.name, categories: p.categories })));
  if (deadCategories) warnings.push(deadCategories);
  const deadBack = deadBackWarning(deadPages.filter((p) => p.back).map((p) => p.name));
  if (deadBack) warnings.push(deadBack);
  const legalPages = await pagesWithDeadLegalLinks(offerId);
  const deadLegal = deadLegalLinksWarning(legalPages);
  if (deadLegal) warnings.push(deadLegal);
  // Vitrines e caixas de compra que voltaram para a moeda de antes (Histórico, editor aberto antes da troca).
  const mismatch = await storeCurrencyMismatch(offerId);
  const currencyWarning =
    mismatch &&
    storeCurrencyWarning(
      mismatch.pages.map((p) => ({ name: p.pageName, hosts: p.hosts })),
      [...new Set(mismatch.pages.flatMap((p) => p.currencies))].map((c) => OFFER_CURRENCY_NAME[c]),
      OFFER_CURRENCY_NAME[mismatch.currency],
    );
  if (currencyWarning) warnings.push(currencyWarning);
  const fixablePages = deadPages.filter(
    (p) =>
      p.buttons.length ||
      p.quizButtons.length ||
      p.wheelButtons.length ||
      p.prizes.length ||
      p.coupons.length ||
      p.products.length ||
      p.categories.length ||
      p.back,
  );
  return {
    offerName: source.offer.name,
    hasVariants: source.pages.some((p) => p.variants.length > 1),
    hasServerEventTokens: serverVendors.length > 0,
    serverEventVendors: serverVendors,
    preserveJsPages: ctx.preserveJsPages,
    warnings,
    tree: ctx.tree,
    ...mergeAccessFixes(paymentPlanFixes(payment), checkoutPlanFixes(checkout)),
    // O pagamento.php e a pasta pagamento-dados vão no ZIP (pagamento na página OU checkout):
    // o "Como subir na hospedagem" avisa de não subir as chaves numa hospedagem sem PHP.
    ...((payment || checkout) && { hasPayments: true, paymentGateways: zipPaymentGateways(payment, checkout) }),
    ...(cloned.length > 0 && { clonedCheckoutLinks: cloned }),
    ...(legalPages.length > 0 && {
      legalLinkPages: legalPages.map((p) => ({ name: p.name, documentId: p.documentId })),
    }),
    ...(fixablePages.length > 0 && {
      deadButtonPages: fixablePages.map((p) => ({
        name: p.name,
        documentId: p.documentId,
        buy: p.buttons.length > 0,
        quiz: p.quizButtons.length > 0,
        wheel: p.wheelButtons.length > 0 || p.prizes.length > 0 || p.coupons.length > 0,
        ...((p.products.length > 0 || p.categories.length > 0 || p.back) && { products: true }),
      })),
    }),
  };
}

export { uniqueVendors };

/**
 * Gateways com chave no pagamento-dados/config.php do ZIP ("Kyvo", "FlevoPay",
 * "BlackCat"): a Kyvo com o pagamento na página e os dos checkouts.
 */
function zipPaymentGateways(payment: PaymentExport | null, checkout: CheckoutExport | null): string[] {
  const gateways = checkoutGateways(checkout).map((p) => PROVIDER_LABEL[p]);
  return payment ? [...new Set(["Kyvo", ...gateways])] : gateways;
}

/** Consertos do pagamento na página e do checkout juntos (as páginas de obrigado sem o acesso, sem repetir). */
function mergeAccessFixes(
  payment: { accessBlockPages?: { name: string; documentId: string }[] },
  checkout: ReturnType<typeof checkoutPlanFixes>,
) {
  const pages = [...(payment.accessBlockPages ?? []), ...(checkout.accessBlockPages ?? [])].filter(
    (p, i, all) => all.findIndex((x) => x.documentId === p.documentId) === i,
  );
  return { ...payment, ...checkout, ...(pages.length ? { accessBlockPages: pages } : {}) };
}
