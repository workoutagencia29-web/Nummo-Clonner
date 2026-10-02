/**
 * Regressões da 2ª rodada de correções do "Baixar ZIP" (Fase 5), funções puras:
 * - "Preservar JS": nome terminado em espaço ou ponto ("x.php ", "web.config.")
 *   nunca entra no ZIP (o Windows grava "x.php" e "web.config" ao descompactar);
 * - "Preservar JS": cópias nas pastas das versões/celular só do que um script
 *   pode pedir por endereço relativo — nada do que o HTML pede pela raiz, nem
 *   vídeo, áudio e fonte;
 * - divisor e ida para celular/: trava contra redirecionamento sem fim numa
 *   hospedagem que entrega a mesma página para qualquer caminho, e a origem da
 *   visita (os_ref) guardada antes de TODO redirecionamento;
 * - 404.html; LEIA-ME sem divisor; endereço reservado de página antiga;
 *   "Voltar às opções" com o ZIP sendo gerado; aviso "qual versão vende mais".
 */
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { mergeExportView, runningExport } from "@/components/offers/export/logic";
import { COMPARE_HINT_TITLE, CompareVersionsHint } from "@/components/offers/variants/compare-hint";
import { earlyScript, MOBILE_GUARD_KEY, REFERRER_KEY, SPLIT_GUARD_KEY } from "@/lib/export/head";
import { type LayoutPage, planLayout } from "@/lib/export/layout";
import { NOT_FOUND_FILE, notFoundHtml } from "@/lib/export/not-found";
import type { ExportView } from "@/lib/export/options";
import {
  blockedPreservePath,
  brokenZipPath,
  isServerSidePath,
  preserveJsZipPath,
  windowsName,
} from "@/lib/export/paths";
import { leiaMe, type ReadmeInput } from "@/lib/export/readme";
import { splitterScript } from "@/lib/export/splitter";
import { pageSlugProblem, slugProblem } from "@/lib/text";
import { planPreserveFiles, preserveCopyWanted, rootPathsIn } from "@/server/services/export/preserve";
import type { ExportSource, SourceDocument, SourcePage } from "@/server/services/export/source";

// ─── "Janela" falsa para os scripts do ZIP ───────────────────────────────────

interface FakeRun {
  href: string;
  random?: number;
  storage?: Map<string, string>;
  session?: Map<string, string>;
  referrer?: string;
  ua?: string;
}

function run(code: string, opts: FakeRun) {
  const url = new URL(opts.href);
  const storage = opts.storage ?? new Map<string, string>();
  const session = opts.session ?? new Map<string, string>();
  let cookie = "";
  const replaced: string[] = [];
  const math = Object.create(Math);
  math.random = () => opts.random ?? 0.1;
  runInNewContext(code, {
    location: {
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      protocol: url.protocol,
      host: url.host,
      replace: (to: string) => replaced.push(to),
    },
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
    },
    sessionStorage: {
      getItem: (k: string) => session.get(k) ?? null,
      setItem: (k: string, v: string) => session.set(k, v),
    },
    document: {
      referrer: opts.referrer ?? "",
      get cookie() {
        return cookie;
      },
      set cookie(v: string) {
        cookie = cookie ? `${cookie}; ${v.split(";")[0]}` : v.split(";")[0];
      },
      write: () => {},
      addEventListener: () => {},
    },
    navigator: { userAgent: opts.ua ?? "Mozilla/5.0 (Macintosh) Chrome/130" },
    window: {},
    screen: { width: 1440, height: 900 },
    Math: math,
    RegExp,
    encodeURIComponent,
    decodeURIComponent,
  });
  return { replaced, storage, session };
}

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1";

/** O endereço guardado em "os_ref" (o valor é "<hora em ms>|<endereço>"). */
const savedRef = (session: Map<string, string>) => session.get(REFERRER_KEY)?.replace(/^\d+\|/, "");

