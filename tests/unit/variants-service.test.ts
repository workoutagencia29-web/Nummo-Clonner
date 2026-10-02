/**
 * Versões A/B (src/server/services/variants.ts) com o banco: criar (cópia e
 * modelo), nome, controle, divisão do tráfego, excluir, concorrência, e que
 * duplicar página/oferta e o editor enxergam as versões.
 */
import { existsSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { packProject, unpackProject } from "@/lib/project-data";
import { storagePath } from "@/lib/storage";
import { createVersion, getEditorPayload } from "@/server/services/documents";
import { createOffer, duplicateOffer, trashOffer } from "@/server/services/offers";
import { createPage, duplicatePage } from "@/server/services/pages";
import {
  cleanVariantLabel,
  createVariant,
  deleteVariant,
  LAST_VARIANT,
  listVariants,
  renameVariant,
  setControlVariant,
  setVariantWeights,
  TOO_MANY_VARIANTS,
  variantPreviewTarget,
} from "@/server/services/variants";
import { resetDatabase } from "../setup/per-file";
import { expectUserError } from "./helpers";

beforeEach(async () => {
  await resetDatabase();
});

const PAGE_NOT_FOUND = "Página não encontrada. Ela pode ter sido excluída.";
const VARIANT_NOT_FOUND = "Versão não encontrada. Ela pode ter sido excluída.";

/** Oferta com a página principal (variação A, em branco). */
async function setup() {
  const offer = await createOffer({ name: "Oferta A/B" });
  const page = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id } });
  return { offerId: offer.id, pageId: page.id };
}

function variantsOf(pageId: string) {
  return prisma.pageVariant.findMany({
    where: { pageId },
    orderBy: { position: "asc" },
    include: { documents: { orderBy: { device: "asc" } } },
  });
}

/** Os invariantes que o serviço promete depois de qualquer operação. */
async function expectInvariants(pageId: string) {
  const variants = await variantsOf(pageId);
  expect(variants.length).toBeGreaterThanOrEqual(1);
  expect(variants.length).toBeLessThanOrEqual(5);
  expect(variants.filter((v) => v.isControl)).toHaveLength(1);
  expect(new Set(variants.map((v) => v.name)).size).toBe(variants.length);
  expect(variants.every((v) => ["A", "B", "C", "D", "E"].includes(v.name))).toBe(true);
  expect(variants.reduce((sum, v) => sum + v.weight, 0)).toBe(100);
  expect(variants.every((v) => Number.isInteger(v.weight) && v.weight >= 0 && v.weight <= 100)).toBe(true);
  expect(variants.map((v) => v.position)).toEqual(variants.map((_, i) => i));
  return variants;
}

function summary(variants: Awaited<ReturnType<typeof variantsOf>>) {
  return variants.map((v) => [v.name, v.isControl, v.weight]);
}

