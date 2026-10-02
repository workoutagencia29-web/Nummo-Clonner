/**
 * Funções puras do "Baixar ZIP" (src/lib/export): caminhos relativos, troca de
 * /os-assets/ (atributos, srcset, CSS, JSON escapado), divisor A/B (sorteio
 * com aleatoriedade fixa, script rodando numa "janela" falsa), script de
 * chegada (barra no fim, celular), canonical, HTML otimizado, layout das
 * pastas, eventos.php (sintaxe PHP 7.4 conferida pelo php-parser) e LEIA-ME.
 */
import { runInNewContext } from "node:vm";
import { Engine as PhpParser } from "php-parser";
import { describe, expect, it } from "vitest";
import {
  applyHeadLinks,
  earlyScript,
  earlyScriptTag,
  insertEarlyHead,
  liveBaseUrl,
  stripCanonical,
} from "@/lib/export/head";
import { type LayoutPage, planLayout, shortHash } from "@/lib/export/layout";
import { optimizeHtml } from "@/lib/export/optimize";
import { ExportOptionsSchema, exportFileName } from "@/lib/export/options";
import {
  assetFileOfKey,
  assetRefsIn,
  dirDepth,
  fileDir,
  isPrecompressed,
  preserveJsZipPath,
  relativeDir,
  relativeFile,
  rewriteAssetRefs,
  uniqueName,
  upPrefix,
  variantFolderName,
} from "@/lib/export/paths";
import { eventosConfigPhp, eventosPhp, htaccess } from "@/lib/export/php";
import { leiaMe } from "@/lib/export/readme";
import { cleanWeight, pickVariant, splitterHtml, splitterScript, weightPercents } from "@/lib/export/splitter";
import { injectTracking } from "@/lib/tracking/inject";
import type { TrackingRuntimeConfig } from "@/lib/tracking/runtime-config";

const SHA = "a".repeat(64);
const SHA2 = "b".repeat(64);

/** Gerador determinístico (LCG) em [0, 1). */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("caminhos", () => {
  it("profundidade, prefixo e pasta do arquivo", () => {
    expect(dirDepth("")).toBe(0);
    expect(dirDepth("upsell/")).toBe(1);
    expect(dirDepth("upsell/oferta-b/celular/")).toBe(3);
    expect(upPrefix("")).toBe("");
    expect(upPrefix("a/b/")).toBe("../../");
    expect(fileDir("index.html")).toBe("");
    expect(fileDir("upsell/oferta-b/index.html")).toBe("upsell/oferta-b/");
  });

  it("endereço relativo entre pastas (sempre com a barra no fim)", () => {
    expect(relativeDir("", "")).toBe("./");
    expect(relativeDir("", "upsell/")).toBe("upsell/");
    expect(relativeDir("oferta-b/", "")).toBe("../");
    expect(relativeDir("oferta-b/", "upsell/")).toBe("../upsell/");
    expect(relativeDir("upsell/celular/", "upsell/")).toBe("../");
    expect(relativeDir("upsell/", "upsell/")).toBe("./");
    expect(relativeDir("upsell/oferta-a/", "upsell/oferta-b/")).toBe("../oferta-b/");
    expect(relativeDir("a/b/c/", "x/")).toBe("../../../x/");
    expect(relativeFile("upsell/", "assets/x.css")).toBe("../assets/x.css");
    expect(relativeFile("", "assets/x.css")).toBe("assets/x.css");
  });

  it("pastas das versões e nomes livres", () => {
    expect(variantFolderName("A", 0)).toBe("oferta-a");
    expect(variantFolderName("Versão Ágil 2", 1)).toBe("oferta-versao-agil-2");
    expect(variantFolderName("!!!", 2)).toBe("oferta-3");
    expect(uniqueName("oferta-b", new Set(["oferta-b", "oferta-b-2"]))).toBe("oferta-b-3");
    expect(uniqueName("celular", new Set())).toBe("celular");
  });

  it("chave do storage ↔ arquivo", () => {
    expect(assetFileOfKey(`a/aa/${SHA}.png`)).toBe(`${SHA}.png`);
    expect(assetFileOfKey(`a/bb/${SHA}.png`)).toBeNull();
    expect(assetFileOfKey(`versions/x/${SHA}.png`)).toBeNull();
    expect(assetFileOfKey(`a/aa/../${SHA}.png`)).toBeNull();
  });

  it("Preservar JS: caminho original → arquivo no ZIP", () => {
    expect(preserveJsZipPath("/js/app.js?v=2")).toBe("js/app.js");
    expect(preserveJsZipPath("/img/foto%20grande.png")).toBe("img/foto grande.png");
    expect(preserveJsZipPath("/wp-content/themes/x/a%C3%A7%C3%A3o.css")).toBe("wp-content/themes/x/ação.css");
    expect(preserveJsZipPath("/pasta/")).toBeNull();
    expect(preserveJsZipPath("/")).toBeNull();
    expect(preserveJsZipPath("relativo.js")).toBeNull();
    expect(preserveJsZipPath("/a/../../etc/passwd")).toBeNull();
    expect(preserveJsZipPath("/a/%2e%2e/x")).toBeNull();
    expect(preserveJsZipPath("/a//b.js")).toBeNull();
    expect(preserveJsZipPath("/c:/x.js")).toBeNull();
    expect(preserveJsZipPath("/x%zz.js")).toBe("x%zz.js");
  });

  it("arquivos já comprimidos não são compactados de novo", () => {
    expect(isPrecompressed("assets/x.webp")).toBe(true);
    expect(isPrecompressed("assets/x.mp4")).toBe(true);
    expect(isPrecompressed("assets/x.woff2")).toBe(true);
    expect(isPrecompressed("assets/x.css")).toBe(false);
    expect(isPrecompressed("index.html")).toBe(false);
  });
});

