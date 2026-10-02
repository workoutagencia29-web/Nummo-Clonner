/**
 * Reparo de páginas abertas no editor antes das correções #9 (ids repetidos
 * renomeados para "<id>-2") e #42 (<style> de <noscript> virando CSS de todo
 * visitante): o que o servidor detecta no projeto e manda reparar.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  computeLegacyRepair,
  hasLegacySignals,
  legacySignals,
  PROJECT_FORMAT_KEY,
  withProjectFormat,
} from "@/lib/legacy-repair";
import { packProject, unpackProject } from "@/lib/project-data";
import { getEditorPayload, removeVersionFiles, saveEditorDocument } from "@/server/services/documents";
import { createOffer } from "@/server/services/offers";
import { resetDatabase } from "../setup/per-file";

/** Projeto no formato do GrapesJS (getProjectData), só com o que importa aqui. */
function project(components: unknown[], styles: unknown[] = []) {
  return {
    styles,
    pages: [{ frames: [{ component: { type: "wrapper", components } }] }],
  };
}

const ORIGINAL = `<!doctype html><html><head>
<noscript><style id="rocket-lazyload-nojs-css">.rll-youtube-player, [data-lazy-src]{display:none !important;}</style></noscript>
</head><body>
<a id="comprar" class="btn">1</a><section id="s"><a id="comprar" class="btn">2</a><a id="comprar">3</a></section>
<div id="bloco-2">já existia</div><div id="bloco">a</div><div id="bloco">b</div>
<noscript><style>.lazyload{display:none!important}</style><img src="/os-assets/b.png"></noscript>
</body></html>`;

describe("sinais de página gravada antes das correções", () => {
  it("projeto novo (os-noscript, repetidos marcados) não tem sinais", () => {
    const signals = legacySignals(
      project([
        { type: "os-noscript", tagName: "os-noscript" },
        { attributes: { id: "comprar" } },
        { attributes: { "data-os-dup-id": "comprar" } },
        { attributes: { id: "i9xk", "data-os-dup-id": "comprar" } },
        { attributes: { id: "sem-numero" } },
      ]),
    );
    expect(hasLegacySignals(signals)).toBe(false);
  });

  it("<noscript> de verdade e ids '<id>-N' sem marca são sinais", () => {
    const signals = legacySignals(
      project(
        [
          { tagName: "noscript", components: [{ tagName: "img", attributes: { id: "px-2" } }] },
          { attributes: { id: "comprar-2" } },
          { attributes: { id: "comprar-3", "data-os-dup-id": "comprar" } },
        ],
        // Regras de CSS não contam (selectors com "-2" não são componentes).
        [{ selectors: ["#x-2"], attributes: { id: "y-9" } }],
      ),
    );
    expect(signals.noscript).toBe(true);
    expect([...signals.suffixIds.keys()].sort()).toEqual(["comprar-2", "px-2"]);
  });
});

describe("projetos gravados pelo editor corrigido", () => {
  const ORIGINAL_2 = `<html><body><section id="oferta" class="d"></section><section id="oferta" class="m"></section>
<section id="oferta-2" class="o2"></section><a href="#oferta-2">ver</a></body></html>`;

  it("marca de formato: nenhum sinal, nada a reparar", () => {
    const stamped = withProjectFormat(project([{ tagName: "noscript" }, { attributes: { id: "oferta-2" } }]));
    expect(stamped).toMatchObject({ [PROJECT_FORMAT_KEY]: 2 });
    const signals = legacySignals(stamped);
    expect(hasLegacySignals(signals)).toBe(false);
    expect(computeLegacyRepair(ORIGINAL_2, signals)).toBeNull();
  });

  it("sem a marca, mas com os repetidos já marcados: '<id>-N' é um id de verdade (ou uma cópia)", () => {
    // Página aberta pelo editor corrigido antes da marca de formato: o 2º "oferta"
    // entrou com data-os-dup-id; "oferta-2" é a 3ª seção da página, não uma renomeação.
    const signals = legacySignals(
      project([
        { attributes: { id: "oferta" } },
        { attributes: { "data-os-dup-id": "oferta" } },
        { attributes: { id: "oferta-2" } },
      ]),
    );
    expect([...signals.markedIds]).toEqual(["oferta"]);
    expect(computeLegacyRepair(ORIGINAL_2, signals)).toBeNull();
    // Página antiga de verdade (sem marcas): o "oferta-2" renomeado continua reparado.
    const legacy = legacySignals(
      project([
        { tagName: "section", classes: ["d"], attributes: { id: "oferta" } },
        { tagName: "section", classes: ["m"], attributes: { id: "oferta-2" } },
      ]),
    );
    expect(computeLegacyRepair(ORIGINAL_2, legacy)?.dupIds).toEqual({ "oferta-2": "oferta" });
  });

  it("sem a marca e sem o repetido marcado (excluído depois): o 'oferta-2' de verdade não vira repetido", () => {
    // Editor corrigido de antes da marca de formato; a pessoa excluiu o 2º
    // "oferta" (o marcado). Sobra a 3ª seção da página, que já era "oferta-2".
    const signals = legacySignals(
      project([
        { tagName: "section", classes: ["d"], attributes: { id: "oferta" } },
        { tagName: "section", classes: ["o2"], attributes: { id: "oferta-2" } },
      ]),
    );
    expect([...signals.markedIds]).toEqual([]);
    expect([...signals.suffixIds.keys()]).toEqual(["oferta-2"]);
    expect(computeLegacyRepair(ORIGINAL_2, signals)).toBeNull();
    // A tag também conta: mesmas classes, outro elemento.
    const otherTag = legacySignals(project([{ tagName: "div", classes: ["m"], attributes: { id: "oferta-2" } }]));
    expect(computeLegacyRepair(ORIGINAL_2, otherTag)).toBeNull();
  });
});

