/**
 * O que o ZIP acrescenta no <head> de cada página (funções puras, sem DOM):
 *
 * - Script "de chegada" (earlyScript), o primeiro do <head> (antes do
 *   rastreamento, para nada disparar numa página que vai trocar):
 *   1. endereço sem a barra no fim ("/oferta" em vez de "/oferta/") → recarrega
 *      com a barra, senão os caminhos relativos (../assets/…) quebram;
 *   2. versão A/B (com o divisor): guarda a versão que o visitante viu, no
 *      mesmo formato do divisor — quem chega direto em oferta-b/ (anúncio) e
 *      depois volta ao endereço da página continua na versão B;
 *   3. versão celular separada: celular (pelo navegador ou tela pequena de
 *      toque) vai para celular/ com a query string e o hash; ?versao=computador
 *      fica na versão de computador (e vale para a visita);
 *   4. a página ficou (sem redirecionar): a origem da visita guardada antes de
 *      um redirecionamento do ZIP volta ao document.referrer (ver abaixo);
 *   5. aberto do computador (file://): links para pastas ("upsell/") ganham
 *      "index.html", para dar para testar o funil sem hospedagem.
 *   O caminho do endereço é normalizado antes ("//outro-site.com/x" vira
 *   "/outro-site.com/x"): num servidor que entrega a página para qualquer
 *   caminho, o redirecionamento nunca sai do site — e a ida para celular/ tem
 *   uma trava (redirectGuardJs) para não repetir "celular/celular/…" sem fim.
 *   Antes de cada redirecionamento, a origem da visita (outro site) fica em
 *   sessionStorage "os_ref" com a hora (SAVE_REF_JS), e a página que fica (sem
 *   novo redirecionamento, até 1 minuto depois) devolve essa origem ao
 *   document.referrer (RESTORE_REF_JS) antes do rastreamento: senão o GA4, a
 *   Meta e o TikTok veriam o próprio site (o divisor) como origem e a visita
 *   sem UTMs (bio, busca orgânica, WhatsApp) viraria "direta".
 * - canonical (versões A/B e celular apontam para a página principal, para o
 *   Google não ver conteúdo duplicado) e "alternate" do celular.
 * - metas de verificação de domínio, imagem de compartilhamento com endereço
 *   completo e as tags de compartilhamento que o divisor copia da versão de
 *   controle.
 */

import { INERT_CODE_RE, VERIFICATION_NAME_RE, verificationMetas } from "@/lib/tracking/domain-verification";

/** Celular pelo User-Agent (mesma lista de isMobileUserAgent em src/lib/page-render.ts). */
const MOBILE_UA_SOURCE = "iPhone|iPod|Android.*Mobile|Mobile Safari|Windows Phone|BlackBerry|Opera Mini";

/** Parâmetro que mantém a versão de computador no celular. */
export const DESKTOP_PARAM = "versao";
export const DESKTOP_PARAM_VALUE = "computador";

/**
 * JS (ES5) que põe em `d` se o visitante pediu a versão de computador
 * (?versao=computador, lembrado na visita) e usa `l` = location.
 */
export const DESKTOP_CHOICE_JS = `var k="os_versao",d=null,q=l.search;if(/[?&]${DESKTOP_PARAM}=${DESKTOP_PARAM_VALUE}(?:&|$)/.test(q)){try{sessionStorage.setItem(k,"1")}catch(e){}d="1"}if(!d){try{d=sessionStorage.getItem(k)}catch(e){}}`;

/** JS (ES5) que põe em `m` se é celular (pelo navegador ou tela pequena de toque). */
export const MOBILE_TEST_JS = `var m=/${MOBILE_UA_SOURCE}/i.test(navigator.userAgent||"");if(!m&&window.matchMedia){try{m=matchMedia("(pointer: coarse)").matches&&Math.min(screen.width,screen.height)<=640}catch(e){}}`;

