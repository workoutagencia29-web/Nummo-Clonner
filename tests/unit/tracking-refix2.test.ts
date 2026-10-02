/**
 * Fase 4 — refix 2 da revisão (partes sem navegador):
 *
 * - injectPageCode acha head/body pelo parser (comentário condicional antigo
 *   com <body>, "</head>" e "</body>" dentro de comentários, CRLF e emoji);
 * - "Idioma das páginas" vazio (padrão) mantém o <html lang> da página;
 * - "SEO da página" mostra o título/descrição que a página já tem.
 */
import { type DefaultTreeAdapterMap, parse } from "parse5";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { parseOfferSettings } from "@/lib/offer-settings";
import { injectPageCode } from "@/lib/page-code";
import { renderPageHtml } from "@/lib/page-render";
import { applySeo, seoRenderFrom } from "@/lib/seo-render";
import { gateCode } from "@/lib/tracking/inject";
import type { TrackingRuntimeConfig } from "@/lib/tracking/runtime-config";
import { getOfferSettings, getPageSeo, saveOfferSettings } from "@/server/services/offer-settings";
import { createOffer } from "@/server/services/offers";
import { resetDatabase } from "../setup/per-file";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

/** Onde o navegador põe cada bloco em espera (data-os-consent): "head" ou "body" (some se virou comentário/texto). */
function templateParents(html: string): string[] {
  const out: string[] = [];
  const visit = (node: Node, parent: string) => {
    if ("tagName" in node) {
      const el = node as Element;
      if (el.attrs.some((a) => a.name === "data-os-consent")) out.push(parent);
      const next = el.tagName === "head" || el.tagName === "body" ? el.tagName : parent;
      for (const c of el.childNodes) visit(c, next);
      return;
    }
    if ("childNodes" in node) for (const c of (node as { childNodes: Node[] }).childNodes) visit(c, parent);
  };
  visit(parse(html), "");
  return out;
}

