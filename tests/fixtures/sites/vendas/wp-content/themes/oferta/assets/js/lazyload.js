/* Carregamento preguiçoso do tema: troca data-src, data-srcset e data-bg quando o elemento aparece. */
(function () {
  function carregar(el) {
    if (el.dataset.src) el.setAttribute("src", el.dataset.src);
    if (el.dataset.srcset) el.setAttribute("srcset", el.dataset.srcset);
    if (el.dataset.sizes === "auto") el.setAttribute("sizes", el.offsetWidth + "px");
    if (el.dataset.bg) el.style.backgroundImage = "url('" + el.dataset.bg + "')";
    el.classList.remove("lazyload");
    el.classList.add("lazyloaded");
  }

  function iniciar() {
    var itens = document.querySelectorAll(".lazyload");
    if (!("IntersectionObserver" in window)) {
      itens.forEach(carregar);
      return;
    }
    var obs = new IntersectionObserver(
      function (entradas) {
        entradas.forEach(function (e) {
          if (e.isIntersecting) {
            carregar(e.target);
            obs.unobserve(e.target);
          }
        });
      },
      { rootMargin: "100px" },
    );
    itens.forEach(function (el) {
      obs.observe(el);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
