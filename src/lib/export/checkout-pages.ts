/**
 * Páginas de checkout do Offer Studio no ZIP (função pura): a pasta delas
 * (checkout/<chave do link>/index.html — "checkout-2/" se uma página da
 * oferta já usa "checkout/") e o endereço de cada uma a partir de qualquer
 * página do ZIP.
 *
 * Os links da oferta lidos para o ZIP (loadExportSource) levam o endereço
 * "./<pasta>/<chave>/" (relativo à raiz do ZIP); cada página troca pelo
 * endereço relativo a ela (rebaseCheckoutLinks), e o mapa de prêmios da
 * roleta, montado uma vez para a oferta inteira, também
 * (rebaseCheckoutPrizes). Sempre começando com "./" ou "../": é o formato que
 * o mapa de prêmios aceita para a página de checkout do próprio site
 * (SITE_PATH_RE em src/lib/wheel.ts).
 */
import { ZIP_CHECKOUT_DIR } from "@/lib/checkout/contract";
import type { RenderLink } from "@/lib/payments/links";
import type { WheelRender } from "@/lib/wheel-prizes";
import { ASSETS_DIR, relativeDir, uniqueName } from "./paths";

/**
 * Pasta das páginas de checkout no ZIP ("checkout/"), sem coincidir com a
 * pasta de uma página da oferta (as versões e o celular da página inicial
 * são "oferta-…" e "celular": nunca coincidem).
 */
export function zipCheckoutRoot(pages: readonly { slug: string; isHome: boolean }[]): string {
  const taken = new Set<string>([ASSETS_DIR.replace(/\/$/, "")]);
  for (const p of pages) if (!p.isHome) taken.add(p.slug);
  return `${uniqueName(ZIP_CHECKOUT_DIR.replace(/\/$/, ""), taken)}/`;
}

/** Pasta da página de checkout de um link ("checkout/<chave>/"). */
export function zipCheckoutDir(root: string, key: string): string {
  return `${root}${key}/`;
}

/** Endereço da página de checkout de um link a partir de uma pasta do ZIP ("./checkout/x/", "../checkout/x/"). */
export function zipCheckoutHref(fromDir: string, root: string, key: string): string {
  const rel = relativeDir(fromDir, zipCheckoutDir(root, key));
  return rel.startsWith(".") ? rel : `./${rel}`;
}

/** Links da oferta com o endereço da página de checkout relativo à pasta da página. */
export function rebaseCheckoutLinks(links: RenderLink[], fromDir: string, root: string): RenderLink[] {
  return links.map((l) => (l.checkout === true && l.url ? { ...l, url: zipCheckoutHref(fromDir, root, l.key) } : l));
}

/** Mapa de prêmios com o endereço das páginas de checkout (prêmios com `o`) relativo à pasta da página. */
export function rebaseCheckoutPrizes(
  wheel: WheelRender | null | undefined,
  fromDir: string,
  root: string,
): WheelRender | null | undefined {
  if (!wheel) return wheel;
  let changed = false;
  const prizes: WheelRender["prizes"] = {};
  for (const [id, prize] of Object.entries(wheel.prizes)) {
    if (prize.o) {
      prizes[id] = { ...prize, u: zipCheckoutHref(fromDir, root, prize.o) };
      changed = true;
    } else prizes[id] = prize;
  }
  return changed ? { ...wheel, prizes } : wheel;
}