// ─── Nomes terminados em espaço ou ponto ─────────────────────────────────────

describe("Preservar JS: nomes que o Windows grava diferente", () => {
  it("“x.php ” e “web.config.” contam como x.php e web.config (ficam de fora por segurança)", () => {
    const cases: [string, string][] = [
      ["/x.php%20", "x.php "],
      ["/web.config.", "web.config."],
      ["/web.config%20", "web.config "],
      ["/sub/php.ini%20", "sub/php.ini "],
      ["/.htaccess%20", ".htaccess "],
      ["/img/foto.PHP.%20", "img/foto.PHP. "],
      ["/cgi-bin%20/x.png", "cgi-bin /x.png"],
      ["/sub/.user.ini..", "sub/.user.ini.."],
    ];
    for (const [key, zipPath] of cases) {
      expect(preserveJsZipPath(key), key).toBeNull();
      expect(blockedPreservePath(key), key).toBe(zipPath);
      expect(isServerSidePath(zipPath), zipPath).toBe(true);
    }
    expect(windowsName("x.php . ")).toBe("x.php");
    expect(isServerSidePath("web.config.")).toBe(true);
    expect(isServerSidePath("sub/php.ini ")).toBe(true);
  });

  it("arquivo comum terminado em espaço ou ponto: não entra (sairia com outro nome), sem aviso de segurança", () => {
    for (const key of ["/img/a.png%20", "/img/a.png.", "/pasta./a.png", "/pasta%20/a.png"]) {
      expect(preserveJsZipPath(key), key).toBeNull();
      expect(blockedPreservePath(key), key).toBeNull();
    }
    expect(preserveJsZipPath("/img/foto%20grande.png")).toBe("img/foto grande.png");
    expect(preserveJsZipPath("/js/app.js?v=2")).toBe("js/app.js");
  });

  it("planPreserveFiles: nenhum desses entra, os de servidor aparecem no aviso", () => {
    const doc: SourceDocument = {
      id: "d1",
      device: "ALL",
      html: null,
      assetMap: {
        "/x.php%20": KEY(1),
        "/web.config%20": KEY(2),
        "/web.config.": KEY(3),
        "/sub/php.ini%20": KEY(4),
        "/img/a.png%20": KEY(5),
        "/img/ok.png": KEY(6),
      },
    };
    const source = sourceOf([
      page({ id: "home", slug: "inicio", isHome: true, cloneMode: "PRESERVE_JS", variants: [variant("A", [doc])] }),
    ]);
    const layout = planLayout(toLayoutPages(source), { splitter: true });
    const plan = planPreserveFiles(
      source,
      layout,
      layout.files.map((f) => f.path),
    );
    expect(plan.entries.map((e) => e.zipPath)).toEqual(["img/ok.png"]);
    expect(plan.blocked).toEqual(["sub/php.ini ", "web.config ", "web.config.", "x.php "]);
  });
});

// ─── Cópias do "Preservar JS" nas pastas das versões ────────────────────────

const KEY = (n: number) => `a/${String(n).padStart(2, "0")}/${String(n).padStart(2, "0")}${"f".repeat(62)}.bin`;

function variant(name: string, documents: SourceDocument[], weight = 50): SourcePage["variants"][number] {
  return {
    id: `v-${name}`,
    name,
    label: null,
    isControl: name === "A",
    weight,
    position: name.charCodeAt(0) - 65,
    documents,
  };
}

function page(over: Partial<SourcePage> & Pick<SourcePage, "id" | "slug">): SourcePage {
  return {
    name: over.slug,
    type: "SALES",
    isHome: false,
    position: 0,
    cloneMode: "EDITABLE",
    sourceUrl: null,
    seo: null,
    customCode: null,
    variants: [variant("A", [{ id: `${over.id}-doc`, device: "ALL", html: null, assetMap: null }], 100)],
    ...over,
  };
}

