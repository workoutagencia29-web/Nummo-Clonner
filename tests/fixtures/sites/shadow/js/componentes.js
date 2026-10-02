/* Componente <oferta-card> com shadow root ABERTO: o conteúdo só existe dentro do shadow DOM. */
class OfertaCard extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    var raiz = this.attachShadow({ mode: "open" });
    var plano = this.getAttribute("plano") || "mensal";
    var preco = this.getAttribute("preco") || "";
    var checkout = this.getAttribute("checkout") || "#";
    raiz.innerHTML =
      "<style>" +
      ":host{display:block;background:#fff;border-radius:16px;box-shadow:0 4px 16px rgba(62,39,35,.15);}" +
      ".cartao{padding:24px;text-align:center;}" +
      ".cartao h2{margin:0 0 8px;color:#6d4c41;text-transform:capitalize;}" +
      ".preco{font-size:2rem;font-weight:700;color:#2e7d32;}" +
      ".selo{background:url(img/selo-frete.png) center/contain no-repeat;height:48px;}" +
      "a{display:inline-block;background:#6d4c41;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;}" +
      "</style>" +
      '<div class="cartao">' +
      '<img src="img/cafe-' +
      plano +
      '.jpg" alt="" width="240" height="160">' +
      "<h2>Plano " +
      plano +
      "</h2>" +
      '<p class="preco">' +
      preco +
      "/mês</p>" +
      '<p class="texto-shadow">Oferta exclusiva no Shadow DOM</p>' +
      '<div class="selo" aria-label="Frete grátis"></div>' +
      '<slot name="bonus"></slot>' +
      '<p><a part="botao" href="' +
      checkout +
      '">Assinar agora</a></p>' +
      "</div>";
  }
}

customElements.define("oferta-card", OfertaCard);
