/**
 * Funil de upsell — serviço com banco (src/server/services/upsell): salvar liga
 * o thankYouPageId em cadeia (produto principal → upsell 1 → upsell 2 →
 * obrigado) e os botões SIM/Não das páginas; duplicar a oferta remapeia as
 * páginas do funil.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createOffer, duplicateOffer } from "@/server/services/offers";
import { createPage } from "@/server/services/pages";
import {
  createUpsellPage,
  getUpsellFlow,
  saveUpsellFlow,
  upsellPanel,
  wireUpsellButtons,
} from "@/server/services/upsell";
import { resetDatabase } from "../setup/per-file";

beforeEach(resetDatabase);

const BTN_HTML =
  '<!DOCTYPE html><html><body><a href="#" class="os-btn" data-os-link="">SIM</a><a href="#" class="os-decline">Não</a></body></html>';

/** Link de checkout com produto salvo. */
async function checkoutLink(offerId: string, key: string, name: string) {
  return prisma.offerLink.create({
    data: {
      offerId,
      key,
      label: name,
      url: "",
      kind: "CHECKOUT",
      target: "CHECKOUT",
      checkout: {
        create: { provider: "FLEVOPAY", name, amountCents: 9700, currency: "BRL", methods: ["PIX"], locale: "PT" },
      },
    },
    select: { id: true, key: true },
  });
}

/** Página com os botões do modelo de upsell. */
async function upsellPage(offerId: string, name: string, type: "UPSELL" | "DOWNSELL" | "THANK_YOU") {
  const page = await createPage({ offerId, name, type });
  await prisma.pageDocument.updateMany({ where: { variant: { pageId: page.id } }, data: { html: BTN_HTML } });
  return page;
}

describe("createUpsellPage", () => {
  it("cria a página do modelo com os botões SIM/Não prontos", async () => {
    const { id: offerId } = await createOffer({ name: "Funil", currency: "BRL" });
    const up = await createUpsellPage(offerId, "UPSELL");
    expect(up.type).toBe("UPSELL");
    expect(up.name).toBe("Upsell");
    const html = (await prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId: up.id } } })).html ?? "";
    expect(html).toContain('data-os-link=""'); // SIM, pronto para ligar
    expect(html).toContain("os-decline"); // Não, pronto para virar os-page
    // Depois de ligar funciona de ponta a ponta.
    const wired = wireUpsellButtons(html, "meu-upsell", "pagina-x");
    expect(wired).toContain('data-os-link="meu-upsell"');
    expect(wired).toContain("os-page:pagina-x");
  });

  it("numera o nome quando já existe ('Upsell', 'Upsell 2') e cria downsell/obrigado", async () => {
    const { id: offerId } = await createOffer({ name: "Funil", currency: "BRL" });
    const a = await createUpsellPage(offerId, "UPSELL");
    const b = await createUpsellPage(offerId, "UPSELL");
    expect(a.name).toBe("Upsell");
    expect(b.name).toBe("Upsell 2");
    const down = await createUpsellPage(offerId, "DOWNSELL");
    const obg = await createUpsellPage(offerId, "THANK_YOU");
    expect(down.type).toBe("DOWNSELL");
    expect(obg.type).toBe("THANK_YOU");
  });
});

describe("upsellPanel (autoWire: página-modelo × clonada)", () => {
  it("marca autoWire nas páginas do modelo (os-decline) e não nas clonadas", async () => {
    const { id: offerId } = await createOffer({ name: "Funil", currency: "BRL" });
    const tpl = await createUpsellPage(offerId, "UPSELL"); // modelo: tem o botão "Não"
    const clone = await createPage({ offerId, name: "Upsell clonado", type: "UPSELL" });
    await prisma.pageDocument.updateMany({
      where: { variant: { pageId: clone.id } },
      data: { html: '<!DOCTYPE html><html><body><a class="comprar">Sim</a><a>Não</a></body></html>' },
    });
    const panel = await upsellPanel(offerId);
    const byId = new Map(panel.pages.map((p) => [p.id, p]));
    expect(byId.get(tpl.id)?.autoWire).toBe(true);
    expect(byId.get(clone.id)?.autoWire).toBe(false);
  });
});

describe("wireUpsellButtons", () => {
  it("liga o SIM (data-os-link) e o Não (os-page)", () => {
    const out = wireUpsellButtons(BTN_HTML, "oferta-u1", "pag123");
    expect(out).toContain('data-os-link="oferta-u1"');
    expect(out).toContain("os-page:pag123");
    expect(out).toContain('class="os-decline"');
  });

  it("sem destino: SIM vazio e Não vira # (sem os-page)", () => {
    const out = wireUpsellButtons(BTN_HTML, null, null);
    expect(out).toContain('data-os-link=""');
    expect(out).not.toContain("os-page:");
  });
});

