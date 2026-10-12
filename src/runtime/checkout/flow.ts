/**
 * Pagamento da página de checkout, no lugar do formulário (a página não muda
 * de endereço): cobrança criada no endpoint (o servidor calcula o total com os
 * preços salvos) →
 * - PIX: QR Code (a imagem do gateway, ou gerado aqui do código "copia e
 *   cola"), o código com "Copiar código", o tempo para expirar e "Aguardando
 *   o pagamento…", que confere sozinho a cada poucos segundos (com recuo; e na
 *   hora em que a pessoa volta do app do banco para a aba). Expirou → "Gerar
 *   novo PIX"; recusado/cancelado → mensagem e "Tentar de novo";
 * - Kyvo (peso, euro, dólar): SPEI com os dados da transferência, ou o
 *   formulário de cartão/Bizum/MB WAY do SDK hospedado da Kyvo (o mesmo
 *   carregador da janela de pagamento; o onSuccess não é pagamento: confere o
 *   status);
 * - aprovado → "Pagamento aprovado!", Purchase (uma vez por pedido) e a
 *   página de obrigado com ?pedido= (o bloco "Acesso ao produto" libera o
 *   produto e os bumps comprados).
 * A cobrança aberta fica guardada (./store, sem dados pessoais): recarregar
 * volta para ela. Na tela do PIX e do SPEI dá para voltar ao formulário
 * (corrigir os dados, marcar um bump, trocar o frete ou a forma de pagamento):
 * pede confirmação (quem já pagou espera) e a cobrança deixada de lado
 * continua sendo conferida até vencer (OLD_SLOT) — paga mesmo assim, aparece
 * o aprovado. A validade é contada pelo relógio do servidor (`agora` nas
 * respostas): com o aparelho adiantado, o PIX não "vence" antes da hora. Na
 * prévia (simulacao) nada é cobrado e aparecem os botões de simular
 * aprovado/recusado/expirado (para você, em português).
 */
import {
  CHECKOUT_POLL_MAX_MS,
  CHECKOUT_POLL_MS,
  type CheckoutCreateResponse,
  type CheckoutStatusResponse,
  type PublicCheckoutConfig,
} from "@/lib/checkout/contract";
import type { CheckoutFixedTexts } from "@/lib/checkout/texts";
import { checkoutMoney } from "@/lib/checkout/texts";
import { type CardInstructions, isAllowedSdkUrl, ORDER_PARAM } from "@/lib/payments/contract";
import { type PayError, postPayment } from "../payments/api";
import { payMetadata, trackingInfo } from "../payments/meta";
import { loadSdk } from "../payments/sdk";
import { formatDate, type PayTexts, payTexts, SIM_TEXTS } from "../payments/texts";
import { copyText } from "../widgets/copy";
import type { BuyerData, CheckoutForm } from "./form";
import { qrSvg } from "./qr";
import {
  type CheckoutItem,
  dropOpen,
  loadOpen,
  markPurchase,
  OLD_SLOT,
  type OpenCheckout,
  openValid,
  purchaseSent,
  saveOpen,
  storedPix,
} from "./store";

/** Controles da simulação (só na prévia do Offer Studio): para você, em português. */
export const CHECKOUT_SIM_TEXTS = {
  approve: SIM_TEXTS.approve,
  decline: SIM_TEXTS.decline,
  expire: "Simular PIX expirado",
  expireSpei: SIM_TEXTS.expire,
  note: "Prévia do Offer Studio: este PIX é de exemplo (nenhum banco consegue pagar). Simule o resultado:",
  noteKyvo: "Prévia do Offer Studio: nada é cobrado e estes dados são de exemplo. Simule o resultado:",
  realNote: SIM_TEXTS.realNote,
  noThanks: SIM_TEXTS.noThanks,
  documentPreview:
    "Na prévia de uma página só, o checkout não vai para a página de obrigado. Use “Ver página” da oferta ou “Ver checkout” em Links e checkouts.",
};

/** Imagem do QR que o gateway mandou e que a página aceita (só imagem em base64). */
const QR_IMAGE_RE = /^data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+$/;

/** Depois de quanto tempo em "Confirmando…" (cartão) aparece "Tentar de novo". */
const STUCK_MS = 120_000;
/** Vencido no relógio do servidor e ainda pendente: depois desta folga a tela dá o PIX por vencido. */
const EXPIRED_GRACE_MS = 120_000;

interface CardSdk {
  mount(opts: Record<string, unknown>): unknown;
}

