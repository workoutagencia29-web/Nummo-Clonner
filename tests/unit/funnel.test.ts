/**
 * Funil em 1 clique "Quiz → Roleta" (Fase 2B), no serviço e no banco: cria as
 * páginas Quiz e Roleta já ligadas (quiz → roleta → vendas), um link de
 * checkout por prêmio (vazio quando a pessoa deixou em branco), põe o quiz como
 * página inicial e as duas na ordem do funil antes da página de vendas. Tudo
 * numa transação: um erro no meio não deixa nada pela metade. Avisa antes de
 * criar outro funil numa oferta que já tem quiz/roleta. Depois, o "Próximos
 * passos" e o ZIP enxergam a roleta como qualquer outra.
 */
import * as cheerio from "cheerio";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  defaultSalesPage,
  existingFunnelWarning,
  FUNNEL_PRIZES,
  nextPrize,
  prizeProblems,
  quotedList,
} from "@/lib/funnel";
import { internalLink } from "@/lib/internal-links";
import { parseSlices } from "@/lib/wheel";
import { wheelPrizeMap } from "@/lib/wheel-prizes";
import { exportPlan } from "@/server/services/export/plan";
import { createQuizWheelFunnel, existingFunnel } from "@/server/services/funnel";
import { createOfferLink, linkUsageDetail, listOfferLinks, updateOfferLink } from "@/server/services/offer-links";
import { createOffer } from "@/server/services/offers";
import { createPage } from "@/server/services/pages";
import { getOfferReadiness } from "@/server/services/readiness";
import { resetDatabase } from "../setup/per-file";
import { expectUserError } from "./helpers";

/** Falha de propósito no meio da transação (depois de criar links e páginas). */
const failHome = vi.hoisted(() => ({ on: false }));
vi.mock("@/server/services/pages", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/services/pages")>();
  return {
    ...real,
    setHomePage: async (...args: Parameters<typeof real.setHomePage>) => {
      if (failHome.on) throw new Error("falha simulada");
      return real.setHomePage(...args);
    },
  };
});

beforeEach(async () => {
  failHome.on = false;
  await resetDatabase();
});

const prizes = () => FUNNEL_PRIZES.map((p) => ({ ...p }));

function pagesOf(offerId: string) {
  return prisma.page.findMany({
    where: { offerId },
    orderBy: { position: "asc" },
    select: { id: true, name: true, slug: true, type: true, isHome: true, position: true },
  });
}

async function htmlOf(pageId: string) {
  const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId } } });
  return doc.html ?? "";
}

/** Oferta com a página de vendas (modelo) como inicial e uma página de obrigado. */
async function salesOffer() {
  const offer = await createOffer({ name: "Curso", templateId: "vendas-longa" });
  const [sales] = await pagesOf(offer.id);
  await createPage({ offerId: offer.id, name: "Obrigado", templateId: "obrigado" });
  return { offerId: offer.id, salesId: sales.id };
}

