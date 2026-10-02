/**
 * Server actions do Teste A/B (src/server/actions/variants.ts): validação com
 * mensagens em português, lista atualizada na resposta, atualização do painel
 * (revalidatePath) e link de prévia de uma versão.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { previewPort, resolvePreviewToken } from "@/lib/preview";
import {
  createVariantAction,
  deleteVariantAction,
  listVariantsAction,
  renameVariantAction,
  setControlVariantAction,
  setVariantWeightsAction,
  variantPreviewUrlAction,
} from "@/server/actions/variants";
import { createOffer } from "@/server/services/offers";
import { requireSession } from "@/server/session";
import { resetDatabase } from "../setup/per-file";

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(revalidatePath).mockClear();
});

async function setup() {
  const offer = await createOffer({ name: "Oferta ações A/B" });
  const page = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id } });
  return { offerId: offer.id, pageId: page.id };
}

function ok<T>(result: { ok: true; data: T } | { ok: false; error: string; field?: string }): T {
  if (!result.ok) throw new Error(`Esperava sucesso, veio: ${result.error}`);
  return result.data;
}

describe("createVariantAction", () => {
  it("cria a versão, devolve a lista nova e atualiza o painel", async () => {
    const { pageId } = await setup();
    const data = ok(await createVariantAction({ pageId, source: { kind: "copy" }, label: "Headline nova" }));
    expect(data.created.name).toBe("B");
    expect(data.view.variants.map((v) => [v.name, v.label, v.weight])).toEqual([
      ["A", null, 50],
      ["B", "Headline nova", 50],
    ]);
    expect(data.view.nextName).toBe("C");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(requireSession).toHaveBeenCalled();
  });

  it("a partir de um modelo", async () => {
    const { pageId } = await setup();
    const data = ok(await createVariantAction({ pageId, source: { kind: "template", templateId: "captura" } }));
    const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variantId: data.created.id } });
    expect(doc.device).toBe("ALL");
    expect(doc.html).toContain("<title>Página principal</title>");
  });

  it("valida em português: modelo inválido, nome longo, página ausente", async () => {
    const { pageId } = await setup();
    const badTemplate = await createVariantAction({
      pageId,
      source: { kind: "template", templateId: "nao-existe" as never },
    });
    expect(badTemplate).toMatchObject({ ok: false, error: "Modelo de página inválido." });

    const longLabel = await createVariantAction({ pageId, source: { kind: "copy" }, label: "x".repeat(61) });
    expect(longLabel).toMatchObject({
      ok: false,
      error: "O nome da versão pode ter no máximo 60 caracteres.",
      field: "label",
    });

    const noPage = await createVariantAction({ pageId: "", source: { kind: "copy" } });
    expect(noPage).toMatchObject({ ok: false, error: "Item inválido.", field: "pageId" });

    const missing = await createVariantAction({ pageId: "nao-existe", source: { kind: "copy" } });
    expect(missing).toMatchObject({ ok: false, error: "Página não encontrada. Ela pode ter sido excluída." });
    expect(await prisma.pageVariant.count({ where: { pageId } })).toBe(1);
  });

  it("limite de 5 versões com mensagem clara", async () => {
    const { pageId } = await setup();
    for (let i = 0; i < 4; i++) ok(await createVariantAction({ pageId, source: { kind: "copy" } }));
    const sixth = await createVariantAction({ pageId, source: { kind: "copy" } });
    expect(sixth).toMatchObject({ ok: false, error: "Cada página pode ter no máximo 5 versões (A a E)." });
    expect(ok(await listVariantsAction({ pageId })).nextName).toBeNull();
  });
});

describe("setVariantWeightsAction", () => {
  it("grava 70/30 e devolve a lista", async () => {
    const { pageId } = await setup();
    const { created, view } = ok(await createVariantAction({ pageId, source: { kind: "copy" } }));
    const a = view.variants[0];
    const next = ok(
      await setVariantWeightsAction({
        pageId,
        weights: [
          { variantId: a.id, weight: 70 },
          { variantId: created.id, weight: 30 },
        ],
      }),
    );
    expect(next.variants.map((v) => v.weight)).toEqual([70, 30]);
  });

  it("números quebrados, fora de 0–100 ou soma errada: mensagens em português", async () => {
    const { pageId } = await setup();
    const { created, view } = ok(await createVariantAction({ pageId, source: { kind: "copy" } }));
    const a = view.variants[0].id;
    const b = created.id;
    const run = (wa: number, wb: number) =>
      setVariantWeightsAction({
        pageId,
        weights: [
          { variantId: a, weight: wa },
          { variantId: b, weight: wb },
        ],
      });
    expect(await run(70.5, 29.5)).toMatchObject({
      ok: false,
      error: "Use números inteiros de 0 a 100 em cada versão.",
    });
    expect(await run(-1, 101)).toMatchObject({ ok: false, error: "O percentual não pode ser menor que 0." });
    expect(await run(0, 101)).toMatchObject({ ok: false, error: "O percentual não pode passar de 100." });
    expect(await run(70, 20)).toMatchObject({
      ok: false,
      error: "Os percentuais precisam somar 100% (agora somam 90%).",
      field: "weights",
    });
    expect(await setVariantWeightsAction({ pageId, weights: [] })).toMatchObject({
      ok: false,
      error: "Nenhuma versão para dividir o tráfego.",
    });
  });
});

describe("renomear, controle e excluir", () => {
  it("cada ação devolve a lista da página da versão", async () => {
    const { pageId } = await setup();
    const { created } = ok(await createVariantAction({ pageId, source: { kind: "copy" } }));

    const renamed = ok(await renameVariantAction({ variantId: created.id, label: "Preço 197" }));
    expect(renamed.page.id).toBe(pageId);
    expect(renamed.variants[1].label).toBe("Preço 197");

    const cleared = ok(await renameVariantAction({ variantId: created.id, label: null }));
    expect(cleared.variants[1].label).toBeNull();

    const controlled = ok(await setControlVariantAction({ variantId: created.id }));
    expect(controlled.variants.map((v) => [v.name, v.isControl])).toEqual([
      ["A", false],
      ["B", true],
    ]);

    const deleted = ok(await deleteVariantAction({ variantId: created.id }));
    expect(deleted.deleted).toEqual({ pageId, name: "B", promoted: "A" });
    expect(deleted.view.variants.map((v) => [v.name, v.isControl, v.weight])).toEqual([["A", true, 100]]);

    const last = await deleteVariantAction({ variantId: deleted.view.variants[0].id });
    expect(last).toMatchObject({ ok: false, error: "A página precisa ter pelo menos uma versão." });
    expect(revalidatePath).toHaveBeenCalledTimes(5);
  });
});

describe("variantPreviewUrlAction", () => {
  it("link de prévia que abre direto na versão", async () => {
    const { pageId, offerId } = await setup();
    const { created } = ok(await createVariantAction({ pageId, source: { kind: "copy" } }));
    const { url } = ok(await variantPreviewUrlAction({ variantId: created.id }));
    const match = new RegExp(`^http://([a-z2-7]{26})\\.localhost:${previewPort()}/$`).exec(url);
    expect(match).not.toBeNull();
    expect(await resolvePreviewToken(match?.[1] as string)).toEqual({
      kind: "offer",
      offerId,
      pageId,
      variantId: created.id,
    });
  });

  it("versão inexistente", async () => {
    expect(await variantPreviewUrlAction({ variantId: "nao-existe" })).toMatchObject({
      ok: false,
      error: "Versão não encontrada. Ela pode ter sido excluída.",
    });
  });
});
