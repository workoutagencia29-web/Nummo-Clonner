/**
 * Funil clonado "Com scripts" (src/lib/clone-routes.ts e src/lib/export/routes.ts),
 * sem navegador:
 * - routeKey (e a mesma regra no script da página);
 * - mapa de rotas da oferta (hosts sem www, origens internas de importação
 *   ignoradas, chave repetida: fica a primeira e a página inicial ganha);
 * - rewriteScriptPageUrls: só endereços inteiros de páginas clonadas, só nos
 *   scripts inline, o resto do HTML byte a byte igual, leitura linear;
 * - o script de rotas num ambiente de mentira (location/history/window):
 *   caminho original na barra, pushState/replaceState, clique, window.open,
 *   API Navigation sem laço, raiz do ZIP numa subpasta e o <base> do file://;
 * - render: o script vai na frente de tudo no <head> (só com a opção);
 * - ZIP: rotas de cada arquivo (pasta dos endereços relativos) e os
 *   redirecionamentos nos caminhos originais livres.
 */
import vm from "node:vm";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import {
  injectRoutes,
  offerRoutes,
  originalPath,
  pageRoutes,
  ROUTE_KEY_JS,
  ROUTES_SCRIPT_ATTR,
  type RoutesScriptConfig,
  rewriteScriptPageUrls,
  routeKey,
  routePageId,
  routesScript,
} from "@/lib/clone-routes";
import { relativeDir, upPrefix } from "@/lib/export/paths";
import { planRouteRedirects, routeRedirectHtml, zipPageRoutes } from "@/lib/export/routes";
import { renderPageHtml } from "@/lib/page-render";
import { ORDER_STRIP_ATTR } from "@/lib/payments/render";

describe("routeKey", () => {
  const cases: [string, string][] = [
    ["/", "/"],
    ["", "/"],
    ["/Roleta/", "/roleta"],
    ["/roleta", "/roleta"],
    ["/loja/index.html", "/loja"],
    ["/loja/INDEX.HTM", "/loja"],
    ["/index.php", "/"],
    ["/a//b///", "/a/b"],
    ["/promo%C3%A7%C3%A3o", "/promoção"],
    ["/x%zz", "/x%zz"],
    ["roleta", "/roleta"],
    ["/roleta?x=1#y", "/roleta"],
    ["/roleta-2", "/roleta-2"],
    ["/produto/camiseta.html", "/produto/camiseta.html"],
  ];

  it("normaliza o caminho para comparar", () => {
    for (const [input, out] of cases) expect(routeKey(input), input).toBe(out);
  });

  it("o script da página usa a mesma regra", () => {
    const js = new Function(`return ${ROUTE_KEY_JS}`)() as (p: string) => string;
    for (const [input] of cases) expect(js(input), input).toBe(routeKey(input));
  });
});

describe("mapa de rotas da oferta", () => {
  it("hosts sem www, origens internas e endereços que não são http(s) ficam de fora", () => {
    const routes = offerRoutes([
      { id: "home", sourceUrl: "https://www.Loja.Exemplo.test/", isHome: true },
      { id: "roleta", sourceUrl: "http://loja.exemplo.test/roleta", isHome: false },
      { id: "zip", sourceUrl: "http://importado.offerstudio/oferta/index.html", isHome: false },
      { id: "colado", sourceUrl: "http://colado.offerstudio/", isHome: false },
      { id: "nada", sourceUrl: null, isHome: false },
      { id: "mail", sourceUrl: "mailto:a@b.com", isHome: false },
      { id: "cdn", sourceUrl: "https://cdn.exemplo.test//produto//camiseta", isHome: false },
    ]);
    expect(routes.hosts).toEqual(["loja.exemplo.test", "cdn.exemplo.test"]);
    expect(routes.pages.map((p) => [p.pageId, p.key, p.path])).toEqual([
      ["home", "/", "/"],
      ["roleta", "/roleta", "/roleta"],
      ["cdn", "/produto/camiseta", "/produto/camiseta"],
    ]);
  });

  it("chave repetida: fica a primeira — e a página inicial ganha de qualquer outra", () => {
    const routes = offerRoutes([
      { id: "a", sourceUrl: "https://site.com/roleta", isHome: false },
      { id: "b", sourceUrl: "https://site.com/Roleta/", isHome: false },
      { id: "c", sourceUrl: "https://site.com/", isHome: false },
      { id: "home", sourceUrl: "https://site.com/index.html", isHome: true },
    ]);
    const owners = routes.pages.filter((p) => p.owner).map((p) => p.pageId);
    expect(owners).toEqual(["home", "a"]);
    expect(routePageId(routes, "/ROLETA/index.html")).toBe("a");
    expect(routePageId(routes, "/")).toBe("home");
    expect(routePageId(routes, "/loja")).toBeNull();

    // A repetida não troca o endereço nem leva à outra pelo próprio caminho.
    const b = pageRoutes(routes, "b", (id) => `p/${id}`);
    expect(b?.self).toBeNull();
    expect(b?.routes).toEqual({ "/": "p/home" });
    const a = pageRoutes(routes, "a", (id) => `p/${id}`);
    expect(a).toEqual({ self: "/roleta", routes: { "/": "p/home" }, hosts: ["site.com"] });
  });

  it("caminho original de uma página", () => {
    expect(originalPath("https://site.com/produto/camiseta?x=1")).toBe("/produto/camiseta");
    expect(originalPath("https://site.com")).toBe("/");
    expect(originalPath("http://importado.offerstudio/x")).toBeNull();
    expect(originalPath("lixo")).toBeNull();
  });

  it("nada a fazer: página sem endereço numa oferta sem outras clonadas", () => {
    const routes = offerRoutes([{ id: "a", sourceUrl: null, isHome: true }]);
    expect(pageRoutes(routes, "a", (id) => `p/${id}`)).toBeNull();
  });
});