describe("troca de /os-assets/ por assets/", () => {
  it("atributos, srcset, style, <style>, JSON escapado, com a origem local e com query", () => {
    const html = [
      `<img src="/os-assets/${SHA}.png" srcset="/os-assets/${SHA}.png 1x, /os-assets/${SHA2}.webp 2x">`,
      `<div style="background:url('/os-assets/${SHA2}.webp')"></div>`,
      `<style>.a{background:url(/os-assets/${SHA}.png)}</style>`,
      `<div data-settings='{"url":"\\/os-assets\\/${SHA2}.jpg"}'></div>`,
      `<img src="http://localhost:3000/os-assets/${SHA}.gif">`,
      `<img src="http://abc123.localhost:3001/os-assets/${SHA}.svg?x=1">`,
      `<link href="/os-assets/${SHA}.css?ver=1.2">`,
      `<a href="/os-assets/nao-e-arquivo.png">`,
    ].join("\n");
    const found = new Set<string>();
    const out = rewriteAssetRefs(html, "../", found);
    expect(out).toContain(`src="../assets/${SHA}.png" srcset="../assets/${SHA}.png 1x, ../assets/${SHA2}.webp 2x"`);
    expect(out).toContain(`url('../assets/${SHA2}.webp')`);
    expect(out).toContain(`url(../assets/${SHA}.png)`);
    expect(out).toContain(`"url":"..\\/assets\\/${SHA2}.jpg"`);
    expect(out).toContain(`src="../assets/${SHA}.gif"`);
    expect(out).toContain(`src="../assets/${SHA}.svg?x=1"`);
    expect(out).toContain(`href="../assets/${SHA}.css?ver=1.2"`);
    expect(out).toContain(`href="/os-assets/nao-e-arquivo.png"`);
    expect([...found].sort()).toEqual(
      [`${SHA}.png`, `${SHA2}.webp`, `${SHA2}.jpg`, `${SHA}.gif`, `${SHA}.svg`, `${SHA}.css`].sort(),
    );
  });

  it("na raiz não há ../ e dentro de assets/ os arquivos ficam lado a lado", () => {
    expect(rewriteAssetRefs(`url(/os-assets/${SHA}.png)`, "")).toBe(`url(assets/${SHA}.png)`);
    const css = `@import "/os-assets/${SHA}.css";@font-face{src:url("/os-assets/${SHA2}.woff2")}`;
    expect(rewriteAssetRefs(css, "", undefined, { inAssets: true })).toBe(
      `@import "${SHA}.css";@font-face{src:url("${SHA2}.woff2")}`,
    );
    expect([...assetRefsIn(css)]).toEqual([`${SHA}.css`, `${SHA2}.woff2`]);
  });

  it("não corta extensões maiores nem pega hash curto", () => {
    expect(rewriteAssetRefs(`/os-assets/${SHA}.pngx9`, "")).toBe(`assets/${SHA}.pngx9`);
    expect(rewriteAssetRefs(`/os-assets/${"a".repeat(63)}.png`, "")).toBe(`/os-assets/${"a".repeat(63)}.png`);
  });
});

describe("sorteio do divisor", () => {
  it("peso 0 nunca sai; todos 0 = controle; limites de random", () => {
    expect(pickVariant([0, 100], 0)).toBe(1);
    expect(pickVariant([0, 100], 0.999999)).toBe(1);
    expect(pickVariant([100, 0], 0.999999)).toBe(0);
    expect(pickVariant([0, 0], 0.5)).toBe(0);
    expect(pickVariant([50, 0, 50], 0.5)).toBe(2);
    expect(pickVariant([50, 50], 0.4999)).toBe(0);
    expect(pickVariant([50, 50], 0.5)).toBe(1);
    expect(pickVariant([50, 50], 1)).toBe(1);
    expect(cleanWeight(-5)).toBe(0);
    expect(cleanWeight(250)).toBe(100);
    expect(cleanWeight(Number.NaN)).toBe(0);
  });

  it("distribui pelo peso (aleatoriedade fixa)", () => {
    const rand = seeded(42);
    const counts = [0, 0, 0];
    for (let i = 0; i < 20_000; i++) counts[pickVariant([70, 20, 10], rand())]++;
    expect(counts[0] / 20_000).toBeCloseTo(0.7, 1);
    expect(counts[1] / 20_000).toBeCloseTo(0.2, 1);
    expect(counts[2] / 20_000).toBeCloseTo(0.1, 1);
  });

  it("percentuais somam 100", () => {
    expect(weightPercents([50, 50])).toEqual([50, 50]);
    expect(weightPercents([1, 1, 1])).toEqual([34, 33, 33]);
    expect(weightPercents([100, 100])).toEqual([50, 50]);
    expect(weightPercents([0, 0])).toEqual([100, 0]);
    expect(weightPercents([30, 0, 70])).toEqual([30, 0, 70]);
  });
});

