/**
 * Regressões da 1ª rodada de correções do "Baixar ZIP" (Fase 5), funções puras:
 * - divisor com as metas do <head> da versão de controle (verificação de
 *   domínio, descrição, og:*, ícone) e título da versão, nunca o nome interno;
 * - metas de verificação fora do código em espera do consentimento; og:image com
 *   endereço completo;
 * - "Preservar JS": nada que a hospedagem executaria (.php, .htaccess…),
 *   nenhum caminho que colida (arquivo × pasta, maiúsculas), cópias nas
 *   pastas das versões;
 * - divisor/script de chegada: nunca redirecionam para outro site
 *   ("//outro-site.com/"), guardam a versão vista (também quem chega direto),
 *   a identidade da versão, celular direto e a origem da visita;
 * - eventos.php: tokens em eventos-dados/ (nada de .htaccess na raiz), IP
 *   da conexão e Origin/Referer obrigatório;
 * - LEIA-ME, letras das versões, controle ao excluir, rótulos da tela,
 *   "agora mesmo", endereços reservados e download conferido.
 */
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkedDownload, DOWNLOAD_FAILED_MESSAGE } from "@/components/offers/export/download";
import { queueStalled, SPLITTER_OFF_LABEL, splitterOffLabel } from "@/components/offers/export/logic";
import { afterDelete, nextVariantName } from "@/components/offers/variants/weights";
import {
  absolutizeShareImages,
  earlyScript,
  ensureHeadMetas,
  hasRelativeShareImage,
  shareHead,
  verificationMetas,
} from "@/lib/export/head";
import { type LayoutPage, planLayout, shortHash, variantDirs } from "@/lib/export/layout";
import type { ExportView } from "@/lib/export/options";
import {
  blockedPreservePath,
  brokenZipPath,
  isServerSidePath,
  preserveJsZipPath,
  preserveOriginalDir,
  preserveRelativePath,
  rebaseRelativeUrl,
  ZipPathSet,
} from "@/lib/export/paths";
import {
  EVENTOS_CONFIG_DIR,
  EVENTOS_CONFIG_FILE,
  EVENTOS_RATE_LIMIT,
  eventosConfigPhp,
  eventosPhp,
  HTACCESS_FILE,
} from "@/lib/export/php";
import { leiaMe } from "@/lib/export/readme";
import { splitterHtml, splitterScript } from "@/lib/export/splitter";
import { timeAgo } from "@/lib/format";
import { RESERVED_SLUGS, slugProblem, uniqueSlug } from "@/lib/text";
import { gateCode } from "@/lib/tracking/inject";
import { canonicalFolders, planPreserveFiles } from "@/server/services/export/preserve";
import type { ExportSource, SourcePage } from "@/server/services/export/source";

// ─── "Janela" falsa para os scripts do ZIP ───────────────────────────────────

interface FakeRun {
  href: string;
  random?: number;
  storage?: Map<string, string>;
  session?: Map<string, string>;
  cookie?: string;
  referrer?: string;
  ua?: string;
  now?: number;
}

function run(code: string, opts: FakeRun) {
  const url = new URL(opts.href);
  const storage = opts.storage ?? new Map<string, string>();
  const session = opts.session ?? new Map<string, string>();
  const cookies: string[] = [];
  let cookie = opts.cookie ?? "";
  const replaced: string[] = [];
  const math = Object.create(Math);
  math.random = () => opts.random ?? 0.1;
  const now = opts.now ?? 1_800_000_000_000;
  class FakeDate {
    getTime() {
      return now;
    }
  }
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
        cookies.push(v);
        cookie = cookie ? `${cookie}; ${v.split(";")[0]}` : v.split(";")[0];
      },
      write: () => {},
      addEventListener: () => {},
    },
    navigator: { userAgent: opts.ua ?? "Mozilla/5.0 (Macintosh) Chrome/130" },
    window: {},
    screen: { width: 1440, height: 900 },
    Date: FakeDate,
    Math: math,
    RegExp,
    encodeURIComponent,
    decodeURIComponent,
  });
  return { replaced, storage, session, cookies };
}

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1";

