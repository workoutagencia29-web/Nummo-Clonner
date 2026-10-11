/**
 * "Imagens mais leves" do ZIP (opção lighterImages): as imagens abaixo da
 * primeira tela só são baixadas quando o visitante chega perto delas, com o
 * espaço delas reservado (nada pula na tela quando carregam).
 *
 * Conservador de propósito — o visual final da página não muda:
 * - só em páginas com a regra base dos modelos e das páginas em branco
 *   (`img{height:auto;display:block}`, src/editor/templates/styles.ts e
 *   BASE_PAGE_CSS): com ela, a largura e a altura que entram (as reais da
 *   imagem) só reservam o espaço. Sem ela (páginas clonadas), nada muda;
 * - só imagens do Offer Studio (/os-assets/, JPG, PNG ou WebP), sem srcset,
 *   fora de <picture> e fora de widgets, blocos escondidos (atraso, popup de
 *   saída, etapas do quiz, prêmio da roleta, [hidden]) e de <noscript>;
 * - imagem que já tem `loading` fica como está;
 * - a 1ª e a 2ª imagens que valem continuam carregando na hora (a primeira
 *   com 400 px ou mais de largura ganha fetchpriority="high", se a página não
 *   tiver nenhuma); da 3ª em diante: loading="lazy" decoding="async", e
 *   width/height reais quando faltam;
 * - sem as dimensões (arquivo que não abre) ou com algum CSS que dá altura à
 *   imagem (height, min-height, max-height…: com a largura nova ela ficaria
 *   esticada), a imagem não muda;
 * - a largura nova só entra quando não muda o tamanho da imagem: o CSS já dá a
 *   largura dela (em qualquer tela), ou ela está num bloco comum. Direto dentro
 *   de um contêiner flex ou grid (ex.: cartão de depoimento em coluna), a imagem
 *   sem largura no CSS estica até a largura dele — com o width novo voltaria à
 *   largura real e poderia passar da tela no celular: não muda.
 * As mudanças entram no HTML original (só atributos novos, no fim da tag):
 * o resto do arquivo fica byte a byte igual.
 */
import * as cheerio from "cheerio";
import * as csstree from "css-tree";
import type { Element } from "domhandler";

export interface ImageSize {
  width: number;
  height: number;
}

/** A regra base dos modelos (e das páginas em branco), em qualquer folha da página. */
const BASE_IMG_RULE_RE = /(?:^|[{}>])\s*img\s*\{\s*height\s*:\s*auto\s*;\s*display\s*:\s*block\s*[;}]/i;

/** Arquivo do Offer Studio (com ou sem a origem do painel na frente) → "<sha>.<ext>". */
const ASSET_SRC_RE =
  /^(?:(?:https?:)?\/\/(?:localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.localhost)(?::\d{1,5})?)?\/os-assets\/([0-9a-f]{64}\.(?:webp|png|jpe?g))$/i;

/** Onde a imagem não muda: widgets (scripts próprios) e blocos que começam escondidos. */
const SKIP_INSIDE =
  '[data-os-widget],[data-os-delay]:not([data-os-delay="0"]),[data-os-qz-step],[data-os-premio],[hidden],picture,noscript,template';

/** Primeiras imagens que valem: carregam na hora (provavelmente na primeira tela). */
const EAGER_COUNT = 2;
/** Largura mínima da imagem que ganha fetchpriority="high". */
const PRIORITY_MIN_WIDTH = 400;

