/**
 * Avisos do ZIP e passos do "Próximos passos" sem banco:
 * - checkout da página clonada (clonedCheckoutLinks, aviso e conserto, alvo { link });
 * - links de Política, Termos e Contato sem destino (deadLegalLinks, aviso,
 *   conserto e passo opcional);
 * - oferta em peso/dólar/euro com as páginas marcadas como português (passo
 *   opcional "Conferir o idioma das páginas").
 */
import { describe, expect, it } from "vitest";
import { footer, leadForm } from "@/editor/templates/widgets";
import { deadLegalLinks } from "@/lib/export/legal-links";
import { clonedCheckoutWarning, deadLegalLinksWarning, exportWarningFix } from "@/lib/export/warnings";
import { clonedCheckoutLinks, computeReadiness, declaredLang, type ReadinessInput } from "@/lib/readiness";

const company = { name: "", document: "", email: "", phone: "", address: "" };
const base: ReadinessInput = {
  htmls: [],
  links: [],
  clonedCheckoutUrls: [],
  pixelCount: 0,
  company,
  liveUrl: null,
  lastZipAt: null,
};
const label = () => "01/10/2026 às 10:00";
const item = (input: Partial<ReadinessInput>, id: string) =>
  computeReadiness({ ...base, ...input }, label).items.find((i) => i.id === id);

describe("checkout da página clonada", () => {
  const cloned = ["https://pay.hotmart.com/ABC123?off=x1"];

  it("clonedCheckoutLinks: mesmo endereço sem diferenciar maiúsculas nem a barra no fim", () => {
    const links = [
      { id: "1", url: "https://pay.hotmart.com/ABC123?off=x1" },
      { id: "2", url: "  HTTPS://PAY.HOTMART.COM/abc123?OFF=X1/ " },
      { id: "3", url: "https://pay.hotmart.com/MEU999" },
      { id: "4", url: "" },
    ];
    expect(clonedCheckoutLinks(links, cloned).map((l) => l.id)).toEqual(["1", "2"]);
    expect(clonedCheckoutLinks(links, [])).toEqual([]);
    expect(clonedCheckoutLinks(links, ["", "  "])).toEqual([]);
  });

  it("pagamento na página nunca conta (nem o endereço guardado de um link de pagamento sem produto)", () => {
    const url = cloned[0];
    expect(clonedCheckoutLinks([{ url, pay: true }], cloned)).toEqual([]);
    expect(clonedCheckoutLinks([{ url, target: "PAYMENT" }], cloned)).toEqual([]);
    expect(clonedCheckoutLinks([{ url, target: "URL" }], cloned)).toHaveLength(1);
  });

  it("aviso do ZIP: um link, vários links e o conserto pelo texto", () => {
    expect(clonedCheckoutWarning([])).toBeNull();
    const one = clonedCheckoutWarning(["Checkout Hotmart"]) as string;
    expect(one).toBe(
      "O link “Checkout Hotmart” ainda leva ao checkout da página que você clonou: quem clicar compra do dono da página original. Troque pelo endereço do seu checkout em “Links e checkouts” e gere o ZIP de novo.",
    );
    const many = clonedCheckoutWarning(["A", "B", "C", "D", "E"]) as string;
    expect(many).toContain("5 links ainda levam ao checkout da página que você clonou (“A”, “B”, “C” e mais 2)");
    expect(exportWarningFix(one)).toEqual({ kind: "clonedCheckout" });
    expect(exportWarningFix(many)).toEqual({ kind: "clonedCheckout" });
  });

  it("Próximos passos: o passo abre o (primeiro) link em vez da aba", () => {
    const step = item(
      {
        htmls: [`<a data-os-link="hotmart">Comprar</a><a data-os-link="hotmart-2">Comprar</a>`],
        links: [
          { id: "link-1", key: "hotmart", url: "https://pay.hotmart.com/ABC123?off=x1/" },
          { id: "link-2", key: "hotmart-2", url: "https://PAY.hotmart.com/ABC123?off=x1" },
        ],
        clonedCheckoutUrls: cloned,
      },
      "checkout",
    );
    expect(step).toMatchObject({
      done: false,
      title: "Trocar o checkout da página original",
      cta: "Abrir o link",
      target: { link: "link-1" },
    });
    expect(step?.detail).toContain("2 links ainda levam ao checkout da página que você clonou");
    // Sem o id do link (chamadas antigas): continua levando à aba.
    const noId = item(
      {
        htmls: [`<a data-os-link="hotmart">Comprar</a>`],
        links: [{ key: "hotmart", url: cloned[0] }],
        clonedCheckoutUrls: cloned,
      },
      "checkout",
    );
    expect(noId).toMatchObject({ cta: "Abrir links", target: { tab: "links" } });
    // Endereço trocado pelo do usuário: pronto.
    expect(
      item(
        {
          htmls: [`<a data-os-link="hotmart">Comprar</a>`],
          links: [{ id: "link-1", key: "hotmart", url: "https://pay.kiwify.com.br/meu" }],
          clonedCheckoutUrls: cloned,
        },
        "checkout",
      ),
    ).toMatchObject({ done: true });
  });
});

