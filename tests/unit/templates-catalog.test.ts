/**
 * Modelos de página inteira: catálogo, HTML válido e offline, ganchos do Offer
 * Studio (links da oferta, widgets, textos legais), ida e volta pelo editor e
 * serviço usado na criação de páginas.
 */
import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { parse } from "parse5";
import { describe, expect, it } from "vitest";
import {
  LEGAL_NOTICE,
  PAGE_TEMPLATES,
  type PageTemplate,
  TEMPLATE_IDS,
  TEMPLATE_SUMMARIES,
  thumbnailUrl,
} from "@/editor/templates";
import { BASE_CSS_ATTR, finalizeFromEditor, prepareForEditor } from "@/lib/editor-html";
import { UserError } from "@/lib/errors";
import { renderPageHtml } from "@/lib/page-render";
import { getObject } from "@/lib/storage";
import { htmlForEditor } from "@/server/services/documents";
import {
  getTemplate,
  listTemplates,
  PAGE_TEMPLATE_IDS,
  pageStart,
  templateHtml,
} from "@/server/services/page-templates";
import { PAGE_TYPE_VALUES } from "@/server/services/pages";

const NOW = new Date("2026-09-29T15:00:00Z");
const rendered = PAGE_TEMPLATES.map((t) => ({ t, html: templateHtml(t.id, t.pageName, NOW) }));

/** Texto visível do <body>, com espaços normalizados. */
function bodyText(html: string) {
  const $ = cheerio.load(html);
  return $("body").text().replace(/\s+/g, " ").trim();
}

/** Todos os atributos data-os-* do <body> (tag + atributo + valor), ordenados. */
function hooks(html: string) {
  const $ = cheerio.load(html);
  const out: string[] = [];
  $("body *").each((_, el) => {
    for (const [name, value] of Object.entries((el as Element).attribs ?? {})) {
      if (name.startsWith("data-os-")) out.push(`${(el as Element).tagName}[${name}=${value}]`);
    }
  });
  return out.sort();
}

function cssOf(html: string) {
  return cheerio.load(html)("head style").text();
}

describe("catálogo de modelos", () => {
  it("tem os 11 modelos pedidos, com tipo de página válido, nome e descrição", () => {
    expect(PAGE_TEMPLATES.map((t) => t.id)).toEqual([...TEMPLATE_IDS]);
    expect(new Set(TEMPLATE_IDS).size).toBe(11);
    expect(PAGE_TEMPLATE_IDS).toBe(TEMPLATE_IDS);
    for (const t of PAGE_TEMPLATES) {
      expect(PAGE_TYPE_VALUES).toContain(t.pageType);
      expect(t.name.length).toBeGreaterThan(2);
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.pageName.length).toBeGreaterThan(2);
    }
    const types = Object.fromEntries(PAGE_TEMPLATES.map((t) => [t.id, t.pageType]));
    expect(types).toEqual({
      "vendas-longa": "SALES",
      vsl: "VSL",
      advertorial: "ADVERTORIAL",
      quiz: "QUIZ",
      roleta: "OTHER",
      captura: "CAPTURE",
      upsell: "UPSELL",
      downsell: "DOWNSELL",
      obrigado: "THANK_YOU",
      "politica-privacidade": "LEGAL",
      "termos-de-uso": "LEGAL",
    });
  });

  it("listTemplates devolve só o resumo (sem o HTML pesado), na ordem da galeria", () => {
    const list = listTemplates();
    expect(list.map((t) => t.id)).toEqual([...TEMPLATE_IDS]);
    for (const t of list) expect(t).not.toHaveProperty("html");
    expect(TEMPLATE_SUMMARIES.every((t) => !("html" in t))).toBe(true);
  });

  it("modelos legais trazem o aviso de que não são aconselhamento jurídico (para o painel)", () => {
    const legal = PAGE_TEMPLATES.filter((t) => t.pageType === "LEGAL");
    expect(legal).toHaveLength(2);
    for (const t of legal) expect(t.notice).toBe(LEGAL_NOTICE);
    expect(LEGAL_NOTICE).toMatch(/não é aconselhamento jurídico/);
    expect(PAGE_TEMPLATES.filter((t) => t.notice)).toHaveLength(2);
  });

  it.each(
    PAGE_TEMPLATES.map((t) => [t.id, t] as const),
  )("miniatura de %s é um SVG leve e sem endereços externos", (_, t) => {
    const $ = cheerio.load(t.thumbnail, { xml: true });
    const svg = $("svg");
    expect(svg).toHaveLength(1);
    expect(svg.attr("viewBox")).toBe("0 0 320 240");
    expect(t.thumbnail.length).toBeLessThan(8000);
    expect(t.thumbnail).not.toMatch(/href=|<image|@import|https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
    expect(thumbnailUrl(t)).toMatch(/^data:image\/svg\+xml,%3Csvg/);
  });
});

