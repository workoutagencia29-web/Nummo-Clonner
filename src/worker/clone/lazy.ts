/**
 * Normalização de "lazy load": leva para src/srcset/background-image os
 * endereços reais que os plugins guardam em data-* (lazysizes, jQuery
 * lazyload, WP Rocket, LiteSpeed, a3, Jetpack, Elementor…) e tira as classes
 * que escondem o conteúdo até o JavaScript rodar.
 *
 * Chame ANTES de collectHtmlRefs/rewriteHtmlRefs, para os endereços reais
 * serem baixados e reescritos. `loading="lazy"` (nativo) é mantido.
 */
import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import { parseSrcset } from "srcset";
import { isElement } from "./html-assets";

const SRC_ATTRS = ["data-src", "data-lazy-src", "data-original", "data-lazyload", "data-ll-src"];
const SRCSET_ATTRS = ["data-srcset", "data-lazy-srcset"];
const SIZES_ATTRS = ["data-sizes", "data-lazy-sizes"];
const BG_ATTRS = ["data-bg", "data-background", "data-background-image", "data-bg-src", "data-bg-image"];

/** Elementos que aceitam `src`. */
const SRC_TAGS = new Set(["img", "iframe", "video", "audio", "source", "embed", "track", "input"]);
const SRCSET_TAGS = new Set(["img", "source"]);
const MEDIA_TAGS = new Set(["img", "iframe", "video", "source"]);

/** Classes que indicam lazy load: com elas, até um src "real" (LQIP) é trocado. */
const LAZY_CLASSES = new Set([
  "lazyload",
  "lazyloading",
  "rocket-lazyload",
  "lazy-hidden",
  "jetpack-lazy-image",
  "lazy",
]);

/** Arquivos típicos de "espaço reservado" (gif/svg transparente, spinner…). */
const PLACEHOLDER_FILE =
  /^(?:[\w-]*[-_])?(?:blank|spacer|pixel|transparent|placeholder|lazy|lazyload|empty|1x1|loading|loader|grey|gray|clear|trans|dummy|px)(?:[-_][\w-]*)?\.(?:gif|svg|png|webp)$/i;

