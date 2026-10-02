/**
 * Conversão entre o HTML guardado de uma página e o que o editor visual (GrapesJS)
 * recebe — e de volta.
 *
 * Por que converter:
 * - O editor roda no painel. Scripts e atributos on* da página clonada NUNCA podem
 *   executar ali. Eles viram elementos inertes (<os-script>, data-os-on-*) e voltam
 *   ao normal na hora de exportar/pré-visualizar. Marcas parecidas que já venham
 *   na página (data-gjs-*, <os-script> "de fora"…) são apagadas antes: só as que
 *   este arquivo cria podem virar código de verdade.
 * - O <head> é da página, não do editor: o GrapesJS recebe só o necessário para o
 *   canvas (título, metas simples e a folha base), e ao salvar o <head> guardado
 *   volta inteiro (scripts, noscript, canonical, favicon…) — ver `previousHtml`.
 * - O CSS original não passa pelo analisador de CSS do editor (que reescreve
 *   atalhos, perde @import e reordena media queries). Ele vira uma única folha
 *   "base" em camada CSS (@layer os-original), e as edições feitas no editor
 *   (fora de camada) vencem o CSS original. Declarações !important invertem essa
 *   regra das camadas; por isso as edições !important ganham uma cópia na camada
 *   os-fix, que vem antes de os-original e vence o !important original.
 * - O que o parser do navegador (usado pelo GrapesJS) entenderia diferente do
 *   HTML guardado também é protegido: <noscript> vira texto inerte, ids
 *   repetidos, valores `javascript:` e url(data:…;base64) em style="" passam
 *   por marcas e voltam iguais.
 */

import type { CheerioAPI } from "cheerio";
import * as cheerio from "cheerio";
import * as csstree from "css-tree";
import type { AnyNode, Element } from "domhandler";
import { cssIdent, isKeepValue, outsideMedia, pinComesAfter, pinKey, pinnedSelector } from "@/lib/css-keep";
import { restoreDoctype } from "@/lib/doctype";
import { CCID_ATTR, DUP_ID_ATTR, EID_ATTR, NOT_DUP } from "@/lib/dup-ids";

export const OS_SCRIPT_TAG = "os-script";
/** <noscript> inerte no editor (o conteúdo fica como texto). */
export const OS_NOSCRIPT_TAG = "os-noscript";
/** <meta http-equiv> inerte no canvas (src/editor/grapes/components.ts); relido do canvas, volta a ser <meta>. */
export const OS_META_TAG = "os-meta";
export const BASE_CSS_ATTR = "data-os-base";
export const EDITS_STYLE_ATTR = "data-os-edits";
/** <style> com a camada os-fix (cópia das edições !important), antes da folha base. */
export const FIX_STYLE_ATTR = "data-os-fix";
/** <meta name="os-preserve-js"> marca as cópias "Preservar JS" (o script da página não mexe nelas). */
export const PRESERVE_JS_META = "os-preserve-js";
/** Ordem das camadas: os-fix antes de os-original (no !important, a primeira camada vence). */
export const LAYER_ORDER = "@layer os-fix, os-original;";

const ON_PREFIX = "data-os-on-";
/** Valor `javascript:…` guardado sem o prefixo (o GrapesJS apaga atributos que começam com ele). */
const JS_PREFIX = "data-os-js-";
const ATTRS_ATTR = "data-os-attrs";
const DELAY_STYLE_ID = "os-delay-style";

/** Atributos que só este arquivo pode criar (ou que o GrapesJS lê como configuração). */
const MARKER_ATTR_RE = new RegExp(
  `^(?:data-gjs-|data-os-on-|data-os-js-)|^(?:data-os-attrs|${DUP_ID_ATTR}|${CCID_ATTR})$`,
  "i",
);

export interface OriginalStyle {
  /** Folha externa já localizada (/os-assets/x.css) ou texto de um <style>. */
  kind: "link" | "inline";
  href?: string;
  text?: string;
  media?: string;
}

