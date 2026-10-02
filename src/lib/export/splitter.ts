/**
 * Divisor A/B do ZIP: o index.html da pasta de uma página com versões sorteia
 * a versão pelo peso (PageVariant.weight) e manda o visitante para a pasta
 * dela (oferta-a/, oferta-b/…), mantendo a query string (UTMs, fbclid…) e o
 * hash. A escolha fica guardada por até 30 dias (localStorage e cookie), por
 * página — no iPhone/Safari o próprio navegador apaga antes (cerca de 7 dias).
 * As páginas das versões guardam a mesma escolha (ver earlyScript em
 * ./head.ts): quem chega direto em oferta-b/ e volta ao endereço da página
 * continua na B.
 *
 * - A escolha guardada vale só para a MESMA versão (pasta + identidade): uma
 *   versão excluída e recriada com a mesma letra sorteia de novo.
 * - Peso 0 = versão pausada (nunca sorteada; quem tinha ela guardada é sorteado
 *   de novo). Todos 0 = só a versão de controle.
 * - Versão com celular separado: o celular vai direto para a pasta celular/
 *   dela (um redirecionamento a menos); ?versao=computador fica no computador.
 * - location.replace: o divisor não fica no histórico (o "voltar" não prende).
 *   A origem da visita (document.referrer de outro site) fica em
 *   sessionStorage "os_ref" com a hora (SAVE_REF_JS), porque a página da
 *   versão passa a ver o divisor como origem; o script de chegada da versão a
 *   devolve ao document.referrer (RESTORE_REF_JS, até 1 minuto depois) antes
 *   do rastreamento.
 * - Hospedagem que entrega o index.html da raiz para qualquer caminho
 *   (Cloudflare Pages sem 404.html, try_files do Nginx): se o divisor for
 *   entregue de novo na pasta para onde acabou de mandar ("/promo/oferta-b/",
 *   que não existe), ele para ali (redirectGuardJs) em vez de ir para
 *   "oferta-b/oferta-b/…" sem fim. O ZIP leva um 404.html justamente para
 *   essas hospedagens responderem "não encontrada".
 * - O caminho do endereço é normalizado ("//outro-site.com/" vira
 *   "/outro-site.com/"): o redirecionamento nunca sai do site.
 * - Sem JavaScript: <meta refresh> e link para a versão de controle.
 * - Funciona na raiz do domínio, numa subpasta, com ou sem a barra no fim do
 *   endereço, pelo "index.html" e aberto do computador (file://).
 * - noindex: o divisor não tem conteúdo para o Google. Mas tem as metas de
 *   verificação de domínio e de compartilhamento (headTags), porque é o
 *   endereço que os verificadores e o WhatsApp/Facebook leem.
 */
import {
  AB_STICKY_DAYS,
  abStorageName,
  DESKTOP_CHOICE_JS,
  MOBILE_TEST_JS,
  redirectGuardJs,
  SAFE_PATH_JS,
  SAVE_REF_JS,
  SPLIT_GUARD_KEY,
  scriptString,
} from "./head";

export interface SplitterVariant {
  /** Pasta relativa à do divisor ("oferta-a/"). */
  folder: string;
  /** Peso 0–100 (não precisa somar 100: vale a proporção). */
  weight: number;
  /** Identidade da versão (hash curto do id): a escolha guardada só vale para ela. */
  id?: string;
  /** Pasta da versão celular, relativa à da versão ("celular/"); sem celular separado: null. */
  mobile?: string | null;
}

/** Quanto tempo a versão sorteada fica guardada. */
export const SPLITTER_STICKY_DAYS = AB_STICKY_DAYS;

/** Peso válido: inteiro de 0 a 100 (lixo vira 0). */
export function cleanWeight(weight: unknown): number {
  const n = typeof weight === "number" && Number.isFinite(weight) ? Math.round(weight) : 0;
  return Math.min(100, Math.max(0, n));
}

/**
 * Sorteio (mesma regra do script do divisor): `random` em [0, 1). Devolve o
 * índice da versão. Peso 0 nunca sai; todos 0 = a primeira (controle).
 */
export function pickVariant(weights: readonly number[], random: number): number {
  const clean = weights.map(cleanWeight);
  const total = clean.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let r = Math.min(Math.max(random, 0), 0.999999999) * total;
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] > 0 && r < clean[i]) return i;
    r -= clean[i];
  }
  // Arredondamento: a última com peso.
  for (let i = clean.length - 1; i >= 0; i--) if (clean[i] > 0) return i;
  return 0;
}

/** Percentual de cada versão (para a prévia e o LEIA-ME), somando 100. */
export function weightPercents(weights: readonly number[]): number[] {
  const clean = weights.map(cleanWeight);
  const total = clean.reduce((a, b) => a + b, 0);
  if (total <= 0) return clean.map((_, i) => (i === 0 ? 100 : 0));
  const raw = clean.map((w) => (w / total) * 100);
  const floor = raw.map(Math.floor);
  let rest = 100 - floor.reduce((a, b) => a + b, 0);
  // Maior resto primeiro (desempate pela ordem).
  const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (rest <= 0) break;
    if (clean[i] > 0) {
      floor[i]++;
      rest--;
    }
  }
  return floor;
}

