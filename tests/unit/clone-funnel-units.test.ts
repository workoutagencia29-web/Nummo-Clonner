/**
 * Clonar o funil inteiro — regras puras: o que a página leva a clonar
 * (discover.ts), que etapa ela é (classify.ts), quiz que só muda o número no
 * endereço (sameStepPage) e o mapa do funil da revisão (funnel-map-logic.ts).
 */
import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import {
  funnelLevels,
  funnelProgress,
  funnelSummary,
  type MapNode,
  visibleChildren,
} from "@/app/(painel)/clonar/[jobId]/funnel-map-logic";
import type { CloneStatus } from "@/server/services/clone";
import { sameStepPage } from "@/worker/clone/capture";
import { cepShimScript, pageUsesCep } from "@/worker/clone/cep";
import { classifyPage } from "@/worker/clone/classify";
import { discoverPageLinks, pathsInCode } from "@/worker/clone/discover";

const PAGE = "https://loja.exemplo.com.br/quiz";

function links(html: string, extra: Partial<Parameters<typeof discoverPageLinks>[0]> = {}) {
  return discoverPageLinks({ $: cheerio.load(html), pageUrl: PAGE, checkoutUrls: [], ...extra });
}
const paths = (list: { url: string }[]) => list.map((l) => new URL(l.url).pathname);

describe("pathsInCode — endereços no código da página", () => {
  it("navegação explícita, propriedades de rota e endereços absolutos", () => {
    const found = pathsInCode(`
      document.getElementById("fim").onclick = function () { window.location.href = "/roleta"; };
      location.assign('/loja/');
      window.open("https://loja.exemplo.com.br/brinde", "_blank");
      navigate("/produto/camiseta");
      router.push('/obrigado');
      history.pushState({}, "", "/etapa-final");
      const routes = [{ path: "/vitrine", element: x }, { path: "/produto/:id" }, { path: "*" }];
      const json = {"href":"\\/ofertas\\/kit"};
      const tpl = \`/produto/\${id}\`;
    `);
    const byUrl = Object.fromEntries(found.map((f) => [f.url, f.strong]));
    expect(byUrl).toMatchObject({
      "/roleta": true,
      "/loja/": true,
      "https://loja.exemplo.com.br/brinde": true,
      "/produto/camiseta": true,
      "/obrigado": true,
      "/etapa-final": true,
      "/vitrine": false,
      "/ofertas/kit": false,
    });
    // Rota com parâmetro, curinga e template nunca viram endereço.
    expect(found.map((f) => f.url)).not.toContain("/produto/:id");
    expect(found.some((f) => f.url.includes("${"))).toBe(false);
    expect(found.map((f) => f.url)).not.toContain("*");
  });

  it("caminhos que não parecem página ficam de fora", () => {
    const found = pathsInCode(
      `fetch("/api/respostas"); const a = { url: "data:image/png;base64,AAA" }; x.replace("/", "");`,
    );
    // fetch() não é navegação; a API e o "/" sozinho ficam de fora.
    expect(found.map((f) => f.url)).toEqual([]);
  });
});