interface TrackingApi {
  settled?: (ms: number) => Promise<void>;
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

/** Evento para os pixels (src/runtime/tracking/purchase.ts: InitiateCheckout, AddPaymentInfo, Purchase). */
export function trackCheckout(
  std: "INITIATE_CHECKOUT" | "ADD_PAYMENT_INFO" | "PURCHASE",
  id: string,
  cents: number,
  currency: string,
  items: CheckoutItem[],
) {
  const contents = items.map((i) => ({
    id: i.id,
    content_id: i.id,
    content_name: i.nome,
    quantity: 1,
    item_price: i.valor / 100,
    price: i.valor / 100,
  }));
  const detail = {
    std: std,
    id: id,
    value: cents / 100,
    currency: currency,
    x: {
      content_type: "product",
      content_ids: items.map((i) => i.id),
      content_name: items[0] ? items[0].nome : "",
      num_items: items.length,
      contents: contents,
      items: items.map((i) => ({ item_id: i.id, item_name: i.nome, price: i.valor / 100, quantity: 1 })),
    },
  };
  try {
    document.dispatchEvent(new CustomEvent("os:purchase", { detail: detail }));
  } catch {
    // sem CustomEvent: segue sem o evento
  }
}

/** Id curto para o eventID do InitiateCheckout e do AddPaymentInfo. */
export function eventId(prefix: string): string {
  let out = prefix;
  for (let i = 0; i < 16; i++) out += "abcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(Math.random() * 36));
  return out;
}

export interface CheckoutFlow {
  /** Paga com os dados conferidos do formulário. */
  start(buyer: BuyerData): void;
  /** Volta para a cobrança guardada (recarregou a página com o PIX aberto). true = voltou. */
  resume(): boolean;
}

export function createFlow(
  cfg: PublicCheckoutConfig,
  endpoint: string,
  form: CheckoutForm,
  formEl: HTMLFormElement,
  panel: HTMLElement,
  fx: CheckoutFixedTexts,
  announce: (text: string) => void,
): CheckoutFlow {
  const pt: PayTexts = payTexts(cfg.idioma);
  const sim = cfg.simulacao === true;
  const money = (cents: number, currency?: string) => checkoutMoney(cents, currency || cfg.moeda, cfg.idioma);
  let order: OpenCheckout | null = null;
  let buyer: BuyerData | null = null;
  let turn = 0;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let clockTimer: ReturnType<typeof setInterval> | undefined;
  let polls = 0;
  let fails = 0;
  let paidDone = false;
  let confirmAt = 0;
  let stuckBox: HTMLElement | null = null;
  let mounted: unknown = null;
  /** Cobrança deixada de lado (trocou de dados ou de forma de pagamento): conferida até vencer. */
  const oldKey = cfg.chave + OLD_SLOT;
  let old: OpenCheckout | null = null;
  let oldTimer: ReturnType<typeof setTimeout> | undefined;
  let oldPolls = 0;

  // ── Telas ──────────────────────────────────────────────────────────────
  function show(nodes: Node[], focus?: HTMLElement | null) {
    turn++;
    stopClock();
    panel.textContent = "";
    for (const n of nodes) panel.appendChild(n);
    formEl.hidden = true;
    panel.hidden = false;
    const target = focus || panel;
    try {
      target.focus({ preventScroll: true });
    } catch {
      target.focus();
    }
    // Abaixo da faixa fixa do cronômetro (a altura dela fica no scroll-padding-top do <html>).
    const pad = Number.parseFloat(document.documentElement.style.scrollPaddingTop) || 0;
    const top = panel.getBoundingClientRect().top + window.pageYOffset - pad - 16;
    if (Math.abs(window.pageYOffset - top) > 40) window.scrollTo(0, Math.max(0, top));
  }

  function backToForm(message?: string) {
    turn++;
    stopPoll();
    stopClock();
    unmount();
    panel.hidden = true;
    panel.textContent = "";
    formEl.hidden = false;
    form.busy(false);
    form.alert(message || "");
    showOldNote();
    const btn = formEl.querySelector<HTMLElement>("[data-osc-pay]");
    if (btn) {
      try {
        btn.focus({ preventScroll: false });
      } catch {
        btn.focus();
      }
    }
  }

  function stopPoll() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = undefined;
  }

  function stopClock() {
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = undefined;
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
    dropOpen(endpoint, cfg.chave);
    order = null;
    stopPoll();
    unmount();
  }

  /** Agora no relógio do servidor (a validade é dele); sem a diferença, o do aparelho. */
  function serverNow(o: OpenCheckout | null): number {
    return Date.now() + (o && typeof o.skew === "number" ? o.skew : 0);
  }