describe("divisor: nunca sai do site", () => {
  const code = splitterScript(
    [
      { folder: "oferta-a/", weight: 50, id: "ia" },
      { folder: "oferta-b/", weight: 50, id: "ib" },
    ],
    "k",
  );

  it("caminho com // ou \\ no começo é normalizado (hospedagem que entrega o index.html para qualquer caminho)", () => {
    for (const href of [
      "https://site.com//evil.test/",
      "https://site.com//evil.test/login",
      "https://site.com/\\evil.test/",
    ]) {
      const { replaced } = run(code, { href, random: 0.9 });
      expect(replaced).toHaveLength(1);
      expect(replaced[0]).toMatch(/^\/[^/\\]/);
      // Resolvido contra o site, continua no mesmo host.
      expect(new URL(replaced[0], "https://site.com/").host).toBe("site.com");
    }
    expect(run(code, { href: "https://site.com//evil.test/", random: 0.9 }).replaced).toEqual(["/evil.test/oferta-b/"]);
  });

  it("guarda pasta, data e identidade; uma versão recriada com a mesma letra sorteia de novo", () => {
    const now = 1_800_000_000_000;
    const first = run(code, { href: "https://site.com/", random: 0.9, now });
    expect(first.storage.get("os_ab_k")).toBe(`oferta-b/|${now}|ib`);
    expect(first.cookies[0]).toContain("os_ab_k=oferta-b%2F%7Cib");
    // Mesma pasta, identidade de outra versão (a B antiga foi excluída e recriada): sorteia de novo.
    const stale = new Map([["os_ab_k", `oferta-b/|${now}|velha`]]);
    expect(run(code, { href: "https://site.com/", random: 0.1, storage: stale, now }).replaced).toEqual(["/oferta-a/"]);
    const same = new Map([["os_ab_k", `oferta-b/|${now}|ib`]]);
    expect(run(code, { href: "https://site.com/", random: 0.1, storage: same, now }).replaced).toEqual(["/oferta-b/"]);
  });

  it("guarda a origem da visita (outro site) antes de redirecionar; do próprio site, não", () => {
    const from = run(code, { href: "https://site.com/?x=1", referrer: "https://www.instagram.com/p/abc" });
    // Com a hora (o script de chegada só devolve uma origem guardada há menos de 1 minuto).
    expect(from.session.get("os_ref")).toBe("1800000000000|https://www.instagram.com/p/abc");
    const self = run(code, { href: "https://site.com/", referrer: "https://site.com/obrigado/" });
    expect(self.session.has("os_ref")).toBe(false);
  });

  it("celular com versão celular separada vai direto para a pasta celular/ dela (um redirecionamento a menos)", () => {
    const withMobile = splitterScript(
      [
        { folder: "oferta-a/", weight: 100, id: "ia", mobile: "celular/" },
        { folder: "oferta-b/", weight: 0, id: "ib", mobile: null },
      ],
      "k",
    );
    expect(run(withMobile, { href: "https://site.com/?utm_source=fb", ua: IPHONE }).replaced).toEqual([
      "/oferta-a/celular/?utm_source=fb",
    ]);
    expect(run(withMobile, { href: "https://site.com/" }).replaced).toEqual(["/oferta-a/"]);
    expect(run(withMobile, { href: "https://site.com/?versao=computador", ua: IPHONE }).replaced).toEqual([
      "/oferta-a/?versao=computador",
    ]);
  });
});

describe("script de chegada", () => {
  it("nunca recarrega para outro site (//outro-site.com/x → /outro-site.com/x/)", () => {
    expect(run(earlyScript(), { href: "https://site.com//evil.test/x" }).replaced).toEqual(["/evil.test/x/"]);
    expect(run(earlyScript(), { href: "https://site.com/\\evil.test/x?a=1" }).replaced).toEqual(["/evil.test/x/?a=1"]);
  });

  it("versão A/B: guarda a versão vista no formato do divisor (quem chega direto continua nela)", () => {
    const code = earlyScript({ ab: { key: "k", folder: "oferta-b/", id: "ib", up: 1 } });
    const now = 1_800_000_000_000;
    const r = run(code, { href: "https://site.com/promo/oferta-b/?utm_source=ad", now });
    expect(r.replaced).toEqual([]);
    expect(r.storage.get("os_ab_k")).toBe(`oferta-b/|${now}|ib`);
    expect(r.cookies[0]).toMatch(/^os_ab_k=oferta-b%2F%7Cib;max-age=2592000;path=\/promo\/;SameSite=Lax$/);
    // O divisor lê o que a versão guardou e manda para a mesma versão.
    const splitter = splitterScript(
      [
        { folder: "oferta-a/", weight: 50, id: "ia" },
        { folder: "oferta-b/", weight: 50, id: "ib" },
      ],
      "k",
    );
    expect(run(splitter, { href: "https://site.com/promo/", random: 0.01, storage: r.storage, now }).replaced).toEqual([
      "/promo/oferta-b/",
    ]);
    // Celular da versão: a pasta da página fica duas acima.
    const mobile = earlyScript({ ab: { key: "k", folder: "oferta-b/", id: "ib", up: 2 } });
    expect(run(mobile, { href: "https://site.com/oferta-b/celular/" }).cookies[0]).toContain(";path=/;");
    // Aberto do computador: não guarda nada.
    expect(run(code, { href: "file:///Users/ana/oferta/oferta-b/index.html" }).storage.size).toBe(0);
  });
});