// ─── Script do divisor numa "janela" falsa ───────────────────────────────────

interface FakeWindowOptions {
  href: string;
  random?: number;
  storage?: Map<string, string>;
  cookie?: string;
  now?: number;
  noStorage?: boolean;
}

function runSplitter(code: string, opts: FakeWindowOptions) {
  const url = new URL(opts.href);
  const storage = opts.storage ?? new Map<string, string>();
  let cookie = opts.cookie ?? "";
  const replaced: string[] = [];
  const localStorage = opts.noStorage
    ? {
        getItem() {
          throw new Error("bloqueado");
        },
        setItem() {
          throw new Error("bloqueado");
        },
      }
    : {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => void storage.set(k, v),
      };
  const document = {
    get cookie() {
      return cookie;
    },
    set cookie(v: string) {
      const pair = v.split(";")[0];
      const [name] = pair.split("=");
      const rest = cookie
        .split(/;\s*/)
        .filter((c) => c && !c.startsWith(`${name}=`))
        .concat(pair);
      cookie = rest.join("; ");
    },
  };
  const now = opts.now ?? 1_800_000_000_000;
  class FakeDate {
    getTime() {
      return now;
    }
  }
  const math = Object.create(Math);
  math.random = () => opts.random ?? 0.1;
  runInNewContext(code, {
    location: {
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      protocol: url.protocol,
      replace: (to: string) => replaced.push(to),
    },
    localStorage,
    document,
    Date: FakeDate,
    Math: math,
    RegExp,
    encodeURIComponent,
    decodeURIComponent,
  });
  return { replaced, storage, cookie: () => cookie };
}

describe("script do divisor", () => {
  const V = [
    { folder: "oferta-a/", weight: 50 },
    { folder: "oferta-b/", weight: 50 },
  ];
  const code = splitterScript(V, "k1");

  it("sorteia, mantém query (UTMs) e hash, e usa a pasta atual", () => {
    const a = runSplitter(code, { href: "https://site.com/?utm_source=fb&utm_campaign=x#oferta", random: 0.2 });
    expect(a.replaced).toEqual(["/oferta-a/?utm_source=fb&utm_campaign=x#oferta"]);
    const b = runSplitter(code, { href: "https://site.com/sub/pasta/upsell/?utm_source=fb", random: 0.7 });
    expect(b.replaced).toEqual(["/sub/pasta/upsell/oferta-b/?utm_source=fb"]);
  });

  it("sem a barra no fim, pelo index.html e aberto do computador (file://)", () => {
    expect(runSplitter(code, { href: "https://site.com/upsell?x=1", random: 0.2 }).replaced).toEqual([
      "/upsell/oferta-a/?x=1",
    ]);
    expect(runSplitter(code, { href: "https://site.com/upsell/index.html", random: 0.9 }).replaced).toEqual([
      "/upsell/oferta-b/",
    ]);
    expect(runSplitter(code, { href: "file:///Users/ana/oferta/index.html", random: 0.9 }).replaced).toEqual([
      "/Users/ana/oferta/oferta-b/index.html",
    ]);
  });

  it("lembra a escolha (localStorage) e, sem ele, pelo cookie", () => {
    const storage = new Map<string, string>();
    runSplitter(code, { href: "https://site.com/", random: 0.9, storage });
    expect(storage.get("os_ab_k1")).toMatch(/^oferta-b\/\|\d+\|$/);
    // Outro sorteio daria A, mas a escolha guardada vale.
    expect(runSplitter(code, { href: "https://site.com/", random: 0.1, storage }).replaced).toEqual(["/oferta-b/"]);

    const first = runSplitter(code, { href: "https://site.com/", random: 0.9, noStorage: true });
    expect(first.cookie()).toContain("os_ab_k1=oferta-b%2F");
    const again = runSplitter(code, {
      href: "https://site.com/",
      random: 0.1,
      noStorage: true,
      cookie: first.cookie(),
    });
    expect(again.replaced).toEqual(["/oferta-b/"]);
  });

  it("escolha vencida (30 dias) ou de versão pausada/removida é sorteada de novo", () => {
    const now = 1_800_000_000_000;
    const old = new Map([["os_ab_k1", `oferta-b/|${now - 31 * 86_400_000}`]]);
    expect(runSplitter(code, { href: "https://site.com/", random: 0.1, storage: old, now }).replaced).toEqual([
      "/oferta-a/",
    ]);
    const paused = splitterScript(
      [
        { folder: "oferta-a/", weight: 100 },
        { folder: "oferta-b/", weight: 0 },
      ],
      "k1",
    );
    const stored = new Map([["os_ab_k1", `oferta-b/|${now}`]]);
    expect(runSplitter(paused, { href: "https://site.com/", random: 0.99, storage: stored, now }).replaced).toEqual([
      "/oferta-a/",
    ]);
    const gone = new Map([["os_ab_k1", `oferta-z/|${now}`]]);
    expect(runSplitter(code, { href: "https://site.com/", random: 0.9, storage: gone, now }).replaced).toEqual([
      "/oferta-b/",
    ]);
  });

  it("distribuição com aleatoriedade fixa igual à do servidor", () => {
    const rand = seeded(7);
    const weights = [30, 70];
    const script = splitterScript(
      weights.map((w, i) => ({ folder: `v${i}/`, weight: w })),
      "k2",
    );
    const counts = [0, 0];
    for (let i = 0; i < 400; i++) {
      const r = rand();
      const got = runSplitter(script, { href: "https://site.com/", random: r }).replaced[0];
      const idx = got === "/v0/" ? 0 : 1;
      expect(idx).toBe(pickVariant(weights, r));
      counts[idx]++;
    }
    expect(counts[0]).toBeGreaterThan(90);
    expect(counts[0]).toBeLessThan(150);
  });

  it("todos com peso 0 = controle", () => {
    const zero = splitterScript(
      [
        { folder: "oferta-a/", weight: 0 },
        { folder: "oferta-b/", weight: 0 },
      ],
      "k3",
    );
    expect(runSplitter(zero, { href: "https://site.com/", random: 0.99 }).replaced).toEqual(["/oferta-a/"]);
  });

  it("página do divisor: noindex, sem conteúdo, com saída sem JavaScript", () => {
    const html = splitterHtml({ variants: V, key: "k1", title: "Página <principal>", lang: "pt-BR" });
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain('<noscript><meta http-equiv="refresh" content="0; url=oferta-a/"></noscript>');
    expect(html).toContain('<a href="oferta-a/">Continuar</a>');
    expect(html).toContain("<title>Página &lt;principal&gt;</title>");
    expect(html).toContain('<html lang="pt-BR">');
    expect(html).not.toMatch(/<script src=/);
  });

  it("a chave não aceita caracteres que quebrariam o script", () => {
    const script = splitterScript(V, 'x"</script><b>');
    expect(script).not.toContain("</script>");
    expect(script).toContain('"os_ab_xscriptb"');
  });
});