export interface PreparedDocument {
  /** HTML para o editor (sem CSS original, scripts inertes). */
  html: string;
  /** Folhas de estilo originais, na ordem em que apareciam. */
  styles: OriginalStyle[];
}

function isElement(node: AnyNode): node is Element {
  return node.type === "tag" || node.type === "script" || node.type === "style";
}

function insideTemplate(el: Element) {
  for (let p = el.parent; p; p = p.parent) if (isElement(p) && p.tagName === "template") return true;
  return false;
}

/**
 * Apaga marcas do editor que vieram prontas na página (clone, importação, versão
 * antiga): <os-script>/<os-noscript>/<os-meta> e data-os-attrs / data-os-on-* / data-os-js-*
 * virariam scripts e on* de verdade ao salvar, e data-gjs-* é lido pelo GrapesJS
 * como configuração do componente (tipo "script", código a rodar…) — código
 * rodando no painel. Usado aqui e no clonador (modo Editável).
 */
export function stripEditorMarkers($: CheerioAPI) {
  $(`${OS_SCRIPT_TAG}, ${OS_NOSCRIPT_TAG}, ${OS_META_TAG}`).remove();
  $("*").each((_, el) => {
    if (!isElement(el)) return;
    for (const name of Object.keys(el.attribs)) {
      if (MARKER_ATTR_RE.test(name)) delete el.attribs[name];
    }
  });
}

function relTokens(el: Element) {
  return (el.attribs.rel ?? "").toLowerCase().split(/\s+/).filter(Boolean);
}

