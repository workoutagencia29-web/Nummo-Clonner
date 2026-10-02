/**
 * Regras puras da aba "Empresa e SEO" (sem React). Testadas em
 * tests/unit/tracking-ui-helpers.test.ts.
 */

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
  { key: "document", label: "CNPJ ou CPF", marker: "{{CNPJ}}", placeholder: "00.000.000/0001-00" },
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
