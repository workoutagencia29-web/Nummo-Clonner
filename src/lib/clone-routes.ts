/**
 * Funil clonado no modo "Com scripts" (PRESERVE_JS): o JavaScript original do
 * site continua rodando e navega pelos endereços ORIGINAIS ("/roleta",
 * "https://site.com/loja/", history.pushState do react-router…), e um
 * site-aplicativo escolhe a tela pelo `location.pathname`. Aqui ficam as
 * regras (funções puras, sem dependências pesadas: o render, a prévia, o ZIP e
 * o salvar da clonagem usam):
 *
 * - `routeKey`: caminho normalizado para comparar endereços;
 * - `offerRoutes`/`pageRoutes`: o mapa caminho original → página da oferta;
 * - `routesScript`/`injectRoutes`: o script mínimo (ES5, Safari 13) que vai no
 *   começo do <head> das páginas "Com scripts" — põe o caminho original na
 *   barra antes dos scripts da página (o roteador acha a rota) e troca a
 *   navegação para outra página clonada (pushState/replaceState, clique em
 *   link, window.open e a API Navigation) pelo endereço dela na cópia: o
 *   visitante nunca vai para o site original;
 * - `rewriteScriptPageUrls`: no salvar, os endereços completos das páginas
 *   clonadas dentro dos scripts inline viram o caminho original (o Safari não
 *   tem a API Navigation: `location.href = "https://site.com/roleta"` sairia
 *   da cópia).
 */
import { scriptString } from "@/lib/export/head";
import { injectAtHeadStart } from "@/lib/tracking/inject";
import { isSyntheticOrigin } from "@/worker/clone/synthetic";

// ─── Caminhos ────────────────────────────────────────────────────────────────

/**
 * Caminho normalizado para comparar: sem query/#, decodificado (com
 * segurança), minúsculas, barras repetidas juntadas, sem index.html/.htm/.php
 * e sem barra no fim ("/" continua "/"). A mesma regra roda na página
 * (ROUTE_KEY_JS): mudou uma, mude a outra.
 */
