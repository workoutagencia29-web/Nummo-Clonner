/**
 * Regras de evento da página: ao abrir, depois de X segundos com a aba
 * visível, ao rolar X%, no clique em checkout/elemento e no envio de
 * formulário. Elementos com data-os-event="LEAD" (etc.) disparam o evento no
 * clique — ou, se forem o botão de enviar de um formulário, no envio válido.
 *
 * Cada regra dispara uma vez por visualização; as de clique disparam a cada
 * clique. Cliques e envios têm intervalo mínimo de 1,5 s por evento (clique
 * duplo, ou botão com "Lead" + regra "Lead ao enviar formulário", contam uma vez).
 * Botão de enviar cujo clique a página trata (preventDefault: envio por fetch,
 * "return false" num formulário que cobre a página toda) não é seguido de envio:
 * o evento dele sai no clique. Tentativa barrada pela validação do navegador não
 * é tratada pela página e continua não contando.
 *
 * Formulários contam no ENVIO, nunca no clique: clicar num campo de um
 * formulário de checkout não é iniciar o checkout.
 *
 * Clique num link (<a>/<area>) ou envio de formulário que leva a outra página
 * enquanto o script de um pixel ainda carrega (ex.: "Comprar" logo depois do
 * "Aceitar"): a navegação espera o pixel (até 0,8 s), senão o evento se perde
 * junto com a página. Quem decide é um ouvinte no fim do caminho do evento
 * (bolha da janela) — ou, se o script da página parar a propagação, logo depois
 * do ouvinte dela: se a página tratou o evento (preventDefault: modal, checkout
 * em janela, envio por fetch), nada muda, mesmo que ela decida depois da espera
 * começar. O formulário segurado é reenviado sem passar de novo pelos ouvintes
 * da página. Enquanto a página espera para sair, outros cliques de navegação e
 * envios são ignorados (clique duplo não fura a espera). Botões data-os-href e
 * o formulário de captura esperam no script das páginas (src/runtime/os-runtime.ts
 * e widgets/lead-form.ts, via window.__osTracking); a espera de um botão
 * data-os-href usa a mesma marcação (`leaving`), então um link clicado logo
 * depois também não sai na frente do pixel.
 *
 * Safari < 15.4 não tem SubmitEvent.submitter: o botão de enviar vem do último
 * clique, para o reenvio levar o nome/valor e o formaction/formmethod dele.
 */
import type { RuntimeRule } from "@/lib/tracking/runtime-config";
import type { Cfg, Ev } from "./config";
import { checkoutOf, destAttr, isCheckout, toUrl } from "./links";
import { $$, attr, doc, on, win } from "./util";

/** Situação dos scripts dos pixels (window.__osTracking, ver createVendors). */
export interface VendorWait {
  /** Algum script de pixel ainda está carregando. */
  pending(): boolean;
  /** Resolve quando todos terminaram de carregar (ou depois de `ms`). */
  settled(ms: number): Promise<void>;
  /**
   * A página está esperando o pixel para sair: aqui (link ou formulário
   * segurado) ou no script das páginas (botão data-os-href, src/runtime/os-runtime.ts).
   */
  leaving?: boolean;
}

/** Botão que envia um formulário (e o formulário), para disparar no envio e não no clique. */
function submitFormOf(el: Element): HTMLFormElement | null {
  const form = (el as HTMLButtonElement).form;
  if (!form) return null;
  const type = (el.getAttribute("type") || "").toLowerCase();
  if (el.tagName === "BUTTON") return type === "" || type === "submit" ? form : null;
  return el.tagName === "INPUT" && (type === "submit" || type === "image") ? form : null;
}

const matches = (el: Element, sel: string) => {
  try {
    return el.matches(sel);
  } catch {
    return false;
  }
};

/**
 * A imagem (ainda sem carregar) já tem a altura reservada — width/height,
 * aspect-ratio ou altura no CSS? Conta só o conteúdo, acima do min-height:
 * padding, borda (img-thumbnail do Bootstrap, box-sizing: border-box) e um
 * min-height pequeno dão altura a uma imagem que ainda vai crescer.
 */