describe("links de Política, Termos e Contato sem destino", () => {
  it("rodapé e aviso do formulário dos modelos: os três links (e não o “Preferências de cookies”)", () => {
    expect(deadLegalLinks(footer())).toEqual(["Política de privacidade", "Termos de uso", "Contato"]);
    expect(deadLegalLinks(leadForm({ button: "Quero" }))).toEqual(["Política de privacidade"]);
    expect(deadLegalLinks(footer({ links: false }))).toEqual([]);
  });

  it("com os links ligados (página do funil, endereço) não conta", () => {
    const linked = footer()
      .replace(
        '<a href="#">Política de privacidade</a>',
        '<a href="os-page:clx0000000000000000000001">Política de privacidade</a>',
      )
      .replace('<a href="#">Termos de uso</a>', '<a href="../termos/">Termos de uso</a>')
      .replace('<a href="#">Contato</a>', '<a href="mailto:oi@loja.com">Contato</a>');
    expect(deadLegalLinks(linked)).toEqual([]);
  });

  it("âncoras que não são de páginas legais, links ligados a um link da oferta e código no clique não contam", () => {
    const html = [
      `<a href="#">Ver mais</a>`,
      `<a href="#">Quero comprar</a>`,
      `<a href="#" data-os-link="">Política de privacidade</a>`,
      `<a href="#" onclick="abrir()">Termos de uso</a>`,
      `<a href="#" data-os-href="https://loja.com/termos">Termos</a>`,
      `<a href="#contato">Contato</a>`,
      `<a>Contato</a>`,
      `<script>document.write('<a href="#">Contato</a>')</script>`,
      `<!-- <a href="#">Política</a> -->`,
      `<template><a href="#">Termos</a></template>`,
      `<abbr title="x">Política</abbr>`,
    ].join("\n");
    expect(deadLegalLinks(html)).toEqual([]);
  });

  it("href vazio, javascript:, texto com tags e outros idiomas contam (sem repetir)", () => {
    const html = [
      `<A HREF="">Aviso <b>legal</b></A>`,
      `<a href="javascript:void(0)" class="x">Política de Privacidad</a>`,
      `<a href='#'>Terms &amp; Conditions</a>`,
      `<a href="#">Contacto</a>`,
      `<a href="#">Contacto</a>`,
      `<a title=it's href="#">Términos y condiciones</a>`,
    ].join("");
    expect(deadLegalLinks(html)).toEqual([
      "Aviso legal",
      "Política de Privacidad",
      "Terms & Conditions",
      "Contacto",
      "Términos y condiciones",
    ]);
  });

  it("aviso do ZIP e o conserto pelo texto", () => {
    expect(deadLegalLinksWarning([{ name: "Vendas", links: [] }])).toBeNull();
    const one = deadLegalLinksWarning([{ name: "Vendas", links: ["Política de privacidade"] }]) as string;
    expect(one).toMatch(/^O link “Política de privacidade” da página “Vendas” não leva a lugar nenhum: abra a página/);
    const many = deadLegalLinksWarning([
      { name: "Vendas", links: ["Política de privacidade", "Termos de uso", "Contato"] },
      { name: "Obrigado", links: ["Política de privacidade"] },
    ]) as string;
    expect(many).toContain(
      "4 links de páginas legais e de contato nas páginas “Vendas” e “Obrigado” não levam a lugar nenhum (“Política de privacidade”, “Termos de uso” e “Contato”)",
    );
    expect(exportWarningFix(one)).toEqual({ kind: "legalLinks" });
    expect(exportWarningFix(many)).toEqual({ kind: "legalLinks" });
  });

  it("Próximos passos: passo opcional que abre a primeira página com o link no editor", () => {
    const step = item(
      {
        pageDocs: [
          { id: "doc-captura", pageId: "p1", pageName: "Captura", html: "<p>sem rodapé</p>" },
          { id: "doc-vendas", pageId: "p2", pageName: "Vendas", html: footer() },
          { id: "doc-vendas-b", pageId: "p2", pageName: "Vendas", html: footer() },
          { id: "doc-obrigado", pageId: "p3", pageName: "Obrigado", html: leadForm({ button: "Ok" }) },
        ],
      },
      "links-legais",
    );
    expect(step).toMatchObject({
      done: false,
      optional: true,
      cta: "Abrir no editor",
      target: { editor: "doc-vendas" },
    });
    expect(step?.detail).toContain(
      "Os links “Política de privacidade”, “Termos de uso” e “Contato” das páginas “Vendas” e “Obrigado” ainda não levam a lugar nenhum",
    );
    // Opcional: não entra na conta dos passos obrigatórios.
    const r = computeReadiness({ ...base, pageDocs: [{ id: "d", pageId: "p", pageName: "V", html: footer() }] }, label);
    expect(r.total).toBe(computeReadiness(base, label).total);
    // Links ligados ou sem documentos: sem o passo.
    expect(
      item({ pageDocs: [{ id: "d", pageId: "p", pageName: "V", html: "<a href='/x'>Termos</a>" }] }, "links-legais"),
    ).toBeUndefined();
    expect(item({ htmls: [footer()] }, "links-legais")).toBeUndefined();
  });
});

