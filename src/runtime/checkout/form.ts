/**
 * Formulário da página de checkout: máscaras (telefone, CPF, CEP), validação
 * em pt/es/en com o erro embaixo de cada campo (aria-invalid + aria-describedby;
 * foco no primeiro erro, nada de recarregar), CEP preenchendo o endereço pela
 * BrasilAPI (tempo limite curto: se falhar, a pessoa digita tudo), frete,
 * order bumps e forma de pagamento — com o resumo e o total na hora.
 *
 * O total da tela é só para quem compra ver: o servidor recalcula com os
 * preços salvos (o navegador manda só os ids).
 */
import type { CheckoutAddress, CheckoutPayMethod, PublicCheckoutConfig } from "@/lib/checkout/contract";
import {
  formatBrPhone,
  formatCep,
  formatCpf,
  isValidBrPhone,
  isValidCep,
  isValidCpf,
  isValidEmail,
  isValidFullName,
  isValidIntlPhone,
  isValidUf,
  onlyDigits,
} from "@/lib/checkout/fields";
import { type CheckoutFixedTexts, checkoutMoney } from "@/lib/checkout/texts";
import type { CheckoutItem } from "./store";

/** Endereço público da BrasilAPI (CEP → rua, bairro, cidade, UF). Sem chave, com CORS. */
export const BRASIL_API_CEP = "https://brasilapi.com.br/api/cep/v2/";
const CEP_TIMEOUT_MS = 6000;

/** Dados de quem compra, como vão ao endpoint (só os campos pedidos). */
export interface BuyerData {
  nome: string;
  email: string;
  telefone?: string;
  documento?: string;
  endereco?: CheckoutAddress;
}

export interface CheckoutForm {
  /** Ids dos bumps marcados. */
  bumps(): string[];
  frete(): string | null;
  metodo(): CheckoutPayMethod;
  /** Total da tela (centavos). */
  total(): number;
  /** Itens (produto + bumps marcados) para os pixels. */
  items(): CheckoutItem[];
  /** Marca de novo o que estava escolhido (cobrança guardada: o resumo volta igual). */
  select(bumps: string[], frete: string | null, metodo: string): void;
  /** Confere tudo: os dados, ou null (com os erros na tela e o foco no primeiro). */
  validate(): BuyerData | null;
  /** O botão de pagar ocupado (gerando o pagamento) ou livre. */
  busy(on: boolean, label?: string): void;
  /** Mensagem no fim do formulário ("" esconde). */
  alert(text: string): void;
}

type Field = HTMLInputElement | HTMLSelectElement;

function byName(form: HTMLFormElement, name: string): Field | null {
  return form.querySelector<Field>(`[name="${name}"]`);
}

/** Troca o valor mantendo o cursor depois do mesmo número de algarismos. */
function remask(input: HTMLInputElement, format: (v: string) => string) {
  const before = input.value;
  const caret = input.selectionStart === null ? before.length : input.selectionStart;
  const digitsBefore = onlyDigits(before.slice(0, caret)).length;
  const next = format(before);
  if (next === before) return;
  input.value = next;
  if (document.activeElement !== input) return;
  let pos = 0;
  for (let seen = 0; pos < next.length && seen < digitsBefore; pos++) if (/\d/.test(next.charAt(pos))) seen++;
  try {
    input.setSelectionRange(pos, pos);
  } catch {
    // tipo de campo sem seleção (email): segue
  }
}

