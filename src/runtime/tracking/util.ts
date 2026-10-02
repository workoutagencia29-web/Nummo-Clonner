/**
 * Utilidades do script de rastreamento. load/save toleram armazenamento
 * bloqueado (segue sem memória); cookie() só é chamado depois do consentimento,
 * em código protegido por try/catch.
 *
 * `doc`/`win` são apelidos de document/window: o script precisa ficar pequeno
 * (o minificador não encurta nomes globais).
 */

/** Janela com as variáveis que as plataformas exigem (fbq, ttq, gtag…). */
// biome-ignore lint/suspicious/noExplicitAny: globais das plataformas não têm tipo
export type Win = Window & Record<string, any>;
export const win = window as unknown as Win;
export const doc = document;

// biome-ignore lint/suspicious/noExplicitAny: JSON lido do armazenamento/configuração
export type Loose = Record<string, any>;

export const isObj = (v: unknown): v is Loose => !!v && typeof v === "object" && !Array.isArray(v);

export const on = (target: EventTarget, type: string, fn: (e: Event) => void, capture?: boolean) =>
  target.addEventListener(type, fn, capture);

export const attr = (el: Element, name: string) => (el.getAttribute(name) || "").trim();

/** Elemento (o alvo do evento ou um ancestral) que casa com o seletor. */
export const closest = (e: Event, sel: string): Element | null => {
  const t = e.target as Element;
  return t.closest ? t.closest(sel) : null;
};

/** UUID v4 (id do evento, usado por todas as plataformas e pelo eventos.php). */
export const uuid = (): string =>
  "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16),
  );

const storage = (session?: boolean) => (session ? sessionStorage : localStorage);

/** JSON guardado (localStorage, ou sessionStorage na prévia). Quem lê confere o formato. */
export function load(key: string, session?: boolean): Loose | null {
  try {
    return JSON.parse(storage(session).getItem(key) || "0");
  } catch {
    return null;
  }
}

export function save(key: string, value: unknown, session?: boolean) {
  try {
    storage(session).setItem(key, JSON.stringify(value));
  } catch {
    // armazenamento cheio ou bloqueado
  }
}

/** Apaga o item guardado (localStorage). */
export function drop(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // armazenamento bloqueado: nada guardado
  }
}

/** Cookie da própria página por 90 dias (como os da Meta); `days` 0 apaga. */
export function setCookie(name: string, value: string, days = 90) {
  // biome-ignore lint/suspicious/noDocumentCookie: a Cookie Store API não existe no Safari (alvo do script)
  doc.cookie = `${name}=${value}; path=/; max-age=${days * 86400}; SameSite=Lax`;
}

export function cookie(name: string): string | null {
  const m = doc.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? m[1] : null;
}

/** Carrega um script externo; `done(true)` ao carregar, `done(false)` se o navegador bloqueou/falhou. */
export function loadScript(src: string, done?: (ok: boolean) => void, attrs?: Record<string, string>) {
  const s = doc.createElement("script");
  s.async = true;
  s.src = src;
  for (const k in attrs) s.setAttribute(k, attrs[k]);
  if (done) {
    s.onload = () => done(true);
    s.onerror = () => done(false);
  }
  (doc.head || doc.documentElement).appendChild(s);
}

/** Roda quando o HTML terminou de chegar (o script fica no começo do <head>). */
export function ready(fn: () => void) {
  if (doc.readyState === "loading") on(doc, "DOMContentLoaded", fn);
  else fn();
}

export const $$ = (sel: string) => Array.from(doc.querySelectorAll(sel));