/** JS (ES5): o caminho do endereço em `p`, com uma barra só no começo ("//x.com/a" → "/x.com/a"). */
export const SAFE_PATH_JS = 'p=l.pathname.replace(/^[\\/\\\\]+/,"/")';

/**
 * sessionStorage com a origem da visita (outro site) que um redirecionamento
 * do ZIP apagaria: "<hora em ms>|<endereço>" (ex.: "1790000000000|https://l.instagram.com/").
 */
export const REFERRER_KEY = "os_ref";

/**
 * Por quanto tempo a origem guardada vale. A página que fica chega em segundos
 * depois do redirecionamento; uma chave que sobrou na aba (redirecionamento
 * interrompido pelo "Voltar", hospedagem que entrega o divisor para qualquer
 * caminho) não vale para uma visita depois, digitada ou de um favorito.
 */
export const REFERRER_MAX_AGE_MS = 60_000;

/**
 * Origens que voltam ao document.referrer (JS, regex literal): endereço
 * http(s) ou app Android ("android-app://com.google.android.googlequicksearchbox/"
 * = app do Google/Discover, "android-app://com.google.android.gm/" = Gmail:
 * o Chrome do Android manda assim, e o GA4 reconhece). Nunca javascript:,
 * data: nem "//site".
 */
const REF_URL_RE_JS = "/^(?:https?|android-app):\\/\\/[^\\/]/i";

/**
 * JS (ES5), logo antes de um location.replace do ZIP (divisor, celular/, barra
 * no fim): depois do redirecionamento, document.referrer passa a ser o próprio
 * site, então a origem da visita (Instagram, Google, outro site) fica em
 * sessionStorage "os_ref", com a hora, para a página de destino
 * (RESTORE_REF_JS). Sempre a mais recente de fora do site (um redirecionamento
 * interno nunca troca); só o que a página de destino usaria. Usa `l`
 * (location) e `f` (aberto do computador).
 */
export const SAVE_REF_JS = `try{var R=document.referrer;if(R&&!f&&R.indexOf(l.protocol+"//"+l.host+"/")!==0&&${REF_URL_RE_JS}.test(R))sessionStorage.setItem(${JSON.stringify(REFERRER_KEY)},new Date().getTime()+"|"+R.slice(0,500))}catch(e){}`;

/**
 * JS (ES5) da página que fica, depois dos redirecionamentos do script de
 * chegada e antes do rastreamento: com uma origem guardada por SAVE_REF_JS há
 * menos de REFERRER_MAX_AGE_MS e o navegador mostrando o próprio site (ou
 * nada) como origem — a visita passou por um redirecionamento do ZIP —,
 * document.referrer volta a ser a origem de verdade. Assim o GA4
 * (page_referrer), a Meta, o TikTok, a UTMify e qualquer outro código da
 * página atribuem a visita ao Instagram/Google/… e não ao próprio site. Vale
 * uma vez: a chave é apagada na primeira página, usada ou não (os links do
 * funil depois disso mostram a origem real, a página anterior). Usa `l` e `f`.
 */
export const RESTORE_REF_JS = `if(!f){try{var O=sessionStorage.getItem(${JSON.stringify(REFERRER_KEY)}),B=document.referrer;if(O){sessionStorage.removeItem(${JSON.stringify(REFERRER_KEY)});var X=/^(\\d{1,15})\\|([\\s\\S]+)$/.exec(O),A=X?new Date().getTime()-X[1]:NaN;if(A>-${REFERRER_MAX_AGE_MS}&&A<${REFERRER_MAX_AGE_MS}&&(!B||B.indexOf(l.protocol+"//"+l.host+"/")===0)&&${REF_URL_RE_JS}.test(X[2]))Object.defineProperty(document,"referrer",{configurable:true,get:function(){return X[2]}})}}catch(e){}}`;

