// Site-aplicativo: uma página só, a tela sai do location.pathname e a navegação é por pushState.
var produtos = [
  { id: "camiseta-azul", nome: "Camiseta Azul", preco: "R$ 79,90", img: "/img/camiseta.svg" },
  { id: "bermuda-jeans", nome: "Bermuda Jeans", preco: "R$ 119,90", img: "/img/bermuda.svg" },
  { id: "tenis-branco", nome: "Tênis Branco", preco: "R$ 249,90", img: "/img/tenis.svg" }
];
var app = document.getElementById("app");
function go(path) {
  history.pushState({}, "", path);
  render();
}
window.addEventListener("popstate", render);

function quiz() {
  app.innerHTML =
    '<main class="quiz"><h1>Descubra o seu estilo</h1><p>Responda o quiz.</p><button class="cta" type="button">Começar o quiz</button></main>';
  app.querySelector("button").onclick = function () {
    pergunta(0);
  };
}
var perguntas = [
  ["Qual peça você mais usa?", ["Camiseta", "Bermuda", "Tênis"]],
  ["Qual cor você prefere?", ["Azul", "Preto", "Branco"]]
];
function pergunta(i) {
  var q = perguntas[i];
  var html = '<main class="quiz"><p>Pergunta ' + (i + 1) + "</p><h2>" + q[0] + '</h2><div class="opcoes">';
  for (var j = 0; j < q[1].length; j++) html += '<div class="opcao" role="button">' + q[1][j] + "</div>";
  app.innerHTML = html + "</div></main>";
  var ops = app.querySelectorAll(".opcao");
  for (var k = 0; k < ops.length; k++) {
    ops[k].onclick = function () {
      if (i + 1 < perguntas.length) pergunta(i + 1);
      else {
        app.innerHTML = '<main class="quiz"><p>Analisando suas respostas…</p></main>';
        setTimeout(function () {
          app.innerHTML =
            '<main class="quiz"><h2>Seu estilo é Casual!</h2><button class="cta" type="button">Ver meu resultado</button></main>';
          app.querySelector("button").onclick = function () {
            go("/roleta");
          };
        }, 800);
      }
    };
  }
}
function roleta() {
  app.innerHTML =
    '<main class="roleta"><h1>Gire a roleta e ganhe</h1><canvas width="200" height="200"></canvas><button class="cta" type="button" id="girar">Girar a roleta</button><div class="modal" id="premio"><h2>Você ganhou 30% OFF</h2><button class="cta" type="button" id="resgatar">Resgatar meu desconto</button></div></main>';
  document.getElementById("girar").onclick = function () {
    setTimeout(function () {
      document.getElementById("premio").className = "modal aberto";
    }, 1000);
  };
  document.getElementById("resgatar").onclick = function () {
    go("/loja");
  };
}
function loja() {
  var html = '<main class="loja"><h1>Ofertas com 30% OFF</h1><div class="cards">';
  for (var i = 0; i < produtos.length; i++) {
    var p = produtos[i];
    html +=
      '<div class="card" data-id="' + p.id + '"><img src="' + p.img + '" alt=""><h3>' + p.nome + '</h3><p class="preco">' + p.preco + "</p></div>";
  }
  app.innerHTML = html + "</div></main>";
  var cards = app.querySelectorAll(".card");
  for (var k = 0; k < cards.length; k++) {
    cards[k].onclick = function () {
      go("/produto/" + this.getAttribute("data-id"));
    };
  }
}
function produto(id) {
  var p = produtos.filter(function (x) {
    return x.id === id;
  })[0];
  if (!p) return naoAchou();
  app.innerHTML =
    '<main class="produto"><a href="/loja" id="voltar">‹ Voltar para a loja</a><img src="' + p.img + '" alt=""><h1>' + p.nome + '</h1><p class="preco">' + p.preco + '</p><a class="cta" href="https://pay.hotmart.com/E99999999?off=' + p.id + '">Comprar agora</a></main>';
  document.getElementById("voltar").onclick = function (e) {
    e.preventDefault();
    go("/loja");
  };
}
function naoAchou() {
  app.innerHTML = "<main><h1>Página não encontrada</h1></main>";
}
function render() {
  var path = location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/") quiz();
  else if (path === "/roleta") roleta();
  else if (path === "/loja") loja();
  else if (path.indexOf("/produto/") === 0) produto(path.slice(9));
  else naoAchou();
}
render();
