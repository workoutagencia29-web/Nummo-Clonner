/**
 * Regras puras da aba "Moeda, empresa e SEO" (sem React). Testadas em
 * tests/unit/tracking-ui-helpers.test.ts.
 */
import type { CurrencySwitchResult } from "@/lib/offer-currency-switch";
import type { StoreCurrency } from "@/lib/store";

/** Limites do esquema (src/lib/offer-settings.ts) e o tamanho que o Google costuma mostrar. */
export const SEO_LIMITS = {
  title: { max: 160, recommended: 60 },
  description: { max: 320, recommended: 160 },
} as const;

const STORAGE_KEY_RE = /^a\/[0-9a-f]{2}\/([0-9a-f]{64}\.[a-z0-9]{1,8})$/;

/** Chave do storage ("a/3f/<sha>.webp") → endereço da imagem no painel ("/os-assets/<sha>.webp"). */
export function assetSrcFromKey(key: string | null | undefined): string | null {
  const m = STORAGE_KEY_RE.exec(key ?? "");
  return m ? `/os-assets/${m[1]}` : null;
}

export const LANGUAGE_LABEL = {
  "pt-BR": "Português (Brasil)",
  en: "Inglês",
  es: "Espanhol",
} as const;
/** Idioma escolhido; "" = igual à página (não muda o <html lang>). */
export type LanguageId = keyof typeof LANGUAGE_LABEL | "";
/** Valor da opção "Igual à página" no Select (o Select não aceita valor vazio). */
export const KEEP_LANGUAGE = "pagina";

/** Marcadores dos modelos de páginas legais e o campo que preenche cada um. */
export const COMPANY_FIELDS = [
  { key: "name", label: "Nome da empresa (ou seu nome)", marker: "{{EMPRESA}}", placeholder: "Minha Empresa Ltda." },
  {
    key: "document",
    // RFC (México) e NIF (Espanha/Portugal) também: o rótulo da página acompanha (documentKind).
    label: "CNPJ ou CPF (ou documento da empresa: RFC, NIF…)",
    marker: "{{CNPJ}}",
    placeholder: "00.000.000/0001-00",
  },
  { key: "phone", label: "Telefone ou WhatsApp (opcional)", marker: "{{TELEFONE}}", placeholder: "(11) 99999-9999" },
  { key: "email", label: "E-mail de contato", marker: "{{EMAIL}}", placeholder: "contato@suaempresa.com.br" },
  {
    key: "address",
    label: "Endereço (opcional)",
    marker: "{{ENDERECO}}",
    placeholder: "Rua Exemplo, 123 — São Paulo/SP",
  },
] as const;
export type CompanyFieldKey = (typeof COMPANY_FIELDS)[number]["key"];

/**
 * Exemplos dos campos da empresa numa oferta que não roda em real (a moeda diz
 * o país provável): uma oferta para o México não mostra "(11) 99999-9999".
 * Só o texto de exemplo (placeholder) muda; o real usa os de COMPANY_FIELDS.
 */
const COMPANY_EXAMPLES: Partial<Record<StoreCurrency, Record<CompanyFieldKey, string>>> = {
  MXN: {
    name: "Mi Empresa S.A. de C.V.",
    document: "RFC: XAXX010101000",
    phone: "+52 55 1234 5678",
    email: "contacto@tuempresa.com.mx",
    address: "Av. Reforma 123 — Ciudad de México",
  },
  EUR: {
    name: "Mi Empresa S.L.",
    document: "NIF: B12345678",
    phone: "+34 612 345 678",
    email: "contacto@tuempresa.es",
    address: "Calle Mayor 1 — Madrid",
  },
  USD: {
    name: "My Company LLC",
    document: "EIN: 00-0000000",
    phone: "+1 305 555 0123",
    email: "contact@yourcompany.com",
    address: "123 Main St — Miami, FL",
  },
};

/** Exemplo do campo da empresa na moeda da oferta. */
export function companyPlaceholder(key: CompanyFieldKey, currency: StoreCurrency): string {
  return COMPANY_EXAMPLES[currency]?.[key] ?? COMPANY_FIELDS.find((f) => f.key === key)?.placeholder ?? "";
}

