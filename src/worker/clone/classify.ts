/**
 * Que etapa do funil é esta página clonada: quiz, roleta, loja, página de
 * produto, VSL, captura, upsell, downsell, obrigado ou página de vendas. Dá o
 * tipo e o nome da página no mapa da revisão e ao salvar a oferta.
 *
 * Função pura sobre o DOM do cheerio (sem rede, sem banco).
 */
import type { CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import { nameKey } from "@/lib/text";
import { classify, pagePath } from "./funnel";
import { isElement } from "./html-assets";
import type { ExploreReport, FunnelPageInfo, FunnelPageKind, PageLinkFound } from "./types";

const QUIZ_WORDS =
  /\b(?:pergunta|perguntas|etapa \d|passo \d|quiz|question|step \d|responda|questionario|teste rapido)\b/;
const WHEEL_WORDS =
  /\b(?:gire|girar|gira a roleta|roleta|roda da sorte|roda premiada|ruleta|spin the wheel|giro gratis|gire e ganhe)\b/;
const WHEEL_SHAPE =
  "canvas, svg[class*=wheel], svg[class*=roleta], svg[class*=roda], [class*=wheel], [class*=roleta], [class*=ruleta], [class*=roda-], [id*=wheel], [id*=roleta]";
const BUY_WORDS =
  /\b(?:comprar|compre agora|comprar agora|adicionar ao carrinho|adicionar a sacola|add to cart|buy now|comprar ahora|anadir al carrito|agregar al carrito)\b/;
const PRICE_RE = /(?:R\$|US\$|MX\$|\$|€|£)\s?\d/;

const URL_KIND: [RegExp, FunnelPageKind][] = [
  [/(?:^|[/_.-])(?:quiz|questionario|teste)(?=$|[/_.-])/i, "QUIZ"],
  [/(?:^|[/_.-])(?:roleta|ruleta|wheel|spin|giro|roda)(?=$|[/_.-])/i, "WHEEL"],
  [
    /(?:^|[/_.-])(?:loja|shop|store|produtos|products|collections|colecao|catalogo|catalog|vitrine|ofertas)(?=$|[/_.-])/i,
    "STORE",
  ],
  [/(?:^|[/_.-])(?:produto|product|item|p)(?=\/)/i, "PRODUCT"],
];

/** Nome padrão de cada tipo ("" = usar o título da página). */
export const FUNNEL_KIND_NAME: Record<FunnelPageKind, string> = {
  QUIZ: "Quiz",
  WHEEL: "Roleta",
  STORE: "Loja",
  PRODUCT: "Produto",
  VSL: "",
  SALES: "",
  CAPTURE: "",
  UPSELL: "Upsell",
  DOWNSELL: "Downsell",
  THANK_YOU: "Obrigado",
  OTHER: "",
};

export interface ClassifyInput {
  $: CheerioAPI;
  pageUrl: string;
  /** Páginas a que ela leva (cartões de produto contam para "loja"). */
  links: PageLinkFound[];
  /** Tinha botão de checkout. */
  hasCheckout: boolean;
  /** Vídeo de VSL (player de terceiros) ou elementos que aparecem depois do vídeo. */
  isVsl: boolean;
  explored?: ExploreReport;
}

const HIDDEN_TAGS = new Set(["script", "style", "noscript", "template", "svg", "head"]);

/**
 * Texto de um trecho com espaço entre os elementos ("Camiseta" + "R$ 79,90"
 * não vira "CamisetaR$ 79,90", como no text() do cheerio sobre HTML sem
 * quebras de linha, comum nas páginas montadas por React).
 */
export function spacedText(nodes: AnyNode[]): string {
  const out: string[] = [];
  const walk = (list: AnyNode[]) => {
    for (const n of list) {
      if (n.type === "text") out.push((n as { data: string }).data);
      else if (isElement(n) && !HIDDEN_TAGS.has(n.tagName)) walk(n.children);
    }
  };
  walk(nodes);
  return out.join(" ").replace(/\s+/g, " ").trim();
}

function visibleText($: CheerioAPI): string {
  return spacedText($("body").toArray());
}

function firstHeading($: CheerioAPI): string {
  for (const el of $("h1, h2").toArray()) {
    if (!isElement(el)) continue;
    const t = spacedText([el]);
    if (t && t.length <= 120) return t;
  }
  return "";
}

/** Grupos de opções de quiz: 3+ botões irmãos parecidos com texto curto. */
function optionGroups($: CheerioAPI): number {
  let groups = 0;
  for (const el of $("button, [role=button], label, li, a, div[onclick]").toArray()) {
    if (!isElement(el) || !el.parent || !isElement(el.parent)) continue;
    const siblings = el.parent.children.filter(
      (c) => isElement(c) && c.tagName === el.tagName && (c.attribs.class ?? "") === (el.attribs.class ?? ""),
    );
    if (siblings[0] !== el || siblings.length < 3) continue;
    const short = siblings.every((s) => {
      const t = spacedText([s]);
      return t.length > 0 && t.length <= 70;
    });
    if (short) groups++;
  }
  return groups;
}

/** Tipo e nome da página clonada no funil. */
export function classifyPage(input: ClassifyInput): FunnelPageInfo {
  const { $ } = input;
  let path = "/";
  let sub = "";
  try {
    const u = new URL(input.pageUrl);
    path = pagePath(u);
    sub = u.hostname.split(".").length > 2 ? u.hostname.split(".")[0] : "";
  } catch {
    // endereço interno de importação: só o conteúdo decide
  }
  const words = nameKey(visibleText($)).slice(0, 20_000);
  const products = new Set(input.links.filter((l) => l.product).map((l) => l.url)).size;
  const byUrl = URL_KIND.find(([re]) => re.test(path))?.[1];
  const named = (kind: FunnelPageKind, name = FUNNEL_KIND_NAME[kind]): FunnelPageInfo => ({ kind, name });

  // Upsell, downsell e obrigado: o endereço manda (mesma regra das sugestões).
  const funnel = classify(`${sub}${path}`, "");
  if (funnel && funnel.kind !== "OTHER") return named(funnel.kind);

  const screens = input.explored?.screens ?? 0;
  const quizLike =
    byUrl === "QUIZ" ||
    (QUIZ_WORDS.test(words) && (optionGroups($) > 0 || screens >= 3)) ||
    (screens >= 4 && optionGroups($) > 0);
  const wheelLike = byUrl === "WHEEL" || (WHEEL_WORDS.test(words) && $(WHEEL_SHAPE).length > 0);
  if (wheelLike && !(byUrl === "QUIZ")) return named("WHEEL");
  if (quizLike) return named("QUIZ");

  if (products >= 3 || (byUrl === "STORE" && products >= 1)) return named("STORE");
  const heading = firstHeading($);
  const productLike =
    (byUrl === "PRODUCT" || (BUY_WORDS.test(words) && PRICE_RE.test(visibleText($)))) &&
    products < 3 &&
    $("h1").length > 0;
  if (productLike) return named("PRODUCT", (heading || FUNNEL_KIND_NAME.PRODUCT).slice(0, 80));

  if (input.isVsl) return named("VSL");
  const emailField = $("input[type=email], input[name*=mail i], input[placeholder*=mail i]").length > 0;
  if (emailField && !input.hasCheckout && words.length < 6000) return named("CAPTURE");
  if (input.hasCheckout) return named("SALES");
  return named("OTHER");
}
