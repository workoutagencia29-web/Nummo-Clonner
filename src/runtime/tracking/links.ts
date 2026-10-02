/**
 * Para onde um elemento leva e se ele é um botão de checkout (mesma regra de
 * destinationOf em src/lib/offer-links.ts e do script das páginas).
 */
import type { Cfg } from "./config";
import { attr, doc } from "./util";

/** Elementos clicáveis que levam a algum lugar (ou que o painel marcou como checkout). */
const LINKS = "a[href],area[href],[data-os-href],[data-os-link],[data-os-checkout]";

/**
 * Atributo com o destino: <a>/<area> usam o href, ou o data-os-href se o href
 * for vazio, "#" ou "javascript:"; <form> usa o action; os demais, data-os-href.
 */
export function destAttr(el: Element): string | null {
  const tag = el.tagName;
  const href = attr(el, "href");
  if ((tag === "A" || tag === "AREA") && href && href !== "#" && !/^javascript:/i.test(href)) return "href";
  if (tag === "FORM" && attr(el, "action")) return "action";
  return attr(el, "data-os-href") ? "data-os-href" : null;
}

/**
 * Endereço http(s) do texto (relativo vale); mailto, tel e javascript não. Uma
 * âncora ("#x") vira a própria página, que nunca é checkout nem recebe parâmetros.
 */
export function toUrl(raw: string): URL | null {
  try {
    const url = new URL(raw, doc.baseURI); // respeita um <base href> da página clonada
    return /^https?:$/.test(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

/**
 * O endereço bate com uma entrada de checkoutHosts: "pay.hotmart.com" (host
 * exato), ".dominio.com" (qualquer subdomínio) e, com caminho
 * ("app.monetizze.com.br/checkout/"), só quando o caminho começa assim.
 */
export function hostMatches(host: string, path: string, entry: string) {
  const cut = entry.indexOf("/");
  const h = cut < 0 ? entry : entry.slice(0, cut);
  return (h[0] === "." ? host.endsWith(h) : host === h) && (cut < 0 || path.indexOf(entry.slice(cut)) === 0);
}

/**
 * É checkout: marcado pelo clonador (data-os-checkout), ligado a um link de
 * checkout da oferta (data-os-link) ou indo para um host de checkout conhecido
 * ("pay.hotmart.com" exato, sem www.; ".dominio.com" = qualquer subdomínio;
 * "host/caminho" = só nesse caminho). O próprio site nunca conta só pelo
 * host: checkout no mesmo domínio precisa do link da oferta.
 */
export function isCheckout(el: Element, cfg: Cfg, url?: URL | null): boolean {
  if (el.hasAttribute("data-os-checkout") || cfg.checkoutLinkKeys.includes(attr(el, "data-os-link"))) return true;
  if (url === undefined) {
    const a = destAttr(el);
    url = a ? toUrl(attr(el, a)) : null;
  }
  const bare = (h: string) => h.replace(/^www\./, "");
  const host = url ? bare(url.hostname) : "";
  const path = url ? url.pathname.toLowerCase() : "";
  return !!host && host !== bare(location.hostname) && cfg.checkoutHosts.some((h) => hostMatches(host, path, h));
}

/**
 * O botão de checkout clicado (o próprio alvo ou um ancestral), se houver. Um
 * <form> de checkout não conta no clique (clicar num campo não é iniciar o
 * checkout): conta no envio (ver ./rules).
 */
export function checkoutOf(target: Element, cfg: Cfg): Element | null {
  for (let el = target.closest(LINKS); el; el = el.parentElement ? el.parentElement.closest(LINKS) : null) {
    if (el.tagName !== "FORM" && isCheckout(el, cfg)) return el;
  }
  return null;
}