describe("idioma das páginas × moeda da oferta", () => {
  const pt = `<!doctype html><html lang="pt-BR"><head></head><body></body></html>`;
  const es = `<!doctype html><html lang="es"><head></head><body></body></html>`;

  it("declaredLang lê o <html lang>", () => {
    expect(declaredLang(pt)).toBe("pt-BR");
    expect(declaredLang(`<HTML class='x' LANG='pt'>`)).toBe("pt");
    expect(declaredLang("<html><body lang='en'>")).toBe("");
    expect(declaredLang("<p>sem html</p>")).toBe("");
  });

  it("peso mexicano + página em português + idioma vazio → passo opcional que leva ao campo", () => {
    const step = item({ htmls: [pt], currency: "MXN", language: "" }, "idioma");
    expect(step).toMatchObject({
      title: "Conferir o idioma das páginas",
      done: false,
      optional: true,
      cta: "Escolher o idioma",
      target: { setting: "idioma" },
    });
    expect(step?.detail).toContain(
      "Suas páginas estão marcadas como português, mas a oferta roda em peso mexicano. Se elas já estão em espanhol, escolha Espanhol em “Idioma das páginas”",
    );
    expect(item({ htmls: [pt], currency: "USD" }, "idioma")?.detail).toContain("roda em dólar");
    expect(item({ htmls: [pt], currency: "EUR" }, "idioma")?.detail).toContain("roda em euro");
  });

  it("sem o passo: real, idioma escolhido, páginas em outro idioma ou sem a moeda", () => {
    expect(item({ htmls: [pt], currency: "BRL" }, "idioma")).toBeUndefined();
    expect(item({ htmls: [pt], currency: "MXN", language: "es" }, "idioma")).toBeUndefined();
    expect(item({ htmls: [pt], currency: "MXN", language: "pt-BR" }, "idioma")).toBeUndefined();
    expect(item({ htmls: [es], currency: "MXN" }, "idioma")).toBeUndefined();
    expect(item({ htmls: [pt] }, "idioma")).toBeUndefined();
  });
});
