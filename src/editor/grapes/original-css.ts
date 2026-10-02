/**
 * Leitura do CSS original da página (folha base <link data-os-base>, com as
 * folhas importadas na camada os-original) direto do canvas, pelo CSSOM.
 *
 * Serve para o painel de estilo saber, para um elemento e uma propriedade:
 * - se o CSS original declara a propriedade com !important (aí uma edição
 *   comum nunca vence: a camada original ganha de !important fora de camada);
 * - em que media queries o CSS original dá outro valor (celular/tablet), para
 *   uma edição feita no Desktop não apagar o valor próprio do celular;
 * - se o valor original muda no celular por outro caminho (variável CSS,
 *   clamp()/vw, herança), comparando numa moldura escondida;
 * - e, para Duplicar, se o CSS original mira um id (#oferta{…}).
 */

import { mediaOrder, unescapeIdent } from "@/lib/css-keep";

/** Atributo da folha base (BASE_CSS_ATTR em src/lib/editor-html.ts, que é do servidor). */
const BASE_CSS_ATTR = "data-os-base";

interface Decl {
  rule: CSSStyleRule;
  /** Condições @media (do @import e dos @media em volta), todas precisam valer. */
  media: string[];
  /** Condições @supports em volta. */
  supports: string[];
  important: boolean;
}

interface Index {
  sheet: CSSStyleSheet;
  signature: string;
  /** Declarações por propriedade (nomes longos: margin-top, não margin). */
  byProp: Map<string, Decl[]>;
  /** Ids que aparecem nos seletores do CSS original (calculado na primeira consulta). */
  ids?: Set<string>;
}

const cache = new WeakMap<Document, Index>();

type AnyRule = CSSRule & Record<string, unknown>;

function rulesOf(sheet: CSSStyleSheet | null | undefined): CSSRuleList | null {
  try {
    return sheet?.cssRules ?? null;
  } catch {
    return null;
  }
}

/** Assinatura barata: muda quando uma folha importada termina de carregar. */
function signatureOf(sheet: CSSStyleSheet) {
  const parts: number[] = [];
  const walk = (list: CSSRuleList | null, depth: number) => {
    if (!list || depth > 4) return;
    parts.push(list.length);
    for (const rule of Array.from(list)) {
      const r = rule as AnyRule;
      if ("styleSheet" in r) walk(rulesOf(r.styleSheet as CSSStyleSheet), depth + 1);
    }
  };
  walk(rulesOf(sheet), 0);
  return parts.join(",");
}

function buildIndex(sheet: CSSStyleSheet): Map<string, Decl[]> {
  const byProp = new Map<string, Decl[]>();
  const visit = (list: CSSRuleList | null, media: string[], supports: string[], depth: number) => {
    if (!list || depth > 8) return;
    for (const rule of Array.from(list)) {
      const r = rule as AnyRule;
      if ("selectorText" in r && "style" in r) {
        const style = (r as unknown as CSSStyleRule).style;
        for (let i = 0; i < style.length; i++) {
          const name = style[i];
          const decl: Decl = {
            rule: r as unknown as CSSStyleRule,
            media,
            supports,
            important: style.getPropertyPriority(name) === "important",
          };
          const list = byProp.get(name);
          if (list) list.push(decl);
          else byProp.set(name, [decl]);
        }
      } else if ("styleSheet" in r) {
        const mediaText = String((r.media as MediaList | undefined)?.mediaText ?? "").trim();
        const next = mediaText && mediaText !== "all" ? [...media, mediaText] : media;
        visit(rulesOf(r.styleSheet as CSSStyleSheet), next, supports, depth + 1);
      } else if ("media" in r && "cssRules" in r) {
        const mediaText = String((r.media as MediaList).mediaText ?? "").trim();
        visit(r.cssRules as CSSRuleList, mediaText ? [...media, mediaText] : media, supports, depth + 1);
      } else if ("conditionText" in r && "cssRules" in r && !("containerName" in r)) {
        visit(r.cssRules as CSSRuleList, media, [...supports, String(r.conditionText)], depth + 1);
      } else if ("cssRules" in r && "name" in r && !("containerName" in r) && !("findRule" in r)) {
        // @layer bloco: mesmas regras (a camada inteira é os-original).
        visit(r.cssRules as CSSRuleList, media, supports, depth + 1);
      }
      // @container, @font-face, @keyframes, @page…: fora.
    }
  };
  visit(rulesOf(sheet), [], [], 0);
  return byProp;
}

