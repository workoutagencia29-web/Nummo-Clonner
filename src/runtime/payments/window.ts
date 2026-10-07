/**
 * Janela de pagamento (por cima da página, sem trocar de página) de um produto
 * de "Pagamento na página". Uma janela por produto: fechar só esconde (o que
 * estava aberto continua lá ao reabrir — inclusive o formulário de cartão).
 *
 * Passos: formulário (método + nome + e-mail [+ RFC/CURP no SPEI]) → cobrança
 * criada no endpoint →
 * - SPEI: CLABE, banco, titular, valor exato, referência e validade (cada um
 *   com "Copiar"), conferindo o status a cada ~4 s ("Esperando tu
 *   transferencia…"). O pedido fica guardado (./api): fechar e reabrir — ou
 *   voltar outro dia — mostra a mesma CLABE;
 * - cartão, Bizum e MB WAY: o SDK do gateway (só https://kyvopay.com/sdk/…)
 *   monta o formulário aqui dentro; o onSuccess NÃO é pagamento — vira
 *   "Confirmando tu pago…" e a janela confere o status. Recusado → "Intentar
 *   con otra tarjeta" (cobrança nova: a sessão do SDK é de uso único);
 * - pago → "¡Pago confirmado!", evento "os:purchase" (Purchase nos pixels,
 *   src/runtime/tracking/purchase.ts) e a página de obrigado do produto com
 *   ?pedido=<id da cobrança>; vencido/falhou → mensagem e "gerar de novo";
 *   erro de rede/servidor → mensagem clara e "Tentar de novo".
 *
 * "Cambiar forma de pago" com SPEI aberto pede confirmação (quem já transferiu
 * espera); trocando mesmo assim, o SPEI antigo vai para uma memória à parte
 * (chave "<produto>:spei") e continua sendo conferido até vencer — pago, leva
 * à página de obrigado com o ?pedido= dele; o formulário mostra "Ver datos de
 * la transferencia anterior".
 *
 * Acessível: role="dialog" + aria-modal, foco preso na janela, Esc fecha, foco
 * volta para o botão; mudanças de estado anunciadas (aria-live). Textos no
 * idioma do produto (./texts). Na prévia (simulacao), nada é cobrado e
 * aparecem os botões de simular (em português, para você).
 */
import {
  type CardInstructions,
  DOCUMENT_RE,
  EMAIL_RE,
  isAllowedSdkUrl,
  NAME_MAX,
  ORDER_PARAM,
  PAY_METHODS,
  PAYMENT_POLL_MS,
  type PayCurrency,
  type PayMethod,
  type PaymentCreateResponse,
  type PaymentPageConfig,
  type PaymentStatusResponse,
  type PublicPaymentProduct,
} from "@/lib/payments/contract";
import { copyText } from "../widgets/copy";
import { dropOrder, loadOrder, type OpenOrder, type PayError, postPayment, saveOrder } from "./api";
import { PAY_CSS } from "./css";
import { payMetadata, trackingInfo } from "./meta";
import { formatDate, formatMoney, type PayTexts, payTexts, SIM_TEXTS } from "./texts";

/** O que a página expõe do rastreamento (src/runtime/tracking/index.ts). */
interface TrackingApi {
  settled?: (ms: number) => Promise<void>;
}

/** SDK de cartão do gateway (Kyvo: KyvoCard.mount). */
interface CardSdk {
  mount(opts: Record<string, unknown>): unknown;
}

const tracking = () => (window as unknown as { __osTracking?: TrackingApi }).__osTracking;

/** O método vale para a moeda (SPEI só em MXN; Bizum e MB WAY só em EUR) — a mesma regra do painel. */
export function methodFits(m: PayMethod, currency: PayCurrency): boolean {
  if (m === "spei") return currency === "MXN";
  if (m === "bizum" || m === "mb_way") return currency === "EUR";
  return m === "card";
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  return el;
}

