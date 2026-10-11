/**
 * Loja na página publicada: busca do cabeçalho de loja
 * (data-os-widget="store-header"), setas do carrossel da vitrine
 * (data-os-widget="products") e o cabeçalho fixo no topo.
 *
 * Busca (Enter no campo ou a lupa; regras de comparação em src/lib/store-search.ts):
 * - Página com vitrine: esconde os produtos cujo nome e selo não batem (a
 *   vitrine cujo título bate fica inteira) e a vitrine que ficou sem nenhum (e
 *   a caixa em volta que ficou vazia, como a "Oferta do dia + ofertas"),
 *   mostra logo abaixo do cabeçalho a linha "Resultados para “x” · Ver todos
 *   os produtos" (ou "Nenhum produto encontrado…", com os textos do
 *   cabeçalho; com o cabeçalho preso no topo, a linha fica presa junto, dentro
 *   dele), rola até o primeiro resultado se ele não está à vista (abaixo das
 *   barras presas no topo) — sem resultado, até a linha — e grava ?busca= no
 *   endereço (history.replaceState). Busca vazia ou "Ver todos" desfaz (o foco
 *   volta para o campo). Abrir a página com ?busca= preenche o campo e filtra;
 *   quando a página termina de carregar (fotos acima da vitrine), confere a
 *   rolagem de novo se a pessoa ainda não rolou.
 * - Página sem vitrine (ex.: página do produto): vai para o endereço do logo
 *   (a página da loja, já com as UTMs que o rastreamento pôs nos links) com
 *   ?busca=; sem logo com destino, não faz nada (o canvas avisa).
 * - Categoria sem destino (href vazio/"#", sem link da oferta nem pagamento):
 *   o clique busca o texto dela.
 *
 * Carrossel: a classe os-pd-js mostra as setas (só no computador, pelo CSS da
 * vitrine); cada seta rola a trilha ~90% da largura e fica desligada no começo
 * e no fim. Vitrine que começa escondida (atraso, popup, etapa do quiz): as
 * setas são conferidas de novo quando a trilha muda de tamanho
 * (ResizeObserver) e quando o mouse ou o foco chegam na vitrine.
 *
 * Lugar do cabeçalho: ele mora no nível de cima da página (filho do <body>,
 * largura toda da tela). Um que ficou dentro de um contêiner (página gravada
 * antes de o editor manter essa regra e ainda não reaberta) vai para logo
 * antes do elemento de cima que o continha; dentro de um bloco que começa
 * escondido (HIDDEN_HOST: popup, atraso, etapa do quiz, roleta) fica no lugar.
 *
 * Cabeçalho fixo (data-os-sticky="1"): preso no topo por pinTop, abaixo da
 * "Contagem no topo (barra)" (iniciada antes); dentro de um bloco que começa
 * escondido fica no lugar.
 */
import { HIDDEN_HOST } from "@/lib/countdown-bar";
import { matchesSearch, SEARCH_MAX, SEARCH_PARAM, SEARCH_TEXTS, searchMessage } from "@/lib/store-search";
import { fitTop, pinTop } from "./top";
import { flag, isTouch, markAutoScroll, navigate, opt, reducedMotion, widgets } from "./util";

/** Escondido pela busca (classe do script; o CSS dos widgets tem a regra). */
const HIDE = "os-sh-hide";
const SHOPS = '[data-os-widget="products"]';

/** Linha de resultados mostrada agora. */
let line: HTMLElement | null = null;
/** Atualizam as setas de cada carrossel (a busca muda a largura das trilhas). */
const arrows: (() => void)[] = [];

/** Elementos (lista de verdade) que casam com o seletor. */
const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) =>
  Array.from(root.querySelectorAll<T>(sel));

/** Endereço que leva a algum lugar ("#", vazio e javascript: não levam). */
const leads = (href: string | null) => !!href && href !== "#" && !/^javascript:/i.test(href);

/** Busca do jeito que vai para o endereço e para os campos. */
const clean = (raw: string) => raw.replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX);

function setParam(q: string) {
  try {
    const url = new URL(location.href);
    if (q) url.searchParams.set(SEARCH_PARAM, q);
    else url.searchParams.delete(SEARCH_PARAM);
    if (url.href !== location.href) history.replaceState(history.state, "", url.href);
  } catch {
    // endereço que não dá para trocar (sandbox): a busca vale do mesmo jeito
  }
}

/** Mostra de novo tudo o que a busca escondeu e tira a linha de resultados. */
function reset() {
  for (const el of $$(`.${HIDE}`)) el.classList.remove(HIDE);
  if (line) {
    line.remove();
    // Linha que estava dentro do cabeçalho preso: o espaço do topo volta ao tamanho dele.
    fitTop();
  }
  line = null;
}

/** Esconde o elemento e, subindo, a caixa que ficou sem nada à vista (nunca o <body> nem o cabeçalho). */
function hideUp(el: HTMLElement) {
  el.classList.add(HIDE);
  const parent = el.parentElement;
  if (!parent || parent === document.body || parent.querySelector('[data-os-widget="store-header"]')) return;
  for (const child of Array.from(parent.children)) {
    if (!child.classList.contains(HIDE) && !/^(SCRIPT|STYLE|LINK|META|TEMPLATE|NOSCRIPT)$/.test(child.tagName)) return;
  }
  hideUp(parent);
}