const HEIGHT_PROPS = new Set(["height", "min-height", "max-height", "block-size", "min-block-size", "max-block-size"]);
/** Valores que não dão altura à imagem. */
const HARMLESS_HEIGHT = new Set(["auto", "none", "0", "0px"]);
/** Estados do usuário: tirados do seletor (fica um seletor que pega mais imagens, nunca menos). */
const USER_STATE_RE = /:(?:hover|focus-visible|focus-within|focus|active|visited|any-link|link|target)\b/gi;
/** O mesmo, sem o "g" (para .test, que com o "g" guardaria a posição entre as chamadas). */
const HAS_USER_STATE_RE = /:(?:hover|focus-visible|focus-within|focus|active|visited|any-link|link|target)\b/i;
/** display que estica os filhos (flex/grid: a imagem sem largura no CSS acompanha o contêiner). */
const STRETCHING_DISPLAY_RE = /flex|grid|box/i;

const STYLE_HEIGHT_RE = /(?:^|;)\s*((?:min-|max-)?(?:height|block-size))\s*:\s*([^;]*)/gi;
const STYLE_DECL_RE = /(?:^|;)\s*(display|width)\s*:\s*([^;]*)/gi;

/** O style="" da própria imagem dá altura a ela? */
function inlineHeight(style: string | undefined): boolean {
  if (!style) return false;
  for (const m of style.matchAll(STYLE_HEIGHT_RE)) {
    if (
      !HARMLESS_HEIGHT.has(
        m[2]
          .replace(/!important/i, "")
          .trim()
          .toLowerCase(),
      )
    )
      return true;
  }
  return false;
}

/** Valor de `display`/`width` no style="" (o último, como no navegador); "" sem ele. */
function inlineDecl(style: string | undefined, prop: "display" | "width"): string {
  let value = "";
  for (const m of (style ?? "").matchAll(STYLE_DECL_RE)) {
    if (m[1].toLowerCase() === prop)
      value = m[2]
        .replace(/!important/i, "")
        .trim()
        .toLowerCase();
  }
  return value;
}

/**
 * Largura vinda do CSS: com ela, o width="" novo não muda nada (qualquer regra de
 * CSS vale mais que o atributo). `revert-layer` pode devolver o atributo: não conta.
 */
const fixesWidth = (value: string) => value !== "" && value !== "revert-layer";

/** O que o CSS da página (as <style>) diz das imagens e dos contêineres delas. */
interface CssFacts {
  /** Um seletor que importa não deu para conferir: nenhuma imagem ganha dimensões. */
  all: boolean;
  /** Imagens que alguma regra pode deixar com a altura fixa (o width novo as esticaria). */
  height: Set<Element>;
  /** Imagens com a largura dada por uma regra que vale em qualquer tela (fora de @media…). */
  width: Set<Element>;
  /** Elementos que alguma regra pode deixar flex/grid (os filhos esticam até a largura deles). */
  stretching: Set<Element>;
  /** Alguma regra usa display: contents (o contêiner de verdade fica mais acima). */
  contents: boolean;
}

/**
 * Lê as regras das <style> da página. As que só podem tirar a imagem da mudança
 * (altura, contêiner flex/grid) contam em qualquer @media e mesmo com :hover; a
 * largura que libera a mudança só conta fora de @media/@supports/@container e
 * sem estados do usuário no seletor.
 */
