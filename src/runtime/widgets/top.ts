/**
 * Barras fixas no topo da página (contagem no topo e faixa do prêmio da
 * roleta): ficam presas no topo enquanto a pessoa rola, uma embaixo da outra,
 * e a página ganha no começo um espaço do tamanho delas (não cobrem o topo).
 * Ficam acima do conteúdo da página e abaixo do aviso de cookies, do popup de
 * saída e da janela de pagamento (classe os-top; o CSS entra junto com a
 * primeira barra: a página do prêmio pode não ter nenhum widget).
 *
 * A altura das barras também vai para o scroll-padding-top do <html>: links
 * "#oferta" e a volta do quiz ao topo param logo abaixo delas, não embaixo.
 * A altura é refeita a cada tique do contador, ao mudar o tamanho da tela,
 * quando a página termina de carregar (fontes), e quando um bloco com atraso
 * aparece (os:revealed) — inclusive com a contagem já parada.
 */
const TOP_CSS =
  ".os-top{position:fixed!important;left:0!important;right:0!important;bottom:auto!important;z-index:2147482900!important;" +
  "width:auto!important;max-width:none!important;margin:0!important;box-sizing:border-box!important}";

const pinned: HTMLElement[] = [];
let spacer: HTMLElement | null = null;

/** Reposiciona as barras (uma embaixo da outra) e ajusta o espaço do topo. */
export function fitTop() {
  let y = 0;
  for (const el of pinned) {
    el.style.top = `${y}px`;
    y += el.getBoundingClientRect().height;
  }
  if (spacer) spacer.style.height = `${y}px`;
  document.documentElement.style.scrollPaddingTop = y ? `${y}px` : "";
}

/** Prende no topo (`first`: acima das outras). Vai para o <body>, fora de transformações e camadas da página. */
export function pinTop(el: HTMLElement, first?: boolean) {
  const body = document.body;
  if (!spacer) {
    const style = document.createElement("style");
    style.textContent = TOP_CSS;
    document.head.appendChild(style);
    spacer = document.createElement("div");
    spacer.className = "os-top-sp";
    spacer.setAttribute("aria-hidden", "true");
    body.insertBefore(spacer, body.firstChild);
    addEventListener("resize", fitTop);
    addEventListener("load", fitTop);
    document.addEventListener("os:revealed", fitTop);
    // Fonte da página que chega depois (inclusive depois do load).
    const fonts = document.fonts;
    if (fonts?.addEventListener) fonts.addEventListener("loadingdone", fitTop);
  }
  if (first) pinned.unshift(el);
  else pinned.push(el);
  el.classList.add("os-top");
  if (el.parentNode !== body) body.insertBefore(el, spacer.nextSibling);
  fitTop();
}

/** Tira do topo e da página (ex.: faixa fechada). */
export function unpinTop(el: HTMLElement) {
  const i = pinned.indexOf(el);
  if (i >= 0) pinned.splice(i, 1);
  el.remove();
  fitTop();
}
