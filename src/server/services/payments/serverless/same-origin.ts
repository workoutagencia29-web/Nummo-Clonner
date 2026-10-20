/**
 * Portão de "mesma origem" do endpoint de pagamento — a mesma regra do
 * pagamento.php (os_fail('origem')): o pedido tem de vir da própria página
 * (Origin ou Referer presentes, do mesmo host), nunca de outro site nem com
 * Origin "null". Puro (sem dependências), para a casca serverless reusar.
 */

/** Host (sem porta, minúsculo) de uma URL, ou null se não der para ler. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const h = new URL(url).host.replace(/:\d+$/, "").toLowerCase();
    return h || null;
  } catch {
    return null;
  }
}

/**
 * O pedido é da mesma origem? Exige Origin OU Referer; recusa Origin "null"; o
 * host presente tem de ser o do site. (host = HTTP_HOST / x-forwarded-host.)
 */
export function sameOriginOk(
  host: string | null | undefined,
  origin: string | null | undefined,
  referer: string | null | undefined,
): boolean {
  const h = (host ?? "").trim().replace(/:\d+$/, "").toLowerCase();
  if (!h) return false;
  if (origin === "null") return false;
  const o = hostOf(origin);
  const r = hostOf(referer);
  if (!o && !r) return false;
  if (o && o !== h) return false;
  if (!o && r && r !== h) return false;
  return true;
}