/** Índice do CSS original do documento do canvas (refeito quando a folha muda). */
function indexFor(doc: Document): Index | null {
  const link = doc.querySelector<HTMLLinkElement>(`link[${BASE_CSS_ATTR}]`);
  const sheet = link?.sheet;
  if (!sheet) return null;
  const signature = signatureOf(sheet);
  const cached = cache.get(doc);
  if (cached && cached.sheet === sheet && cached.signature === signature) return cached;
  const index = { sheet, signature, byProp: buildIndex(sheet) };
  cache.set(doc, index);
  return index;
}

const ID_IN_SELECTOR = /#((?:\\[0-9a-f]{1,6}[ \t\n\r\f]?|\\[^\n\r\f0-9a-f]|[\w\u0080-\uffff-])+)/gi;

/**
 * O CSS original da página tem regras que miram este id (`#oferta{…}`,
 * `#oferta .btn`…)? Ids fora do CSS original (criados pelo editor) não contam.
 */
export function originalUsesId(doc: Document, id: string): boolean {
  const index = doc.defaultView ? indexFor(doc) : null;
  if (!index || !id) return false;
  if (!index.ids) {
    const ids = new Set<string>();
    const seen = new Set<CSSStyleRule>();
    for (const decls of index.byProp.values()) {
      for (const { rule } of decls) {
        if (seen.has(rule)) continue;
        seen.add(rule);
        for (const m of rule.selectorText.matchAll(ID_IN_SELECTOR)) ids.add(unescapeIdent(m[1]));
      }
    }
    index.ids = ids;
  }
  return index.ids.has(id);
}

/** Nomes longos de uma propriedade (margin → margin-top…; color → color). */
export function longhandsOf(doc: Document, prop: string): string[] {
  const probe = doc.createElement("div").style;
  try {
    probe.setProperty(prop, "inherit");
  } catch {
    return [prop];
  }
  const names = Array.from({ length: probe.length }, (_, i) => probe[i]);
  return names.length ? names : [prop];
}

function matches(el: Element, rule: CSSStyleRule) {
  try {
    return el.matches(rule.selectorText);
  } catch {
    return false;
  }
}

function supported(win: Window, conditions: string[]) {
  const css = (win as Window & { CSS?: typeof CSS }).CSS;
  return conditions.every((c) => {
    try {
      return css ? css.supports(c) : true;
    } catch {
      return false;
    }
  });
}

function mediaMatches(win: Window, conditions: string[]) {
  return conditions.every((c) => win.matchMedia(c).matches);
}

/**
 * O CSS original declara alguma destas propriedades com !important para o
 * elemento, valendo agora (media queries avaliadas no canvas)?
 */
export function originalImportant(el: Element, props: string[]): boolean {
  const doc = el.ownerDocument;
  const win = doc.defaultView;
  const index = win && indexFor(doc);
  if (!win || !index) return false;
  for (const prop of props) {
    for (const decl of index.byProp.get(prop) ?? []) {
      if (!decl.important) continue;
      if (!supported(win, decl.supports) || !mediaMatches(win, decl.media)) continue;
      if (matches(el, decl.rule)) return true;
    }
  }
  return false;
}

/** Valores que só repetem o do elemento de fora (resets: `font: inherit`, `font-size: 100%`). */
function inheritsOnly(prop: string, value: string) {
  const v = value.trim().toLowerCase();
  if (v === "inherit" || v === "unset") return true;
  return prop === "font-size" && (v === "100%" || v === "1em");
}

/**
 * O CSS original dá a alguma destas propriedades um valor próprio para o
 * elemento (numa regra que mira o próprio elemento, em qualquer media query)?
 * Um valor só herdado (o `font-size` do body, que muda no celular) não conta.
 */