function escapeAttr(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeText(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Script do divisor (ES5, sem dependências). `key`: identifica a página (só
 * [a-z0-9_]); a primeira versão é a de controle. Guarda "pasta|data|id" no
 * localStorage e "pasta|id" no cookie (o mesmo formato das páginas das versões).
 */
export function splitterScript(variants: readonly SplitterVariant[], key: string): string {
  const withMobile = variants.some((v) => v.mobile);
  const list = variants.map((v) => {
    const row: (string | number)[] = [v.folder, cleanWeight(v.weight), v.id ?? ""];
    if (withMobile) row.push(v.mobile ?? "");
    return row;
  });
  const maxAge = SPLITTER_STICKY_DAYS * 86400;
  return [
    "(function(){",
    `var V=${scriptString(list)},K=${scriptString(abStorageName(key))},T=${maxAge * 1000},l=location,n=new Date().getTime(),s=null,c=null,i,t=0,${SAFE_PATH_JS},f=l.protocol==="file:";`,
    'function at(g,d){for(var j=0;j<V.length;j++)if(V[j][0]===g&&V[j][2]===(d||"")&&V[j][1]>0)return V[j];return null}',
    // Pasta do divisor como caminho absoluto (com ou sem "/" no fim, pelo index.html ou file://).
    'if(!/\\/$/.test(p)){if(f||/\\.html?$/i.test(p))p=p.replace(/[^\\/]*$/,"");else p+="/"}',
    // Escolha guardada (localStorage "pasta|data|id"; senão o cookie "pasta|id").
    'try{var g=(localStorage.getItem(K)||"").split("|");if(n-(+g[1]||0)<T)c=at(g[0],g[2])}catch(e){}',
    'if(!c){try{var m0=document.cookie.match(new RegExp("(?:^|;\\\\s*)"+K+"=([^;]*)"));if(m0){var h=decodeURIComponent(m0[1]).split("|");c=at(h[0],h[1])}}catch(e){}}',
    // Sorteio pelo peso (peso 0 nunca; todos 0 = controle).
    "if(!c){c=V[0];for(i=0;i<V.length;i++)t+=V[i][1];if(t>0){var r=Math.random()*t;for(i=0;i<V.length;i++){if(V[i][1]>0&&r<V[i][1]){c=V[i];break}r-=V[i][1]}}}",
    "s=c[0];",
    'try{localStorage.setItem(K,s+"|"+n+"|"+c[2])}catch(e){}',
    `try{if(!f)document.cookie=K+"="+encodeURIComponent(s+"|"+c[2])+";max-age=${maxAge};path="+p+";SameSite=Lax"}catch(e){}`,
    // Celular com versão separada: direto para a pasta celular/ da versão.
    ...(withMobile ? [`if(c[3]){try{${DESKTOP_CHOICE_JS}${MOBILE_TEST_JS}if(m&&!d)s+=c[3]}catch(e){}}`] : []),
    // Trava: entregue de novo na pasta para onde mandou (hospedagem que entrega o divisor
    // para qualquer caminho), para ali em vez de ir para "oferta-b/oferta-b/…" sem fim.
    redirectGuardJs(SPLIT_GUARD_KEY),
    "if(!G(p+s,p))return;",
    // Origem da visita (outro site), para o rastreamento da página da versão.
    SAVE_REF_JS,
    'var u=p+s+(f?"index.html":"")+l.search+l.hash;if(!/^\\/\\//.test(u))l.replace(u)',
    "})();",
  ].join("");
}

export interface SplitterPageOptions {
  variants: readonly SplitterVariant[];
  /** Identifica a página na escolha guardada (estável entre exportações). */
  key: string;
  /** Título da aba enquanto redireciona (texto puro). */
  title: string;
  /**
   * Título já em HTML (o conteúdo do <title> da versão de controle, com as
   * entidades como estão); quando vem, vale no lugar de `title`.
   */
  titleHtml?: string | null;
  /** Idioma do <html lang>. */
  lang: string;
  /**
   * Tags a mais no <head> (depois do <title>): verificação de domínio,
   * descrição, og:*, twitter:*, ícones. Nunca scripts nem pixels (o PageView
   * contaria duas vezes).
   */
  headTags?: string;
}

/** index.html do divisor: mínimo (sem piscar), noindex, com saída para quem não tem JavaScript. */
export function splitterHtml(opts: SplitterPageOptions): string {
  const control = opts.variants[0]?.folder ?? "./";
  return [
    "<!doctype html>",
    `<html lang="${escapeAttr(opts.lang || "pt-BR")}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<title>${opts.titleHtml && !/<\/title/i.test(opts.titleHtml) ? opts.titleHtml : escapeText(opts.title)}</title>`,
    ...(opts.headTags ? [opts.headTags] : []),
    `<script>${splitterScript(opts.variants, opts.key)}</script>`,
    `<noscript><meta http-equiv="refresh" content="0; url=${escapeAttr(control)}"></noscript>`,
    "<style>html,body{margin:0;background:#fff}</style>",
    "</head>",
    `<body><noscript><p style="font-family:sans-serif;text-align:center;margin-top:40vh"><a href="${escapeAttr(control)}">Continuar</a></p></noscript></body>`,
    "</html>",
    "",
  ].join("\n");
}