describe("discoverPageLinks — páginas do mesmo site a que a página leva", () => {
  it("links do conteúdo entram; outro site, checkout, arquivos, legais, conta, carrinho e busca não", () => {
    const found = links(
      `
      <a href="/roleta">Girar a roleta</a>
      <a href="https://outro.com/x">Outro site</a>
      <a href="https://pay.hotmart.com/X">Comprar</a>
      <a href="/ebook.pdf">Baixar</a>
      <a href="/politica-de-privacidade">Política</a>
      <a href="/minha-conta">Minha conta</a>
      <a href="/carrinho">Carrinho</a>
      <a href="/busca?q=x">Buscar</a>
      <a href="#topo">Topo</a>
      <a href="/quiz">A própria página</a>
      <a href="https://checkout.exemplo.com.br/pagar">Pagar</a>
    `,
      { checkoutUrls: ["https://checkout.exemplo.com.br/pagar"] },
    );
    expect(paths(found)).toEqual(["/roleta"]);
    expect(found[0]).toMatchObject({ label: "Girar a roleta", via: "link" });
  });

  it("subdomínio do mesmo site conta; cabeçalho e rodapé ficam marcados", () => {
    const found = links(`
      <header><a href="/novidades">Novidades</a></header>
      <main><a href="https://up.loja.exemplo.com.br/oferta">Oferta</a></main>
    `);
    expect(found.find((l) => l.url.includes("novidades"))?.nav).toBe(true);
    expect(found.find((l) => l.url.includes("up.loja"))?.nav).toBeUndefined();
  });

  it("cartões de produto: link com foto e preço, bloco com links separados e cartão por onclick", () => {
    const found = links(`
      <a class="card" href="/produto/a"><img src="a.png" alt=""><h3>Camiseta Azul</h3><span>R$ 79,90</span></a>
      <div class="produto">
        <a href="/produto/b"><img src="b.png" alt="Bermuda"></a>
        <h3><a href="/produto/b">Bermuda Jeans</a></h3>
        <p class="preco">R$ 119,90</p>
      </div>
      <div class="card" onclick="location.href='/produto/c'"><img src="c.png" alt=""><h3>Boné Preto</h3><p>R$ 59,90</p></div>
      <section><a href="/produto/d">Ver</a><a href="/produto/e">Ver</a><p>R$ 10,00</p><img src="x.png"></section>
    `);
    const product = (p: string) => found.find((l) => l.url.endsWith(p));
    expect(product("/produto/a")).toMatchObject({ product: true, label: "Camiseta Azul" });
    expect(product("/produto/b")).toMatchObject({ product: true, label: "Bermuda Jeans" });
    expect(product("/produto/c")).toMatchObject({ product: true, label: "Boné Preto" });
    // Uma seção que leva a dois lugares não é um cartão.
    expect(product("/produto/d")?.product).toBeUndefined();
  });

  it("ordem: clique do robô, upsell/obrigado, produtos, código, links e cabeçalho", () => {
    const found = links(
      `
      <header><a href="/institucional">Quem somos</a></header>
      <a href="/novidades">Novidades</a>
      <a href="/obrigado">Obrigado</a>
      <a href="/produto/x"><img src="x.png"><b>Produto X</b> R$ 9,90</a>
      <script>document.querySelector("b").onclick = function () { location.href = "/segredo"; };</script>
    `,
      { clicks: [{ url: "https://loja.exemplo.com.br/roleta", label: "Ver meu resultado" }] },
    );
    expect(paths(found)).toEqual(["/roleta", "/obrigado", "/produto/x", "/segredo", "/novidades", "/institucional"]);
    expect(found[0]).toMatchObject({ via: "click", label: "Ver meu resultado" });
    expect(found.find((l) => l.url.endsWith("/obrigado"))?.kind).toBe("THANK_YOU");
  });

  it("o nome do cartão vale mais que o texto do clique (o robô clicou no cartão)", () => {
    const found = links(`<div onclick="location.href='/produto/y'"><img src="y.png"><h4>Tênis</h4> R$ 200,00</div>`, {
      clicks: [{ url: "https://loja.exemplo.com.br/produto/y", label: "Tênis R$ 200,00" }],
    });
    expect(found).toEqual([
      { url: "https://loja.exemplo.com.br/produto/y", label: "Tênis", via: "click", product: true },
    ]);
  });

  it("scripts do próprio site: rotas e destinos com cara de página", () => {
    const found = links("<div id=app></div>", {
      scripts: [{ text: 'const r=[{path:"/roleta"},{path:"/loja"},{to:"/produto/kit-verao"},{path:"/x/y/z/w"}];' }],
    });
    expect(paths(found)).toEqual(["/roleta", "/loja", "/produto/kit-verao"]);
    expect(found.every((l) => l.via === "code")).toBe(true);
  });

  it("página importada (ZIP/HTML colado sem link) não tem para onde ir", () => {
    expect(
      discoverPageLinks({
        $: cheerio.load('<a href="/roleta">x</a>'),
        pageUrl: "http://importado.offerstudio/index.html",
        checkoutUrls: [],
      }),
    ).toEqual([]);
  });
});