export function originalDeclares(el: Element, props: string[]): boolean {
  const doc = el.ownerDocument;
  const win = doc.defaultView;
  const index = win && indexFor(doc);
  if (!win || !index) return false;
  return props.some((prop) =>
    (index.byProp.get(prop) ?? []).some(
      (decl) =>
        !inheritsOnly(prop, decl.rule.style.getPropertyValue(prop)) &&
        supported(win, decl.supports) &&
        matches(el, decl.rule),
    ),
  );
}

const MIN_WIDTH_ONLY = /^\s*(?:(?:only\s+)?screen\s+and\s+)?\(\s*min-width\s*:\s*([\d.]+)(px|em|rem)\s*\)\s*$/i;

/** Largura em px (em/rem contam 16px, o padrão das media queries). */
function widthPx(value: string): number | null {
  const m = /^([\d.]+)(px|em|rem)$/i.exec(value.trim());
  if (!m) return null;
  return Number(m[1]) * (m[2].toLowerCase() === "px" ? 1 : 16);
}

/** Separa por vírgulas fora de parênteses (lista de media queries). */
function splitQueries(media: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < media.length; i++) {
    const ch = media[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      out.push(media.slice(start, i));
      start = i + 1;
    }
  }
  out.push(media.slice(start));
  return out.map((q) => q.trim());
}

interface WidthRange {
  min: number;
  max: number;
}

/**
 * Faixa de largura de uma condição "(…)" (min-width, max-width, width < X…);
 * undefined se ela não fala de largura (orientação, hover…); null se fala mas
 * não dá para ler.
 */
function featureRange(feature: string): WidthRange | null | undefined {
  const inner = /^\(\s*([\s\S]+?)\s*\)$/.exec(feature.trim())?.[1];
  if (!inner) return null;
  const classic = /^(min|max)-(?:device-)?width\s*:\s*(\S+)$/i.exec(inner);
  if (classic) {
    const px = widthPx(classic[2]);
    if (px === null) return null;
    return classic[1].toLowerCase() === "max" ? { min: 0, max: px } : { min: px, max: Number.POSITIVE_INFINITY };
  }
  // Sintaxe de intervalo: (width < 768px), (768px > width), (400px <= width < 768px).
  const parts = inner.split(/\s*(<=|>=|<|>)\s*/);
  const at = parts.findIndex((p) => /^(?:device-)?width$/i.test(p));
  if (at < 0) return /^(?:device-)?width\b/i.test(inner) ? null : undefined;
  const range = { min: 0, max: Number.POSITIVE_INFINITY };
  // "width < X" (X depois) ou "X > width" (X antes): X é o limite de cima.
  const sides = [
    { op: parts[at + 1], value: parts[at + 2], upperOp: "<" },
    { op: parts[at - 1], value: parts[at - 2], upperOp: ">" },
  ];
  for (const { op, value, upperOp } of sides) {
    if (!op || !value) continue;
    const px = widthPx(value);
    if (px === null) return null;
    if (op.startsWith(upperOp)) range.max = Math.min(range.max, px);
    else range.min = Math.max(range.min, px);
  }
  return range;
}

interface QueryRange extends WidthRange {
  /** Só telas ("screen"; sem tipo ou "all" valem também na impressão). */
  screen: boolean;
  /** Só condições de largura (sem orientação, hover…). */
  pure: boolean;
}

/**
 * Faixa de largura de uma consulta (sem vírgulas) de tela ("screen"/"all", sem
 * "not"/"or"), ou null (impressão, "not", "or", condição que não dá para ler).
 */
