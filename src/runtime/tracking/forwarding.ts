/**
 * Repasse de UTMs e IDs de clique (utm_*, fbclid, gclid, ttclid, src, sck…):
 * os parâmetros da chegada (último clique vale inteiro: chegou com algum
 * parâmetro novo, os guardados de antes saem) ficam guardados por N dias e
 * completam os links de checkout e do funil — no carregamento e no clique
 * (antes do script das páginas navegar). Nunca troca um parâmetro que o link já
 * tem e mantém a âncora (#). Formulários GET recebem campos escondidos (o
 * navegador troca a query do action pelos campos do formulário).
 *
 * Consentimento (quem chama decide, ver ./index): `get(funnel)` devolve os
 * parâmetros de cada destino — no modo "Pedir permissão", antes da escolha, os
 * IDs de clique de anúncio (fbclid, gclid…) seguem só nos links entre as páginas
 * do funil (ficam no endereço, nada é guardado nem vai para fora) e entram no
 * checkout e na memória depois do "Aceitar"; quem recusa não fica com eles em
 * lugar nenhum. O que o script acrescentou a um link é refeito a cada mudança
 * (o "Recusar" tira os IDs de clique que já estavam nos links do funil).
 *
 * Teste A/B (cfg.variant): os links de checkout também recebem a marca da
 * versão (markVersion), com ou sem repasse e antes de qualquer escolha no
 * aviso de cookies (diz só qual versão da página foi vista, não identifica o
 * visitante).
 */
import type { Cfg } from "./config";
import { destAttr, hostMatches, isCheckout, toUrl } from "./links";
import { $$, attr, closest, doc, drop, isObj, load, on, ready, save, win } from "./util";

export type Params = Record<string, string>;

const KEY = "os_params";
const TARGETS = "a[href],area[href],[data-os-href],form[action]";

/** IDs de clique de anúncio: identificam o clique da pessoa (dado de marketing). */
export const CLICK_ID = /^(fbclid|gclid|gbraid|wbraid|ttclid|kwai_click_id|msclkid)$/;

/**
 * Valor aceito para repassar/guardar: até 500 caracteres, sem caracteres de
 * controle nem ";"; IDs de clique também sem espaço nem vírgula. Um link
 * montado de má-fé não guarda um valor gigante que quebraria os checkouts.
 */
export function cleanParam(k: string, v: unknown): string | null {
  if (typeof v !== "string" || !v || v.length > 500 || v.indexOf(";") >= 0) return null;
  for (let i = 0; i < v.length; i++) if (v.charCodeAt(i) < 32 || v.charCodeAt(i) === 127) return null;
  return CLICK_ID.test(k) && /[\s,]/.test(v) ? null : v;
}

/** Os mesmos parâmetros sem os IDs de clique de anúncio. */
export function withoutClickIds(params: Params): Params {
  const out: Params = {};
  for (const k in params) if (!CLICK_ID.test(k)) out[k] = params[k];
  return out;
}

/**
 * Parâmetros desta visita: os da URL, se veio algum (o último clique vale
 * inteiro), ou os guardados de visitas anteriores (válidos por persistDays).
 * `fresh`: vieram da URL (e ainda não estão guardados). Não guarda nada.
 */
export function collectParams(cfg: Cfg): { params: Params; fresh: boolean } {
  const fw = cfg.forwarding;
  const out: Params = {};
  if (!fw.enabled) return { params: out, fresh: false };
  const query = new URLSearchParams(location.search);
  for (const k of fw.params) {
    const v = cleanParam(k, query.get(k));
    if (v) out[k] = v;
  }
  if (Object.keys(out).length) return { params: out, fresh: true };
  const ttl = fw.persistDays * 864e5;
  const stored = ttl ? load(KEY) : null;
  const kept = stored && stored.v === 1 && Date.now() - stored.at < ttl && isObj(stored.p) ? stored.p : {};
  for (const k of fw.params) {
    const v = cleanParam(k, kept[k]);
    if (v) out[k] = v;
  }
  return { params: out, fresh: false };
}