// ─── Metas do <head> ─────────────────────────────────────────────────────────

describe("metas do <head>", () => {
  const VERIF = '<meta name="facebook-domain-verification" content="abc123">';

  it("metas de verificação do código colado (fora de comentários e scripts)", () => {
    const code = `${VERIF}\n<!-- <meta name="google-site-verification" content="comentado"> -->\n<meta name="google-site-verification" content="g-1"><meta name="p:domain_verify" content="pin"><meta name="msvalidate.01" content="bing"><meta name="description" content="não"><script>fbq('init','1')</script>`;
    expect(verificationMetas(code)).toEqual([
      VERIF,
      '<meta name="google-site-verification" content="g-1">',
      '<meta name="p:domain_verify" content="pin">',
      '<meta name="msvalidate.01" content="bing">',
    ]);
    expect(verificationMetas(null)).toEqual([]);
  });

  it("verificação dentro do <template> do consentimento volta para o <head> de verdade, sem repetir", () => {
    const gated = `<html><head><title>x</title><template data-os-consent="marketing">${VERIF}<script>fbq('init','1')</script></template></head><body></body></html>`;
    const out = ensureHeadMetas(gated, [VERIF]);
    expect(out.replace(/<template[\s\S]*?<\/template>/, "")).toContain(VERIF);
    expect(out.indexOf(VERIF, out.indexOf("</template>"))).toBeLessThan(out.indexOf("</head>"));
    const already = `<html><head>${VERIF}</head><body></body></html>`;
    expect(ensureHeadMetas(already, [VERIF])).toBe(already);
  });

  it("código em espera no formato atual do consentimento (gateCode): a verificação fica fora do bloco; o resto, dentro", () => {
    const GOOGLE = '<meta name="google-site-verification" content="dentro">';
    const held = gateCode(
      `${VERIF}${GOOGLE}<meta property="og:image" content="x.jpg"><script>fbq('init','1')</script>`,
      "MARKETING",
    );
    expect(held).toContain('data-os-consent="marketing"');
    // Fase 6: o próprio gateCode (prévia e ZIP) deixa as metas de verificação no lugar, fora do bloco.
    expect(held.startsWith(`${VERIF}${GOOGLE}<script type="application/json"`)).toBe(true);
    const html = `<html><head><title>x</title>${held}</head><body></body></html>`;
    // Já estão no <head> de verdade, uma vez só: o ajudante do ZIP não acrescenta nada.
    const out = ensureHeadMetas(html, [VERIF]);
    expect(out).toBe(html);
    expect(out.split(VERIF)).toHaveLength(2);
    expect(out.indexOf(VERIF)).toBeLessThan(out.indexOf("</head>"));
    // O divisor copia só a verificação (fora do bloco); a imagem de dentro não, nem gera aviso.
    expect(shareHead(html, (u) => u).tags).toEqual([VERIF, GOOGLE]);
    expect(hasRelativeShareImage(html)).toBe(false);
  });

  it("imagem de compartilhamento com endereço completo; aviso só quando fica relativa", () => {
    const html = `<html><head><meta property="og:image" content="../assets/x.jpg"><meta name="twitter:image" content="../assets/x.jpg"><link rel="image_src" href="../assets/x.jpg"><meta property="og:image:secure_url" content="https://cdn.com/y.jpg"></head><body><img src="../assets/x.jpg"></body></html>`;
    expect(hasRelativeShareImage(html)).toBe(true);
    const out = absolutizeShareImages(html, "https://www.exemplo.com.br/promo/oferta-a/");
    expect(out).toContain('<meta property="og:image" content="https://www.exemplo.com.br/promo/assets/x.jpg">');
    expect(out).toContain('<meta name="twitter:image" content="https://www.exemplo.com.br/promo/assets/x.jpg">');
    expect(out).toContain('<link rel="image_src" href="https://www.exemplo.com.br/promo/assets/x.jpg">');
    expect(out).toContain('content="https://cdn.com/y.jpg"');
    // O corpo não muda.
    expect(out).toContain('<img src="../assets/x.jpg">');
    expect(hasRelativeShareImage(out)).toBe(false);
  });

  it("o divisor copia título, verificação, descrição, og:* (menos og:url), twitter:* e ícones — nunca scripts", () => {
    const control = `<html lang="en"><head><meta charset="utf-8"><title>Método &amp; Cia</title>${VERIF}
<meta name="description" content="Descrição"><meta property="og:title" content="OG"><meta property="og:url" content="https://site.com/oferta-a/">
<meta property="og:image" content="../assets/og.png"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="../assets/fav.png" type="image/png"><link rel="stylesheet" href="../assets/a.css">
<template data-os-consent="marketing"><meta name="google-site-verification" content="dentro"></template>
<script>fbq('track','PageView')</script></head><body></body></html>`;
    const head = shareHead(control, (u) => rebaseRelativeUrl(u, "oferta-a/", ""));
    expect(head.titleHtml).toBe("Método &amp; Cia");
    expect(head.tags).toEqual([
      '<meta name="facebook-domain-verification" content="abc123">',
      '<meta name="description" content="Descrição">',
      '<meta property="og:title" content="OG">',
      '<meta property="og:image" content="assets/og.png">',
      '<meta name="twitter:card" content="summary_large_image">',
      '<link rel="icon" href="assets/fav.png" type="image/png">',
    ]);
    const page = splitterHtml({
      variants: [{ folder: "oferta-a/", weight: 100 }],
      key: "k",
      title: "Oferta",
      titleHtml: head.titleHtml,
      lang: "en",
      headTags: head.tags.join("\n"),
    });
    expect(page).toContain("<title>Método &amp; Cia</title>");
    expect(page).toContain('<meta name="robots" content="noindex">');
    expect(page).toContain(VERIF);
    expect(page).not.toContain("fbq");
    expect(page).not.toContain("og:url");
    // Só o script do próprio divisor.
    expect(page.match(/<script/g)).toHaveLength(1);
  });

  it("endereço relativo de uma pasta para outra", () => {
    expect(rebaseRelativeUrl("../assets/x.png", "oferta-a/", "")).toBe("assets/x.png");
    expect(rebaseRelativeUrl("../../assets/x.png?v=1#a", "upsell/oferta-b/", "upsell/")).toBe("../assets/x.png?v=1#a");
    expect(rebaseRelativeUrl("img/a.png", "oferta-a/", "")).toBe("oferta-a/img/a.png");
    expect(rebaseRelativeUrl("./", "oferta-a/", "")).toBe("oferta-a/");
    for (const same of ["https://cdn.com/a.png", "//cdn.com/a.png", "/abs.png", "#x", "data:image/png;base64,AA"]) {
      expect(rebaseRelativeUrl(same, "oferta-a/", "")).toBe(same);
    }
  });
});