function queryRange(query: string): QueryRange | null {
  let q = query.toLowerCase().replace(/\s+/g, " ").trim();
  if (!q || /^not\b/.test(q)) return null;
  q = q.replace(/^only /, "");
  let screen = false;
  if (!q.startsWith("(")) {
    const type = /^([a-z-]+)(?: and (.*))?$/.exec(q);
    if (!type || (type[1] !== "screen" && type[1] !== "all") || !type[2]) return null;
    screen = type[1] === "screen";
    q = type[2];
  }
  if (/\)\s*or\s*\(/.test(q)) return null;
  const range: QueryRange = { min: 0, max: Number.POSITIVE_INFINITY, screen, pure: true };
  for (const feature of q.split(/\s+and\s+/)) {
    const bound = featureRange(feature);
    if (bound === null) return null;
    // Outras condições (orientação, hover…) só restringem mais: não mudam a faixa.
    if (bound === undefined) range.pure = false;
    else {
      range.min = Math.max(range.min, bound.min);
      range.max = Math.min(range.max, bound.max);
    }
  }
  return range;
}

/**
 * Limite de largura de uma consulta (sem vírgulas) que só vale em telas mais
 * estreitas que algo: de tela ("screen"/"all", sem "not"/"or") e com largura
 * máxima. null se a consulta não tem essa forma (telas largas, modo escuro,
 * impressão, orientação sozinha…).
 */
function queryMaxWidth(query: string): number | null {
  const range = queryRange(query);
  return range && Number.isFinite(range.max) ? range.max : null;
}

/**
 * A condição só pode valer em telas MAIS ESTREITAS que o canvas (celular,
 * tablet)? Cada consulta da lista precisa ser de tela ("screen"/"all", sem
 * "not") e ter um limite de largura máxima abaixo da largura do canvas. Telas
 * largas (min-width: 1400px), modo escuro, impressão, orientação sozinha… não
 * são valores "do celular": a edição do Desktop vale nelas.
 */
export function narrowOnly(media: string, canvasWidth: number): boolean {
  const queries = splitQueries(media);
  return (
    queries.length > 0 &&
    queries.every((query) => {
      const max = queryMaxWidth(query);
      return max !== null && max < canvasWidth;
    })
  );
}

/** Faixa do celular e posição das regras dos modos no CSS das edições (ver mediaOrder). */
export interface PhoneBounds {
  /** Fim da faixa do celular: abaixo do canvas do Tablet (768px → 767.98px). */
  max: number;
  /** Posição da regra do Celular (`@media (max-width: 480px)` → 480). */
  phoneOrder: number;
  /** Posição da regra do Tablet (`@media (max-width: 992px)` → 992). */
  tabletOrder: number;
}

/**
 * A consulta com `(max-width: <px>px)` na frente: o GrapesJS (getCss) e o canvas
 * ordenam as media queries pelo primeiro número delas. As condições de largura
 * máxima em px que esse limite já cobre saem; as outras ficam (a consulta vale
 * nas mesmas telas, menos as acima do limite).
 */
function leadWith(query: string, px: number): string {
  const [, type = "", rest = ""] = /^((?:only\s+)?[a-z-]+\s+and\s+)?([\s\S]*)$/i.exec(query.trim()) ?? [];
  const kept = rest.split(/\s+and\s+/i).filter((feature) => {
    const range = featureRange(feature);
    return !(range && range.min === 0 && range.max >= px && !/\d(?:r?em)\b/i.test(feature));
  });
  return [`${type}(max-width: ${px}px)`, ...kept].join(" and ");
}

/**
 * Condição da regra que mantém o valor do celular, a partir de uma condição de
 * telas estreitas do CSS original (narrowOnly). Decidido pela faixa de largura
 * de cada consulta (a ordem em que as condições foram escritas não conta):
 * - Consulta que não vale em nenhum celular (só tablet ou telas maiores): sai.
 *   O tablet tem o modo Tablet para isso.
 * - Consulta do CSS original "computador primeiro" que vai além da regra do
 *   Tablet (o `(max-width: 1024px)` do Elementor): continua valendo em toda a
 *   faixa dela, ordenada ANTES da regra do Tablet — onde as duas valem, a edição
 *   do Tablet vence.
 * - As outras ficam só na faixa do celular (até 767.98px) e ordenadas entre a
 *   regra do Tablet e a do Celular: não passam por cima da edição do Tablet no
 *   canvas do Tablet (768px), e uma edição no Celular vence. Isso vale também
 *   para condições em em/rem ou abaixo de 480px (`(max-width: 479px)`), que o
 *   GrapesJS poria depois da regra do Celular.
 * `below` (a faixa abaixo de um `min-width` de um CSS "celular primeiro") é o
 * valor básico da página, não um valor de tablet: fica só na faixa do celular,
 * qualquer que seja o breakpoint (Bootstrap 1200px, Tailwind 1280px).
 * "" quando nada sobra: ali o original não tem valor próprio do celular.
 */
