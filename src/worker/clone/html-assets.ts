/**
 * Referências a arquivos dentro do HTML: coleta e reescrita.
 *
 * Cobre img/srcset, picture/source, vídeo e áudio, link (CSS, ícones,
 * preload), script, meta og:image/twitter:image, SVG (use/image), input
 * image, object, iframe (só informado), atributos style="" e blocos <style>.
 * Respeita <base href> na resolução.
 */
import type { CheerioAPI } from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { parseSrcset, type SrcSetDefinition, stringifySrcset } from "srcset";
import { type CssOccurrence, findCssOccurrences, rewriteCssWith } from "./css";
import { relativeToPage } from "./synthetic";
import { ASSET_PREFIX } from "./types";
import { absolutize, extensionFromPath, fragmentOf, isHttpUrl } from "./urls";

export type HtmlRefKind = "stylesheet" | "script" | "image" | "font" | "media" | "icon" | "iframe" | "other";

/** Referência encontrada no HTML (URL absoluta, sem #hash). */
export interface HtmlRef {
  url: string;
  kind: HtmlRefKind;
  /**
   * Atributo de origem ("src", "srcset", "href", "content", "poster"…).
   * "style" = atributo style=""; "#style" = conteúdo de um bloco <style>.
   */
  attr: string;
}

/** Função de troca: devolve o novo endereço, ou null para manter. */
export type HtmlUrlMap = (absUrl: string, ref: HtmlRef) => string | null;

/** Tipo fixo ou decidido pela URL (ex.: preload sem `as`). */
type SlotKind = HtmlRefKind | ((url: string) => HtmlRefKind);

type Slot =
  | { type: "url"; el: Element; attr: string; kind: SlotKind }
  | { type: "srcset"; el: Element; attr: string; kind: HtmlRefKind }
  | { type: "css"; el: Element; attr: "style" | "#style" };

const ICON_RELS = new Set([
  "icon",
  "shortcut",
  "apple-touch-icon",
  "apple-touch-icon-precomposed",
  "mask-icon",
  "fluid-icon",
]);
const META_IMAGE_KEYS = new Set([
  "og:image",
  "og:image:url",
  "og:image:secure_url",
  "twitter:image",
  "twitter:image:src",
  "image",
  "thumbnail",
]);
const BACKGROUND_TAGS = new Set(["body", "table", "td", "th", "tr"]);
const FONT_EXTS = new Set(["woff2", "woff", "ttf", "otf", "eot"]);
const IMAGE_EXTS = new Set(["png", "jpg", "webp", "avif", "gif", "svg", "ico"]);
const MEDIA_EXTS = new Set(["mp4", "webm", "mp3"]);

/** Tipo provável pela extensão do caminho. */
export function guessKindFromUrl(url: string, fallback: HtmlRefKind): HtmlRefKind {
  const ext = extensionFromPath(url);
  if (!ext) return fallback;
  if (ext === "css") return "stylesheet";
  if (ext === "js") return "script";
  if (FONT_EXTS.has(ext)) return "font";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (MEDIA_EXTS.has(ext)) return "media";
  return fallback;
}

/**
 * Base do documento: o <base href> (se válido) ou a URL da página.
 * `changed` = o <base> aponta para outro lugar que não a própria página.
 */
function baseInfo($: CheerioAPI, pageUrl: string): { base: string; changed: boolean } {
  const page = absolutize(pageUrl, pageUrl) ?? pageUrl;
  const href = $("base[href]").first().attr("href");
  const resolved = href ? absolutize(href, page) : null;
  if (isHttpUrl(resolved) && resolved !== page) return { base: resolved, changed: true };
  return { base: page, changed: false };
}

/** Endereço base do documento: o <base href> (se válido) ou a URL da página. */
export function documentBase($: CheerioAPI, pageUrl: string): string {
  return baseInfo($, pageUrl).base;
}

function tokens(value: string | undefined): string[] {
  return (value ?? "").toLowerCase().split(/\s+/).filter(Boolean);
}

function kindFromPreloadAs(as: string | undefined): SlotKind {
  switch ((as ?? "").trim().toLowerCase()) {
    case "style":
      return "stylesheet";
    case "script":
    case "worker":
    case "sharedworker":
    case "serviceworker":
      return "script";
    case "font":
      return "font";
    case "image":
      return "image";
    case "video":
    case "audio":
    case "track":
      return "media";
    case "":
      return (url) => guessKindFromUrl(url, "other");
    default:
      return "other";
  }
}

