/**
 * Teste A/B — 3ª rodada de correções (sem tela):
 *
 * - criar uma versão não tira as pausadas (0%) da pausa: a nova entra na
 *   divisão por igual só com as versões ativas (weightsAfterCreate);
 * - salvar a divisão confere a divisão de onde a tela partiu: outra aba que
 *   mudou os percentuais nesse meio-tempo não é sobrescrita sem aviso;
 * - as mensagens de "tela desatualizada" que a tela reconhece para recarregar
 *   a lista (isStaleVariantsError) são as que o serviço lança.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  COPY_SOURCE_GONE,
  evenSplit,
  isStaleVariantsError,
  LAST_VARIANT,
  LIST_CHANGED,
  PAGE_NOT_FOUND,
  TOO_MANY_VARIANTS,
  VARIANT_NOT_FOUND,
  WEIGHTS_CHANGED,
  weightsAfterCreate,
  weightsTotal,
} from "@/components/offers/variants/weights";
import { prisma } from "@/lib/db";
import { createOffer, trashOffer } from "@/server/services/offers";
import * as service from "@/server/services/variants";
import { resetDatabase } from "../setup/per-file";
import { expectUserError } from "./helpers";

describe("weightsAfterCreate", () => {
  it("as pausadas (0%) continuam pausadas; a nova divide por igual com as ativas", () => {
    expect(weightsAfterCreate([90, 10, 0])).toEqual({ weights: [34, 33, 0], created: 33 });
    expect(weightsAfterCreate([100, 0])).toEqual({ weights: [50, 0], created: 50 });
    expect(weightsAfterCreate([0, 100, 0])).toEqual({ weights: [0, 50, 0], created: 50 });
    expect(weightsAfterCreate([0, 0, 100, 0])).toEqual({ weights: [0, 0, 50, 0], created: 50 });
  });

  it("sem pausadas: o mesmo que dividir por igual entre todas (50/50, 34/33/33…)", () => {
    for (let n = 1; n <= 4; n++) {
      const before = evenSplit(n);
      const after = weightsAfterCreate(before);
      expect([...after.weights, after.created]).toEqual(evenSplit(n + 1));
    }
    expect(weightsAfterCreate([70, 30])).toEqual({ weights: [34, 33], created: 33 });
  });

  it("sempre soma 100, inteiros, e a nova nunca nasce pausada", () => {
    const cases = [[100], [1, 99], [0, 1, 99], [0, 0, 0, 100], [25, 25, 25, 25], [97, 1, 1, 1], [0, 0, 1, 0, 99]];
    for (const weights of cases) {
      const r = weightsAfterCreate(weights);
      expect(weightsTotal([...r.weights, r.created]), String(weights)).toBe(100);
      expect(r.created).toBeGreaterThan(0);
      weights.forEach((w, i) => {
        if (w === 0) expect(r.weights[i], `${weights}[${i}]`).toBe(0);
        else expect(r.weights[i], `${weights}[${i}]`).toBeGreaterThan(0);
      });
    }
  });

  it("todas zeradas (não deveria acontecer) ou nenhuma: todas entram", () => {
    expect(weightsAfterCreate([0, 0])).toEqual({ weights: [34, 33], created: 33 });
    expect(weightsAfterCreate([])).toEqual({ weights: [], created: 100 });
  });
});

describe("isStaleVariantsError", () => {
  it("reconhece as mensagens de tela desatualizada, e só elas", () => {
    for (const msg of [
      PAGE_NOT_FOUND,
      VARIANT_NOT_FOUND,
      LIST_CHANGED,
      WEIGHTS_CHANGED,
      COPY_SOURCE_GONE,
      TOO_MANY_VARIANTS,
      LAST_VARIANT,
    ]) {
      expect(isStaleVariantsError(msg), msg).toBe(true);
    }
    for (const msg of [
      "Os percentuais precisam somar 100% (agora somam 90%).",
      "O nome da versão pode ter no máximo 60 caracteres.",
      "Algo deu errado. Tente de novo.",
      "",
      null,
      undefined,
    ]) {
      expect(isStaleVariantsError(msg), String(msg)).toBe(false);
    }
  });

  it("não pede mais para fechar e abrir o diálogo", () => {
    expect(LIST_CHANGED).toBe("A lista de versões mudou em outra aba ou janela. Confira e tente de novo.");
    expect(LIST_CHANGED).not.toMatch(/Feche e abra/);
    expect(service.LIST_CHANGED).toBe(LIST_CHANGED);
    expect(service.TOO_MANY_VARIANTS).toBe(TOO_MANY_VARIANTS);
    expect(service.LAST_VARIANT).toBe(LAST_VARIANT);
  });
});

// ─── Com o banco ─────────────────────────────────────────────────────────────

beforeEach(async () => {
  await resetDatabase();
});

async function setup() {
  const offer = await createOffer({ name: "Oferta A/B" });
  const page = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id } });
  return { offerId: offer.id, pageId: page.id };
}

function variantsOf(pageId: string) {
  return prisma.pageVariant.findMany({ where: { pageId }, orderBy: { position: "asc" } });
}

async function setWeights(pageId: string, weights: number[]) {
  const variants = await variantsOf(pageId);
  await service.setVariantWeights({
    pageId,
    weights: variants.map((v, i) => ({ variantId: v.id, weight: weights[i] })),
  });
}

const summary = async (pageId: string) =>
  (await variantsOf(pageId)).map((v) => `${v.name}${v.isControl ? "*" : ""}:${v.weight}`);

describe("createVariant — versões pausadas", () => {
  it("A90/B10/C0 (pausada) + nova → A34/B33/C0/D33", async () => {
    const { pageId } = await setup();
    await service.createVariant({ pageId });
    await service.createVariant({ pageId });
    await setWeights(pageId, [90, 10, 0]);

    const d = await service.createVariant({ pageId });

    expect(d.name).toBe("D");
    expect(await summary(pageId)).toEqual(["A*:34", "B:33", "C:0", "D:33"]);
  });

  it("controle pausado também continua pausado; a quinta versão idem", async () => {
    const { pageId } = await setup();
    await service.createVariant({ pageId });
    await setWeights(pageId, [0, 100]);
    await service.createVariant({ pageId });
    expect(await summary(pageId)).toEqual(["A*:0", "B:50", "C:50"]);
    await setWeights(pageId, [0, 60, 40]);
    await service.createVariant({ pageId });
    await service.createVariant({ pageId });
    expect(await summary(pageId)).toEqual(["A*:0", "B:25", "C:25", "D:25", "E:25"]);
  });

  it("sem pausadas, a divisão continua por igual entre todas", async () => {
    const { pageId } = await setup();
    await service.createVariant({ pageId });
    await setWeights(pageId, [80, 20]);
    await service.createVariant({ pageId });
    expect(await summary(pageId)).toEqual(["A*:34", "B:33", "C:33"]);
  });

  it("a cópia de uma versão pausada nasce ativa (é a versão nova do teste)", async () => {
    const { pageId } = await setup();
    const b = await service.createVariant({ pageId });
    await setWeights(pageId, [100, 0]);
    await service.createVariant({ pageId, source: { kind: "copy", variantId: b.id } });
    expect(await summary(pageId)).toEqual(["A*:50", "B:0", "C:50"]);
  });
});

describe("setVariantWeights — mudança em outra aba", () => {
  it("a divisão salva mudou desde que a tela abriu: recusa sem gravar", async () => {
    const { pageId } = await setup();
    await service.createVariant({ pageId });
    const [a, b] = await variantsOf(pageId);
    // Outra aba: 90/10.
    await setWeights(pageId, [90, 10]);
    // Esta aba partiu de 50/50 e quer 70/30.
    await expectUserError(
      service.setVariantWeights({
        pageId,
        weights: [
          { variantId: a.id, weight: 70, saved: 50 },
          { variantId: b.id, weight: 30, saved: 50 },
        ],
      }),
      WEIGHTS_CHANGED,
    );
    expect(await summary(pageId)).toEqual(["A*:90", "B:10"]);
  });

  it("partindo da divisão atual, grava; sem `saved` (outros chamadores), não confere", async () => {
    const { pageId } = await setup();
    await service.createVariant({ pageId });
    const [a, b] = await variantsOf(pageId);
    await service.setVariantWeights({
      pageId,
      weights: [
        { variantId: a.id, weight: 70, saved: 50 },
        { variantId: b.id, weight: 30, saved: 50 },
      ],
    });
    expect(await summary(pageId)).toEqual(["A*:70", "B:30"]);
    await service.setVariantWeights({
      pageId,
      weights: [
        { variantId: a.id, weight: 60 },
        { variantId: b.id, weight: 40, saved: null },
      ],
    });
    expect(await summary(pageId)).toEqual(["A*:60", "B:40"]);
  });

  it("lista diferente (versão criada em outra aba) vem antes: LIST_CHANGED", async () => {
    const { pageId } = await setup();
    await service.createVariant({ pageId });
    const [a, b] = await variantsOf(pageId);
    await service.createVariant({ pageId });
    await expectUserError(
      service.setVariantWeights({
        pageId,
        weights: [
          { variantId: a.id, weight: 70, saved: 50 },
          { variantId: b.id, weight: 30, saved: 50 },
        ],
      }),
      LIST_CHANGED,
    );
  });

  it("as mensagens que o serviço lança com a tela desatualizada são todas reconhecidas", async () => {
    const { pageId, offerId } = await setup();
    const b = await service.createVariant({ pageId });
    await service.deleteVariant(b.id);
    const [onlyA] = await variantsOf(pageId);
    const calls: (() => Promise<unknown>)[] = [
      () => service.renameVariant({ variantId: b.id, label: "x" }),
      () => service.setControlVariant(b.id),
      () => service.deleteVariant(b.id),
      () => service.variantPreviewTarget(b.id),
      () => service.createVariant({ pageId, source: { kind: "copy", variantId: b.id } }),
      () => service.deleteVariant(onlyA.id),
    ];
    for (const call of calls) {
      const err = await call().then(
        () => null,
        (e: Error) => e,
      );
      expect(err).toBeInstanceOf(Error);
      expect(isStaleVariantsError(err?.message), err?.message).toBe(true);
    }
    for (let i = 0; i < 4; i++) await service.createVariant({ pageId });
    await expect(service.createVariant({ pageId })).rejects.toThrow(TOO_MANY_VARIANTS);
    await trashOffer(offerId);
    const gone = await service.listVariants(pageId).then(
      () => null,
      (e: Error) => e,
    );
    expect(gone?.message).toBe(PAGE_NOT_FOUND);
    expect(isStaleVariantsError(gone?.message)).toBe(true);
  });
});
