/**
 * Avisos do "Baixar ZIP" que a tela sabe resolver ali mesmo (sem servidor nem
 * banco: a prévia, a montagem e o diálogo usam os mesmos textos).
 *
 * Os avisos são gravados como texto no ZIP (ExportJob.warnings), então a tela
 * reconhece pelo texto qual ação oferecer (exportWarningFix).
 */

/** Aviso da imagem de compartilhamento sem o endereço do site (prévia e montagem usam o mesmo texto). */
export const OG_IMAGE_WARNING =
  "Para a imagem de compartilhamento aparecer no WhatsApp e no Facebook, preencha “Onde está no ar” nos detalhes da oferta (o endereço completo do site) e gere o ZIP de novo.";

/** Marcadores dos dados da empresa, na ordem em que a tela pede os campos. */
export const COMPANY_MARKERS = ["{{EMPRESA}}", "{{CNPJ}}", "{{EMAIL}}", "{{TELEFONE}}", "{{ENDERECO}}"] as const;
export type CompanyMarker = (typeof COMPANY_MARKERS)[number];

/** Campo dos dados da empresa que preenche cada marcador. */
export const COMPANY_MARKER_FIELD = {
  "{{EMPRESA}}": "name",
  "{{CNPJ}}": "document",
  "{{EMAIL}}": "email",
  "{{TELEFONE}}": "phone",
  "{{ENDERECO}}": "address",
} as const satisfies Record<CompanyMarker, string>;
export type CompanyMarkerField = (typeof COMPANY_MARKER_FIELD)[CompanyMarker];

/**
 * Marcadores que continuam na página com o campo vazio (telefone e endereço
 * vazios saem da página junto com o trecho em volta: fillCompanyPlaceholders).
 */
export const REQUIRED_COMPANY_MARKERS = ["{{EMPRESA}}", "{{CNPJ}}", "{{EMAIL}}"] as const satisfies CompanyMarker[];

const COMPANY_WARNING_END = "preencha os dados da empresa e gere o ZIP de novo.";

/** "a", "a e b", "a, b e c". */
function joinPt(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

/** Marcadores da empresa que aparecem no texto, na ordem de COMPANY_MARKERS. */
export function companyMarkersIn(text: string): CompanyMarker[] {
  return COMPANY_MARKERS.filter((m) => text.includes(m));
}

/**
 * Páginas que vão ao ar com {{EMPRESA}}, {{CNPJ}}… no lugar dos dados da
 * empresa → aviso em pt-BR (null = nenhuma).
 */
export function companyMarkersWarning(pages: { name: string; markers: readonly string[] }[]): string | null {
  const withMarkers = pages.filter((p) => p.markers.length > 0);
  if (!withMarkers.length) return null;
  const markers = COMPANY_MARKERS.filter((m) => withMarkers.some((p) => p.markers.includes(m)));
  const names = withMarkers.map((p) => `“${p.name}”`);
  const shown = names.length > 3 ? [...names.slice(0, 3), `mais ${names.length - 3}`] : names;
  const many = withMarkers.length > 1;
  return `${many ? "As páginas" : "A página"} ${joinPt(shown)} ${many ? "ainda mostram" : "ainda mostra"} ${joinPt(markers)} no lugar dos dados da empresa: ${COMPANY_WARNING_END}`;
}

const DEAD_BUTTONS_WARNING_END =
  "abra a página no editor, clique no botão e escolha o checkout em “Link da oferta” (ou digite o endereço).";

/** Texto do botão no aviso: curto, numa linha. */
function buttonName(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 40 ? `${clean.slice(0, 39).trimEnd()}…` : clean;
}

/**
 * Botões de compra que iriam ao ar sem destino (href="#"): ligados a "nenhum"
 * link da oferta, ou a um link ainda sem endereço → aviso em pt-BR (null = nenhum).
 */
export function deadButtonsWarning(pages: { name: string; buttons: readonly string[] }[]): string | null {
  const withButtons = pages.filter((p) => p.buttons.length > 0);
  if (!withButtons.length) return null;
  const total = withButtons.reduce((n, p) => n + p.buttons.length, 0);
  const names = withButtons.map((p) => `“${p.name}”`);
  const shown = names.length > 3 ? [...names.slice(0, 3), `mais ${names.length - 3}`] : names;
  if (total === 1) {
    const label = buttonName(withButtons[0].buttons[0]);
    const button = label ? `O botão “${label}”` : "Um botão";
    return `${button} da página ${shown[0]} ainda não leva a lugar nenhum (está sem link de checkout): ${DEAD_BUTTONS_WARNING_END}`;
  }
  const where = withButtons.length > 1 ? `nas páginas ${joinPt(shown)}` : `na página ${shown[0]}`;
  return `${total} botões ${where} ainda não levam a lugar nenhum (estão sem link de checkout): ${DEAD_BUTTONS_WARNING_END}`;
}

/** O que a tela oferece ao lado de um aviso do ZIP (null = só o texto). */
export type ExportWarningFix =
  | { kind: "liveUrl" }
  | { kind: "company"; fields: CompanyMarkerField[] }
  | { kind: "deadButtons" };

export function exportWarningFix(warning: string): ExportWarningFix | null {
  if (warning === OG_IMAGE_WARNING) return { kind: "liveUrl" };
  if (warning.endsWith(DEAD_BUTTONS_WARNING_END)) return { kind: "deadButtons" };
  if (warning.endsWith(COMPANY_WARNING_END)) {
    const fields = companyMarkersIn(warning).map((m) => COMPANY_MARKER_FIELD[m]);
    return fields.length ? { kind: "company", fields } : null;
  }
  return null;
}