describe("saveUpsellFlow", () => {
  it("encadeia o thankYou dos produtos e liga os botões das páginas", async () => {
    const { id: offerId } = await createOffer({ name: "Funil", currency: "BRL" });
    const [main, l1, l2] = await Promise.all([
      checkoutLink(offerId, "principal", "Produto principal"),
      checkoutLink(offerId, "up1", "Upsell 1"),
      checkoutLink(offerId, "up2", "Upsell 2"),
    ]);
    const [p1, p2, obg] = await Promise.all([
      upsellPage(offerId, "Upsell 1", "UPSELL"),
      upsellPage(offerId, "Upsell 2", "UPSELL"),
      upsellPage(offerId, "Obrigado", "THANK_YOU"),
    ]);

    await saveUpsellFlow(offerId, {
      startLinkKey: main.key,
      thankYouPageId: obg.id,
      steps: [
        { id: "s1", kind: "UPSELL", pageId: p1.id, linkKey: l1.key },
        { id: "s2", kind: "UPSELL", pageId: p2.id, linkKey: l2.key },
      ],
    });

    // Guardou o funil.
    const saved = await getUpsellFlow(offerId);
    expect(saved.startLinkKey).toBe("principal");
    expect(saved.steps.map((s) => s.pageId)).toEqual([p1.id, p2.id]);

    // thankYou em cadeia: principal → upsell1 → upsell2 → obrigado.
    const thanks = async (linkId: string) =>
      (await prisma.checkoutProduct.findUniqueOrThrow({ where: { linkId } })).thankYouPageId;
    expect(await thanks(main.id)).toBe(p1.id);
    expect(await thanks(l1.id)).toBe(p2.id);
    expect(await thanks(l2.id)).toBe(obg.id);

    // Botões ligados: na página do upsell 1, SIM = checkout up1, Não = próxima (upsell 2).
    const html1 = (await prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId: p1.id } } })).html ?? "";
    expect(html1).toContain('data-os-link="up1"');
    expect(html1).toContain(`href="os-page:${p2.id}"`);
    // Upsell 2: Não leva ao obrigado.
    const html2 = (await prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId: p2.id } } })).html ?? "";
    expect(html2).toContain('data-os-link="up2"');
    expect(html2).toContain(`href="os-page:${obg.id}"`);
  });

  it("downsell atrelado: recusar o upsell vai para o downsell", async () => {
    const { id: offerId } = await createOffer({ name: "Funil", currency: "BRL" });
    const [main, l1, ld] = await Promise.all([
      checkoutLink(offerId, "principal", "Principal"),
      checkoutLink(offerId, "up1", "Upsell 1"),
      checkoutLink(offerId, "dn1", "Downsell 1"),
    ]);
    const [p1, pd, obg] = await Promise.all([
      upsellPage(offerId, "Upsell 1", "UPSELL"),
      upsellPage(offerId, "Downsell 1", "DOWNSELL"),
      upsellPage(offerId, "Obrigado", "THANK_YOU"),
    ]);
    await saveUpsellFlow(offerId, {
      startLinkKey: main.key,
      thankYouPageId: obg.id,
      steps: [
        { id: "s1", kind: "UPSELL", pageId: p1.id, linkKey: l1.key },
        { id: "d1", kind: "DOWNSELL", pageId: pd.id, linkKey: ld.key, attachedTo: "s1" },
      ],
    });
    // Upsell 1: Não leva ao downsell (não ao obrigado).
    const html1 = (await prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId: p1.id } } })).html ?? "";
    expect(html1).toContain(`href="os-page:${pd.id}"`);
    // Downsell: Não leva ao obrigado (próxima etapa do upsell = fim).
    const htmlD = (await prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId: pd.id } } })).html ?? "";
    expect(htmlD).toContain(`href="os-page:${obg.id}"`);
  });

  it("limpa referência a página/link de fora da oferta", async () => {
    const { id: offerId } = await createOffer({ name: "Funil", currency: "BRL" });
    const l1 = await checkoutLink(offerId, "up1", "Upsell 1");
    const p1 = await upsellPage(offerId, "Upsell 1", "UPSELL");
    await saveUpsellFlow(offerId, {
      startLinkKey: "naoexiste",
      thankYouPageId: "paginafora",
      steps: [{ id: "s1", kind: "UPSELL", pageId: p1.id, linkKey: l1.key }],
    });
    const saved = await getUpsellFlow(offerId);
    expect(saved.startLinkKey).toBeNull(); // link de fora
    expect(saved.thankYouPageId).toBeNull(); // página de fora
    expect(saved.steps[0].pageId).toBe(p1.id); // esta é da oferta
  });

  it("duplicar a oferta remapeia as páginas do funil (os linkKey ficam)", async () => {
    const { id: offerId } = await createOffer({ name: "Funil", currency: "BRL" });
    const [main, l1] = await Promise.all([
      checkoutLink(offerId, "principal", "Principal"),
      checkoutLink(offerId, "up1", "Upsell 1"),
    ]);
    const [p1, obg] = await Promise.all([
      upsellPage(offerId, "Upsell 1", "UPSELL"),
      upsellPage(offerId, "Obrigado", "THANK_YOU"),
    ]);
    await saveUpsellFlow(offerId, {
      startLinkKey: main.key,
      thankYouPageId: obg.id,
      steps: [{ id: "s1", kind: "UPSELL", pageId: p1.id, linkKey: l1.key }],
    });
    const copy = await duplicateOffer(offerId);
    const copyFlow = await getUpsellFlow(copy.id);
    // Os linkKey são estáveis; as páginas apontam para as da CÓPIA.
    expect(copyFlow.startLinkKey).toBe("principal");
    expect(copyFlow.steps[0].linkKey).toBe("up1");
    expect(copyFlow.steps[0].pageId).not.toBe(p1.id);
    expect(copyFlow.steps[0].pageId).toBeTruthy();
    const copyPages = await prisma.page.findMany({ where: { offerId: copy.id }, select: { id: true } });
    const ids = new Set(copyPages.map((p) => p.id));
    expect(ids.has(copyFlow.steps[0].pageId as string)).toBe(true);
    expect(ids.has(copyFlow.thankYouPageId as string)).toBe(true);
  });
});