// ─── Caminhos do "Preservar JS" ──────────────────────────────────────────────

describe("Preservar JS: segurança e colisões", () => {
  it("nada que a hospedagem executaria ou usaria como configuração", () => {
    for (const p of [
      "api/shell.php",
      ".user.ini",
      "img/.htaccess",
      "sub/.htaccess",
      "wp/cmd.phtml",
      "x.php.png",
      "PHP.PHP",
      ".User.ini",
      "web.config",
      "cgi-bin/x",
      "a/b.phar",
      "x.asp",
      "x.jsp",
      ".git/config",
      "php.ini",
      "run.cgi",
      "x.PHP7",
    ]) {
      expect(isServerSidePath(p), p).toBe(true);
    }
    for (const p of [
      "img/foto.png",
      "js/app.js",
      "dados/config.json",
      ".well-known/apple-app-site-association",
      "photo.jpg",
    ]) {
      expect(isServerSidePath(p), p).toBe(false);
    }
    expect(preserveJsZipPath("/api/shell.php")).toBeNull();
    expect(blockedPreservePath("/api/shell.php")).toBe("api/shell.php");
    expect(preserveJsZipPath("/img/.htaccess?x=1")).toBeNull();
    expect(preserveJsZipPath("/js/app.js?v=2")).toBe("js/app.js");
    expect(blockedPreservePath("/js/app.js")).toBeNull();
  });

  it("arquivo × pasta e maiúsculas: o ZIP abriria quebrado no Mac/Windows", () => {
    const set = new ZipPathSet();
    set.add("obrigado/index.html");
    set.add("Img/Logo.png");
    set.add("x");
    expect(set.conflict("obrigado")).toBe("folder");
    expect(set.conflict("Obrigado")).toBe("folder");
    expect(set.conflict("img/logo.png")).toBe("case-file");
    expect(set.conflict("Img/Logo.png")).toBe("same");
    expect(set.conflict("img/outra.png")).toBe("case-folder");
    expect(set.conflict("x/y")).toBe("file-parent");
    expect(set.conflict("Img/nova.png")).toBeNull();
    expect(brokenZipPath(["obrigado", "obrigado/index.html"])).toBe("obrigado/index.html");
    expect(brokenZipPath(["A/b.png", "a/b.png"])).toBe("a/b.png");
    expect(brokenZipPath(["a/x.png", "b/y.png"])).toBeNull();
  });

  it("pastas que só diferem na caixa: vale a grafia com mais arquivos (empate: minúsculas)", () => {
    const pick = (paths: string[]) => Object.fromEntries(canonicalFolders(paths));
    expect(pick(["Img/a.png", "img/b.png", "img/c.png"])).toEqual({ "img/": "img/" });
    expect(pick(["Img/a.png", "Img/b.png", "img/c.png"])).toEqual({ "img/": "Img/" });
    expect(pick(["Img/a.png", "img/b.png"])).toEqual({ "img/": "img/" });
    expect(pick(["JS/App/x.js", "js/app/y.js", "js/App/z.js"])).toEqual({ "js/": "js/", "js/app/": "js/app/" });
  });

  it("pasta original da página e caminho relativo a ela", () => {
    expect(preserveOriginalDir("https://site.com/quiz/")).toBe("/quiz/");
    expect(preserveOriginalDir("https://site.com/quiz/index.html?x=1")).toBe("/quiz/");
    expect(preserveOriginalDir("https://site.com")).toBe("/");
    expect(preserveOriginalDir(null)).toBe("/");
    expect(preserveOriginalDir("não é url")).toBe("/");
    expect(preserveRelativePath("img/x.png", "/")).toBe("img/x.png");
    expect(preserveRelativePath("quiz/img/x.png", "/quiz/")).toBe("img/x.png");
    expect(preserveRelativePath("img/x.png", "/quiz/")).toBeNull();
  });
});