function sourceOf(pages: SourcePage[]): ExportSource {
  return {
    offer: { id: "o", name: "Oferta", settings: {}, liveUrl: null, updatedAt: new Date(0) },
    links: [],
    pages,
  };
}

function toLayoutPages(source: ExportSource): LayoutPage[] {
  return source.pages.map((p) => ({
    ...p,
    variants: p.variants.map((v) => ({ ...v, documents: v.documents.map((d) => ({ id: d.id, device: d.device })) })),
  }));
}

describe("Preservar JS: cópias só do que um script pode pedir por endereço relativo", () => {
  const QUIZ_HTML = `<!doctype html><html><head><link rel="stylesheet" href="/css/orig.css"><link rel="preload" href="/fonts/a.woff2" as="font"></head>
<body><div style="background:url(/img/fundo.png)"></div><script src="/js/quiz.js?v=2"></script>
<script>var cfg={"logo":"\\/img\\/logo.png"};</script></body></html>`;
  const assetMap = {
    "/css/orig.css": KEY(1),
    "/js/quiz.js?v=2": KEY(2),
    "/img/etapa-2.png": KEY(3),
    "/video/vsl.mp4": KEY(4),
    "/fonts/a.woff2": KEY(5),
    "/dados/config.json": KEY(6),
    "/img/fundo.png": KEY(7),
    "/img/logo.png": KEY(8),
    "/audio/trilha.mp3": KEY(9),
  };
  const doc = (id: string, device: SourceDocument["device"]): SourceDocument => ({
    id,
    device,
    html: QUIZ_HTML,
    assetMap,
  });
  const source = sourceOf([
    page({ id: "home", slug: "inicio", isHome: true }),
    page({
      id: "quiz",
      slug: "quiz",
      position: 1,
      cloneMode: "PRESERVE_JS",
      variants: [variant("A", [doc("qa-d", "DESKTOP"), doc("qa-m", "MOBILE")]), variant("B", [doc("qb", "ALL")])],
    }),
  ]);
  const layout = planLayout(toLayoutPages(source), { splitter: true });
  const reserved = [...layout.files.map((f) => f.path), NOT_FOUND_FILE, "LEIA-ME.txt"];
  const plan = planPreserveFiles(source, layout, reserved);
  const paths = plan.entries.map((e) => e.zipPath);
  const DIRS = ["quiz/oferta-a/", "quiz/oferta-a/celular/", "quiz/oferta-b/"];

  it("as pastas da página existem (versões A/B, celular da A)", () => {
    expect(layout.files.map((f) => f.path)).toEqual(
      expect.arrayContaining(DIRS.map((d) => `${d}index.html`).concat("quiz/index.html")),
    );
  });

  it("vídeo, áudio e fonte: uma vez só, no caminho original", () => {
    for (const file of ["video/vsl.mp4", "audio/trilha.mp3", "fonts/a.woff2"]) {
      expect(
        paths.filter((p) => p.endsWith(file)),
        file,
      ).toEqual([file]);
    }
  });

  it("o que o HTML pede pela raiz (/css/orig.css, /js/quiz.js, url(/img/fundo.png), \\/img\\/logo.png) não ganha cópia", () => {
    for (const file of ["css/orig.css", "js/quiz.js", "img/fundo.png", "img/logo.png"]) {
      expect(
        paths.filter((p) => p.endsWith(file)),
        file,
      ).toEqual([file]);
    }
  });

  it("o que só um script monta (img/etapa-2.png, dados/config.json) é copiado para cada pasta da página", () => {
    for (const dir of DIRS) {
      expect(paths).toContain(`${dir}img/etapa-2.png`);
      expect(paths).toContain(`${dir}dados/config.json`);
    }
    // A pasta do divisor (quiz/) não tem documento: nada de cópia lá.
    expect(paths).not.toContain("quiz/img/etapa-2.png");
    expect(plan.entries.filter((e) => !e.primary)).toHaveLength(DIRS.length * 2);
    expect(brokenZipPath([...reserved, ...paths])).toBeNull();
  });

  it("rootPathsIn: caminhos pedidos a partir da raiz, sem query, decodificados; nada de endereços completos ou relativos", () => {
    const found = rootPathsIn(
      `<img src="/img/a.png?v=1"><a href="https://cdn.site/x.js">x</a><script src="//cdn.site/y.js"></script>
<img src="img/rel.png"><div style="background:url('/img/b%20c.png')"></div><script>var u="\\/js\\/app.js";</script>
<img srcset="/img/1x.png 1x, /img/2x.png 2x"><a href="/obrigado/">ok</a><img src="/img/amp.png?a=1&amp;b=2">`,
    );
    expect([...found]).toEqual(
      expect.arrayContaining([
        "/img/1x.png",
        "/img/2x.png",
        "/img/a.png",
        "/img/amp.png",
        "/img/b c.png",
        "/js/app.js",
        "/obrigado/",
      ]),
    );
    for (const not of ["/img/rel.png", "img/rel.png", "/x.js", "/y.js", "/cdn.site/y.js", "/img/a.png?v=1"]) {
      expect(found.has(not), not).toBe(false);
    }
    expect(preserveCopyWanted("/img/a.png?v=9", found)).toBe(false);
    expect(preserveCopyWanted("/img/etapa.png", found)).toBe(true);
    expect(preserveCopyWanted("/video/x.MP4", null)).toBe(false);
    expect(preserveCopyWanted("/fonts/x.ttf", null)).toBe(false);
    // Sem o HTML (prévia), só a regra da extensão.
    expect(preserveCopyWanted("/img/a.png", null)).toBe(true);
  });
});

