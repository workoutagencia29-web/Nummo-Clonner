/**
 * Só aceita caminhos internos no "voltar" do login. Resolve a URL de verdade:
 * o navegador trata "\" como "/" e ignora tabulações, então "/\site.com" e
 * "/%09/site.com" levariam para fora do Offer Studio se só olhássemos o prefixo.
 */
export function safeReturnPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.includes("\\")) return "/ofertas";
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code === 127) return "/ofertas";
  }
  try {
    const u = new URL(value, "http://offerstudio.invalid");
    if (u.origin !== "http://offerstudio.invalid") return "/ofertas";
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return "/ofertas";
  }
}