const KEY = (n: number) => `a/${String(n).padStart(2, "0")}/${String(n).padStart(2, "0")}${"f".repeat(62)}.bin`;

function sourcePage(over: Partial<SourcePage> & Pick<SourcePage, "id" | "slug">): SourcePage {
  return {
    name: over.slug,
    type: "SALES",
    isHome: false,
    position: 0,
    cloneMode: "EDITABLE",
    sourceUrl: null,
    seo: null,
    customCode: null,
    variants: [
      {
        id: `${over.id}-a`,
        name: "A",
        label: null,
        isControl: true,
        weight: 100,
        position: 0,
        documents: [{ id: `${over.id}-a-doc`, device: "ALL", html: null, assetMap: null }],
      },
    ],
    ...over,
  };
}

function toLayoutPages(source: ExportSource): LayoutPage[] {
  return source.pages.map((p) => ({
    ...p,
    variants: p.variants.map((v) => ({ ...v, documents: v.documents.map((d) => ({ id: d.id, device: d.device })) })),
  }));
}

describe("Preservar JS: arquivos que vão no ZIP", () => {
  const assetMap = {
    "/js/quiz.js?v=2": KEY(1),
    "/img/etapa-1.png": KEY(2),
    "/api/shell.php": KEY(3),
    "/.user.ini": KEY(4),
    "/img/.htaccess": KEY(5),
    // Prefetch do Next.js: vira o arquivo "obrigado", que colidiria com a pasta da página.
    "/obrigado?_rsc=1x": KEY(6),
    "/Img/Logo.png": KEY(7),
    "/img/logo.png": KEY(8),
    "/Assets/app.js": KEY(9),
  };
  const quizDoc = { id: "quiz-doc", device: "ALL" as const, html: null, assetMap };
  const source: ExportSource = {
    offer: { id: "o", name: "Oferta", settings: {}, liveUrl: null, updatedAt: new Date(0) },
    links: [],
    pages: [
      sourcePage({
        id: "quiz",
        slug: "quiz",
        isHome: true,
        cloneMode: "PRESERVE_JS",
        sourceUrl: "https://site.com/",
        variants: [
          { id: "qa", name: "A", label: null, isControl: true, weight: 50, position: 0, documents: [quizDoc] },
          {
            id: "qb",
            name: "B",
            label: null,
            isControl: false,
            weight: 50,
            position: 1,
            documents: [{ ...quizDoc, id: "quiz-doc-b" }],
          },
        ],
      }),
      sourcePage({ id: "obr", slug: "obrigado", position: 1 }),
    ],
  };
  const layout = planLayout(toLayoutPages(source), { splitter: true });
  const reserved = [...layout.files.map((f) => f.path), "assets/os-runtime.js", "eventos.php", "LEIA-ME.txt"];
  const plan = planPreserveFiles(source, layout, reserved);
  const paths = plan.entries.map((e) => e.zipPath);

  it("nada executável; colisões (arquivo × pasta, maiúsculas, assets/) ficam de fora com aviso", () => {
    expect(plan.blocked).toEqual([".user.ini", "api/shell.php", "img/.htaccess"]);
    expect(paths.some((p) => isServerSidePath(p))).toBe(false);
    expect(plan.collisions).toContain("obrigado");
    expect(plan.collisions).toContain("Assets/app.js");
    // "Img/" e "img/" viram uma pasta só no Mac/Windows: fica a grafia com mais
    // arquivos ("img/": etapa-1.png e logo.png); "Img/Logo.png" fica de fora com aviso.
    expect(paths).toContain("img/logo.png");
    expect(paths).toContain("img/etapa-1.png");
    expect(paths).not.toContain("Img/Logo.png");
    expect(plan.collisions).toContain("Img/Logo.png");
    expect(brokenZipPath([...reserved, ...paths])).toBeNull();
  });

  it("página que saiu da pasta original (versões em oferta-a/, oferta-b/): cópias ao lado dela", () => {
    expect(paths).toContain("js/quiz.js");
    expect(paths).toContain("img/etapa-1.png");
    // O script monta "img/etapa-1.png" relativo à página: precisa existir em cada pasta de versão.
    for (const dir of ["oferta-a/", "oferta-b/"]) {
      expect(paths).toContain(`${dir}img/etapa-1.png`);
      expect(paths).toContain(`${dir}js/quiz.js`);
      expect(paths).not.toContain(`${dir}api/shell.php`);
    }
    const copy = plan.entries.find((e) => e.zipPath === "oferta-a/img/etapa-1.png");
    expect(copy).toMatchObject({ key: KEY(2), primary: false, pageId: "quiz" });
  });

  it("página na mesma pasta do site original: sem cópias", () => {
    const single: ExportSource = {
      ...source,
      pages: [{ ...source.pages[0], variants: [source.pages[0].variants[0]] }],
    };
    const l = planLayout(toLayoutPages(single), { splitter: true });
    const p = planPreserveFiles(
      single,
      l,
      l.files.map((f) => f.path),
    );
    expect(p.entries.every((e) => e.primary)).toBe(true);
    // Funil: quiz clonado de site.com/quiz/ e publicado em quiz/: também sem cópias.
    const funnel: ExportSource = {
      ...source,
      pages: [
        sourcePage({ id: "home", slug: "inicio", isHome: true }),
        {
          ...single.pages[0],
          isHome: false,
          position: 1,
          sourceUrl: "https://site.com/quiz/",
          variants: [
            {
              ...single.pages[0].variants[0],
              documents: [{ ...quizDoc, assetMap: { "/quiz/img/a.png": KEY(2), "/js/x.js": KEY(1) } }],
            },
          ],
        },
      ],
    };
    const lf = planLayout(toLayoutPages(funnel), { splitter: true });
    const pf = planPreserveFiles(
      funnel,
      lf,
      lf.files.map((f) => f.path),
    );
    expect(pf.entries.map((e) => [e.zipPath, e.primary])).toEqual([
      ["js/x.js", true],
      ["quiz/img/a.png", true],
    ]);
  });
});