describe("rewriteScriptPageUrls", () => {
  const pages = [
    { url: "https://site.com/" },
    { url: "https://www.site.com/roleta" },
    { url: "http://site.com/loja/" },
  ];

  it("troca só os endereços inteiros das páginas, só nos scripts inline; o resto fica igual", () => {
    const before = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Quiz https://site.com/roleta</title>
<script>var a="https://site.com/roleta",b='http://www.site.com/roleta/?x=1#y',c="https://site.com/roleta-2",d="https:\\/\\/site.com\\/loja\\/",e="//site.com/loja",f="https://site.com",g="https://site.com.br/roleta",h="https://outro.com/roleta",i="https://site.com/roleta/sub",j="ftp://site.com/roleta",k="https://SITE.com/Roleta";location.href="https://site.com/roleta";</script>
<SCRIPT type="module">import("https://site.com/loja/index.html")</SCRIPT>
<script src="https://site.com/roleta.js" data-u="https://site.com/roleta"></script>
<script type="application/ld+json">{"url":"https://site.com/roleta"}</script>
<script-x>"https://site.com/roleta"</script-x>
</head><body><a href="https://site.com/roleta">x</a><div data-x="https://site.com/roleta" onclick="location.href='https://site.com/roleta'"></div>
<script>
  window.__d = {"next":"https:\\/\\/www.site.com\\/roleta\\/","outra":"https:\\/\\/site.com\\/roleta-2"};
</script></body></html>`;
    const after = rewriteScriptPageUrls(before, pages);
    const expected = before
      .replace('a="https://site.com/roleta"', 'a="/roleta"')
      .replace("b='http://www.site.com/roleta/?x=1#y'", "b='/roleta/?x=1#y'")
      .replace('d="https:\\/\\/site.com\\/loja\\/"', 'd="\\/loja\\/"')
      .replace('e="//site.com/loja"', 'e="/loja"')
      .replace('f="https://site.com"', 'f="/"')
      .replace('k="https://SITE.com/Roleta"', 'k="/Roleta"')
      .replace('location.href="https://site.com/roleta"', 'location.href="/roleta"')
      .replace('import("https://site.com/loja/index.html")', 'import("/loja/index.html")')
      .replace('"next":"https:\\/\\/www.site.com\\/roleta\\/"', '"next":"\\/roleta\\/"');
    expect(after).toBe(expected);
    // Conferências diretas do que NÃO pode mudar.
    expect(after).toContain('c="https://site.com/roleta-2"');
    expect(after).toContain('g="https://site.com.br/roleta"');
    expect(after).toContain('h="https://outro.com/roleta"');
    expect(after).toContain('i="https://site.com/roleta/sub"');
    expect(after).toContain('j="ftp://site.com/roleta"');
    expect(after).toContain('"outra":"https:\\/\\/site.com\\/roleta-2"');
    expect(after).toContain('<a href="https://site.com/roleta">');
    expect(after).toContain('{"url":"https://site.com/roleta"}');
    expect(after).toContain('<script src="https://site.com/roleta.js" data-u="https://site.com/roleta">');
  });

  it("sem página com endereço de verdade ou sem script, devolve o mesmo HTML", () => {
    const html = '<script>location.href="https://site.com/roleta"</script>';
    expect(rewriteScriptPageUrls(html, [{ url: "http://importado.offerstudio/roleta" }])).toBe(html);
    expect(rewriteScriptPageUrls("<p>https://site.com/roleta</p>", pages)).toBe("<p>https://site.com/roleta</p>");
  });

  it("leitura linear (texto enorme e cheio de barras não trava)", () => {
    const huge = `<script>${"//".repeat(200_000)}"https://site.com${"/a".repeat(100_000)}"${"https://site.com".repeat(20_000)}</script>${"<script".repeat(20_000)}`;
    const t = performance.now();
    rewriteScriptPageUrls(huge, pages);
    expect(performance.now() - t).toBeLessThan(2000);
  });
});

// ─── Script de rotas num ambiente de mentira ─────────────────────────────────

interface Fake {
  log: string[];
  url: () => string;
  win: Record<string, unknown> & {
    history: { pushState: (...a: unknown[]) => void; replaceState: (...a: unknown[]) => void };
    open: (...a: unknown[]) => unknown;
  };
  click: (href: string, prevented?: boolean) => string;
  navigate: (e: Partial<{ url: string; type: string; hashChange: boolean; cancelable: boolean }>) => boolean;
  appended: { tag: string; href: string }[];
  hasNavigate: () => boolean;
}

function run(
  config: RoutesScriptConfig,
  href: string,
  opts: { navigation?: boolean; replaceThrows?: boolean } = {},
): Fake {
  let current = new URL(href);
  const log: string[] = [];
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const nav: ((e: unknown) => void)[] = [];
  const appended: { tag: string; href: string }[] = [];
  const location = {
    get pathname() {
      return current.pathname;
    },
    get search() {
      return current.search;
    },
    get hash() {
      return current.hash;
    },
    get host() {
      return current.host;
    },
    get href() {
      return current.href;
    },
    set href(v: string) {
      log.push(`href ${new URL(v, current).href}`);
    },
    replace(v: string) {
      log.push(`replace ${new URL(v, current).href}`);
    },
  };
  const history = {
    state: null,
    replaceState(_s: unknown, _t: string, u: string) {
      if (opts.replaceThrows) throw new Error("SecurityError");
      current = new URL(u, current);
      log.push(`replaceState ${current.pathname}${current.search}${current.hash}`);
    },
    pushState(_s: unknown, _t: string, u: string) {
      current = new URL(u, current);
      log.push(`pushState ${current.pathname}${current.search}${current.hash}`);
    },
  };
  const document = {
    get baseURI() {
      return current.href;
    },
    head: { appendChild: (el: { tag: string; href: string }) => appended.push(el) },
    documentElement: {},
    createElement: (tag: string) => ({ tag, href: "" }),
  };
  const win: Record<string, unknown> = {
    location,
    history,
    document,
    URL,
    addEventListener(type: string, fn: (e: unknown) => void) {
      const list = listeners[type] ?? [];
      list.push(fn);
      listeners[type] = list;
    },
    open(...args: unknown[]) {
      log.push(`open ${String(args[0])}`);
      return null;
    },
  };
  if (opts.navigation) win.navigation = { addEventListener: (_t: string, fn: (e: unknown) => void) => nav.push(fn) };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(routesScript(config), win);
  return {
    log,
    url: () => current.href,
    win: win as Fake["win"],
    appended,
    hasNavigate: () => nav.length > 0,
    click(hrefAttr: string, prevented = false) {
      let value = hrefAttr;
      const a = { getAttribute: () => value, setAttribute: (_n: string, v: string) => (value = v) };
      for (const fn of listeners.click ?? []) fn({ defaultPrevented: prevented, target: { closest: () => a } });
      return value;
    },
    navigate({ url = "", type = "push", hashChange = false, cancelable = true }) {
      let prevented = false;
      for (const fn of nav) {
        fn({
          cancelable,
          hashChange,
          downloadRequest: null,
          formData: null,
          navigationType: type,
          destination: { url },
          preventDefault: () => {
            prevented = true;
          },
        });
      }
      return prevented;
    },
  };
}

const PREVIEW: RoutesScriptConfig = {
  self: "/roleta",
  routes: { "/loja": "p/loja1", "/": "p/home1" },
  hosts: ["loja.exemplo.test"],
};
const ORIGIN = "http://tok.localhost:3001";

describe("script de rotas (prévia)", () => {
  it("põe o caminho original na barra antes de tudo, com a query e o #", () => {
    const f = run(PREVIEW, `${ORIGIN}/p/roleta1?utm_source=fb#topo`);
    expect(f.log).toEqual(["replaceState /roleta?utm_source=fb#topo"]);
    // Já no caminho original: não troca de novo.
    expect(run(PREVIEW, `${ORIGIN}/roleta`).log).toEqual([]);
  });

  it("pushState/replaceState para outra página clonada viram navegação para a cópia", () => {
    const f = run(PREVIEW, `${ORIGIN}/p/roleta1`);
    f.log.length = 0;
    f.win.history.pushState({}, "", "/loja");
    f.win.history.pushState({}, "", "/roleta/etapa-2");
    f.win.history.replaceState({}, "", "https://www.loja.exemplo.test/loja/?x=1#y");
    f.win.history.pushState({}, "", "/");
    f.win.history.pushState({}, "", "/roleta");
    f.win.history.pushState({}, "", "https://outro.test/loja");
    expect(f.log).toEqual([
      `href ${ORIGIN}/p/loja1`,
      "pushState /roleta/etapa-2",
      `replace ${ORIGIN}/p/loja1?x=1#y`,
      `href ${ORIGIN}/p/home1`,
      "pushState /roleta",
      "pushState /loja",
    ]);
  });

  it("clique em link (sem um script da página ter cuidado dele) e window.open", () => {
    const f = run(PREVIEW, `${ORIGIN}/p/roleta1`);
    expect(f.click("https://loja.exemplo.test/loja/#ofertas")).toBe("/p/loja1#ofertas");
    expect(f.click("/loja/index.html?cor=azul")).toBe("/p/loja1?cor=azul");
    expect(f.click("https://loja.exemplo.test/loja/", true)).toBe("https://loja.exemplo.test/loja/");
    expect(f.click("#secao")).toBe("#secao");
    expect(f.click("/p/loja1")).toBe("/p/loja1");
    expect(f.click("https://pay.hotmart.com/X")).toBe("https://pay.hotmart.com/X");
    f.log.length = 0;
    f.win.open("https://loja.exemplo.test/loja", "_blank");
    f.win.open("https://pay.hotmart.com/X");
    expect(f.log).toEqual(["open /p/loja1", "open https://pay.hotmart.com/X"]);
  });

  it("API Navigation: troca o destino; a cópia, o #, voltar e a própria página passam (sem laço)", () => {
    const f = run(PREVIEW, `${ORIGIN}/p/roleta1`, { navigation: true });
    f.log.length = 0;
    expect(f.navigate({ url: "https://loja.exemplo.test/loja/" })).toBe(true);
    expect(f.navigate({ url: `${ORIGIN}/loja`, type: "replace" })).toBe(true);
    expect(f.log).toEqual([`href ${ORIGIN}/p/loja1`, `replace ${ORIGIN}/p/loja1`]);
    expect(f.navigate({ url: `${ORIGIN}/p/loja1` })).toBe(false);
    expect(f.navigate({ url: `${ORIGIN}/p/loja1/` })).toBe(false);
    expect(f.navigate({ url: `${ORIGIN}/roleta` })).toBe(false);
    expect(f.navigate({ url: `${ORIGIN}/loja#a`, hashChange: true })).toBe(false);
    expect(f.navigate({ url: `${ORIGIN}/loja`, type: "traverse" })).toBe(false);
    expect(f.navigate({ url: `${ORIGIN}/loja`, type: "reload" })).toBe(false);
    expect(f.navigate({ url: `${ORIGIN}/loja`, cancelable: false })).toBe(false);
    expect(f.navigate({ url: "https://outro.test/loja" })).toBe(false);
  });

  it("prévia de uma clonagem (sem mapa): só o caminho original, nada embrulhado", () => {
    const f = run({ self: "/quiz", routes: {}, hosts: [] }, `${ORIGIN}/`, { navigation: true });
    expect(f.log).toEqual(["replaceState /quiz"]);
    expect(f.hasNavigate()).toBe(false);
    expect(f.click("/loja")).toBe("/loja");
  });
});