function button(cls: string, text: string, onClick: () => void) {
  const b = make("button", cls, text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

/** Cor de destaque a partir do botão clicado ("#rrggbb"; padrão verde). */
export function accentOf(trigger: Element | null): string {
  const DEF = "#16a34a";
  if (!trigger) return DEF;
  let bg = "";
  try {
    bg = getComputedStyle(trigger).backgroundColor || "";
  } catch {
    return DEF;
  }
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?/.exec(bg);
  if (!m) return DEF;
  const alpha = m[4] === undefined ? 1 : m[4].indexOf("%") > 0 ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  const rgb = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Transparente ou quase branco: some na janela branca.
  if (!(alpha > 0.5) || luminance(rgb) > 0.86) return DEF;
  return `#${rgb.map((n) => (n < 16 ? "0" : "") + Math.min(255, n).toString(16)).join("")}`;
}

function luminance(rgb: number[]) {
  const c = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** Texto legível sobre a cor de destaque. */
export function onAccent(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return luminance([(n >> 16) & 255, (n >> 8) & 255, n & 255]) > 0.45 ? "#0f172a" : "#ffffff";
}

/** Metadata da cobrança, com a escolha de cookies da hora (./meta). */
function metadata(): Record<string, string> {
  try {
    return payMetadata(trackingInfo());
  } catch {
    return {};
  }
}

const sdkLoads: Record<string, Promise<boolean>> = {};

/** Carrega o SDK do gateway uma vez (true = carregou). */
function loadSdk(url: string): Promise<boolean> {
  if ((window as unknown as { KyvoCard?: CardSdk }).KyvoCard) return Promise.resolve(true);
  if (!sdkLoads[url]) {
    sdkLoads[url] = new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = url;
      s.async = true;
      s.onload = () => resolve(true);
      s.onerror = () => {
        delete sdkLoads[url];
        s.remove();
        resolve(false);
      };
      (document.head || document.documentElement).appendChild(s);
    });
  }
  return sdkLoads[url];
}

function addCss() {
  if (document.getElementById("os-pw-css")) return;
  const style = make("style", "", PAY_CSS);
  style.id = "os-pw-css";
  document.head.appendChild(style);
}

/** Depois de quanto tempo em "Confirmando…" aparece "Intentar de nuevo". */
const STUCK_MS = 120_000;

const FOCUSABLE =
  "a[href],button:not([disabled]),input:not([disabled]):not([type=radio]),input[type=radio]:checked,[tabindex='0']";

let seq = 0;

interface Buyer {
  metodo: PayMethod;
  nome: string;
  email: string;
  documento: string;
}

type Step = "" | "form" | "loading" | "spei" | "changeSpei" | "card" | "confirming" | "paid" | "problem" | "error";

export interface PayWindow {
  open(trigger: Element | null): void;
  close(): void;
}

export function createPayWindow(cfg: PaymentPageConfig, endpoint: string, key: string, product: PublicPaymentProduct) {
  const t: PayTexts = payTexts(product.idioma);
  const locale = product.idioma;
  const money = (cents: number, cur: PayCurrency) => formatMoney(cents, cur, locale);
  const methods = product.metodos.filter((m) => PAY_METHODS.indexOf(m) >= 0 && methodFits(m, product.moeda));
  const sim = cfg.simulacao === true;
  const id = `os-pw-${++seq}`;
  const html = document.documentElement;

  let root: HTMLDivElement | null = null;
  let box: HTMLDivElement;
  let body: HTMLDivElement;
  let live: HTMLParagraphElement;
  let step: Step = "";
  let visible = false;
  let back: HTMLElement | null = null;
  let accent = "#16a34a";
  let order: OpenOrder | null = null;
  let buyer: Buyer | null = null;
  let chosen: PayMethod = methods[0];
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let fails = 0;
  let paidDone = false;
  let mounted: unknown = null;
  /** Muda a cada passo: respostas atrasadas de um passo antigo não mexem na janela. */
  let turn = 0;
  /** "Confirmando tu pago…": desde quando, e a saída que aparece se o banco não confirmar. */
  let confirmAt = 0;
  let stuckBox: HTMLElement | null = null;
  /** SPEI deixado de lado no "Cambiar de todos modos": continua conferido até vencer. */
  let oldSpei: OpenOrder | null = null;
  let oldTimer: ReturnType<typeof setTimeout> | undefined;
  const oldKey = `${key}:spei`;

  const announce = (text: string) => {
    live.textContent = "";
    setTimeout(() => {
      live.textContent = text;
    }, 30);
  };

  function build() {
    addCss();
    root = make("div", "os-pw");
    root.hidden = true;
    box = make("div", "os-pw-box");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-labelledby", `${id}-n`);
    box.setAttribute("lang", locale);
    const x = button("os-pw-x", "×", close);
    x.setAttribute("aria-label", t.close);
    const kicker = make("p", "os-pw-k", t.kicker);
    const name = make("h2", "os-pw-n", product.nome);
    name.id = `${id}-n`;
    const price = make("p", "os-pw-p", money(product.valor, product.moeda));
    box.append(x, kicker, name, price);
    if (sim) box.appendChild(make("p", "os-pw-sim", SIM_TEXTS.banner));
    body = make("div", "os-pw-body");
    live = make("p", "os-pw-sr");
    live.setAttribute("aria-live", "polite");
    box.append(body, live, make("p", "os-pw-ft", `🔒 ${t.secure}`));
    root.appendChild(box);
    root.addEventListener("click", (e) => {
      if (e.target === root) close();
    });
    document.body.appendChild(root);
  }

  function onKey(e: KeyboardEvent) {
    if (!visible) return;
    if (e.key === "Escape" || e.key === "Esc") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== "Tab") return;
    const list = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length);
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement;
    if (e.shiftKey ? active === first || !box.contains(active) : active === last || !box.contains(active)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  }

  /** Troca o conteúdo da janela (o foco vai para o novo conteúdo se estava no que saiu). */
  function render(next: Step, nodes: Node[], focus?: HTMLElement | null) {
    turn++;
    step = next;
    body.textContent = "";
    for (const n of nodes) body.appendChild(n);
    if (visible && !box.contains(document.activeElement)) {
      const target = focus || body.querySelector<HTMLElement>(FOCUSABLE) || body.querySelector<HTMLElement>("h3,p");
      if (target) {
        if (!target.matches(FOCUSABLE)) target.setAttribute("tabindex", "-1");
        try {
          target.focus({ preventScroll: true });
        } catch {
          target.focus();
        }
      }
    }
  }

  function stopPoll() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = undefined;
  }

  function unmount() {
    const m = mounted as { unmount?: () => void; destroy?: () => void } | null;
    mounted = null;
    try {
      if (m && typeof m.unmount === "function") m.unmount();
      else if (m && typeof m.destroy === "function") m.destroy();
    } catch {
      // o SDK já foi desmontado
    }
  }

  function forget() {
    dropOrder(endpoint, key);
    order = null;
    stopPoll();
    unmount();
  }

  // ── SPEI anterior (deixado de lado no "Cambiar") ───────────────────────
  function stopOld() {
    if (oldTimer) clearTimeout(oldTimer);
    oldTimer = undefined;
  }

  function dropOld() {
    stopOld();
    oldSpei = null;
    dropOrder(endpoint, oldKey);
  }

  function pollOld(delay: number) {
    stopOld();
    if (!visible || !oldSpei || paidDone) return;
    oldTimer = setTimeout(checkOld, delay);
  }

  function checkOld() {
    oldTimer = undefined;
    const o = oldSpei;
    if (!o || !visible) return;
    postPayment<PaymentStatusResponse>(endpoint, { acao: "status", pedido: o.pedido, produto: key }).then((r) => {
      if (oldSpei !== o || paidDone) return;
      if (!r.ok) {
        if (r.erro === "nao_encontrado") {
          dropOld();
          hideOldNote();
        } else pollOld(PAYMENT_POLL_MS * 2);
        return;
      }
      if (r.pago || r.status === "paid") {
        dropOld();
        paid(r);
        return;
      }
      if (r.status === "pending") {
        pollOld(PAYMENT_POLL_MS);
        return;
      }
      // Venceu, falhou ou foi cancelado: nada mais a conferir (o formulário perde a nota).
      dropOld();
      hideOldNote();
    });
  }

  /** Tira a nota do SPEI anterior do formulário (sem apagar o que foi digitado). */
  function hideOldNote() {
    const note = body.querySelector(".os-pw-old");
    // biome-ignore lint/complexity/useOptionalChain: "?." vira código maior no script das páginas (Safari 13).
    if (note && note.parentNode) note.parentNode.removeChild(note);
  }

  /** Volta ao SPEI anterior ("Ver datos de la transferencia anterior"). */
  function restoreOld() {
    const o = oldSpei;
    if (!o) return;
    forget();
    stopOld();
    oldSpei = null;
    dropOrder(endpoint, oldKey);
    order = o;
    saveOrder(endpoint, key, o);
    showSpei();
    poll(0);
  }

  /** "Cambiar" com SPEI aberto: quem já transferiu não pode perder o pedido. */
  function confirmChange() {
    const o = order;
    if (!o || o.metodo !== "spei") return;
    stopPoll();
    const ctr = make("div", "os-pw-ctr");
    ctr.setAttribute("role", "alert");
    ctr.append(
      make("p", "os-pw-ic os-pw-warn", "!"),
      make("h3", "os-pw-h", t.changeSpeiTitle),
      make("p", "os-pw-txt", t.changeSpeiText),
    );
    const keep = button("os-pw-go", t.keepWaiting, () => {
      showSpei();
      poll(0);
    });
    const anyway = button("os-pw-ln", t.changeAnyway, () => {
      stopPoll();
      dropOrder(endpoint, key);
      order = null;
      oldSpei = o;
      saveOrder(endpoint, oldKey, o);
      showForm();
      pollOld(PAYMENT_POLL_MS);
    });
    render("changeSpei", [ctr, keep, anyway], keep);
    announce(t.changeSpeiTitle);
  }

  // ── Formulário ─────────────────────────────────────────────────────────
  function field(name: string, label: string, type: string, auto: string, value: string) {
    const wrap = make("label", "os-pw-f");
    const span = make("span", "", label);
    const input = make("input");
    input.type = type;
    input.name = name;
    input.setAttribute("autocomplete", auto);
    input.value = value;
    input.id = `${id}-${name}`;
    if (type === "email") input.setAttribute("inputmode", "email");
    if (name === "nome") input.maxLength = NAME_MAX;
    if (name === "documento") {
      input.maxLength = 40;
      input.setAttribute("autocapitalize", "characters");
      input.setAttribute("spellcheck", "false");
    }
    const err = make("small", "os-pw-err");
    err.id = `${id}-${name}-e`;
    err.hidden = true;
    wrap.append(span, input, err);
    return { wrap: wrap, input: input, err: err };
  }

  function showForm() {
    if (!methods.length) {
      showError("configuracao", null);
      return;
    }
    if (methods.indexOf(chosen) < 0) chosen = methods[0];
    const form = make("form");
    form.noValidate = true;
    const nodes: Node[] = [form];
    const labels: HTMLLabelElement[] = [];
    if (methods.length > 1) {
      form.appendChild(make("p", "os-pw-t", t.method)).id = `${id}-mt`;
      const group = make("div", "os-pw-ms");
      group.setAttribute("role", "radiogroup");
      group.setAttribute("aria-labelledby", `${id}-mt`);
      for (const m of methods) {
        const label = make("label", "os-pw-m");
        const radio = make("input");
        radio.type = "radio";
        radio.name = `${id}-metodo`;
        radio.value = m;
        radio.checked = m === chosen;
        radio.addEventListener("change", () => {
          if (radio.checked) pick(m);
        });
        const texts = t.methods[m];
        label.append(radio, make("b", "", texts[0]), make("small", "", texts[1]));
        labels.push(label);
        group.appendChild(label);
      }
      form.appendChild(group);
    }
    const prev = buyer;
    const nome = field("nome", t.name, "text", "name", prev ? prev.nome : "");
    const email = field("email", t.email, "email", "email", prev ? prev.email : "");
    const doc = field("documento", t.doc, "text", "off", prev ? prev.documento : "");
    const go = make("button", "os-pw-go");
    go.type = "submit";
    form.append(nome.wrap, email.wrap, doc.wrap, go);
    if (oldSpei) {
      const note = make("div", "os-pw-old");
      note.append(make("p", "os-pw-note", t.oldSpeiNote), button("os-pw-ln", t.oldSpeiShow, restoreOld));
      nodes.push(note);
    }

    function pick(m: PayMethod) {
      chosen = m;
      for (let i = 0; i < labels.length; i++) labels[i].classList.toggle("os-pw-on", methods[i] === m);
      doc.wrap.hidden = m !== "spei";
      go.textContent = m === "spei" ? t.goSpei : t.goCard;
    }
    pick(chosen);

    const setErr = (f: { input: HTMLInputElement; err: HTMLElement }, msg: string) => {
      f.err.textContent = msg;
      f.err.hidden = !msg;
      if (msg) {
        f.input.setAttribute("aria-invalid", "true");
        f.input.setAttribute("aria-describedby", f.err.id);
      } else {
        f.input.removeAttribute("aria-invalid");
        f.input.removeAttribute("aria-describedby");
      }
    };

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const n = nome.input.value.trim().replace(/\s+/g, " ");
      const em = email.input.value.trim().toLowerCase();
      const d = chosen === "spei" ? doc.input.value.trim().toUpperCase() : "";
      const bad: { input: HTMLInputElement; err: HTMLElement }[] = [];
      const check = (f: { input: HTMLInputElement; err: HTMLElement }, ok: boolean, msg: string) => {
        setErr(f, ok ? "" : msg);
        if (!ok) bad.push(f);
      };
      check(nome, n.length >= 2 && n.length <= NAME_MAX && /\p{L}/u.test(n), t.errName);
      check(email, EMAIL_RE.test(em) && em.length <= 254, t.errEmail);
      check(doc, !d || DOCUMENT_RE.test(d), t.errDoc);
      if (bad.length) {
        bad[0].input.focus();
        announce(bad[0].err.textContent || "");
        return;
      }
      buyer = { metodo: chosen, nome: n, email: em, documento: d };
      create();
    });
    render("form", nodes);
  }

  // ── Cobrança ───────────────────────────────────────────────────────────
  function loading(text: string) {
    const ctr = make("div", "os-pw-ctr");
    ctr.append(make("span", "os-pw-sp"), make("p", "os-pw-txt", text));
    render("loading", [ctr]);
    announce(text);
  }

  function create() {
    if (!buyer) {
      showForm();
      return;
    }
    forget();
    paidDone = false;
    const b = buyer;
    loading(t.creating);
    const my = turn;
    const req: Record<string, unknown> = {
      acao: "criar",
      produto: key,
      metodo: b.metodo,
      nome: b.nome,
      email: b.email,
      metadata: metadata(),
    };
    if (b.documento) req.documento = b.documento;
    postPayment<PaymentCreateResponse>(endpoint, req).then((r) => {
      if (my !== turn) return;
      if (!r.ok) {
        if (r.erro === "recusado") showProblem("declined");
        else showError(r.erro, create);
        return;
      }
      const o: OpenOrder = {
        v: 1,
        pedido: r.pedido,
        ext: r.pedidoExterno,
        metodo: r.metodo,
        valor: r.valor,
        moeda: r.moeda,
        at: Date.now(),
      };
      if (r.simulacao) o.simulacao = 1;
      if (r.metodo === "spei" && r.spei) {
        o.spei = r.spei;
        order = o;
        saveOrder(endpoint, key, o);
        showSpei();
        poll(PAYMENT_POLL_MS);
      } else if (r.metodo !== "spei" && r.cartao) {
        order = o;
        showCard(r.cartao);
      } else showError("indisponivel", create);
    });
  }

  function copyRow(label: string, value: string, copyValue: string | null, mono?: boolean) {
    const row = make("div", "os-pw-r");
    const wrap = make("div");
    const dd = make("dd", mono ? "os-pw-mono" : "", value);
    wrap.append(make("dt", "", label), dd);
    row.appendChild(wrap);
    if (copyValue) {
      const b = button("os-pw-cp", t.copy, () => copyText(copyValue, b, t.copied, t.copyFail));
      b.setAttribute("aria-label", `${t.copy}: ${label}`);
      row.appendChild(b);
    }
    return row;
  }

  function changeLink() {
    return methods.length > 1
      ? button("os-pw-ln", t.change, () => {
          if (step === "spei" && order && order.metodo === "spei") {
            confirmChange();
            return;
          }
          forget();
          showForm();
        })
      : null;
  }

  function simButtons(list: [string, "pago" | "recusado" | "expirado"][]) {
    const wrap = make("div", "os-pw-simb");
    for (const item of list) {
      const b = button("", item[0], () => simulate(item[1]));
      wrap.appendChild(b);
    }
    return wrap;
  }

  function showSpei() {
    const o = order;
    if (!o || !o.spei) return showForm();
    const s = o.spei;
    const rows = make("dl", "os-pw-rows");
    rows.append(
      copyRow(t.clabe, s.clabe.replace(/(\d{3})(\d{3})(\d{11})(\d)/, "$1 $2 $3 $4"), s.clabe, true),
      copyRow(t.bank, s.banco, s.banco),
      copyRow(t.holder, s.titular, s.titular),
      copyRow(t.amount, money(o.valor, o.moeda), (o.valor / 100).toFixed(2)),
    );
    if (s.referencia) rows.appendChild(copyRow(t.reference, s.referencia, s.referencia, true));
    const until = formatDate(s.expiraEm, locale, o.moeda);
    if (until) rows.appendChild(copyRow(t.expires, until, null));
    const status = make("p", "os-pw-st");
    status.setAttribute("role", "status");
    status.append(make("span", "os-pw-sp"), document.createTextNode(t.waitSpei));
    const nodes: Node[] = [make("p", "os-pw-txt", t.speiIntro), rows, status, make("p", "os-pw-note", t.waitNote)];
    if (o.simulacao) {
      nodes.push(
        simButtons([
          [SIM_TEXTS.approve, "pago"],
          [SIM_TEXTS.expire, "expirado"],
        ]),
      );
    }
    const change = changeLink();
    if (change) nodes.push(change);
    render("spei", nodes, rows.querySelector<HTMLElement>("button"));
    announce(t.waitSpei);
  }

  function showCard(card: CardInstructions) {
    const o = order;
    if (!o) return showForm();
    const m = o.metodo === "spei" ? "card" : o.metodo;
    const box2 = make("div", "os-pw-card");
    const nodes: Node[] = [make("p", "os-pw-txt", t.cardIntro[m]), box2];
    const fake = o.simulacao || !card.sdkUrl || (card.sessao && card.sessao.simulacao === true);
    if (fake) {
      box2.appendChild(make("p", "os-pw-fake", SIM_TEXTS.cardBox));
      nodes.push(
        simButtons([
          [SIM_TEXTS.approve, "pago"],
          [SIM_TEXTS.decline, "recusado"],
        ]),
      );
    }
    const change = changeLink();
    if (change) nodes.push(change);
    render("card", nodes);
    if (fake) return;
    if (!isAllowedSdkUrl(card.sdkUrl)) {
      showError("configuracao", null);
      return;
    }
    const wait = make("div", "os-pw-ctr");
    wait.append(make("span", "os-pw-sp"), make("p", "os-pw-txt", t.loadingForm));
    box2.appendChild(wait);
    const my = turn;
    loadSdk(card.sdkUrl).then((ok) => {
      if (my !== turn) return;
      const sdk = (window as unknown as { KyvoCard?: CardSdk }).KyvoCard;
      if (!ok || !sdk || typeof sdk.mount !== "function") {
        showError(ok ? "indisponivel" : "rede", () => showCard(card));
        return;
      }
      box2.textContent = "";
      try {
        mounted = sdk.mount({
          container: box2,
          // A sessão vai inteira, como veio do gateway (uso único).
          session: card.sessao,
          locale: locale,
          appearance: { accent: accent, radius: 12 },
          onSuccess: () => {
            if (my !== turn || !order) return;
            // "Tentativa aceita", ainda não é pagamento: confere o status.
            order.enviado = 1;
            saveOrder(endpoint, key, order);
            showConfirming();
            poll(1500);
          },
          onError: () => {
            if (my !== turn) return;
            forget();
            showProblem("declined");
          },
        });
      } catch {
        showError("indisponivel", () => showCard(card));
      }
    });
  }

  function showConfirming() {
    const ctr = make("div", "os-pw-ctr");
    ctr.setAttribute("role", "status");
    ctr.append(make("span", "os-pw-sp"), make("h3", "os-pw-h", t.confirming), make("p", "os-pw-txt", t.confirmingNote));
    // O banco não confirmou em 2 minutos (ex.: verificação abandonada): dá para tentar de novo.
    const stuck = make("div");
    stuck.hidden = true;
    stuck.append(
      make("p", "os-pw-note", t.stuck),
      button("os-pw-2", t.again, () => {
        forget();
        if (buyer) create();
        else showForm();
      }),
    );
    stuckBox = stuck;
    confirmAt = Date.now();
    render("confirming", [ctr, stuck]);
    announce(t.confirming);
  }

  function simulate(resultado: "pago" | "recusado" | "expirado") {
    const o = order;
    if (!o) return;
    const card = o.metodo !== "spei";
    if (card && resultado === "pago") {
      o.enviado = 1;
      saveOrder(endpoint, key, o);
      showConfirming();
    }
    const my = turn;
    postPayment<PaymentStatusResponse>(endpoint, { acao: "simular", pedido: o.pedido, resultado: resultado }).then(
      (r) => {
        if (my !== turn) return;
        if (!r.ok) {
          showError(r.erro, null);
          return;
        }
        if (card && resultado === "recusado") {
          forget();
          showProblem("declined");
          return;
        }
        poll(card ? 600 : 0);
      },
    );
  }

  // ── Status ─────────────────────────────────────────────────────────────
  function poll(delay: number) {
    stopPoll();
    if (!visible || !order || paidDone) return;
    pollTimer = setTimeout(check, delay);
  }

  function check() {
    pollTimer = undefined;
    const o = order;
    if (!o || !visible) return;
    const my = turn;
    postPayment<PaymentStatusResponse>(endpoint, { acao: "status", pedido: o.pedido, produto: key }).then((r) => {
      if (my !== turn || order !== o) return;
      if (!r.ok) {
        if (r.erro === "nao_encontrado") {
          forget();
          showProblem("failed");
          return;
        }
        fails++;
        if (fails === 3) announce(t.reconnecting);
        poll(Math.min(20000, PAYMENT_POLL_MS * fails));
        return;
      }
      fails = 0;
      if (r.pago || r.status === "paid") {
        paid(r);
        return;
      }
      if (r.status === "pending") {
        if (step === "confirming" && stuckBox && Date.now() - confirmAt > STUCK_MS) stuckBox.hidden = false;
        poll(PAYMENT_POLL_MS);
        return;
      }
      const card = o.metodo !== "spei";
      forget();
      if (r.status === "expired") showProblem("expired");
      else if (card && (r.status === "failed" || r.status === "canceled")) showProblem("declined");
      else showProblem("failed");
    });
  }

  /** Endereço da página de obrigado com o pedido (null = sem página de obrigado). */
  function thanksUrl(pedido: string): string | null {
    const dest = product.obrigado;
    if (!dest || dest === "#") return null;
    try {
      const url = new URL(dest, location.href);
      if (!/^https?:$/.test(url.protocol)) return null;
      url.searchParams.set(ORDER_PARAM, pedido);
      return url.href;
    } catch {
      return null;
    }
  }

  function paid(r: PaymentStatusResponse) {
    if (paidDone) return;
    paidDone = true;
    forget();
    dropOld();
    html.classList.add("os-pago");
    try {
      document.dispatchEvent(
        new CustomEvent("os:purchase", {
          detail: { id: r.pedidoExterno, value: r.valor / 100, currency: r.moeda, product: key },
        }),
      );
    } catch {
      // sem CustomEvent: segue sem o evento
    }
    const dest = thanksUrl(r.pedido);
    const ctr = make("div", "os-pw-ctr");
    ctr.setAttribute("role", "status");
    ctr.append(make("p", "os-pw-ic os-pw-ok", "✓"), make("h3", "os-pw-h", t.paidTitle));
    ctr.appendChild(make("p", "os-pw-txt", dest ? t.paidGo : t.paidStay));
    const nodes: Node[] = [ctr];
    if (dest) {
      const a = make("a", "os-pw-go", t.continue);
      a.href = dest;
      nodes.push(a);
    } else if (sim) {
      nodes.push(make("p", "os-pw-sim", product.obrigado === "#" ? SIM_TEXTS.documentPreview : SIM_TEXTS.noThanks));
    }
    render("paid", nodes);
    announce(t.paidTitle);
    if (!dest) return;
    const api = tracking();
    const settled = api && typeof api.settled === "function" ? api.settled(1200) : Promise.resolve();
    // O Purchase sai antes de trocar de página (no máximo ~1,5 s de espera).
    settled
      .catch(() => {})
      .then(() => {
        setTimeout(() => location.assign(dest), 400);
      });
  }

  // ── Problemas ──────────────────────────────────────────────────────────
  function showProblem(kind: "declined" | "expired" | "failed") {
    const ctr = make("div", "os-pw-ctr");
    ctr.setAttribute("role", "alert");
    const titles = { declined: t.declinedTitle, expired: t.expiredTitle, failed: t.failedTitle };
    const texts = { declined: t.declinedText, expired: t.expiredText, failed: t.failedText };
    ctr.append(
      make("p", `os-pw-ic ${kind === "declined" ? "os-pw-bad" : "os-pw-warn"}`, kind === "declined" ? "✕" : "!"),
      make("h3", "os-pw-h", titles[kind]),
      make("p", "os-pw-txt", texts[kind]),
    );
    const card = buyer ? buyer.metodo === "card" : chosen === "card";
    const label = kind === "declined" ? (card ? t.otherCard : t.again) : kind === "expired" ? t.regen : t.again;
    const go = button("os-pw-go", label, () => (buyer ? create() : showForm()));
    const nodes: Node[] = [ctr, go];
    const change = changeLink();
    if (change) nodes.push(change);
    render("problem", nodes, go);
  }

  function showError(code: PayError, retry: (() => void) | null) {
    const msg =
      code === "rede"
        ? t.errNetwork
        : code === "indisponivel"
          ? t.errUnavailable
          : code === "limite"
            ? t.errLimit
            : code === "invalido"
              ? t.errInvalid
              : t.errConfig;
    const ctr = make("div", "os-pw-ctr");
    ctr.setAttribute("role", "alert");
    ctr.append(make("p", "os-pw-ic os-pw-warn", "!"), make("p", "os-pw-txt", msg));
    const again = button("os-pw-go", t.again, () => (retry ? retry() : showForm()));
    const nodes: Node[] = [ctr, again];
    // Na prévia, o código ajuda você a achar o problema (o comprador nunca vê).
    if (sim) nodes.push(make("p", "os-pw-sim", `Prévia: o servidor de pagamento respondeu “${code}”.`));
    render("error", nodes, again);
  }

  // ── Abrir e fechar ─────────────────────────────────────────────────────
  function open(trigger: Element | null) {
    if (!root) build();
    const r = root as HTMLDivElement;
    accent = accentOf(trigger);
    r.style.setProperty("--os-pw-a", accent);
    r.style.setProperty("--os-pw-on", onAccent(accent));
    back = document.activeElement as HTMLElement | null;
    let resume = step === "spei" || step === "confirming";
    if (!oldSpei && !paidDone) {
      const old = loadOrder(endpoint, oldKey, product.valor, product.moeda);
      if (old && old.metodo === "spei") oldSpei = old;
    }
    if (step === "changeSpei") {
      // Fechou na pergunta: volta aos dados do SPEI (que segue conferido).
      showSpei();
      resume = true;
    }
    if (!step) {
      const saved = loadOrder(endpoint, key, product.valor, product.moeda);
      if (saved) {
        order = saved;
        if (saved.metodo === "spei") showSpei();
        else showConfirming();
        resume = true;
      } else showForm();
    }
    r.hidden = false;
    visible = true;
    html.classList.add("os-pw-open");
    document.addEventListener("keydown", onKey, true);
    // Foco no título da janela (o leitor de tela lê o produto e o valor; no
    // celular o teclado não sobe sozinho). Tab segue para os campos.
    const title = box.querySelector<HTMLElement>(".os-pw-n");
    if (title) {
      title.setAttribute("tabindex", "-1");
      title.focus();
    }
    // SPEI aberto ou cartão já enviado: confere o status na hora.
    if (resume) poll(0);
    if (oldSpei) pollOld(0);
  }

  function close() {
    if (!root || !visible) return;
    root.hidden = true;
    visible = false;
    stopPoll();
    stopOld();
    html.classList.remove("os-pw-open");
    document.removeEventListener("keydown", onKey, true);
    // biome-ignore lint/complexity/useOptionalChain: "?." vira código maior no script das páginas (Safari 13).
    if (back && back.focus) back.focus();
  }

  return { open: open, close: close } as PayWindow;
}
