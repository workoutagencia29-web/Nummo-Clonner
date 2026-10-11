/**
 * Barra de compra fixa embaixo no celular (caixas de compra
 * data-os-widget="product-buy" com data-os-pb-bar diferente de "0"): quando o
 * "Comprar agora" já passou para cima da tela — ou para baixo das barras
 * presas no topo (cabeçalho fixo, contagem no topo: a altura delas está no
 * scroll-padding-top do <html>, src/runtime/widgets/top.ts) —, aparece
 * embaixo uma barra com o preço e uma cópia do botão. O clique na cópia é um
 * clique no botão original (`click()`): valem o link da oferta, o pagamento na
 * página, os eventos e o rastreamento dele.
 *
 * Uma barra só, para todas as caixas da página: ela mostra a última caixa cujo
 * botão já passou, e some enquanto algum botão de compra está à vista (uma
 * caixa escondida — popup, etapa do quiz, roleta — não conta). Confere na
 * rolagem (também num salto: tecla End, link #), ao mudar o tamanho da tela e
 * quando um botão entra ou sai da tela.
 *
 * Enquanto a barra aparece, a notificação de compra e o botão flutuante de
 * WhatsApp sobem (o botão "Cookies" do aviso de cookies sobe sozinho, ver
 * src/runtime/tracking/consent.ts); um espaço do tamanho da barra no fim da
 * página (só enquanto ela pode aparecer) impede que ela cubra o rodapé. Fica
 * abaixo do aviso de cookies, do popup de saída e da janela de pagamento
 * (z-index). Só no celular (até 768 px).
 */
const MOBILE = "(max-width:768px)";

interface Buy {
  box: HTMLElement;
  buy: HTMLElement;
}

const buys: Buy[] = [];
let bar: HTMLElement | null = null;
let price: HTMLElement;
let go: HTMLButtonElement;
/** Caixa mostrada na barra (null = barra escondida). */
let shown: Buy | null = null;
/** Caixa cujo preço e botão estão na barra (também escondida, para medir). */
let filled: Buy | null = null;
let barH = 0;
let lastH = 0;
let lastSp = -1;
let lifted: HTMLElement[] = [];
let queued = false;
let forced = false;

/** Botões flutuantes que sobem junto (o WhatsApp do canto; a notificação sobe pelo CSS). */
function floating(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-os-widget="whatsapp"]')).filter(
    (el) => getComputedStyle(el).position === "fixed",
  );
}

/** A barra com o preço e o texto do botão desta caixa. */
function fill(item: Buy) {
  filled = item;
  price.innerHTML = "";
  for (const sel of [".os-pd-now", ".os-pd-inst"]) {
    const part = item.box.querySelector(sel);
    if (part) price.appendChild(part.cloneNode(true));
  }
  go.textContent = (item.buy.textContent || "").replace(/\s+/g, " ").trim();
  barH = Math.ceil((bar as HTMLElement).getBoundingClientRect().height);
}

function update() {
  queued = false;
  const force = forced;
  forced = false;
  if (!bar) return;
  const root = document.documentElement;
  const mobile = matchMedia(MOBILE).matches;
  // Barras presas no topo cobrem o começo da tela (fitTop grava a altura delas).
  const top = parseFloat(root.style.scrollPaddingTop) || 0;
  let past: Buy | null = null;
  let pastBottom = -1e9;
  let seen = false;
  let sized = false;
  for (const item of buys) {
    const r = item.buy.getBoundingClientRect();
    // Um botão escondido não tem tamanho: não conta.
    if (!r.height) continue;
    sized = true;
    if (r.bottom <= top) {
      if (r.bottom > pastBottom) {
        past = item;
        pastBottom = r.bottom;
      }
    } else if (r.top < innerHeight) seen = true;
  }
  const next = mobile && !seen ? past : null;
  if (next && next !== filled) fill(next);
  else if (force && mobile && filled) barH = Math.ceil(bar.getBoundingClientRect().height);

  // Espaço no fim da página: do tamanho da barra, enquanto ela pode aparecer.
  const sp = mobile && sized ? barH : 0;
  if (sp !== lastSp) {
    lastSp = sp;
    root.style.setProperty("--os-pb-sp", `${sp}px`);
  }
  if (next === shown && !force) return;
  shown = next;
  // A cópia com as cores do botão de verdade (o usuário pode ter mudado no editor).
  if (next) {
    const cs = getComputedStyle(next.buy);
    go.style.backgroundColor = cs.backgroundColor;
    go.style.color = cs.color;
  }
  const h = next ? barH : 0;
  root.style.setProperty("--os-pb-h", `${h}px`);
  bar.classList.toggle("os-pb-on", !!next);
  root.classList.toggle("os-pb-up", !!next);
  for (const el of lifted) el.style.transform = "";
  lifted = next ? floating() : [];
  for (const el of lifted) {
    el.style.transition = "transform .25s";
    el.style.transform = `translateY(-${h}px)`;
  }
  // Notificação de compra já aberta acima do WhatsApp (altura própria, posta por ela):
  // sobe e desce junto com ele.
  const dh = h - lastH;
  lastH = h;
  if (dh) {
    for (const sn of Array.from(document.querySelectorAll<HTMLElement>(".os-sn"))) {
      const b = parseFloat(sn.style.bottom);
      if (b) sn.style.bottom = `${b + dh}px`;
    }
  }
}

function queue(force?: boolean) {
  if (force) forced = true;
  if (queued) return;
  queued = true;
  requestAnimationFrame(update);
}

export function setupBuyBar(box: HTMLElement) {
  if (/^(0|false)$/i.test((box.getAttribute("data-os-pb-bar") || "").trim())) return;
  const buy = box.querySelector<HTMLElement>(".os-pb-buy");
  if (!buy) return;
  const item: Buy = { box, buy };
  buys.push(item);
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "os-pb-bar";
    price = document.createElement("div");
    price.className = "os-pb-bar-p";
    // O preço como o visitante vê (o leitor de tela ouve o do próprio botão de compra).
    price.setAttribute("aria-hidden", "true");
    go = document.createElement("button");
    go.type = "button";
    go.className = "os-pb-bar-go";
    go.addEventListener("click", () => {
      if (shown) shown.buy.click();
    });
    bar.appendChild(price);
    bar.appendChild(go);
    const spacer = document.createElement("div");
    spacer.className = "os-pb-sp";
    spacer.setAttribute("aria-hidden", "true");
    document.body.appendChild(spacer);
    document.body.appendChild(bar);
    fill(item);
    addEventListener("scroll", () => queue(), { passive: true });
    addEventListener("resize", () => queue(true));
    addEventListener("load", () => queue(true));
  }
  if (typeof IntersectionObserver === "function") new IntersectionObserver(() => queue()).observe(buy);
  queue(true);
}