describe("classifyPage — que etapa do funil é a página", () => {
  const classify = (html: string, url = PAGE, extra: Partial<Parameters<typeof classifyPage>[0]> = {}) =>
    classifyPage({
      $: cheerio.load(html),
      pageUrl: url,
      links: [],
      hasCheckout: false,
      isVsl: false,
      ...extra,
    });

  it("quiz: palavras de quiz com opções, ou o endereço", () => {
    expect(
      classify(
        `<h1>Responda o quiz</h1><p>Pergunta 1 de 5</p><div><button class="op">Sim</button><button class="op">Não</button><button class="op">Às vezes</button></div>`,
        "https://x.com/",
      ),
    ).toEqual({ kind: "QUIZ", name: "Quiz" });
    expect(classify("<p>oi</p>", "https://x.com/quiz").kind).toBe("QUIZ");
  });

  it("roleta: palavras de roleta com a roda desenhada", () => {
    expect(
      classify(`<h1>Gire a roleta e ganhe</h1><canvas></canvas><button>Girar</button>`, "https://x.com/premio"),
    ).toEqual({
      kind: "WHEEL",
      name: "Roleta",
    });
    // Sem a roda, "roleta" no texto não basta.
    expect(classify(`<p>Gire a roleta na próxima página</p>`, "https://x.com/premio").kind).not.toBe("WHEEL");
  });

  it("loja: 3 ou mais cartões de produto", () => {
    const products = ["a", "b", "c"].map((p) => ({
      url: `https://x.com/p/${p}`,
      label: p,
      via: "link" as const,
      product: true,
    }));
    expect(classify("<h1>Ofertas</h1>", "https://x.com/ofertas-do-dia", { links: products }).kind).toBe("STORE");
  });

  it("produto: título, preço e botão de compra; o nome é o h1", () => {
    expect(
      classify(`<h1>Kit Verão Completo</h1><p>R$ 149,90</p><a href="#">Comprar agora</a>`, "https://x.com/kit"),
    ).toEqual({ kind: "PRODUCT", name: "Kit Verão Completo" });
  });

  it("obrigado/upsell pelo endereço; captura; VSL; vendas", () => {
    expect(classify("<h1>Pronto!</h1>", "https://x.com/obrigado").kind).toBe("THANK_YOU");
    expect(classify("<h1>Espere!</h1>", "https://x.com/upsell-1").kind).toBe("UPSELL");
    expect(classify(`<h1>Receba o e-book</h1><form><input type="email"></form>`, "https://x.com/ebook").kind).toBe(
      "CAPTURE",
    );
    expect(classify("<h1>Assista</h1>", "https://x.com/v", { isVsl: true }).kind).toBe("VSL");
    expect(classify("<h1>Método</h1>", "https://x.com/m", { hasCheckout: true })).toEqual({ kind: "SALES", name: "" });
  });
});

describe("sameStepPage — o quiz que só troca o número da etapa no endereço", () => {
  it("mesma página com outra etapa", () => {
    expect(sameStepPage("https://x.com/quiz/2", "https://x.com/quiz")).toBe(true);
    expect(sameStepPage("https://x.com/quiz?etapa=3", "https://x.com/quiz?etapa=2")).toBe(true);
    expect(sameStepPage("https://x.com/etapa-2", "https://x.com/etapa-1")).toBe(true);
  });
  it("outra página", () => {
    expect(sameStepPage("https://x.com/roleta", "https://x.com/quiz")).toBe(false);
    expect(sameStepPage("https://x.com/quiz", "https://x.com/quiz")).toBe(false);
    expect(sameStepPage("https://y.com/quiz/2", "https://x.com/quiz/1")).toBe(false);
  });
});