/** true quando o valor de src é vazio, data:, about:blank ou um placeholder conhecido. */
export function isPlaceholderSrc(value: string | undefined): boolean {
  const v = (value ?? "").trim();
  if (!v) return true;
  const low = v.toLowerCase();
  if (low.startsWith("data:") || low.startsWith("about:blank") || low === "#" || low.startsWith("javascript:")) {
    return true;
  }
  const path = low.split(/[?#]/)[0] ?? "";
  const file = path.split("/").pop() ?? "";
  return PLACEHOLDER_FILE.test(file);
}

function isPlaceholderSrcset(value: string | undefined): boolean {
  const v = (value ?? "").trim();
  if (!v || v.toLowerCase().startsWith("data:")) return true;
  let urls: string[];
  try {
    urls = parseSrcset(v).map((c) => c.url);
  } catch {
    return false;
  }
  return urls.length === 0 || urls.every((u) => isPlaceholderSrc(u));
}

/** Valor de data-* aproveitável (não vazio, não placeholder, não template). */
function usable(value: string | undefined): value is string {
  if (value === undefined) return false;
  const v = value.trim();
  return !!v && !isPlaceholderSrc(v) && !v.includes("{{") && !v.includes("${");
}

function classList(el: Element): string[] {
  return (el.attribs.class ?? "").split(/\s+/).filter(Boolean);
}

function setClasses(el: Element, remove: string[], add: string[]): boolean {
  const current = classList(el);
  const next = current.filter((c) => !remove.includes(c));
  for (const c of add) if (!next.includes(c)) next.push(c);
  if (next.length === current.length && next.every((c, i) => c === current[i])) return false;
  el.attribs.class = next.join(" ");
  return true;
}

// ─── Fundo (background-image) ────────────────────────────────────────────────

/** Parece um endereço de imagem (e não uma cor)? */
function looksLikeImage(value: string): boolean {
  const v = value.trim();
  if (!v || /^(?:#|rgba?\(|hsla?\(|transparent|none|inherit|initial)/i.test(v)) return false;
  return (
    /\burl\(|gradient\(|image-set\(/i.test(v) ||
    /^(?:https?:)?\/\//i.test(v) ||
    /^\.{0,2}\//.test(v) ||
    /^data:image\//i.test(v) ||
    /\.(?:jpe?g|png|gif|webp|avif|svg)(?:[?#]|$)/i.test(v)
  );
}

/** Converte o valor do data-bg em valor de background-image. */
function toBackgroundImage(value: string): string {
  const v = value.trim();
  if (/\burl\(|gradient\(|image-set\(/i.test(v)) return v;
  // lozad aceita várias imagens separadas por vírgula; vírgulas dentro da URL (Cloudinary) são mantidas.
  const parts = v.split(/,\s*(?=(?:https?:)?\/\/|\/|\.{1,2}\/)/);
  return parts.map((p) => `url("${p.trim().replace(/["\\]/g, "\\$&")}")`).join(", ");
}

/** Divide um style="" em declarações (respeitando parênteses e aspas). */
function splitDeclarations(style: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < style.length; i++) {
    const ch = style[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === ";" && depth === 0) {
      out.push(style.slice(start, i));
      start = i + 1;
    }
  }
  out.push(style.slice(start));
  return out.map((d) => d.trim()).filter(Boolean);
}

const BG_IMAGE_DECL = /^background-image\s*:/i;

function getBackgroundImage(style: string | undefined): string | null {
  const decl = splitDeclarations(style ?? "").findLast((d) => BG_IMAGE_DECL.test(d));
  return decl ? decl.replace(BG_IMAGE_DECL, "").trim() : null;
}

function setBackgroundImage(style: string | undefined, value: string): string {
  const decls = splitDeclarations(style ?? "").filter((d) => !BG_IMAGE_DECL.test(d));
  decls.push(`background-image: ${value}`);
  return `${decls.join("; ")};`;
}

function isPlaceholderBackground(value: string | null): boolean {
  if (value == null) return true;
  const v = value.replace(/!important/i, "").trim();
  if (!v || /^(?:none|initial|inherit|unset)$/i.test(v)) return true;
  const url = /url\(\s*(['"]?)(.*?)\1\s*\)/i.exec(v)?.[2];
  return url !== undefined && isPlaceholderSrc(url);
}

// ─── Elemento ────────────────────────────────────────────────────────────────

/** O elemento já mostra uma mídia real (mas pode estar escondido por classe)? */
function hasRealMedia(el: Element, name: string): boolean {
  if (!MEDIA_TAGS.has(name)) return false;
  const { src, srcset } = el.attribs;
  return (src !== undefined && !isPlaceholderSrc(src)) || (srcset !== undefined && !isPlaceholderSrcset(srcset));
}

function normalizeElement(el: Element): boolean {
  const name = el.name.toLowerCase();
  const a = el.attribs;
  const classes = classList(el);
  const lazyClass = classes.some((c) => LAZY_CLASSES.has(c));
  let changed = false;
  let applied = false;
  let bgApplied = false;

  // src
  const acceptsSrc = SRC_TAGS.has(name) && (name !== "input" || (a.type ?? "").trim().toLowerCase() === "image");
  if (acceptsSrc) {
    const key = SRC_ATTRS.find((k) => usable(a[k]));
    if (key) {
      const value = (a[key] ?? "").trim();
      const current = a.src?.trim();
      if (current === value) {
        applied = true;
      } else if (current === undefined || isPlaceholderSrc(current) || lazyClass) {
        a.src = value;
        applied = true;
      }
      if (applied) {
        for (const k of SRC_ATTRS) if (a[k]?.trim() === value) delete a[k];
        changed = true;
      }
    }
  }

  // srcset (+ sizes)
  if (SRCSET_TAGS.has(name)) {
    const key = SRCSET_ATTRS.find((k) => usable(a[k]));
    if (key) {
      const value = (a[key] ?? "").trim();
      const current = a.srcset?.trim();
      let done = current === value;
      if (!done && (current === undefined || isPlaceholderSrcset(current) || lazyClass || applied)) {
        a.srcset = value;
        done = true;
      }
      if (done) {
        for (const k of SRCSET_ATTRS) if (a[k]?.trim() === value) delete a[k];
        applied = true;
        changed = true;
        const sizesKey = SIZES_ATTRS.find((k) => a[k]?.trim());
        const sizes = sizesKey ? (a[sizesKey] ?? "").trim() : "";
        if (sizesKey && sizes.toLowerCase() !== "auto" && !a.sizes?.trim()) {
          a.sizes = sizes;
          delete a[sizesKey];
        }
      }
    }
  }

  // poster de vídeo
  if (name === "video" && usable(a["data-poster"]) && isPlaceholderSrc(a.poster)) {
    a.poster = (a["data-poster"] ?? "").trim();
    delete a["data-poster"];
    applied = true;
    changed = true;
  }

  // fundo
  const bgKey = BG_ATTRS.find((k) => a[k] !== undefined && looksLikeImage(a[k] ?? ""));
  if (bgKey) {
    const value = toBackgroundImage(a[bgKey] ?? "");
    const existing = getBackgroundImage(a.style);
    const same = (x: string) => x.replace(/!important/i, "").replace(/[\s"']/g, "");
    let done = existing !== null && same(existing) === same(value);
    if (!done && (isPlaceholderBackground(existing) || lazyClass)) {
      a.style = setBackgroundImage(a.style, value);
      done = true;
    }
    if (done) {
      delete a[bgKey];
      applied = true;
      bgApplied = true;
      changed = true;
    }
  }

  // Classes/atributos que escondem o conteúdo até o JS rodar.
  if (applied || hasRealMedia(el, name)) {
    if (classes.includes("lazyload") || classes.includes("lazyloading") || classes.includes("rocket-lazyload")) {
      changed = setClasses(el, ["lazyload", "lazyloading", "rocket-lazyload"], ["lazyloaded"]) || changed;
    }
    if (classes.includes("lazy-hidden")) {
      changed = setClasses(el, ["lazy-hidden"], ["lazy-loaded"]) || changed;
    }
    if (classes.includes("jetpack-lazy-image")) {
      changed = setClasses(el, [], ["jetpack-lazy-image--handled"]) || changed;
    }
    if (a["data-lazyloaded"] !== undefined) {
      // LiteSpeed: img[data-lazyloaded]{opacity:0} até ganhar .litespeed-loaded
      delete a["data-lazyloaded"];
      setClasses(el, [], ["litespeed-loaded"]);
      changed = true;
    }
  }

  // Elementor: fundos de containers ficam "none" até ganhar .e-lazyloaded
  if (classes.includes("elementor-element") && !classes.includes("e-lazyloaded")) {
    const elementorLazy =
      bgApplied || a["data-e-bg-lazyload"] !== undefined || (classes.includes("e-con") && classes.includes("e-parent"));
    if (elementorLazy) changed = setClasses(el, [], ["e-lazyloaded"]) || changed;
  }

  return changed;
}

/**
 * Normaliza o lazy load do documento (altera o $ recebido).
 * Retorna quantos elementos mudaram.
 */
export function normalizeLazy($: CheerioAPI): number {
  let count = 0;
  $("*").each((_, node) => {
    if (isElement(node) && normalizeElement(node)) count++;
  });
  return count;
}
