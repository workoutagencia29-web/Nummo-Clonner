/* Quiz em JavaScript puro: 5 perguntas + resultado. Só a etapa atual existe no DOM. */
(function () {
  var PERGUNTAS = [
    {
      titulo: "Qual é o seu sexo?",
      imagem: "img/etapa-1.png",
      opcoes: ["Feminino", "Masculino"],
    },
    {
      titulo: "Qual é a sua faixa de idade?",
      imagem: "img/etapa-2.png",
      opcoes: ["18 a 29 anos", "30 a 39 anos", "40 a 49 anos", "50 anos ou mais"],
    },
    {
      titulo: "Quantas vezes por semana você pratica atividade física?",
      imagem: "img/etapa-3.png",
      opcoes: ["Nenhuma", "1 a 2 vezes", "3 a 4 vezes", "5 ou mais"],
    },
    {
      titulo: "Como é o seu sono?",
      imagem: "img/etapa-4.png",
      opcoes: ["Durmo bem", "Acordo cansada(o)", "Tenho insônia"],
    },
    {
      titulo: "Qual é o seu principal objetivo?",
      imagem: "img/etapa-5.png",
      opcoes: ["Perder barriga", "Ter mais disposição", "Controlar a ansiedade por doces"],
    },
  ];

  var PERFIS = [
    { nome: "Metabolismo Lento", texto: "Seu corpo está economizando energia. O protocolo de 21 dias acelera a queima em até 3 semanas." },
    { nome: "Metabolismo Travado", texto: "Hormônios e sono estão segurando seu resultado. Comece pelo protocolo noturno." },
    { nome: "Metabolismo Irregular", texto: "Você tem picos de fome. O cardápio anti-ansiedade vai equilibrar seu dia." },
  ];

  var config = window.QUIZ_CONFIG || { checkout: "#", etapas: PERGUNTAS.length };
  var respostas = [];
  var atual = 0;
  var container = document.getElementById("etapas");
  var barra = document.querySelector(".progresso-barra");
  var progresso = document.querySelector(".progresso");
  var textoEtapa = document.getElementById("etapa-atual");

  function atualizarProgresso() {
    var total = PERGUNTAS.length;
    var feitas = Math.min(atual + 1, total);
    barra.style.width = Math.round((feitas / total) * 100) + "%";
    progresso.setAttribute("aria-valuenow", String(feitas));
    textoEtapa.textContent = String(feitas);
  }

  function renderPergunta() {
    var p = PERGUNTAS[atual];
    var html = '<section class="etapa ativa" data-etapa="' + (atual + 1) + '">';
    html += '<img src="' + p.imagem + '" alt="" width="120" height="120">';
    html += "<h1>" + p.titulo + "</h1>";
    html += '<div class="opcoes">';
    p.opcoes.forEach(function (o, i) {
      html += '<button type="button" class="opcao" data-indice="' + i + '">' + o + "</button>";
    });
    html += "</div>";
    if (atual > 0) html += '<button type="button" class="voltar">Voltar</button>';
    html += "</section>";
    container.innerHTML = html;
    atualizarProgresso();
  }

  function renderResultado() {
    var soma = respostas.reduce(function (a, b) {
      return a + b;
    }, 0);
    var perfil = PERFIS[soma % PERFIS.length];
    barra.style.width = "100%";
    document.querySelector(".progresso-texto").textContent = "Resultado pronto!";
    container.innerHTML =
      '<section class="etapa ativa resultado" data-etapa="resultado">' +
      '<img src="img/resultado.jpg" alt="" width="480" height="270">' +
      "<h1>Seu perfil: " +
      perfil.nome +
      "</h1>" +
      "<p>" +
      perfil.texto +
      "</p>" +
      '<a class="botao-resultado" href="' +
      config.checkout +
      '">Quero meu protocolo personalizado</a>' +
      "</section>";
  }

  container.addEventListener("click", function (e) {
    var alvo = e.target;
    if (!(alvo instanceof HTMLElement)) return;
    if (alvo.classList.contains("opcao")) {
      respostas[atual] = Number(alvo.getAttribute("data-indice"));
      atual += 1;
      if (atual >= PERGUNTAS.length) renderResultado();
      else renderPergunta();
    } else if (alvo.classList.contains("voltar")) {
      atual = Math.max(0, atual - 1);
      renderPergunta();
    }
  });

  renderPergunta();
})();