  /** Guarda a diferença entre o relógio do servidor (`agora` da resposta) e o do aparelho. */
  function syncClock(o: OpenCheckout, agora: unknown, slot: string) {
    if (typeof agora !== "number" || !Number.isFinite(agora) || agora <= 0) return;
    const skew = Math.round(agora - Date.now());
    const changed = typeof o.skew !== "number" || Math.abs(o.skew - skew) > 5000;
    o.skew = skew;
    if (changed) saveOpen(endpoint, slot, o);
  }

  /** Validade (ms) da cobrança, ou NaN. */
  function expiryOf(o: OpenCheckout): number {
    const iso = o.pix ? o.pix.expiraEm : o.spei ? o.spei.expiraEm : null;
    return iso ? Date.parse(iso) : Number.NaN;
  }

  // ── Cobrança anterior (trocou de dados ou de forma de pagamento) ─────────
  function stopOld() {
    if (oldTimer) clearTimeout(oldTimer);
    oldTimer = undefined;
  }

  function dropOld() {
    stopOld();
    old = null;
    dropOpen(endpoint, oldKey);
    hideOldNote();
  }

  /** Deixa a cobrança de lado, ainda conferida (a anterior a ela, se houver, sai). */
  function keepAsOld(o: OpenCheckout) {
    stopOld();
    old = o;
    oldPolls = 0;
    saveOpen(endpoint, oldKey, o);
    pollOld(CHECKOUT_POLL_MS);
  }

  function pollOld(delay: number) {
    stopOld();
    if (!old || paidDone) return;
    oldTimer = setTimeout(checkOld, delay);
  }

  function checkOld() {
    oldTimer = undefined;
    const o = old;
    if (!o) return;
    // Passou da validade (+ a folga da memória): nada mais a conferir.
    if (!openValid(o)) {
      dropOld();
      return;
    }
    postPayment<CheckoutStatusResponse>(endpoint, {
      acao: "checkout_status",
      pedido: o.pedido,
      checkout: cfg.chave,
    }).then((r) => {
      if (old !== o || paidDone) return;
      if (!r.ok) {
        if (r.erro === "nao_encontrado") dropOld();
        else pollOld(CHECKOUT_POLL_MAX_MS);
        return;
      }
      syncClock(o, r.agora, oldKey);
      if (r.pago || r.status === "paid") {
        dropOld();
        // Pagou a cobrança anterior: ela vale (a atual, se houver, fica para trás e vence sozinha).
        forget();
        paid(r, o.itens);
        return;
      }
      if (r.status === "pending") {
        oldPolls++;
        pollOld(oldPolls <= 20 ? CHECKOUT_POLL_MS * 2 : CHECKOUT_POLL_MAX_MS);
        return;
      }
      dropOld();
    });
  }

  /** No formulário: "ainda conferimos o PIX anterior" + voltar para ele. */
  function showOldNote() {
    hideOldNote();
    const o = old;
    if (!o || formEl.hidden) return;
    const isSpei = o.metodo === "spei";
    const box = make("div", "osc-old");
    box.setAttribute("data-osc-old", "");
    const show = button("osc-link", isSpei ? pt.oldSpeiShow : fx.pixOldShow, restoreOld);
    box.append(make("p", "osc-note", isSpei ? pt.oldSpeiNote : fx.pixOldNote), show);
    const pay = formEl.querySelector("[data-osc-pay]");
    // biome-ignore lint/complexity/useOptionalChain: "?." vira código maior no script (Safari 13).
    if (pay && pay.parentNode) pay.parentNode.insertBefore(box, pay);
    else formEl.appendChild(box);
  }

  function hideOldNote() {
    const note = formEl.querySelector("[data-osc-old]");
    // biome-ignore lint/complexity/useOptionalChain: "?." vira código maior no script (Safari 13).
    if (note && note.parentNode) note.parentNode.removeChild(note);
  }

  /** "Ver o PIX anterior": volta para a cobrança deixada de lado (se ainda vale). */
  function restoreOld() {
    const o = old;
    stopOld();
    old = null;
    dropOpen(endpoint, oldKey);
    hideOldNote();
    if (!openValid(o)) {
      backToForm();
      return;
    }
    forget();
    order = o;
    saveOpen(endpoint, cfg.chave, o);
    form.select(o.bumps || [], o.frete || null, o.metodo);
    if (o.metodo === "spei") showSpei();
    else showPix(null);
    poll(0);
  }

