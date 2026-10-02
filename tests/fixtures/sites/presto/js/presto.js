/*
 * Imita o Presto Player (web component do Stencil): o CSS fica em
 * adoptedStyleSheets do shadow root (fora do HTML) e os ícones são SVG sem
 * tamanho próprio — sem o CSS, ficam gigantes. Nada de iframe (offline).
 */
var folhaPlayer = new CSSStyleSheet();
folhaPlayer.replaceSync(
  ".plyr{position:relative;background:#000;aspect-ratio:16/9;border-radius:18px;overflow:hidden}" +
    ".plyr svg{width:18px;height:18px}" +
    ".plyr__controls{position:absolute;bottom:0;left:0;right:0;display:flex;gap:8px;padding:10px}",
);

class PrestoPlayer extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    var raiz = this.attachShadow({ mode: "open" });
    raiz.adoptedStyleSheets = [folhaPlayer];
    raiz.innerHTML =
      '<div class="plyr"><div class="plyr__controls">' +
      '<button type="button" class="plyr__control"><svg viewBox="0 0 18 18"><path d="M15.6 8.4 4 1.5v15z"/></svg>' +
      '<span class="plyr__tooltip">Play</span></button></div></div>';
    this.classList.add("hydrated");
  }
}
customElements.define("presto-player", PrestoPlayer);

/* Outro web component com CSS só em adoptedStyleSheets (não é player: continua como está). */
var folhaSelo = new CSSStyleSheet();
folhaSelo.replaceSync(".selo{color:rgb(46, 125, 50);font-weight:700}");

class SeloGarantia extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    var raiz = this.attachShadow({ mode: "open" });
    raiz.adoptedStyleSheets = [folhaSelo];
    raiz.innerHTML = '<p class="selo">Garantia de 7 dias</p>';
  }
}
customElements.define("selo-garantia", SeloGarantia);