export function setupForm(
  cfg: PublicCheckoutConfig,
  form: HTMLFormElement,
  fx: CheckoutFixedTexts,
  announce: (text: string) => void,
): CheckoutForm {
  const brl = cfg.moeda === "BRL";
  const money = (cents: number) => checkoutMoney(cents, cfg.moeda, cfg.idioma);
  const pix = cfg.gateway === "pix";
  const touched: Record<string, boolean> = {};
  const alertBox = form.querySelector<HTMLElement>("[data-osc-error]");
  const payBtn = form.querySelector<HTMLButtonElement>("[data-osc-pay]");
  const payLabel = form.querySelector<HTMLElement>("[data-osc-pay-label]");
  const payAmount = form.querySelector<HTMLElement>("[data-osc-pay-amount]");
  const linesBox = document.querySelector<HTMLElement>("[data-osc-lines]");
  const totalBox = document.querySelector<HTMLElement>("[data-osc-total]");
  const cepStatus = form.querySelector<HTMLElement>("[data-osc-cep-status]");
  const defaultLabel = payLabel ? payLabel.textContent || "" : "";

  // ── Erros ──────────────────────────────────────────────────────────────
  function setError(el: Field, msg: string) {
    const err = document.getElementById(`${el.id}-e`);
    if (err) {
      err.textContent = msg;
      err.hidden = !msg;
    }
    if (msg) {
      el.setAttribute("aria-invalid", "true");
      if (err) el.setAttribute("aria-describedby", err.id);
    } else {
      el.removeAttribute("aria-invalid");
      el.removeAttribute("aria-describedby");
    }
  }

  /** Erro do campo ("" = certo). */
  function problem(name: string, raw: string): string {
    const v = raw.trim();
    if (name === "complemento") return "";
    if (!v) return name === "nome" && pix ? fx.invalidName : fx.required;
    if (name === "nome") return (pix ? isValidFullName(v) : v.length >= 2 && /[^\d\s]/.test(v)) ? "" : fx.invalidName;
    if (name === "email") return isValidEmail(v) ? "" : fx.invalidEmail;
    if (name === "telefone") return (brl ? isValidBrPhone(v) : isValidIntlPhone(v)) ? "" : fx.invalidPhone;
    if (name === "documento") return (brl ? isValidCpf(v) : /^[A-Za-z0-9./-]{4,40}$/.test(v)) ? "" : fx.invalidCpf;
    if (name === "cep") return isValidCep(v) ? "" : fx.invalidCep;
    if (name === "uf") return isValidUf(v) ? "" : fx.required;
    return "";
  }

  const fieldNames = ["nome", "email", "telefone", "documento", "cep", "rua", "numero", "complemento", "bairro"];
  fieldNames.push("cidade", "uf");
  const fields: Field[] = [];
  for (const name of fieldNames) {
    const el = byName(form, name);
    if (el) fields.push(el);
  }

  const check = (el: Field) => {
    const msg = problem(el.name, el.value);
    setError(el, msg);
    return msg;
  };

  for (const el of fields) {
    el.addEventListener("blur", () => {
      if (el.value.trim()) touched[el.name] = true;
      if (touched[el.name]) check(el);
    });
    el.addEventListener("input", () => {
      // Errado e já mostrado: some assim que fica certo (sem reclamar a cada tecla).
      if (el.getAttribute("aria-invalid") === "true" && !problem(el.name, el.value)) setError(el, "");
      if (alertBox && !alertBox.hidden && !form.querySelector("[aria-invalid=true]")) alertBox.hidden = true;
    });
    if (el.tagName === "SELECT") el.addEventListener("change", () => check(el));
  }

  // ── Máscaras ───────────────────────────────────────────────────────────
  const masked = (name: string, format: (v: string) => string) => {
    const el = byName(form, name) as HTMLInputElement | null;
    if (el) el.addEventListener("input", () => remask(el, format));
  };
  if (brl) {
    masked("telefone", formatBrPhone);
    masked("documento", formatCpf);
  }
  masked("cep", formatCep);

  // ── CEP (BrasilAPI) ────────────────────────────────────────────────────
  const cep = byName(form, "cep") as HTMLInputElement | null;
  let lastCep = "";
  let cepTurn = 0;
  const AUTO_FIELDS = ["rua", "bairro", "cidade", "uf"];
  /**
   * Preenche com o que a busca achou ("" = a busca não achou: apaga). Só mexe
   * em campo vazio ou que uma busca anterior preencheu — o que a pessoa
   * digitou (ou corrigiu) fica: ao editar, o campo perde a marca da busca.
   */
  const fillAuto = (name: string, value: string) => {
    const el = byName(form, name);
    if (!el) return;
    const auto = el.getAttribute("data-osc-auto") === "1";
    if (el.value.trim() && !auto) return;
    if (!value) {
      // CEP novo que a busca não achou: o endereço do CEP anterior não pode ficar.
      if (auto) el.value = "";
      el.removeAttribute("data-osc-auto");
      return;
    }
    el.value = value;
    el.setAttribute("data-osc-auto", "1");
    setError(el, "");
  };
  for (const name of AUTO_FIELDS) {
    const el = byName(form, name);
    if (!el) continue;
    // Digitado pela pessoa (o valor posto pela busca não dispara estes eventos): a busca não troca mais.
    const mine = () => el.removeAttribute("data-osc-auto");
    el.addEventListener("input", mine);
    el.addEventListener("change", mine);
  }
  function lookupCep(digits: string) {
    const my = ++cepTurn;
    if (cepStatus) cepStatus.textContent = fx.cepSearching;
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = setTimeout(() => {
      if (ctrl) ctrl.abort();
    }, CEP_TIMEOUT_MS);
    const done = (found: Record<string, unknown> | null) => {
      clearTimeout(timer);
      if (my !== cepTurn) return;
      if (!found) {
        // Não achou (ou a BrasilAPI falhou): apaga o que veio do CEP anterior e a pessoa digita.
        for (const name of AUTO_FIELDS) fillAuto(name, "");
        if (cepStatus) cepStatus.textContent = fx.cepNotFound;
        announce(fx.cepNotFound);
        const street = byName(form, "rua");
        if (street && document.activeElement === cep && !street.value.trim()) street.focus();
        return;
      }
      if (cepStatus) cepStatus.textContent = "";
      const text = (k: string) => (typeof found[k] === "string" ? (found[k] as string).trim() : "");
      fillAuto("rua", text("street"));
      fillAuto("bairro", text("neighborhood"));
      fillAuto("cidade", text("city"));
      fillAuto("uf", text("state").toUpperCase());
      const next = byName(form, text("street") ? "numero" : "rua");
      if (next && document.activeElement === cep) next.focus();
    };
    fetch(BRASIL_API_CEP + digits, {
      signal: ctrl ? ctrl.signal : undefined,
      // Nada da página vai para a BrasilAPI (nem o endereço do checkout).
      referrerPolicy: "no-referrer",
      credentials: "omit",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (j) => done(j && typeof j === "object" ? (j as Record<string, unknown>) : null),
        () => done(null),
      );
  }
  if (cep) {
    cep.addEventListener("input", () => {
      const d = onlyDigits(cep.value);
      if (d.length === 8 && d !== lastCep && isValidCep(d)) {
        lastCep = d;
        lookupCep(d);
      } else if (d.length < 8 && cepStatus) {
        cepStatus.textContent = "";
        lastCep = "";
      }
    });
  }

  // ── Frete, bumps, forma de pagamento e total ───────────────────────────
  const radios = (name: string) => Array.from(form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`));
  const checked = (name: string) => {
    const list = radios(name);
    for (let i = 0; i < list.length; i++) if (list[i].checked) return list[i].value;
    return null;
  };
  const markOn = (input: HTMLInputElement) => {
    const label = input.closest("label");
    if (label) label.classList.toggle("osc-on", input.checked);
  };

  function bumps(): string[] {
    return radios("bump")
      .filter((b) => b.checked)
      .map((b) => b.value);
  }
  function frete(): string | null {
    return cfg.endereco ? checked("frete") || cfg.freteInicial : null;
  }
  function metodo(): CheckoutPayMethod {
    return (checked("metodo") || cfg.metodos[0]) as CheckoutPayMethod;
  }
  function shippingCents(): number {
    const id = frete();
    for (let i = 0; i < cfg.fretes.length; i++) if (cfg.fretes[i].id === id) return cfg.fretes[i].valor;
    return 0;
  }
  function total(): number {
    let sum = cfg.valor + shippingCents();
    const chosen = bumps();
    for (let i = 0; i < cfg.bumps.length; i++) if (chosen.indexOf(cfg.bumps[i].id) >= 0) sum += cfg.bumps[i].valor;
    return sum;
  }
  function items(): CheckoutItem[] {
    const out: CheckoutItem[] = [{ id: cfg.chave, nome: cfg.nome, valor: cfg.valor }];
    const chosen = bumps();
    for (let i = 0; i < cfg.bumps.length; i++) {
      const b = cfg.bumps[i];
      if (chosen.indexOf(b.id) >= 0) out.push({ id: `${cfg.chave}-${b.id}`, nome: b.titulo, valor: b.valor });
    }
    return out;
  }

  function line(label: string, value: string, free?: boolean) {
    const li = document.createElement("li");
    const a = document.createElement("span");
    a.textContent = label;
    const b = document.createElement("span");
    if (free) b.className = "osc-free";
    b.textContent = value;
    li.append(a, b);
    return li;
  }

  function refresh() {
    const chosen = bumps();
    if (linesBox) {
      linesBox.textContent = "";
      for (let i = 0; i < cfg.bumps.length; i++) {
        const b = cfg.bumps[i];
        if (chosen.indexOf(b.id) >= 0) linesBox.appendChild(line(b.titulo, money(b.valor)));
      }
      if (cfg.endereco && frete()) {
        const cents = shippingCents();
        linesBox.appendChild(line(fx.shipping, cents ? money(cents) : fx.shippingFree, !cents));
      }
      linesBox.hidden = !linesBox.children.length;
    }
    const sum = money(total());
    if (totalBox) totalBox.textContent = sum;
    if (payAmount) payAmount.textContent = sum;
  }

  for (const name of ["frete", "bump", "metodo"]) {
    for (const input of radios(name)) {
      input.addEventListener("change", () => {
        // Rádio: o que foi desmarcado também perde o destaque.
        for (const other of radios(name)) markOn(other);
        refresh();
      });
    }
  }
  refresh();

  function select(chosen: string[], shipping: string | null, method: string) {
    for (const b of radios("bump")) b.checked = chosen.indexOf(b.value) >= 0;
    for (const f of radios("frete")) if (shipping) f.checked = f.value === shipping;
    for (const m of radios("metodo")) m.checked = m.value === method || (!method && m.checked);
    for (const name of ["frete", "bump", "metodo"]) for (const input of radios(name)) markOn(input);
    refresh();
  }

  // ── Envio ──────────────────────────────────────────────────────────────
  function value(name: string): string {
    const el = byName(form, name);
    return el ? el.value.trim() : "";
  }

  function validate(): BuyerData | null {
    const bad: Field[] = [];
    for (const el of fields) {
      touched[el.name] = true;
      if (check(el)) bad.push(el);
    }
    if (bad.length) {
      showAlert(fx.fixErrors);
      bad[0].focus();
      const err = document.getElementById(`${bad[0].id}-e`);
      announce(err?.textContent || fx.fixErrors);
      return null;
    }
    showAlert("");
    const out: BuyerData = { nome: value("nome").replace(/\s+/g, " "), email: value("email").toLowerCase() };
    if (byName(form, "telefone")) out.telefone = onlyDigits(value("telefone"));
    if (byName(form, "documento")) out.documento = brl ? onlyDigits(value("documento")) : value("documento");
    if (cfg.endereco && byName(form, "cep")) {
      out.endereco = {
        cep: onlyDigits(value("cep")),
        rua: value("rua"),
        numero: value("numero"),
        complemento: value("complemento"),
        bairro: value("bairro"),
        cidade: value("cidade"),
        uf: value("uf").toUpperCase(),
      };
    }
    return out;
  }

  function showAlert(text: string) {
    if (!alertBox) return;
    alertBox.textContent = text;
    alertBox.hidden = !text;
  }

  function busy(on: boolean, label?: string) {
    if (!payBtn) return;
    payBtn.disabled = on;
    payBtn.setAttribute("aria-busy", on ? "true" : "false");
    if (payLabel) payLabel.textContent = on && label ? label : defaultLabel;
  }

  if (!cfg.metodos.length && payBtn) {
    payBtn.disabled = true;
    showAlert(fx.unavailable);
  }

  return { bumps, frete, metodo, total, items, select, validate, busy, alert: showAlert };
}