/**
 * JS (ES5): função `G(w,h)` — pode redirecionar da pasta `h` para a pasta `w`?
 * Guarda `w` em sessionStorage `key`; se a página que redireciona volta a ser
 * entregue justamente em `w` (hospedagem que entrega a mesma página para
 * qualquer caminho: Cloudflare Pages sem 404.html, try_files do Nginx), ela
 * para ali em vez de ir para "w/oferta-b/oferta-b/…" sem fim. Numa hospedagem
 * normal, `w` tem a página de destino, então a trava nunca atua. Usa `f`.
 */
export function redirectGuardJs(key: string): string {
  const k = scriptString(key);
  return `var G=function(w,h){if(f)return 1;try{var S=sessionStorage;if(S.getItem(${k})===h)return 0;S.setItem(${k},w)}catch(e){}return 1};`;
}

/** Trava do redirecionamento para a versão celular (script de chegada). */
export const MOBILE_GUARD_KEY = "os_go_cel";
/** Trava do redirecionamento do divisor A/B. */
export const SPLIT_GUARD_KEY = "os_go_ab";

/** Quanto tempo a versão A/B vista fica guardada (divisor e páginas das versões). */
export const AB_STICKY_DAYS = 30;

/** Nome do localStorage/cookie da versão A/B de uma página ("os_ab_<chave>", só [a-z0-9_]). */
export function abStorageName(key: string): string {
  return `os_ab_${key.replace(/[^a-z0-9_]/gi, "").slice(0, 40)}`;
}

/** Versão A/B desta página (com o divisor ligado): o que guardar para o divisor. */
export interface EarlyAbOptions {
  /** Chave do divisor da página (a mesma do splitterScript). */
  key: string;
  /** Pasta desta versão, relativa à pasta da página ("oferta-b/"). */
  folder: string;
  /** Identidade da versão (a mesma do divisor): uma versão recriada com a mesma letra não herda a escolha. */
  id: string;
  /** Quantas pastas acima fica a pasta da página: 1 na versão, 2 no celular dela. */
  up: number;
}

export interface EarlyScriptOptions {
  /** Pasta da versão celular, relativa à página ("celular/"); null = sem versão celular. */
  mobileDir?: string | null;
  /** Versão A/B com o divisor ligado; null = não é versão (ou sem divisor). */
  ab?: EarlyAbOptions | null;
}

/** Script de chegada (ES5, minúsculo). */
export function earlyScript({ mobileDir = null, ab = null }: EarlyScriptOptions = {}): string {
  const parts = [
    "(function(){try{",
    `var l=location,${SAFE_PATH_JS},f=l.protocol==="file:";`,
    // 1. Barra no fim (o caminho já normalizado: nunca vira "//outro-site").
    `if(!f&&!/\\/$|\\.[A-Za-z0-9]{1,8}$/.test(p)){${SAVE_REF_JS}l.replace(p+"/"+l.search+l.hash);document.write('<plaintext style="display:none">');return}`,
  ];
  if (ab) {
    const maxAge = AB_STICKY_DAYS * 86400;
    const up = Math.max(1, Math.min(4, Math.round(ab.up)));
    parts.push(
      // 2. Versão A/B vista: localStorage "pasta|data|id" e cookie "pasta|id" na pasta da página.
      `if(!f){try{var P=p.replace(/[^\\/]*$/,""),u;for(u=0;u<${up};u++)P=P.replace(/[^\\/]+\\/$/,"");P=P||"/";`,
      `var K=${scriptString(abStorageName(ab.key))},S=${scriptString(ab.folder)},I=${scriptString(ab.id)};`,
      'try{localStorage.setItem(K,S+"|"+new Date().getTime()+"|"+I)}catch(e){}',
      `document.cookie=K+"="+encodeURIComponent(S+"|"+I)+";max-age=${maxAge};path="+P+";SameSite=Lax"}catch(e){}}`,
    );
  }
  if (mobileDir) {
    parts.push(
      // 3. Versão celular (com a trava de redirecionamento sem fim e a origem da visita guardada).
      DESKTOP_CHOICE_JS,
      MOBILE_TEST_JS,
      redirectGuardJs(MOBILE_GUARD_KEY),
      `var H=p.replace(/[^\\/]*$/,""),M=${scriptString(mobileDir)};`,
      `if(m&&!d&&G(H+M,H)){${SAVE_REF_JS}l.replace(M+(f?"index.html":"")+q+l.hash);document.write('<plaintext style="display:none">');return}`,
    );
  }
  parts.push(
    // 4. Ficou nesta página: a origem guardada antes de um redirecionamento volta ao document.referrer.
    RESTORE_REF_JS,
    // 5. file://: pastas → index.html.
    'if(f)document.addEventListener("click",function(e){var a=e.target&&e.target.closest&&e.target.closest("a[href]");if(!a)return;var h=a.getAttribute("href")||"";if(/^(?:[a-z][a-z0-9+.-]*:|\\/\\/|#)/i.test(h))return;var x=h.replace(/\\/(?=[?#]|$)/,"/index.html");if(x!==h)a.setAttribute("href",x)},true)',
    "}catch(e){}})();",
  );
  return parts.join("");
}

