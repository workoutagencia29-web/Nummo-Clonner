/**
 * Robô que clica pela página (clonar o funil inteiro), no Chromium de verdade,
 * com páginas servidas de um site virtual (sem rede): etapa que pede e-mail
 * (para sem digitar contato), quiz dentro de um web component (shadow DOM),
 * botão que abre outra janela e página longa de vendas (não explora).
 */
import * as cheerio from "cheerio";
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { capturePage, type VirtualSite } from "@/worker/clone/capture";

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

const ORIGIN = "http://funil.offerstudio";

function site(pages: Record<string, string>): VirtualSite {
  return {
    origin: ORIGIN,
    get(pathname) {
      const html = pages[pathname];
      return html ? { body: Buffer.from(html), contentType: "text/html; charset=utf-8" } : null;
    },
  };
}

async function explore(pages: Record<string, string>, path = "/") {
  return capturePage({
    browser,
    device: "desktop",
    url: `${ORIGIN}${path}`,
    log: () => {},
    virtualSite: site(pages),
    explore: true,
    exploreMs: 30_000,
    maxScrollMs: 1000,
  });
}

describe("robô que clica pela página", () => {
  it("responde o nome, para na etapa que pede e-mail e nunca digita contato", async () => {
    const capture = await explore({
      "/": `<!doctype html><html><body><main id="q">
        <h1>Quiz: pergunta 1</h1>
        <div><button class="op">Sim</button><button class="op">Não</button></div>
      </main>
      <script>
        var q = document.getElementById("q");
        q.querySelector("button").onclick = function () {
          q.innerHTML = '<h2>Pergunta 2: qual o seu nome?</h2><input id="nome" required placeholder="Seu nome"><button id="ok">Continuar</button>';
          document.getElementById("ok").onclick = function () {
            if (!document.getElementById("nome").value) return;
            window.__nome = document.getElementById("nome").value;
            q.innerHTML = '<h2>Para ver o resultado, informe seu e-mail</h2><input type="email" id="email" required><button id="ver">Ver resultado</button>';
            document.getElementById("ver").onclick = function () { location.href = "/resultado"; };
          };
        };
      </script></body></html>`,
    });
    expect(capture.explored).toMatchObject({ stop: "contact", navigations: [] });
    // A cópia é da tela inicial (o robô roda depois dela).
    const shown = cheerio.load(capture.renderedHtml)("#q").text();
    expect(shown).toContain("Quiz: pergunta 1");
    expect(shown).not.toContain("e-mail");
  }, 90_000);

  it("quiz dentro de um web component (shadow DOM) chega ao fim e anota a próxima página", async () => {
    const capture = await explore({
      "/": `<!doctype html><html><body><quiz-box></quiz-box>
      <script>
        customElements.define("quiz-box", class extends HTMLElement {
          connectedCallback() {
            var root = this.attachShadow({ mode: "open" });
            var step = 0;
            var render = function () {
              if (step < 2) {
                root.innerHTML = '<p>Pergunta ' + (step + 1) + '</p><div><button class="op">A</button><button class="op">B</button><button class="op">C</button></div>';
                root.querySelector("button").onclick = function () { step++; render(); };
              } else {
                root.innerHTML = '<p>Pronto!</p><button id="fim">Ver meu resultado</button>';
                root.getElementById("fim").onclick = function () { location.assign("/roleta"); };
              }
            };
            render();
          }
        });
      </script></body></html>`,
    });
    expect(capture.explored?.stop).toBe("navigated");
    expect(capture.explored?.navigations).toEqual([{ url: `${ORIGIN}/roleta`, label: "Ver meu resultado" }]);
  }, 90_000);

  it("botão que abre outra janela: a página nova é anotada e a janela fechada", async () => {
    const capture = await explore({
      "/": `<!doctype html><html><body><h1>Gire a roleta</h1><canvas></canvas>
        <button id="g">Girar a roleta</button>
        <script>document.getElementById("g").onclick = function () { window.open("/loja/?premio=30", "_blank"); };</script>
      </body></html>`,
    });
    expect(capture.explored?.navigations).toEqual([{ url: `${ORIGIN}/loja/?premio=30`, label: "Girar a roleta" }]);
  }, 90_000);

  it("roleta que só redireciona depois de dois giros (sem mudar o texto entre eles)", async () => {
    const capture = await explore({
      "/": `<!doctype html><html><body><main>
        <h1>Gire a roleta e ganhe seu desconto</h1>
        <canvas id="roda" width="200" height="200"></canvas>
        <button id="girar">Girar a roleta</button>
      </main>
      <script>
        var giros = 0;
        document.getElementById("girar").onclick = function () {
          giros++;
          // Só gira (anima a roda); o texto da tela não muda entre um giro e outro.
          document.getElementById("roda").style.transform = "rotate(" + (giros * 1080) + "deg)";
          if (giros >= 2) setTimeout(function () { location.href = "/loja"; }, 500);
        };
      </script></body></html>`,
    });
    expect(capture.explored?.navigations).toEqual([{ url: `${ORIGIN}/loja`, label: "Girar a roleta" }]);
  }, 90_000);

  it("botão que só aparece depois de alguns segundos (delay)", async () => {
    const capture = await explore({
      "/": `<!doctype html><html><body><main id="m"><h1>Sua oferta está sendo preparada…</h1></main>
      <script>
        setTimeout(function () {
          document.getElementById("m").innerHTML = '<h1>Pronto!</h1><button id="go">Acessar minha oferta</button>';
          document.getElementById("go").onclick = function () { location.href = "/oferta"; };
        }, 4000);
      </script></body></html>`,
    });
    expect(capture.explored?.navigations).toEqual([{ url: `${ORIGIN}/oferta`, label: "Acessar minha oferta" }]);
  }, 90_000);

  it("campo de CEP: preenche um CEP genérico (não é contato), a API completa o endereço e o funil segue", async () => {
    const capture = await explore({
      "/": `<!doctype html><html><body><main>
        <h1>Calcule o frete para o seu endereço</h1>
        <label>CEP <input id="cep" name="cep" placeholder="Seu CEP"></label>
        <p id="endereco"></p>
        <button id="continuar" style="display:none">Continuar para os produtos</button>
      </main>
      <script>
        var cep = document.getElementById("cep");
        cep.addEventListener("blur", function () {
          if ((cep.value || "").replace(/\\D/g, "").length !== 8) return;
          // Simula a API de CEP preenchendo o endereço e liberando o botão.
          document.getElementById("endereco").textContent = "Praça da Sé, São Paulo/SP";
          document.getElementById("continuar").style.display = "";
          document.getElementById("continuar").onclick = function () { location.href = "/produtos"; };
        });
      </script></body></html>`,
    });
    // Não parou por "contato" e chegou à próxima página.
    expect(capture.explored?.stop).toBe("navigated");
    expect(capture.explored?.navigations).toEqual([{ url: `${ORIGIN}/produtos`, label: "Continuar para os produtos" }]);
  }, 90_000);

  it("campo de e-mail continua sendo contato: o robô não preenche e para", async () => {
    const capture = await explore({
      "/": `<!doctype html><html><body><main>
        <h1>Receba a oferta</h1>
        <input type="email" placeholder="Seu e-mail">
        <button id="go">Continuar</button>
      </main>
      <script>document.getElementById("go").onclick = function () { location.href = "/x"; };</script></body></html>`,
    });
    expect(capture.explored?.stop).toBe("contact");
    expect(capture.explored?.navigations).toEqual([]);
  }, 90_000);

  it("página de vendas longa não é explorada", async () => {
    const long = "<p>Texto da página de vendas com muitos detalhes do produto.</p>".repeat(120);
    const capture = await explore({
      "/": `<!doctype html><html><body><h1>Método</h1>${long}<button onclick="location.href='/x'">Comprar</button></body></html>`,
    });
    expect(capture.explored).toBeUndefined();
  }, 90_000);
});
