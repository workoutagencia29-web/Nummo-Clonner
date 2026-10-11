/**
 * Com banco: o checkout do dono da página clonada (CheckoutLink) no plano do
 * ZIP, no ZIP gerado, na aba "Links e checkouts" (selo) e no "Próximos
 * passos"; os links de Política/Termos/Contato do rodapé dos modelos sem
 * destino; e o passo do idioma numa oferta em peso mexicano.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { internalLink } from "@/lib/internal-links";
import { startExport } from "@/server/services/export";
import { claimNextExport, runExportJob } from "@/server/services/export/jobs";
import { exportPlan } from "@/server/services/export/plan";
import { createOfferLink, listOfferLinks, updateOfferLink } from "@/server/services/offer-links";
import { createOffer } from "@/server/services/offers";
import { getOfferReadiness } from "@/server/services/readiness";
import { resetDatabase } from "../setup/per-file";
import { removeExportFiles } from "./export-fixture";

const ORIGINAL = "https://pay.hotmart.com/K12345678X?off=abc";
let offerId = "";
let pageId = "";

beforeAll(async () => {
  await resetDatabase();
  const offer = await createOffer({ name: "Clonada de outro produtor", templateId: "vendas-longa" });
  offerId = offer.id;
  pageId = (await prisma.page.findFirstOrThrow({ where: { offerId } })).id;
  // O que a clonagem grava: o checkout achado na página original.
  await prisma.checkoutLink.create({
    data: { pageId, platform: "hotmart", url: ORIGINAL, source: "HREF", confidence: 100 },
  });
});

afterAll(async () => {
  await removeExportFiles();
});

describe("checkout da página clonada", () => {
  it("plano do ZIP: aviso no topo, com o conserto “Abrir o link”; pagamento na página nunca conta", async () => {
    const hotmart = await createOfferLink(offerId, {
      label: "Checkout Hotmart",
      url: `${ORIGINAL.toUpperCase().replace("HTTPS://", "https://")}/`,
      kind: "CHECKOUT",
    });
    await createOfferLink(offerId, { label: "Meu checkout", url: "https://pay.kiwify.com.br/meu", kind: "CHECKOUT" });
    // Link de pagamento na página com o endereço antigo guardado: não vai para a página.
    await createOfferLink(offerId, { label: "Pagamento", url: ORIGINAL, kind: "UPSELL", target: "PAYMENT" });

    const plan = await exportPlan(offerId);
    expect(plan.warnings[0]).toBe(
      "O link “Checkout Hotmart” ainda leva ao checkout da página que você clonou: quem clicar compra do dono da página original. Troque pelo endereço do seu checkout em “Links e checkouts” e gere o ZIP de novo.",
    );
    expect(plan.clonedCheckoutLinks).toEqual([{ linkId: hotmart.id, label: "Checkout Hotmart" }]);

    // Selo na aba "Links e checkouts" e o passo do "Próximos passos" abrindo o link.
    const links = await listOfferLinks(offerId);
    expect(links.map((l) => [l.label, l.fromClone])).toEqual([
      ["Checkout Hotmart", true],
      ["Meu checkout", false],
      ["Pagamento", false],
    ]);
    const readiness = await getOfferReadiness({ id: offerId, liveUrl: null, links });
    // Os botões do modelo ainda estão sem link: o passo do checkout pede isso primeiro.
    expect(readiness.items.find((i) => i.id === "checkout")?.title).toBe("Ligar os botões de compra");
    const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId } } });
    await prisma.pageDocument.update({
      where: { id: doc.id },
      data: { html: (doc.html ?? "").replaceAll('data-os-link=""', `data-os-link="${hotmart.key}"`) },
    });
    const after = await getOfferReadiness({ id: offerId, liveUrl: null, links });
    expect(after.items.find((i) => i.id === "checkout")).toMatchObject({
      title: "Trocar o checkout da página original",
      cta: "Abrir o link",
      target: { link: hotmart.id },
    });
  });

  it("o ZIP gerado também avisa (primeiro da lista)", async () => {
    const { exportId } = await startExport(offerId, {});
    await claimNextExport();
    await runExportJob(exportId);
    const row = await prisma.export.findUniqueOrThrow({ where: { id: exportId } });
    expect(row.status).toBe("DONE");
    expect((row.warnings as string[])[0]).toContain(
      "O link “Checkout Hotmart” ainda leva ao checkout da página que você clonou",
    );
  });

  it("com o endereço trocado, nada de aviso nem selo", async () => {
    const hotmart = (await listOfferLinks(offerId)).find((l) => l.label === "Checkout Hotmart");
    await updateOfferLink(hotmart?.id ?? "", { url: "https://pay.hotmart.com/MEU0000000?off=meu" });
    const plan = await exportPlan(offerId);
    expect(plan.warnings.join("\n")).not.toContain("página que você clonou");
    expect(plan.clonedCheckoutLinks).toBeUndefined();
    expect((await listOfferLinks(offerId)).some((l) => l.fromClone)).toBe(false);
  });
});

describe("links de Política, Termos e Contato do rodapé dos modelos", () => {
  it("o plano do ZIP avisa e abre a página no editor; ligados, o aviso some", async () => {
    const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId } } });
    const plan = await exportPlan(offerId);
    const warning = plan.warnings.find((w) => w.includes("links de páginas legais e de contato"));
    expect(warning).toContain("na página “Página principal” não levam a lugar nenhum");
    expect(warning).toContain("“Política de privacidade”, “Termos de uso” e “Contato”");
    expect(plan.legalLinkPages).toEqual([{ name: "Página principal", documentId: doc.id }]);
    // Passo opcional do "Próximos passos".
    const readiness = await getOfferReadiness({ id: offerId, liveUrl: null, links: await listOfferLinks(offerId) });
    expect(readiness.items.find((i) => i.id === "links-legais")).toMatchObject({
      optional: true,
      target: { editor: doc.id },
    });

    // A pessoa liga cada link (página do funil, endereço).
    const terms = await prisma.page.create({
      data: { offerId, name: "Termos", slug: "termos", type: "LEGAL", position: 1, isHome: false },
    });
    const html = (doc.html ?? "")
      .replace(
        '<a href="#">Política de privacidade</a>',
        `<a href="${internalLink(terms.id)}">Política de privacidade</a>`,
      )
      .replace('<a href="#">Termos de uso</a>', `<a href="${internalLink(terms.id)}">Termos de uso</a>`)
      .replace('<a href="#">Contato</a>', '<a href="mailto:oi@loja.com">Contato</a>');
    expect(html).not.toBe(doc.html);
    await prisma.pageDocument.update({ where: { id: doc.id }, data: { html } });
    const fixed = await exportPlan(offerId);
    // O "Ao se inscrever… Política de privacidade" só existe no modelo de captura: sobra nada aqui.
    expect(fixed.warnings.join("\n")).not.toContain("links de páginas legais");
    expect(fixed.warnings.join("\n")).not.toMatch(/O link “[^”]+” da página “Página principal” não leva/);
    expect(fixed.legalLinkPages).toBeUndefined();
  });
});

describe("idioma das páginas × moeda", () => {
  it("oferta em peso mexicano com o modelo em português: passo opcional; escolhido o idioma, some", async () => {
    const offer = await createOffer({ name: "Oferta México", templateId: "vendas-longa", currency: "MXN" });
    const readiness = await getOfferReadiness({ id: offer.id, liveUrl: null, links: [] });
    expect(readiness.items.find((i) => i.id === "idioma")).toMatchObject({
      optional: true,
      target: { setting: "idioma" },
    });
    expect(readiness.items.find((i) => i.id === "idioma")?.detail).toContain("roda em peso mexicano");
    await prisma.offer.update({ where: { id: offer.id }, data: { settings: { currency: "MXN", language: "es" } } });
    const after = await getOfferReadiness({ id: offer.id, liveUrl: null, links: [] });
    expect(after.items.find((i) => i.id === "idioma")).toBeUndefined();
    // Oferta em real: nunca.
    const brl = await createOffer({ name: "Oferta Brasil", templateId: "vendas-longa", currency: "BRL" });
    expect(
      (await getOfferReadiness({ id: brl.id, liveUrl: null, links: [] })).items.some((i) => i.id === "idioma"),
    ).toBe(false);
  });
});