describe("createVariant — cópia", () => {
  it("cria B como cópia do controle (html, projeto, assetMap, por aparelho) e divide 50/50", async () => {
    const { pageId, offerId } = await setup();
    const a = await prisma.pageVariant.findFirstOrThrow({ where: { pageId } });
    await prisma.pageDocument.deleteMany({ where: { variantId: a.id } });
    const assetMap = { "/js/app.js": `a/ab/${"a".repeat(64)}.js` };
    await prisma.pageDocument.createMany({
      data: [
        {
          variantId: a.id,
          device: "DESKTOP",
          html: "<p>desk</p>",
          project: packProject({ d: 1 }),
          revision: 9,
          assetMap,
        },
        { variantId: a.id, device: "MOBILE", html: "<p>cel</p>", revision: 3 },
      ],
    });
    const before = new Date(Date.now() - 60_000);
    await prisma.offer.update({ where: { id: offerId }, data: { updatedAt: before } });

    const created = await createVariant({ pageId });

    expect(created.name).toBe("B");
    const variants = await expectInvariants(pageId);
    expect(summary(variants)).toEqual([
      ["A", true, 50],
      ["B", false, 50],
    ]);
    const b = variants[1];
    expect(created.id).toBe(b.id);
    expect(b.label).toBeNull();
    expect(b.documents.map((d) => [d.device, d.html, d.revision, d.assetMap])).toEqual([
      ["DESKTOP", "<p>desk</p>", 0, assetMap],
      ["MOBILE", "<p>cel</p>", 0, null],
    ]);
    expect(unpackProject(b.documents[0].project as Uint8Array)).toEqual({ d: 1 });
    // O documento que abre no editor é o de computador.
    expect(created.documentId).toBe(b.documents[0].id);
    // Documentos novos (nada compartilhado com A).
    expect(b.documents.some((d) => variants[0].documents.some((x) => x.id === d.id))).toBe(false);
    const after = await prisma.offer.findUniqueOrThrow({ where: { id: offerId }, select: { updatedAt: true } });
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.getTime());
  });

  it("C, D e E: tráfego dividido por igual; a sexta versão é recusada", async () => {
    const { pageId } = await setup();
    const expected = [
      [50, 50],
      [34, 33, 33],
      [25, 25, 25, 25],
      [20, 20, 20, 20, 20],
    ];
    for (const weights of expected) {
      await createVariant({ pageId });
      const variants = await expectInvariants(pageId);
      expect(variants.map((v) => v.weight)).toEqual(weights);
    }
    expect((await variantsOf(pageId)).map((v) => v.name)).toEqual(["A", "B", "C", "D", "E"]);
    await expectUserError(createVariant({ pageId }), TOO_MANY_VARIANTS);
    expect(TOO_MANY_VARIANTS).toBe("Cada página pode ter no máximo 5 versões (A a E).");
    await expectInvariants(pageId);
  });

  it("copia a versão escolhida (não só o controle) e grava o nome limpo", async () => {
    const { pageId } = await setup();
    const b = await createVariant({ pageId });
    await prisma.pageDocument.updateMany({ where: { variantId: b.id }, data: { html: "<p>Só na B</p>" } });

    const c = await createVariant({ pageId, source: { kind: "copy", variantId: b.id }, label: "  Preço   197 " });

    const variants = await variantsOf(pageId);
    const vc = variants.find((v) => v.id === c.id);
    expect(vc?.name).toBe("C");
    expect(vc?.label).toBe("Preço 197");
    expect(vc?.documents.map((d) => d.html)).toEqual(["<p>Só na B</p>"]);
  });

  it("versão para copiar que não é desta página dá erro claro", async () => {
    const { pageId, offerId } = await setup();
    const other = await createPage({ offerId, name: "Upsell" });
    const otherVariant = await prisma.pageVariant.findFirstOrThrow({ where: { pageId: other.id } });
    await expectUserError(
      createVariant({ pageId, source: { kind: "copy", variantId: otherVariant.id } }),
      "A versão escolhida para copiar não existe mais. Escolha outra.",
      "source",
    );
    await expectInvariants(pageId);
    expect(await prisma.pageVariant.count({ where: { pageId } })).toBe(1);
  });

  it("nome longo demais é recusado antes de mexer em algo", async () => {
    const { pageId } = await setup();
    await expectUserError(
      createVariant({ pageId, label: "x".repeat(61) }),
      "O nome da versão pode ter no máximo 60 caracteres.",
      "label",
    );
    expect(await prisma.pageVariant.count({ where: { pageId } })).toBe(1);
  });

  it("página inexistente ou oferta na lixeira: não encontrada", async () => {
    const { pageId, offerId } = await setup();
    await expectUserError(createVariant({ pageId: "nao-existe" }), PAGE_NOT_FOUND);
    await trashOffer(offerId);
    await expectUserError(createVariant({ pageId }), PAGE_NOT_FOUND);
    await expectUserError(listVariants(pageId), PAGE_NOT_FOUND);
  });

  it("duas criações ao mesmo tempo viram B e C (sem letra repetida)", async () => {
    const { pageId } = await setup();
    const results = await Promise.all([createVariant({ pageId }), createVariant({ pageId })]);
    expect(results.map((r) => r.name).sort()).toEqual(["B", "C"]);
    const variants = await expectInvariants(pageId);
    expect(variants.map((v) => v.weight)).toEqual([34, 33, 33]);
  });
});

describe("createVariant — modelo", () => {
  it("começa do modelo escolhido, num documento para todos os aparelhos", async () => {
    const { pageId } = await setup();
    const created = await createVariant({ pageId, source: { kind: "template", templateId: "vsl" } });
    const variants = await expectInvariants(pageId);
    const b = variants.find((v) => v.id === created.id);
    expect(b?.documents).toHaveLength(1);
    expect(b?.documents[0].device).toBe("ALL");
    expect(b?.documents[0].project).toBeNull();
    // O <title> do modelo vira o nome da página.
    expect(b?.documents[0].html).toContain("<title>Página principal</title>");
    expect(b?.documents[0].html).not.toBe(variants[0].documents[0].html);
  });

  it("sem modelo: página em branco", async () => {
    const { pageId } = await setup();
    const created = await createVariant({ pageId, source: { kind: "template", templateId: null } });
    const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variantId: created.id } });
    expect(doc.html).toContain("<title>Página principal</title>");
  });

  it("modelo desconhecido: erro em português e nada criado", async () => {
    const { pageId } = await setup();
    await expectUserError(
      createVariant({ pageId, source: { kind: "template", templateId: "nao-existe" } }),
      "Modelo de página não encontrado. Escolha outro modelo ou comece em branco.",
    );
    expect(await prisma.pageVariant.count({ where: { pageId } })).toBe(1);
  });
});