/** Lista os pontos do elemento que podem conter referências. */
function slotsOf(el: Element, out: Slot[]): void {
  const name = el.name.toLowerCase();
  const attrs = el.attribs;
  const has = (a: string) => attrs[a] !== undefined;

  switch (name) {
    case "img":
      if (has("src")) out.push({ type: "url", el, attr: "src", kind: "image" });
      if (has("srcset")) out.push({ type: "srcset", el, attr: "srcset", kind: "image" });
      break;
    case "source": {
      const parent = el.parent && "name" in el.parent ? (el.parent as Element).name.toLowerCase() : "";
      const kind: HtmlRefKind = parent === "picture" ? "image" : "media";
      if (has("src")) out.push({ type: "url", el, attr: "src", kind });
      if (has("srcset")) out.push({ type: "srcset", el, attr: "srcset", kind: "image" });
      break;
    }
    case "video":
      if (has("poster")) out.push({ type: "url", el, attr: "poster", kind: "image" });
      if (has("src")) out.push({ type: "url", el, attr: "src", kind: "media" });
      break;
    case "audio":
      if (has("src")) out.push({ type: "url", el, attr: "src", kind: "media" });
      break;
    case "track":
      if (has("src")) out.push({ type: "url", el, attr: "src", kind: "other" });
      break;
    case "link": {
      if (!has("href") && !has("imagesrcset")) break;
      const rel = tokens(attrs.rel);
      let kind: SlotKind;
      if (rel.includes("stylesheet")) kind = "stylesheet";
      else if (rel.some((r) => ICON_RELS.has(r))) kind = "icon";
      else if (rel.includes("manifest")) kind = "other";
      else if (rel.includes("modulepreload")) kind = "script";
      else if (rel.includes("preload") || rel.includes("prefetch")) kind = kindFromPreloadAs(attrs.as);
      else if (rel.includes("image_src")) kind = "image";
      else break;
      if (has("href")) out.push({ type: "url", el, attr: "href", kind });
      if (has("imagesrcset") && rel.includes("preload")) {
        out.push({ type: "srcset", el, attr: "imagesrcset", kind: "image" });
      }
      break;
    }
    case "script":
      if (has("src")) out.push({ type: "url", el, attr: "src", kind: "script" });
      break;
    case "meta": {
      if (!has("content")) break;
      const key = (attrs.property ?? attrs.name ?? attrs.itemprop ?? "").trim().toLowerCase();
      if (META_IMAGE_KEYS.has(key)) out.push({ type: "url", el, attr: "content", kind: "image" });
      else if (key === "msapplication-tileimage") out.push({ type: "url", el, attr: "content", kind: "icon" });
      break;
    }
    case "use":
    case "image":
      // SVG. Com o parser HTML (parse5) "xlink:href" vira a chave "href"; no modo XML fica "xlink:href".
      for (const attr of ["href", "xlink:href"]) {
        const value = attrs[attr];
        if (value === undefined) continue;
        if (name === "use" && value.trim().startsWith("#")) continue; // símbolo no próprio documento
        out.push({ type: "url", el, attr, kind: "image" });
      }
      break;
    case "input":
      if (has("src") && (attrs.type ?? "").trim().toLowerCase() === "image") {
        out.push({ type: "url", el, attr: "src", kind: "image" });
      }
      break;
    case "object":
      if (has("data")) out.push({ type: "url", el, attr: "data", kind: (url) => guessKindFromUrl(url, "other") });
      break;
    case "iframe":
    case "frame":
      if (has("src")) out.push({ type: "url", el, attr: "src", kind: "iframe" });
      break;
    case "style": {
      const type = (attrs.type ?? "").trim().toLowerCase();
      if (!type || type === "text/css") out.push({ type: "css", el, attr: "#style" });
      break;
    }
  }
  if (has("background") && BACKGROUND_TAGS.has(name)) {
    out.push({ type: "url", el, attr: "background", kind: "image" });
  }
  if (has("style") && attrs.style?.trim()) out.push({ type: "css", el, attr: "style" });
}

