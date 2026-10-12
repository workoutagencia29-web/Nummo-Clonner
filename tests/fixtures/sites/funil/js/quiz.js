// Quiz montado por script: as perguntas só existem aqui.
(function () {
  var perguntas = [
    { titulo: "Qual peça você mais usa?", opcoes: ["Camiseta", "Bermuda", "Tênis", "Boné"] },
    { titulo: "Qual cor você prefere?", opcoes: ["Azul", "Preto", "Branco"] },
    { titulo: "Onde você compra roupa?", opcoes: ["Internet", "Shopping", "Feira"] }
  ];
  var etapa = document.getElementById("etapa");
  function pergunta(i) {
    var p = perguntas[i];
    var html = '<p class="contador">Pergunta ' + (i + 1) + " de " + perguntas.length + "</p><h2>" + p.titulo + '</h2><div class="opcoes">';
    for (var j = 0; j < p.opcoes.length; j++) html += '<div class="opcao" role="button" tabindex="0">' + p.opcoes[j] + "</div>";
    etapa.innerHTML = html + "</div>";
    var botoes = etapa.querySelectorAll(".opcao");
    for (var k = 0; k < botoes.length; k++) {
      botoes[k].addEventListener("click", function () {
        if (i + 1 < perguntas.length) pergunta(i + 1);
        else analisando();
      });
    }
  }
  function analisando() {
    etapa.innerHTML = '<p class="analise">Analisando suas respostas…</p>';
    setTimeout(function () {
      etapa.innerHTML =
        '<h2>Seu estilo é Casual Urbano!</h2><p>Você ganhou um giro na roleta de descontos.</p><button class="cta" type="button" id="resultado">Ver meu resultado</button>';
      document.getElementById("resultado").addEventListener("click", function () {
        window.location.href = "/roleta";
      });
    }, 1200);
  }
  document.getElementById("comecar").addEventListener("click", function () {
    pergunta(0);
  });
})();
