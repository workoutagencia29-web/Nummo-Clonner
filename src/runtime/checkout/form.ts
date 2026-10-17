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
  isValidIntlPostal,
  isValidRegion,
  isValidUf,
  onlyDigits,
} from "@/lib/checkout/fields";
import { type CheckoutFixedTexts, checkoutMoney } from "@/lib/checkout/texts";
import type { CheckoutItem } from "./store";

/** Endereço público da BrasilAPI (CEP → rua, bairro, cidade, UF). Sem chave, com CORS. */
export const BRASIL_API_CEP = "https://brasilapi.com.br/api/cep/v2/";
const CEP_TIMEOUT_MS = 6000;

/** Domínios de e-mail sugeridos (os mais comuns no Brasil), em ordem de uso. */
export const EMAIL_DOMAINS = [
  "gmail.com",
  "hotmail.com",
  "outlook.com",
  "yahoo.com.br",
  "yahoo.com",
  "icloud.com",
  "hotmail.com.br",
  "bol.com.br",
  "uol.com.br",
  "live.com",
  "terra.com.br",
  "globo.com",
];

/**
 * Sugestões de e-mail para o autocomplete: "<o que a pessoa digitou>@" + os
 * domínios que começam com o que ela escreveu depois do "@". Máx. 6. Vazio
 * quando não há "@", quando há mais de um, ou quando o domínio já está completo.
 */
export function emailSuggestions(value: string): string[] {
  const v = String(value || "").trim();
  const at = v.indexOf("@");
  if (at < 1) return [];
  if (v.indexOf("@", at + 1) >= 0) return [];
  const local = v.slice(0, at);
  if (!/^[^\s@]+$/.test(local)) return [];
  const typed = v.slice(at + 1).toLowerCase();
  const matches = typed ? EMAIL_DOMAINS.filter((d) => d.indexOf(typed) === 0 && d !== typed) : EMAIL_DOMAINS.slice();
  return matches.slice(0, 6).map((d) => `${local}@${d}`);
}

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
  /** Quantidade do produto principal escolhida. */
  qtd(): number;
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

/**
 * Autocomplete de e-mail: conforme a pessoa digita, mostra "<o que escreveu>@"
 * + os domínios mais comuns (gmail, hotmail…). Clicar ou Enter preenche; setas
 * navegam; Esc fecha. Menos fricção = mais conversão. Caixa própria (nada de
 * <datalist>, que varia muito entre navegadores).
 */