describe("listVariants", () => {
  it("lista na ordem, com pasta do ZIP, documentos e a próxima letra", async () => {
    const { pageId, offerId } = await setup();
    // Uma versão só: o endereço é o da página (raiz), sem pasta oferta-a/.
    expect((await listVariants(pageId)).variants.map((v) => v.zipDir)).toEqual([""]);
    const b = await createVariant({ pageId, label: "Headline nova" });
    const view = await listVariants(pageId);
    expect(view.page).toMatchObject({ id: pageId, offerId, isHome: true, slug: "principal", cloneMode: "EDITABLE" });
    expect(view.nextName).toBe("C");
    expect(view.maxVariants).toBe(5);
    expect(view.variants.map((v) => [v.name, v.label, v.isControl, v.weight, v.zipDir])).toEqual([
      ["A", null, true, 50, "oferta-a/"],
      ["B", "Headline nova", false, 50, "oferta-b/"],
    ]);
    expect(view.variants[1].documentId).toBe(b.documentId);
    expect(view.variants[1].mobileDocumentId).toBeNull();
    expect(view.variants[1].documents).toEqual([{ id: b.documentId, device: "ALL" }]);
    expect(Number.isNaN(Date.parse(view.variants[0].updatedAt))).toBe(false);
  });

  it("versão com computador e celular separados: documento principal e o do celular", async () => {
    const { pageId } = await setup();
    const a = await prisma.pageVariant.findFirstOrThrow({ where: { pageId } });
    await prisma.pageDocument.deleteMany({ where: { variantId: a.id } });
    // Criados fora de ordem: a lista sai sempre ALL/DESKTOP/MOBILE.
    const mobile = await prisma.pageDocument.create({ data: { variantId: a.id, device: "MOBILE", html: "m" } });
    const desktop = await prisma.pageDocument.create({ data: { variantId: a.id, device: "DESKTOP", html: "d" } });
    const [va] = (await listVariants(pageId)).variants;
    expect(va.documents.map((d) => d.device)).toEqual(["DESKTOP", "MOBILE"]);
    expect(va.documentId).toBe(desktop.id);
    expect(va.mobileDocumentId).toBe(mobile.id);
  });
});

describe("renameVariant", () => {
  it("dá, troca e tira o nome (vazio = sem nome)", async () => {
    const { pageId } = await setup();
    const b = await createVariant({ pageId });
    expect(await renameVariant({ variantId: b.id, label: " Headline\n nova " })).toEqual({ pageId });
    expect((await prisma.pageVariant.findUniqueOrThrow({ where: { id: b.id } })).label).toBe("Headline nova");
    await renameVariant({ variantId: b.id, label: "   " });
    expect((await prisma.pageVariant.findUniqueOrThrow({ where: { id: b.id } })).label).toBeNull();
    await renameVariant({ variantId: b.id, label: null });
    expect((await prisma.pageVariant.findUniqueOrThrow({ where: { id: b.id } })).label).toBeNull();
    await expectInvariants(pageId);
  });

  it("recusa nome longo e versão inexistente", async () => {
    const { pageId } = await setup();
    const [a] = await variantsOf(pageId);
    await expectUserError(
      renameVariant({ variantId: a.id, label: "y".repeat(61) }),
      "O nome da versão pode ter no máximo 60 caracteres.",
      "label",
    );
    await expectUserError(renameVariant({ variantId: "nao-existe", label: "x" }), VARIANT_NOT_FOUND);
  });

  it("cleanVariantLabel aceita exatamente 60 caracteres", () => {
    expect(cleanVariantLabel("z".repeat(60))).toBe("z".repeat(60));
    expect(cleanVariantLabel(undefined)).toBeNull();
  });
});