// ─── Layout e endereços do "Teste A/B" ───────────────────────────────────────

function layoutPage(over: Partial<LayoutPage> & Pick<LayoutPage, "id" | "slug">): LayoutPage {
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
        documents: [{ id: `${over.id}-doc`, device: "ALL" }],
      },
    ],
    ...over,
  };
}

const twoVersions = (id: string) => [
  {
    id: `${id}-a`,
    name: "A",
    label: null,
    isControl: true,
    weight: 50,
    position: 0,
    documents: [{ id: `${id}-1`, device: "ALL" as const }],
  },
  {
    id: `${id}-b`,
    name: "B",
    label: null,
    isControl: false,
    weight: 50,
    position: 1,
    documents: [{ id: `${id}-2`, device: "ALL" as const }],
  },
];

describe("endereço de cada versão no ZIP (o que o Teste A/B mostra)", () => {
  it("uma versão só: a pasta da página; várias: a pasta da versão; colisão: com sufixo", () => {
    const home = layoutPage({ id: "h", slug: "principal", isHome: true });
    const up = layoutPage({ id: "u", slug: "upsell", position: 1, variants: twoVersions("u") });
    expect(variantDirs([home, up], "h")).toEqual({ "h-a": "" });
    expect(variantDirs([home, up], "u")).toEqual({ "u-a": "upsell/oferta-a/", "u-b": "upsell/oferta-b/" });
    const abHome = { ...home, variants: twoVersions("h") };
    const other = layoutPage({ id: "x", slug: "oferta-b", position: 2 });
    expect(variantDirs([abHome, other], "h")).toEqual({ "h-a": "oferta-a/", "h-b": "oferta-b-2/" });
  });

  it("o divisor sabe a identidade e o celular de cada versão", () => {
    const home = layoutPage({
      id: "h",
      slug: "principal",
      isHome: true,
      variants: [
        {
          ...twoVersions("h")[0],
          documents: [
            { id: "d", device: "DESKTOP" },
            { id: "m", device: "MOBILE" },
          ],
        },
        twoVersions("h")[1],
      ],
    });
    const layout = planLayout([home], { splitter: true });
    expect(layout.files[0].splitter?.variants).toEqual([
      { folder: "oferta-a/", weight: 50, id: shortHash("h-a"), mobile: "celular/" },
      { folder: "oferta-b/", weight: 50, id: shortHash("h-b"), mobile: null },
    ]);
    const mobile = layout.files.find((f) => f.path === "oferta-a/celular/index.html");
    expect(mobile?.ab).toEqual({ key: shortHash("h"), folder: "oferta-a/", id: shortHash("h-a"), up: 2 });
  });

  it("endereços reservados: pastas das versões, celular/ e eventos-dados/", () => {
    for (const slug of ["oferta-a", "oferta-b", "oferta-e", "celular", "eventos-dados"]) {
      expect(RESERVED_SLUGS.has(slug)).toBe(true);
      expect(slugProblem(slug)).toContain("reservado");
    }
    expect(uniqueSlug("Oferta B", [])).toBe("oferta-b-pagina");
    expect(uniqueSlug("Celular", [])).toBe("celular-pagina");
  });
});