/**
 * Valor que já é um arquivo do clone (`/os-assets/…`): nunca é coletado nem
 * reescrito de novo (senão, com um <base href> de outro host, viraria
 * `https://outro-host/os-assets/…`).
 */
function isLocalAsset(value: string): boolean {
  return value.trim().startsWith(ASSET_PREFIX);
}

/** Nó é um elemento (tem nome e atributos)? */
export function isElement(node: AnyNode): node is Element {
  return "attribs" in node && "name" in node;
}

function allSlots($: CheerioAPI): Slot[] {
  const out: Slot[] = [];
  $("*").each((_, node) => {
    if (isElement(node)) slotsOf(node, out);
  });
  return out;
}

function slotKind(slot: Extract<Slot, { type: "url" }>, url: string): HtmlRefKind {
  return typeof slot.kind === "function" ? slot.kind(url) : slot.kind;
}

function cssOccurrenceKind(occ: CssOccurrence, url: string): HtmlRefKind {
  if (occ.kind === "import") return "stylesheet";
  if (occ.font) return "font";
  return guessKindFromUrl(url, "image");
}

function cssText($: CheerioAPI, slot: Extract<Slot, { type: "css" }>): string {
  return slot.attr === "style" ? (slot.el.attribs.style ?? "") : $(slot.el).text();
}

/** Candidatos de um srcset, com a URL original de cada um. */
function srcsetCandidates(value: string): SrcSetDefinition[] {
  try {
    return parseSrcset(value).filter((c) => c.url);
  } catch {
    return [];
  }
}

/**
 * Lista as referências a arquivos do documento (sem repetir URL + tipo).
 * Só URLs http(s); data:, blob:, `#fragmento` etc. ficam de fora, assim como
 * o que já é `/os-assets/…`. Iframes aparecem com kind "iframe" (o construtor
 * não baixa, só informa).
 */
