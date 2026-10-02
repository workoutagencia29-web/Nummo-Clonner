/**
 * Fase 3 — quinta rodada: reparo de páginas abertas pelo editor antigo
 * (src/lib/legacy-repair.ts).
 * - Um "<id>-N" de verdade com a mesma tag e as mesmas classes do repetido
 *   (projeto do editor corrigido de antes da marca de formato) não é
 *   confundido com a renomeação antiga. Nem quando o projeto também tem um
 *   "<id>-N-2" (o nome que o editor antigo daria ao de verdade, mas também o da
 *   cópia feita com Duplicar): sem certeza, nada é renomeado.
 * - A versão "Antes do reparo automático" é guardada com a marca: restaurada,
 *   abre como estava, sem ser reparada de novo.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));

import { POST as createVersionRoute } from "@/app/api/documents/[id]/versions/route";
import { prisma } from "@/lib/db";
import { computeLegacyRepair, legacySignals, PROJECT_FORMAT_KEY } from "@/lib/legacy-repair";
import { packProject, unpackProject } from "@/lib/project-data";
import { getEditorPayload, removeVersionFiles, restoreVersion, saveEditorDocument } from "@/server/services/documents";
import { createOffer } from "@/server/services/offers";
import { resetDatabase } from "../setup/per-file";

const HOST = `localhost:${process.env.PORT || "3000"}`;

/** Projeto no formato do GrapesJS (getProjectData), só com o que importa aqui. */
function project(components: unknown[]) {
  return { styles: [], pages: [{ frames: [{ component: { type: "wrapper", components } }] }] };
}

const section = (id: string) => ({ tagName: "section", classes: ["bloco"], attributes: { id } });

describe("'<id>-N' de verdade com a mesma tag e classes do repetido", () => {
  // Dois "oferta" e um "oferta-2" de verdade, todos iguais por fora.
  const ORIGINAL = `<html><body><section id="oferta" class="bloco">A</section><section id="oferta" class="bloco">B</section>
<section id="oferta-2" class="bloco">C</section></body></html>`;

  it("projeto do editor corrigido (repetido marcado excluído depois): nada a reparar", () => {
    const signals = legacySignals(project([section("oferta"), section("oferta-2")]));
    expect([...signals.suffixIds.keys()]).toEqual(["oferta-2"]);
    expect(computeLegacyRepair(ORIGINAL, signals)).toBeNull();
  });

  it("projeto com 'oferta-2' e 'oferta-2-2' iguais por fora: ambíguo, nada é renomeado", () => {
    // Editor antigo: o repetido (B) virou "oferta-2" e o de verdade (C) "oferta-2-2".
    // Editor corrigido de antes da marca: o repetido marcado foi excluído e o
    // "oferta-2" de verdade (C) foi duplicado com Duplicar (cópia "oferta-2-2").
    // Os dois projetos são iguais por fora: reparar trocaria o id do C de verdade
    // (ele perderia a âncora e o CSS #oferta-2). Sem certeza, fica como está.
    const signals = legacySignals(project([section("oferta"), section("oferta-2"), section("oferta-2-2")]));
    expect(computeLegacyRepair(ORIGINAL, signals)).toBeNull();
  });

  it("'<id>-N-2' sem o '<id>-N' renomeado no projeto: também ambíguo, nada é renomeado", () => {
    // Editor antigo com o "oferta-2" (o repetido) excluído, ou editor corrigido com
    // o C duplicado e depois excluído (sobra a cópia): o nome "oferta-2" só volta
    // quando a renomeação que o tomou é reparada.
    const signals = legacySignals(project([section("oferta"), section("oferta-2-2")]));
    expect(computeLegacyRepair(ORIGINAL, signals)).toBeNull();
  });

  it("'<id>-N' de verdade diferente por fora: a tag e as classes bastam (mesmo sem o '<id>-N-2' no projeto)", () => {
    const original = `<html><body><section id="oferta" class="bloco">A</section><section id="oferta" class="bloco">B</section>
<div id="oferta-2" class="outro">C</div></body></html>`;
    // Editor antigo, com o "oferta-2-2" (a div) excluído depois: o repetido continua reparado.
    const legacy = legacySignals(project([section("oferta"), section("oferta-2")]));
    expect(computeLegacyRepair(original, legacy)?.dupIds).toEqual({ "oferta-2": "oferta" });
    // Editor corrigido de antes da marca, com o repetido excluído: sobra a div de verdade.
    const interim = legacySignals(
      project([section("oferta"), { tagName: "div", classes: ["outro"], attributes: { id: "oferta-2" } }]),
    );
    expect(computeLegacyRepair(original, interim)).toBeNull();
    // Editor antigo completo: os dois voltam (o "oferta-2" da div fica livre).
    const full = legacySignals(
      project([
        section("oferta"),
        section("oferta-2"),
        { tagName: "div", classes: ["outro"], attributes: { id: "oferta-2-2" } },
      ]),
    );
    expect(computeLegacyRepair(original, full)?.dupIds).toEqual({ "oferta-2": "oferta", "oferta-2-2": "oferta-2" });
  });
});

