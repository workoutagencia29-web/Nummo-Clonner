/**
 * Utilidades dos widgets das páginas. Tudo tolera configuração faltando ou
 * errada (usa o padrão) e armazenamento bloqueado (segue sem memória).
 */
import { WIDGET_CSS } from "./css";

const started = new WeakSet<Element>();

/** Elementos de um widget ainda não iniciados (cada um é iniciado uma vez só). */
export function widgets<T extends HTMLElement = HTMLElement>(name: string, root: ParentNode = document): T[] {
  const out: T[] = [];
  for (const el of Array.from(root.querySelectorAll<T>(`[data-os-widget="${name}"]`))) {
    if (started.has(el)) continue;
    started.add(el);
    out.push(el);
  }
  return out;
}

/** Valor de data-os-<name> (sem espaços nas pontas) ou o padrão. */
export function opt(el: Element, name: string, def = ""): string {
  const v = (el.getAttribute(`data-os-${name}`) || "").trim();
  return v || def;
}

/** Número de data-os-<name>, limitado a [min, max]; vírgula decimal aceita. */
export function num(el: Element, name: string, def: number, min = 0, max = 1e9): number {
  const raw = opt(el, name);
  const n = raw ? Number(raw.replace(",", ".")) : Number.NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

/** Liga/desliga em data-os-<name> ("1", "true", "sim" / "0", "false", "não"). */
export function flag(el: Element, name: string, def: boolean): boolean {
  const v = opt(el, name).toLowerCase();
  return v ? !/^(0|false|n[aã]o|off|no)$/.test(v) : def;
}

export function load(key: string, session = false): string | null {
  try {
    return (session ? sessionStorage : localStorage).getItem(key);
  } catch {
    return null;
  }
}

export function save(key: string, value: string, session = false) {
  try {
    (session ? sessionStorage : localStorage).setItem(key, value);
  } catch {
    // armazenamento cheio ou bloqueado: segue sem memória
  }
}

/** Coloca o CSS dos widgets na página (uma vez). */
export function addCss() {
  if (document.getElementById("os-widgets-css")) return;
  const style = document.createElement("style");
  style.id = "os-widgets-css";
  style.textContent = WIDGET_CSS;
  document.head.appendChild(style);
}

/** Prévia do Offer Studio (<token>.localhost), não a página publicada. */
export const isPreview = () => /(^|\.)localhost$/.test(location.hostname);

/**
 * Vai para o endereço (só http/https). Dentro da prévia do painel (iframe em
 * *.localhost), site de fora abre em aba nova: checkouts não abrem em quadro.
 * Devolve true quando a página atual vai sair (mesma aba).
 */
export function navigate(url: URL, newTab?: boolean): boolean {
  if (!/^https?:$/.test(url.protocol)) return false;
  if (newTab || (top !== self && isPreview() && url.origin !== location.origin)) {
    open(url.href, "_blank", "noopener");
    return false;
  }
  location.href = url.href;
  return true;
}

let autoScrollUntil = 0;

/**
 * A página vai rolar sozinha (ex.: o quiz voltando ao topo ao trocar de etapa):
 * o popup de saída não conta essa rolagem como a pessoa saindo da página.
 */
export function markAutoScroll(ms = 1200) {
  autoScrollUntil = Date.now() + ms;
}

/** Rolagem feita pela própria página (markAutoScroll) ainda em andamento. */
export const autoScrolling = () => Date.now() < autoScrollUntil;

/** Aparelho de toque (celular/tablet). */
export function isTouch() {
  return matchMedia("(hover: none), (pointer: coarse)").matches;
}