describe("mapa do funil da revisão", () => {
  type Child = CloneStatus["children"][number];
  const child = (c: Partial<Child> & Pick<Child, "id">): Child => ({
    status: "REVIEW",
    progress: 100,
    step: null,
    sourceUrl: `https://x.com/${c.id}`,
    errorMessage: null,
    title: "Mesmo título",
    devices: ["desktop"],
    matchKey: `x.com/${c.id}`,
    from: "root",
    depth: 1,
    order: 0,
    via: "link",
    linkLabel: "",
    product: false,
    kind: null,
    name: "",
    finalKey: `x.com/${c.id}`,
    suggestedMode: "EDITABLE",
    thumbnailKey: null,
    duplicate: false,
    checkouts: 0,
    checkoutPlatform: null,
    exploreStop: null,
    ...c,
  });
  const root: MapNode = {
    id: "root",
    root: true,
    status: "REVIEW",
    progress: 100,
    name: "Quiz do estilo",
    kind: "QUIZ",
    url: "https://x.com/",
    thumbnailKey: null,
    suggestedMode: "PRESERVE_JS",
    from: null,
    depth: 0,
    order: 0,
    via: "",
    linkLabel: "",
    errorMessage: null,
    checkouts: 0,
    checkoutPlatform: null,
    exploreStop: null,
    devices: ["desktop"],
    product: false,
  };
  const children = [
    child({ id: "roleta", kind: "WHEEL", name: "Roleta", via: "click", linkLabel: "Ver meu resultado" }),
    child({ id: "loja", kind: "STORE", name: "Loja", from: "roleta", depth: 2, via: "click", linkLabel: "Resgatar" }),
    child({ id: "p2", from: "loja", depth: 3, order: 1, product: true, status: "RUNNING", progress: 40, title: null }),
    child({ id: "p1", kind: "PRODUCT", name: "Camiseta", from: "loja", depth: 3, order: 0, product: true }),
    child({ id: "p3", kind: "PRODUCT", name: "Boné", from: "loja", depth: 3, order: 2, product: true }),
    child({ id: "dup", from: "loja", depth: 3, status: "FAILED", duplicate: true }),
    child({ id: "cancelada", from: "loja", depth: 3, status: "CANCELED" }),
  ];

  it("etapas em ordem, com o texto da seta e os produtos juntos", () => {
    const levels = funnelLevels(root, children);
    expect(levels.map((l) => [l.pages.map((p) => p.id), l.products.map((p) => p.id), l.arrow])).toEqual([
      [["root"], [], ""],
      [["roleta"], [], "Botão “Ver meu resultado”"],
      [["loja"], [], "Botão “Resgatar”"],
      [[], ["p1", "p2", "p3"], "3 produtos"],
    ]);
    // Ainda clonando, sem tipo nem título: o nome é o caminho.
    expect(levels[3].products[1]).toMatchObject({ name: "/p2", product: true });
    expect(funnelSummary(levels)).toBe("Quiz → Roleta → Loja → 3 produtos");
  });

  it("progresso conta a principal e ignora repetidas e canceladas", () => {
    expect(funnelProgress(children)).toEqual({ ready: 5, total: 6, running: 1, failed: 0 });
    expect(visibleChildren(children).map((c) => c.id)).not.toContain("dup");
  });

  it("aviso no quiz/roleta sem próxima página: parou no contato ou não achou o botão", () => {
    const quiz = { ...root, exploreStop: "contact" };
    const [first] = funnelLevels(quiz, []);
    expect(first.pages[0].note).toMatch(/pede e-mail ou telefone/);
    const levels = funnelLevels({ ...root, exploreStop: "navigated" }, [
      child({ id: "r", kind: "WHEEL", exploreStop: "stuck" }),
    ]);
    expect(levels[0].pages[0].note).toBeUndefined();
    expect(levels[1].pages[0].note).toMatch(/não achou para onde/);
  });

  it("nova tentativa de uma página que falhou substitui a falha", () => {
    const retry = [
      child({ id: "a1", sourceUrl: "https://x.com/a", matchKey: "x.com/a", status: "FAILED" }),
      child({ id: "a2", sourceUrl: "https://x.com/a", matchKey: "x.com/a", status: "QUEUED" }),
    ];
    expect(visibleChildren(retry).map((c) => c.id)).toEqual(["a2"]);
  });
});

describe("atalho de CEP (cep.ts)", () => {
  it("pageUsesCep reconhece serviço, campo de CEP e CEP no texto com fetch", () => {
    expect(pageUsesCep('<script>fetch("https://viacep.com.br/ws/01001000/json/")</script>')).toBe(true);
    expect(pageUsesCep('<input name="cep_entrega" placeholder="Seu CEP">')).toBe(true);
    expect(pageUsesCep("<p>Digite seu CEP</p><script>$.get(url)</script>")).toBe(true);
    expect(pageUsesCep("<h1>Oferta</h1><p>Compre agora</p>")).toBe(false);
    expect(pageUsesCep("<p>aceito</p>")).toBe(false);
  });

  it("cepShimScript embute os hosts originais sem www e é ES5 (sem arrow/let/const no corpo)", () => {
    const script = cepShimScript(["www.loja.com.br", "loja.com.br"]);
    expect(script).toContain('["loja.com.br"]');
    expect(script).toContain("window.fetch");
    expect(script).toContain("window.XMLHttpRequest");
    expect(script).toContain("brasilapi.com.br");
    expect(script).toContain("viacep.com.br");
    // Alvo Safari 13: nada de arrow function nem let/const soltos no script da página.
    expect(script).not.toMatch(/=>/);
    expect(script).not.toMatch(/\b(?:let|const)\s/);
  });
});