// ─── Divisor: trava contra redirecionamento sem fim ─────────────────────────

describe("divisor numa hospedagem que entrega o divisor para qualquer caminho", () => {
  const V = [
    { folder: "oferta-a/", weight: 50, id: "ia" },
    { folder: "oferta-b/", weight: 50, id: "ib" },
  ];
  const code = splitterScript(V, "k");

  it("manda para a versão uma vez; entregue de novo nessa pasta, para ali (nada de oferta-b/oferta-b/)", () => {
    const storage = new Map<string, string>();
    const session = new Map<string, string>();
    const first = run(code, { href: "https://site.com/promo/?utm_source=x", random: 0.9, storage, session });
    expect(first.replaced).toEqual(["/promo/oferta-b/?utm_source=x"]);
    expect(session.get(SPLIT_GUARD_KEY)).toBe("/promo/oferta-b/");
    const again = run(code, { href: "https://site.com/promo/oferta-b/?utm_source=x", random: 0.9, storage, session });
    expect(again.replaced).toEqual([]);
    // O endereço certo continua funcionando no mesmo navegador.
    expect(run(code, { href: "https://site.com/", random: 0.9, storage, session }).replaced).toEqual(["/oferta-b/"]);
    // Também pelo index.html e sem a barra no fim.
    const s2 = new Map<string, string>();
    expect(run(code, { href: "https://site.com/promo", random: 0.1, session: s2 }).replaced).toEqual([
      "/promo/oferta-a/",
    ]);
    expect(
      run(code, { href: "https://site.com/promo/oferta-a/index.html", random: 0.1, session: s2 }).replaced,
    ).toEqual([]);
  });

  it("versão com celular separado: a trava vale para a pasta celular/ da versão", () => {
    const withMobile = splitterScript(
      [
        { folder: "oferta-a/", weight: 100, id: "ia", mobile: "celular/" },
        { folder: "oferta-b/", weight: 0, id: "ib", mobile: null },
      ],
      "k",
    );
    const session = new Map<string, string>();
    expect(run(withMobile, { href: "https://site.com/x/", ua: IPHONE, session }).replaced).toEqual([
      "/x/oferta-a/celular/",
    ]);
    expect(run(withMobile, { href: "https://site.com/x/oferta-a/celular/", ua: IPHONE, session }).replaced).toEqual([]);
  });

  it("numa hospedagem normal a trava nunca atua (a pasta da versão tem a página dela)", () => {
    const session = new Map([[SPLIT_GUARD_KEY, "/oferta-b/"]]);
    // Voltou ao endereço da página depois de ver a versão B: divisor de novo, redireciona.
    expect(run(code, { href: "https://site.com/", random: 0.9, session }).replaced).toEqual(["/oferta-b/"]);
    // Sem sessionStorage (bloqueado): redireciona como antes.
    expect(runInNewContextWithoutSession(code, "https://site.com/promo/"), "sem sessionStorage").toEqual([
      "/promo/oferta-a/",
    ]);
  });

  it("guarda a origem da visita (outro site) só quando redireciona", () => {
    const session = new Map<string, string>();
    run(code, { href: "https://site.com/", referrer: "https://www.instagram.com/", session });
    expect(savedRef(session)).toBe("https://www.instagram.com/");
    // Outra visita, de outro site, na mesma aba: vale a mais recente.
    run(code, { href: "https://site.com/", referrer: "https://www.google.com/", session });
    expect(savedRef(session)).toBe("https://www.google.com/");
    // Do próprio site: não troca.
    run(code, { href: "https://site.com/", referrer: "https://site.com/oferta-b/", session });
    expect(savedRef(session)).toBe("https://www.google.com/");
  });
});