/** Altura das barras presas no topo (scroll-padding-top do <html>, src/runtime/widgets/top.ts). */
const topPad = () => parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;

/**
 * Rola a página até `top`. O popup de saída não confunde essa rolagem com a
 * pessoa saindo da página: a marca de rolagem automática vale enquanto a
 * página ainda anda até lá (uma subida longa e suave passa de 1 s).
 */
function scrollPage(top: number) {
  const target = Math.max(0, Math.min(top, document.documentElement.scrollHeight - innerHeight));
  const until = Date.now() + 6000;
  const follow = () => {
    if (Math.abs(scrollY - target) < 2 || Date.now() > until) removeEventListener("scroll", follow);
    else markAutoScroll(500);
  };
  markAutoScroll();
  addEventListener("scroll", follow, { passive: true });
  scrollTo({ top: target, behavior: reducedMotion() ? "auto" : "smooth" });
}

/**
 * Leva até o primeiro resultado (ou, sem resultado, até a linha de
 * resultados), se ele não está à vista (abaixo das barras presas no topo).
 */
function reveal(el: HTMLElement) {
  const pad = topPad();
  const box = el.getBoundingClientRect();
  if (box.top >= pad && box.bottom <= innerHeight) return;
  // O topo da vitrine (com o título) quando cabe; senão, o próprio produto.
  const shop = el.closest<HTMLElement>(SHOPS);
  const shopTop = shop ? shop.getBoundingClientRect().top : box.top;
  const top = box.bottom - shopTop <= innerHeight - pad - 24 ? shopTop : box.top;
  scrollPage(scrollY + top - pad - 12);
}

/**
 * Linha "Resultados para “x” · Ver todos os produtos", logo abaixo do
 * cabeçalho. Cabeçalho preso no topo: a linha entra nele (fica à vista
 * enquanto a pessoa rola pelos resultados; o espaço do topo cresce junto).
 */
function showLine(header: HTMLElement, q: string, found: number) {
  const text = found ? opt(header, "sh-found", SEARCH_TEXTS.found) : opt(header, "sh-empty", SEARCH_TEXTS.empty);
  line = document.createElement("div");
  line.className = "os-sh-res";
  line.setAttribute("role", "status");
  const span = document.createElement("span");
  span.textContent = `${searchMessage(text, q)} · `;
  const all = document.createElement("button");
  all.type = "button";
  all.textContent = opt(header, "sh-all", SEARCH_TEXTS.all);
  all.addEventListener("click", () => {
    search(header, "", false);
    // O botão sai da página com a linha: o foco volta para o campo de pesquisa.
    const input = header.querySelector<HTMLInputElement>(".os-sh-q");
    if (input) input.focus({ preventScroll: true });
  });
  line.appendChild(span);
  line.appendChild(all);
  if (header.classList.contains("os-top")) {
    header.appendChild(line);
    fitTop();
  } else header.parentNode?.insertBefore(line, header.nextSibling);
}

/**
 * Busca `raw` (vazio desfaz). `scroll`: leva até o primeiro resultado. Numa
 * página sem vitrine, vai para a página da loja (endereço do logo) com a busca.
 */
function search(header: HTMLElement, raw: string, scroll: boolean): HTMLElement | null {
  const q = clean(raw);
  for (const input of $$<HTMLInputElement>(".os-store-header .os-sh-q")) {
    if (input.value !== q) input.value = q;
  }
  const shops = $$(SHOPS);
  if (!shops.length) {
    const href = header.querySelector(".os-sh-logo")?.getAttribute("href") ?? null;
    if (!q || !leads(href)) return null;
    try {
      const url = new URL(href as string, location.href);
      url.searchParams.set(SEARCH_PARAM, q);
      navigate(url);
    } catch {
      // endereço do logo inválido: fica na página
    }
    return null;
  }
  reset();
  setParam(q);
  let first: HTMLElement | null = null;
  if (q) {
    let found = 0;
    for (const shop of shops) {
      let any = false;
      // Título que bate ("Mais vendidos", "Ofertas do dia"): a vitrine inteira fica.
      const title = shop.getAttribute("data-os-show-title") !== "0" && shop.querySelector(".os-pd-title");
      const whole = !!title && matchesSearch(title.textContent || "", q);
      const badges = shop.getAttribute("data-os-show-badge") !== "0";
      for (const card of $$("[data-os-product]", shop)) {
        const name = card.querySelector(".os-pd-name");
        const text = `${name ? name.textContent : ""} ${badges ? card.getAttribute("data-os-pd-badge") || "" : ""}`;
        if (whole || matchesSearch(text, q)) {
          any = true;
          found++;
          first = first || card;
        } else card.classList.add(HIDE);
      }
      if (!any) hideUp(shop);
      // O carrossel volta ao começo: o primeiro resultado aparece.
      const track = shop.querySelector<HTMLElement>("[data-os-pd-track]");
      if (track) track.scrollLeft = 0;
    }
    showLine(header, q, found);
    if (scroll && (first || line)) reveal((first || line) as HTMLElement);
  }
  for (const update of arrows) update();
  return first;
}