describe("createQuizWheelFunnel", () => {
  it("cria quiz e roleta ligados, um link por prêmio, e o quiz vira a página inicial", async () => {
    const { offerId, salesId } = await salesOffer();
    const input = prizes();
    input[0].url = "pay.hotmart.com/ABC123?off=dez";
    input[2].url = "https://pay.kiwify.com.br/xyz30";
    input[2].coupon = "  Roleta30 ";
    input[3].chance = 0;

    const result = await createQuizWheelFunnel({ offerId, salesPageId: salesId, prizes: input });

    // Ordem: Quiz → Roleta → página de vendas → Obrigado; o quiz é a inicial.
    const pages = await pagesOf(offerId);
    expect(pages.map((p) => [p.name, p.slug, p.isHome, p.position])).toEqual([
      ["Quiz", "quiz", true, 0],
      ["Roleta", "roleta", false, 1],
      ["Página principal", "principal", false, 2],
      ["Obrigado", "obrigado", false, 3],
    ]);
    expect(pages[0].type).toBe("QUIZ");
    expect(pages[1].type).toBe("OTHER");
    expect(result).toMatchObject({
      quiz: { id: pages[0].id, name: "Quiz", slug: "quiz" },
      wheel: { id: pages[1].id, name: "Roleta", slug: "roleta" },
      sales: { id: salesId, name: "Página principal", slug: "principal" },
      missingUrls: ["20% OFF", "50% OFF"],
      salesHasCheckoutButtons: false,
    });
    const quizDoc = await prisma.pageDocument.findUniqueOrThrow({ where: { id: result.quiz.documentId } });
    expect(quizDoc.variantId).toBeTruthy();
    expect(quizDoc.html).toContain('data-os-widget="quiz"');

    // Links da oferta: um checkout por prêmio, com o nome do prêmio (vazio quando ficou em branco).
    const links = await listOfferLinks(offerId);
    expect(links.map((l) => [l.label, l.url, l.kind])).toEqual([
      ["Checkout 10% OFF", "https://pay.hotmart.com/ABC123?off=dez", "CHECKOUT"],
      ["Checkout 20% OFF", "", "CHECKOUT"],
      ["Checkout 30% OFF", "https://pay.kiwify.com.br/xyz30", "CHECKOUT"],
      ["Checkout 50% OFF", "", "CHECKOUT"],
    ]);

    // Quiz: o botão final leva à roleta (sem pedir destino).
    const $q = cheerio.load(await htmlOf(result.quiz.id));
    expect($q("[data-os-qz-go]").attr("href")).toBe(internalLink(result.wheel.id));
    expect($q("[data-os-qz-go]").attr("data-os-link")).toBeUndefined();
    expect($q("title").text()).toBe("Quiz");

    // Roleta: fatias ligadas aos links, cupom, chance mínima de 1%, "Resgatar" → página de vendas.
    const wheelHtml = await htmlOf(result.wheel.id);
    const $w = cheerio.load(wheelHtml);
    const slices = parseSlices($w('[data-os-widget="wheel"]').attr("data-os-slices"));
    expect(slices.map((s) => [s.text, s.chance, s.link, s.coupon])).toEqual([
      ["10% OFF", 40, links[0].key, ""],
      ["20% OFF", 30, links[1].key, ""],
      ["30% OFF", 20, links[2].key, "Roleta30"],
      ["50% OFF", 1, links[3].key, ""],
    ]);
    expect(new Set(slices.map((s) => s.color)).size).toBe(4);
    expect($w("[data-os-wh-go]").attr("href")).toBe(internalLink(salesId));
    expect($w("[data-os-wh-go]").attr("data-os-link")).toBeUndefined();
    // A roda, o prêmio e o cupom de exemplo saem das fatias novas.
    expect($w("[data-os-wh-disc] svg").length).toBe(1);
    expect($w("[data-os-wh-disc]").text()).toContain("50% OFF");
    expect($w("[data-os-wh-code]").text()).toBe("Roleta30");
    expect(wheelHtml.startsWith("<!DOCTYPE html>") || wheelHtml.startsWith("<!doctype html>")).toBe(true);

    // Só os prêmios com endereço entram no mapa da página de vendas.
    const map = wheelPrizeMap([wheelHtml], links);
    expect(Object.values(map).map((p) => [p.t, p.u, p.c])).toEqual([
      ["10% OFF", "https://pay.hotmart.com/ABC123?off=dez", ""],
      ["30% OFF", "https://pay.kiwify.com.br/xyz30", "Roleta30"],
    ]);

    // A página de vendas não foi mexida.
    expect(await htmlOf(salesId)).not.toContain("os-page:");
  });

  it("“Próximos passos” e ZIP: prêmio com link sem endereço leva à aba dos links; preenchido, fica pronto", async () => {
    const { offerId, salesId } = await salesOffer();
    await createQuizWheelFunnel({ offerId, salesPageId: salesId, prizes: prizes() });

    let links = await listOfferLinks(offerId);
    let item = (await getOfferReadiness({ id: offerId, liveUrl: null, links })).items.find((i) => i.id === "roleta");
    expect(item).toMatchObject({ done: false, cta: "Abrir links", target: { tab: "links" } });
    expect(item?.detail).toContain("Cole o endereço do checkout de cada prêmio em Links e checkouts.");

    // O ZIP avisa do prêmio sem link, mas não do "Resgatar" nem do botão final do quiz (já têm destino).
    const plan = await exportPlan(offerId);
    expect(plan.warnings.some((w) => w.startsWith("Roleta com prêmio sem link de checkout"))).toBe(true);
    expect(plan.warnings.some((w) => w.includes("da roleta da página"))).toBe(false);
    expect(plan.warnings.some((w) => w.includes("quiz"))).toBe(false);

    for (const [i, link] of links.entries()) {
      await updateOfferLink(link.id, { url: `https://pay.hotmart.com/P${i}` });
    }
    links = await listOfferLinks(offerId);
    item = (await getOfferReadiness({ id: offerId, liveUrl: null, links })).items.find((i) => i.id === "roleta");
    // Os botões de compra da página de vendas ainda não estão ligados a um checkout: o prêmio não chega a eles.
    expect(item).toMatchObject({
      done: false,
      title: "Levar o prêmio da roleta aos botões de compra",
      target: { tab: "links" },
    });
    const checkout = await createOfferLink(offerId, {
      label: "Checkout principal",
      url: "https://pay.hotmart.com/CHEIO",
      kind: "CHECKOUT",
    });
    const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId: salesId } } });
    await prisma.pageDocument.update({
      where: { id: doc.id },
      data: { html: (doc.html ?? "").replaceAll('data-os-link=""', `data-os-link="${checkout.key}"`) },
    });
    links = await listOfferLinks(offerId);
    item = (await getOfferReadiness({ id: offerId, liveUrl: null, links })).items.find((i) => i.id === "roleta");
    expect(item).toMatchObject({ done: true, title: "Prêmios da roleta ligados" });
    const after = await exportPlan(offerId);
    expect(after.warnings.some((w) => w.startsWith("Roleta com prêmio"))).toBe(false);
  });

  it("aba Links e checkouts: os links dos prêmios contam como prêmio da roleta, não como botão", async () => {
    const { offerId, salesId } = await salesOffer();
    await createQuizWheelFunnel({ offerId, salesPageId: salesId, prizes: prizes() });
    const links = await listOfferLinks(offerId);
    const usage = await linkUsageDetail(offerId);
    for (const l of links) {
      expect(usage.buttons.get(l.key)).toBeUndefined();
      expect(usage.prizes.get(l.key)).toBe(1);
    }
  });

  it("página de vendas com botões ligados ao checkout: avisa que eles levam ao checkout do prêmio", async () => {
    const { offerId, salesId } = await salesOffer();
    const checkout = await createOfferLink(offerId, {
      label: "Checkout principal",
      url: "https://pay.hotmart.com/CHEIO",
      kind: "CHECKOUT",
    });
    const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId: salesId } } });
    await prisma.pageDocument.update({
      where: { id: doc.id },
      data: { html: (doc.html ?? "").replaceAll('data-os-link=""', `data-os-link="${checkout.key}"`) },
    });
    const result = await createQuizWheelFunnel({ offerId, salesPageId: salesId, prizes: prizes() });
    expect(result.salesHasCheckoutButtons).toBe(true);
    // O link que já existia continua o primeiro; os dos prêmios vêm depois.
    expect((await listOfferLinks(offerId)).map((l) => l.label)).toEqual([
      "Checkout principal",
      "Checkout 10% OFF",
      "Checkout 20% OFF",
      "Checkout 30% OFF",
      "Checkout 50% OFF",
    ]);
  });

  it("página de vendas no meio do funil: quiz e roleta entram logo antes dela; a inicial muda para o quiz", async () => {
    const offer = await createOffer({ name: "Advertorial", templateId: "advertorial" });
    const sales = await createPage({ offerId: offer.id, name: "Vendas", templateId: "vendas-longa" });
    await createPage({ offerId: offer.id, name: "Upsell", templateId: "upsell" });
    const result = await createQuizWheelFunnel({
      offerId: offer.id,
      salesPageId: sales.id,
      prizes: prizes().slice(0, 2),
    });
    const pages = await pagesOf(offer.id);
    expect(pages.map((p) => [p.name, p.isHome])).toEqual([
      ["Página principal", false],
      ["Quiz", true],
      ["Roleta", false],
      ["Vendas", false],
      ["Upsell", false],
    ]);
    expect(result.sales.slug).toBe("vendas");
  });

  it("oferta que já tem quiz ou roleta: pede confirmação; confirmado, cria “Quiz 2”/“Roleta 2” e links novos", async () => {
    const { offerId, salesId } = await salesOffer();
    expect(await existingFunnel(offerId)).toEqual({ quiz: [], wheel: [] });
    await createQuizWheelFunnel({ offerId, salesPageId: salesId, prizes: prizes() });
    const existing = await existingFunnel(offerId);
    expect(existing.quiz.map((p) => p.name)).toEqual(["Quiz"]);
    expect(existing.wheel.map((p) => p.name)).toEqual(["Roleta"]);

    const before = await prisma.page.count({ where: { offerId } });
    await expectUserError(
      createQuizWheelFunnel({ offerId, salesPageId: salesId, prizes: prizes() }),
      "Esta oferta já tem um quiz (página “Quiz”). Confirme para criar outro funil.",
    );
    expect(await prisma.page.count({ where: { offerId } })).toBe(before);

    const again = await createQuizWheelFunnel({ offerId, salesPageId: salesId, prizes: prizes(), allowExisting: true });
    expect(again.quiz).toMatchObject({ name: "Quiz 2", slug: "quiz-2" });
    expect(again.wheel).toMatchObject({ name: "Roleta 2", slug: "roleta-2" });
    const labels = (await listOfferLinks(offerId)).map((l) => l.label);
    expect(labels).toContain("Checkout 10% OFF 2");
    expect(new Set((await listOfferLinks(offerId)).map((l) => l.key)).size).toBe(8);
    // O quiz novo é a inicial e leva à roleta nova.
    const home = await prisma.page.findFirstOrThrow({ where: { offerId, isHome: true } });
    expect(home.id).toBe(again.quiz.id);
    expect(await htmlOf(again.quiz.id)).toContain(internalLink(again.wheel.id));
  });

  it("erros em pt-BR, no campo certo, sem criar nada", async () => {
    const { offerId, salesId } = await salesOffer();
    const other = await createOffer({ name: "Outra" });
    const [otherPage] = await pagesOf(other.id);
    const count = async () => ({
      pages: await prisma.page.count({ where: { offerId } }),
      links: await prisma.offerLink.count({ where: { offerId } }),
    });
    const start = await count();

    const bad = prizes();
    bad[1].url = "pay.kiwify";
    await expectUserError(
      createQuizWheelFunnel({ offerId, salesPageId: salesId, prizes: bad }),
      "Prêmio 2: O endereço parece incompleto: faltou o final depois de “kiwify” (ex.: https://pay.kiwify.com.br/…). Copie o link inteiro do checkout.",
      "prizes.1.url",
    );
    const mail = prizes();
    mail[0].url = "mailto:eu@exemplo.com";
    await expectUserError(
      createQuizWheelFunnel({ offerId, salesPageId: salesId, prizes: mail }),
      "Prêmio 1: Cole o link do checkout com o desconto (https://…).",
      "prizes.0.url",
    );
    const blank = prizes();
    blank[3].text = "  ";
    await expectUserError(
      createQuizWheelFunnel({ offerId, salesPageId: salesId, prizes: blank }),
      "Prêmio 4: Escreva o prêmio (ex.: 30% OFF).",
      "prizes.3.text",
    );
    await expectUserError(
      createQuizWheelFunnel({ offerId, salesPageId: salesId, prizes: prizes().slice(0, 1) }),
      "A roleta precisa de pelo menos 2 prêmios.",
      "prizes",
    );
    await expectUserError(
      createQuizWheelFunnel({ offerId, salesPageId: otherPage.id, prizes: prizes() }),
      "A página de vendas escolhida não existe mais nesta oferta. Recarregue a tela.",
      "salesPageId",
    );
    await expectUserError(
      createQuizWheelFunnel({ offerId: "nao-existe", salesPageId: salesId, prizes: prizes() }),
      "Oferta não encontrada.",
    );
    expect(await count()).toEqual(start);
  });

  it("falha no meio (depois de criar links e páginas): a transação desfaz tudo", async () => {
    const { offerId, salesId } = await salesOffer();
    const before = await pagesOf(offerId);
    failHome.on = true;
    await expect(createQuizWheelFunnel({ offerId, salesPageId: salesId, prizes: prizes() })).rejects.toThrow(
      "falha simulada",
    );
    expect(await pagesOf(offerId)).toEqual(before);
    expect(await prisma.offerLink.count({ where: { offerId } })).toBe(0);
  });
});

