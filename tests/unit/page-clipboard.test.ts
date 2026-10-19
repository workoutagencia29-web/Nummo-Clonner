/**
 * Clipboard entre páginas (src/editor/grapes/page-clipboard): a troca de ids ao
 * colar (ids novos, sem colidir; as regras #id/[data-os-eid] acompanham).
 */
import { describe, expect, it } from "vitest";
import { remapIds } from "@/editor/grapes/page-clipboard";

describe("remapIds", () => {
  it("troca id e data-os-eid por ids novos, nos mesmos lugares do HTML e do CSS", () => {
    const html = `<div id="a1"><span data-os-eid="b2">x</span></div>`;
    const css = `#a1{color:red} #a1:hover{color:green} [data-os-eid="b2"]{color:blue}`;
    const out = remapIds(html, css);
    // Os ids antigos somem dos dois.
    expect(out.html).not.toContain('id="a1"');
    expect(out.html).not.toContain('data-os-eid="b2"');
    expect(out.css).not.toContain("#a1");
    expect(out.css).not.toContain("b2");
    // O id novo do elemento aparece na regra #id (inclusive :hover).
    const newId = out.html.match(/id="([^"]+)"/)?.[1] ?? "";
    expect(newId).toBeTruthy();
    expect(out.css).toContain(`#${newId}{`);
    expect(out.css).toContain(`#${newId}:hover`);
    // O data-os-eid novo casa entre HTML e CSS.
    const newEid = out.html.match(/data-os-eid="([^"]+)"/)?.[1] ?? "";
    expect(newEid).toBeTruthy();
    expect(out.css).toContain(`[data-os-eid="${newEid}"]`);
  });

  it("não mexe em cores hexadecimais (# que não é id)", () => {
    const out = remapIds(`<div id="a1">x</div>`, `#a1{color:#ffffff;border-color:#abc}`);
    expect(out.css).toContain("#ffffff");
    expect(out.css).toContain("#abc");
    expect(out.css).not.toContain("#a1");
  });

  it("sem ids, devolve igual", () => {
    const out = remapIds(`<p>oi</p>`, `.x{color:red}`);
    expect(out.html).toBe(`<p>oi</p>`);
    expect(out.css).toBe(`.x{color:red}`);
  });
});