function setupHeader(header: HTMLElement) {
  const input = header.querySelector<HTMLInputElement>(".os-sh-q");
  const run = () => {
    search(header, input ? input.value : "", true);
    // No celular o teclado fecha (os resultados aparecem inteiros).
    if (input && isTouch()) input.blur();
  };
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.keyCode !== 13) return;
      e.preventDefault();
      run();
    });
    // O "x" do campo (Chrome/Safari) limpou a busca: mostra tudo de novo.
    input.addEventListener("search", () => {
      if (!input.value && line) search(header, "", false);
    });
  }
  const go = header.querySelector(".os-sh-go");
  if (go)
    go.addEventListener("click", (e) => {
      e.preventDefault();
      run();
    });
  // Categoria sem destino: busca o texto dela.
  for (const cat of $$(".os-sh-cat", header)) {
    cat.addEventListener("click", (e) => {
      if (leads(cat.getAttribute("href")) || cat.hasAttribute("data-os-pay") || cat.getAttribute("data-os-link"))
        return;
      e.preventDefault();
      search(header, cat.textContent || "", true);
    });
  }
  // Dentro de um bloco que começa escondido (popup, atraso, quiz…), fica no lugar.
  if (header.parentElement?.closest(HIDDEN_HOST)) return;
  // Fora dele, mora no nível de cima (largura toda): um que ficou dentro de um
  // contêiner (página gravada antes dessa regra) vai para antes do contêiner.
  let top: Node = header;
  while (top.parentNode && top.parentNode !== document.body) top = top.parentNode;
  if (top !== header && top.parentNode) document.body.insertBefore(header, top);
  if (flag(header, "sticky", false)) pinTop(header);
}

/** Setas do carrossel: rolam a trilha e ficam desligadas no começo e no fim. */
function setupArrows(shop: HTMLElement) {
  const track = shop.querySelector<HTMLElement>("[data-os-pd-track]");
  const prev = shop.querySelector<HTMLButtonElement>(".os-pd-prev");
  const next = shop.querySelector<HTMLButtonElement>(".os-pd-next");
  if (!track || !prev || !next) return;
  const update = () => {
    const end = track.scrollWidth - track.clientWidth - 1;
    const active = document.activeElement;
    prev.disabled = track.scrollLeft <= 1;
    next.disabled = track.scrollLeft >= end;
    // Seta desligada com o foco nela: o foco passa para a outra.
    if (active === next && next.disabled && !prev.disabled) prev.focus();
    else if (active === prev && prev.disabled && !next.disabled) next.focus();
  };
  const move = (dir: number) => {
    const dx = dir * Math.max(track.clientWidth * 0.9, 1);
    if (track.scrollBy && "scrollBehavior" in document.documentElement.style && !reducedMotion())
      track.scrollBy({ left: dx, behavior: "smooth" });
    else track.scrollLeft += dx;
  };
  prev.addEventListener("click", () => move(-1));
  next.addEventListener("click", () => move(1));
  track.addEventListener("scroll", update, { passive: true });
  addEventListener("resize", update);
  addEventListener("load", update);
  // Vitrine que começa escondida (atraso, popup, etapa do quiz): a trilha muda de tamanho
  // quando aparece. Sem ResizeObserver (Safari 13.0), o mouse ou o foco chegando conferem.
  if (typeof ResizeObserver === "function") new ResizeObserver(update).observe(track);
  shop.addEventListener("mouseenter", update);
  shop.addEventListener("focusin", update);
  arrows.push(update);
  shop.classList.add("os-pd-js");
  update();
}

export function initStore() {
  // Setas primeiro: a busca do ?busca= já acerta as setas das trilhas filtradas.
  for (const shop of widgets("products")) setupArrows(shop);
  const headers = widgets("store-header");
  for (const header of headers) setupHeader(header);
  // Chegou com ?busca= (pesquisa feita na página do produto): preenche e filtra.
  // Numa página sem vitrine o parâmetro não faz nada (nunca navega sozinho).
  const q = headers.length ? clean(new URLSearchParams(location.search).get(SEARCH_PARAM) || "") : "";
  if (!q || !document.querySelector(SHOPS)) return;
  const first = search(headers[0], q, true);
  if (!first || document.readyState === "complete") return;
  // Fotos acima da vitrine (banner sem altura no HTML) ainda carregando empurram o
  // resultado para baixo: no load, confere de novo — se a pessoa ainda não rolou.
  let moved = false;
  const mark = () => {
    moved = true;
  };
  for (const ev of ["wheel", "touchstart", "keydown", "mousedown"]) addEventListener(ev, mark, { passive: true });
  addEventListener("load", () => {
    if (!moved && !first.classList.contains(HIDE) && line) reveal(first);
  });
}
