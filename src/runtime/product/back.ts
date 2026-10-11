/**
 * "‹ Voltar para a loja" (a[data-os-pd-back]):
 *
 * - vindo de uma página deste site que é a mesma do destino do link (ou, sem
 *   destino, qualquer página deste site): volta no histórico — a vitrine
 *   continua como estava, com a busca e a rolagem (as páginas criadas pela
 *   vitrine levam a ela, os-page:<loja>; abrir o endereço de novo começaria a
 *   loja do zero);
 * - com destino, nos outros casos: um link comum;
 * - sem destino: vai para o endereço do logo do cabeçalho de loja (a página da
 *   loja); sem logo com destino, não faz nada — voltar no histórico levaria o
 *   visitante de volta ao anúncio (o canvas e o ZIP avisam para escolher a
 *   página da loja).
 *
 * O popup de saída com o gatilho "ao tentar voltar" empilha uma entrada desta
 * página no histórico ({ osPopup: 1 }): voltar uma só cairia nela e abriria o
 * popup. Então volta duas.
 */
const leads = (href: string | null) => !!href && href !== "#" && !/^javascript:/i.test(href);

/** Endereço sem a busca, o fragmento e o "index.html" do fim (a mesma página). */
function samePage(a: string, b: string) {
  try {
    const x = new URL(a, location.href);
    const y = new URL(b, location.href);
    const path = (u: URL) => u.pathname.replace(/\/index\.html?$/i, "/");
    return x.origin === y.origin && path(x) === path(y);
  } catch {
    return false;
  }
}

/** A página anterior é deste site (e, com `to`, é essa mesma página)? */
function cameFrom(to?: string) {
  const ref = document.referrer;
  if (!ref || history.length < 2) return false;
  try {
    if (new URL(ref).origin !== location.origin) return false;
  } catch {
    return false;
  }
  return !to || samePage(ref, to);
}

function goBack() {
  const state = history.state as { osPopup?: number } | null;
  // biome-ignore lint/complexity/useOptionalChain: "?." vira código maior no script das páginas (Safari 13).
  if (state && state.osPopup) history.go(-2);
  else history.back();
}

export function setupBackLinks() {
  for (const link of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[data-os-pd-back]"))) {
    link.addEventListener("click", (e) => {
      if (link.hasAttribute("data-os-pay")) return;
      const href = link.getAttribute("href");
      if (leads(href)) {
        if (cameFrom(link.href)) {
          e.preventDefault();
          goBack();
        }
        return;
      }
      e.preventDefault();
      if (cameFrom()) {
        goBack();
        return;
      }
      const logo = document.querySelector('[data-os-widget="store-header"] .os-sh-logo');
      const to = logo ? logo.getAttribute("href") : null;
      if (!leads(to)) return;
      try {
        const url = new URL(to as string, location.href);
        if (/^https?:$/.test(url.protocol)) location.href = url.href;
      } catch {
        // endereço do logo inválido: fica
      }
    });
  }
}