  // ── Trocar de dados ou de forma de pagamento com o PIX/SPEI aberto ───────
  /** Botão da tela do PIX/SPEI que volta ao formulário (com confirmação). */
  function changeButton(spei: boolean) {
    const label = spei ? (cfg.metodos.length > 1 ? pt.change : fx.editData) : fx.pixChange;
    const b = button("osc-copy osc-copy-big osc-alt", label, confirmChange);
    b.setAttribute("data-osc-change", "");
    return b;
  }

  /** Quem já pagou não pode perder o pedido: pergunta antes de largar a cobrança. */
  function confirmChange() {
    const o = order;
    if (!o) return;
    stopPoll();
    const spei = o.metodo === "spei";
    const icon = make("p", "osc-ic osc-warn", "!");
    icon.setAttribute("aria-hidden", "true");
    const keep = button("osc-go", spei ? pt.keepWaiting : fx.pixKeep, () => {
      if (spei) showSpei();
      else showPix(null);
      poll(0);
    });
    const anyway = button("osc-copy osc-copy-big osc-alt", spei ? pt.changeAnyway : fx.pixChangeAnyway, () => {
      dropOpen(endpoint, cfg.chave);
      order = null;
      keepAsOld(o);
      // O formulário volta como estava (bumps, frete e forma de pagamento marcados).
      form.select(o.bumps || [], o.frete || null, o.metodo);
      backToForm();
    });
    anyway.setAttribute("data-osc-change-anyway", "");
    const title = spei ? pt.changeSpeiTitle : fx.pixChangeTitle;
    show(
      [icon, heading(title), make("p", "osc-note", spei ? pt.changeSpeiText : fx.pixChangeText), keep, anyway],
      keep,
    );
    announce(title);
  }

  function heading(text: string) {
    const h = make("h2", "osc-h", text);
    return h;
  }

  function simButtons(list: [string, "pago" | "recusado" | "expirado"][]) {
    const wrap = make("div");
    wrap.appendChild(
      make("p", "osc-sim", cfg.gateway === "pix" ? CHECKOUT_SIM_TEXTS.note : CHECKOUT_SIM_TEXTS.noteKyvo),
    );
    const row = make("div", "osc-simb");
    for (const item of list) row.appendChild(button("", item[0], () => simulate(item[1])));
    wrap.appendChild(row);
    return wrap;
  }

  /** Aviso de pagamento REAL na prévia (chave do gateway salva): para você, em pt-BR. */
  function realNote() {
    return make("p", "osc-sim", CHECKOUT_SIM_TEXTS.realNote);
  }

  /** Simular (prévia) OU avisar que o pagamento é real (prévia com chave salva). */
  function previewExtra(list: [string, "pago" | "recusado" | "expirado"][]): Node | null {
    if (order?.simulacao) return simButtons(list);
    if (cfg.testeReal) return realNote();
    return null;
  }

  function waiting(text: string) {
    const p = make("p", "osc-wait");
    p.setAttribute("role", "status");
    p.append(make("span", "osc-spin"), document.createTextNode(text));
    return p;
  }

  function errorText(code: PayError): string {
    const msg =
      code === "rede"
        ? fx.errNetwork
        : code === "limite"
          ? fx.errLimit
          : code === "invalido"
            ? fx.errInvalid
            : code === "recusado"
              ? fx.declined
              : fx.unavailable;
    // Na prévia, o código ajuda você a achar o problema (o comprador nunca vê).
    return sim || cfg.testeReal ? `${msg} (Prévia: o servidor de pagamento respondeu “${code}”.)` : msg;
  }

  // ── Cobrança ───────────────────────────────────────────────────────────
  /** Cobrança sendo criada: um segundo "Pagar" (Enter num campo, clique duplo) não cria outra. */
  let creating = false;

  function start(data: BuyerData) {
    if (creating) return;
    buyer = data;
    create();
  }

