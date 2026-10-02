/**
 * Prévia do ZIP (ExportPlan): estrutura de pastas, avisos e o que vai dentro,
 * sem montar as páginas (barata: não lê o HTML dos documentos).
 */
import * as cheerio from "cheerio";
import { prisma } from "@/lib/db";
import { type Layout, layoutTree, planLayout } from "@/lib/export/layout";
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
import { EVENTOS_CONFIG_FILE, EVENTOS_FILE, HTACCESS_FILE } from "@/lib/export/php";
import {
  COMPANY_MARKER_FIELD,
  companyMarkersWarning,
  deadButtonsWarning,
  OG_IMAGE_WARNING,
  REQUIRED_COMPANY_MARKERS,
} from "@/lib/export/warnings";
import { type Company, effectiveSeo, parseOfferSettings, parsePageSeo } from "@/lib/offer-settings";
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

/** Caminhos do ZIP que não são do "Preservar JS" (prévia: os scripts do Offer Studio entram como "assets/"). */
export function reservedZipPaths(layout: Layout, extra: Iterable<string> = []): string[] {
  return [
    ...layout.files.map((f) => f.path),
    NOT_FOUND_FILE,
    EVENTOS_FILE,
    EVENTOS_CONFIG_FILE,
    HTACCESS_FILE,
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
  warnings: string[];
  tree: ExportTreeItem[];
}

/** Avisos e árvore comuns à prévia e à montagem. */
export function planFrom(
  source: ExportSource,
  options: ExportOptions,
  serverVendors: ServerEventVendor[],
): PlanContext {
  const layout = planLayout(layoutPages(source), { splitter: options.splitter });
  const warnings = [...layout.warnings];
  const serverFiles = options.serverEvents && serverVendors.length > 0;

  const preservePages = source.pages.filter((p) => p.cloneMode === "PRESERVE_JS");
  const preserveJsPages = preservePages.map((p) => p.name);
  if (preserveJsPages.length) {
    const names = preserveJsPages.map((n) => `“${n}”`).join(", ");
    warnings.push(
      `${preserveJsPages.length > 1 ? "As páginas" : "A página"} ${names} ${preserveJsPages.length > 1 ? "usam" : "usa"} “Preservar JS”: suba a oferta na raiz do domínio (public_html), não numa subpasta, senão os scripts originais não carregam.`,
    );
  }
  for (const page of preservePages) {
    if (page.variants.length > 1) {
      warnings.push(
        `A página “${page.name}” usa “Preservar JS” e tem versões A/B: cada versão fica na pasta dela (oferta-a/, oferta-b/…), com cópias dos arquivos originais, mas scripts que leem o endereço da página podem não funcionar lá. Teste cada versão depois de subir.`,
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

  const settings = parseOfferSettings(source.offer.settings);
  const hasOgImage = source.pages.some((p) => effectiveSeo(settings, parsePageSeo(p.seo)).ogImageKey);
  if (hasOgImage && !source.offer.liveUrl) warnings.push(OG_IMAGE_WARNING);

  const preserve: PreservePlan = preservePages.length
    ? planPreserveFiles(source, layout, reservedZipPaths(layout, [SCRIPT_PLACEHOLDER]))
    : { entries: [], collisions: [], blocked: [] };
  if (preserve.collisions.length) {
    const list = preserve.collisions.slice(0, 3).join(", ");
    warnings.push(
      `${preserve.collisions.length} arquivo(s) do “Preservar JS” tinham o mesmo caminho (ou o nome de uma pasta) de outro arquivo da oferta e ficaram de fora (ex.: ${list}).`,
    );
  }
  if (preserve.blocked.length) {
    const list = preserve.blocked.slice(0, 3).join(", ");
    warnings.push(
      `${preserve.blocked.length} arquivo(s) do site original que rodariam como programa na hospedagem (.php, .htaccess…) ficaram de fora por segurança (ex.: ${list}).`,
    );
  }

  const tree: ExportTreeItem[] = layoutTree(layout);
  const roots = preserveJsRoots(preserve);
  for (const page of preservePages) {
    for (const root of roots.get(page.id) ?? []) {
      tree.push({ path: root, kind: "file", label: `Arquivos originais de “${page.name}” (Preservar JS)` });
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
  tree.push({ path: README_FILE, kind: "file", label: "Como subir na hospedagem e testar" });

  return { options, layout, serverVendors, serverFiles, preserveJsPages, preserve, warnings, tree };
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
 * Só lê o HTML das páginas que têm um botão assim.
 */
async function pagesWithDeadButtons(offerId: string, links: { key: string; url: string }[]) {
  const emptyKeys = links.filter((l) => !l.url.trim()).map((l) => l.key);
  const dead = new Set(["", ...emptyKeys]);
  const docs = await prisma.pageDocument.findMany({
    where: {
      variant: { page: { offerId } },
      OR: [...dead].map((key) => ({ html: { contains: `${LINK_ATTR}="${key}"` } })),
    },
    select: {
      id: true,
      device: true,
      html: true,
      variant: { select: { isControl: true, page: { select: { id: true, name: true, position: true } } } },
    },
  });
  const byPage = new Map<string, { name: string; position: number; documentId: string; buttons: string[] }>();
  for (const doc of docs) {
    if (!doc.html) continue;
    const $ = cheerio.load(doc.html);
    const buttons: string[] = [];
    $(`[${LINK_ATTR}]`).each((_, el) => {
      const node = $(el);
      if (!dead.has(node.attr(LINK_ATTR) ?? "")) return;
      if (hasDestination(el.tagName, node.attr() ?? {})) return;
      buttons.push(node.text() || node.attr("value") || node.attr("aria-label") || "");
    });
    if (!buttons.length) continue;
    const page = doc.variant.page;
    const entry = byPage.get(page.id);
    if (!entry) {
      byPage.set(page.id, { name: page.name, position: page.position, documentId: doc.id, buttons });
      continue;
    }
    // O mesmo botão em outra versão A/B ou no layout do celular conta uma vez.
    for (const b of buttons) if (!entry.buttons.includes(b)) entry.buttons.push(b);
    if (doc.variant.isControl && doc.device !== "MOBILE") entry.documentId = doc.id;
  }
  return [...byPage.values()].sort((a, b) => a.position - b.position);
}

/** Prévia do ZIP com as opções escolhidas (padrão: ExportOptionsSchema). */
export async function exportPlan(offerId: string, rawOptions?: unknown): Promise<ExportPlan> {
  const options = parseExportOptions(rawOptions);
  const source = await loadExportSource(offerId, { withHtml: false });
  const serverVendors = uniqueVendors(await serverEventPixels(offerId));
  const ctx = planFrom(source, options, serverVendors);
  const warnings = [...ctx.warnings];
  // Página clonada com imagem de compartilhamento própria e sem o endereço no
  // ar: sem endereço completo, o WhatsApp/Facebook não mostram a imagem.
  if (!source.offer.liveUrl && !warnings.includes(OG_IMAGE_WARNING) && (await hasShareImageInHtml(offerId))) {
    warnings.push(OG_IMAGE_WARNING);
  }
  const company = companyMarkersWarning(
    await pagesWithUnfilledCompany(offerId, parseOfferSettings(source.offer.settings).company),
  );
  if (company) warnings.push(company);
  const deadPages = await pagesWithDeadButtons(offerId, source.links);
  const dead = deadButtonsWarning(deadPages);
  if (dead) warnings.push(dead);
  return {
    offerName: source.offer.name,
    hasVariants: source.pages.some((p) => p.variants.length > 1),
    hasServerEventTokens: serverVendors.length > 0,
    serverEventVendors: serverVendors,
    preserveJsPages: ctx.preserveJsPages,
    warnings,
    tree: ctx.tree,
    ...(deadPages.length > 0 && {
      deadButtonPages: deadPages.map((p) => ({ name: p.name, documentId: p.documentId })),
    }),
  };
}

export { uniqueVendors };