describe("script de rotas (ZIP)", () => {
  const ZIP: RoutesScriptConfig = {
    self: "/produto/camiseta",
    routes: { "/roleta": "roleta-da-sorte/", "/": "" },
    hosts: ["loja.exemplo.test"],
    up: 1,
    baseDir: "produto/",
  };

  it("raiz do site calculada antes da troca (também numa subpasta)", () => {
    const f = run(ZIP, "https://meusite.com/sub/camiseta/?a=1", { navigation: true });
    expect(f.log[0]).toBe("replaceState /sub/produto/camiseta?a=1");
    f.log.length = 0;
    f.win.history.pushState({}, "", "/roleta");
    f.win.history.pushState({}, "", "https://loja.exemplo.test/");
    expect(f.log).toEqual(["href https://meusite.com/sub/roleta-da-sorte/", "href https://meusite.com/sub/"]);
    expect(f.navigate({ url: "https://meusite.com/sub/roleta-da-sorte/" })).toBe(false);
    expect(f.navigate({ url: "https://meusite.com/sub/roleta-da-sorte/index.html" })).toBe(false);
    expect(f.navigate({ url: "https://meusite.com/sub/" })).toBe(false);
    expect(f.appended).toEqual([]);
  });

  it("sem poder trocar o endereço (file://): um <base> com a pasta dos endereços relativos", () => {
    const f = run(ZIP, "file:///Users/x/zip/camiseta/index.html", { replaceThrows: true });
    expect(f.appended).toEqual([{ tag: "base", href: "/Users/x/zip/produto/" }]);
  });
});

