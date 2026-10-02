/* Contador "evergreen": cada visitante tem N minutos a partir da primeira visita. */
(function () {
  var el = document.getElementById("contador");
  if (!el) return;
  var minutos = Number(el.getAttribute("data-minutos") || 15);
  var chave = "oferta_prazo_" + minutos;
  var prazo;
  try {
    prazo = Number(localStorage.getItem(chave));
    if (!prazo) {
      prazo = Date.now() + minutos * 60 * 1000;
      localStorage.setItem(chave, String(prazo));
    }
  } catch (e) {
    prazo = Date.now() + minutos * 60 * 1000;
  }

  function doisDigitos(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function atualizar() {
    var resto = Math.max(0, Math.floor((prazo - Date.now()) / 1000));
    el.querySelector('[data-unidade="h"]').textContent = doisDigitos(Math.floor(resto / 3600));
    el.querySelector('[data-unidade="m"]').textContent = doisDigitos(Math.floor((resto % 3600) / 60));
    el.querySelector('[data-unidade="s"]').textContent = doisDigitos(resto % 60);
    if (resto === 0) {
      el.classList.add("encerrado");
      clearInterval(timer);
    }
  }

  var timer = setInterval(atualizar, 1000);
  atualizar();
})();