describe("setControlVariant", () => {
  it("troca o controle mantendo exatamente um", async () => {
    const { pageId } = await setup();
    const b = await createVariant({ pageId });
    await createVariant({ pageId });
    expect(await setControlVariant(b.id)).toEqual({ pageId });
    let variants = await expectInvariants(pageId);
    expect(variants.find((v) => v.isControl)?.name).toBe("B");
    // Repetir não muda nada.
    await setControlVariant(b.id);
    variants = await expectInvariants(pageId);
    expect(variants.find((v) => v.isControl)?.name).toBe("B");
    // Os percentuais não mudam com o controle.
    expect(variants.map((v) => v.weight)).toEqual([34, 33, 33]);
  });

  it("vários cliques ao mesmo tempo: um controle só", async () => {
    const { pageId } = await setup();
    const b = await createVariant({ pageId });
    const c = await createVariant({ pageId });
    const [a] = await variantsOf(pageId);
    await Promise.all([setControlVariant(b.id), setControlVariant(c.id), setControlVariant(a.id)]);
    await expectInvariants(pageId);
  });

  it("versão inexistente", async () => {
    await expectUserError(setControlVariant("nao-existe"), VARIANT_NOT_FOUND);
  });
});

describe("setVariantWeights", () => {
  it("grava 70/30", async () => {
    const { pageId } = await setup();
    const b = await createVariant({ pageId });
    const [a] = await variantsOf(pageId);
    await setVariantWeights({
      pageId,
      weights: [
        { variantId: b.id, weight: 30 },
        { variantId: a.id, weight: 70 },
      ],
    });
    expect(summary(await expectInvariants(pageId))).toEqual([
      ["A", true, 70],
      ["B", false, 30],
    ]);
  });

  it("aceita 100/0 (versão pausada no divisor)", async () => {
    const { pageId } = await setup();
    const b = await createVariant({ pageId });
    const [a] = await variantsOf(pageId);
    await setVariantWeights({
      pageId,
      weights: [
        { variantId: a.id, weight: 100 },
        { variantId: b.id, weight: 0 },
      ],
    });
    expect((await expectInvariants(pageId)).map((v) => v.weight)).toEqual([100, 0]);
  });

  it("recusa soma diferente de 100, números quebrados e fora de 0–100", async () => {
    const { pageId } = await setup();
    const b = await createVariant({ pageId });
    const [a] = await variantsOf(pageId);
    const set = (wa: number, wb: number) =>
      setVariantWeights({
        pageId,
        weights: [
          { variantId: a.id, weight: wa },
          { variantId: b.id, weight: wb },
        ],
      });
    await expectUserError(set(60, 30), "Os percentuais precisam somar 100% (agora somam 90%).", "weights");
    await expectUserError(set(50.5, 49.5), "Use números inteiros de 0 a 100 em cada versão.", "weights");
    await expectUserError(set(120, -20), "Use números inteiros de 0 a 100 em cada versão.", "weights");
    expect((await expectInvariants(pageId)).map((v) => v.weight)).toEqual([50, 50]);
  });

  it("lista incompleta, repetida ou de outra página: avisa que a lista mudou", async () => {
    const { pageId, offerId } = await setup();
    const b = await createVariant({ pageId });
    const [a] = await variantsOf(pageId);
    const other = await createPage({ offerId, name: "Outra" });
    const otherA = await prisma.pageVariant.findFirstOrThrow({ where: { pageId: other.id } });
    const changed = "A lista de versões mudou em outra aba ou janela. Confira e tente de novo.";
    await expectUserError(setVariantWeights({ pageId, weights: [{ variantId: a.id, weight: 100 }] }), changed);
    await expectUserError(
      setVariantWeights({
        pageId,
        weights: [
          { variantId: a.id, weight: 50 },
          { variantId: a.id, weight: 50 },
        ],
      }),
      changed,
    );
    await expectUserError(
      setVariantWeights({
        pageId,
        weights: [
          { variantId: a.id, weight: 50 },
          { variantId: otherA.id, weight: 50 },
        ],
      }),
      changed,
    );
    await expectUserError(
      setVariantWeights({
        pageId,
        weights: [
          { variantId: a.id, weight: 40 },
          { variantId: b.id, weight: 40 },
          { variantId: otherA.id, weight: 20 },
        ],
      }),
      changed,
    );
    await expectInvariants(pageId);
  });
});