/** Texto seguro dentro de <script> (JSON sem "<", ">", "&", U+2028/2029). */
export function scriptString(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function earlyScriptTag(opts: EarlyScriptOptions = {}): string {
  return `<script data-os-export>${earlyScript(opts)}</script>`;
}

const ATTRS = `(?:[^>"']|"[^"]*"|'[^']*')*`;
const HEAD_OPEN_RE = new RegExp(`<head\\b${ATTRS}>`, "i");
const HTML_OPEN_RE = new RegExp(`<html\\b${ATTRS}>`, "i");
const DOCTYPE_RE = /^\s*(?:<!--[\s\S]*?-->\s*)*<!doctype[^>]*>/i;
/** Metas, comentários e espaços do começo do <head>. */
const LEADING_RE = new RegExp(`^(?:\\s+|<!--[\\s\\S]*?-->|<meta\\b${ATTRS}>)`, "i");

/**
 * Coloca `tags` no começo do <head>: logo depois das metas iniciais (charset,
 * viewport) — ou seja, antes da configuração/script de rastreamento, que o
 * renderPageHtml põe nesse mesmo ponto. Sem <head>, cria um.
 */
export function insertEarlyHead(html: string, tags: string): string {
  const head = HEAD_OPEN_RE.exec(html);
  if (head) {
    let at = head.index + head[0].length;
    for (let guard = 0; guard < 200; guard++) {
      const m = LEADING_RE.exec(html.slice(at));
      if (!m) break;
      at += m[0].length;
    }
    return `${html.slice(0, at)}${tags}${html.slice(at)}`;
  }
  const htmlOpen = HTML_OPEN_RE.exec(html);
  if (htmlOpen) {
    const at = htmlOpen.index + htmlOpen[0].length;
    return `${html.slice(0, at)}<head>${tags}</head>${html.slice(at)}`;
  }
  const doctype = DOCTYPE_RE.exec(html);
  const at = doctype ? doctype[0].length : 0;
  return `${html.slice(0, at)}<head>${tags}</head>${html.slice(at)}`;
}

/** Coloca `tags` no fim do <head> (antes do </head>); sem </head>, antes do <body>. */
export function insertHeadEnd(html: string, tags: string): string {
  const close = /<\/head\s*>/i.exec(html);
  if (close) return `${html.slice(0, close.index)}${tags}${html.slice(close.index)}`;
  const body = /<body\b/i.exec(html);
  if (body) return `${html.slice(0, body.index)}${tags}${html.slice(body.index)}`;
  return insertEarlyHead(html, tags);
}

const LINK_RE = new RegExp(`<link\\b${ATTRS}>\\s*`, "gi");

function attrOf(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
}

function escapeAttr(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Tira <link rel="canonical"> (e o alternate de celular) que a página já tenha. */
export function stripCanonical(html: string): string {
  return html.replace(LINK_RE, (tag) => {
    const rel = (attrOf(tag, "rel") ?? "").toLowerCase().split(/\s+/);
    if (rel.includes("canonical")) return "";
    if (rel.includes("alternate") && /max-width/i.test(attrOf(tag, "media") ?? "")) return "";
    return tag;
  });
}

export interface HeadLinksOptions {
  /** Endereço da versão principal (relativo ou completo); null = esta é a principal. */
  canonical?: string | null;
  /** Versão celular desta página (para o Google ligar as duas); null = não tem. */
  mobileAlternate?: string | null;
}

/** canonical/alternate no fim do <head> (substitui os que existirem). */
export function applyHeadLinks(html: string, opts: HeadLinksOptions): string {
  if (!opts.canonical && !opts.mobileAlternate) return html;
  const tags: string[] = [];
  if (opts.canonical) tags.push(`<link rel="canonical" href="${escapeAttr(opts.canonical)}">`);
  if (opts.mobileAlternate) {
    tags.push(
      `<link rel="alternate" media="only screen and (max-width: 640px)" href="${escapeAttr(opts.mobileAlternate)}">`,
    );
  }
  return insertHeadEnd(stripCanonical(html), tags.join(""));
}

/**
 * Endereço completo a partir do "Onde está no ar" da oferta (Offer.liveUrl),
 * para canonical e imagem de compartilhamento (o Facebook/WhatsApp só aceitam
 * endereço completo). null = sem endereço válido.
 * "https://site.com/oferta" e "https://site.com/oferta/index.html" → "https://site.com/oferta/".
 */
export function liveBaseUrl(liveUrl: string | null | undefined): string | null {
  if (!liveUrl) return null;
  let url: URL;
  try {
    url = new URL(liveUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.search = "";
  url.hash = "";
  if (/\/[^/]*\.[a-z0-9]{1,8}$/i.test(url.pathname)) url.pathname = url.pathname.replace(/[^/]*$/, "");
  else if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`;
  return url.href;
}

/** Pasta do ZIP → endereço completo no site ("upsell/" + "https://site.com/o/" = "https://site.com/o/upsell/"). */
export function absoluteUrl(base: string, zipPath: string): string {
  return new URL(zipPath, base).href;
}

// ─── Metas do <head> ─────────────────────────────────────────────────────────

const META_TAG_RE = new RegExp(`<meta\\b${ATTRS}>`, "gi");
const LINK_TAG_RE = new RegExp(`<link\\b${ATTRS}>`, "gi");
const TITLE_TAG_RE = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i;
/**
 * Blocos que nunca valem como <head>: código em espera do consentimento (o
 * `<script type="application/json" data-os-consent data-os-block>` de
 * gateCode em src/lib/tracking/inject.ts; <template> em páginas e testes
 * antigos), scripts, estilos e comentários.
 */
const INERT_RE = INERT_CODE_RE;

function decodeAttr(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Conteúdo do <head> (do <head> até o </head> ou o <body>), sem o que é inerte. */
function headContent(html: string): string {
  const open = HEAD_OPEN_RE.exec(html);
  const start = open ? open.index + open[0].length : 0;
  const rest = html.slice(start);
  const end = /<\/head\s*>|<body\b/i.exec(rest);
  return (end ? rest.slice(0, end.index) : rest).replace(INERT_RE, "");
}

/**
 * Metas de verificação de domínio de um código livre (o texto que a pessoa
 * colou, fora de comentários e scripts), reescritas limpas:
 * `<meta name="facebook-domain-verification" content="…">`. A mesma regra do
 * código em espera do consentimento (gateCode), que as deixa fora do bloco.
 */
export { verificationMetas };

function metaKey(tag: string): string | null {
  const name = decodeAttr(attrOf(tag, "name") ?? attrOf(tag, "property") ?? "")
    .trim()
    .toLowerCase();
  if (!name) return null;
  return `${name}|${decodeAttr(attrOf(tag, "content") ?? "").trim()}`;
}

/**
 * Garante que as `metas` apareçam no <head> de verdade (fora do código em
 * espera do consentimento, de scripts e de comentários: INERT_RE): as que já
 * estiverem lá ficam como estão; as que faltarem entram no fim do <head>.
 * Quem confere a verificação de domínio (Meta, Google) não roda JavaScript.
 */
export function ensureHeadMetas(html: string, metas: readonly string[]): string {
  if (!metas.length) return html;
  const present = new Set<string>();
  for (const m of headContent(html).matchAll(META_TAG_RE)) {
    const key = metaKey(m[0]);
    if (key) present.add(key);
  }
  const missing = metas.filter((tag) => {
    const key = metaKey(tag);
    if (!key || present.has(key)) return false;
    present.add(key);
    return true;
  });
  return missing.length ? insertHeadEnd(html, missing.join("")) : html;
}

/** Metas de imagem de compartilhamento (o conteúdo é um endereço). */
const SHARE_IMAGE_META_RE = /^(?:og:image(?::url|:secure_url)?|twitter:image(?::src)?)$/i;
/** Endereço completo ("https://", "data:"…) ou sem protocolo ("//cdn…"). */
const ABSOLUTE_URL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

function isImageSrcLink(tag: string) {
  return (attrOf(tag, "rel") ?? "").toLowerCase().split(/\s+/).includes("image_src");
}

/** Troca o valor de um atributo numa tag (entre aspas duplas). */
function withAttr(tag: string, name: string, value: string): string {
  const re = new RegExp(`(\\s${name}\\s*=\\s*)(?:"[^"]*"|'[^']*'|[^\\s"'>]+)`, "i");
  return tag.replace(re, (_, lead: string) => `${lead}"${escapeAttr(value)}"`);
}

/** Aplica `fn` às tags <meta>/<link> do <head> (sem mexer no resto do HTML). */
function mapHeadTags(html: string, fn: (tag: string, kind: "meta" | "link") => string): string {
  const open = HEAD_OPEN_RE.exec(html);
  const start = open ? open.index + open[0].length : 0;
  const rest = html.slice(start);
  const endMatch = /<\/head\s*>|<body\b/i.exec(rest);
  const end = start + (endMatch ? endMatch.index : rest.length);
  const inner = html.slice(start, end);
  // Tags dentro de blocos inertes (scripts, código em espera, <template>) ficam como estão.
  let out = "";
  let last = 0;
  for (const block of inner.matchAll(INERT_RE)) {
    const at = block.index ?? 0;
    out += mapTags(inner.slice(last, at), fn) + block[0];
    last = at + block[0].length;
  }
  out += mapTags(inner.slice(last), fn);
  return `${html.slice(0, start)}${out}${html.slice(end)}`;
}

function mapTags(text: string, fn: (tag: string, kind: "meta" | "link") => string): string {
  return text.replace(META_TAG_RE, (tag) => fn(tag, "meta")).replace(LINK_TAG_RE, (tag) => fn(tag, "link"));
}

/**
 * Imagem de compartilhamento com endereço completo (og:image, twitter:image,
 * <link rel="image_src">): o Facebook e o WhatsApp não aceitam endereço
 * relativo. `pageUrl` é o endereço completo da página ("https://site.com/oferta-a/").
 */
export function absolutizeShareImages(html: string, pageUrl: string): string {
  const absolute = (value: string) => {
    const clean = decodeAttr(value).trim();
    if (!clean || ABSOLUTE_URL_RE.test(clean)) return null;
    try {
      return new URL(clean, pageUrl).href;
    } catch {
      return null;
    }
  };
  return mapHeadTags(html, (tag, kind) => {
    if (kind === "meta") {
      const name = attrOf(tag, "property") ?? attrOf(tag, "name") ?? "";
      if (!SHARE_IMAGE_META_RE.test(name.trim())) return tag;
      const next = absolute(attrOf(tag, "content") ?? "");
      return next ? withAttr(tag, "content", next) : tag;
    }
    if (!isImageSrcLink(tag)) return tag;
    const next = absolute(attrOf(tag, "href") ?? "");
    return next ? withAttr(tag, "href", next) : tag;
  });
}

/** A página tem imagem de compartilhamento com endereço relativo (não aparece no WhatsApp/Facebook)? */
export function hasRelativeShareImage(html: string): boolean {
  for (const m of headContent(html).matchAll(META_TAG_RE)) {
    const name = attrOf(m[0], "property") ?? attrOf(m[0], "name") ?? "";
    if (!SHARE_IMAGE_META_RE.test(name.trim())) continue;
    const content = decodeAttr(attrOf(m[0], "content") ?? "").trim();
    if (content && !ABSOLUTE_URL_RE.test(content)) return true;
  }
  return false;
}

/** Metas de compartilhamento/busca que o divisor copia (o og:url fica de fora: o Facebook seguiria ele). */
const SHARE_META_RE = /^(?:description|og:(?!url$).+|twitter:.+)$/i;
/** Metas cujo conteúdo é um endereço (re-escrito para a pasta do divisor). */
const URL_META_RE = /^(?:og:(?:image|video|audio)(?::url|:secure_url)?|twitter:(?:image|image:src|player))$/i;
const SHARE_LINK_RELS = [
  "icon",
  "shortcut",
  "apple-touch-icon",
  "apple-touch-icon-precomposed",
  "mask-icon",
  "image_src",
];

export interface ShareHead {
  /** Texto do <title> (como está no HTML, já escapado), ou null. */
  titleHtml: string | null;
  /** Tags de descrição, compartilhamento (og:*, twitter:*) e ícones, prontas para o <head>. */
  tags: string[];
}

/**
 * O que o divisor copia do <head> da versão de controle: título, metas de
 * verificação de domínio, descrição, og:* (menos og:url), twitter:* e ícones
 * (favicon, apple-touch-icon, image_src). Nunca scripts nem códigos de pixel
 * (o PageView contaria duas vezes), nem o que está dentro do código em espera
 * do consentimento, de <script>, <template> ou comentários. `rebase`
 * reescreve cada endereço relativo para a pasta do divisor.
 */
export function shareHead(html: string, rebase: (url: string) => string): ShareHead {
  const head = headContent(html);
  const title = TITLE_TAG_RE.exec(head);
  const tags: string[] = [];
  for (const m of head.matchAll(META_TAG_RE)) {
    const property = attrOf(m[0], "property");
    const nameAttr = property !== null ? "property" : "name";
    const name = decodeAttr(property ?? attrOf(m[0], "name") ?? "").trim();
    const content = attrOf(m[0], "content");
    if (!name || content === null) continue;
    const verification = nameAttr === "name" && VERIFICATION_NAME_RE.test(name);
    if (!verification && !SHARE_META_RE.test(name)) continue;
    const value = decodeAttr(content).trim();
    const next = URL_META_RE.test(name) && value ? rebase(value) : value;
    tags.push(`<meta ${nameAttr}="${escapeAttr(name)}" content="${escapeAttr(next)}">`);
  }
  for (const m of head.matchAll(LINK_TAG_RE)) {
    const rel = (attrOf(m[0], "rel") ?? "").trim();
    const rels = rel.toLowerCase().split(/\s+/);
    const href = decodeAttr(attrOf(m[0], "href") ?? "").trim();
    if (!href || !rels.some((r) => SHARE_LINK_RELS.includes(r))) continue;
    const extra = ["sizes", "type", "color"]
      .map((a) => {
        const v = attrOf(m[0], a);
        return v ? ` ${a}="${escapeAttr(decodeAttr(v))}"` : "";
      })
      .join("");
    tags.push(`<link rel="${escapeAttr(rel)}" href="${escapeAttr(rebase(href))}"${extra}>`);
  }
  return { titleHtml: title ? title[1].trim() || null : null, tags: [...new Set(tags)] };
}