function reserved(img: Element): boolean {
  const s = getComputedStyle(img);
  const px = (v: string) => parseFloat(v) || 0;
  const box =
    s.boxSizing === "border-box"
      ? px(s.paddingTop) + px(s.paddingBottom) + px(s.borderTopWidth) + px(s.borderBottomWidth)
      : 0;
  return px(s.height) - box > Math.max(0, px(s.minHeight) - box) + 0.5;
}

/** `fire` devolve true quando o evento saiu na hora para os pixels (consentimento dado). */
export function startRules(cfg: Cfg, fire: (ev: Ev) => boolean, wait: VendorWait) {
  const done = new Set<RuntimeRule>();
  const rules = cfg.rules.filter((r) => r.event !== "PAGE_VIEW");
  const of = (trigger: string) => rules.filter((r) => r.trigger === trigger);
  const once = (r: RuntimeRule) => {
    if (!done.has(r)) {
      done.add(r);
      fire(r.event);
    }
  };
  const all = (list: RuntimeRule[]) => list.every((r) => done.has(r));
  const last: Record<string, number> = {};
  /** Quando um evento saiu para os pixels pela última vez (o clique no botão vem antes do envio do formulário). */
  let sentAt = 0;
  /** Dispara cada evento no máximo uma vez a cada 1,5 s. */
  const hit = (events: string[]) => {
    const now = Date.now();
    let sent = false;
    for (const ev of events) {
      if (now - (last[ev] || 0) < 1500) continue;
      last[ev] = now;
      if (fire(ev as Ev)) sent = true;
    }
    if (sent) sentAt = now;
    return sent;
  };

  of("PAGE_LOAD").forEach(once);

  // ── Tempo na página (só conta com a aba visível) ────────────────────────
  const timed = of("TIME_ON_PAGE");
  if (timed.length) {
    let seconds = 0;
    const timer = setInterval(() => {
      if (doc.visibilityState === "hidden") return;
      seconds++;
      for (const r of timed) if (seconds >= (r.value as number)) once(r);
      if (all(timed)) clearInterval(timer);
    }, 1000);
  }

  // ── Rolagem (% do documento) ────────────────────────────────────────────
  const scrolls = of("SCROLL_DEPTH");
  if (scrolls.length) {
    const check = () => {
      if (all(scrolls)) return;
      const height = Math.max(doc.documentElement.scrollHeight, doc.body ? doc.body.scrollHeight : 0);
      const pct = ((scrollY + innerHeight + 2) / height) * 100;
      for (const r of scrolls) if (pct >= (r.value as number)) once(r);
    };
    // A página ainda vai crescer: conteúdo com atraso escondido (VSL) ou imagens
    // "lazy" sem altura que ainda vão carregar. Aí só vale a rolagem de verdade.
    // Imagem escondida (versão só do celular), com altura já reservada (width/
    // height, CSS, slide de carrossel) ou quebrada não muda a altura da página.
    const grown = () =>
      !doc.querySelector('[data-os-delay]:not([data-os-delay="0"]):not(.os-revealed)') &&
      $$("img[loading=lazy]").every(
        (img) => (img as HTMLImageElement).complete || !img.getClientRects().length || reserved(img),
      );
    // Página curta (já aparece inteira, sem rolar): vale ao terminar de carregar.
    const short = () => {
      if (!all(scrolls) && grown()) check();
    };
    on(win, "scroll", () => {
      if (scrollY > 0) check();
    });
    if (doc.readyState === "complete") short();
    else on(win, "load", short);
    on(win, "resize", short);
    // Conteúdo com atraso apareceu (os-runtime) ou uma imagem "lazy" carregou (ou falhou).
    on(doc, "os:revealed", short);
    for (const type of ["load", "error"])
      on(
        doc,
        type,
        (e) => {
          if ((e.target as Element).tagName === "IMG") short();
        },
        true,
      );
  }

  // ── Cliques ─────────────────────────────────────────────────────────────
  const clicks = rules.filter((r) => {
    if (r.trigger !== "ELEMENT_CLICK") return r.trigger === "CHECKOUT_CLICK";
    try {
      return !doc.createDocumentFragment().querySelector(r.selector as string);
    } catch {
      return false; // seletor inválido: a regra fica de fora sem quebrar os outros cliques
    }
  });
  /** Evento do botão (data-os-event) que espera o envio válido do formulário. */
  const armed = new WeakMap<Element, string>();
  /** Clique ou envio que mandou evento com um pixel ainda carregando (a bolha decide se segura). */
  let held: Event | null = null;
  /** Reenvio do formulário segurado: passa direto (a página já tratou o envio). */
  let passing = false;
  /** Último botão de enviar clicado (Safari < 15.4: o envio não diz qual botão foi). */
  let clicked: HTMLButtonElement | null = null;

  /**
   * Clique normal (mesma aba) que leva a outra página: o destino, com o
   * atributo de onde ele veio (href ou data-os-href). null = não navega.
   */
  const navigation = (e: MouseEvent, t: Element): [URL, string] | null => {
    if (e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return null;
    const link = t.closest("a[href],area[href],[data-os-href]");
    const a = link && destAttr(link);
    if (!link || !a || a === "action" || link.hasAttribute("download")) return null;
    const url = toUrl(attr(link, a));
    const target = attr(link, a === "href" ? "target" : "data-os-target");
    if (!url || (target && target !== "_self")) return null;
    if (url.hash && url.href.split("#")[0] === location.href.split("#")[0]) return null; // âncora na própria página
    return [url, a];
  };

  /**
   * Envia de novo o formulário segurado, com o botão usado (métodos do
   * protótipo: um campo name="submit" esconde form.submit).
   */
  const resubmit = (form: HTMLFormElement, by: HTMLButtonElement | null) => {
    const P = HTMLFormElement.prototype;
    passing = true;
    try {
      // Sem requestSubmit (Safari < 16), a chamada falha e cai no submit().
      P.requestSubmit.call(form, by && by.form === form ? by : undefined);
    } catch {
      // O submit() não leva o botão: o nome/valor dele vai num campo escondido e o
      // formaction/formmethod/formenctype/formtarget vale só durante o envio.
      const extra = doc.createElement("input");
      extra.type = "hidden";
      const kept: [string, string | null][] = [];
      if (by) {
        if (by.name) {
          extra.name = by.name;
          extra.value = by.value;
          form.appendChild(extra);
        }
        for (const a of ["action", "method", "enctype", "target"]) {
          const v = by.getAttribute(`form${a}`);
          if (v !== null) {
            kept.push([a, form.getAttribute(a)]);
            form.setAttribute(a, v);
          }
        }
      }
      P.submit.call(form);
      extra.remove();
      for (const k of kept) {
        if (k[1] === null) form.removeAttribute(k[0]);
        else form.setAttribute(k[0], k[1]);
      }
    }
    passing = false;
  };

  /** Segura (ou não) o evento guardado em `held`: a página não o tratou e ele leva a outra página. */
  const decide = (e: Event) => {
    if (e !== held) return;
    held = null;
    if (e.defaultPrevented) return;
    let go: (() => void) | null = null;
    if (e.type === "submit") {
      const form = e.target as HTMLFormElement;
      // Safari < 15.4: sem `submitter` (undefined), vale o botão do último clique.
      const sent = (e as SubmitEvent).submitter;
      const by = (
        sent === undefined ? (clicked && clicked.form === form ? clicked : null) : sent
      ) as HTMLButtonElement | null;
      const target = (by && attr(by, "formtarget")) || attr(form, "target");
      // Outra aba/janela ou <dialog>: a página fica, o pixel termina de carregar.
      if (
        !(target && target !== "_self") &&
        !/^dialog$/i.test((by && attr(by, "formmethod")) || attr(form, "method"))
      ) {
        go = () => resubmit(form, by);
      }
    } else {
      const nav = navigation(e as MouseEvent, e.target as Element);
      if (nav && nav[1] === "href") go = () => location.assign(nav[0].href);
    }
    if (!go) return;
    const prevent = e.preventDefault;
    prevent.call(e);
    // Um ouvinte da página que roda depois desta decisão ainda pode tratar o evento: vale o dele.
    let stay = false;
    e.preventDefault = function (this: Event) {
      prevent.call(this);
      stay = true;
      wait.leaving = false;
    };
    wait.leaving = true;
    wait.settled(800).then(() =>
      setTimeout(() => {
        if (stay) return;
        (go as () => void)();
        // A página pode não sair (download, resposta vazia): os cliques voltam a valer.
        setTimeout(() => {
          wait.leaving = false;
        }, 2000);
      }, 100),
    );
  };

  /**
   * Evento que mandou algo com um pixel carregando: decide no fim do caminho
   * (bolha da janela) ou, se a página parar a propagação, logo depois do
   * ouvinte dela (antes da ação padrão do navegador).
   */
  const hold = (e: Event) => {
    held = e;
    for (const m of ["stopPropagation", "stopImmediatePropagation"] as const) {
      const stop = e[m];
      e[m] = function (this: Event) {
        stop.call(this);
        Promise.resolve(e).then(decide);
      };
    }
  };

  // No fim do caminho do evento: depois do script da página, que pode tê-lo tratado.
  on(win, "click", decide);
  on(win, "submit", decide);
  // Voltou pelo cache do navegador (botão Voltar) depois de sair: nada mais está esperando.
  on(win, "pageshow", (e) => {
    if ((e as PageTransitionEvent).persisted) wait.leaving = false;
  });

  on(
    win,
    "click",
    (e) => {
      const t = e.target as Element;
      if (!t.closest) return;
      // Já saindo (clique duplo no "Comprar", ou um link logo depois de um botão
      // data-os-href): o segundo clique não navega na frente do pixel.
      if (wait.leaving && navigation(e as MouseEvent, t)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      const button = t.closest("button,input");
      clicked = button && submitFormOf(button) ? (button as HTMLButtonElement) : null;
      const events: string[] = [];
      for (const r of clicks) {
        if (r.trigger === "CHECKOUT_CLICK") {
          if (checkoutOf(t, cfg)) events.push(r.event);
        } else {
          // Seletor que é o próprio formulário: conta no envio, não no clique nos campos.
          const el = t.closest(r.selector as string);
          if (el && el.tagName !== "FORM") events.push(r.event);
        }
      }
      const tagged = t.closest("[data-os-event]");
      const ev = tagged && (tagged.getAttribute("data-os-event") || "").trim().toUpperCase();
      if (tagged && ev && ev !== "PAGE_VIEW" && /^[A-Z_]+$/.test(ev)) {
        const form = submitFormOf(tagged);
        // Botão de enviar: o evento sai no envio válido (tentativa com campos vazios não conta).
        if (form) {
          armed.set(form, ev);
          // Depois do clique inteiro (e do envio, que vem junto): se a página tratou
          // o clique, nenhum envio vem — o evento sai agora.
          setTimeout(() => {
            if (e.defaultPrevented && armed.get(form) === ev) {
              armed.delete(form);
              hit([ev]);
            }
          });
        } else events.push(ev);
      }
      if (hit(events) && wait.pending()) hold(e);
    },
    true,
  );

  // ── Formulários ─────────────────────────────────────────────────────────
  const forms = of("FORM_SUBMIT");
  const submitted = (form: Element) => {
    const events: string[] = [];
    const ev = armed.get(form);
    if (ev) {
      armed.delete(form);
      events.push(ev);
    }
    if (form.tagName === "FORM") {
      for (const r of clicks) {
        if (r.trigger === "CHECKOUT_CLICK" ? isCheckout(form, cfg) : matches(form, r.selector as string)) {
          events.push(r.event);
        }
      }
    }
    for (const r of forms) {
      if (!done.has(r)) {
        done.add(r);
        events.push(r.event);
      }
    }
    hit(events);
  };
  // Formulário de captura do editor: "os:lead" sai só depois de validar os campos (ele espera o pixel sozinho).
  on(doc, "os:lead", (e) => submitted(e.target as Element));
  on(
    win,
    "submit",
    (e) => {
      const form = e.target as Element;
      if (form.tagName !== "FORM" || form.getAttribute("data-os-widget") === "lead-form") return;
      // Reenvio do formulário segurado: os ouvintes da página já trataram o envio uma vez.
      if (passing) return e.stopImmediatePropagation();
      if (wait.leaving) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      submitted(form);
      // Evento do envio ou do clique no botão que enviou (o mesmo gesto). Só um
      // envio de verdade (do navegador, também via requestSubmit): o "submit" que
      // a página cria (dispatchEvent) não envia nada, e o reenvio sairia da página.
      if (e.isTrusted && Date.now() - sentAt < 100 && wait.pending()) hold(e);
    },
    true,
  );
}