  function create() {
    if (creating) return;
    if (!buyer) {
      backToForm();
      return;
    }
    forget();
    paidDone = false;
    const metodo = form.metodo();
    const items = form.items();
    const bumps = form.bumps();
    const frete = form.frete();
    const creatingText = metodo === "pix" ? fx.pixCreating : pt.creating;
    form.busy(true, creatingText);
    // "Gerar novo PIX" / "Tentar de novo" (formulário escondido): a espera aparece no lugar.
    if (!panel.hidden) show([waiting(creatingText)]);
    const my = ++turn;
    let meta: Record<string, string> = {};
    try {
      meta = payMetadata(trackingInfo());
    } catch {
      meta = {};
    }
    const req: Record<string, unknown> = {
      acao: "checkout_criar",
      checkout: cfg.chave,
      metodo: metodo,
      nome: buyer.nome,
      email: buyer.email,
      quantidade: form.qtd(),
      bumps: bumps,
      frete: frete,
      metadata: meta,
    };
    if (buyer.telefone) req.telefone = buyer.telefone;
    if (buyer.documento) req.documento = buyer.documento;
    if (buyer.endereco) req.endereco = buyer.endereco;
    creating = true;
    postPayment<CheckoutCreateResponse>(endpoint, req).then((r) => {
      creating = false;
      if (my !== turn) return;
      if (!r.ok) {
        backToForm(errorText(r.erro));
        announce(errorText(r.erro));
        return;
      }
      const o: OpenCheckout = {
        v: 1,
        pedido: r.pedido,
        ext: r.pedidoExterno,
        metodo: r.metodo,
        valor: r.valor,
        moeda: r.moeda,
        at: Date.now(),
        itens: items,
        bumps: bumps,
        frete: frete,
      };
      if (r.simulacao) o.simulacao = 1;
      if (typeof r.agora === "number" && Number.isFinite(r.agora) && r.agora > 0)
        o.skew = Math.round(r.agora - Date.now());
      trackCheckout("ADD_PAYMENT_INFO", `${r.pedidoExterno}-pg`, r.valor, r.moeda, items);
      if (r.metodo === "pix" && r.pix && r.pix.codigo) {
        o.pix = storedPix(r.pix);
        order = o;
        saveOpen(endpoint, cfg.chave, o);
        showPix(r.pix.imagem);
        poll(CHECKOUT_POLL_MS);
      } else if (r.metodo === "spei" && r.spei) {
        o.spei = r.spei;
        order = o;
        saveOpen(endpoint, cfg.chave, o);
        showSpei();
        poll(CHECKOUT_POLL_MS);
      } else if (r.metodo !== "pix" && r.metodo !== "spei" && r.cartao) {
        order = o;
        showCard(r.cartao);
      } else backToForm(errorText("indisponivel"));
    });
  }

  // ── PIX ────────────────────────────────────────────────────────────────
  function showPix(image: string | null) {
    const o = order;
    if (!o || !o.pix) return;
    const pix = o.pix;
    const nodes: Node[] = [heading(fx.pixTitle)];
    const amount = make("p", "osc-amount");
    amount.append(make("small", "", fx.pixAmount), document.createTextNode(money(o.valor, o.moeda)));
    nodes.push(amount, make("p", "osc-note", fx.pixScan));
    const qr = make("div", "osc-qr");
    if (image && QR_IMAGE_RE.test(image)) {
      const img = make("img");
      img.src = image.replace(/\s+/g, "");
      img.alt = fx.pixTitle;
      img.width = 216;
      img.height = 216;
      qr.appendChild(img);
    } else {
      const svg = qrSvg(pix.codigo, fx.pixTitle);
      if (svg) qr.innerHTML = svg;
      else qr.hidden = true;
    }
    nodes.push(qr, make("p", "osc-note", fx.pixCopyLabel));
    const code = make("div", "osc-code");
    const input = make("input");
    input.readOnly = true;
    input.value = pix.codigo;
    input.setAttribute("aria-label", fx.pixCopyLabel);
    input.addEventListener("focus", () => input.select());
    const copy = button("osc-copy", fx.pixCopy, () => copyText(pix.codigo, copy, fx.pixCopied, pt.copyFail));
    copy.setAttribute("data-osc-copy", "");
    code.append(input, copy);
    nodes.push(code);
    const exp = make("p", "osc-exp");
    const clock = make("b");
    if (pix.expiraEm) {
      exp.append(document.createTextNode(`${fx.pixExpiresIn} `), clock);
      nodes.push(exp);
    }
    nodes.push(make("p", "osc-steps", fx.pixSteps), waiting(fx.pixWaiting), changeButton(false));
    const extra = previewExtra([
      [CHECKOUT_SIM_TEXTS.approve, "pago"],
      [CHECKOUT_SIM_TEXTS.decline, "recusado"],
      [CHECKOUT_SIM_TEXTS.expire, "expirado"],
    ]);
    if (extra) nodes.push(extra);
    show(nodes, copy);
    announce(fx.pixWaiting);
    if (pix.expiraEm) startClock(o, pix.expiraEm, clock, exp);
  }