describe("regras da janela (src/lib/funnel.ts)", () => {
  it("prêmio novo, problemas da linha e avisos", () => {
    expect(nextPrize(FUNNEL_PRIZES)).toEqual({ text: "5% OFF", chance: 10, url: "", coupon: "" });
    expect(nextPrize([{ text: "5% off" }]).text).toBe("15% OFF");
    expect(prizeProblems({ text: "30% OFF", url: "" })).toEqual({});
    expect(prizeProblems({ text: "30% OFF", url: "pay.hotmart.com/X1" })).toEqual({});
    expect(prizeProblems({ text: "", url: "tel:123" })).toEqual({
      text: "Escreva o prêmio (ex.: 30% OFF).",
      url: "Cole o link do checkout com o desconto (https://…).",
    });
    expect(quotedList(["a", "b", "c", "d"])).toBe("“a”, “b”, “c” e mais 1");
    expect(quotedList(["a", "b"])).toBe("“a” e “b”");
    expect(existingFunnelWarning({ quiz: [], wheel: [] })).toBeNull();
    const pages = [
      { id: "q", isHome: true, type: "QUIZ" },
      { id: "r", isHome: false, type: "OTHER" },
      { id: "up", isHome: false, type: "UPSELL" },
      { id: "v", isHome: false, type: "SALES" },
    ];
    expect(defaultSalesPage(pages, [])).toBe("q");
    expect(defaultSalesPage(pages, ["q", "r"])).toBe("v");
    expect(defaultSalesPage(pages.slice(0, 3), ["q", "r"])).toBe("up");
    expect(defaultSalesPage(pages.slice(0, 2), ["q", "r"])).toBe("q");
    expect(existingFunnelWarning({ quiz: ["Quiz"], wheel: ["Roleta", "Roleta 2"] })).toBe(
      "Esta oferta já tem um quiz (página “Quiz”) e roletas (páginas “Roleta” e “Roleta 2”). Continuar cria mais um quiz e mais uma roleta, e o quiz novo vira a página inicial.",
    );
  });
});
