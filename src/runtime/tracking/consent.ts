/**
 * Consentimento LGPD: escolha guardada (localStorage "os_consent" por 180 dias;
 * na prévia, só na sessão), banner acessível, botão flutuante "Cookies" para
 * mudar de ideia e ativação do código livre que espera o "Aceitar" (ver
 * CONSENT_GATE_ATTR em src/lib/tracking/runtime-config.ts).
 */
import type { Cfg } from "./config";
import { toUrl } from "./links";
import { doc, load, save, win } from "./util";

/** accepted/rejected: banner com Aceitar/Recusar; notice: "Entendi" do banner só de aviso. */
export type Choice = "accepted" | "rejected" | "notice";

const KEY = "os_consent";

export function readChoice(session: boolean): Choice | null {
  const v = load(KEY, session);
  return v && v.v === 1 && Date.now() - v.at < 15552e6 && /^(accepted|rejected|notice)$/.test(v.choice)
    ? v.choice
    : null; // 180 dias
}

export function saveChoice(choice: Choice, session: boolean) {
  save(KEY, { v: 1, choice, at: Date.now() }, session);
}

// Estilos isolados no shadow DOM: o CSS da página (clonada) não mexe no banner.
// "Aceitar" e "Recusar" com o mesmo destaque (guia de cookies da ANPD).
const CSS =
  ".b{position:fixed;z-index:2147483647;left:12px;right:12px;bottom:12px;margin:auto;max-width:720px;display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:14px;border-radius:12px;font:14px/1.45 system-ui,sans-serif;background:#111827;color:#fff;box-shadow:0 8px 30px #0005}" +
  ".l{background:#fff;color:#111827;border:1px solid #ddd}.bl,.br{max-width:380px}.bl{right:auto}.br{left:auto}" +
  "p{margin:0;flex:1 1 240px}a{color:inherit}.a{display:flex;gap:8px;margin-left:auto}" +
  "button{font:inherit;font-weight:600;cursor:pointer;border-radius:8px;padding:9px 16px;border:1px solid #fff;background:#fff;color:#111827}" +
  ".l button{border-color:#111827;background:#111827;color:#fff}" +
  "button:focus-visible,a:focus-visible{outline:2px solid #fff;outline-offset:2px}.l button:focus-visible,.l a:focus-visible{outline-color:#111827}" +
  ".f{position:fixed;z-index:2147482999;left:12px;bottom:12px;padding:7px 12px;border-radius:999px;font:600 13px/1.2 system-ui,sans-serif;border:1px solid #fff4;background:#111827;color:#fff;box-shadow:0 4px 14px #0004;opacity:.9}" +
  ".f.l{background:#fff;color:#111827;border-color:#ddd}.f:hover{opacity:1}" +
  "@media(max-width:480px){.b{left:12px;right:12px;max-width:none}.a{width:100%}.a button{flex:1}}";

let host: HTMLElement | null = null;
let fab: HTMLElement | null = null;