// ─── Script de chegada ───────────────────────────────────────────────────────

function runEarly(
  code: string,
  opts: { href: string; ua?: string; session?: Map<string, string>; coarse?: boolean; screen?: number },
) {
  const url = new URL(opts.href);
  const replaced: string[] = [];
  const written: string[] = [];
  const listeners: string[] = [];
  const session = opts.session ?? new Map<string, string>();
  runInNewContext(code, {
    location: {
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      protocol: url.protocol,
      replace: (to: string) => replaced.push(to),
    },
    navigator: { userAgent: opts.ua ?? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130" },
    sessionStorage: {
      getItem: (k: string) => session.get(k) ?? null,
      setItem: (k: string, v: string) => session.set(k, v),
    },
    document: {
      write: (s: string) => written.push(s),
      addEventListener: (type: string) => listeners.push(type),
    },
    window: { matchMedia: () => ({ matches: opts.coarse ?? false }) },
    matchMedia: () => ({ matches: opts.coarse ?? false }),
    screen: { width: opts.screen ?? 1440, height: 900 },
  });
  return { replaced, written, listeners, session };
}

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

describe("script de chegada", () => {
  it("endereço sem a barra no fim recarrega com a barra (mantendo query e hash)", () => {
    const r = runEarly(earlyScript(), { href: "https://site.com/upsell?utm_source=x#a" });
    expect(r.replaced).toEqual(["/upsell/?utm_source=x#a"]);
    expect(r.written[0]).toContain("<plaintext");
    expect(runEarly(earlyScript(), { href: "https://site.com/upsell/" }).replaced).toEqual([]);
    expect(runEarly(earlyScript(), { href: "https://site.com/upsell/index.html" }).replaced).toEqual([]);
  });

  it("celular vai para celular/ (com UTMs); computador fica; ?versao=computador fica e vale para a visita", () => {
    const code = earlyScript({ mobileDir: "celular/" });
    expect(runEarly(code, { href: "https://site.com/upsell/?utm_source=fb#x", ua: IPHONE }).replaced).toEqual([
      "celular/?utm_source=fb#x",
    ]);
    expect(runEarly(code, { href: "https://site.com/upsell/" }).replaced).toEqual([]);
    const session = new Map<string, string>();
    expect(
      runEarly(code, { href: "https://site.com/upsell/?versao=computador", ua: IPHONE, session }).replaced,
    ).toEqual([]);
    expect(runEarly(code, { href: "https://site.com/upsell/", ua: IPHONE, session }).replaced).toEqual([]);
    // Tela pequena de toque (sem "Mobile" no navegador) também vai.
    expect(runEarly(code, { href: "https://site.com/", coarse: true, screen: 390 }).replaced).toEqual(["celular/"]);
    // Sem versão celular, ninguém é redirecionado.
    expect(runEarly(earlyScript(), { href: "https://site.com/", ua: IPHONE }).replaced).toEqual([]);
  });

  it("aberto do computador (file://): não recarrega e liga o ajuste dos links de pasta", () => {
    const r = runEarly(earlyScript(), { href: "file:///Users/ana/oferta/upsell/index.html" });
    expect(r.replaced).toEqual([]);
    expect(r.listeners).toEqual(["click"]);
    expect(
      runEarly(earlyScript({ mobileDir: "celular/" }), { href: "file:///x/index.html", ua: IPHONE }).replaced,
    ).toEqual(["celular/index.html"]);
  });

  it("entra antes do rastreamento, depois das metas de charset/viewport", () => {
    const config = { mode: "live" } as unknown as TrackingRuntimeConfig;
    const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>x</title><link rel="stylesheet" href="a.css"></head><body></body></html>`;
    const tracked = injectTracking(page, config, '<script src="t.js" data-os-tracking></script>');
    const out = insertEarlyHead(tracked, earlyScriptTag());
    const early = out.indexOf("data-os-export");
    expect(early).toBeGreaterThan(out.indexOf('name="viewport"'));
    expect(early).toBeLessThan(out.indexOf('id="os-tracking"'));
    expect(early).toBeLessThan(out.indexOf("<title>"));
    // Sem charset na página: o rastreamento põe um; o script de chegada vem depois dele.
    const bare = injectTracking(
      "<html><head><title>x</title></head><body></body></html>",
      config,
      "<script data-os-tracking></script>",
    );
    const out2 = insertEarlyHead(bare, "<script data-os-export></script>");
    expect(out2.indexOf("data-os-export")).toBeGreaterThan(out2.indexOf('<meta charset="utf-8">'));
    expect(out2.indexOf("data-os-export")).toBeLessThan(out2.indexOf('id="os-tracking"'));
    // Sem <head>: cria um.
    expect(insertEarlyHead("<html><body>x</body></html>", "<i>")).toBe("<html><head><i></head><body>x</body></html>");
    expect(insertEarlyHead("<p>solto</p>", "<i>")).toBe("<head><i></head><p>solto</p>");
  });
});

describe("canonical e endereço no ar", () => {
  it("troca o canonical que a página tinha e põe o alternate do celular", () => {
    const html = `<html><head><link rel="canonical" href="https://original.com/"><link rel="stylesheet" href="x.css"></head><body></body></html>`;
    const out = applyHeadLinks(html, { canonical: "../", mobileAlternate: "celular/" });
    expect(out).not.toContain("original.com");
    expect(out).toContain('<link rel="canonical" href="../">');
    expect(out).toContain('<link rel="alternate" media="only screen and (max-width: 640px)" href="celular/">');
    expect(out).toContain('<link rel="stylesheet" href="x.css">');
    expect(applyHeadLinks(html, {})).toBe(html);
    expect(stripCanonical(`<link rel="alternate" hreflang="en" href="/en/">`)).toContain("hreflang");
  });

  it("endereço base a partir do “Onde está no ar”", () => {
    expect(liveBaseUrl("https://site.com")).toBe("https://site.com/");
    expect(liveBaseUrl("https://site.com/oferta")).toBe("https://site.com/oferta/");
    expect(liveBaseUrl("https://site.com/oferta/index.html?x=1#y")).toBe("https://site.com/oferta/");
    expect(liveBaseUrl("ftp://site.com/")).toBeNull();
    expect(liveBaseUrl("não é url")).toBeNull();
    expect(liveBaseUrl(null)).toBeNull();
  });
});

describe("HTML otimizado", () => {
  it("tira comentários (menos os condicionais) e espaços entre tags, sem tocar em scripts, estilos, pre e atributos", () => {
    const html = `<!doctype html>
<html>
  <head>
    <!-- comentário -->
    <!--[if lt IE 9]><script src="html5shiv.js"></script><![endif]-->
    <!--[if !IE]><!--><link rel="x" href="y"><!--<![endif]-->
    <style>
      /* comentário css */ .a { color: red }   <!-- dentro do style -->
    </style>
    <script>
      // <!-- dentro do script -->
      var x = "  <!-- -->  ";
    </script>
  </head>
  <body>
    <div data-x="<!-- no atributo -->" title='a > b'>   texto   com   espaços   </div>
    <span>um</span> <span>dois</span>
    <pre>
  linha    1
    </pre>
    <textarea>  <!-- no textarea -->  </textarea>
    <p title=it's>ok</p>
    <!---->
    <!-- fim -->
  </body>
</html>`;
    const out = optimizeHtml(html);
    expect(out).not.toContain("<!-- comentário -->");
    expect(out).not.toContain("<!-- fim -->");
    expect(out).not.toContain("<!---->");
    expect(out).toContain('<!--[if lt IE 9]><script src="html5shiv.js"></script><![endif]-->');
    expect(out).toContain("<!--[if !IE]><!-->");
    expect(out).toContain("<!--<![endif]-->");
    expect(out).toContain("/* comentário css */ .a { color: red }   <!-- dentro do style -->");
    expect(out).toContain('// <!-- dentro do script -->\n      var x = "  <!-- -->  ";');
    expect(out).toContain('data-x="<!-- no atributo -->"');
    expect(out).toContain("   texto   com   espaços   ");
    expect(out).toContain("<span>um</span> <span>dois</span>");
    expect(out).toContain("<pre>\n  linha    1\n    </pre>");
    expect(out).toContain("<textarea>  <!-- no textarea -->  </textarea>");
    expect(out).toContain("<p title=it's>ok</p>");
    // Fora dos elementos de texto cru, nada de recuo entre as tags.
    const outside = out.replace(/<(style|script|pre|textarea)\b[\s\S]*?<\/\1>/g, "<x></x>");
    expect(outside).not.toMatch(/>\s{2,}</);
    expect(out).toContain("</head>\n<body>\n<div");
    expect(out.length).toBeLessThan(html.length);
    expect(optimizeHtml(out)).toBe(out);
  });

  it("não quebra com HTML estranho", () => {
    expect(optimizeHtml("a < b e c<d")).toBe("a < b e c<d");
    expect(optimizeHtml("<!-- sem fim")).toBe("");
    expect(optimizeHtml("<!--> x")).toBe(" x".trimStart());
    expect(optimizeHtml("<script>sem fim")).toBe("<script>sem fim");
    expect(optimizeHtml("<div>\n\n   <!-- c -->\n  </div>")).toBe("<div>\n</div>");
    expect(optimizeHtml("<b>a</b> <!-- c -->\n <i>b</i>")).toBe("<b>a</b>\n<i>b</i>");
    expect(optimizeHtml("texto <!-- c --> mais")).toBe("texto  mais");
  });
});

// ─── Layout ──────────────────────────────────────────────────────────────────

function page(over: Partial<LayoutPage> & { id: string; slug: string }): LayoutPage {
  return {
    name: over.slug,
    type: "SALES",
    isHome: false,
    position: 0,
    cloneMode: "EDITABLE",
    variants: [
      {
        id: `${over.id}-a`,
        name: "A",
        label: null,
        isControl: true,
        weight: 100,
        position: 0,
        documents: [{ id: `${over.id}-a-all`, device: "ALL" }],
      },
    ],
    ...over,
  };
}

function ab(id: string, weights = [50, 50], devices: ("ALL" | "DESKTOP" | "MOBILE")[][] = [["ALL"], ["ALL"]]) {
  return weights.map((weight, i) => ({
    id: `${id}-${i}`,
    name: String.fromCharCode(65 + i),
    label: null,
    isControl: i === 0,
    weight,
    position: i,
    documents: devices[i].map((device) => ({ id: `${id}-${i}-${device}`, device })),
  }));
}

describe("layout do ZIP", () => {
  const pages = [
    page({ id: "home", slug: "principal", isHome: true, name: "Início", variants: ab("home") }),
    page({
      id: "up",
      slug: "upsell",
      position: 1,
      variants: ab("up", [100], [["DESKTOP", "MOBILE"]]),
    }),
    page({ id: "leg", slug: "privacidade", type: "LEGAL", position: 2 }),
  ];

  it("com divisor: index.html sorteia; versões em pastas; canonical para a versão de controle", () => {
    const layout = planLayout(pages, { splitter: true });
    expect(layout.files.map((f) => [f.path, f.kind])).toEqual([
      ["index.html", "splitter"],
      ["oferta-a/index.html", "variant"],
      ["oferta-b/index.html", "variant"],
      ["upsell/index.html", "page"],
      ["upsell/celular/index.html", "mobile"],
      ["privacidade/index.html", "legal"],
    ]);
    const [splitter, a, b, up, upMobile] = layout.files;
    expect(splitter.splitter).toEqual({
      variants: [
        { folder: "oferta-a/", weight: 50, id: shortHash("home-0"), mobile: null },
        { folder: "oferta-b/", weight: 50, id: shortHash("home-1"), mobile: null },
      ],
      key: shortHash("home"),
    });
    expect(splitter.label).toBe("Divisor A/B de “Início” (A 50% · B 50%)");
    expect(a.canonicalDir).toBeNull();
    expect(b.canonicalDir).toBe("oferta-a/");
    expect(b.label).toBe("Início — versão B · 50%");
    expect(up.mobileDir).toBe("celular/");
    expect(up.mobileAlternateDir).toBe("upsell/celular/");
    expect(up.documentId).toBe("up-0-DESKTOP");
    expect(upMobile.documentId).toBe("up-0-MOBILE");
    expect(upMobile.canonicalDir).toBe("upsell/");
    expect(layout.pageDirs).toEqual({ home: "", up: "upsell/", leg: "privacidade/" });
    // Cópias só com o canonical (sem noindex, como o Google pede para testes A/B);
    // cada versão guarda a versão vista no formato do divisor.
    expect("noindex" in b).toBe(false);
    expect(a.ab).toEqual({ key: shortHash("home"), folder: "oferta-a/", id: shortHash("home-0"), up: 1 });
    expect(b.ab).toEqual({ key: shortHash("home"), folder: "oferta-b/", id: shortHash("home-1"), up: 1 });
    expect(up.ab).toBeNull();
    expect(layout.splits).toEqual([
      {
        pageId: "home",
        page: "Início",
        dir: "",
        splitter: true,
        variants: [
          { name: "A", folder: "oferta-a/", weight: 50, percent: 50 },
          { name: "B", folder: "oferta-b/", weight: 50, percent: 50 },
        ],
      },
    ]);
    expect(layout.warnings).toEqual([]);
  });

  it("sem divisor: a pasta da página mostra a versão de controle; as versões apontam o canonical para ela", () => {
    const layout = planLayout(pages, { splitter: false });
    const byPath = Object.fromEntries(layout.files.map((f) => [f.path, f]));
    expect(byPath["index.html"].kind).toBe("page");
    expect(byPath["index.html"].documentId).toBe("home-0-ALL");
    expect(byPath["index.html"].canonicalDir).toBeNull();
    expect(byPath["oferta-a/index.html"].canonicalDir).toBe("");
    expect(byPath["oferta-b/index.html"].canonicalDir).toBe("");
    // Sem divisor não há escolha a guardar.
    expect(layout.files.every((f) => f.ab === null)).toBe(true);
  });

  it("pastas da página inicial que coincidem com outra página ganham sufixo (com aviso)", () => {
    const layout = planLayout(
      [
        page({
          id: "home",
          slug: "principal",
          isHome: true,
          variants: ab("home", [50, 50], [["DESKTOP", "MOBILE"], ["ALL"]]),
        }),
        page({ id: "p2", slug: "oferta-b", position: 1 }),
        page({ id: "p3", slug: "celular", position: 2 }),
      ],
      { splitter: false },
    );
    const paths = layout.files.map((f) => f.path);
    expect(paths).toContain("oferta-b-2/index.html");
    expect(paths).toContain("oferta-b/index.html");
    expect(paths).toContain("celular-2/index.html");
    expect(paths).toContain("oferta-a/celular/index.html");
    expect(layout.files.find((f) => f.path === "index.html")?.mobileDir).toBe("celular-2/");
    // Cópias apontam o canonical para a pasta da página (sem divisor).
    const canonical = Object.fromEntries(layout.files.map((f) => [f.path, f.canonicalDir]));
    expect(canonical["index.html"]).toBeNull();
    expect(canonical["celular-2/index.html"]).toBe("");
    expect(canonical["oferta-a/index.html"]).toBe("");
    expect(canonical["oferta-a/celular/index.html"]).toBe("");
    expect(canonical["oferta-b-2/index.html"]).toBe("");
    expect(canonical["oferta-b/index.html"]).toBeNull();
    expect(layout.warnings.join("\n")).toContain("“oferta-b/” já é o endereço de outra página");
    expect(layout.warnings.join("\n")).toContain("“celular/” já é o endereço de outra página");
  });

  it("pesos zerados, versão vazia e só a versão celular", () => {
    const zero = planLayout([page({ id: "h", slug: "h", isHome: true, variants: ab("h", [0, 0]) })], {
      splitter: true,
    });
    expect(zero.warnings.join("\n")).toContain("estão com 0%");
    const paused = planLayout([page({ id: "h", slug: "h", isHome: true, variants: ab("h", [100, 0]) })], {
      splitter: true,
    });
    expect(paused.warnings.join("\n")).toContain("versão B de “h” está com 0% (pausada)");
    const empty = planLayout([page({ id: "h", slug: "h", isHome: true, variants: ab("h", [100], [[]]) })], {
      splitter: true,
    });
    expect(empty.files[0].documentId).toBeNull();
    expect(empty.warnings.join("\n")).toContain("não tem conteúdo");
    const onlyMobile = planLayout(
      [page({ id: "h", slug: "h", isHome: true, variants: ab("h", [100], [["MOBILE"]]) })],
      {
        splitter: true,
      },
    );
    expect(onlyMobile.files.map((f) => f.path)).toEqual(["index.html"]);
    expect(onlyMobile.files[0].device).toBe("MOBILE");
    expect(onlyMobile.files[0].mobileDir).toBeNull();
  });

  it("sem página marcada como inicial, a primeira vai para a raiz", () => {
    const layout = planLayout([page({ id: "x", slug: "x", position: 1 }), page({ id: "y", slug: "y", position: 0 })], {
      splitter: true,
    });
    expect(layout.pageDirs).toEqual({ y: "", x: "x/" });
  });
});

// ─── eventos.php ─────────────────────────────────────────────────────────────

const php = new PhpParser({ parser: { version: "7.4", extractDoc: false }, ast: { withPositions: false } });

describe("eventos.php", () => {
  it("é PHP 7.4 válido e não tem segredos", () => {
    const code = eventosPhp();
    expect(() => php.parseCode(code, "eventos.php")).not.toThrow();
    expect(code).not.toContain("${");
    expect(code).toContain("https://graph.facebook.com/v21.0/");
    expect(code).toContain("https://business-api.tiktok.com/open_api/v1.3/event/track/");
    expect(code).toContain("'action_source' => 'website'");
    expect(code).toContain("'event_source' => 'web'");
    expect(code).toContain("'Access-Token: '");
    expect(code).toContain("const OS_MAX_BODY = 8192;");
    expect(code).toContain("http_response_code(204)");
    expect(code).toContain("fastcgi_finish_request");
    // Nada de sintaxe do PHP 8.
    expect(code).not.toMatch(/\bmatch\s*\(|\?->|str_contains|str_starts_with|\bfn\s*\(/);
  });

  it("recusa sintaxe inválida (o verificador funciona)", () => {
    expect(() => php.parseCode("<?php if ( {", "x.php")).toThrow();
  });

  it("eventos-config.php escapa o token e bloqueia acesso direto", () => {
    const code = eventosConfigPhp([
      { vendor: "META", pixelId: "123456789012345", token: "abc'def\\ghi", testEventCode: "TEST1" },
      { vendor: "META", pixelId: "999999999999999", token: "tok2\nquebra", testEventCode: null },
      { vendor: "TIKTOK", pixelId: "C1ABCDEFGHIJ2KLMNOPQ", token: "tiktoktoken", testEventCode: null },
    ]);
    expect(() => php.parseCode(code, "eventos-config.php")).not.toThrow();
    const ast = php.parseCode(code, "eventos-config.php") as unknown as { children: { kind: string }[] };
    expect(ast.children.map((c) => c.kind)).toEqual(["if", "return"]);
    expect(code).toContain("'token' => 'abc\\'def\\\\ghi'");
    expect(code).toContain("'token' => 'tok2quebra'");
    expect(code).toContain("'test_event_code' => 'TEST1'");
    expect(code).toContain("if (!defined('OS_EVENTOS'))");
    expect(code).toContain("'tiktok' => array(\n    array('pixel' => 'C1ABCDEFGHIJ2KLMNOPQ'");
    const empty = eventosConfigPhp([]);
    expect(() => php.parseCode(empty, "c.php")).not.toThrow();
    expect(empty).toContain("'meta' => array(),");
  });

  it(".htaccess (da pasta eventos-dados/) bloqueia o arquivo dos tokens", () => {
    expect(htaccess()).toContain('<Files "config.php">');
    expect(htaccess()).toContain("Require all denied");
    expect(htaccess()).toContain("Deny from all");
  });
});

describe("LEIA-ME e nome do arquivo", () => {
  it("explica estrutura, hospedagem, A/B, eventos.php, Preservar JS e avisos", () => {
    const text = leiaMe({
      offerName: "Minha Oferta",
      date: "29/09/2026",
      pages: [
        { name: "Página principal", dir: "", mobile: false },
        { name: "Upsell", dir: "upsell/", mobile: true },
      ],
      splits: [
        {
          page: "Página principal",
          dir: "",
          splitter: true,
          variants: [
            { name: "A", folder: "oferta-a/", percent: 60 },
            { name: "B", folder: "oferta-b/", percent: 40 },
          ],
        },
      ],
      serverEvents: ["Meta (API de Conversões)"],
      preserveJs: ["Quiz"],
      warnings: ["Aviso de teste"],
    });
    expect(text.startsWith("\uFEFF")).toBe(true);
    expect(text).toContain("\r\n");
    for (const part of [
      "Minha Oferta",
      "public_html",
      "default.php",
      "Extrair",
      "oferta-a/  →  versão A (60% das visitas)",
      "divisor",
      "PHP 7.4",
      "eventos-dados/config.php",
      "NÃO suba o",
      "RAIZ do domínio",
      "?versao=computador",
      "Aviso de teste",
      "utm_source=teste",
    ]) {
      expect(text).toContain(part);
    }
    const plain = leiaMe({
      offerName: "X",
      date: "1/1/2026",
      pages: [],
      splits: [],
      serverEvents: [],
      preserveJs: [],
      warnings: [],
    });
    expect(plain).not.toContain("eventos.php");
    expect(plain).not.toContain("TESTE A/B");
  });

  it("nome do ZIP e opções padrão", () => {
    expect(exportFileName("Oferta de Verão! 2026", new Date(2026, 8, 29, 23, 50))).toBe(
      "oferta-de-verao-2026-2026-09-29-2350.zip",
    );
    expect(exportFileName("???", new Date(2026, 0, 2))).toBe("oferta-2026-01-02-0000.zip");
    expect(ExportOptionsSchema.parse({})).toEqual({ splitter: true, serverEvents: false, optimizeHtml: true });
  });
});
