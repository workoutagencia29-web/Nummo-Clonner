/**
 * A roleta é REDESENHADA na hora de renderizar (prévia e ZIP), a partir do
 * data-os-slices — a mesma fonte que o giro na página lê. Assim, melhorias no
 * desenho (posição dos números, etc.) valem sem reabrir e salvar cada página:
 * o render sempre usa a versão mais nova de `wheelSvg`. Ver redrawWheels em
 * src/lib/page-render.ts.
 */
import { describe, expect, it } from "vitest";
import { defToHtml } from "@/editor/widgets/quiz-content";
import { DEFAULT_WHEEL, wheelDef } from "@/editor/widgets/wheel-content";
import { type RenderOptions, renderPageHtml } from "@/lib/page-render";
import { cleanSlice, serializeSlices, wheelSvg } from "@/lib/wheel";

const OPTS: RenderOptions = {
  links: [],
  pageHref: (id) => `/p/${id}`,
  runtimeTag: "",
  seo: null,
  tracking: null,
  payments: null,
  company: null,
  wheel: null,
  routes: null,
  currency: null,
  customCode: null,
  productScriptTag: null,
};

/** Escapa um valor para dentro de um atributo HTML (como o editor salva). */
function attrEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function wheelPage(discInner: string, slicesAttr: string): string {
  return (
    "<!doctype html><html><head></head><body>" +
    `<div class="os-wheel" data-os-widget="wheel" data-os-slices="${slicesAttr}" data-os-days="0" data-os-minutes="10">` +
    '<div class="os-wh-stage" data-os-wh-stage=""><div class="os-wh-ptr"></div>' +
    `<div class="os-wh-disc" data-os-wh-disc="">${discInner}</div>` +
    '<button class="os-wh-hub">GIRE</button></div></div></body></html>'
  );
}

describe("roleta redesenhada no render", () => {
  const slices = [
    { text: "95% OFF", color: "#e4572e" },
    { text: "Tente novamente", color: "#111318", lose: true },
    { text: "50% OFF", color: "#2fa565" },
    { text: "25% OFF", color: "#7b3ff2" },
  ].map((r, i) => cleanSlice(r, i));
  const slicesAttr = attrEscape(serializeSlices(slices));

  it("troca um SVG antigo pelo desenho atual a partir do data-os-slices", () => {
    // SVG "antigo" com dominant-baseline (o jeito que o Safari renderizava torto).
    const old = '<svg viewBox="-117 -117 234 234"><text dominant-baseline="central"><tspan>95%</tspan></text></svg>';
    const out = renderPageHtml(wheelPage(old, slicesAttr), OPTS);
    // O desenho atual não usa mais dominant-baseline...
    expect(out).not.toContain("dominant-baseline");
    // ...e é EXATAMENTE o wheelSvg atual para essas fatias.
    expect(out).toContain(wheelSvg(slices));
    // A estrutura (giro, cores, fatias) continua intacta.
    expect(out).toContain('data-os-widget="wheel"');
    expect(out).toContain('data-os-wh-disc=""');
    expect(out).toContain(">GIRE<");
  });

  it("duas roletas na mesma página são redesenhadas", () => {
    const old = "<svg><text>antigo</text></svg>";
    const one = wheelPage(old, slicesAttr).replace(/<\/body>.*/, "");
    const two = `${one}${one.slice(one.indexOf('<div class="os-wheel"'))}</body></html>`;
    const out = renderPageHtml(two, OPTS);
    expect(out).not.toContain("antigo");
    expect(
      out.match(
        new RegExp(
          wheelSvg(slices)
            .slice(0, 40)
            .replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "g",
        ),
      )?.length,
    ).toBe(2);
  });

  it("página sem roleta não é tocada", () => {
    const html = "<!doctype html><html><head></head><body><p>oi</p></body></html>";
    expect(renderPageHtml(html, OPTS)).toContain("<p>oi</p>");
  });

  it("fatias inválidas mantêm o desenho que já estava", () => {
    const old = '<svg id="antigo"><text>x</text></svg>';
    const out = renderPageHtml(wheelPage(old, "nao-e-json-valido"), OPTS);
    expect(out).toContain('id="antigo"');
  });

  it("no HTML REAL do modelo Roleta, troca o svg antigo pelo atual", () => {
    // HTML exatamente como o editor/modelo salva (data-os-slices escapado, disc com svg).
    const real = defToHtml(wheelDef(DEFAULT_WHEEL, { html: true }));
    // Simula um deploy antigo: troca o desenho atual por um svg velho com dominant-baseline.
    const withOld = real.replace(/<svg[\s\S]*?<\/svg>/, '<svg><text dominant-baseline="central">VELHO</text></svg>');
    expect(withOld).toContain("VELHO"); // confirmou que a troca pegou o lugar certo
    const out = renderPageHtml(`<!doctype html><html><head></head><body>${withOld}</body></html>`, OPTS);
    // O render redesenhou: sumiu o svg velho e entrou o desenho atual.
    expect(out).not.toContain("VELHO");
    expect(out).not.toContain("dominant-baseline");
    expect(out).toContain('text-anchor="middle"');
    expect(out).toContain('viewBox="-117 -117 234 234"');
  });
});
