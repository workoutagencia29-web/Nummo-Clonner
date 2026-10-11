/**
 * Dados de quem compra no checkout do Offer Studio — regras puras usadas no
 * painel, no servidor (prévia em simulação) e no script da página de checkout:
 * CPF (com os dígitos verificadores), telefone do Brasil (DDD + 8 ou 9
 * dígitos), CEP e e-mail, com as máscaras do formulário. O pagamento.php do
 * ZIP repete as mesmas regras (os testes conferem).
 *
 * Sem dependências e sem desestruturação: o script da página importa daqui
 * (alvo Safari 13).
 */

/** Só os algarismos ("123.456.789-09" → "12345678909"). */
export function onlyDigits(value: string): string {
  return String(value || "").replace(/\D+/g, "");
}

/**
 * CPF válido: 11 algarismos, não todos iguais, e os 2 dígitos verificadores
 * certos (o gateway recusa o PIX com CPF inválido).
 */
export function isValidCpf(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (let check = 9; check < 11; check++) {
    let sum = 0;
    for (let i = 0; i < check; i++) sum += Number(d.charAt(i)) * (check + 1 - i);
    const digit = ((sum * 10) % 11) % 10;
    if (digit !== Number(d.charAt(check))) return false;
  }
  return true;
}

/** Máscara do CPF enquanto digita ("12345678909" → "123.456.789-09"). */
export function formatCpf(value: string): string {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/**
 * Telefone do Brasil só com DDD + número (10 ou 11 algarismos), sem o +55: o
 * que os gateways de PIX pedem. Aceita o número como costuma ser colado: com
 * +55 na frente ("+55 11 98765-4321", como o WhatsApp mostra), com o 0 da
 * ligação interurbana ("011 98765-4321") ou o 0 + código da operadora
 * ("0 15 11 98765-4321").
 */
export function brPhoneDigits(value: string): string {
  let d = onlyDigits(value);
  if (d.charAt(0) === "0") {
    d = d.slice(1);
    // 0 + operadora (2 algarismos) + DDD + número.
    if (d.length === 12 || d.length === 13) d = d.slice(2);
  }
  return (d.length === 12 || d.length === 13) && d.slice(0, 2) === "55" ? d.slice(2) : d;
}

/**
 * Telefone do Brasil válido: DDD de 11 a 99 (sem zero) e celular com 9
 * algarismos começando por 9, ou fixo com 8 algarismos começando de 2 a 5.
 */
export function isValidBrPhone(value: string): boolean {
  const d = brPhoneDigits(value);
  if (!/^[1-9][1-9]/.test(d)) return false;
  if (d.length === 11) return d.charAt(2) === "9";
  if (d.length === 10) return /[2-5]/.test(d.charAt(2));
  return false;
}

/** Máscara do telefone enquanto digita ("11987654321" → "(11) 98765-4321"). */
export function formatBrPhone(value: string): string {
  const d = brPhoneDigits(value).slice(0, 11);
  if (!d.length) return "";
  if (d.length <= 2) return `(${d}`;
  const rest = d.slice(2);
  const cut = d.length === 11 ? 5 : 4;
  if (rest.length <= cut) return `(${d.slice(0, 2)}) ${rest}`;
  return `(${d.slice(0, 2)}) ${rest.slice(0, cut)}-${rest.slice(cut)}`;
}

/** Telefone de fora do Brasil (Kyvo): de 8 a 15 algarismos, com ou sem o código do país. */
export function isValidIntlPhone(value: string): boolean {
  const d = onlyDigits(value);
  return d.length >= 8 && d.length <= 15;
}

/** CEP válido: 8 algarismos, não todos zero. */
export function isValidCep(value: string): boolean {
  const d = onlyDigits(value);
  return d.length === 8 && d !== "00000000";
}

/** Máscara do CEP ("01310100" → "01310-100"). */
export function formatCep(value: string): string {
  const d = onlyDigits(value).slice(0, 8);
  return d.length <= 5 ? d : `${d.slice(0, 5)}-${d.slice(5)}`;
}

/** E-mail simples (o gateway confere de verdade). O mesmo do pagamento na página. */
export const CHECKOUT_EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@.]{2,63}$/;

export function isValidEmail(value: string): boolean {
  const v = String(value || "").trim();
  return v.length <= 254 && CHECKOUT_EMAIL_RE.test(v);
}

/** Nome completo: pelo menos 2 letras e um sobrenome (os gateways de PIX recusam nome solto). */
export function isValidFullName(value: string): boolean {
  const v = String(value || "")
    .trim()
    .replace(/\s+/g, " ");
  if (v.length < 5 || v.length > 120) return false;
  const parts = v.split(" ");
  return parts.length >= 2 && parts[0].length >= 2 && parts[parts.length - 1].length >= 1;
}

/** Siglas dos estados do Brasil (UF do endereço). */
export const BR_STATES = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
];

export function isValidUf(value: string): boolean {
  return BR_STATES.indexOf(String(value || "").toUpperCase()) >= 0;
}