describe("injectPageCode: posições pelo parser", () => {
  const meta = `<!-- Meta Pixel Code --><script>fbq('init','1')</script><!-- End Meta Pixel Code -->`;
  const gated = gateCode(meta, "MARKETING");

  it("comentário condicional antigo com <body class> antes do <body> de verdade: o código vai para o body real", () => {
    const html = `<!DOCTYPE html><html><head><title>T</title></head><!--[if IE 8 ]><body class="ie8"><![endif]--><!--[if !IE]><!--><body class="real"><!--<![endif]--><h1>Oi</h1></body></html>`;
    const out = injectPageCode(html, { bodyStart: gated, bodyEnd: gated });
    expect(templateParents(out)).toEqual(["body", "body"]);
    expect(out).toContain(`<body class="real">\n${gated}`);
    expect(out).toContain(`<!--[if IE 8 ]><body class="ie8"><![endif]-->`);
  });

  it("'</head>' e '</body>' dentro de comentários não enganam", () => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><!-- modelo antigo: </head><body> --><title>T</title></head><body><p>x</p><!-- </body> --></body><!-- depois do </body> --></html>`;
    const out = injectPageCode(html, { head: gated, bodyStart: gated, bodyEnd: gated });
    expect(templateParents(out)).toEqual(["head", "body", "body"]);
    expect(out).toContain(`<title>T</title>${gated}\n</head>`);
    expect(out).toContain(`<!-- </body> -->${gated}\n</body>`);
    // Os comentários da página ficam como estavam.
    expect(out).toContain("<!-- modelo antigo: </head><body> -->");
  });

  it("CRLF, emoji e body vazio: posições certas e o início do body antes do fim", () => {
    const html = `<!DOCTYPE html>\r\n<html>\r\n<head>\r\n<title>😀 Oferta</title>\r\n</head>\r\n<body></body>\r\n</html>`;
    const out = injectPageCode(html, { head: "<meta name=h>", bodyStart: "<i>ini</i>", bodyEnd: "<i>fim</i>" });
    expect(out).toContain("<title>😀 Oferta</title>\r\n<meta name=h>\n</head>");
    expect(out).toContain("<body>\n<i>ini</i><i>fim</i>\n</body>");
  });

  it("head e body sem a tag de fechamento: fecham onde o navegador fecha", () => {
    const html = `<!DOCTYPE html><html><head><title>T</title><body><p>x</p>`;
    const out = injectPageCode(html, { head: gated, bodyStart: "<i>ini</i>", bodyEnd: "<i>fim</i>" });
    expect(templateParents(out)).toEqual(["head"]);
    expect(out).toBe(`<!DOCTYPE html><html><head><title>T</title>${gated}\n<body>\n<i>ini</i><p>x</p><i>fim</i>\n`);
  });

  it("renderPageHtml (prévia/ZIP) com o código da oferta em espera numa página com comentário condicional", () => {
    const html = `<!DOCTYPE html><html><head><title>T</title></head><!--[if IE 8 ]><body class="ie8"><![endif]--><body class="real"><h1>Oi</h1></body></html>`;
    const config = {
      v: 1,
      mode: "live",
      pixels: [],
      rules: [],
      names: {},
      value: { currency: "BRL", amount: null },
      checkoutLinkKeys: [],
      checkoutHosts: [],
      marketingCode: false,
      server: null,
      test: null,
      consent: { mode: "OPT_IN" },
      forwarding: { enabled: false, params: [], toCheckout: true, toInternalLinks: true, persistDays: 0 },
    } as unknown as TrackingRuntimeConfig;
    const out = renderPageHtml(html, {
      links: [],
      pageHref: (id) => `/p/${id}`,
      runtimeTag: "<script data-os-runtime></script>",
      tracking: {
        config,
        scriptTag: "<script data-os-tracking></script>",
        offerCode: { bodyStart: meta, category: "MARKETING" },
      },
    });
    expect(templateParents(out)).toEqual(["body"]);
    expect(out).toMatch(
      /<body class="real">\n<script type="application\/json" data-os-consent="marketing" data-os-block>/,
    );
  });
});

describe("idioma das páginas", () => {
  const page = `<!DOCTYPE html><html lang="en"><head><title>Offer</title></head><body></body></html>`;

  it("padrão: igual à página (o <html lang> não muda); escolhido: troca", () => {
    const settings = parseOfferSettings({});
    expect(settings.language).toBe("");
    const seo = { title: "", description: "", faviconKey: null, ogImageKey: null, noindex: false };
    expect(seoRenderFrom(seo, settings.language).lang).toBeNull();
    expect(applySeo(page, seoRenderFrom(seo, settings.language))).toBe(page);
    expect(applySeo(page, seoRenderFrom(seo, "pt-BR"))).toContain('<html lang="pt-BR">');
    // Ofertas salvas antes continuam com o idioma que tinham.
    expect(parseOfferSettings({ language: "es" }).language).toBe("es");
  });

  it("salvar: vazio (igual à página) é aceito; outro valor não", async () => {
    await resetDatabase();
    const offer = await createOffer({ name: "Idioma" });
    expect((await getOfferSettings(offer.id)).language).toBe("");
    expect((await saveOfferSettings(offer.id, { language: "en" })).language).toBe("en");
    expect((await saveOfferSettings(offer.id, { language: "" })).language).toBe("");
    expect((await saveOfferSettings(offer.id, { company: { name: "ACME" } })).language).toBe("");
  });
});

describe("SEO da página: o que a página já tem", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("título e descrição do HTML (versão de controle, computador), com os dados da empresa trocados", async () => {
    const offer = await createOffer({ name: "Oferta" });
    const page = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id } });
    await prisma.page.update({ where: { id: page.id }, data: { name: "Página clonada (sem rodapé)" } });
    const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId: page.id } } });
    await prisma.pageDocument.update({
      where: { id: doc.id },
      data: {
        html: `<!DOCTYPE html><html><head><title>\n  Método X — {{EMPRESA}}\n</title><meta name="Description" content="Aprenda &amp; lucre"></head><body><h1>Oi</h1></body></html>`,
      },
    });
    await saveOfferSettings(offer.id, { company: { name: "ACME" } });
    const data = await getPageSeo(page.id);
    expect(data.own).toEqual({ title: "Método X — ACME", description: "Aprenda & lucre" });
    expect(data.liveUrl).toBeNull();

    // Sem título no HTML: vazio (nunca o nome interno da página).
    await prisma.pageDocument.update({ where: { id: doc.id }, data: { html: "<p>sem head</p>" } });
    expect((await getPageSeo(page.id)).own).toEqual({ title: "", description: "" });
  });
});