export function phoneKeepMedia(media: string, bounds: PhoneBounds, { below = false } = {}): string {
  return splitQueries(media)
    .flatMap((query) => {
      const range = queryRange(query);
      if (!range || range.min > bounds.max) return [];
      const order = mediaOrder(query);
      if (!below && range.max > bounds.tabletOrder) {
        return [order > bounds.tabletOrder ? query : leadWith(query, range.max)];
      }
      const inPhoneSlot = order > bounds.phoneOrder && order < bounds.tabletOrder;
      return [range.max <= bounds.max && inPhoneSlot ? query : leadWith(query, bounds.max)];
    })
    .join(", ");
}

/** `outer` (uma consulta só de largura) cobre todas as consultas de `inner`? */
function covers(outer: string, inner: string) {
  const [single, ...more] = splitQueries(outer);
  const range = more.length ? null : queryRange(single);
  if (!range?.pure) return false;
  return splitQueries(inner).every((query) => {
    const r = queryRange(query);
    return r !== null && (r.screen || !range.screen) && r.min >= range.min && r.max <= range.max;
  });
}

/**
 * Sem as condições que outra da lista já cobre inteira (ex.: `(max-width: 767px)`
 * junto de `(max-width: 1024px)`): uma regra só mantém o valor nas duas faixas.
 */
export function withoutCovered(medias: string[]): string[] {
  const unique = [...new Set(medias)];
  return unique.filter((media, i) =>
    unique.every((other, j) => j === i || !covers(other, media) || (covers(media, other) && i < j)),
  );
}

export interface NarrowMedia {
  media: string;
  /**
   * Faixa abaixo de um `min-width` do CSS "celular primeiro": ali vale o valor
   * básico da página (o do celular), não um valor de tablet (phoneKeepMedia).
   */
  below: boolean;
}

/**
 * Media queries em que o CSS original dá a estas propriedades um valor próprio
 * para o elemento, diferente do que vale na largura atual do canvas (Desktop):
 * - regras dentro de um @media de tela mais estreita que não vale agora (ex.:
 *   max-width: 767px) — só essas: telas largas, modo escuro e impressão não são
 *   "o celular";
 * - no CSS "celular primeiro" (min-width: 768px vale no Desktop), a faixa abaixo
 *   dele, onde vale o valor de fora do @media.
 */
export function originalNarrowMedia(el: Element, props: string[]): NarrowMedia[] {
  const doc = el.ownerDocument;
  const win = doc.defaultView;
  const index = win && indexFor(doc);
  if (!win || !index) return [];
  const out = new Map<string, NarrowMedia>();
  const add = (media: string, below: boolean) => {
    if (!out.has(media)) out.set(media, { media, below });
  };
  for (const prop of props) {
    for (const decl of index.byProp.get(prop) ?? []) {
      if (!decl.media.length || !supported(win, decl.supports)) continue;
      if (!matches(el, decl.rule)) continue;
      if (!mediaMatches(win, decl.media)) {
        // Várias condições juntas: só dá para somar com "and" sem listas (vírgulas).
        const condition =
          decl.media.length === 1
            ? decl.media[0]
            : decl.media.every((m) => !m.includes(","))
              ? decl.media.join(" and ")
              : "";
        if (condition && narrowOnly(condition, win.innerWidth)) add(condition, false);
        continue;
      }
      if (decl.media.length !== 1) continue;
      const min = MIN_WIDTH_ONLY.exec(decl.media[0]);
      if (!min) continue;
      const px = Number(min[1]) * (min[2].toLowerCase() === "px" ? 1 : 16);
      if (px > 1) add(`(max-width: ${Math.round((px - 0.02) * 100) / 100}px)`, true);
    }
  }
  return [...out.values()];
}