/** Limites de cada campo da empresa (iguais aos do esquema). */
export const COMPANY_MAX: Record<CompanyFieldKey, number> = {
  name: 160,
  document: 40,
  email: 160,
  phone: 40,
  address: 300,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function companyEmailProblem(email: string): string | null {
  const text = email.trim();
  if (!text || EMAIL_RE.test(text)) return null;
  return "Digite um e-mail válido, como contato@suaempresa.com.br.";
}

/**
 * Texto da imagem de compartilhamento: o WhatsApp e as redes só leem endereço
 * completo (https://…), que o ZIP monta com “Onde está no ar” (aba Detalhes).
 */
export function ogImageDescription(liveUrl: string | null | undefined) {
  return liveUrl
    ? "Aparece ao mandar o link no WhatsApp e nas redes. Tamanho ideal: 1200×630."
    : "Aparece ao mandar o link no WhatsApp e nas redes (1200×630) — para isso, preencha “Onde está no ar” na aba Detalhes antes de gerar o ZIP: elas só acham a imagem pelo endereço completo do site.";
}

// ─── Troca da moeda da oferta ────────────────────────────────────────────────

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "a, b e c". */
function listPt(items: string[]) {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} e ${items.at(-1)}`;
}

/** Vitrines e caixas de compra que mudam ("3 vitrines e 1 caixa de compra em 2 páginas"); "" = nenhuma. */
export function storeChangeText(r: { showcases: number; buyBoxes: number; pages: number }) {
  const what = [
    r.showcases ? count(r.showcases, "vitrine", "vitrines") : "",
    r.buyBoxes ? count(r.buyBoxes, "caixa de compra", "caixas de compra") : "",
  ].filter(Boolean);
  return what.length ? `${listPt(what)} em ${count(r.pages, "página", "páginas")}` : "";
}

/**
 * Toast depois de "Trocar a moeda de tudo" (ou "Passar tudo para …", com a
 * moeda que a oferta já tem): o que mudou e o que conferir (os números dos
 * preços ficaram iguais; preço escrito como texto não muda; valor do
 * pagamento na página fora da faixa; Kyvo sem real). `persistent`: tem o que
 * conferir — o toast fica até a pessoa fechar (o padrão some em 4 s, antes
 * de dar para ler).
 */
export function currencySwitchToast(r: CurrencySwitchResult, label: string): { message: string; persistent: boolean } {
  const changed = [
    storeChangeText(r),
    r.payments ? count(r.payments, "produto do pagamento na página", "produtos do pagamento na página") : "",
    r.checkouts ? count(r.checkouts, "checkout do Offer Studio", "checkouts do Offer Studio") : "",
    // Só quando a oferta tem pixel ligado ou "Valor da oferta" salvo (ver pixelPlan).
    r.pixel ? "a moeda dos pixels" : "",
  ].filter(Boolean);
  const check = [
    r.showcases || r.buyBoxes ? "se os preços fazem sentido (os números ficaram iguais)" : "",
    r.textPricePages ? `os preços escritos como texto em ${count(r.textPricePages, "página", "páginas")}` : "",
    r.paymentProblems.length
      ? `o valor de ${listPt(r.paymentProblems.map((p) => `“${p.label}”`))} no pagamento na página`
      : "",
    // No "Passar tudo para real" a moeda da oferta não mudou: não há "moeda de antes".
    r.checkoutGateways.length
      ? `a chave ${listPt([...new Set(r.checkoutGateways.map((g) => `da ${g.gateway.replace(/ \(PIX\)$/, "")}`))])} em “Links e checkouts” (o gateway do checkout mudou)`
      : "",
    r.paymentsKept
      ? `o pagamento na página, que ${r.from === r.to ? "cobra em outra moeda" : "continua na moeda de antes"} (a Kyvo não cobra em real)`
      : "",
    r.checkoutTexts?.length
      ? `os textos trocados ${listPt(r.checkoutTexts.map((c) => `de “${c.label}”`))} (escritos para o idioma ou o pagamento de antes)`
      : "",
  ].filter(Boolean);
  const head = r.from === r.to ? `Tudo passou para ${label}.` : `Moeda da oferta trocada para ${label}.`;
  const body = changed.length
    ? ` Mudou: ${listPt(changed)}.`
    : r.from === r.to
      ? " Nada estava em outra moeda."
      : " Nenhuma página tinha preço de vitrine ou caixa de compra.";
  return { message: `${head}${body}${check.length ? ` Confira ${listPt(check)}.` : ""}`, persistent: check.length > 0 };
}