// ─── eventos.php ─────────────────────────────────────────────────────────────

describe("eventos.php e a pasta dos tokens", () => {
  it("tokens em eventos-dados/ com o .htaccess dela; nada na raiz além do eventos.php", () => {
    expect(EVENTOS_CONFIG_FILE).toBe("eventos-dados/config.php");
    expect(HTACCESS_FILE).toBe("eventos-dados/.htaccess");
    expect(EVENTOS_CONFIG_DIR).toBe("eventos-dados/");
    const code = eventosPhp();
    expect(code).toContain("@include __DIR__ . '/eventos-dados/config.php'");
    expect(eventosConfigPhp([])).toContain("'trust_proxy' => false");
  });

  it("IP da conexão (cabeçalhos de proxy só da Cloudflare ou com trust_proxy) e limite por esse IP", () => {
    const code = eventosPhp();
    expect(code).toContain(`const OS_RATE_LIMIT = ${EVENTOS_RATE_LIMIT};`);
    expect(code).toContain("os_from_cloudflare($remote)");
    expect(code).toContain("if ($trustProxy) {");
    // O limite usa o IP decidido por os_client_ip, nunca o cabeçalho cru.
    expect(code).toMatch(/\$ip = os_client_ip\(\$trustProxy\);\s*if \(!os_rate_ok\(\$ip\)\)/);
    expect(code).not.toMatch(/os_rate_ok\(\$_SERVER/);
    // Sem Origin nem Referer: recusa (o navegador sempre manda um dos dois).
    expect(code).toContain("if (!isset($_SERVER['HTTP_ORIGIN']) && empty($_SERVER['HTTP_REFERER'])) {");
  });
});

// ─── LEIA-ME ─────────────────────────────────────────────────────────────────

describe("LEIA-ME", () => {
  const text = leiaMe({
    offerName: "Oferta",
    date: "30/09/2026",
    pages: [
      { name: "Página principal", dir: "", mobile: false },
      { name: "Obrigado", dir: "obrigado/", mobile: false },
    ],
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
    serverEvents: ["Meta (API de Conversões)"],
    preserveJs: ["Quiz"],
    hiddenFromSearch: ["Obrigado"],
    warnings: [],
  });

  it("apagar o LEIA-ME da hospedagem, botões reais dos painéis, barra no fim e sobrescrever", () => {
    expect(text).toContain("apague de lá o ZIP e este");
    expect(text).toContain("LEIA-ME.txt (ele lista as pastas da oferta");
    expect(text).toContain('"Fazer upload" na Hostinger');
    expect(text).toContain('"Carregar" no cPanel');
    expect(text).toContain("COM a barra no fim");
    expect(text).toContain("Sobrescrever");
    // Vercel não tem "arrastar a pasta".
    expect(text).not.toMatch(/Vercel[^\n]*arraste|arraste[^\n]*Vercel/);
    expect(text).toContain('Netlify (arraste a pasta em "Deploy manually")');
  });

  it("A/B: o index.html é o divisor, 30 dias (7 no iPhone), como comparar e o cookie funcional", () => {
    expect(text).toContain("index.html  →  divisor A/B de Página principal (sorteia entre oferta-a/ e oferta-b/)");
    expect(text).toContain("por até 30 dias");
    expect(text).toContain("cerca de 7 dias");
    expect(text).toContain("COMO COMPARAR AS VERSÕES");
    expect(text).toContain("O UTMify sozinho");
    expect(text).toContain("link de checkout diferente em cada versão");
    expect(text).toContain("cookie funcional");
    expect(text).toContain("(canonical)");
    // As cópias só apontam para a principal (sem noindex: sinais contraditórios para o Google).
    const ab = text.slice(text.indexOf("TESTE A/B"), text.indexOf("COMO COMPARAR"));
    expect(ab).not.toContain("noindex");
  });

  it("eventos-dados/, teste aberto do computador e páginas fora do Google", () => {
    expect(text).toContain("eventos-dados/config.php");
    expect(text).toContain("meusite.com/eventos-dados/config.php — deve dar erro");
    expect(text).not.toMatch(/^\s*\.htaccess/m);
    expect(text).toContain("as fontes podem aparecer diferentes");
    expect(text).toContain('"Preservar JS" só funcionam depois');
    expect(text).toContain("“Obrigado” (obrigado/upsell) saem fora do Google");
  });
});

// ─── Tela ────────────────────────────────────────────────────────────────────

describe("tela do Teste A/B e do ZIP", () => {
  it("letras: não reaproveita logo a de uma versão excluída", () => {
    expect(nextVariantName(["A", "C"])).toBe("D");
    expect(nextVariantName(["A", "B", "C", "E"])).toBe("D");
  });

  it("excluir o controle: vira controle a de maior percentual depois da divisão (nunca uma pausada)", () => {
    const v = [
      { id: "a", isControl: true, weight: 50, name: "A" },
      { id: "b", isControl: false, weight: 0, name: "B" },
      { id: "c", isControl: false, weight: 50, name: "C" },
    ];
    const r = afterDelete(v, "a");
    expect(r.control?.name).toBe("C");
    expect(r.weights).toEqual([0, 100]);
    // Empate: a primeira da lista.
    expect(afterDelete([v[0], { ...v[1], weight: 25 }, { ...v[2], weight: 25 }], "a").control?.name).toBe("B");
    // Excluir uma que não é o controle não troca o controle.
    expect(afterDelete(v, "c").control?.name).toBe("A");
  });

  it("rótulo do index.html quando o divisor é desligado (antes do plano novo chegar)", () => {
    expect(splitterOffLabel("Divisor A/B de “Upsell” (A 50% · B 50%)")).toBe("Upsell — versão de controle");
    expect(splitterOffLabel("outra coisa")).toBe(SPLITTER_OFF_LABEL);
    expect(SPLITTER_OFF_LABEL).not.toContain("Versão A");
  });

  it("ZIP parado na fila: só com o robô de tarefas parado e depois de alguns segundos", () => {
    const base = { id: "e", status: "QUEUED", createdAt: new Date(1_000_000).toISOString() } as ExportView;
    expect(queueStalled({ ...base, workerOnline: false }, 1_000_000 + 9_000)).toBe(true);
    expect(queueStalled({ ...base, workerOnline: false }, 1_000_000 + 3_000)).toBe(false);
    expect(queueStalled({ ...base, workerOnline: true }, 1_000_000 + 60_000)).toBe(false);
    expect(queueStalled({ ...base, status: "RUNNING", workerOnline: false }, 1_000_000 + 60_000)).toBe(false);
    expect(queueStalled(null, 0)).toBe(false);
  });

  it("“agora mesmo” em vez de “há 0 segundos”", () => {
    expect(timeAgo(new Date())).toBe("agora mesmo");
    expect(timeAgo(new Date(Date.now() - 5 * 60_000))).toBe("há 5 minutos");
  });
});

describe("download conferido", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function fakeDocument() {
    const clicked: string[] = [];
    vi.stubGlobal("document", {
      createElement: () => {
        const a = { href: "", download: "", rel: "", style: {}, click: () => clicked.push(a.href), remove: () => {} };
        return a;
      },
      body: { appendChild: () => {} },
    });
    return clicked;
  }

  it("arquivo sumiu: mostra o motivo em português e não baixa", async () => {
    const clicked = fakeDocument();
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "HEAD"
        ? new Response(null, { status: 410 })
        : Response.json({ error: "O arquivo deste ZIP não existe mais. Gere de novo." }, { status: 410 }),
    );
    expect(await checkedDownload("/api/exports/x/download", "a.zip", fetcher as unknown as typeof fetch)).toBe(
      "O arquivo deste ZIP não existe mais. Gere de novo.",
    );
    expect(clicked).toEqual([]);
  });

  it("pronto: baixa; sem motivo: mensagem padrão; sem conexão: avisa", async () => {
    const clicked = fakeDocument();
    const ok = vi.fn(async () => new Response(null, { status: 200 }));
    expect(await checkedDownload("/api/exports/x/download", "a.zip", ok as unknown as typeof fetch)).toBeNull();
    expect(clicked).toEqual(["/api/exports/x/download"]);
    const bare = vi.fn(async () => new Response("erro", { status: 500 }));
    expect(await checkedDownload("/u", "a.zip", bare as unknown as typeof fetch)).toBe(DOWNLOAD_FAILED_MESSAGE);
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await checkedDownload("/u", "a.zip", offline as unknown as typeof fetch)).toContain("ainda está aberto");
  });
});