// ─── Valor original em outra largura (moldura escondida) ─────────────────────
// O valor do celular nem sempre está num @media do próprio elemento: variáveis
// CSS (o Elementor muda --padding-top no celular), tamanhos fluidos
// (clamp(31px, 5.4vw, 56px)), herança de um ancestral que muda no celular…
// Para esses casos, a página (DOM do canvas, só com o CSS original, sem as
// edições) é calculada numa moldura escondida nas duas larguras.

/** Tags que não entram na cópia: CSS (o original vai inteiro na folha), scripts e o que carrega ou navega. */
const SKIP_TAGS = new Set(["style", "link", "script", "meta", "base", "noscript"]);
/** Atributos que carregariam arquivos ou páginas na cópia. */
const RESOURCE_ATTRS = new Set(["src", "srcset", "srcdoc", "poster", "data", "background"]);

interface Probe {
  frame: HTMLIFrameElement;
  sheet: CSSStyleSheet;
  text: string;
}

const probes = new WeakMap<Document, Probe>();
const sheetTexts = new WeakMap<CSSStyleSheet, { signature: string; text: string }>();

/** Texto do CSS original: a folha base com as folhas importadas abertas (sem camadas nem @font-face). */
function expandedText(sheet: CSSStyleSheet, depth: number): string {
  const list = rulesOf(sheet);
  if (!list || depth > 8) return "";
  let out = "";
  for (const rule of Array.from(list)) {
    const r = rule as AnyRule;
    if ("styleSheet" in r) {
      const inner = expandedText(r.styleSheet as CSSStyleSheet, depth + 1);
      const media = String((r.media as MediaList | undefined)?.mediaText ?? "").trim();
      if (inner) out += media && media !== "all" ? `@media ${media}{\n${inner}}\n` : inner;
      continue;
    }
    const text = rule.cssText;
    // Fontes não mudam valores calculados (e baixariam arquivos).
    if (/^@font-face/i.test(text)) continue;
    out += `${text}\n`;
  }
  return out;
}

function originalText(sheet: CSSStyleSheet): string {
  const signature = signatureOf(sheet);
  const cached = sheetTexts.get(sheet);
  if (cached && cached.signature === signature) return cached.text;
  const text = expandedText(sheet, 0);
  sheetTexts.set(sheet, { signature, text });
  return text;
}

function probeFor(panel: Document): Probe | null {
  const current = probes.get(panel);
  if (current?.frame.isConnected && current.frame.contentDocument) return current;
  current?.frame.remove();
  const frame = panel.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("data-os-probe", "");
  frame.tabIndex = -1;
  frame.style.cssText =
    "position:fixed;left:-100000px;top:0;width:1280px;height:800px;border:0;visibility:hidden;pointer-events:none";
  panel.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow as (Window & { CSSStyleSheet?: typeof CSSStyleSheet }) | null;
  if (!doc || !win?.CSSStyleSheet) {
    frame.remove();
    return null;
  }
  doc.open();
  doc.write("<!doctype html><html><head></head><body></body></html>");
  doc.close();
  const sheet = new win.CSSStyleSheet();
  doc.adoptedStyleSheets = [sheet];
  const probe = { frame, sheet, text: "" };
  probes.set(panel, probe);
  return probe;
}

/** Tira a moldura escondida do painel (editor fechado). */
export function releaseProbe(panel: Document | null | undefined) {
  if (!panel) return;
  probes.get(panel)?.frame.remove();
  probes.delete(panel);
}