export function collectHtmlRefs($: CheerioAPI, baseUrl: string): HtmlRef[] {
  const base = documentBase($, baseUrl);
  const seen = new Set<string>();
  const refs: HtmlRef[] = [];
  const add = (url: string | null, kind: HtmlRefKind, attr: string) => {
    if (!isHttpUrl(url)) return;
    const key = `${kind} ${url}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ url, kind, attr });
  };

  for (const slot of allSlots($)) {
    if (slot.type === "url") {
      const raw = slot.el.attribs[slot.attr] ?? "";
      if (isLocalAsset(raw)) continue;
      const url = absolutize(raw, base);
      if (url) add(url, slotKind(slot, url), slot.attr);
    } else if (slot.type === "srcset") {
      for (const c of srcsetCandidates(slot.el.attribs[slot.attr] ?? "")) {
        if (!isLocalAsset(c.url)) add(absolutize(c.url, base), slot.kind, slot.attr);
      }
    } else {
      const text = cssText($, slot);
      for (const occ of findCssOccurrences(text, { inline: slot.attr === "style" })) {
        if (isLocalAsset(occ.value)) continue;
        const url = absolutize(occ.value, base);
        if (url) add(url, cssOccurrenceKind(occ, url), slot.attr);
      }
    }
  }
  return refs;
}

export interface RewriteOptions {
  /**
   * Origem interna de importação (ZIP/HTML colado sem link de origem): o que
   * ficaria absoluto nela vira caminho relativo à página (o host não existe).
   */
  localOrigin?: string | null;
}

/** Endereço absoluto como deve ficar no HTML: relativo à página quando é da origem interna. */
function keepAddress(absUrl: string, pageUrl: string, options: RewriteOptions): string {
  if (!options.localOrigin) return absUrl;
  try {
    const u = new URL(absUrl);
    return u.origin === options.localOrigin ? relativeToPage(u, pageUrl) : absUrl;
  } catch {
    return absUrl;
  }
}

/**
 * Reescreve as referências do documento para as quais `map` devolve um valor
 * (mesmos pontos de `collectHtmlRefs`). srcset: troca cada candidato e mantém
 * os descritores. Tira `integrity` de link/script reescritos e remove <base>.
 *
 * Quando havia um <base href> diferente da página, as referências que o `map`
 * não troca viram absolutas (senão mudariam de destino sem o <base>) — ou
 * relativas à página, se forem da origem interna (`options.localOrigin`).
 * Valores que já são `/os-assets/…` ficam como estão.
 */
export function rewriteHtmlRefs($: CheerioAPI, baseUrl: string, map: HtmlUrlMap, options: RewriteOptions = {}): void {
  const { base, changed: baseChanged } = baseInfo($, baseUrl);
  const unmapped = (absUrl: string) => (baseChanged ? keepAddress(absUrl, baseUrl, options) : null);
  const resolve = (absUrl: string, ref: HtmlRef, original: string): string | null => {
    const next = map(absUrl, ref) ?? unmapped(absUrl);
    if (next == null) return null;
    return next.includes("#") ? next : next + fragmentOf(original);
  };
  const touched = new Set<Element>();

  for (const slot of allSlots($)) {
    const { el } = slot;
    if (slot.type === "url") {
      const raw = el.attribs[slot.attr] ?? "";
      if (isLocalAsset(raw)) continue;
      const url = absolutize(raw, base);
      if (!isHttpUrl(url)) continue;
      const next = resolve(url, { url, kind: slotKind(slot, url), attr: slot.attr }, raw);
      if (next == null || next === raw) continue;
      el.attribs[slot.attr] = next;
      touched.add(el);
    } else if (slot.type === "srcset") {
      const raw = el.attribs[slot.attr] ?? "";
      let changed = false;
      const candidates = srcsetCandidates(raw).map((c) => {
        if (isLocalAsset(c.url)) return c;
        const url = absolutize(c.url, base);
        if (!isHttpUrl(url)) return c;
        const next = resolve(url, { url, kind: slot.kind, attr: slot.attr }, c.url);
        if (next == null || next === c.url) return c;
        changed = true;
        return { ...c, url: next };
      });
      if (!changed) continue;
      el.attribs[slot.attr] = stringifySrcset(candidates);
      touched.add(el);
    } else {
      const text = cssText($, slot);
      const inline = slot.attr === "style";
      const next = rewriteCssWith(
        text,
        base,
        (absUrl, occ) => {
          if (isLocalAsset(occ.value)) return null;
          const ref: HtmlRef = { url: absUrl, kind: cssOccurrenceKind(occ, absUrl), attr: slot.attr };
          // O fragmento já é preservado por rewriteCssWith.
          return map(absUrl, ref) ?? unmapped(absUrl);
        },
        { inline },
      );
      if (next === text) continue;
      if (inline) el.attribs.style = next;
      else $(el).text(next);
    }
  }

  for (const el of touched) {
    const name = el.name.toLowerCase();
    if ((name === "link" || name === "script") && el.attribs.integrity !== undefined) {
      delete el.attribs.integrity;
    }
  }
  removeBaseTag($, baseUrl, options);
}

/** Resolve um link mantendo o #hash; null quando não precisa mudar. */
function absoluteLink(raw: string, base: string): string | null {
  const value = raw.trim();
  if (!value || value.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  try {
    return new URL(value, base).href;
  } catch {
    return null;
  }
}

/**
 * Remove as tags <base>. Repassa o `target` do <base> (se não for "_self")
 * para links e formulários sem um. Com `pageUrl`, antes torna absolutos os
 * links (a/area[href], form[action]) que dependiam de um <base href>
 * diferente da página (na origem interna de importação, relativos à página).
 */
export function removeBaseTag($: CheerioAPI, pageUrl?: string, options: RewriteOptions = {}): void {
  const bases = $("base");
  if (!bases.length) return;
  if (pageUrl) {
    const { base, changed } = baseInfo($, pageUrl);
    if (changed) {
      const fix = (raw: string) => {
        const next = absoluteLink(raw, base);
        return next ? keepAddress(next, pageUrl, options) : null;
      };
      $("a[href], area[href]").each((_, el) => {
        const next = fix(el.attribs.href ?? "");
        if (next) el.attribs.href = next;
      });
      $("form[action]").each((_, el) => {
        const next = fix(el.attribs.action ?? "");
        if (next) el.attribs.action = next;
      });
    }
  }
  const target = $("base[target]").first().attr("target")?.trim();
  if (target && target.toLowerCase() !== "_self") {
    $("a[href], area[href], form").each((_, el) => {
      if (el.attribs.target === undefined) el.attribs.target = target;
    });
  }
  bases.remove();
}