  function startClock(o: OpenCheckout, iso: string, clock: HTMLElement, line: HTMLElement) {
    const end = Date.parse(iso);
    if (Number.isNaN(end)) return;
    const my = turn;
    const tick = () => {
      if (my !== turn) return;
      const left = Math.max(0, Math.round((end - serverNow(o)) / 1000));
      // Sem a hora do servidor e já "vencido" no relógio do aparelho: o relógio dele está errado.
      if (!left && typeof o.skew !== "number") {
        line.hidden = true;
        stopClock();
        return;
      }
      const h = Math.floor(left / 3600);
      const m = Math.floor((left % 3600) / 60);
      const s = left % 60;
      clock.textContent = `${h ? `${h}:` : ""}${h && m < 10 ? "0" : ""}${m < 10 && !h ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
      if (!left) {
        stopClock();
        // Venceu: confere uma última vez (alguém pode ter pago no último segundo).
        poll(0);
      }
    };
    tick();
    clockTimer = setInterval(tick, 1000);
  }

  // ── Kyvo: SPEI ─────────────────────────────────────────────────────────
  function copyRow(label: string, value: string, copyValue: string | null) {
    const row = make("div", "osc-r");
    const wrap = make("div");
    wrap.append(make("dt", "", label), make("dd", "", value));
    row.appendChild(wrap);
    if (copyValue) {
      const b = button("", pt.copy, () => copyText(copyValue, b, pt.copied, pt.copyFail));
      b.setAttribute("aria-label", `${pt.copy}: ${label}`);
      row.appendChild(b);
    }
    return row;
  }

  function changeLink() {
    return cfg.metodos.length > 1
      ? button("osc-go", pt.change, () => {
          forget();
          backToForm();
        })
      : null;
  }

  function showSpei() {
    const o = order;
    if (!o || !o.spei) return;
    const s = o.spei;
    const amount = make("p", "osc-amount");
    amount.append(make("small", "", pt.amount), document.createTextNode(money(o.valor, o.moeda)));
    const rows = make("dl", "osc-rows");
    rows.append(
      copyRow(pt.clabe, s.clabe.replace(/(\d{3})(\d{3})(\d{11})(\d)/, "$1 $2 $3 $4"), s.clabe),
      copyRow(pt.bank, s.banco, s.banco),
      copyRow(pt.holder, s.titular, s.titular),
      copyRow(pt.amount, money(o.valor, o.moeda), (o.valor / 100).toFixed(2)),
    );
    if (s.referencia) rows.appendChild(copyRow(pt.reference, s.referencia, s.referencia));
    const until = formatDate(s.expiraEm, cfg.idioma, o.moeda as "MXN");
    if (until) rows.appendChild(copyRow(pt.expires, until, null));
    const nodes: Node[] = [heading(pt.methods.spei[0]), amount, make("p", "osc-note", pt.speiIntro), rows];
    nodes.push(waiting(pt.waitSpei), make("p", "osc-note", pt.waitNote), changeButton(true));
    const extra = previewExtra([
      [CHECKOUT_SIM_TEXTS.approve, "pago"],
      [CHECKOUT_SIM_TEXTS.expireSpei, "expirado"],
    ]);
    if (extra) nodes.push(extra);
    show(nodes, rows.querySelector<HTMLElement>("button"));
    announce(pt.waitSpei);
  }

  // ── Kyvo: cartão, Bizum, MB WAY ────────────────────────────────────────
  function showCard(card: CardInstructions) {
    const o = order;
    if (!o) return;
    const m = o.metodo === "bizum" || o.metodo === "mb_way" ? o.metodo : "card";
    const box = make("div", "osc-cardbox");
    const amount = make("p", "osc-amount", money(o.valor, o.moeda));
    const nodes: Node[] = [heading(pt.methods[m][0]), amount, make("p", "osc-note", pt.cardIntro[m]), box];
    const fake = o.simulacao || !card.sdkUrl || (card.sessao && card.sessao.simulacao === true);
    if (fake) {
      box.appendChild(make("p", "osc-sim", SIM_TEXTS.cardBox));
      nodes.push(
        simButtons([
          [CHECKOUT_SIM_TEXTS.approve, "pago"],
          [CHECKOUT_SIM_TEXTS.decline, "recusado"],
        ]),
      );
    } else if (cfg.testeReal) {
      nodes.push(realNote());
    }
    const change = changeLink();
    if (change) nodes.push(change);
    show(nodes);
    if (fake) return;
    if (!isAllowedSdkUrl(card.sdkUrl)) {
      forget();
      backToForm(errorText("configuracao"));
      return;
    }
    box.appendChild(waiting(pt.loadingForm));
    const my = turn;
    loadSdk(card.sdkUrl).then((ok) => {
      if (my !== turn) return;
      const sdk = (window as unknown as { KyvoCard?: CardSdk }).KyvoCard;
      if (!ok || !sdk || typeof sdk.mount !== "function") {
        forget();
        backToForm(errorText(ok ? "indisponivel" : "rede"));
        return;
      }
      box.textContent = "";
      try {
        mounted = sdk.mount({
          container: box,
          // A sessão vai inteira, como veio do gateway (uso único).
          session: card.sessao,
          locale: cfg.idioma,
          appearance: { accent: cfg.cor, radius: 12 },
          onSuccess: () => {
            if (my !== turn || !order) return;
            // "Tentativa aceita", ainda não é pagamento: confere o status.
            order.enviado = 1;
            saveOpen(endpoint, cfg.chave, order);
            showConfirming();
            poll(1500);
          },
          onError: () => {
            if (my !== turn) return;
            forget();
            showProblem("declined", "card");
          },
        });
      } catch {
        forget();
        backToForm(errorText("indisponivel"));
      }
    });
  }

  function showConfirming() {
    const ctr = make("div");
    ctr.append(heading(pt.confirming), make("p", "osc-note", pt.confirmingNote), waiting(pt.confirming));
    const stuck = make("div");
    stuck.hidden = true;
    stuck.append(
      make("p", "osc-note", pt.stuck),
      button("osc-go", pt.again, () => {
        forget();
        create();
      }),
    );
    stuckBox = stuck;
    confirmAt = Date.now();
    const nodes: Node[] = [ctr, stuck];
    if (order?.simulacao) {
      nodes.push(
        simButtons([
          [CHECKOUT_SIM_TEXTS.approve, "pago"],
          [CHECKOUT_SIM_TEXTS.decline, "recusado"],
        ]),
      );
    }
    show(nodes);
    announce(pt.confirming);
  }

  // ── Simulação (prévia) ─────────────────────────────────────────────────
  function simulate(resultado: "pago" | "recusado" | "expirado") {
    const o = order;
    if (!o) return;
    const my = turn;
    postPayment<CheckoutStatusResponse>(endpoint, { acao: "simular", pedido: o.pedido, resultado: resultado }).then(
      (r) => {
        if (my !== turn) return;
        if (!r.ok) {
          backToForm(errorText(r.erro));
          return;
        }
        poll(0);
      },
    );
  }

  // ── Status ─────────────────────────────────────────────────────────────
  function poll(delay: number) {
    stopPoll();
    if (!order || paidDone) return;
    pollTimer = setTimeout(check, delay);
  }

  /** Próxima consulta: a cada 3 s no primeiro minuto, depois cada vez mais devagar (até 15 s). */
  function nextDelay() {
    polls++;
    if (polls <= 20) return CHECKOUT_POLL_MS;
    return Math.min(CHECKOUT_POLL_MAX_MS, Math.round(CHECKOUT_POLL_MS * 1.15 ** (polls - 20)));
  }

  function check() {
    pollTimer = undefined;
    const o = order;
    if (!o) return;
    const my = turn;
    postPayment<CheckoutStatusResponse>(endpoint, {
      acao: "checkout_status",
      pedido: o.pedido,
      checkout: cfg.chave,
    }).then((r) => {
      if (order !== o || (my !== turn && !(r.ok && r.pago))) return;
      if (!r.ok) {
        if (r.erro === "nao_encontrado") {
          forget();
          showProblem("expired");
          return;
        }
        fails++;
        poll(Math.min(20000, CHECKOUT_POLL_MS * (fails + 1)));
        return;
      }
      fails = 0;
      syncClock(o, r.agora, cfg.chave);
      if (r.pago || r.status === "paid") {
        paid(r);
        return;
      }
      if (r.status === "pending") {
        if (stuckBox && confirmAt && Date.now() - confirmAt > STUCK_MS) stuckBox.hidden = false;
        // PIX vencido no relógio DO SERVIDOR e ainda pendente: o gateway vai cancelar. Só com a hora
        // do servidor (o relógio do aparelho pode estar adiantado); e a cobrança segue conferida à
        // parte até sair da memória (quem pagou no último minuto ainda recebe a confirmação).
        const exp = o.pix ? expiryOf(o) : Number.NaN;
        if (!Number.isNaN(exp) && typeof o.skew === "number" && serverNow(o) > exp + EXPIRED_GRACE_MS) {
          dropOpen(endpoint, cfg.chave);
          order = null;
          stopPoll();
          keepAsOld(o);
          showProblem("expired");
          return;
        }
        poll(nextDelay());
        return;
      }
      forget();
      if (r.status === "expired") showProblem("expired", o.metodo);
      else showProblem("declined", o.metodo);
    });
  }

  /** Endereço da página de obrigado com o pedido (null = sem página de obrigado). */
  function thanksUrl(pedido: string): string | null {
    const dest = cfg.obrigado;
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

  function paid(r: CheckoutStatusResponse, paidItems?: CheckoutItem[]) {
    if (paidDone) return;
    paidDone = true;
    const items = paidItems || (order ? order.itens : form.items());
    forget();
    // Pago: a outra cobrança (se houver) para de ser conferida — fica no gateway e vence sozinha.
    if (old) dropOld();
    document.documentElement.classList.add("os-pago");
    // O mesmo pedido nunca conta duas vezes (recarregar, voltar do banco, outra aba).
    if (!purchaseSent(r.pedidoExterno)) {
      markPurchase(r.pedidoExterno);
      trackCheckout("PURCHASE", r.pedidoExterno, r.valor, r.moeda, items);
    }
    const dest = thanksUrl(r.pedido);
    const ok = make("p", "osc-ic osc-ok", "✓");
    ok.setAttribute("aria-hidden", "true");
    const nodes: Node[] = [ok, heading(fx.approved), make("p", "osc-note", dest ? fx.redirecting : fx.approvedStay)];
    if (dest) {
      const a = make("a", "osc-go", pt.continue);
      a.href = dest;
      nodes.push(a);
    } else if (sim) {
      nodes.push(
        make("p", "osc-sim", cfg.obrigado === "#" ? CHECKOUT_SIM_TEXTS.documentPreview : CHECKOUT_SIM_TEXTS.noThanks),
      );
    }
    show(nodes);
    announce(fx.approved);
    if (!dest) return;
    const api = (window as unknown as { __osTracking?: TrackingApi }).__osTracking;
    const settled = api && typeof api.settled === "function" ? api.settled(1200) : Promise.resolve();
    // O Purchase sai antes de trocar de página (no máximo ~1,5 s de espera).
    settled
      .catch(() => {})
      .then(() => {
        setTimeout(() => location.assign(dest), 500);
      });
  }

  // ── Problemas ──────────────────────────────────────────────────────────
  function showProblem(kind: "declined" | "expired", method?: string) {
    const isPix = cfg.gateway === "pix";
    const icon = make("p", `osc-ic ${kind === "declined" ? "osc-bad" : "osc-warn"}`, kind === "declined" ? "✕" : "!");
    icon.setAttribute("aria-hidden", "true");
    const title =
      kind === "expired" ? (isPix ? fx.pixExpired : pt.expiredTitle) : isPix ? fx.declined : pt.declinedTitle;
    const nodes: Node[] = [icon, heading(title)];
    if (!isPix) nodes.push(make("p", "osc-note", kind === "expired" ? pt.expiredText : pt.declinedText));
    const label =
      kind === "expired" ? (isPix ? fx.pixNew : pt.regen) : method === "card" && !isPix ? pt.otherCard : fx.tryAgain;
    // Com os dados na memória (mesma visita), gera de novo na hora; senão (recarregou a página),
    // volta ao formulário — e o botão diz isso.
    const again = button("osc-go", buyer ? label : fx.fillAgain, () => (buyer ? create() : backToForm()));
    nodes.push(again);
    if (buyer)
      nodes.push(button("osc-copy osc-copy-big", cfg.metodos.length > 1 ? pt.change : fx.editData, () => backToForm()));
    show(nodes, again);
    announce(title);
  }

  // ── Voltar para a cobrança guardada ────────────────────────────────────
  function resume(): boolean {
    const saved = loadOpen(endpoint, cfg.chave);
    if (!saved) {
      showOldNote();
      return false;
    }
    order = saved;
    form.select(saved.bumps || [], saved.frete || null, saved.metodo);
    if (saved.metodo === "pix") showPix(null);
    else if (saved.metodo === "spei") showSpei();
    else showConfirming();
    poll(0);
    return true;
  }

  // Cobrança deixada de lado numa visita anterior: continua sendo conferida.
  old = loadOpen(endpoint, oldKey);
  if (old) pollOld(0);

  // Voltou do app do banco para a aba: confere na hora.
  const wake = () => {
    if (paidDone || document.visibilityState === "hidden") return;
    if (order && pollTimer) poll(0);
    if (old && oldTimer) pollOld(0);
  };
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("focus", wake);
  window.addEventListener("online", wake);

  return { start: start, resume: resume };
}