describe("versão 'Antes do reparo automático'", () => {
  const touched = new Set<string>();
  beforeEach(async () => {
    await resetDatabase();
    getSession.mockReset();
    getSession.mockResolvedValue({ user: { id: "u1" }, session: { id: "s1" } });
  });
  afterAll(async () => {
    await removeVersionFiles(touched);
  });

  const ORIGINAL = `<!doctype html><html><head></head><body>
<a id="comprar" class="btn">1</a><a id="comprar" class="btn">2</a></body></html>`;
  const LEGACY = project([
    { classes: ["btn"], attributes: { id: "comprar" } },
    { classes: ["btn"], attributes: { id: "comprar-2" } },
  ]);

  /** Página gravada pelo editor antigo: a "Versão original" existe e o projeto não tem a marca de formato. */
  async function legacyDoc() {
    const offer = await createOffer({ name: "Oferta" });
    const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { page: { offerId: offer.id } } } });
    touched.add(doc.id);
    await prisma.pageDocument.update({ where: { id: doc.id }, data: { html: ORIGINAL } });
    const saved = await saveEditorDocument({
      documentId: doc.id,
      revision: 0,
      project: LEGACY,
      html: "<p>x</p>",
      css: "",
    });
    await prisma.pageDocument.update({ where: { id: doc.id }, data: { project: packProject(LEGACY) } });
    return { id: doc.id, revision: saved.revision };
  }

  /** O que o editor faz ao abrir uma página dessas: guarda a versão (pela rota) e grava a reparada. */
  async function repairOnOpen(id: string, revision: number, body: Record<string, unknown>) {
    expect((await getEditorPayload(id)).repair?.dupIds).toEqual({ "comprar-2": "comprar" });
    const res = await createVersionRoute(
      new Request(`http://${HOST}/api/documents/${id}/versions`, {
        method: "POST",
        headers: { host: HOST, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(200);
    const version = (await res.json()) as { id: string };
    const repaired = project([
      { classes: ["btn"], attributes: { id: "comprar" } },
      { classes: ["btn"], attributes: { "data-os-dup-id": "comprar" } },
    ]);
    await saveEditorDocument({ documentId: id, revision, project: repaired, html: "<p>x</p>", css: "" });
    expect((await getEditorPayload(id)).repair).toBeNull();
    return version.id;
  }

  it("guardada com a marca: restaurada, abre como estava (sem novo reparo)", async () => {
    const { id, revision } = await legacyDoc();
    const versionId = await repairOnOpen(id, revision, { label: "Antes do reparo automático", openAsIs: true });
    await restoreVersion(id, versionId);
    const payload = await getEditorPayload(id);
    expect(payload.repair).toBeNull();
    // O projeto restaurado é o de antes do reparo (com o "comprar-2" do editor antigo).
    const restored = unpackProject<Record<string, unknown>>(
      (await prisma.pageDocument.findUniqueOrThrow({ where: { id } })).project as Uint8Array,
    );
    expect(JSON.stringify(restored)).toContain('"comprar-2"');
    expect(restored[PROJECT_FORMAT_KEY]).toBe(2);
  });

  it("uma versão comum do mesmo estado continua sendo reparada ao restaurar (controle)", async () => {
    const { id, revision } = await legacyDoc();
    const versionId = await repairOnOpen(id, revision, { label: "Minha versão" });
    await restoreVersion(id, versionId);
    expect((await getEditorPayload(id)).repair?.dupIds).toEqual({ "comprar-2": "comprar" });
  });
});