describe("templateHtml e pageStart (criação de página)", () => {
  it("usa o nome da página no <title>, escapando HTML", () => {
    const html = templateHtml("upsell", 'Upsell <b>"Turbo"</b> & cia', NOW);
    const $ = cheerio.load(html);
    expect($("title").text()).toBe('Upsell <b>"Turbo"</b> & cia');
    expect(html).not.toContain("<b>");
    expect($("title")).toHaveLength(1);
  });

  it("título vazio usa o nome sugerido do modelo", () => {
    expect(
      cheerio
        .load(templateHtml("obrigado", "   ", NOW))("title")
        .text(),
    ).toBe("Obrigado");
  });

  it("troca os marcadores de data (atualização das páginas legais e ano do rodapé)", () => {
    for (const { t, html } of rendered) {
      expect(html, t.id).not.toMatch(/__OS_[A-Z]+__/);
      expect(html, t.id).toContain("© 2026");
    }
    expect(templateHtml("politica-privacidade", "Privacidade", NOW)).toContain(
      "Última atualização: 29 de setembro de 2026",
    );
    expect(templateHtml("advertorial", "Matéria", NOW)).toContain("Atualizado em 29 de setembro de 2026");
  });

  it("modelo inexistente vira erro em português", () => {
    expect(() => templateHtml("nao-existe", "X")).toThrow(UserError);
    expect(() => pageStart("nao-existe", "X")).toThrow(/Modelo de página não encontrado/);
    expect(getTemplate("nao-existe")).toBeNull();
  });

  it("sem modelo: página em branco do tipo vendas; com modelo: HTML e tipo do modelo", () => {
    const blank = pageStart(undefined, "Minha página");
    expect(blank.type).toBe("SALES");
    expect(cheerio.load(blank.html)("body").children()).toHaveLength(0);
    expect(pageStart(null, "X").type).toBe("SALES");

    const upsell = pageStart("upsell", "Upsell 1");
    expect(upsell.type).toBe("UPSELL");
    expect(cheerio.load(upsell.html)("title").text()).toBe("Upsell 1");
    expect(upsell.html).toContain('data-os-widget="countdown"');
    expect(pageStart("termos-de-uso", "Termos").type).toBe("LEGAL");
  });
});

