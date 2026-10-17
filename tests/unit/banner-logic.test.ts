/**
 * Carrossel de banners — regras puras: limites, textos e as definições
 * (bannerDef/bannerSlideDef) sem GrapesJS nem navegador.
 */
import { describe, expect, it } from "vitest";
import type { Def } from "@/editor/blocks/shared";
import { BANNER_CSS, bannerDef, bannerSlideDef, DEFAULT_BANNER, NEW_BANNER } from "@/editor/widgets/banner-content";
import { BANNER_INTERVAL_DEFAULT, BANNER_MAX_SLIDES, bannerTexts } from "@/lib/banner";

/** Todos os filhos (fundo) que passam no teste. */
function findAll(def: Def, test: (d: Def) => boolean): Def[] {
  const out: Def[] = [];
  const walk = (d: Def) => {
    if (test(d)) out.push(d);
    const kids = d.components;
    if (Array.isArray(kids)) for (const k of kids) if (typeof k !== "string") walk(k);
  };
  walk(def);
  return out;
}

const isType = (type: string) => (d: Def) => d.type === type;
const hasClass = (cls: string) => (d: Def) => (d.classes ?? []).includes(cls);

describe("textos e limites", () => {
  it("textos em pt/es/en e o padrão é pt", () => {
    expect(bannerTexts("pt")).toEqual({ prev: "Banner anterior", next: "Próximo banner", goto: "Ir para o banner" });
    expect(bannerTexts("es").next).toBe("Banner siguiente");
    expect(bannerTexts("en").goto).toBe("Go to banner");
    expect(bannerTexts("xx" as never)).toBe(bannerTexts("pt"));
  });
});

describe("bannerSlideDef", () => {
  it("é um <a class=os-bn-slide> com uma imagem; sem href por padrão (decorativo)", () => {
    const slide = bannerSlideDef();
    expect(slide.tagName).toBe("a");
    expect(slide.classes).toEqual(["os-bn-slide"]);
    expect(slide.attributes?.href).toBeUndefined();
    const img = findAll(slide, isType("os-banner-img"))[0];
    expect(img.tagName).toBe("img");
    expect(img.classes).toEqual(["os-bn-img"]);
    expect(String(img.attributes?.src)).toContain("data:image/svg+xml");
    expect(img.attributes?.loading).toBe("lazy");
  });

  it("com href vira link", () => {
    expect(bannerSlideDef({ href: "os-page:abc" }).attributes?.href).toBe("os-page:abc");
    expect(bannerSlideDef({ alt: "Promoção" })).toBeDefined();
  });
});

describe("bannerDef", () => {
  it("monta a seção com trilha, slides, setas e caixa das bolinhas", () => {
    const def = bannerDef(DEFAULT_BANNER);
    expect(def.tagName).toBe("section");
    expect(def.classes).toEqual(["os-bn"]);
    expect(def.attributes).toMatchObject({
      "data-os-widget": "banner",
      "data-os-autoplay": "1",
      "data-os-interval": String(BANNER_INTERVAL_DEFAULT),
      "data-os-arrows": "1",
      "data-os-dots": "1",
    });
    // Dois banners de exemplo.
    expect(findAll(def, isType("os-banner-slide"))).toHaveLength(2);
    // Uma trilha só.
    const tracks = findAll(def, (d) => d.attributes?.["data-os-bn-track"] !== undefined);
    expect(tracks).toHaveLength(1);
    // Duas setas com aria-label traduzido.
    const navs = findAll(def, hasClass("os-bn-nav"));
    expect(navs).toHaveLength(2);
    expect(navs.map((n) => n.attributes?.["aria-label"])).toEqual(["Banner anterior", "Próximo banner"]);
    // A caixa das bolinhas (vazia; o runtime preenche) com o texto do aria-label.
    const dots = findAll(def, (d) => d.attributes?.["data-os-bn-dots"] !== undefined)[0];
    expect(dots.attributes?.["data-os-bn-goto"]).toBe("Ir para o banner");
    expect(dots.components).toBeUndefined();
  });

  it("respeita autoplay/intervalo/setas/bolinhas e o idioma", () => {
    const def = bannerDef({ slides: [{}], autoplay: false, interval: 8, arrows: false, dots: false, lang: "es" });
    expect(def.attributes).toMatchObject({
      "data-os-autoplay": "0",
      "data-os-interval": "8",
      "data-os-arrows": "0",
      "data-os-dots": "0",
    });
    const navs = findAll(def, hasClass("os-bn-nav"));
    expect(navs.map((n) => n.attributes?.["aria-label"])).toEqual(["Banner anterior", "Banner siguiente"]);
    expect(
      findAll(def, (d) => d.attributes?.["data-os-bn-dots"] !== undefined)[0].attributes?.["data-os-bn-goto"],
    ).toBe("Ir al banner");
  });

  it("as definições são dados puros (vão para o projeto sem perder nada)", () => {
    const def = bannerDef(DEFAULT_BANNER);
    expect(JSON.parse(JSON.stringify(def))).toEqual(def);
    expect(NEW_BANNER.image).toContain("data:image/svg+xml");
  });
});

describe("BANNER_CSS", () => {
  it("vira carrossel só na página publicada e mostra os controles com o JS", () => {
    // No canvas (com data-gjs-type) a trilha fica empilhada; publicada vira flex horizontal.
    expect(BANNER_CSS).toContain(".os-bn-track:not([data-gjs-type]){display:flex");
    expect(BANNER_CSS).toContain("scroll-snap-type:x mandatory");
    // Setas e bolinhas só aparecem quando o script liga a classe os-bn-js.
    expect(BANNER_CSS).toContain(".os-bn.os-bn-js .os-bn-nav{display:flex}");
    expect(BANNER_CSS).toContain(".os-bn.os-bn-js .os-bn-dots{display:flex}");
    expect(BANNER_CSS).toContain('.os-bn[data-os-arrows="0"] .os-bn-nav{display:none}');
    // Só propriedades simples (nada de atalho com var()).
    expect(BANNER_CSS).not.toContain("background:var(");
    expect(BANNER_CSS).not.toContain("border:var(");
  });

  it("tem um teto de banners por carrossel", () => {
    expect(BANNER_MAX_SLIDES).toBeGreaterThanOrEqual(2);
  });
});
