/**
 * Título da aba do navegador no editor: "Upsell (Versão B) · Oferta X". Com
 * várias páginas abertas em abas, cada uma tem o seu nome. Quando a página tem
 * o mesmo nome da oferta (páginas clonadas), o nome aparece uma vez só.
 */
export function editorTabTitle(info: {
  pageName: string;
  offerName: string;
  variantName: string;
  hasVariants: boolean;
  device: "ALL" | "DESKTOP" | "MOBILE";
}): string {
  const extras = [
    info.hasVariants ? `Versão ${info.variantName}` : "",
    info.device === "MOBILE" ? "celular" : "",
  ].filter(Boolean);
  const page = extras.length ? `${info.pageName} (${extras.join(", ")})` : info.pageName;
  const same = info.pageName.trim().toLowerCase() === info.offerName.trim().toLowerCase();
  return same ? page : `${page} · ${info.offerName}`;
}