/** Shadow DOM próprio num elemento no começo do <body> (primeiro na ordem do Tab). */
function shadowHost(tag: string, html: string): ShadowRoot {
  const el = doc.createElement(tag);
  el.setAttribute("style", "all:initial");
  const root = el.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${CSS}</style>${html}`;
  if (doc.body) doc.body.insertBefore(el, doc.body.firstChild);
  else doc.documentElement.appendChild(el);
  return root;
}

/**
 * Mostra o banner (se já estiver aberto, só foca). `focus`: quem abriu foi o
 * visitante (link/botão "Cookies"), então o foco vai para o banner e depois
 * volta. Na primeira visita o foco fica na página: o banner não é modal, é uma
 * região anunciada uma vez aos leitores de tela. Devolve true quando o banner
 * acabou de aparecer.
 */
export function showBanner(cfg: Cfg, notice: boolean, onChoice: (c: Choice) => void, focus: boolean): boolean {
  const opened = !host;
  if (!host) {
    const c = cfg.consent;
    const back = doc.activeElement as HTMLElement | null;
    const pos = c.position === "bottom-left" ? "bl" : c.position === "bottom-right" ? "br" : "";
    // Textos da configuração entram por textContent/href (nunca como HTML).
    const root = shadowHost(
      "os-consent",
      `<div class="b ${c.theme === "light" ? "l " : ""}${pos}" role="region" aria-label="Aviso de cookies"><p aria-live="polite"><span></span> <a target="_blank" rel="noopener"></a></p><div class="a"><button type="button"></button><button type="button"></button></div></div>`,
    );
    const el = root.host as HTMLElement;
    host = el;
    const q = (sel: string) => root.querySelector(sel) as HTMLElement;
    const buttons = root.querySelectorAll("button");
    const reject = buttons[0];
    const accept = buttons[1];
    const link = q("a");
    link.textContent = c.policyLabel || "Política de privacidade";
    if (c.policyUrl && toUrl(c.policyUrl)) link.setAttribute("href", c.policyUrl);
    else link.remove();
    reject.textContent = c.rejectLabel || "Recusar";
    accept.textContent = notice ? c.noticeLabel || "Entendi" : c.acceptLabel || "Aceitar";
    if (notice) reject.remove();
    // O texto entra depois da região existir: assim o leitor de tela anuncia.
    const text = c.text || "";
    setTimeout(() => {
      q("span").textContent = text;
    });
    const choose = (choice: Choice) => () => {
      el.remove();
      host = null;
      onChoice(choice);
      if (focus && back && back.focus) back.focus();
    };
    reject.onclick = choose("rejected");
    accept.onclick = choose(notice ? "notice" : "accepted");
  }
  if (focus) ((host.shadowRoot as ShadowRoot).querySelector("button") as HTMLElement).focus();
  return opened;
}

/**
 * Sobe o botão "Cookies" acima de barras fixas no rodapé (barra de compra,
 * WhatsApp…) que estejam no mesmo canto: ele não cobre o preço nem rouba os
 * toques do botão de comprar. Camadas de tela inteira (popup) não contam.
 */
function lift() {
  const btn = fab && (fab.shadowRoot as ShadowRoot).querySelector("button");
  if (!btn) return;
  btn.style.bottom = "";
  for (let pass = 0; pass < 3; pass++) {
    const r = btn.getBoundingClientRect();
    let top = innerHeight;
    // Os quatro cantos do botão (sem desestruturar: o alvo é o Safari 13).
    for (let i = 0; i < 4; i++) {
      for (const hit of doc.elementsFromPoint(i % 2 ? r.right - 1 : r.left + 1, i < 2 ? r.top + 1 : r.bottom - 1)) {
        for (let el: Element | null = hit; el && el !== doc.body && el !== doc.documentElement; el = el.parentElement) {
          if (el === fab) break;
          if (/^(fixed|sticky)$/.test(getComputedStyle(el).position)) {
            const t = el.getBoundingClientRect().top;
            if (t > innerHeight / 2) top = Math.min(top, t);
            break;
          }
        }
      }
    }
    if (top >= innerHeight) return;
    btn.style.bottom = `${innerHeight - top + 8}px`;
  }
}

let placing = 0;
let listening = false;
/**
 * Confere de novo quando a tela muda: rolagem, tamanho, conteúdo com atraso e
 * barras que o script da página mostra depois (classe/estilo trocados, com ou
 * sem transição: vale o fim da animação).
 */
const relift = () => {
  if (fab && !placing)
    placing = requestAnimationFrame(() => {
      placing = 0;
      lift();
    });
};

/**
 * Botão flutuante "Cookies" (canto de baixo, à esquerda) para mudar de ideia
 * nas páginas sem o link "Preferências de cookies" (páginas clonadas). Some
 * enquanto o banner está aberto. `show` false esconde.
 */
export function cookiesButton(cfg: Cfg, show: boolean, onOpen: () => void) {
  if (fab) {
    fab.remove();
    fab = null;
  }
  if (!show || host || doc.querySelector("[data-os-consent-open]")) return;
  const root = shadowHost(
    "os-cookies",
    `<button type="button" class="f${cfg.consent.theme === "light" ? " l" : ""}" aria-label="Preferências de cookies">Cookies</button>`,
  );
  fab = root.host as HTMLElement;
  (root.querySelector("button") as HTMLElement).onclick = onOpen;
  lift();
  if (!listening) {
    listening = true;
    for (const ev of ["resize", "scroll", "load"]) win.addEventListener(ev, relift, { passive: true });
    for (const ev of ["os:revealed", "transitionend", "animationend"]) doc.addEventListener(ev, relift, true);
    // Mudanças no HTML (players de vídeo mexem nele o tempo todo): no máximo uma conferência a cada 0,15 s.
    let later = 0;
    try {
      new MutationObserver(() => {
        if (!later)
          later = setTimeout(() => {
            later = 0;
            relift();
          }, 150) as unknown as number;
      }).observe(doc.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style", "hidden"],
      });
    } catch {
      // navegador sem MutationObserver: fica a rolagem
    }
  }
}

/** Há código livre esperando o consentimento? */
export const hasGated = () => !!doc.querySelector("[data-os-consent]");

const GATE = "data-os-consent";
const JS_TYPE = /^(|module|(text|application)\/(x-)?(java|ecma)script|text\/(jscript|livescript)|javascript)$/i;

/**
 * Enquanto o código ativado roda, "DOMContentLoaded" e "load" que já passaram
 * chamam o ouvinte logo em seguida (como se o código tivesse rodado no lugar
 * dele, na hora certa). Devolve a função que desfaz.
 */
function lateReadyEvents(): () => void {
  const undo: (() => void)[] = [];
  for (const target of [doc, win] as EventTarget[]) {
    // Sem Object.hasOwn: não existe no Safari < 15.4 nem no Chrome < 93 (o script mira o
    // Safari 13) — e o biome troca hasOwnProperty.call por ele sozinho.
    const own = !!Object.getOwnPropertyDescriptor(target, "addEventListener");
    const original = target.addEventListener;
    target.addEventListener = function (
      this: EventTarget,
      type: string,
      fn: EventListenerOrEventListenerObject | null,
      opts?: boolean | AddEventListenerOptions,
    ) {
      const passed =
        (type === "DOMContentLoaded" && doc.readyState !== "loading") ||
        (type === "load" && doc.readyState === "complete");
      if (fn && passed) {
        setTimeout(() => {
          const ev = new Event(type);
          if (typeof fn === "function") fn.call(target, ev);
          else fn.handleEvent(ev);
        });
        return;
      }
      return original.call(this, type, fn, opts);
    };
    undo.push(() => {
      if (own) target.addEventListener = original;
      else delete (target as Partial<EventTarget>).addEventListener;
    });
  }
  return () => {
    for (const u of undo) u();
  };
}

/**
 * O navegador roda este script (e avisa com load/error)? Tipos que não são
 * JavaScript não rodam; com suporte a módulos, <script nomodule> também não (e
 * sem suporte, <script type="module"> não roda).
 */
function runs(s: HTMLScriptElement, type: string) {
  const modules = "noModule" in HTMLScriptElement.prototype;
  const t = type.trim().toLowerCase();
  return JS_TYPE.test(t) && (t === "module" ? modules : !(modules && s.hasAttribute("nomodule")));
}

/**
 * Liga o código livre que esperava o "Aceitar": o conteúdo de cada bloco JSON
 * data-os-consent/data-os-block entra no lugar dele — sem <noscript>, que só
 * vale sem JavaScript — e os <script> rodam na ordem da página (os externos um
 * de cada vez, como o navegador faria; um script que não roda, como o <script
 * nomodule>, não segura os seguintes, e nenhum segura por mais de 10 s).
 * Também ativa os formatos antigos (<template data-os-consent>, <script
 * type="text/plain" data-os-consent>, data-os-src).
 */
export function activateGated() {
  const queue: HTMLScriptElement[] = [];
  const types = new Map<Element, string>();
  const gated = (el: Element) => el.tagName === "TEMPLATE" || el.hasAttribute("data-os-block");

  /** Prepara um trecho: blocos viram conteúdo, scripts entram na fila (inertes até a vez deles). */
  const open = (scope: ParentNode, inBlock: boolean) => {
    for (const el of Array.from(scope.querySelectorAll(inBlock ? `script,[${GATE}]` : `[${GATE}]`))) {
      if (el.hasAttribute(GATE) && gated(el)) {
        let content: DocumentFragment;
        if (el.tagName === "TEMPLATE") content = (el as HTMLTemplateElement).content;
        else {
          const t = doc.createElement("template");
          try {
            t.innerHTML = String(JSON.parse(el.textContent || '""'));
          } catch {
            // bloco corrompido: fica sem conteúdo
          }
          content = t.content;
        }
        // <noscript> só vale sem JavaScript: sai ainda no conteúdo inerte. O Chromium e
        // o Safari leem o conteúdo de um <template> como sem JavaScript — o <img> de
        // dentro do <noscript> vira elemento e carregaria ao entrar na página.
        for (const ns of Array.from(content.querySelectorAll("noscript"))) ns.remove();
        const frag = doc.importNode(content, true);
        open(frag, true);
        if (el.parentNode) el.parentNode.replaceChild(frag, el);
        continue;
      }
      const legacy = el.hasAttribute(GATE);
      el.removeAttribute(GATE);
      for (const a of ["src", "srcset"]) {
        const v = el.getAttribute(`data-os-${a}`);
        if (v !== null && el.tagName !== "SCRIPT") {
          el.setAttribute(a, v);
          el.removeAttribute(`data-os-${a}`);
        }
      }
      if (el.tagName !== "SCRIPT") continue;
      const script = el as HTMLScriptElement;
      const plain = (script.getAttribute("type") || "").toLowerCase() === "text/plain";
      // Formato antigo: só o text/plain marcado espera (os outros já rodaram).
      if (!inBlock && !(legacy && plain)) continue;
      types.set(
        script,
        plain && script.hasAttribute("data-os-type")
          ? script.getAttribute("data-os-type") || ""
          : script.getAttribute("type") || "",
      );
      script.type = "text/plain"; // não roda ao entrar na página: roda na vez dele
      queue.push(script);
    }
  };
  open(doc, false);
  if (!queue.length) return;

  const restore = lateReadyEvents();
  const next = (i: number) => {
    const old = queue[i];
    if (!old) {
      restore();
      return;
    }
    const parent = old.parentNode;
    if (!parent) {
      next(i + 1); // um script anterior tirou este da página
      return;
    }
    // Script novo (o navegador só roda scripts criados agora), com o type original.
    const s = doc.createElement("script");
    for (const a of Array.from(old.attributes)) {
      if (!/^(type|data-os-type|data-os-consent)$/.test(a.name)) s.setAttribute(a.name, a.value);
    }
    const type = types.get(old) || "";
    if (type) s.setAttribute("type", type);
    s.text = old.text;
    const external = s.hasAttribute("src") && runs(s, type);
    if (external) {
      let done = false;
      const go = () => {
        if (!done) {
          done = true;
          next(i + 1);
        }
      };
      // Ouvintes (não s.onload): o onload/onerror do próprio código (copiado acima) também roda.
      s.addEventListener("load", go);
      s.addEventListener("error", go);
      setTimeout(go, 1e4); // servidor que nunca responde: os seguintes rodam mesmo assim
    }
    parent.replaceChild(s, old);
    if (!external) next(i + 1);
  };
  next(0);
}