function runInNewContextWithoutSession(code: string, href: string): string[] {
  const url = new URL(href);
  const replaced: string[] = [];
  const math = Object.create(Math);
  math.random = () => 0.1;
  runInNewContext(code, {
    location: {
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      protocol: url.protocol,
      host: url.host,
      replace: (to: string) => replaced.push(to),
    },
    localStorage: {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("bloqueado");
      },
    },
    get sessionStorage() {
      throw new Error("bloqueado");
    },
    document: { referrer: "https://x.com/", cookie: "", write: () => {}, addEventListener: () => {} },
    navigator: { userAgent: "Mozilla/5.0 (Macintosh) Chrome/130" },
    window: {},
    screen: { width: 1440, height: 900 },
    Math: math,
    RegExp,
    encodeURIComponent,
    decodeURIComponent,
  });
  return replaced;
}

// ─── Script de chegada: origem da visita e trava do celular ─────────────────

describe("script de chegada: a origem da visita sobrevive aos redirecionamentos", () => {
  const withMobile = earlyScript({ mobileDir: "celular/" });

  it("celular (versão celular separada): guarda a origem antes de ir para celular/", () => {
    const r = run(withMobile, {
      href: "https://site.com/upsell/?utm_source=ig",
      ua: IPHONE,
      referrer: "https://l.instagram.com/",
    });
    expect(r.replaced).toEqual(["celular/?utm_source=ig"]);
    expect(savedRef(r.session)).toBe("https://l.instagram.com/");
    expect(r.session.get(MOBILE_GUARD_KEY)).toBe("/upsell/celular/");
  });

  it("endereço sem a barra no fim: guarda a origem antes de recarregar com a barra", () => {
    const r = run(earlyScript(), { href: "https://site.com/upsell?x=1", referrer: "https://www.google.com/" });
    expect(r.replaced).toEqual(["/upsell/?x=1"]);
    expect(savedRef(r.session)).toBe("https://www.google.com/");
    // Vindo do próprio site (link do funil): não guarda.
    const own = run(earlyScript(), { href: "https://site.com/upsell", referrer: "https://site.com/" });
    expect(own.session.has(REFERRER_KEY)).toBe(false);
    // Sem redirecionar, nada muda (a página vê a origem de verdade).
    const stay = run(withMobile, { href: "https://site.com/upsell/", referrer: "https://www.google.com/" });
    expect(stay.replaced).toEqual([]);
    expect(stay.session.has(REFERRER_KEY)).toBe(false);
  });

  it("entregue de novo na pasta celular/ (hospedagem que entrega a página para qualquer caminho): para ali", () => {
    const session = new Map<string, string>();
    expect(run(withMobile, { href: "https://site.com/promo/", ua: IPHONE, session }).replaced).toEqual(["celular/"]);
    expect(run(withMobile, { href: "https://site.com/promo/celular/", ua: IPHONE, session }).replaced).toEqual([]);
    // Pelo index.html também.
    const s2 = new Map<string, string>();
    expect(run(withMobile, { href: "https://site.com/p/index.html", ua: IPHONE, session: s2 }).replaced).toEqual([
      "celular/",
    ]);
    expect(s2.get(MOBILE_GUARD_KEY)).toBe("/p/celular/");
    // Hospedagem normal: outra página com celular separado continua redirecionando.
    expect(run(withMobile, { href: "https://site.com/obrigado/", ua: IPHONE, session }).replaced).toEqual(["celular/"]);
  });

  it("aberto do computador (file://): sem trava nem origem guardadas", () => {
    const r = run(withMobile, { href: "file:///Users/ana/oferta/index.html", ua: IPHONE, referrer: "https://x.com/" });
    expect(r.replaced).toEqual(["celular/index.html"]);
    expect(r.session.size).toBe(0);
  });
});