describe("o que reparar (comparando com a versão original)", () => {
  it("CSS dos <style> de <noscript> e as renomeações que o editor antigo fez", () => {
    const signals = legacySignals(
      project([
        { tagName: "noscript" },
        { classes: ["btn"], attributes: { id: "comprar" } },
        // Classes como o GrapesJS grava (nome ou objeto); a tag padrão do tipo (link: <a>) não é gravada.
        { classes: [{ name: "btn", active: false }], attributes: { id: "comprar-2" } },
        { attributes: { id: "comprar-3" } },
        { attributes: { id: "bloco-2" } },
        { attributes: { id: "bloco" } },
        // O segundo "bloco" virou "bloco-3" ("bloco-2" já existia na página).
        { attributes: { id: "bloco-3" } },
        // Id digitado pelo usuário que não é renomeação.
        { attributes: { id: "secao-2" } },
      ]),
    );
    const repair = computeLegacyRepair(ORIGINAL, signals);
    expect(repair?.noscriptCss).toEqual([
      ".rll-youtube-player, [data-lazy-src]{display:none !important;}",
      ".lazyload{display:none!important}",
    ]);
    expect(repair?.dupIds).toEqual({ "comprar-2": "comprar", "comprar-3": "comprar", "bloco-3": "bloco" });
  });

  it("nada a reparar: null", () => {
    expect(computeLegacyRepair("<html><body><p id='a-2'>x</p></body></html>", legacySignals(project([])))).toBeNull();
    const signals = legacySignals(project([{ attributes: { id: "a-2" } }]));
    expect(computeLegacyRepair("<html><body><p id='a-2'>x</p><p id='a'>y</p></body></html>", signals)).toBeNull();
  });
});

describe("ao abrir no editor (getEditorPayload)", () => {
  const touched = new Set<string>();
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await removeVersionFiles(touched);
  });

  async function newDoc(html: string) {
    const offer = await createOffer({ name: "Oferta" });
    const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { page: { offerId: offer.id } } } });
    touched.add(doc.id);
    await prisma.pageDocument.update({ where: { id: doc.id }, data: { html } });
    return doc.id;
  }

  const LEGACY = project([
    { tagName: "noscript" },
    { classes: ["btn"], attributes: { id: "comprar" } },
    { classes: ["btn"], attributes: { id: "comprar-2" } },
  ]);

  /** Gravação do editor antigo: o HTML de antes vira a "Versão original" e o projeto fica sem a marca de formato. */
  async function legacySave(id: string, project: unknown) {
    await saveEditorDocument({ documentId: id, revision: 0, project, html: "<p>x</p>", css: "" });
    await prisma.pageDocument.update({ where: { id }, data: { project: packProject(project) } });
  }

  it("projeto gravado antes das correções: manda o reparo calculado da 'Versão original'", async () => {
    const id = await newDoc(ORIGINAL);
    await legacySave(id, LEGACY);
    const payload = await getEditorPayload(id);
    expect(payload.repair).toEqual({
      noscriptCss: [
        ".rll-youtube-player, [data-lazy-src]{display:none !important;}",
        ".lazyload{display:none!important}",
      ],
      dupIds: { "comprar-2": "comprar" },
    });
  });

  it("projeto sem sinais, ou sem a versão original: nada a reparar", async () => {
    const clean = await newDoc(ORIGINAL);
    await saveEditorDocument({
      documentId: clean,
      revision: 0,
      project: project([{ tagName: "os-noscript" }, { attributes: { id: "comprar" } }]),
      html: "<p>x</p>",
      css: "",
    });
    expect((await getEditorPayload(clean)).repair).toBeNull();

    const orphan = await newDoc(ORIGINAL);
    await prisma.pageDocument.update({ where: { id: orphan }, data: { project: packProject(LEGACY) } });
    expect((await getEditorPayload(orphan)).repair).toBeNull();

    // Gravado pelo editor corrigido (marca de formato): nunca é reparado, mesmo
    // com um "<id>-N" que o editor antigo teria criado (ex.: cópia de Duplicar).
    const saved = await newDoc(ORIGINAL);
    await saveEditorDocument({ documentId: saved, revision: 0, project: LEGACY, html: "<p>x</p>", css: "" });
    const row = await prisma.pageDocument.findUniqueOrThrow({ where: { id: saved } });
    expect(unpackProject<Record<string, unknown>>(row.project as Uint8Array)[PROJECT_FORMAT_KEY]).toBe(2);
    expect((await getEditorPayload(saved)).repair).toBeNull();

    // Primeira abertura (sem projeto): o HTML já vem corrigido, sem reparo.
    const fresh = await newDoc(ORIGINAL);
    const payload = await getEditorPayload(fresh);
    expect(payload.project).toBeNull();
    expect(payload.repair).toBeNull();
  });
});