/** Cópia do <body> do canvas no documento da moldura (sem CSS, scripts nem arquivos). Devolve a cópia de `target`. */
function mirrorBody(from: Document, to: Document, target: Element): Element | null {
  let found: Element | null = null;
  const copy = (node: Node, depth: number): Node | null => {
    if (node.nodeType === 3) return to.createTextNode((node as Text).data);
    if (node.nodeType !== 1 || depth > 500) return null;
    const el = node as Element;
    if (SKIP_TAGS.has(el.localName)) return null;
    let out: Element;
    try {
      out = to.createElementNS(el.namespaceURI, el.localName);
    } catch {
      return null;
    }
    const linkable = el.localName === "a" || el.localName === "area";
    for (const attr of Array.from(el.attributes)) {
      const name = attr.localName.toLowerCase();
      if (RESOURCE_ATTRS.has(name) || (name === "href" && !linkable)) continue;
      try {
        if (attr.namespaceURI) out.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
        else out.setAttribute(attr.name, attr.value);
      } catch {
        // Nome de atributo que o DOM não aceita: fica de fora.
      }
    }
    if (el === target) found = out;
    for (const child of Array.from(el.childNodes)) {
      const c = copy(child, depth + 1);
      if (c) out.appendChild(c);
    }
    return out;
  };
  const body = from.body ? copy(from.body, 0) : null;
  if (!body || !to.body) return null;
  to.documentElement.replaceChild(body, to.body);
  const root = to.documentElement;
  for (const attr of Array.from(root.attributes)) root.removeAttribute(attr.name);
  for (const attr of Array.from(from.documentElement.attributes)) {
    try {
      root.setAttribute(attr.name, attr.value);
    } catch {
      // idem
    }
  }
  // Nada é desenhado (nem imagens de fundo): só os valores calculados importam.
  root.style.setProperty("display", "none", "important");
  return found;
}

/**
 * O CSS original dá a estas propriedades do elemento outro valor numa tela de
 * celular (`phoneWidth`) do que na largura atual do canvas? Compara os valores
 * calculados, só com o CSS original, nas duas larguras. Com o documento
 * inteiro escondido, width, margin, padding… saem como valores calculados
 * (50%, auto), não como a medida desenhada.
 *
 * Fora o próprio tamanho da letra, as outras propriedades são comparadas com a
 * letra do elemento igual nas duas larguras: um valor que só acompanha a letra
 * (line-height 1.2, letter-spacing -.02em, margem de .5em num título clamp())
 * não é um valor "do celular" — a edição do Desktop vale ali também. Variáveis
 * e vw/clamp() na própria propriedade continuam contando.
 */
export function originalChangesOnPhone(el: Element, props: string[], phoneWidth: number): boolean {
  const doc = el.ownerDocument;
  const win = doc.defaultView;
  const base = doc.querySelector<HTMLLinkElement>(`link[${BASE_CSS_ATTR}]`)?.sheet;
  const panel = win?.frameElement?.ownerDocument;
  if (!win || !base || !panel?.body) return false;
  const probe = probeFor(panel);
  const probeDoc = probe?.frame.contentDocument;
  const probeWin = probe?.frame.contentWindow;
  if (!probe || !probeDoc || !probeWin) return false;
  const text = originalText(base);
  if (probe.text !== text) {
    probe.sheet.replaceSync(text);
    probe.text = text;
  }
  const target = mirrorBody(doc, probeDoc, el);
  if (!target) return false;
  const valuesAt = (width: number, list: string[]) => {
    probe.frame.style.width = `${width}px`;
    void probe.frame.offsetWidth;
    const style = probeWin.getComputedStyle(target);
    return list.map((p) => style.getPropertyValue(p));
  };
  const changes = (list: string[]) => {
    if (!list.length) return false;
    const wide = valuesAt(win.innerWidth, list);
    const narrow = valuesAt(phoneWidth, list);
    return wide.some((value, i) => value !== narrow[i]);
  };
  try {
    if (changes(props.filter((p) => p === "font-size"))) return true;
    const others = props.filter((p) => p !== "font-size");
    if (!others.length) return false;
    const [size] = valuesAt(win.innerWidth, ["font-size"]);
    (target as Element & ElementCSSInlineStyle).style?.setProperty("font-size", size, "important");
    return changes(others);
  } finally {
    // A cópia não fica guardando o DOM da página.
    probeDoc.body?.replaceChildren();
  }
}
