/**
 * "Baixar ZIP" — 3ª rodada de correções (sem navegador):
 *
 * - origem da visita: o script de chegada da página que fica devolve ao
 *   document.referrer a origem guardada antes de um redirecionamento do ZIP
 *   (divisor, celular/, barra no fim), uma vez só, antes do rastreamento;
 * - Safari: o navegador padrão do Mac descompacta o ZIP e manda o .zip para a
 *   Lixeira — aviso no "ZIP pronto" (só no Safari), no passo a passo e no
 *   LEIA-ME.
 */
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HostingGuide, SafariZipTip } from "@/components/offers/export/hosting-guide";
import { isSafariUserAgent } from "@/components/offers/export/logic";
import { earlyScript, REFERRER_KEY, REFERRER_MAX_AGE_MS, RESTORE_REF_JS, SAVE_REF_JS } from "@/lib/export/head";
import { leiaMe } from "@/lib/export/readme";
import { splitterScript } from "@/lib/export/splitter";

// ─── Origem da visita ────────────────────────────────────────────────────────

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

/** Origem guardada agora (o formato do SAVE_REF_JS: "<hora em ms>|<endereço>"). */
const fresh = (url: string, ageMs = 0) => `${Date.now() - ageMs}|${url}`;
/** O endereço de uma origem guardada (sem a hora). */
const refUrl = (value: string | undefined) => value?.replace(/^\d+\|/, "");

interface Visit {
  href: string;
  referrer?: string;
  session?: Map<string, string>;
  ua?: string;
  /** Script do rastreamento, que roda depois do de chegada: o que ele vê como origem. */
  after?: boolean;
}

/** Roda o script de chegada (e um "rastreamento" depois dele) com um document de mentira. */
function visit(code: string, opts: Visit) {
  const url = new URL(opts.href);
  const session = opts.session ?? new Map<string, string>();
  const replaced: string[] = [];
  // biome-ignore lint/suspicious/noExplicitAny: document de mentira, com a propriedade que o script redefine
  const document: any = {
    referrer: opts.referrer ?? "",
    cookie: "",
    write: () => {},
    addEventListener: () => {},
  };
  const sandbox = {
    location: {
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      protocol: url.protocol,
      host: url.host,
      replace: (to: string) => replaced.push(to),
    },
    localStorage: { getItem: () => null, setItem: () => {} },
    sessionStorage: {
      getItem: (k: string) => session.get(k) ?? null,
      setItem: (k: string, v: string) => session.set(k, String(v)),
      removeItem: (k: string) => session.delete(k),
    },
    document,
    navigator: { userAgent: opts.ua ?? "Mozilla/5.0 (Macintosh) Chrome/130" },
    window: {},
    screen: { width: 1440, height: 900 },
    seen: "" as string,
  };
  runInNewContext(`${code};seen=document.referrer;`, sandbox);
  return { replaced, session, seen: sandbox.seen };
}

