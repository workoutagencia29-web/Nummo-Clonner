/**
 * Fase 6 (polimento E — editor e arredores), partes sem navegador:
 * - "Baixar ZIP": botão de compra sem link (data-os-link="" do modelo, ou link
 *   da oferta sem endereço) ganha aviso na prévia, com a página para abrir no editor;
 * - oferta criada de um modelo ganha a miniatura do modelo; iniciais da capa
 *   sem números ("E3");
 * - título da aba do editor ("Upsell (Versão B) · Oferta").
 */
import { beforeEach, describe, expect, it } from "vitest";
import { initials } from "@/components/offers/offer-thumbnail";
import { editorTabTitle } from "@/editor/title";
import { prisma } from "@/lib/db";
import { deadButtonsWarning, exportWarningFix } from "@/lib/export/warnings";
import { objectExists } from "@/lib/storage";
import { exportPlan } from "@/server/services/export";
import { createOffer } from "@/server/services/offers";
import { resetDatabase } from "../setup/per-file";
import { removeExportFiles } from "./export-fixture";

beforeEach(async () => {
  await removeExportFiles();
  await resetDatabase();
});

describe("aviso de botão sem link no ZIP", () => {
  it("texto: um botão (com o nome) e vários botões em várias páginas; a tela reconhece o aviso", () => {
    const one = deadButtonsWarning([{ name: "Página principal", buttons: ["  QUERO GARANTIR\n MINHA VAGA "] }]);
    expect(one).toBe(
      "O botão “QUERO GARANTIR MINHA VAGA” da página “Página principal” ainda não leva a lugar nenhum (está sem link de checkout): abra a página no editor, clique no botão e escolha o checkout em “Link da oferta” (ou digite o endereço).",
    );
    const many = deadButtonsWarning([
      { name: "Vendas", buttons: ["Comprar", "Comprar agora"] },
      { name: "Upsell", buttons: ["Sim, quero"] },
      { name: "Sem botão", buttons: [] },
    ]);
    expect(many).toMatch(/^3 botões nas páginas “Vendas” e “Upsell” ainda não levam a lugar nenhum/);
    expect(deadButtonsWarning([{ name: "X", buttons: [] }])).toBeNull();
    expect(exportWarningFix(one as string)).toEqual({ kind: "deadButtons" });
    expect(exportWarningFix(many as string)).toEqual({ kind: "deadButtons" });
  });

  it("oferta do modelo VSL: a prévia avisa do botão de compra sem link e diz qual página abrir", async () => {
    const offer = await createOffer({ name: "Oferta VSL", templateId: "vsl" });
    const plan = await exportPlan(offer.id);
    const warning = plan.warnings.find((w) => w.includes("ainda não lev"));
    expect(warning).toBeTruthy();
    expect(warning).toContain("“Página principal”");
    const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { page: { offerId: offer.id } } } });
    expect(plan.deadButtonPages).toEqual([{ name: "Página principal", documentId: doc.id }]);
  });

  it("botão ligado a um link com endereço (ou com endereço digitado) não avisa; link sem endereço avisa", async () => {
    const offer = await createOffer({ name: "Oferta Links" });
    const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { page: { offerId: offer.id } } } });
    const setHtml = (body: string) =>
      prisma.pageDocument.update({
        where: { id: doc.id },
        data: { html: `<!doctype html><html><head><title>T</title></head><body>${body}</body></html>` },
      });
    const dead = async () => (await exportPlan(offer.id)).warnings.filter((w) => w.includes("ainda não lev"));

    // Endereço digitado com "— nenhum —" no Link da oferta: leva a algum lugar.
    await setHtml(`<a href="https://pay.exemplo.com/x" data-os-link="">Comprar</a>`);
    expect(await dead()).toEqual([]);

    // Ligado a um link da oferta ainda sem endereço: o botão sai com href="#".
    await prisma.offerLink.create({ data: { offerId: offer.id, key: "checkout", label: "Checkout", url: "" } });
    await setHtml(`<a href="#" data-os-link="checkout"><span><span>Comprar agora</span></span></a>`);
    expect(await dead()).toEqual([
      expect.stringContaining("O botão “Comprar agora” da página “Página principal” ainda não leva a lugar nenhum"),
    ]);

    // Com o endereço preenchido, o aviso some.
    await prisma.offerLink.updateMany({ where: { offerId: offer.id }, data: { url: "https://pay.exemplo.com/y" } });
    expect(await dead()).toEqual([]);
    expect((await exportPlan(offer.id)).deadButtonPages).toBeUndefined();
  });
});

describe("miniatura das ofertas de modelo", () => {
  it("oferta criada de um modelo ganha o esboço do modelo; em branco, fica sem", async () => {
    const fromTemplate = await createOffer({ name: "Emagrecimento 30D", templateId: "vsl" });
    const blank = await createOffer({ name: "Em branco" });
    const rows = await prisma.offer.findMany({
      where: { id: { in: [fromTemplate.id, blank.id] } },
      select: { id: true, thumbnailKey: true },
    });
    const thumb = rows.find((r) => r.id === fromTemplate.id)?.thumbnailKey;
    expect(thumb).toMatch(/^a\/[0-9a-f]{2}\/[0-9a-f]{64}\.svg$/);
    expect(objectExists(thumb as string)).toBe(true);
    expect(rows.find((r) => r.id === blank.id)?.thumbnailKey).toBeNull();
  });

  it("iniciais da capa: só palavras que começam com letra", () => {
    expect(initials("Emagrecimento 30D")).toBe("EM");
    expect(initials("Curso 3 de Inglês")).toBe("CD");
    expect(initials("Método Fácil")).toBe("MF");
    expect(initials("2026")).toBe("OS");
  });
});

describe("título da aba do editor", () => {
  const base = {
    pageName: "Upsell",
    offerName: "Oferta X",
    variantName: "A",
    hasVariants: false,
    device: "ALL" as const,
  };
  it("página · oferta; versão A/B e celular entre parênteses; nome repetido aparece uma vez", () => {
    expect(editorTabTitle(base)).toBe("Upsell · Oferta X");
    expect(editorTabTitle({ ...base, variantName: "B", hasVariants: true })).toBe("Upsell (Versão B) · Oferta X");
    expect(editorTabTitle({ ...base, device: "MOBILE" })).toBe("Upsell (celular) · Oferta X");
    expect(editorTabTitle({ ...base, pageName: "Oferta X" })).toBe("Oferta X");
  });
});