// ─── 404.html ────────────────────────────────────────────────────────────────

describe("404.html", () => {
  it("noindex, sem arquivos de fora, link para a raiz; no idioma das páginas", () => {
    const pt = notFoundHtml();
    expect(NOT_FOUND_FILE).toBe("404.html");
    expect(pt).toContain('<meta name="robots" content="noindex">');
    expect(pt).toContain('<html lang="pt-BR">');
    expect(pt).toContain("Página não encontrada");
    expect(pt).toContain('href="/"');
    expect(pt).not.toMatch(/<script|<link|src=/i);
    expect(notFoundHtml("en-US")).toContain("Page not found");
    expect(notFoundHtml("es")).toContain("Página no encontrada");
    expect(notFoundHtml("fr")).toContain("Página não encontrada");
  });
});

// ─── LEIA-ME sem o divisor ───────────────────────────────────────────────────

function readme(splitter: boolean[]): string {
  const input: ReadmeInput = {
    offerName: "Oferta",
    date: "30/09/2026",
    pages: [
      { name: "Página principal", dir: "", mobile: false },
      { name: "Upsell", dir: "upsell/", mobile: false },
    ],
    splits: splitter.map((on, i) => ({
      page: i === 0 ? "Página principal" : "Upsell",
      dir: i === 0 ? "" : "upsell/",
      splitter: on,
      variants: [
        { name: "A", folder: "oferta-a/", percent: 50 },
        { name: "B", folder: "oferta-b/", percent: 50 },
      ],
    })),
    serverEvents: [],
    preserveJs: [],
    warnings: [],
  };
  return leiaMe(input);
}

describe("LEIA-ME com o divisor desligado", () => {
  it("não promete o que só o divisor faz (continuar na versão, cookie os_ab_)", () => {
    const off = readme([false]);
    expect(off).not.toContain("continua nela");
    expect(off).not.toContain("os_ab_");
    expect(off).not.toContain("passa pelo divisor");
    expect(off).toContain("Sem o divisor, o endereço da página mostra sempre a versão de controle");
    expect(off).toContain("index.html  →  versão A (sem divisor)");
    expect(off).toContain("link de checkout diferente em cada versão");
  });

  it("com o divisor: explica o cookie e quem entra direto numa versão", () => {
    const on = readme([true]);
    expect(on).toContain("continua nela");
    expect(on).toContain("cookie funcional (os_ab_…)");
    expect(on).not.toContain("Sem o divisor");
  });

  it("uma página com e outra sem: os dois textos", () => {
    const mixed = readme([true, false]);
    expect(mixed).toContain("continua nela");
    expect(mixed).toContain("Sem o divisor, o endereço da página mostra sempre a versão de controle");
  });

  it("lista o 404.html e diz para enviar junto na Netlify/Cloudflare Pages", () => {
    const text = readme([true]);
    expect(text).toContain("404.html  →  página “não encontrada”");
    expect(text).toContain("junto o 404.html");
  });
});

