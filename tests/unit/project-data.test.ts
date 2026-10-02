import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { internalLink, remapInternalLinks } from "@/lib/internal-links";
import { packProject, transformPackedProject, unpackProject } from "@/lib/project-data";
import { fakeId } from "./helpers";

const sample = {
  title: "Página de Vendas — Ação!",
  pages: [
    {
      id: "p1",
      components: [
        { type: "text", content: 'Aspas "duplas", \\ barra e emoji 🚀' },
        { type: "link", attributes: { href: "os-page:ignorado" } },
      ],
    },
  ],
  numbers: [0, 1.5, -2],
  flags: { a: true, b: false, nada: null },
};

describe("packProject / unpackProject", () => {
  it("compacta em gzip e volta ao mesmo objeto", () => {
    const bytes = packProject(sample);

    expect(bytes).toBeInstanceOf(Uint8Array);
    // Cabeçalho gzip.
    expect(bytes[0]).toBe(0x1f);
    expect(bytes[1]).toBe(0x8b);
    expect(JSON.parse(gunzipSync(bytes).toString("utf8"))).toEqual(sample);
    expect(unpackProject(bytes)).toEqual(sample);
  });

  it("devolve um Uint8Array independente (sem bytes extras do pool do Buffer)", () => {
    const bytes = packProject({ a: 1 });
    expect(bytes.byteOffset).toBe(0);
    expect(bytes.buffer.byteLength).toBe(bytes.byteLength);
  });

  it("aceita valores simples", () => {
    expect(unpackProject(packProject([]))).toEqual([]);
    expect(unpackProject(packProject("texto"))).toBe("texto");
    expect(unpackProject(packProject(null))).toBeNull();
  });
});

describe("transformPackedProject", () => {
  it("aplica a transformação no JSON e devolve compactado", () => {
    const bytes = packProject(sample);
    const out = transformPackedProject(bytes, (json) => json.replaceAll("Vendas", "Obrigado"));

    expect(unpackProject<typeof sample>(out).title).toBe("Página de Obrigado — Ação!");
    // O original não muda.
    expect(unpackProject<typeof sample>(bytes).title).toBe("Página de Vendas — Ação!");
  });

  it("remapeia links internos dentro do projeto compactado", () => {
    const oldId = fakeId("antigo");
    const newId = fakeId("novo");
    const project = { components: [{ attributes: { href: internalLink(oldId) } }] };

    const out = transformPackedProject(packProject(project), (json) =>
      remapInternalLinks(json, new Map([[oldId, newId]])),
    );

    expect(unpackProject(out)).toEqual({ components: [{ attributes: { href: internalLink(newId) } }] });
  });

  it("a transformação identidade preserva o conteúdo", () => {
    const out = transformPackedProject(packProject(sample), (json) => json);
    expect(unpackProject(out)).toEqual(sample);
  });

  it("recusa uma transformação que quebra o JSON (em vez de gravar lixo)", () => {
    expect(() => transformPackedProject(packProject(sample), (json) => json.slice(1))).toThrow();
  });
});