describe("script de chegada: a origem guardada volta ao document.referrer", () => {
  it("vindo do divisor (o próprio site) com a origem guardada: o rastreamento vê o Instagram; a chave sai", () => {
    const session = new Map([[REFERRER_KEY, fresh("https://l.instagram.com/")]]);
    const r = visit(earlyScript(), {
      href: "https://site.com/oferta-b/?utm_source=bio",
      referrer: "https://site.com/?utm_source=bio",
      session,
    });
    expect(r.replaced).toEqual([]);
    expect(r.seen).toBe("https://l.instagram.com/");
    expect(session.has(REFERRER_KEY)).toBe(false);
  });

  it("vale também sem origem nenhuma (página com no-referrer) e numa versão A/B com celular", () => {
    const session = new Map([[REFERRER_KEY, fresh("https://www.google.com/")]]);
    const r = visit(earlyScript({ mobileDir: "celular/", ab: { key: "k", folder: "oferta-b/", id: "ib", up: 1 } }), {
      href: "https://site.com/oferta-b/",
      referrer: "",
      session,
    });
    expect(r.replaced).toEqual([]);
    expect(r.seen).toBe("https://www.google.com/");
    expect(session.has(REFERRER_KEY)).toBe(false);
  });

  it("uma vez só: a página seguinte do funil vê a página anterior (a origem de verdade)", () => {
    const session = new Map([[REFERRER_KEY, fresh("https://l.instagram.com/")]]);
    visit(earlyScript(), { href: "https://site.com/oferta-b/", referrer: "https://site.com/", session });
    const next = visit(earlyScript(), {
      href: "https://site.com/upsell/",
      referrer: "https://site.com/oferta-b/",
      session,
    });
    expect(next.seen).toBe("https://site.com/oferta-b/");
  });

  it("chegou de outro site (visita nova): vale a origem do navegador e a guardada (velha) sai", () => {
    const session = new Map([[REFERRER_KEY, fresh("https://l.instagram.com/")]]);
    const r = visit(earlyScript(), {
      href: "https://site.com/oferta-b/",
      referrer: "https://www.google.com/",
      session,
    });
    expect(r.seen).toBe("https://www.google.com/");
    expect(session.has(REFERRER_KEY)).toBe(false);
  });

  it("sem origem guardada: nada muda", () => {
    expect(visit(earlyScript(), { href: "https://site.com/x/", referrer: "https://site.com/" }).seen).toBe(
      "https://site.com/",
    );
    expect(visit(earlyScript(), { href: "https://site.com/x/", referrer: "" }).seen).toBe("");
  });

  it("nunca troca por algo que não seja um endereço http(s) ou de app Android", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "//x.com/", "https:///", "lixo"]) {
      const session = new Map([[REFERRER_KEY, fresh(bad)]]);
      const r = visit(earlyScript(), { href: "https://site.com/oferta-b/", referrer: "https://site.com/", session });
      expect(r.seen, bad).toBe("https://site.com/");
      expect(session.has(REFERRER_KEY), bad).toBe(false);
    }
  });

  it("origem de app Android (app do Google, Discover, Gmail): o divisor guarda e a versão devolve", () => {
    const toA = splitterScript(
      [
        { folder: "oferta-a/", weight: 100, id: "ia" },
        { folder: "oferta-b/", weight: 0, id: "ib" },
      ],
      "k",
    );
    for (const app of [
      "android-app://com.google.android.googlequicksearchbox/",
      "android-app://com.google.android.gm/",
    ]) {
      const session = new Map<string, string>();
      const atSplitter = visit(toA, { href: "https://site.com/?x=1", referrer: app, session });
      expect(atSplitter.replaced, app).toEqual(["/oferta-a/?x=1"]);
      expect(refUrl(session.get(REFERRER_KEY)), app).toBe(app);
      const atVersion = visit(earlyScript({ ab: { key: "k", folder: "oferta-a/", id: "ia", up: 1 } }), {
        href: "https://site.com/oferta-a/?x=1",
        referrer: "https://site.com/?x=1",
        session,
      });
      expect(atVersion.seen, app).toBe(app);
      expect(session.has(REFERRER_KEY), app).toBe(false);
    }
  });

  it("o divisor guarda a hora junto, e só uma origem que a página de destino usaria", () => {
    const code = splitterScript([{ folder: "oferta-a/", weight: 100, id: "ia" }], "k");
    const before = Date.now();
    const session = new Map<string, string>();
    visit(code, { href: "https://site.com/", referrer: "https://www.facebook.com/", session });
    const saved = session.get(REFERRER_KEY) ?? "";
    expect(saved).toMatch(/^\d+\|https:\/\/www\.facebook\.com\/$/);
    const time = Number(saved.split("|")[0]);
    expect(time).toBeGreaterThanOrEqual(before);
    expect(time).toBeLessThanOrEqual(Date.now());
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "lixo"]) {
      const s = new Map<string, string>();
      visit(code, { href: "https://site.com/", referrer: bad, session: s });
      expect(s.has(REFERRER_KEY), bad).toBe(false);
    }
  });

  it("origem que sobrou na aba (redirecionamento interrompido): uma visita depois não a herda", () => {
    const version = earlyScript({ ab: { key: "k", folder: "oferta-a/", id: "ia", up: 1 } });
    for (const old of [
      fresh("https://velho.example/", REFERRER_MAX_AGE_MS + 1000),
      fresh("https://velho.example/", 30 * 60_000),
      // Sem a hora (formato de um ZIP antigo) ou com a hora no futuro (relógio mudado).
      "https://velho.example/",
      fresh("https://velho.example/", -10 * 60_000),
    ]) {
      // Endereço digitado (sem origem) e link de dentro do site (o próprio site como origem).
      for (const referrer of ["", "https://site.com/oferta/"]) {
        const session = new Map([[REFERRER_KEY, old]]);
        const r = visit(version, { href: "https://site.com/oferta/oferta-a/", referrer, session });
        expect(r.replaced).toEqual([]);
        expect(r.seen, old).toBe(referrer);
        // Usada ou não, a chave sai na primeira página que fica.
        expect(session.has(REFERRER_KEY), old).toBe(false);
      }
    }
  });

  it("redirecionamento lento (dentro de 1 minuto): a origem ainda volta", () => {
    const session = new Map([[REFERRER_KEY, fresh("https://l.instagram.com/", REFERRER_MAX_AGE_MS - 5000)]]);
    const r = visit(earlyScript(), { href: "https://site.com/oferta-b/", referrer: "https://site.com/", session });
    expect(r.seen).toBe("https://l.instagram.com/");
    expect(REFERRER_MAX_AGE_MS).toBe(60_000);
  });

  it("a página que redireciona de novo (celular/, barra no fim) não consome: a origem segue até a que fica", () => {
    const session = new Map([[REFERRER_KEY, fresh("https://l.instagram.com/")]]);
    const withMobile = earlyScript({ mobileDir: "celular/" });
    // Divisor → /oferta-b/ (celular) → /oferta-b/celular/.
    const middle = visit(withMobile, {
      href: "https://site.com/oferta-b/",
      referrer: "https://site.com/",
      session,
      ua: IPHONE,
    });
    expect(middle.replaced).toEqual(["celular/"]);
    expect(refUrl(session.get(REFERRER_KEY))).toBe("https://l.instagram.com/");
    const end = visit(earlyScript(), {
      href: "https://site.com/oferta-b/celular/",
      referrer: "https://site.com/oferta-b/",
      session,
      ua: IPHONE,
    });
    expect(end.replaced).toEqual([]);
    expect(end.seen).toBe("https://l.instagram.com/");
    expect(session.has(REFERRER_KEY)).toBe(false);
    // Sem a barra no fim: recarrega com a barra e a origem continua guardada.
    const s2 = new Map<string, string>();
    const slash = visit(earlyScript(), {
      href: "https://site.com/upsell",
      referrer: "https://www.google.com/",
      session: s2,
    });
    expect(slash.replaced).toEqual(["/upsell/"]);
    expect(refUrl(s2.get(REFERRER_KEY))).toBe("https://www.google.com/");
    const landed = visit(earlyScript(), {
      href: "https://site.com/upsell/",
      referrer: "https://site.com/upsell",
      session: s2,
    });
    expect(landed.seen).toBe("https://www.google.com/");
  });

  it("divisor + página da versão, ponta a ponta: guarda no divisor e devolve na versão", () => {
    const session = new Map<string, string>();
    const splitter = splitterScript(
      [
        { folder: "oferta-a/", weight: 50, id: "ia" },
        { folder: "oferta-b/", weight: 50, id: "ib" },
      ],
      "k",
    );
    const atSplitter = visit(splitter, {
      href: "https://site.com/?utm_source=x",
      referrer: "https://www.facebook.com/",
      session,
    });
    expect(atSplitter.replaced).toHaveLength(1);
    expect(refUrl(session.get(REFERRER_KEY))).toBe("https://www.facebook.com/");
    const atVersion = visit(earlyScript({ ab: { key: "k", folder: "oferta-a/", id: "ia", up: 1 } }), {
      href: `https://site.com${atSplitter.replaced[0]}`,
      referrer: "https://site.com/?utm_source=x",
      session,
    });
    expect(atVersion.seen).toBe("https://www.facebook.com/");
  });

  it("aberto do computador (file://): não mexe", () => {
    const session = new Map([[REFERRER_KEY, fresh("https://l.instagram.com/")]]);
    const r = visit(earlyScript(), { href: "file:///Users/x/oferta/oferta-b/index.html", session });
    expect(r.seen).toBe("");
    expect(refUrl(session.get(REFERRER_KEY))).toBe("https://l.instagram.com/");
  });

  it("sessionStorage bloqueado: a página abre normalmente", () => {
    const sandbox = {
      location: { pathname: "/oferta-b/", search: "", hash: "", protocol: "https:", host: "site.com", replace() {} },
      get sessionStorage() {
        throw new Error("bloqueado");
      },
      localStorage: { getItem: () => null, setItem: () => {} },
      document: { referrer: "https://site.com/", cookie: "", write() {}, addEventListener() {} },
      navigator: { userAgent: "x" },
      window: {},
      screen: { width: 1, height: 1 },
      seen: "",
    };
    expect(() => runInNewContext(`${earlyScript()};seen=document.referrer`, sandbox)).not.toThrow();
    expect(sandbox.seen).toBe("https://site.com/");
  });

  it("ES5 e usa a mesma chave do SAVE_REF_JS", () => {
    expect(RESTORE_REF_JS).toContain(JSON.stringify(REFERRER_KEY));
    expect(SAVE_REF_JS).toContain(JSON.stringify(REFERRER_KEY));
    expect(RESTORE_REF_JS).not.toMatch(/=>|\blet\b|\bconst\b|`/);
    // Fica depois dos redirecionamentos (só a página que fica devolve a origem).
    const code = earlyScript({ mobileDir: "celular/" });
    expect(code.indexOf(RESTORE_REF_JS)).toBeGreaterThan(code.lastIndexOf("l.replace("));
  });
});

// ─── Safari ──────────────────────────────────────────────────────────────────

describe("isSafariUserAgent", () => {
  it("Safari do Mac e do iPad/iPhone: sim", () => {
    for (const ua of [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15",
      IPHONE,
    ]) {
      expect(isSafariUserAgent(ua), ua).toBe(true);
    }
  });

  it("Chrome, Edge, Firefox, Opera, Chrome/Firefox do iPhone, Playwright: não", () => {
    for (const ua of [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/114.0.0.0",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/131.0 Mobile/15E148 Safari/605.1.15",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36",
      "",
      null,
      undefined,
    ]) {
      expect(isSafariUserAgent(ua), String(ua)).toBe(false);
    }
  });
});

describe("aviso do Safari", () => {
  const noop = () => {};

  it("o passo a passo começa por ele (pasta em vez de .zip, Lixeira, não compactar de novo)", () => {
    const open = renderToStaticMarkup(createElement(HostingGuide, { open: true, onOpenChange: noop }));
    expect(open).toContain("Baixou pelo Safari?");
    expect(open.indexOf("Baixou pelo Safari?")).toBeLessThan(open.indexOf("Hostinger (hPanel)"));
    for (const text of ["Lixeira", "Abrir arquivos ‘seguros’ após o download", "Não compacte a pasta de novo"]) {
      expect(open).toContain(text);
    }
    const closed = renderToStaticMarkup(createElement(HostingGuide, { open: false, onOpenChange: noop }));
    expect(closed).not.toContain("Lixeira");
  });

  it("o mesmo texto no aviso do “ZIP pronto”", () => {
    const tip = renderToStaticMarkup(createElement(SafariZipTip));
    expect(tip).toContain("pegue o .zip na <strong>Lixeira</strong>");
    expect(tip).toContain("seudominio.com.br/nome-da-pasta/");
  });

  it("LEIA-ME com o divisor: não diz mais que a visita sem UTMs vira “direta”", () => {
    const text = leiaMe({
      offerName: "Oferta",
      date: "01/10/2026",
      pages: [{ name: "Página principal", dir: "", mobile: false }],
      splits: [
        {
          page: "Página principal",
          dir: "",
          splitter: true,
          variants: [
            { name: "A", folder: "oferta-a/", percent: 50 },
            { name: "B", folder: "oferta-b/", percent: 50 },
          ],
        },
      ],
      serverEvents: [],
      preserveJs: [],
      warnings: [],
    });
    expect(text).not.toContain("direta");
    expect(text).toContain("O divisor não apaga a origem da visita");
  });

  it("LEIA-ME: explica a pasta no lugar do .zip, em linhas curtas", () => {
    const text = leiaMe({
      offerName: "Oferta",
      date: "01/10/2026",
      pages: [{ name: "Página principal", dir: "", mobile: false }],
      splits: [],
      serverEvents: [],
      preserveJs: [],
      warnings: [],
    });
    expect(text).toContain("Baixou pelo Safari e apareceu uma pasta em vez do .zip?");
    expect(text).toContain("Lixeira");
    expect(text).toContain("Não compacte a pasta de novo");
    const start = text.indexOf("Baixou pelo Safari");
    const block = text.slice(start, text.indexOf("\n\n", start)).split("\n");
    expect(block.length).toBeGreaterThan(2);
    for (const line of block) expect(line.length, line).toBeLessThanOrEqual(76);
  });
});