describe.each(
  rendered.map(({ t, html }) => [t.id, t, html] as [string, PageTemplate, string]),
)("modelo %s", (_, t, html) => {
  const $ = cheerio.load(html);

  it("é HTML válido (sem erros do analisador HTML5), com doctype, pt-BR, charset, viewport e título", () => {
    const errors: string[] = [];
    parse(html, { onParseError: (e) => errors.push(`${e.code} @${e.startLine}:${e.startCol}`) });
    expect(errors).toEqual([]);
    expect(html).toMatch(/^<!doctype html>/i);
    expect($("html").attr("lang")).toBe("pt-BR");
    expect($('head meta[charset="utf-8"]')).toHaveLength(1);
    expect($('head meta[name="viewport"]').attr("content")).toBe("width=device-width, initial-scale=1");
    expect($("head title").text()).toBe(t.pageName);
    expect($("head style")).toHaveLength(1);
    expect($("style")).toHaveLength(1);
    expect($("body").children().length).toBeGreaterThan(1);
  });

  it("não tem script, estilo inline, on* nem ids repetidos", () => {
    expect($("script")).toHaveLength(0);
    expect($("[style]")).toHaveLength(0);
    const ids: string[] = [];
    $("*").each((_, el) => {
      const attribs = (el as Element).attribs ?? {};
      for (const name of Object.keys(attribs)) expect(name, `${t.id}: ${name}`).not.toMatch(/^on/i);
      if (attribs.id) ids.push(attribs.id);
    });
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("funciona offline: nenhum endereço externo em atributos ou no CSS", () => {
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/@import|@font-face/i);
    $("[src], [href], [action], [poster], [srcset]").each((_, el) => {
      const a = (el as Element).attribs;
      for (const name of ["src", "href", "action", "poster", "srcset"]) {
        const v = a[name];
        if (v === undefined) continue;
        expect(
          v === "#" || /^#[a-z][\w-]*$/.test(v) || v.startsWith("data:image/svg+xml,"),
          `${t.id} ${name}=${v.slice(0, 60)}`,
        ).toBe(true);
      }
    });
    for (const m of cssOf(html).matchAll(/url\(\s*(["']?)([^"')]*)/g)) {
      expect(m[2], t.id).toMatch(/^data:image\/svg\+xml,/);
    }
    // Âncoras internas apontam para um id que existe.
    $('a[href^="#"]').each((_, el) => {
      const href = $(el).attr("href") ?? "";
      if (href.length > 1) expect($(href), `${t.id} ${href}`).toHaveLength(1);
    });
  });

  it('classes com prefixo "os-" (no HTML e no CSS) para não colidir com blocos e clones', () => {
    $("[class]").each((_, el) => {
      for (const c of ($(el).attr("class") ?? "").split(/\s+/).filter(Boolean)) expect(c, t.id).toMatch(/^os-/);
    });
    const css = cssOf(html).replace(/url\("[^"]*"\)/g, "");
    const classes = [...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
    expect(classes.length).toBeGreaterThan(10);
    for (const c of classes) expect(c, t.id).toMatch(/^os-/);
    // Variáveis e animações também prefixadas.
    for (const m of css.matchAll(/--([\w-]+)\s*:/g)) expect(m[1]).toMatch(/^os-/);
    for (const m of css.matchAll(/@keyframes\s+([\w-]+)/g)) expect(m[1]).toMatch(/^os-/);
    // !important em camada inverteria a prioridade das edições: só no "reduzir movimento".
    expect(css.replace(/@media \(prefers-reduced-motion:reduce\)\{[^}]*\}\}/, "")).not.toContain("!important");
  });

  it("sobrevive à conversão para o editor e de volta sem perder conteúdo nem ganchos", () => {
    const prepared = prepareForEditor(html);
    expect(prepared.styles).toHaveLength(1);
    expect(prepared.styles[0]).toMatchObject({ kind: "inline" });
    expect(prepared.styles[0].text).toContain("--os-primary");
    expect(prepared.html).not.toContain("<style");
    const back = finalizeFromEditor(prepared.html, "#x{color:red}");
    expect(bodyText(back)).toBe(bodyText(html));
    expect(hooks(back)).toEqual(hooks(html));
    expect(cheerio.load(back)("a").length).toBe($("a").length);
  });

  it("tem os ganchos esperados para o tipo de página", () => {
    const buy = $("a.os-btn[data-os-link]");
    const funnel = $("a[href='#']:not([data-os-link])");
    expect(
      $("[data-os-link]")
        .toArray()
        .every((el) => $(el).attr("data-os-link") === ""),
    ).toBe(true);
    expect($("h1")).toHaveLength(1);

    switch (t.pageType) {
      case "SALES":
        expect(buy.length).toBeGreaterThanOrEqual(3);
        expect($('[data-os-widget="countdown"] [data-os-cd="m"]')).toHaveLength(1);
        expect($('[data-os-widget="exit-popup"][hidden] [data-os-close]').length).toBeGreaterThanOrEqual(1);
        expect($('[data-os-widget="exit-popup"] a[data-os-link]')).toHaveLength(1);
        expect($(".os-faq details > summary").length).toBeGreaterThanOrEqual(5);
        expect($(".os-seal").text()).toContain("7");
        expect($(".os-price").text()).toMatch(/R\$/);
        expect(
          $(".os-footer a")
            .map((_, a) => $(a).text())
            .get(),
        ).toEqual(expect.arrayContaining(["Política de privacidade", "Termos de uso"]));
        break;
      case "VSL": {
        expect($(".os-video iframe")).toHaveLength(1);
        const delayed = $('[data-os-delay="0"]');
        expect(delayed).toHaveLength(1);
        expect(delayed.find("a[data-os-link]")).toHaveLength(1);
        expect($(".os-quote").length).toBeGreaterThanOrEqual(3);
        expect($(".os-guarantee")).toHaveLength(1);
        break;
      }
      case "CAPTURE": {
        const form = $('form[data-os-widget="lead-form"]');
        expect(form).toHaveLength(1);
        expect(form.attr("data-os-webhook")).toBe("");
        expect(form.find('input[type="email"][name="email"][required]')).toHaveLength(1);
        expect(form.find('input[name="name"][required]')).toHaveLength(1);
        expect(form.find('input[type="tel"][name="phone"]')).toHaveLength(1);
        expect(form.find('button[type="submit"]')).toHaveLength(1);
        expect(form.find("label input")).toHaveLength(3);
        expect($('[data-os-widget="sales-notification"][hidden] [data-os-sn="title"]')).toHaveLength(1);
        expect($(`a[href="#${form.attr("id")}"]`)).toHaveLength(1);
        break;
      }
      case "UPSELL":
      case "DOWNSELL": {
        const yes = buy.filter((_, a) => /^SIM, QUERO/.test($(a).text()));
        expect(yes).toHaveLength(1);
        const no = $("a.os-decline");
        expect(no).toHaveLength(1);
        expect(no.attr("href")).toBe("#");
        expect(no.attr("data-os-link")).toBeUndefined();
        expect(no.text()).toMatch(/^Não, obrigado/);
        expect($('[data-os-widget="countdown"]')).toHaveLength(t.pageType === "UPSELL" ? 1 : 0);
        break;
      }
      case "THANK_YOU":
        expect(buy.filter((_, a) => /WHATSAPP/.test($(a).text()))).toHaveLength(1);
        expect($(".os-step")).toHaveLength(3);
        expect(html).toContain("{{EMAIL}}");
        break;
      case "QUIZ": {
        // Quiz: perguntas (escolha única e múltipla), informação, "Analisando" e final.
        const quiz = $('[data-os-widget="quiz"]');
        expect(quiz).toHaveLength(1);
        expect(quiz.attr("data-os-track")).toBe("1");
        const kinds = quiz
          .find("[data-os-qz-step]")
          .map((_, el) => $(el).attr("data-os-qz-step"))
          .get();
        expect(kinds).toEqual(["question", "question", "info", "question", "question", "loading", "final"]);
        expect(quiz.find('[data-os-qz-step="question"][data-os-multi="1"]')).toHaveLength(1);
        expect(quiz.find("button[data-os-qz-option]").length).toBeGreaterThanOrEqual(12);
        expect(quiz.find('[data-os-qz-step="loading"]').attr("data-os-messages")?.split("\n")).toHaveLength(3);
        // Sem captura de contato; o botão final pede o destino (aviso do canvas e do ZIP).
        expect($("form, input")).toHaveLength(0);
        expect(buy).toHaveLength(1);
        expect(buy.attr("data-os-qz-go")).toBe("");
        expect(cssOf(html)).toContain(
          ".os-quiz:not(.os-qz-on):not([data-gjs-type]) .os-qz-step~.os-qz-step{display:none}",
        );
        break;
      }
      case "OTHER": {
        // Roleta: 4 fatias de exemplo sem link (avisos do canvas e do ZIP) e o "Resgatar" sem destino.
        const wheel = $('[data-os-widget="wheel"]');
        expect(wheel).toHaveLength(1);
        const slices = JSON.parse(wheel.attr("data-os-slices") ?? "[]") as {
          text: string;
          chance: number;
          link: string;
        }[];
        expect(slices.map((s) => [s.text, s.chance, s.link])).toEqual([
          ["10% OFF", 40, ""],
          ["20% OFF", 30, ""],
          ["30% OFF", 20, ""],
          ["50% OFF", 10, ""],
        ]);
        expect(wheel.find("[data-os-wh-disc] svg path[fill]")).toHaveLength(4);
        expect(wheel.find("[data-os-wh-result][hidden]")).toHaveLength(1);
        expect(buy).toHaveLength(1);
        expect(buy.attr("data-os-wh-go")).toBe("");
        expect(cssOf(html)).toContain(".os-wheel:not(.os-wh-on):not([data-gjs-type]) .os-wh-nojs{display:block}");
        break;
      }
      case "ADVERTORIAL":
        expect($(".os-adbar").text()).toBe("Publicidade");
        expect(buy.length).toBeGreaterThanOrEqual(2);
        expect($(".os-disclaimer").text()).toMatch(/publicitário/);
        break;
      case "LEGAL":
        for (const ph of ["{{EMPRESA}}", "{{CNPJ}}", "{{EMAIL}}"]) {
          expect($(`.os-legal .os-ph:contains("${ph}")`).length, ph).toBeGreaterThanOrEqual(2);
        }
        expect($(".os-legal h2").length).toBeGreaterThanOrEqual(10);
        expect(buy).toHaveLength(0);
        break;
      default:
        throw new Error(`tipo sem verificação: ${t.pageType}`);
    }
    // Links do funil (rodapé, "não, obrigado"…) ficam para o usuário escolher no editor.
    expect(funnel.length).toBeGreaterThanOrEqual(1);
  });

  it("os botões de compra recebem o link da oferta escolhido (prévia/ZIP)", () => {
    if (!$("a[data-os-link]").length) return;
    const chosen = html.replaceAll('data-os-link=""', 'data-os-link="checkout"');
    const out = renderPageHtml(chosen, {
      links: [{ key: "checkout", url: "https://pay.exemplo.com/abc" }],
      pageHref: (id) => `/p/${id}`,
      runtimeTag: "<script data-os-runtime></script>",
    });
    const $out = cheerio.load(out);
    expect($out('a[data-os-link="checkout"]').length).toBeGreaterThan(0);
    $out('a[data-os-link="checkout"]').each((_, a) => {
      expect($out(a).attr("href")).toBe("https://pay.exemplo.com/abc");
    });
  });
});

describe("abrir um modelo no editor (htmlForEditor)", () => {
  it("move o CSS do modelo para a folha base em camada e deixa o HTML sem <style>", async () => {
    const html = templateHtml("vendas-longa", "Vendas", NOW);
    const forEditor = await htmlForEditor(html);
    const $ = cheerio.load(forEditor);
    expect($("style")).toHaveLength(0);
    const href = $(`link[${BASE_CSS_ATTR}]`).attr("href") ?? "";
    expect(href).toMatch(/^\/os-assets\/[a-f0-9]{64}\.css$/);
    const file = href.slice("/os-assets/".length);
    const base = (await getObject(`a/${file.slice(0, 2)}/${file}`)).toString("utf8");
    // Ordem das camadas declarada no início (a revisão da Fase 3 pôs os-fix antes de os-original).
    expect(base).toMatch(/^@layer (?:[\w-]+, )*os-original;/);
    const imported = /@import url\("\/os-assets\/([a-f0-9]{64}\.css)"\) layer\(os-original\)/.exec(base)?.[1] ?? "";
    expect(imported).not.toBe("");
    const css = (await getObject(`a/${imported.slice(0, 2)}/${imported}`)).toString("utf8");
    expect(css).toBe(cssOf(html));
  });
});