/** Media que o onload troca (`this.media='all'`, `removeAttribute('media')`), ou null. */
function onloadMedia(el: Element) {
  const onload = el.attribs.onload ?? "";
  if (/removeAttribute\(\s*(["'])media\1\s*\)/i.test(onload)) return "all";
  const m = /\bmedia\s*=\s*(["'])([^"']*)\1/i.exec(onload);
  return m ? m[2].trim() : null;
}

function normalMedia(media: string | null | undefined) {
  const m = media?.trim();
  return m && m.toLowerCase() !== "all" ? m : undefined;
}

/**
 * <link> que é CSS original da página (vai para a folha base), com a media que
 * vale na tela. Inclui os carregamentos assíncronos comuns:
 * `media="print" onload="this.media='all'"` e o preload do loadCSS
 * (`rel=preload as=style onload="this.rel='stylesheet'"`). Folhas "alternate"
 * não são aplicadas pelo navegador e ficam como estão.
 */
function originalSheet(el: Element): { media?: string } | null {
  if (el.tagName !== "link" || el.attribs[BASE_CSS_ATTR] !== undefined) return null;
  const rel = relTokens(el);
  const swapped = onloadMedia(el);
  if (rel.includes("stylesheet")) {
    if (rel.includes("alternate")) return null;
    return { media: normalMedia(swapped ?? el.attribs.media) };
  }
  const loadCss =
    rel.includes("preload") &&
    (el.attribs.as ?? "").toLowerCase() === "style" &&
    /\brel\s*=\s*(["'])stylesheet\1/i.test(el.attribs.onload ?? "");
  return loadCss ? { media: normalMedia(swapped ?? el.attribs.media) } : null;
}

/** <style>/<link> que o salvar recria (edições, os-fix, base, atraso da VSL). */
function isGeneratedStyle(el: Element) {
  if (el.tagName === "link") return el.attribs[BASE_CSS_ATTR] !== undefined;
  return (
    el.attribs[EDITS_STYLE_ATTR] !== undefined ||
    el.attribs[FIX_STYLE_ATTR] !== undefined ||
    el.attribs.id === DELAY_STYLE_ID
  );
}

/** Metas e título que o canvas pode ter sem risco (o resto do <head> fica fora do editor). */
function keepInEditorHead(node: AnyNode) {
  if (!isElement(node)) return false;
  switch (node.tagName) {
    case "title":
      return true;
    case "meta":
      // http-equiv (refresh, CSP…) agiria no canvas do painel.
      return node.attribs["http-equiv"] === undefined;
    case "link":
      return node.attribs[BASE_CSS_ATTR] !== undefined;
    case "style":
      return node.attribs[EDITS_STYLE_ATTR] !== undefined;
    default:
      return false;
  }
}

/** Valor que o GrapesJS apagaria (allowUnsafeAttrValue: false). */
function isDroppedValue(value: string) {
  return value.startsWith("javascript:");
}

/**
 * O GrapesJS lê style="" com split(";") e apaga tudo entre "/*" e "*\/". Dentro de
 * url() e de textos entre aspas, ";" e "*" viram escapes CSS (`\3b `, `\2a `), que
 * o navegador lê como o mesmo caractere: url(data:image/gif;base64,…) sobrevive.
 */
export function protectStyleValue(style: string): string {
  if (!/[;*]/.test(style)) return style;
  let out = "";
  let quote: string | null = null;
  let inUrl = false;
  for (let i = 0; i < style.length; i++) {
    const ch = style[i];
    if (ch === "\\") {
      out += style.slice(i, i + 2);
      i++;
      continue;
    }
    if (quote || inUrl) {
      if (ch === ";") {
        out += "\\3b ";
        continue;
      }
      if (ch === "*") {
        out += "\\2a ";
        continue;
      }
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ")") {
        inUrl = false;
      }
      out += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if ((ch === "u" || ch === "U") && /^url\(/i.test(style.slice(i, i + 4))) {
      out += style.slice(i, i + 4);
      i += 3;
      inUrl = true;
      continue;
    }
    out += ch;
  }
  return out;
}

/** Onde a folha base entra no <head>: depois de charset/viewport, antes de tudo o mais. */
function placeBaseLink($: CheerioAPI, link: string) {
  const head = $("head");
  const firstMeta = head.children('meta[charset], meta[name="viewport"]').last();
  if (firstMeta.length) firstMeta.after(link);
  else head.prepend(link);
}

/**
 * Prepara o HTML guardado para o editor. Não grava nada: o chamador guarda os
 * <style> inline como arquivos e liga a folha base com `linkBaseStylesheet`.
 */
export function prepareForEditor(html: string): PreparedDocument {
  const $ = cheerio.load(html);
  stripEditorMarkers($);
  const styles: OriginalStyle[] = [];

  // CSS original, na ordem do documento (links e <style>, no head ou no body).
  $("link, style").each((_, el) => {
    if (insideTemplate(el)) return;
    const node = $(el);
    // As edições voltam ao editor como regras dele; a folha base é trocada por linkBaseStylesheet.
    if (node.is(`style[${EDITS_STYLE_ATTR}], link[${BASE_CSS_ATTR}]`)) return;
    if (isGeneratedStyle(el)) {
      node.remove();
      return;
    }
    if (el.tagName === "link") {
      const sheet = originalSheet(el);
      if (!sheet) return;
      const href = node.attr("href");
      if (href) styles.push({ kind: "link", href, media: sheet.media });
    } else {
      const text = node.text();
      if (text.trim()) styles.push({ kind: "inline", text, media: normalMedia(node.attr("media")) });
    }
    node.remove();
  });

  // <head>: só o que o canvas usa. Scripts e <noscript> no <head> seriam
  // empurrados para o <body> pelo parser do navegador (e tudo depois deles:
  // título, description, og:*, canonical, favicon). O <head> guardado volta
  // inteiro ao salvar (finalizeFromEditor com previousHtml).
  $("head")
    .contents()
    .each((_, node) => {
      if (!keepInEditorHead(node)) $(node).remove();
    });

  // Scripts → <os-script> inerte (o conteúdo fica como texto).
  $("script").each((_, el) => {
    const node = $(el);
    const attrs = { ...(el as Element).attribs };
    const code = node.html() ?? "";
    const replacement = $(`<${OS_SCRIPT_TAG}></${OS_SCRIPT_TAG}>`);
    replacement.attr(ATTRS_ATTR, JSON.stringify(attrs));
    replacement.attr("hidden", "");
    replacement.text(code);
    node.replaceWith(replacement);
  });

  // <noscript> → <os-noscript> inerte. O cheerio lê o conteúdo como texto, mas o
  // navegador do editor (sem scripts) leria de verdade: um <style> ali viraria
  // CSS de todo visitante (ex.: WP Rocket esconde vídeos e imagens).
  $("noscript").each((_, el) => {
    const node = $(el);
    const replacement = $(`<${OS_NOSCRIPT_TAG}></${OS_NOSCRIPT_TAG}>`);
    replacement.attr(ATTRS_ATTR, JSON.stringify({ ...(el as Element).attribs }));
    replacement.attr("hidden", "");
    replacement.text(node.html() ?? "");
    node.replaceWith(replacement);
  });

  const seenIds = new Set<string>();
  $("*").each((_, el) => {
    if (!isElement(el)) return;
    const attribs = el.attribs;
    for (const name of Object.keys(attribs)) {
      // on* → data-os-on-* (o GrapesJS apaga qualquer atributo que começa com "on").
      if (/^on/i.test(name)) {
        const renamed = `${ON_PREFIX}${name.slice(2).toLowerCase()}`;
        attribs[renamed] = attribs[name];
        delete attribs[name];
      }
    }
    for (const name of Object.keys(attribs)) {
      // href="javascript:void(0)" etc.: o GrapesJS apagaria o atributo.
      if (isDroppedValue(attribs[name])) {
        attribs[`${JS_PREFIX}${name}`] = attribs[name].slice("javascript:".length);
        delete attribs[name];
      }
    }
    if (attribs.style) attribs.style = protectStyleValue(attribs.style);
    // Ids repetidos: o GrapesJS renomearia o segundo para "<id>-2" (perdendo #id do CSS, âncoras e scripts).
    const id = attribs.id;
    if (id) {
      if (seenIds.has(id)) {
        attribs[DUP_ID_ATTR] = id;
        delete attribs.id;
      } else {
        seenIds.add(id);
      }
    }
  });

  return { html: $.html(), styles };
}

/** Texto da folha base: todas as folhas originais importadas numa camada. */
export function baseStylesheetText(files: { href: string; media?: string }[]) {
  const lines = [LAYER_ORDER];
  for (const f of files) {
    const media = f.media && f.media !== "all" ? ` ${f.media}` : "";
    lines.push(`@import url("${f.href}") layer(os-original)${media};`);
  }
  return `${lines.join("\n")}\n`;
}

/** Coloca o <link> da folha base como primeira folha do <head>. */
export function linkBaseStylesheet(html: string, baseHref: string) {
  const $ = cheerio.load(html);
  $(`link[${BASE_CSS_ATTR}]`).remove();
  placeBaseLink($, `<link rel="stylesheet" href="${baseHref}" ${BASE_CSS_ATTR}>`);
  return $.html();
}

// ─── CSS das edições ─────────────────────────────────────────────────────────

function parseCss(css: string, parseRulePrelude: boolean) {
  try {
    return csstree.parse(css, { parseValue: false, parseAtrulePrelude: false, parseRulePrelude });
  } catch {
    return null;
  }
}

/** Id que o editor deu a um repetido estilizado → id original e marca data-os-eid. */
interface EditorIdTarget {
  id: string;
  eid: string;
}

/** `#x`, `#x:hover`, `#x::before`: o que o GrapesJS lê como regra de um id (só id e estados). */
function idOnlySelector(selector: csstree.Selector) {
  const first = selector.children.first;
  if (!first || first.type !== "IdSelector") return null;
  let scoped = false;
  let plain = true;
  selector.children.forEach((node) => {
    if (node === first) return;
    if (node.type === "PseudoClassSelector" && csstree.generate(node) === NOT_DUP) scoped = true;
    else if (node.type !== "PseudoClassSelector" && node.type !== "PseudoElementSelector") plain = false;
  });
  return plain ? { name: csstree.ident.decode(first.name), scoped } : null;
}

/** Regra fixa `:is(#x)` (css-keep.ts): o seletor de dentro (`#x`), ou null. */
function pinnedInner(selector: csstree.Selector): csstree.Selector | null {
  const only = selector.children.first;
  if (!only || selector.children.last !== only) return null;
  if (only.type !== "PseudoClassSelector" || only.name.toLowerCase() !== "is") return null;
  const list = only.children?.first;
  if (!list || list.type !== "SelectorList") return null;
  const inner = list.children.first;
  if (!inner || list.children.last !== inner || inner.type !== "Selector") return null;
  return inner;
}

/**
 * CSS das edições para a página final quando a página tem ids repetidos. O
 * canvas do editor mostra o id original nos repetidos (components.ts) e usa os
 * mesmos seletores daqui — o que se vê no editor é o que vai para a página:
 * - repetido que ganhou estilo: o GrapesJS deu a ele um id próprio (#iabc). O id
 *   original volta e a regra passa a mirar `#original[data-os-eid="iabc"]`
 *   (mesma força de um #id);
 * - regra do PRIMEIRO elemento do id (`#comprar`, `#comprar:hover`): no editor
 *   ela só muda ele, então vira `#comprar:not([data-os-dup-id])` e os repetidos
 *   levam a marca. O CSS original (#comprar da folha base) vale para todos,
 *   como na página de origem.
 * - a regra que mantém o valor do celular (`:is(#comprar)`, css-keep.ts) passa
 *   pela mesma troca por dentro: `:is(#comprar:not([data-os-dup-id]))` ou
 *   `:is(#comprar[data-os-eid="iabc"])` — com a mesma força da edição que ela
 *   protege (e depois dela, vence).
 * Devolve também os ids cujas regras do primeiro elemento foram limitadas.
 */
function retargetEditorIds(css: string, targets: Map<string, EditorIdTarget>, dupIds: Set<string>) {
  const scoped = new Set<string>();
  if ((!targets.size && !dupIds.size) || !css.trim()) return { css, scoped };
  const ast = parseCss(css, true);
  if (!ast) return { css, scoped };
  let changed = false;
  if (targets.size) {
    csstree.walk(ast, {
      visit: "IdSelector",
      enter(node, item, list) {
        // O css-tree guarda o nome como está no CSS (`#\31 -2`); o mapa usa o id de verdade ("1-2").
        const target = targets.get(csstree.ident.decode(node.name));
        if (target === undefined || !item || !list) return;
        const marker: csstree.AttributeSelector = {
          type: "AttributeSelector",
          name: { type: "Identifier", name: EID_ATTR },
          matcher: "=",
          value: { type: "String", value: target.eid },
          flags: null,
        };
        list.insert(list.createItem(marker), item.next);
        node.name = cssIdent(target.id);
        changed = true;
      },
    });
  }
  if (dupIds.size) {
    csstree.walk(ast, {
      visit: "Rule",
      enter(rule) {
        if (rule.prelude.type !== "SelectorList") return;
        rule.prelude.children.forEach((outer) => {
          if (outer.type !== "Selector") return;
          const selector = pinnedInner(outer) ?? outer;
          const info = idOnlySelector(selector);
          if (!info || !dupIds.has(info.name)) return;
          scoped.add(info.name);
          if (info.scoped) return;
          const pseudo = csstree.parse(NOT_DUP, { context: "selector" }) as csstree.Selector;
          const not = pseudo.children.first;
          let idItem: csstree.ListItem<csstree.CssNode> | null = null;
          selector.children.forEach((_node, item) => {
            idItem ??= item;
          });
          if (!not || !idItem) return;
          selector.children.insert(
            selector.children.createItem(not),
            (idItem as csstree.ListItem<csstree.CssNode>).next,
          );
          changed = true;
        });
      },
    });
  }
  return { css: changed ? csstree.generate(ast) : css, scoped };
}

const GROUPING_AT_RULES = new Set(["media", "supports", "container", "scope", "document", "-moz-document"]);

/**
 * Cópia das declarações !important das edições na camada os-fix. No !important a
 * ordem das camadas se inverte: o !important do CSS original (em os-original)
 * venceria o das edições (fora de camada) e até um style="… !important" da
 * página. os-fix vem antes de os-original, então vence. "" se não há nenhum.
 */
export function importantFixCss(css: string): string {
  if (!/!\s*important/i.test(css)) return "";
  const ast = parseCss(css, false);
  if (!ast || ast.type !== "StyleSheet") return "";

  // Valores do celular mantidos com !important (ver src/lib/css-keep.ts): a
  // cópia os-fix da edição do Desktop (ou do Tablet) fica fora dessas media queries.
  const pins = new Map<string, string[]>();
  ast.children.forEach((node) => {
    if (node.type !== "Atrule" || node.name.toLowerCase() !== "media" || !node.block || !node.prelude) return;
    const media = csstree.generate(node.prelude);
    node.block.children.forEach((rule) => {
      if (rule.type !== "Rule") return;
      const selector = pinnedSelector(csstree.generate(rule.prelude));
      if (!selector) return;
      rule.block.children.forEach((d) => {
        if (d.type !== "Declaration" || !d.important || !isKeepValue(csstree.generate(d.value))) return;
        const key = pinKey(selector, d.property);
        pins.set(key, [...(pins.get(key) ?? []), media]);
      });
    });
  });

  // `media`: a media query da edição ("" = Desktop; null = dentro de outra
  // regra, onde nenhum valor fixado vale). Só os valores fixados que vêm DEPOIS
  // da edição no CSS a protegem (a do Tablet sim, a do Celular não).
  const walk = (children: csstree.List<csstree.CssNode>, media: string | null): string => {
    let out = "";
    children.forEach((node) => {
      if (node.type === "Rule") {
        const selector = csstree.generate(node.prelude);
        const decls: string[] = [];
        let kept = "";
        node.block.children.forEach((d) => {
          if (d.type !== "Declaration" || !d.important) return;
          // revert-layer na os-fix voltaria ao padrão do navegador: fica só fora de camada.
          if (isKeepValue(csstree.generate(d.value))) return;
          const medias =
            media === null ? [] : (pins.get(pinKey(selector, d.property)) ?? []).filter((m) => pinComesAfter(media, m));
          if (medias.length) kept += outsideMedia(medias, `${selector}{${csstree.generate(d)}}`);
          else decls.push(csstree.generate(d));
        });
        if (decls.length) out += `${selector}{${decls.join(";")}}`;
        out += kept;
      } else if (node.type === "Atrule" && node.block && GROUPING_AT_RULES.has(node.name.toLowerCase())) {
        const prelude = node.prelude ? csstree.generate(node.prelude) : "";
        const inner = walk(node.block.children, media === "" && node.name.toLowerCase() === "media" ? prelude : null);
        if (inner) out += `@${node.name}${prelude ? ` ${prelude}` : ""}{${inner}}`;
      }
    });
    return out;
  };
  const inner = walk(ast.children, "");
  return inner ? `@layer os-fix{${inner}}` : "";
}

// ─── Do editor para a página ─────────────────────────────────────────────────

/**
 * O <head> e os atributos de <html> da página guardada substituem os do editor:
 * o editor só recebeu metas/título (ver prepareForEditor). Saem do <head> antigo
 * o CSS original (já está na folha base) e o que o salvar recria.
 */
function adoptPreviousHead($: CheerioAPI, previousHtml: string) {
  const $prev = cheerio.load(previousHtml);
  const prevHead = $prev("head");
  const base = $(`link[${BASE_CSS_ATTR}]`).last();
  const baseHtml = base.length ? $.html(base) : "";
  prevHead.find("link, style").each((_, el) => {
    if (insideTemplate(el)) return;
    // Sem folha base vinda do editor (não deveria acontecer), a anterior fica: o CSS não some.
    if (el.tagName === "link" && el.attribs[BASE_CSS_ATTR] !== undefined && !baseHtml) return;
    if (isGeneratedStyle(el) || el.tagName === "style" || originalSheet(el)) $prev(el).remove();
  });
  $(`link[${BASE_CSS_ATTR}]`).remove();
  $("head").replaceWith(prevHead);
  const html = $("html")[0];
  const prevRoot = $prev("html")[0];
  if (html && prevRoot) html.attribs = { ...prevRoot.attribs };
  if (baseHtml) placeBaseLink($, baseHtml);
}

/**
 * Páginas salvas antes desta correção: o parser do editor tinha empurrado
 * título, metas e links do <head> para o começo do <body>. Voltam para o <head>
 * (os iguais aos que já estão lá só saem do <body>).
 */
function hoistHeadElements($: CheerioAPI) {
  const head = $("head");
  const inHead = new Set(
    head
      .children()
      .toArray()
      .map((el) => $.html(el)),
  );
  $("body")
    .children("title, meta, link, base")
    .each((_, el) => {
      const node = $(el);
      if (node.is("[itemprop]")) return;
      if (el.tagName === "link" && (relTokens(el).includes("stylesheet") || originalSheet(el))) return;
      if (inHead.has($.html(el))) {
        node.remove();
        return;
      }
      if (el.tagName === "title") {
        if (!head.children("title").length) head.append(node);
      } else if (node.is("meta[charset]")) {
        if (head.children("meta[charset]").length) node.remove();
        else head.prepend(node);
      } else if (node.is('meta[name="viewport"]')) {
        const current = head.children('meta[name="viewport"]');
        if (current.length) current.first().replaceWith(node);
        else head.append(node);
      } else if (el.tagName === "base") {
        if (head.children("base").length) node.remove();
        else {
          const charset = head.children("meta[charset]").first();
          if (charset.length) charset.after(node);
          else head.prepend(node);
        }
      } else {
        head.append(node);
      }
      inHead.add($.html(el));
    });
}

/**
 * Transforma o HTML exportado pelo editor no HTML final da página: scripts e on*
 * voltam a ser reais e o CSS das edições entra logo depois da folha base.
 * `previousHtml` (o HTML salvo antes) devolve o <head> e o doctype originais: o
 * editor não guarda doctype nem o <head> completo, e páginas antigas só ficam
 * certas no modo em que foram feitas.
 */
export function finalizeFromEditor(documentHtml: string, editsCss: string, previousHtml?: string | null) {
  const $ = cheerio.load(documentHtml);

  $(OS_SCRIPT_TAG).each((_, el) => {
    const node = $(el);
    const script = $("<script></script>");
    for (const [k, v] of Object.entries(parseAttrs(node.attr(ATTRS_ATTR)))) script.attr(k, v);
    // text() decodifica entidades; o código volta exatamente como era.
    script.text(node.text());
    node.replaceWith(script);
  });

  $(OS_NOSCRIPT_TAG).each((_, el) => {
    const node = $(el);
    const noscript = $("<noscript></noscript>");
    for (const [k, v] of Object.entries(parseAttrs(node.attr(ATTRS_ATTR)))) noscript.attr(k, v);
    // Texto dentro de <noscript> sai sem escape: o HTML original volta igual.
    noscript.text(node.text());
    node.replaceWith(noscript);
  });

  const editorIds = new Map<string, EditorIdTarget>();
  /** Repetidos (2º em diante) de cada id, já com o id original de volta. */
  const duplicates = new Map<string, Element[]>();
  $("*").each((_, el) => {
    if (!isElement(el)) return;
    const attribs = el.attribs;
    for (const name of Object.keys(attribs)) {
      if (!name.startsWith(JS_PREFIX)) continue;
      const target = name.slice(JS_PREFIX.length);
      // Se o usuário pôs outro valor no editor, fica o dele.
      if (target && attribs[target] === undefined) attribs[target] = `javascript:${attribs[name]}`;
      delete attribs[name];
    }
    for (const name of Object.keys(attribs)) {
      if (name.startsWith(ON_PREFIX)) {
        attribs[`on${name.slice(ON_PREFIX.length)}`] = attribs[name];
        delete attribs[name];
      }
    }
    // Marca só do canvas (components.ts): nunca vai para a página.
    delete attribs[CCID_ATTR];
    const dupId = attribs[DUP_ID_ATTR];
    if (dupId !== undefined) {
      delete attribs[DUP_ID_ATTR];
      if (!dupId) return;
      const current = attribs.id;
      if (current && current !== dupId) {
        // Estilizado no editor (id dado pelo GrapesJS). Uma marca data-os-eid que
        // já estava no elemento continua a mesma (as regras antigas miram nela).
        const eid = attribs[EID_ATTR] || current;
        attribs[EID_ATTR] = eid;
        editorIds.set(current, { id: dupId, eid });
      }
      attribs.id = dupId;
      duplicates.set(dupId, [...(duplicates.get(dupId) ?? []), el]);
    }
  });

  // A cópia os-fix sai dos seletores do editor (os mesmos das regras que mantêm o
  // valor do celular); depois as duas passam pela mesma troca de ids repetidos.
  const dupIds = new Set(duplicates.keys());
  const { css: edits, scoped } = retargetEditorIds(editsCss, editorIds, dupIds);
  const { css: fix, scoped: fixScoped } = retargetEditorIds(importantFixCss(editsCss), editorIds, dupIds);
  // Regras do primeiro elemento limitadas a ele: os repetidos precisam da marca.
  for (const id of new Set([...scoped, ...fixScoped])) {
    for (const el of duplicates.get(id) ?? []) el.attribs[DUP_ID_ATTR] = id;
  }

  if (previousHtml?.trim()) adoptPreviousHead($, previousHtml);

  $(`style[${EDITS_STYLE_ATTR}], style[${FIX_STYLE_ATTR}]`).remove();
  const base = $(`link[${BASE_CSS_ATTR}]`).last();
  if (fix) {
    const style = `<style ${FIX_STYLE_ATTR}>${LAYER_ORDER}${styleText(fix)}</style>`;
    if (base.length) base.before(style);
    else $("head").append(style);
  }
  if (edits.trim()) {
    const style = `<style ${EDITS_STYLE_ATTR}>${styleText(edits)}</style>`;
    if (base.length) base.after(style);
    else $("head").append(style);
  }

  hoistHeadElements($);

  // Garantias mínimas para qualquer hospedagem.
  const head = $("head");
  if (!head.find("meta[charset]").length) head.prepend('<meta charset="utf-8">');
  if (!head.find('meta[name="viewport"]').length) {
    head.find("meta[charset]").after('<meta name="viewport" content="width=device-width, initial-scale=1">');
  }
  let out = $.html();
  if (previousHtml?.trim()) return restoreDoctype(out, previousHtml);
  if (!/^\s*<!doctype/i.test(out)) out = `<!DOCTYPE html>\n${out}`;
  return out;
}

/** CSS dentro de <style>: um "</style" num texto do CSS fecharia a tag (em CSS, `\/` é o mesmo "/"). */
function styleText(css: string) {
  return css.replace(/<\/(style)/gi, "<\\/$1");
}

function parseAttrs(json: string | undefined): Record<string, string> {
  try {
    const value = JSON.parse(json ?? "{}") as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(value)) if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    return {};
  }
}