export function routeKey(pathname: string): string {
  let p = String(pathname ?? "").split(/[?#]/)[0];
  try {
    p = decodeURIComponent(p);
  } catch {
    // "%" solto: segue como veio
  }
  p = p
    .toLowerCase()
    .replace(/\/{2,}/g, "/")
    .replace(/\/index\.(?:html?|php)$/, "/")
    .replace(/\/$/, "");
  return p.charAt(0) === "/" ? p : `/${p}`;
}

/** routeKey em ES5, para o script das páginas (o teste confere que dá o mesmo resultado). */
export const ROUTE_KEY_JS = String.raw`function(p){p=String(p).split(/[?#]/)[0];try{p=decodeURIComponent(p)}catch(e){}p=p.toLowerCase().replace(/\/{2,}/g,"/").replace(/\/index\.(?:html?|php)$/,"/").replace(/\/$/,"");return p.charAt(0)==="/"?p:"/"+p}`;

/** URL http(s) de verdade (não as origens internas de importação), ou null. */
function originalUrl(url: string | null | undefined): URL | null {
  if (!url || isSyntheticOrigin(url)) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/** Host para comparar: minúsculas, sem "www." (com a porta, se houver). */
function hostKey(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

/**
 * Caminho original de uma página ("/roleta", "/loja/"), como o navegador
 * escreve (codificado), sem barras repetidas. null = sem endereço de verdade.
 */
export function originalPath(sourceUrl: string | null | undefined): string | null {
  const u = originalUrl(sourceUrl);
  return u ? u.pathname.replace(/\/{2,}/g, "/") : null;
}

// ─── Mapa da oferta ──────────────────────────────────────────────────────────

export interface RoutePage {
  id: string;
  sourceUrl: string | null | undefined;
  isHome: boolean;
  cloneMode?: string;
}

export interface RouteEntry {
  pageId: string;
  /** routeKey do caminho original. */
  key: string;
  /** Caminho original como veio ("/produto/camiseta"). */
  path: string;
  /**
   * A página é a dona do caminho no mapa. Chave repetida (a mesma página
   * clonada duas vezes): fica a primeira — a página inicial ganha de qualquer
   * outra — e as outras não são destino nem trocam o endereço.
   */
  owner: boolean;
}

export interface OfferRoutes {
  /** Hosts originais das páginas (minúsculas, sem "www."). */
  hosts: string[];
  /** Na ordem: página inicial primeiro, depois a ordem recebida. */
  pages: RouteEntry[];
}

/** Mapa de rotas de uma oferta, a partir das páginas com endereço de origem. */
export function offerRoutes(pages: readonly RoutePage[]): OfferRoutes {
  const hosts: string[] = [];
  const entries: RouteEntry[] = [];
  const taken = new Set<string>();
  const ordered = [...pages.filter((p) => p.isHome), ...pages.filter((p) => !p.isHome)];
  for (const page of ordered) {
    const u = originalUrl(page.sourceUrl);
    if (!u) continue;
    const host = hostKey(u.host);
    if (!hosts.includes(host)) hosts.push(host);
    const path = u.pathname.replace(/\/{2,}/g, "/");
    const key = routeKey(path);
    entries.push({ pageId: page.id, key, path, owner: !taken.has(key) });
    taken.add(key);
  }
  return { hosts, pages: entries };
}

/** Página dona de um caminho (ex.: o pedido "/roleta" na prévia), ou null. */
export function routePageId(routes: OfferRoutes, pathname: string): string | null {
  const key = routeKey(pathname);
  return routes.pages.find((p) => p.owner && p.key === key)?.pageId ?? null;
}

// ─── Script das páginas ──────────────────────────────────────────────────────

export interface RoutesScriptConfig {
  /** Caminho original da própria página ("/roleta"); null = não troca o endereço da barra. */
  self: string | null;
  /**
   * routeKey do caminho original de cada OUTRA página → endereço dela na cópia,
   * relativo à raiz do site, sem a barra do começo ("p/<id>" na prévia,
   * "loja/" no ZIP, "" = a raiz).
   */
  routes: Record<string, string>;
  /** Hosts originais (minúsculas, sem "www."). */
  hosts: string[];
  /**
   * ZIP: quantas pastas subir da pasta da página até a raiz do site, contadas
   * no endereço em que a página abriu (antes de trocar pelo caminho original).
   * null/ausente = a raiz é "/" (prévia).
   */
  up?: number | null;
  /**
   * ZIP: pasta (relativa à raiz) a que os endereços relativos do HTML se
   * referem (a do caminho original). Se o navegador não deixar trocar o
   * endereço (arquivo aberto do computador, file://), vira um <base> com ela.
   */
  baseDir?: string | null;
}

/** Atributo do <script> das rotas (o render tira um antigo antes de pôr o novo). */
export const ROUTES_SCRIPT_ATTR = "data-os-rotas";

/**
 * Rotas de uma página da oferta para o script. `copyPath(id)`: endereço da
 * página na cópia, relativo à raiz (null = a página não está nela). null =
 * nada a fazer (página sem caminho original e nenhuma outra página clonada).
 */
export function pageRoutes(
  routes: OfferRoutes,
  pageId: string,
  copyPath: (pageId: string) => string | null | undefined,
  extra: Pick<RoutesScriptConfig, "up" | "baseDir"> = {},
): RoutesScriptConfig | null {
  const own = routes.pages.find((p) => p.pageId === pageId);
  const map: Record<string, string> = {};
  for (const p of routes.pages) {
    // O caminho da própria página (mesmo repetido) nunca leva a outra.
    if (!p.owner || p.pageId === pageId || p.key === own?.key) continue;
    const href = copyPath(p.pageId);
    if (href != null) map[p.key] = href.replace(/^\/+/, "");
  }
  const self = own?.owner ? own.path : null;
  if (!self && !Object.keys(map).length) return null;
  return {
    self,
    routes: map,
    hosts: routes.hosts,
    ...(extra.up != null ? { up: extra.up } : {}),
    ...(extra.baseDir != null ? { baseDir: extra.baseDir } : {}),
  };
}

/**
 * O script (ES5, Safari 13). Ordem:
 * 1. raiz do site (ZIP: sobe `up` pastas a partir da pasta em que a página abriu);
 * 2. caminho original na barra (replaceState ORIGINAL), antes de qualquer
 *    script da página; sem permissão (file://), um <base> com a pasta dos
 *    endereços relativos;
 * 3. `D(endereço)`: outra página clonada (host atual ou original + caminho do
 *    mapa, fora a própria página e os endereços que já são da cópia) → o
 *    endereço dela na cópia, com a query e o # do destino;
 * 4. pushState/replaceState, clique em link (depois dos scripts da página: se
 *    um deles cuidou do clique — preventDefault —, o link fica como está),
 *    window.open e a API Navigation (location.href/assign/replace).
 */
export function routesScript(config: RoutesScriptConfig): string {
  const data = {
    s: config.self ?? "",
    r: config.routes,
    h: config.hosts,
    u: config.up ?? -1,
    b: config.baseDir ?? null,
  };
  return [
    "(function(){try{",
    `var C=${scriptString(data)},L=location,H=history,R="/",O=Object.prototype.hasOwnProperty,d,i,k,n=0;`,
    String.raw`if(C.u>=0){d=L.pathname.replace(/[^\/]*$/,"");for(i=0;i<C.u;i++)d=d.replace(/[^\/]+\/$/,"");R=d||"/"}`,
    `var K=${ROUTE_KEY_JS},S=C.s?K(C.s):"",Q={},rs=H.replaceState,ps=H.pushState;`,
    "for(k in C.r)if(O.call(C.r,k)){Q[R+C.r[k]]=1;n++}",
    String.raw`if(C.s){var T=R+C.s.replace(/^\/+/,"");if(L.pathname!==T){try{rs.call(H,H.state,"",T+L.search+L.hash)}catch(e){if(C.b!=null){var b=document.createElement("base");b.href=R+C.b;(document.head||document.documentElement).appendChild(b)}}}}`,
    "if(!n)return;",
    String.raw`var D=function(x){var u,p,c,h,o;try{u=new URL(x,document.baseURI)}catch(e){return""}if(!/^https?:$/.test(u.protocol))return"";h=u.host.toLowerCase();o=h===L.host.toLowerCase();if(!o&&C.h.indexOf(h.replace(/^www\./,""))<0)return"";p=u.pathname;if(o&&(Q[p]||Q[p.replace(/index\.html?$/,"")]||Q[p.replace(/\/$/,"")]))return"";p=K(p);if(p===S||!O.call(C.r,p))return"";c=C.r[p];return R+c+u.search+u.hash};`,
    'var W=function(f,r){return function(s,t,u){if(u!=null&&u!==""){var c=D(String(u));if(c){if(r)L.replace(c);else L.href=c;return}}return f.apply(H,arguments)}};',
    "if(ps)H.pushState=W(ps,0);if(rs)H.replaceState=W(rs,1);",
    'var A=function(e){if(e.defaultPrevented)return;var t=e.target,a=t&&t.closest?t.closest("a[href],area[href]"):null;if(!a)return;var c=D(a.getAttribute("href"));if(c)a.setAttribute("href",c)};',
    'addEventListener("click",A);addEventListener("auxclick",A);',
    'var w=window.open;if(w)window.open=function(u){var c=u!=null&&u!==""?D(String(u)):"",a;if(c){a=[].slice.call(arguments);a[0]=c;return w.apply(this,a)}return w.apply(this,arguments)};',
    'var N=window.navigation;if(N&&N.addEventListener)N.addEventListener("navigate",function(e){if(!e.cancelable||e.hashChange||e.downloadRequest!=null||e.formData||e.navigationType==="traverse"||e.navigationType==="reload")return;var c=D(e.destination.url);if(c){e.preventDefault();if(e.navigationType==="replace")L.replace(c);else L.href=c}})',
    "}catch(e){}})();",
  ].join("");
}

/** <script data-os-rotas>…</script>. */
export function routesScriptTag(config: RoutesScriptConfig): string {
  return `<script ${ROUTES_SCRIPT_ATTR}>${routesScript(config)}</script>`;
}

/** Script de rotas que já esteja no HTML (página clonada de um ZIP do próprio Offer Studio). */
const OLD_ROUTES_RE = new RegExp(
  `<script\\b(?:[^>"']|"[^"]*"|'[^']*')*?\\s${ROUTES_SCRIPT_ATTR}(?=[\\s=>/])(?:[^>"']|"[^"]*"|'[^']*')*>[\\s\\S]*?</script\\s*>`,
  "gi",
);

/**
 * Põe o script de rotas no começo do <head> (depois das metas de
 * charset/viewport: antes do rastreamento e de qualquer script da página).
 * Um script de rotas antigo sai antes.
 */
export function injectRoutes(html: string, config: RoutesScriptConfig | null | undefined): string {
  if (!config) return html;
  const out = html.includes(ROUTES_SCRIPT_ATTR) ? html.replace(OLD_ROUTES_RE, "") : html;
  return injectAtHeadStart(out, routesScriptTag(config));
}

// ─── Endereços completos nos scripts inline (salvar a clonagem) ──────────────

/** Abertura de <script> (">" dentro de aspas não fecha a tag). */
const SCRIPT_OPEN_RE = /<script(?=[\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const SCRIPT_CLOSE_RE = /<\/script/gi;
/** Começo de um endereço: "https://", "http://", "//" (também escapados de JSON: "https:\/\/"). */
const URL_START_RE = /(?:https?:)?(?:\\\/\\\/|\/\/)/gi;
const HOST_CHAR_RE = /[A-Za-z0-9.-]/;
/** Caracteres de um caminho de URL (a barra escapada "\/" é tratada à parte; acima de 0x7f também vale). */
const PATH_CHAR_RE = /[A-Za-z0-9\-._~%!$*+=:@/]/;

/** O script não roda código (JSON-LD é para buscadores; trocar o endereço deixaria os dados relativos). */
function skipScript(openTag: string): boolean {
  if (/\ssrc\s*=/i.test(openTag)) return true;
  const type = /\stype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(openTag);
  const value = (type?.[1] ?? type?.[2] ?? type?.[3] ?? "").trim().toLowerCase();
  return value === "application/ld+json";
}

/** Troca os endereços das páginas clonadas dentro do texto de um script. */
function rewriteScriptText(text: string, targets: Map<string, Set<string>>): string {
  let out = "";
  let last = 0;
  URL_START_RE.lastIndex = 0;
  for (let m = URL_START_RE.exec(text); m; m = URL_START_RE.exec(text)) {
    const start = m.index;
    const hasScheme = /^https?:/i.test(m[0]);
    // "ftp://", "file://", "x//": não é endereço de página do site.
    if (!hasScheme && start > 0 && /[\w:.+-]/.test(text.charAt(start - 1))) continue;
    const escaped = m[0].includes("\\");
    let j = start + m[0].length;
    const hostStart = j;
    while (j < text.length && HOST_CHAR_RE.test(text.charAt(j))) j++;
    if (j === hostStart) continue;
    let host = text.slice(hostStart, j);
    if (text.charAt(j) === ":" && /[0-9]/.test(text.charAt(j + 1))) {
      j++;
      while (j < text.length && /[0-9]/.test(text.charAt(j))) j++;
      host = text.slice(hostStart, j);
    }
    const paths = targets.get(hostKey(host));
    if (!paths) {
      URL_START_RE.lastIndex = Math.max(URL_START_RE.lastIndex, j);
      continue;
    }
    const pathStart = j;
    let path = "";
    while (j < text.length) {
      const c = text.charAt(j);
      if (c === "\\" && text.charAt(j + 1) === "/") {
        path += "/";
        j += 2;
      } else if (PATH_CHAR_RE.test(c) || c.charCodeAt(0) > 0x7f) {
        path += c;
        j++;
      } else break;
    }
    URL_START_RE.lastIndex = Math.max(URL_START_RE.lastIndex, j);
    // O host tem que terminar ali: "site.com.br" não é "site.com" (o laço já leu tudo), nem "site.comx".
    if (!paths.has(routeKey(path || "/"))) continue;
    const rawPath = text.slice(pathStart, j);
    out += text.slice(last, start) + (rawPath || (escaped ? "\\/" : "/"));
    last = j;
  }
  return last ? out + text.slice(last) : text;
}

/**
 * Nos <script> INLINE (sem src) do HTML, troca os endereços COMPLETOS das
 * páginas clonadas (https://site.com/roleta, com ou sem www, http/https, com
 * ou sem barra no fim, também escapados de JSON "https:\/\/site.com\/roleta")
 * pelo caminho original a partir da raiz ("/roleta"), mantendo a query e o #.
 * Só troca o endereço inteiro de uma página ("/roleta-2" não é "/roleta"). O
 * resto do HTML fica byte a byte igual (troca de texto, leitura linear).
 */
export function rewriteScriptPageUrls(html: string, pages: readonly { url: string }[]): string {
  const targets = new Map<string, Set<string>>();
  for (const { url } of pages) {
    const u = originalUrl(url);
    if (!u) continue;
    const host = hostKey(u.host);
    const set = targets.get(host) ?? new Set<string>();
    set.add(routeKey(u.pathname));
    targets.set(host, set);
  }
  if (!targets.size || !/<script/i.test(html)) return html;
  let out = "";
  let last = 0;
  SCRIPT_OPEN_RE.lastIndex = 0;
  for (let open = SCRIPT_OPEN_RE.exec(html); open; open = SCRIPT_OPEN_RE.exec(html)) {
    const bodyStart = open.index + open[0].length;
    SCRIPT_CLOSE_RE.lastIndex = bodyStart;
    const close = SCRIPT_CLOSE_RE.exec(html);
    const bodyEnd = close ? close.index : html.length;
    SCRIPT_OPEN_RE.lastIndex = bodyEnd;
    if (skipScript(open[0])) continue;
    const body = html.slice(bodyStart, bodyEnd);
    const next = rewriteScriptText(body, targets);
    if (next === body) continue;
    out += html.slice(last, bodyStart) + next;
    last = bodyEnd;
  }
  return last ? out + html.slice(last) : html;
}
