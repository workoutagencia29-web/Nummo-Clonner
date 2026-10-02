/**
 * SEO no HTML final (prévia e, na Fase 5, ZIP): título, descrição, imagem de
 * compartilhamento (og:image), ícone da aba (favicon), "não aparecer no Google"
 * (noindex) e <html lang>. Vem de effectiveSeo (Offer.settings + Page.seo, ver
 * src/lib/offer-settings.ts). Só troca o que foi preenchido: campo vazio deixa
 * o que a página (clonada) já tem.
 *
 * Função pura, sem DOM (roda no servidor), com as mesmas expressões de tag de
 * src/lib/tracking/inject.ts (">" dentro de aspas não fecha a tag).
 */
import type { Seo } from "@/lib/offer-settings";

export interface SeoRender {
  title?: string | null;
  description?: string | null;
  /** Endereço do favicon (prévia: /os-assets/<arquivo>). */
  faviconHref?: string | null;
  /** Endereço da imagem de compartilhamento. */
  ogImageHref?: string | null;
  noindex?: boolean;
  /** Idioma do <html lang> ("pt-BR", "en", "es"); vazio mantém o da página. */
  lang?: string | null;
}

const STORAGE_KEY_RE = /^a\/[0-9a-f]{2}\/([0-9a-f]{64}\.[a-z0-9]{1,8})$/;

/** Chave do storage ("a/3f/<sha>.webp") → endereço servido ("/os-assets/<sha>.webp"). */
export function seoAssetHref(key: string | null | undefined, prefix = "/os-assets/"): string | null {
  const m = STORAGE_KEY_RE.exec(key ?? "");
  return m ? `${prefix}${m[1]}` : null;
}

/** SEO efetivo (effectiveSeo) + idioma ("" = o da página) → o que entra no HTML. */
export function seoRenderFrom(seo: Seo, lang: string | null, assetPrefix = "/os-assets/"): SeoRender {
  return {
    title: seo.title,
    description: seo.description,
    faviconHref: seoAssetHref(seo.faviconKey, assetPrefix),
    ogImageHref: seoAssetHref(seo.ogImageKey, assetPrefix),
    noindex: seo.noindex,
    lang: lang || null,
  };
}

const ATTRS = `(?:[^>"']|"[^"]*"|'[^']*')*`;
const HEAD_OPEN_RE = new RegExp(`<head\\b${ATTRS}>`, "i");
const HTML_OPEN_RE = new RegExp(`<html\\b(${ATTRS})>`, "i");
const DOCTYPE_RE = /^\s*(?:<!--[\s\S]*?-->\s*)*<!doctype[^>]*>/i;
const TITLE_RE = /<title\b[^>]*>[\s\S]*?<\/title\s*>\s*/gi;
const META_RE = new RegExp(`<meta\\b${ATTRS}>\\s*`, "gi");
const LINK_RE = new RegExp(`<link\\b${ATTRS}>\\s*`, "gi");

function escapeText(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Valor de um atributo numa tag em texto (minúsculas no nome), ou null. */
function attrOf(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
}

/** Garante <head>…</head> e devolve o HTML com as posições do conteúdo do head. */
function withHead(html: string): { html: string; start: number; end: number } {
  let out = html;
  let open = HEAD_OPEN_RE.exec(out);
  if (!open) {
    const htmlOpen = HTML_OPEN_RE.exec(out);
    const doctype = DOCTYPE_RE.exec(out);
    const at = htmlOpen ? htmlOpen.index + htmlOpen[0].length : doctype ? doctype[0].length : 0;
    out = `${out.slice(0, at)}<head></head>${out.slice(at)}`;
    open = HEAD_OPEN_RE.exec(out) as RegExpExecArray;
  }
  const start = open.index + open[0].length;
  const close = /<\/head\s*>/i.exec(out.slice(start));
  if (close) return { html: out, start, end: start + close.index };
  // <head> sem </head>: o conteúdo vai até o <body> (ou o fim).
  const body = /<body\b/i.exec(out.slice(start));
  const end = body ? start + body.index : out.length;
  return { html: `${out.slice(0, end)}</head>${out.slice(end)}`, start, end };
}

/**
 * Aplica o SEO: troca <title>, meta description, og:title/og:description/og:image,
 * o favicon, o robots (noindex) e o <html lang>, só para os campos preenchidos.
 */
export function applySeo(html: string, seo: SeoRender | null | undefined): string {
  if (!seo) return html;
  const title = seo.title?.trim() ?? "";
  const description = seo.description?.trim() ?? "";
  const favicon = seo.faviconHref?.trim() ?? "";
  const ogImage = seo.ogImageHref?.trim() ?? "";
  const noindex = seo.noindex === true;
  const lang = seo.lang?.trim() ?? "";
  if (!title && !description && !favicon && !ogImage && !noindex && !lang) return html;

  let out = html;
  if (title || description || favicon || ogImage || noindex) {
    const head = withHead(out);
    out = head.html;
    let inner = out.slice(head.start, head.end);
    const add: string[] = [];
    if (title) {
      inner = inner.replace(TITLE_RE, "");
      add.push(`<title>${escapeText(title)}</title>`, `<meta property="og:title" content="${escapeAttr(title)}">`);
    }
    if (description) {
      add.push(
        `<meta name="description" content="${escapeAttr(description)}">`,
        `<meta property="og:description" content="${escapeAttr(description)}">`,
      );
    }
    if (ogImage) {
      add.push(
        `<meta property="og:image" content="${escapeAttr(ogImage)}">`,
        '<meta name="twitter:card" content="summary_large_image">',
      );
    }
    if (noindex) add.push('<meta name="robots" content="noindex, nofollow">');
    inner = inner.replace(META_RE, (tag) => {
      const name = (attrOf(tag, "name") ?? "").toLowerCase();
      const property = (attrOf(tag, "property") ?? "").toLowerCase();
      if (description && name === "description") return "";
      if (title && property === "og:title") return "";
      if (description && property === "og:description") return "";
      if (ogImage && (/^og:image(?::|$)/.test(property) || name === "twitter:image" || name === "twitter:card")) {
        return "";
      }
      if (noindex && (name === "robots" || name === "googlebot")) return "";
      return tag;
    });
    if (favicon) {
      inner = inner.replace(LINK_RE, (tag) => (/\bicon\b/i.test(attrOf(tag, "rel") ?? "") ? "" : tag));
      add.push(
        `<link rel="icon" href="${escapeAttr(favicon)}">`,
        `<link rel="apple-touch-icon" href="${escapeAttr(favicon)}">`,
      );
    }
    out = `${out.slice(0, head.start)}${inner}${add.join("")}${out.slice(head.end)}`;
  }

  if (lang) {
    const htmlOpen = HTML_OPEN_RE.exec(out);
    if (htmlOpen) {
      const attrs = htmlOpen[1].replace(/\slang\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+)/i, "");
      const tag = `<html${attrs.replace(/\s*\/?\s*$/, "")} lang="${escapeAttr(lang)}">`;
      out = `${out.slice(0, htmlOpen.index)}${tag}${out.slice(htmlOpen.index + htmlOpen[0].length)}`;
    } else {
      const doctype = DOCTYPE_RE.exec(out);
      const at = doctype ? doctype[0].length : 0;
      out = `${out.slice(0, at)}<html lang="${escapeAttr(lang)}">${out.slice(at)}`;
    }
  }
  return out;
}
