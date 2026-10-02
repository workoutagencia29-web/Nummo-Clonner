/* Imita styled-components em produção: regras inseridas direto no CSSOM (o <style> continua vazio). */
(function () {
  var tag = document.querySelector("style[data-styled]");
  var sheet = tag.sheet;
  var regras = [
    ".sc-raiz.sc-a1b2c3{display:block;min-height:100vh;}",
    ".sc-topo.sc-d4e5f6{background:#3e2723;padding:16px;text-align:center;}",
    ".sc-conteudo.sc-g7h8i9{max-width:880px;margin:0 auto;padding:32px 16px;display:grid;gap:24px;}",
    ".sc-titulo.sc-j1k2l3{color:#3e2723;font-size:2.25rem;text-align:center;}",
    "oferta-card{display:block;}",
    "@media (max-width: 600px){.sc-titulo.sc-j1k2l3{font-size:1.6rem;}}",
    ".sc-raiz.sc-a1b2c3{background-image:url(img/grao-fundo.png);background-repeat:repeat;}",
  ];
  regras.forEach(function (r) {
    sheet.insertRule(r, sheet.cssRules.length);
  });
})();
