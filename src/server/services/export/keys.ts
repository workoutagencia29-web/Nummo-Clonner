/** Constantes do ZIP usadas pelo painel e pelo worker (sem importar a montagem). */

/** Onde ficam os ZIPs no storage: exports/<offerId>/<exportId>.zip. */
export const EXPORTS_ROOT = "exports";
export const exportFileKey = (offerId: string, exportId: string) => `${EXPORTS_ROOT}/${offerId}/${exportId}.zip`;

export const NO_PAGES_MESSAGE = "Esta oferta não tem páginas. Crie uma página antes de baixar o ZIP.";