function cssFacts($: cheerio.CheerioAPI): CssFacts {
  const facts: CssFacts = { all: false, height: new Set(), width: new Set(), stretching: new Set(), contents: false };
  const match = (selector: string, into: Set<Element>, onlyImages: boolean) => {
    $(selector).each((_, found) => {
      if (found.type === "tag" && (!onlyImages || found.name === "img")) into.add(found);
    });
  };
  $("style").each((_, el) => {
    if (facts.all) return;
    let ast: csstree.CssNode;
    try {
      ast = csstree.parse($(el).text(), { parseValue: false, parseAtrulePrelude: false });
    } catch {
      facts.all = true;
      return;
    }
    /** Dentro de @media/@supports/@container… (o @layer vale sempre). */
    let conditional = 0;
    let keyframes = 0;
    const kindOf = (node: csstree.Atrule) =>
      /keyframes$/i.test(node.name) ? "keyframes" : /^layer$/i.test(node.name) ? "layer" : "conditional";
    csstree.walk(ast, {
      enter(node: csstree.CssNode) {
        if (node.type === "Atrule") {
          const kind = kindOf(node);
          if (kind === "keyframes") keyframes++;
          else if (kind === "conditional") conditional++;
          return;
        }
        if (node.type !== "Rule" || keyframes || facts.all) return;
        let height = false;
        let stretching = false;
        let width = false;
        let widthBack = false;
        csstree.walk(node.block, {
          visit: "Declaration",
          enter(decl: csstree.Declaration) {
            const prop = decl.property.toLowerCase();
            const value = csstree.generate(decl.value).trim().toLowerCase();
            if (HEIGHT_PROPS.has(prop) && !HARMLESS_HEIGHT.has(value)) height = true;
            if (prop === "display" && STRETCHING_DISPLAY_RE.test(value)) stretching = true;
            if (prop === "display" && value.includes("contents")) facts.contents = true;
            if (prop === "width") {
              if (fixesWidth(value)) width = true;
              else widthBack = true;
            }
          },
        });
        // revert-layer na largura: pode valer o atributo — trata como altura (a imagem não muda).
        const blocking = height || widthBack;
        if (!blocking && !stretching && !width) return;
        if (node.prelude.type !== "SelectorList") {
          if (blocking || stretching) facts.all = true;
          return;
        }
        node.prelude.children.forEach((selector) => {
          if (facts.all) return;
          const text = csstree.generate(selector);
          // Pseudo-elemento (::before…) não é a imagem nem o contêiner dela.
          if (/::|:(?:before|after|first-line|first-letter|marker|placeholder|selection)\b/i.test(text)) return;
          if (blocking || stretching) {
            const clean = text.replace(USER_STATE_RE, "").trim();
            if (!clean || /[>+~]$/.test(clean)) {
              facts.all = true;
              return;
            }
            try {
              if (blocking) match(clean, facts.height, true);
              if (stretching) match(clean, facts.stretching, false);
            } catch {
              facts.all = true;
              return;
            }
          }
          if (width && !conditional && !HAS_USER_STATE_RE.test(text)) {
            try {
              match(text, facts.width, true);
            } catch {
              // Seletor que não dá para conferir: não libera nada.
            }
          }
        });
      },
      leave(node: csstree.CssNode) {
        if (node.type !== "Atrule") return;
        const kind = kindOf(node);
        if (kind === "keyframes") keyframes--;
        else if (kind === "conditional") conditional--;
      },
    });
  });
  return facts;
}

/**
 * Pôr width="" (a largura real) muda o tamanho da imagem? Não muda quando o CSS
 * já dá a largura dela, ou quando ela está num bloco comum (sem largura no CSS,
 * a imagem já aparece na largura real, limitada pelo max-width). Num contêiner
 * flex ou grid a imagem sem largura estica até a largura dele: com o width novo,
 * ela voltaria à largura real (podendo passar da tela no celular).
 */
function widthIsSafe(el: Element, facts: CssFacts): boolean {
  if (facts.width.has(el) || fixesWidth(inlineDecl(el.attribs.style, "width"))) return true;
  if (facts.contents) return false;
  const parent = el.parent;
  if (!parent || parent.type !== "tag") return true;
  const box = parent as Element;
  return !facts.stretching.has(box) && !STRETCHING_DISPLAY_RE.test(inlineDecl(box.attribs.style, "display"));
}

