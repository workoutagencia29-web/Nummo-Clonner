/*! mini-dom 1.0 — utilitário estilo jQuery do próprio site (legítimo: deve continuar no clone) */
(function (window, document) {
  function MiniDom(seletor) {
    this.itens = typeof seletor === "string" ? Array.prototype.slice.call(document.querySelectorAll(seletor)) : [seletor];
  }
  MiniDom.prototype.on = function (evento, fn) {
    this.itens.forEach(function (el) {
      el.addEventListener(evento, fn);
    });
    return this;
  };
  MiniDom.prototype.toggleAttr = function (nome) {
    this.itens.forEach(function (el) {
      if (el.hasAttribute(nome)) el.removeAttribute(nome);
      else el.setAttribute(nome, "");
    });
    return this;
  };
  function $(seletor) {
    return new MiniDom(seletor);
  }
  $.ready = function (fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  };
  window.$ = window.miniDom = $;

  $.ready(function () {
    $(".menu-botao").on("click", function () {
      var aberto = this.getAttribute("aria-expanded") === "true";
      this.setAttribute("aria-expanded", String(!aberto));
      $(".menu").toggleAttr("hidden");
    });
    $('a[href^="#"]').on("click", function (e) {
      var alvo = document.querySelector(this.getAttribute("href"));
      if (!alvo) return;
      e.preventDefault();
      alvo.scrollIntoView({ behavior: "smooth" });
    });
    document.body.classList.add("js-pronto");
  });
})(window, document);
