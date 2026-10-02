import { describe, expect, it } from "vitest";
import { INTERNAL_LINK_PREFIX, internalLink, referencedPageIds, remapInternalLinks } from "@/lib/internal-links";
import { fakeId } from "./helpers";

const OLD_A = fakeId("olda");
const OLD_B = fakeId("oldb");
const NEW_A = fakeId("newa");
const NEW_B = fakeId("newb");
const UNKNOWN = fakeId("unknown");

const idMap = new Map([
  [OLD_A, NEW_A],
  [OLD_B, NEW_B],
]);

describe("internalLink", () => {
  it("monta o link com o prefixo os-page:", () => {
    expect(internalLink(OLD_A)).toBe(`${INTERNAL_LINK_PREFIX}${OLD_A}`);
    expect(internalLink(OLD_A)).toBe(`os-page:${OLD_A}`);
  });
});

describe("remapInternalLinks", () => {
  it("troca os IDs dentro do HTML e mantém os desconhecidos", () => {
    const html = [
      `<a href="os-page:${OLD_A}">Comprar</a>`,
      `<a href='os-page:${OLD_B}' class="btn">Upsell</a>`,
      `<a href="os-page:${OLD_A}">De novo</a>`,
      `<a href="os-page:${UNKNOWN}">Outra oferta</a>`,
      `<span data-id="${OLD_A}">sem prefixo</span>`,
    ].join("\n");

    const out = remapInternalLinks(html, idMap);

    expect(out).toContain(`<a href="os-page:${NEW_A}">Comprar</a>`);
    expect(out).toContain(`<a href='os-page:${NEW_B}' class="btn">Upsell</a>`);
    expect(out).toContain(`<a href="os-page:${NEW_A}">De novo</a>`);
    expect(out).not.toContain(`os-page:${OLD_A}`);
    expect(out).not.toContain(`os-page:${OLD_B}`);
    // ID sem mapeamento fica intacto.
    expect(out).toContain(`<a href="os-page:${UNKNOWN}">Outra oferta</a>`);
    // Só os links com o prefixo são tocados.
    expect(out).toContain(`<span data-id="${OLD_A}">sem prefixo</span>`);
  });

  it("troca os IDs dentro do JSON do editor sem quebrar o JSON", () => {
    const project = {
      pages: [
        {
          components: [
            { type: "link", attributes: { href: internalLink(OLD_A) } },
            { type: "button", attributes: { "data-href": internalLink(OLD_B) } },
            { type: "link", attributes: { href: internalLink(UNKNOWN) } },
            { type: "text", content: "Ação: veja os-page:curto" },
          ],
        },
      ],
    };

    const out = JSON.parse(remapInternalLinks(JSON.stringify(project), idMap));

    const [a, b, unknown, text] = out.pages[0].components;
    expect(a.attributes.href).toBe(internalLink(NEW_A));
    expect(b.attributes["data-href"]).toBe(internalLink(NEW_B));
    expect(unknown.attributes.href).toBe(internalLink(UNKNOWN));
    expect(text.content).toBe("Ação: veja os-page:curto");
  });

  it("não altera nada com um mapa vazio", () => {
    const html = `<a href="os-page:${OLD_A}">x</a>`;
    expect(remapInternalLinks(html, new Map())).toBe(html);
  });
});

describe("referencedPageIds", () => {
  it("lista os IDs referenciados, sem repetição", () => {
    const html = `<a href="os-page:${OLD_A}"></a><a href="os-page:${OLD_B}"></a><a href="os-page:${OLD_A}"></a>`;
    expect(referencedPageIds(html)).toEqual(new Set([OLD_A, OLD_B]));
  });

  it("ignora IDs curtos demais e texto sem links", () => {
    expect(referencedPageIds("os-page:abc <p>nada aqui</p>")).toEqual(new Set());
  });
});