/** Guarda os parâmetros por persistDays (0 = só a visita atual). */
export function persistParams(cfg: Cfg, params: Params) {
  if (cfg.forwarding.persistDays && Object.keys(params).length) save(KEY, { v: 1, at: Date.now(), p: params });
}

/** Apaga os parâmetros guardados (visitante recusou os cookies). */
export const forgetParams = () => drop(KEY);

/** Acrescenta os parâmetros ao endereço (texto), sem trocar os que já existem e mantendo o #. */
export function addParams(raw: string, params: Params): string {
  const cut = raw.indexOf("#");
  const hash = cut < 0 ? "" : raw.slice(cut);
  const base = cut < 0 ? raw : raw.slice(0, cut);
  const q = base.indexOf("?");
  const has = new URLSearchParams(q < 0 ? "" : base.slice(q + 1));
  const add = Object.keys(params)
    .filter((k) => params[k] && !has.has(k))
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`);
  if (!add.length) return raw;
  return base + (q < 0 ? "?" : /[?&]$/.test(base) ? "" : "&") + add.join("&") + hash;
}

/**
 * Marca da versão A/B num link de checkout ("versao-b"), só quando o link (já
 * com o que foi repassado da chegada) não tem o parâmetro com valor:
 * - Hotmart, Kiwify e Eduzz (variant.srcHosts, ou checkout da Hotmart em
 *   domínio próprio, com checkoutMode=): `src`, a origem da venda no
 *   relatório — `sck` e `xcod` (UTMify, rastreadores) nunca são tocados;
 * - as outras: `utm_content` — o do anúncio ("nome|ID", que a UTMify e as
 *   plataformas usam para saber qual anúncio vendeu) nunca é alterado.
 * Ver VERSION_SRC_PLATFORMS em src/lib/tracking/runtime-config.ts.
 */
export function markVersion(raw: string, url: URL, cfg: Cfg): string {
  const v = cfg.variant;
  if (!v) return raw;
  const host = url.hostname.replace(/^www\./, "");
  const src =
    v.srcHosts.some((h) => hostMatches(host, url.pathname.toLowerCase(), h)) || /[?&]checkoutMode=/i.test(url.search);
  const key = src ? "src" : "utm_content";
  const mark = `versao-${v.name.toLowerCase()}`;
  const cut = raw.indexOf("#");
  const base = cut < 0 ? raw : raw.slice(0, cut);
  const q = base.indexOf("?");
  const has = new URLSearchParams(q < 0 ? "" : base.slice(q + 1));
  if (has.get(key)) return raw;
  // Parâmetro vazio ("utm_content="): preenche no lugar.
  if (has.has(key)) return base.replace(new RegExp(`([?&]${key}=)(?=&|$)`), `$1${mark}`) + raw.slice(base.length);
  return addParams(raw, { [key]: mark });
}

/**
 * Destino que recebe os parâmetros: "checkout" (toCheckout ou, no teste A/B,
 * a marca da versão), "funnel" (página do mesmo site, toInternalLinks) ou
 * null — nunca a própria página.
 */
function kindOf(el: Element, cfg: Cfg, url: URL): "checkout" | "funnel" | null {
  const fw = cfg.forwarding;
  if (isCheckout(el, cfg, url)) return (fw.enabled && fw.toCheckout) || cfg.variant ? "checkout" : null;
  // Link para a própria página ("/oferta#comprar"): já tem os parâmetros e não pode recarregar.
  return fw.enabled && url.origin === location.origin && fw.toInternalLinks && url.pathname !== location.pathname
    ? "funnel"
    : null;
}

/** Parâmetros repassados a um destino (checkout sem repasse: nenhum). */
const paramsOf = (kind: "checkout" | "funnel", cfg: Cfg, get: ParamsFor): Params =>
  kind === "funnel" ? get(true) : cfg.forwarding.toCheckout ? get(false) : {};

/** Parâmetros de um destino (true = página do funil). */
export type ParamsFor = (funnel: boolean) => Params;

/** O formulário é enviado por GET (o padrão): o navegador troca a query do action pelos campos. */
const isGetForm = (form: Element, submitter?: Element | null) =>
  form.getAttribute("data-os-widget") !== "lead-form" &&
  !/^post$/i.test((submitter && attr(submitter, "formmethod")) || attr(form, "method"));

/** Endereço original e o que o script escreveu, por elemento (para refazer depois de uma escolha). */
const written = new WeakMap<Element, [string, string]>();

/** Completa o destino do elemento (links, botões com data-os-href e o action de formulários POST). */
function decorate(el: Element, cfg: Cfg, get: ParamsFor) {
  if (el.tagName === "FORM" && isGetForm(el)) return; // GET: campos escondidos no envio
  const a = destAttr(el);
  const now = a ? attr(el, a) : "";
  const w = written.get(el);
  // A página não mexeu no destino desde a última vez: parte do endereço original.
  const raw = w && w[1] === now ? w[0] : now;
  const url = raw && toUrl(raw);
  const kind = url && kindOf(el, cfg, url);
  if (!kind) return;
  let next = addParams(raw, paramsOf(kind, cfg, get));
  if (kind === "checkout") next = markVersion(next, url, cfg);
  written.set(el, [raw, next]);
  if (next !== now) el.setAttribute(a as string, next);
}

/** Formulário GET: os parâmetros vão como campos escondidos (os que o formulário ainda não tem). */
function addFields(form: HTMLFormElement, cfg: Cfg, get: ParamsFor) {
  const raw = attr(form, "action");
  const url = raw && toUrl(raw);
  const kind = url && kindOf(form, cfg, url);
  if (!kind) return;
  const params = { ...paramsOf(kind, cfg, get) };
  // A marca da versão vai como campo também (só se o formulário ainda não tem o parâmetro).
  if (kind === "checkout") {
    new URLSearchParams(markVersion("?", url, cfg).slice(1)).forEach((v, k) => {
      params[k] = params[k] || v;
    });
  }
  for (const k in params) {
    if (!params[k] || form.elements.namedItem(k)) continue;
    const input = doc.createElement("input");
    input.type = "hidden";
    input.name = k;
    input.value = params[k];
    input.setAttribute("data-os-fw", "");
    form.appendChild(input);
  }
}

/**
 * Liga o repasse. `get` devolve os parâmetros da hora para cada destino (mudam
 * com a escolha no aviso de cookies). Devolve a função que refaz todos os links.
 */
export function startForwarding(cfg: Cfg, get: ParamsFor): () => void {
  const all = () => {
    for (const el of $$(TARGETS)) decorate(el, cfg, get);
  };
  if (!cfg.forwarding.enabled && !cfg.variant) return () => {};
  // Na fase de captura da janela: roda antes do clique do script das páginas
  // (data-os-href) e do envio do formulário de captura.
  on(
    win,
    "click",
    (e) => {
      const el = closest(e, TARGETS);
      if (el && el.tagName !== "FORM") decorate(el, cfg, get);
    },
    true,
  );
  on(
    win,
    "submit",
    (e) => {
      const form = e.target as HTMLFormElement;
      if (!form || form.tagName !== "FORM") return;
      if (isGetForm(form, (e as SubmitEvent).submitter)) addFields(form, cfg, get);
      else decorate(form, cfg, get);
    },
    true,
  );
  ready(all);
  return all;
}

/**
 * Nome/e-mail/telefone do formulário de captura com "Levar nome e e-mail"
 * ("os_lead" na sessão, gravado por src/runtime/widgets/lead-form.ts quando o
 * destino é uma página do funil): vão só para o checkout, no clique — nunca no
 * endereço das páginas, que os pixels mandam para as plataformas.
 */
export function startLeadPass(cfg: Cfg) {
  const lead = load("os_lead", true);
  if (!isObj(lead)) return;
  const values: Params = {};
  for (const k of ["name", "email", "phone"]) {
    const v = lead[k];
    if (typeof v === "string" && v && v.length <= 300) values[k] = v;
  }
  on(
    win,
    "click",
    (e) => {
      const el = closest(e, "a[href],area[href],[data-os-href]");
      const a = el && destAttr(el);
      const raw = a ? attr(el as Element, a) : "";
      const url = raw && toUrl(raw);
      if (url && url.origin !== location.origin && isCheckout(el as Element, cfg, url)) {
        (el as Element).setAttribute(a as string, addParams(raw, values));
      }
    },
    true,
  );
}