/** Folha de estilo de fora (que não dá para conferir), fora as de fontes. */
function hasExternalStylesheet($: cheerio.CheerioAPI): boolean {
  if ($("style").text().includes("@import")) return true;
  return $('link[rel~="stylesheet" i]')
    .toArray()
    .some((el) => !/^https:\/\/fonts\.googleapis\.com\//i.test($(el).attr("href") ?? ""));
}

const positiveInt = (value: string | undefined) => /^\s*\d+\s*$/.test(value ?? "") && Number(value) > 0;

interface Candidate {
  el: Element;
  /** "<sha>.<ext>" */
  file: string;
}

export interface LighterImagesPlan {
  /** Arquivos ("<sha>.<ext>") cujas dimensões a montagem deve ler. */
  files: string[];
  /** HTML com os atributos novos (dimensões que faltarem: a imagem não muda). */
  apply: (sizeOf: (file: string) => ImageSize | null | undefined) => string;
}

/** O que muda numa página (null = nada a fazer: sem a regra base ou sem imagens que valem). */
export function lighterImagesPlan(html: string): LighterImagesPlan | null {
  if (!/<img[\s>/]/i.test(html)) return null;
  if (!BASE_IMG_RULE_RE.test(html)) return null;
  const $ = cheerio.load(html, { sourceCodeLocationInfo: true });
  const candidates: Candidate[] = [];
  $("img").each((_, el) => {
    const node = $(el);
    if (node.attr("loading") !== undefined || node.attr("srcset") !== undefined || node.attr("sizes") !== undefined)
      return;
    const file = ASSET_SRC_RE.exec((node.attr("src") ?? "").trim())?.[1];
    if (!file || !el.sourceCodeLocation?.startTag) return;
    if (node.closest(SKIP_INSIDE).length) return;
    candidates.push({ el, file: file.toLowerCase() });
  });
  if (!candidates.length) return null;
  const hasPriority = $("img[fetchpriority]").length > 0;
  // Só as que podem ficar para depois precisam da conferência do CSS.
  const lazyOk = candidates.length > EAGER_COUNT && !hasExternalStylesheet($) ? cssFacts($) : null;
  return {
    files: [...new Set(candidates.map((c) => c.file))],
    apply(sizeOf) {
      const edits: { at: number; text: string }[] = [];
      const add = (el: Element, attrs: [string, string][]) => {
        const loc = el.sourceCodeLocation?.startTag;
        if (!loc || !attrs.length) return;
        // Antes do ">" (ou do "/>" — só quando a barra não é o fim de um valor sem aspas), com um espaço na frente.
        let at = loc.endOffset - 1;
        if (html[at - 1] === "/" && /[\s"']/.test(html[at - 2] ?? "")) at--;
        edits.push({ at, text: attrs.map(([k, v]) => ` ${k}="${v}"`).join("") });
      };
      let priority = hasPriority;
      candidates.forEach(({ el, file }, index) => {
        const attrs = el.attribs;
        const size = sizeOf(file);
        if (index < EAGER_COUNT) {
          const width = positiveInt(attrs.width) ? Number(attrs.width) : (size?.width ?? 0);
          if (!priority && width >= PRIORITY_MIN_WIDTH) {
            priority = true;
            add(el, [["fetchpriority", "high"]]);
          }
          return;
        }
        if (!lazyOk || lazyOk.all) return;
        const hasBoth = positiveInt(attrs.width) && positiveInt(attrs.height);
        const out: [string, string][] = [];
        if (!hasBoth) {
          // Com só uma das duas, ou com o CSS dando altura à imagem: não mexe.
          if (attrs.width !== undefined || attrs.height !== undefined) return;
          if (!size || inlineHeight(attrs.style) || lazyOk.height.has(el)) return;
          if (!widthIsSafe(el, lazyOk)) return;
          out.push(["width", String(size.width)], ["height", String(size.height)]);
        }
        out.unshift(["loading", "lazy"]);
        if (attrs.decoding === undefined) out.splice(1, 0, ["decoding", "async"]);
        add(el, out);
      });
      if (!edits.length) return html;
      edits.sort((a, b) => a.at - b.at);
      const parts: string[] = [];
      let from = 0;
      for (const e of edits) {
        parts.push(html.slice(from, e.at), e.text);
        from = e.at;
      }
      parts.push(html.slice(from));
      return parts.join("");
    },
  };
}