function setupEmailSuggest(input: HTMLInputElement) {
  const wrap = input.closest(".osc-f");
  if (!wrap) return;
  wrap.classList.add("osc-f-ac");
  const box = document.createElement("div");
  box.className = "osc-ac";
  box.setAttribute("role", "listbox");
  box.hidden = true;
  wrap.appendChild(box);
  let items: string[] = [];
  let active = -1;

  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");

  function close() {
    if (box.hidden) return;
    box.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  }

  function choose(value: string) {
    input.value = value;
    close();
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function paint() {
    for (let i = 0; i < box.children.length; i++) {
      box.children[i].setAttribute("aria-selected", i === active ? "true" : "false");
    }
    if (active >= 0) input.setAttribute("aria-activedescendant", `osc-ac-${active}`);
    else input.removeAttribute("aria-activedescendant");
  }

  function open() {
    items = emailSuggestions(input.value);
    if (!items.length) return close();
    box.textContent = "";
    active = -1;
    for (let i = 0; i < items.length; i++) {
      const value = items[i];
      const opt = document.createElement("div");
      opt.className = "osc-ac-i";
      opt.id = `osc-ac-${i}`;
      opt.setAttribute("role", "option");
      opt.textContent = value;
      opt.addEventListener("mousedown", (e) => {
        e.preventDefault();
        choose(value);
      });
      box.appendChild(opt);
    }
    box.style.top = `${input.offsetTop + input.offsetHeight + 4}px`;
    box.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  input.addEventListener("input", open);
  input.addEventListener("focus", () => {
    if (input.value.indexOf("@") > 0) open();
  });
  input.addEventListener("blur", () => setTimeout(close, 150));
  input.addEventListener("keydown", (e) => {
    if (box.hidden || !items.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      active = (active + 1) % items.length;
      paint();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      active = (active - 1 + items.length) % items.length;
      paint();
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      choose(items[active]);
    } else if (e.key === "Escape") {
      close();
    }
  });
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
  const qtyNum = document.querySelector<HTMLElement>("[data-osc-qtd]");
  const shipBox = form.querySelector<HTMLElement>("[data-osc-ship]");
  const shipEmpty = form.querySelector<HTMLElement>("[data-osc-ship-empty]");
  // Rua/número/bairro/cidade/UF só aparecem depois do CEP (a BrasilAPI preenche o endereço).
  const addrBox = form.querySelector<HTMLElement>("[data-osc-addr]");
  const defaultLabel = payLabel ? payLabel.textContent || "" : "";
  // Quantidade do produto (1 a cfg.maxQtd) e se o frete já pode aparecer (depois do CEP).
  const maxQtd = cfg.maxQtd && cfg.maxQtd > 1 ? Math.floor(cfg.maxQtd) : 1;
  let qtd = 1;
  // Com endereço e opções de frete, o frete só conta depois do CEP (a tela pede o CEP antes).
  let shipReady = !(cfg.endereco && cfg.fretes.length);

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
    if (name === "cep") return (brl ? isValidCep(v) : isValidIntlPostal(v)) ? "" : fx.invalidCep;
    if (name === "uf") return (brl ? isValidUf(v) : isValidRegion(v)) ? "" : fx.required;
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

  /** Mostra o ✓ verde (campo preenchido e válido) — o validador visível, menos fricção. */
  function markValid(el: Field) {
    if (el.tagName !== "INPUT") return;
    const wrap = el.closest(".osc-f");
    if (wrap) wrap.classList.toggle("osc-valid", el.value.trim() !== "" && !problem(el.name, el.value));
  }

  for (const el of fields) {
    el.addEventListener("blur", () => {
      if (el.value.trim()) touched[el.name] = true;
      if (touched[el.name]) check(el);
    });
    el.addEventListener("input", () => {
      // Errado e já mostrado: some assim que fica certo (sem reclamar a cada tecla).
      if (el.getAttribute("aria-invalid") === "true" && !problem(el.name, el.value)) setError(el, "");
      if (alertBox && !alertBox.hidden && !form.querySelector("[aria-invalid=true]")) alertBox.hidden = true;
      markValid(el);
    });
    if (el.tagName === "SELECT") el.addEventListener("change", () => check(el));
    markValid(el);
  }

  // ── Máscaras ───────────────────────────────────────────────────────────
  const masked = (name: string, format: (v: string) => string) => {
    const el = byName(form, name) as HTMLInputElement | null;
    if (el) el.addEventListener("input", () => remask(el, format));
  };
  if (brl) {
    masked("telefone", formatBrPhone);
    masked("documento", formatCpf);
    // A máscara 00000-000 é só do CEP do Brasil (código postal estrangeiro tem letras).
    masked("cep", formatCep);
  }

  // ── Autocomplete de e-mail ───────────────────────────────────────────────
  const emailEl = byName(form, "email");
  if (emailEl && emailEl.tagName === "INPUT") setupEmailSuggest(emailEl as HTMLInputElement);

  // ── CEP / código postal ─────────────────────────────────────────────────
  const cep = byName(form, "cep") as HTMLInputElement | null;
  if (brl) {
    // No Brasil, a BrasilAPI preenche o endereço e o endereço/frete aparecem
    // depois de um CEP de 8 dígitos.
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
        markValid(el);
        return;
      }
      el.value = value;
      el.setAttribute("data-osc-auto", "1");
      setError(el, "");
      markValid(el);
    };
    for (const name of AUTO_FIELDS) {
      const el = byName(form, name);
      if (!el) continue;
      // Digitado pela pessoa (o valor posto pela busca não dispara estes eventos): a busca não troca mais.
      const mine = () => el.removeAttribute("data-osc-auto");
      el.addEventListener("input", mine);
      el.addEventListener("change", mine);
    }
    const lookupCep = (digits: string) => {
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
    };
    if (cep) {
      cep.addEventListener("input", () => {
        const d = onlyDigits(cep.value);
        if (d.length === 8 && isValidCep(d)) {
          // Com o CEP preenchido, mostra o endereço e as opções de frete (a BrasilAPI preenche o resto).
          revealAddress();
          revealShipping();
          if (d !== lastCep) {
            lastCep = d;
            lookupCep(d);
          }
        } else if (d.length < 8 && cepStatus) {
          cepStatus.textContent = "";
          lastCep = "";
        }
      });
      // CEP já preenchido ao abrir (preenchimento do navegador): mostra o endereço na hora.
      if (isValidCep(onlyDigits(cep.value))) {
        revealAddress();
        revealShipping();
      }
    }
  } else if (cep) {
    // Fora do real: sem busca automática. Os campos de endereço já aparecem (o
    // HTML não os esconde) e as opções de frete surgem quando a pessoa preenche
    // o código postal.
    const revealIfPostal = () => {
      if (isValidIntlPostal(cep.value.trim())) revealShipping();
    };
    cep.addEventListener("input", revealIfPostal);
    revealIfPostal();
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
    if (!cfg.endereco || !cfg.fretes.length) return null;
    // Antes do CEP o frete não conta (a tela mostra "Preencha seu CEP…").
    if (!shipReady) return null;
    return checked("frete") || cfg.freteInicial;
  }
  function metodo(): CheckoutPayMethod {
    return (checked("metodo") || cfg.metodos[0]) as CheckoutPayMethod;
  }
  function shippingCents(): number {
    const id = frete();
    for (let i = 0; i < cfg.fretes.length; i++) if (cfg.fretes[i].id === id) return cfg.fretes[i].valor;
    return 0;
  }
  /** Produto × quantidade + bumps marcados (sem o frete). */
  function subtotal(): number {
    let sum = cfg.valor * qtd;
    const chosen = bumps();
    for (let i = 0; i < cfg.bumps.length; i++) if (chosen.indexOf(cfg.bumps[i].id) >= 0) sum += cfg.bumps[i].valor;
    return sum;
  }
  function total(): number {
    return subtotal() + shippingCents();
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
      // "Subtotal" (produto × quantidade + bumps); a marca fica no valor para a tela acompanhar.
      const subLi = line(fx.subtotal, money(subtotal()));
      const subVal = subLi.lastChild as HTMLElement | null;
      if (subVal) subVal.setAttribute("data-osc-subtotal", "");
      linesBox.appendChild(subLi);
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

  // ── Quantidade ──────────────────────────────────────────────────────────
  function setQtd(next: number) {
    const v = next < 1 ? 1 : next > maxQtd ? maxQtd : next;
    if (v === qtd) return;
    qtd = v;
    if (qtyNum) qtyNum.textContent = String(qtd);
    refresh();
  }
  for (const btn of Array.from(document.querySelectorAll<HTMLElement>("[data-osc-qty]"))) {
    btn.addEventListener("click", () => setQtd(qtd + (btn.getAttribute("data-osc-qty") === "+" ? 1 : -1)));
  }

  // ── Endereço e frete revelados depois do CEP ─────────────────────────────
  /** Mostra os campos de endereço (rua, número, bairro, cidade, UF). */
  function revealAddress() {
    if (addrBox) addrBox.hidden = false;
  }
  function revealShipping() {
    if (shipReady) return;
    shipReady = true;
    if (shipBox) shipBox.hidden = false;
    if (shipEmpty) shipEmpty.hidden = true;
    refresh();
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
    // Pedido restaurado (cobrança aberta): se já havia frete escolhido, mostra endereço e opções.
    if (shipping) {
      revealAddress();
      revealShipping();
    }
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
      // Campo de endereço ainda escondido (sem CEP): não valida nem marca erro (a pessoa nem o vê).
      if (addrBox?.hidden && addrBox.contains(el)) continue;
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
      // No Brasil, CEP só com algarismos e UF em maiúsculas; fora, o código
      // postal e o estado vão como foram digitados (código postal pode ter letras).
      out.endereco = {
        cep: brl ? onlyDigits(value("cep")) : value("cep"),
        rua: value("rua"),
        numero: value("numero"),
        complemento: value("complemento"),
        bairro: value("bairro"),
        cidade: value("cidade"),
        uf: brl ? value("uf").toUpperCase() : value("uf"),
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

  return { bumps, frete, metodo, qtd: () => qtd, total, items, select, validate, busy, alert: showAlert };
}