describe("deleteVariant", () => {
  it("não exclui a última versão", async () => {
    const { pageId } = await setup();
    const [a] = await variantsOf(pageId);
    await expectUserError(deleteVariant(a.id), LAST_VARIANT);
    expect(LAST_VARIANT).toBe("A página precisa ter pelo menos uma versão.");
    await expectInvariants(pageId);
  });

  it("o percentual da excluída vai para as outras na proporção de cada uma", async () => {
    const { pageId } = await setup();
    const b = await createVariant({ pageId });
    const c = await createVariant({ pageId });
    const [a] = await variantsOf(pageId);
    await setVariantWeights({
      pageId,
      weights: [
        { variantId: a.id, weight: 50 },
        { variantId: b.id, weight: 30 },
        { variantId: c.id, weight: 20 },
      ],
    });
    const result = await deleteVariant(a.id);
    // A era o controle: B (a que fica com o maior percentual) passa a ser.
    expect(result).toEqual({ pageId, name: "A", promoted: "B" });
    const variants = await expectInvariants(pageId);
    expect(summary(variants)).toEqual([
      ["B", true, 60],
      ["C", false, 40],
    ]);
    // A letra A não é reaproveitada logo: a próxima segue a maior em uso.
    expect((await listVariants(pageId)).nextName).toBe("D");
    const again = await createVariant({ pageId });
    expect(again.name).toBe("D");
    expect((await expectInvariants(pageId)).map((v) => v.name)).toEqual(["B", "C", "D"]);
  });

  it("excluir o controle nunca promove uma versão pausada (0%): vira controle a de maior percentual", async () => {
    const { pageId } = await setup();
    const b = await createVariant({ pageId });
    const c = await createVariant({ pageId });
    const [a] = await variantsOf(pageId);
    await setVariantWeights({
      pageId,
      weights: [
        { variantId: a.id, weight: 50 },
        { variantId: b.id, weight: 0 },
        { variantId: c.id, weight: 50 },
      ],
    });
    const result = await deleteVariant(a.id);
    expect(result).toEqual({ pageId, name: "A", promoted: "C" });
    expect(summary(await expectInvariants(pageId))).toEqual([
      ["B", false, 0],
      ["C", true, 100],
    ]);
  });

  it("excluir uma versão que não é o controle não troca o controle", async () => {
    const { pageId } = await setup();
    const b = await createVariant({ pageId });
    const result = await deleteVariant(b.id);
    expect(result).toEqual({ pageId, name: "B", promoted: null });
    expect(summary(await expectInvariants(pageId))).toEqual([["A", true, 100]]);
  });

  it("apaga o histórico de versões dos documentos (banco e disco)", async () => {
    const { pageId } = await setup();
    const b = await createVariant({ pageId });
    const docId = b.documentId as string;
    const version = await createVersion(docId, "MANUAL", "Antes do teste");
    expect(existsSync(storagePath(`versions/${docId}`))).toBe(true);

    await deleteVariant(b.id);

    expect(await prisma.pageDocument.count({ where: { id: docId } })).toBe(0);
    expect(await prisma.pageVersion.count({ where: { id: version.id } })).toBe(0);
    expect(existsSync(storagePath(`versions/${docId}`))).toBe(false);
  });

  it("todas as outras com 0%: dividem por igual", async () => {
    const { pageId } = await setup();
    const b = await createVariant({ pageId });
    const c = await createVariant({ pageId });
    const [a] = await variantsOf(pageId);
    await setVariantWeights({
      pageId,
      weights: [
        { variantId: a.id, weight: 100 },
        { variantId: b.id, weight: 0 },
        { variantId: c.id, weight: 0 },
      ],
    });
    await deleteVariant(a.id);
    expect(summary(await expectInvariants(pageId))).toEqual([
      ["B", true, 50],
      ["C", false, 50],
    ]);
  });

  it("duas exclusões ao mesmo tempo nunca deixam a página sem versão", async () => {
    const { pageId } = await setup();
    const b = await createVariant({ pageId });
    const [a] = await variantsOf(pageId);
    const results = await Promise.allSettled([deleteVariant(a.id), deleteVariant(b.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const variants = await expectInvariants(pageId);
    expect(variants).toHaveLength(1);
  });

  it("versão inexistente", async () => {
    await expectUserError(deleteVariant("nao-existe"), VARIANT_NOT_FOUND);
  });
});

describe("variantPreviewTarget", () => {
  it("devolve oferta, página e versão", async () => {
    const { pageId, offerId } = await setup();
    const b = await createVariant({ pageId });
    expect(await variantPreviewTarget(b.id)).toEqual({ offerId, pageId, variantId: b.id });
    await trashOffer(offerId);
    await expectUserError(variantPreviewTarget(b.id), VARIANT_NOT_FOUND);
  });
});

describe("duplicar mantém o teste A/B", () => {
  /** Página com A (30%), B controle (70%, "Headline nova") e documentos próprios. */
  async function abPage() {
    const { pageId, offerId } = await setup();
    const b = await createVariant({ pageId, label: "Headline nova" });
    const [a] = await variantsOf(pageId);
    await prisma.pageDocument.updateMany({ where: { variantId: b.id }, data: { html: "<p>B</p>" } });
    await setVariantWeights({
      pageId,
      weights: [
        { variantId: a.id, weight: 30 },
        { variantId: b.id, weight: 70 },
      ],
    });
    await setControlVariant(b.id);
    return { pageId, offerId };
  }

  function shape(variants: Awaited<ReturnType<typeof variantsOf>>) {
    return variants.map((v) => [v.name, v.label, v.isControl, v.weight, v.position, v.documents.map((d) => d.html)]);
  }

  it("duplicatePage copia versões, percentuais, controle e nomes", async () => {
    const { pageId } = await abPage();
    const copy = await duplicatePage(pageId);
    const original = await variantsOf(pageId);
    const copied = await expectInvariants(copy.id);
    expect(shape(copied)).toEqual(shape(original));
    expect(summary(copied)).toEqual([
      ["A", false, 30],
      ["B", true, 70],
    ]);
    // E a cópia continua editável pelo serviço (sem interferir na original).
    await createVariant({ pageId: copy.id });
    expect(summary(await expectInvariants(copy.id)).map((v) => v[2])).toEqual([34, 33, 33]);
    expect(summary(await variantsOf(pageId))).toEqual([
      ["A", false, 30],
      ["B", true, 70],
    ]);
  });

  it("duplicateOffer copia versões, percentuais, controle e nomes", async () => {
    const { pageId, offerId } = await abPage();
    const copy = await duplicateOffer(offerId);
    const copiedPage = await prisma.page.findFirstOrThrow({ where: { offerId: copy.id, slug: "principal" } });
    const copied = await expectInvariants(copiedPage.id);
    expect(shape(copied)).toEqual(shape(await variantsOf(pageId)));
    const view = await listVariants(copiedPage.id);
    expect(view.variants.map((v) => [v.name, v.label, v.isControl, v.weight])).toEqual([
      ["A", null, false, 30],
      ["B", "Headline nova", true, 70],
    ]);
  });
});

describe("editor (getEditorPayload)", () => {
  it("traz as versões da página com os documentos de cada uma", async () => {
    const { pageId } = await setup();
    const b = await createVariant({ pageId, label: "Headline nova" });
    await setControlVariant(b.id);
    const [a] = await variantsOf(pageId);
    const aDoc = a.documents[0].id;

    const payload = await getEditorPayload(b.documentId as string);
    expect(payload.variant).toEqual({ id: b.id, name: "B", label: "Headline nova", isControl: true });
    expect(payload.variants).toEqual([
      { id: a.id, name: "A", label: null, isControl: false, weight: 50, documents: [{ id: aDoc, device: "ALL" }] },
      {
        id: b.id,
        name: "B",
        label: "Headline nova",
        isControl: true,
        weight: 50,
        documents: [{ id: b.documentId, device: "ALL" }],
      },
    ]);
    // "Páginas" do editor abre o controle.
    expect(payload.pages.find((p) => p.id === pageId)?.documentId).toBe(b.documentId);
  });

  it("página “Preservar JS”: a cópia continua travada; a versão de um modelo abre direto no editor", async () => {
    const { pageId } = await setup();
    await prisma.page.update({ where: { id: pageId }, data: { cloneMode: "PRESERVE_JS" } });
    const [a] = await variantsOf(pageId);
    await prisma.pageDocument.update({
      where: { id: a.documents[0].id },
      data: { assetMap: { "/js/app.js": `a/ab/${"a".repeat(64)}.js` } },
    });
    const copy = await createVariant({ pageId });
    const fromTemplate = await createVariant({ pageId, source: { kind: "template", templateId: "vsl" } });
    expect((await getEditorPayload(a.documents[0].id)).cloneMode).toBe("PRESERVE_JS");
    expect((await getEditorPayload(copy.documentId as string)).cloneMode).toBe("PRESERVE_JS");
    expect((await getEditorPayload(fromTemplate.documentId as string)).cloneMode).toBe("EDITABLE");
  });
});