// ─── Endereço reservado de uma página antiga ─────────────────────────────────

describe("página antiga com endereço que passou a ser reservado", () => {
  it("editar sem trocar o endereço não confere de novo (igual ao servidor)", () => {
    for (const slug of ["oferta-b", "celular", "eventos-dados"]) {
      expect(slugProblem(slug)).toMatch(/reservado/);
      expect(pageSlugProblem(slug, slug)).toBeNull();
      // Página nova, ou trocando para ele: continua bloqueado.
      expect(pageSlugProblem(slug)).toMatch(/reservado/);
      expect(pageSlugProblem(slug, null)).toMatch(/reservado/);
      expect(pageSlugProblem(slug, "upsell")).toMatch(/reservado/);
    }
    expect(pageSlugProblem("Com Espaço", "com-espaco")).toMatch(/minúsculas/);
    expect(pageSlugProblem("upsell-2", "upsell")).toBeNull();
  });
});

// ─── "Voltar às opções" com o ZIP sendo gerado ───────────────────────────────

function exportView(over: Partial<ExportView> & { id: string }): ExportView {
  return {
    offerId: "o1",
    status: "DONE",
    progress: 100,
    step: null,
    options: { splitter: true, serverEvents: false, optimizeHtml: true },
    fileName: "oferta.zip",
    bytes: 1024,
    errorMessage: null,
    warnings: [],
    createdAt: "2026-09-29T15:30:00.000Z",
    finishedAt: null,
    ...over,
  };
}

describe("ZIP deixado gerando ao voltar às opções", () => {
  it("runningExport não volta a acompanhar o ZIP que a pessoa deixou gerando", () => {
    const list = [exportView({ id: "n", status: "RUNNING" }), exportView({ id: "o" })];
    expect(runningExport(list)?.id).toBe("n");
    expect(runningExport(list, ["n"])).toBeNull();
    expect(runningExport(list, ["x"])?.id).toBe("n");
  });

  it("mergeExportView: troca a linha do mesmo ZIP ou põe o novo na ordem da data", () => {
    const older = exportView({ id: "a", createdAt: "2026-09-29T10:00:00.000Z" });
    const newer = exportView({ id: "b", createdAt: "2026-09-29T12:00:00.000Z" });
    const running = exportView({ id: "c", status: "RUNNING", progress: 40, createdAt: "2026-09-29T13:00:00.000Z" });
    expect(mergeExportView([newer, older], running).map((e) => e.id)).toEqual(["c", "b", "a"]);
    expect(mergeExportView(null, running).map((e) => e.id)).toEqual(["c"]);
    const middle = exportView({ id: "m", createdAt: "2026-09-29T11:00:00.000Z" });
    expect(mergeExportView([newer, older], middle).map((e) => e.id)).toEqual(["b", "m", "a"]);
    const updated = mergeExportView([running, newer], { ...running, progress: 80 });
    expect(updated.map((e) => [e.id, e.progress])).toEqual([
      ["c", 80],
      ["b", 100],
    ]);
  });
});

// ─── Teste A/B: como saber qual versão vende mais ────────────────────────────

describe("aviso “qual versão vende mais”", () => {
  it("diz para usar um link de checkout diferente em cada versão e onde ver visitas por versão", () => {
    const html = renderToStaticMarkup(createElement(CompareVersionsHint));
    expect(html).toContain(COMPARE_HINT_TITLE);
    expect(html).toContain("link de checkout diferente em cada versão");
    expect(html).toContain("“Links e checkouts”");
    expect(html).toContain("/oferta-b/");
  });
});
