/**
 * Medir o teste A/B (Fase 6) — partes sem navegador:
 *
 * - planLayout: cada arquivo de uma página com versões sabe a letra e a pasta
 *   da versão que mostra (também a cópia de controle sem divisor e o celular/);
 * - configuração pública: `variant` com os checkouts que recebem a marca em
 *   `src` (Hotmart, Kiwify, Eduzz) e nada para página com uma versão só;
 * - loadTracking({ variantId }) (prévia/"Testar pixels"): letra e pasta do banco;
 * - gateCode: metas de verificação de domínio fora do bloco em espera também
 *   na prévia (o mesmo ajudante do ZIP);
 * - textos: política de privacidade (os_ab_…, os_consent), LEIA-ME e o aviso
 *   do "Teste A/B" (quem recebe src × utm_content e por quê);
 * - tela "Testar pixels": versão informada pela página e opções velhas
 *   (versão/página excluída em outra aba).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  describeRow,
  reportedVersion,
  staleChoiceMessage,
  type TestPage,
  validPageId,
} from "@/components/offers/pixel-test/logic";
import { COMPARE_HINT_TITLE, CompareVersionsHint } from "@/components/offers/variants/compare-hint";
import { privacyHtml } from "@/editor/templates/legal";
import { prisma } from "@/lib/db";
import { ensureHeadMetas, verificationMetas } from "@/lib/export/head";
import { type LayoutPage, planLayout } from "@/lib/export/layout";
import { eventosPhp } from "@/lib/export/php";
import { leiaMe } from "@/lib/export/readme";
import { renderPageHtml } from "@/lib/page-render";
import { composeTrackingConfig, runtimeVariant, type TrackingSource, versionSrcHosts } from "@/lib/tracking/compose";
import { loadTracking, trackingVariantFor } from "@/lib/tracking/config";
import { splitVerificationMetas } from "@/lib/tracking/domain-verification";
import { gateCode } from "@/lib/tracking/inject";
import { parseTrackingSettings } from "@/lib/tracking/schema";
import type { PixelTestEventRow } from "@/lib/tracking/test-report";

// ─── Layout ──────────────────────────────────────────────────────────────────

type Device = "ALL" | "DESKTOP" | "MOBILE";

function variants(id: string, devices: Device[][]) {
  return devices.map((docs, i) => ({
    id: `${id}-${i}`,
    name: String.fromCharCode(65 + i),
    label: i === 1 ? "Headline nova" : null,
    isControl: i === 0,
    weight: 50,
    position: i,
    documents: docs.map((device) => ({ id: `${id}-${i}-${device}`, device })),
  }));
}

function page(over: Partial<LayoutPage> & { id: string; slug: string }): LayoutPage {
  return {
    name: over.slug,
    type: "SALES",
    isHome: false,
    position: 0,
    cloneMode: "EDITABLE",
    variants: variants(over.id, [["ALL"]]),
    ...over,
  };
}

describe("planLayout: versão de cada arquivo", () => {
  const pages = [
    page({ id: "home", slug: "principal", isHome: true, variants: variants("home", [["ALL"], ["DESKTOP", "MOBILE"]]) }),
    page({ id: "up", slug: "upsell", position: 1 }),
    page({ id: "down", slug: "downsell", position: 2, variants: variants("down", [["ALL"], ["ALL"], ["ALL"]]) }),
  ];

  it("com divisor: cada versão (e o celular dela) com a letra e a pasta; divisor e página simples sem versão", () => {
    const files = planLayout(pages, { splitter: true }).files;
    const byPath = Object.fromEntries(files.map((f) => [f.path, f.version]));
    expect(byPath).toEqual({
      "index.html": null,
      "oferta-a/index.html": { name: "A", folder: "oferta-a/" },
      "oferta-b/index.html": { name: "B", folder: "oferta-b/" },
      "oferta-b/celular/index.html": { name: "B", folder: "oferta-b/" },
      "upsell/index.html": null,
      "downsell/index.html": null,
      "downsell/oferta-a/index.html": { name: "A", folder: "oferta-a/" },
      "downsell/oferta-b/index.html": { name: "B", folder: "oferta-b/" },
      "downsell/oferta-c/index.html": { name: "C", folder: "oferta-c/" },
    });
  });

  it("sem divisor: a pasta da página mostra a versão de controle (e diz que é a A)", () => {
    const files = planLayout(pages, { splitter: false }).files;
    const home = files.find((f) => f.path === "index.html");
    expect(home?.kind).toBe("page");
    expect(home?.version).toEqual({ name: "A", folder: "oferta-a/" });
    expect(files.find((f) => f.path === "downsell/index.html")?.version).toEqual({ name: "A", folder: "oferta-a/" });
  });

  it("pasta que colide com outra página ganha sufixo: a versão leva a pasta de verdade", () => {
    const clash = [
      page({ id: "home", slug: "principal", isHome: true, variants: variants("home", [["ALL"], ["ALL"]]) }),
      page({ id: "x", slug: "oferta-b", position: 1 }),
    ];
    const files = planLayout(clash, { splitter: true }).files;
    expect(files.find((f) => f.variantId === "home-1")?.version).toEqual({ name: "B", folder: "oferta-b-2/" });
  });
});

// ─── Configuração pública ────────────────────────────────────────────────────

function source(over: Partial<TrackingSource> = {}): TrackingSource {
  return {
    mode: "live",
    settings: parseTrackingSettings({}),
    pixels: [{ vendor: "META", pixelId: "123456789012345", enabled: true, options: {} }],
    rules: [],
    links: [],
    pageId: "pagina1",
    policyUrl: null,
    ...over,
  };
}

describe("configuração pública com a versão", () => {
  it("checkouts com `src`: Hotmart, Kiwify e Eduzz (os outros recebem utm_content)", () => {
    const hosts = versionSrcHosts();
    for (const h of ["pay.hotmart.com", "go.hotmart.com", "sec.hotmart.com/payment", "pay.kiwify.com.br", "kiwify.app"])
      expect(hosts).toContain(h);
    expect(hosts).toContain("sun.eduzz.com");
    expect(hosts).toContain("chk.eduzz.com");
    expect(hosts.some((h) => /monetizze|braip|ticto|perfectpay/.test(h))).toBe(false);
  });

  it("variant só com nome no formato; sem versão, null", () => {
    expect(composeTrackingConfig(source()).variant).toBeNull();
    const config = composeTrackingConfig(source({ variant: { name: "B", folder: "oferta-b/" } }));
    expect(config.variant).toEqual({ name: "B", folder: "oferta-b/", srcHosts: versionSrcHosts() });
    expect(runtimeVariant({ name: "B<script>", folder: "x/" })).toBeNull();
    expect(runtimeVariant({ name: "", folder: "x/" })).toBeNull();
    expect(runtimeVariant(null)).toBeNull();
    // Também na prévia e na tela de teste (o checkout marcado aparece na prévia).
    expect(
      composeTrackingConfig(source({ mode: "preview", variant: { name: "C", folder: "oferta-c/" } })).variant?.name,
    ).toBe("C");
  });

  it("loadTracking({ variantId }): letra e pasta como no ZIP; outra página ou versão única → nenhuma", async () => {
    const offer = await prisma.offer.create({ data: { name: "Oferta A/B" }, select: { id: true } });
    const mk = (name: string, slug: string, position: number, isHome = false) =>
      prisma.page.create({
        data: { offerId: offer.id, name, slug, type: "SALES", isHome, position },
        select: { id: true },
      });
    const home = await mk("Início", "inicio", 0, true);
    const up = await mk("Upsell", "upsell", 1);
    const variant = (pageId: string, name: string, position: number) =>
      prisma.pageVariant.create({
        data: {
          pageId,
          name,
          isControl: position === 0,
          weight: 50,
          position,
          documents: { create: { device: "ALL", html: `<p>${name}</p>` } },
        },
        select: { id: true },
      });
    const a = await variant(home.id, "A", 0);
    const b = await variant(home.id, "B", 1);
    const upA = await variant(up.id, "A", 0);

    expect(await trackingVariantFor(offer.id, home.id, b.id)).toEqual({ name: "B", folder: "oferta-b/" });
    expect(await trackingVariantFor(offer.id, home.id, a.id)).toEqual({ name: "A", folder: "oferta-a/" });
    expect(await trackingVariantFor(offer.id, home.id, upA.id)).toBeNull();
    expect(await trackingVariantFor(offer.id, up.id, upA.id)).toBeNull();

    const base = { offerId: offer.id, mode: "preview" as const, pageHref: (id: string) => `/p/${id}` };
    expect((await loadTracking({ ...base, pageId: home.id, variantId: b.id }))?.config.variant).toMatchObject({
      name: "B",
      folder: "oferta-b/",
    });
    expect((await loadTracking({ ...base, pageId: up.id, variantId: upA.id }))?.config.variant).toBeNull();
    expect((await loadTracking({ ...base, pageId: home.id }))?.config.variant).toBeNull();
    // `variant` explícito (ZIP) vale sobre o ID.
    expect(
      (await loadTracking({ ...base, pageId: home.id, variantId: b.id, variant: { name: "A", folder: "oferta-a/" } }))
        ?.config.variant?.name,
    ).toBe("A");
  });
});

// ─── Verificação de domínio fora do consentimento ────────────────────────────

describe("gateCode: metas de verificação de domínio ficam fora do bloco em espera", () => {
  const FB = '<meta name="facebook-domain-verification" content="abc123">';
  const GOOGLE = '<meta name="google-site-verification" content="g-1">';
  const PIXEL = "<script>fbq('init','1')</script>";

  it("a meta sai antes do bloco; o resto do código continua em espera, igual", () => {
    const out = gateCode(`${FB}\n${PIXEL}`, "MARKETING");
    expect(out.startsWith(FB)).toBe(true);
    expect(out.slice(FB.length)).toBe(gateCode(`\n${PIXEL}`, "MARKETING"));
    expect(out).toContain('data-os-consent="marketing"');
    expect(out.slice(FB.length)).not.toContain("verification");
  });

  it("todas as metas de verificação (Meta, Google, Pinterest, Bing), limpas e sem repetir", () => {
    const code = `<meta content='g-1' name=google-site-verification>${FB}${FB}<meta name="p:domain_verify" content="pin"><meta name="msvalidate.01" content="bing"><meta name="description" content="fica">${PIXEL}`;
    const { metas, rest } = splitVerificationMetas(code);
    expect(metas).toEqual([
      GOOGLE,
      FB,
      '<meta name="p:domain_verify" content="pin">',
      '<meta name="msvalidate.01" content="bing">',
    ]);
    expect(rest).toBe(`<meta name="description" content="fica">${PIXEL}`);
    expect(verificationMetas(code)).toEqual(metas);
  });

  it("metas dentro de comentário, script ou <template> ficam onde estão; só metas → sem bloco", () => {
    const inert = `<!-- ${FB} --><script>document.write('${GOOGLE}')</script><template>${FB}</template>`;
    expect(splitVerificationMetas(inert)).toEqual({ metas: [], rest: inert });
    expect(gateCode(FB, "ANALYTICS")).toBe(FB);
    expect(gateCode(`${FB}${PIXEL}`, "NECESSARY")).toBe(`${FB}${PIXEL}`);
  });

  it("na prévia (código em espera): a verificação fica no <head> de verdade, uma vez só", () => {
    const html = "<!doctype html><html><head><title>Oferta</title></head><body><h1>Oi</h1></body></html>";
    const config = composeTrackingConfig(source({ mode: "preview" }));
    const out = renderPageHtml(html, {
      links: [],
      pageHref: () => "#",
      runtimeTag: "",
      customCode: { head: `${GOOGLE}<script>gtag()</script>`, category: "MARKETING" },
      tracking: { config, scriptTag: "<script data-os-tracking></script>", offerCode: { head: `${FB}${PIXEL}` } },
    });
    const head = out.slice(0, out.indexOf("</head>"));
    expect(head.split(FB)).toHaveLength(2);
    expect(head.split(GOOGLE)).toHaveLength(2);
    // Fora de qualquer bloco em espera (o JSON do bloco não tem "<meta").
    const blocks = [...head.matchAll(/<script type="application\/json" data-os-consent[\s\S]*?<\/script>/g)];
    expect(blocks.length).toBe(2);
    for (const b of blocks) expect(b[0]).not.toMatch(/verification/);
    // O ajudante do ZIP não tem o que acrescentar.
    expect(ensureHeadMetas(out, [FB, GOOGLE])).toBe(out);
  });
});

// ─── Textos ──────────────────────────────────────────────────────────────────

describe("textos do teste A/B", () => {
  it("política de privacidade cita os itens funcionais os_ab_… e os_consent (LGPD)", () => {
    expect(privacyHtml).toContain("<strong>os_ab_…</strong>");
    expect(privacyHtml).toContain("<strong>os_consent</strong>");
    expect(privacyHtml).toContain("teste A/B");
    expect(privacyHtml).toContain("até 30 dias");
    expect(privacyHtml).toContain("até 180 dias");
    expect(privacyHtml).toContain("não identificam você");
    expect(privacyHtml).toContain("qual versão da página você viu");
    // Marcadores da empresa continuam no mesmo formato.
    expect(privacyHtml).toContain('<span class="os-ph">{{EMPRESA}}</span>');
  });

  it("LEIA-ME: os_versao nos eventos, src × utm_content e por que nada é trocado", () => {
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
      serverEvents: ["Meta"],
      preserveJs: [],
      warnings: [],
    });
    const compare = text.slice(text.indexOf("COMO COMPARAR AS VERSÕES"));
    expect(compare).toContain("os_versao = A, B…, também pelo eventos.php");
    expect(compare).toContain("Hotmart, Kiwify e Eduzz: no parâmetro src");
    expect(compare).toContain("O sck e o xcod (UTMify) nunca são tocados");
    expect(compare).toContain("Outras plataformas: no utm_content, só quando o visitante chegou");
    expect(compare).toContain("nunca é trocado");
    expect(compare).toContain("Definições personalizadas");
    expect(compare).toContain("link de checkout diferente em cada versão");
    // Cabe no Bloco de Notas sem rolar para o lado.
    for (const line of compare.split("\r\n")) expect(line.length).toBeLessThanOrEqual(80);
  });

  it("aviso do “Teste A/B”: quem recebe src e quem recebe utm_content", () => {
    const html = renderToStaticMarkup(createElement(CompareVersionsHint));
    expect(html).toContain(COMPARE_HINT_TITLE);
    expect(html).toContain("os_versao");
    expect(html).toContain("Hotmart, Kiwify e Eduzz");
    expect(html).toContain("utm_content");
    expect(html).toContain("nunca é trocado");
    expect(html).toContain("link de checkout diferente em cada versão");
  });

  it("eventos.php manda os_versao em custom_data (Meta) e properties (TikTok), conferido", () => {
    const php = eventosPhp();
    expect(php).toContain("$input['os_versao']");
    expect(php).toContain("'/^[A-Za-z0-9_-]+$/'");
    expect(php).toContain("$event['custom_data'] = $custom;");
    expect(php).toContain("$event['properties'] = $custom;");
  });
});

// ─── Tela "Testar pixels" ────────────────────────────────────────────────────

function row(over: Partial<PixelTestEventRow>): PixelTestEventRow {
  return {
    id: 1,
    vendor: "RUNTIME",
    event: "START",
    status: "LOADED",
    detail: {},
    at: new Date().toISOString(),
    ...over,
  };
}

describe("Testar pixels: versão informada e opções velhas", () => {
  it("o passo de abertura mostra a versão e a pasta; cada evento mostra a versão que a plataforma recebeu", () => {
    expect(describeRow(row({ detail: { versao: "B", pasta: "oferta-b/", seq: 1 } })).subtitle).toBe(
      "Versão B · pasta oferta-b/",
    );
    expect(describeRow(row({ detail: { seq: 1 } })).subtitle).toBeNull();
    const ev = row({
      vendor: "META",
      event: "InitiateCheckout",
      status: "FIRED",
      detail: { event: "INITIATE_CHECKOUT", os_versao: "B" },
    });
    expect(describeRow(ev).subtitle).toMatch(/ · versão B$/);
    expect(
      describeRow(row({ vendor: "META", event: "PageView", status: "FIRED", detail: {} })).subtitle ?? "",
    ).not.toMatch(/versão/);
  });

  it("versão informada pela página: o último START", () => {
    expect(reportedVersion([])).toBeNull();
    expect(
      reportedVersion([
        row({ detail: { versao: "A" } }),
        row({ vendor: "META", event: "PageView", detail: {} }),
        row({ detail: { versao: "B" } }),
      ]),
    ).toBe("B");
    expect(reportedVersion([row({ detail: {} })])).toBeNull();
  });

  it("versão ou página excluída em outra aba: mensagem em português e a escolha volta para uma que existe", () => {
    expect(staleChoiceMessage("variantId")).toMatch(/^Essa versão não existe mais/);
    expect(staleChoiceMessage("variantId")).toContain("“Iniciar teste”");
    expect(staleChoiceMessage("pageId")).toMatch(/^Essa página não existe mais/);
    expect(staleChoiceMessage(undefined)).toBeNull();
    expect(staleChoiceMessage("offerId")).toBeNull();
    const pages: TestPage[] = [
      { id: "p1", name: "Início", isHome: false },
      { id: "p2", name: "Home", isHome: true },
    ];
    expect(validPageId(pages, "p1")).toBe("p1");
    expect(validPageId(pages, "sumiu")).toBe("p2");
    expect(validPageId(pages, null)).toBe("p2");
    expect(validPageId([], "x")).toBeNull();
  });
});