describe("Safari 13", () => {
  it("o script de rotas e o do redirecionamento são ES5 (sem const/let, setas, crases)", () => {
    const scripts = [
      routesScript({ ...PREVIEW, up: 2, baseDir: "produto/" }),
      /<script>([\s\S]*?)<\/script>/.exec(
        routeRedirectHtml({ zipPath: "roleta/index.html", target: "../roleta-da-sorte/", pageId: "x", name: "Roleta" }),
      )?.[1] ?? "",
    ];
    for (const code of scripts) {
      expect(code.length).toBeGreaterThan(100);
      expect(() => transformSync(code, { loader: "js", target: "es5" })).not.toThrow();
      expect(code).not.toMatch(/=>|`|\b(?:const|let|class)\s/);
    }
  });
});

describe("render", () => {
  const html =
    '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Q</title><script>window.app=1</script></head><body><p>oi</p></body></html>';
  const config: RoutesScriptConfig = { self: "/roleta", routes: { "/loja": "p/x" }, hosts: ["site.com"] };
  const base = { links: [], pageHref: (id: string) => `/p/${id}`, runtimeTag: "" };

  it("o script de rotas vai no começo do <head>, na frente do ?pedido= e de qualquer script", () => {
    const out = renderPageHtml(html, {
      ...base,
      routes: config,
      payments: { endpoint: "/__os/pagamento", simulation: true, products: {}, checkout: true, scriptTag: "" },
    });
    const routesAt = out.indexOf(ROUTES_SCRIPT_ATTR);
    expect(routesAt).toBeGreaterThan(out.indexOf('name="viewport"'));
    expect(routesAt).toBeLessThan(out.indexOf(ORDER_STRIP_ATTR));
    expect(routesAt).toBeLessThan(out.indexOf("window.app=1"));
    expect(out.split(ROUTES_SCRIPT_ATTR).length).toBe(2);
  });

  it("sem a opção, a página sai como antes; script antigo é trocado pelo novo", () => {
    expect(renderPageHtml(html, base)).not.toContain(ROUTES_SCRIPT_ATTR);
    const once = injectRoutes(html, config);
    const twice = injectRoutes(once, { ...config, self: "/loja" });
    expect(twice.split(ROUTES_SCRIPT_ATTR).length).toBe(2);
    expect(twice).toContain('"s":"/loja"');
  });

  it("o JSON do mapa não fecha o <script>", () => {
    const out = injectRoutes(html, { self: "/a</script><b>", routes: {}, hosts: [] });
    const script = out.slice(out.indexOf(`<script ${ROUTES_SCRIPT_ATTR}>`));
    expect(script.indexOf("</script>")).toBeGreaterThan(script.indexOf("})();"));
  });
});

describe("ZIP: rotas e redirecionamentos", () => {
  const routes = offerRoutes([
    { id: "home", sourceUrl: "https://loja.exemplo.test/quiz", isHome: true },
    { id: "roleta", sourceUrl: "https://loja.exemplo.test/roleta", isHome: false },
    { id: "loja", sourceUrl: "https://loja.exemplo.test/loja/", isHome: false },
    { id: "camiseta", sourceUrl: "https://loja.exemplo.test/produto/camiseta", isHome: false },
    { id: "chinelo", sourceUrl: "https://loja.exemplo.test/colecao/verao/chinelo/", isHome: false },
    { id: "oferta", sourceUrl: "https://loja.exemplo.test/oferta.html", isHome: false },
    { id: "php", sourceUrl: "https://loja.exemplo.test/api/pagar.php", isHome: false },
    { id: "assets", sourceUrl: "https://loja.exemplo.test/assets", isHome: false },
    { id: "ck", sourceUrl: "https://loja.exemplo.test/checkout/vip", isHome: false },
    { id: "ocupado", sourceUrl: "https://loja.exemplo.test/js", isHome: false },
  ]);
  const dirs: Record<string, string> = {
    home: "",
    roleta: "roleta-da-sorte/",
    loja: "loja/",
    camiseta: "camiseta/",
    chinelo: "chinelo/",
    oferta: "oferta/",
    php: "pagar/",
    assets: "assets-2/",
    ck: "vip/",
    ocupado: "js-2/",
  };

  it("endereços relativos sobem até a raiz (o mais fundo dos dois endereços); raiz pela pasta do arquivo", () => {
    const camiseta = zipPageRoutes(routes, "camiseta", "camiseta/", dirs);
    expect(camiseta?.config).toMatchObject({ self: "/produto/camiseta", up: 1 });
    expect(camiseta?.config.baseDir).toBeUndefined();
    // De "camiseta/" (antes da troca) e de "/produto/camiseta" (depois): o mesmo arquivo.
    expect(upPrefix(camiseta?.refDir ?? "x/x/x/")).toBe("../");
    expect(relativeDir(camiseta?.refDir ?? "", "camiseta/")).toBe("../camiseta/");
    expect(relativeDir(camiseta?.refDir ?? "", "")).toBe("../");

    // Caminho original mais fundo que a pasta: sobe 3; sem poder trocar o endereço (file://), <base>.
    const chinelo = zipPageRoutes(routes, "chinelo", "chinelo/celular/", dirs);
    expect(chinelo?.config).toMatchObject({ up: 2, baseDir: "colecao/verao/chinelo/" });
    expect(upPrefix(chinelo?.refDir ?? "")).toBe("../../../");
    expect(relativeDir(chinelo?.refDir ?? "", "chinelo/")).toBe("../../../chinelo/");

    // Pasta mais funda que o caminho original ("/roleta" em roleta-da-sorte/oferta-b/): sobe 2.
    const roleta = zipPageRoutes(routes, "roleta", "roleta-da-sorte/oferta-b/", dirs);
    expect(upPrefix(roleta?.refDir ?? "")).toBe("../../");
    expect(relativeDir(roleta?.refDir ?? "", "roleta-da-sorte/")).toBe("../../roleta-da-sorte/");

    const home = zipPageRoutes(routes, "home", "", dirs);
    expect(home?.refDir).toBe("");
    expect(home?.config.routes["/roleta"]).toBe("roleta-da-sorte/");
    expect(home?.config.routes["/quiz"]).toBeUndefined();
    // Página sem endereço de origem: endereços relativos à pasta do arquivo, como antes.
    expect(zipPageRoutes(routes, "outra", "outra/", dirs)).toMatchObject({ refDir: "outra/", config: { self: null } });
  });

  it("redirecionamentos só nos caminhos originais livres", () => {
    const taken = ["index.html", "roleta-da-sorte/index.html", "loja/index.html", "js", "assets/os-runtime.js"];
    const out = planRouteRedirects(
      routes,
      Object.keys(dirs).map((id) => ({ id, name: `Página ${id}` })),
      dirs,
      taken,
      ["checkout/"],
    );
    expect(out.map((r) => [r.zipPath, r.target])).toEqual([
      ["quiz/index.html", "../"],
      ["roleta/index.html", "../roleta-da-sorte/"],
      ["produto/camiseta/index.html", "../../camiseta/"],
      ["colecao/verao/chinelo/index.html", "../../../chinelo/"],
      ["oferta.html", "oferta/"],
    ]);
    const html = routeRedirectHtml(out[2]);
    expect(html).toContain('<meta http-equiv="refresh" content="0;url=../../camiseta/">');
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain("<title>Página camiseta</title>");
  });
});
