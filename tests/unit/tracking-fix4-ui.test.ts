/**
 * Fase 4 — correções da revisão nas telas "Pixels e rastreamento" e "Empresa e
 * SEO", num Chromium de verdade (tests/unit/tracking-ui-harness.ts) com as
 * server actions e o banco de teste:
 *
 * - código livre "Essencial" com pixel colado: aviso, "Esperar o Aceitar" em um
 *   clique e selo no resumo; sem escolha, o automático;
 * - regras recomendadas: só as que faltam e "Não sugerir mais";
 * - UTMify: um pixel por oferta (sem "Outro pixel", selo no pixel que não carrega);
 * - Privacidade: páginas sem o link "Preferências de cookies", layout pela
 *   largura do painel (janela de 1280 px);
 * - celular: as cinco partes visíveis, setas na horizontal;
 * - "Empresa e SEO": título da própria página quando o SEO está vazio.
 */
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/api", () => ({ guardApi: vi.fn(async () => null) }));

import { prisma } from "@/lib/db";
import { explicitPageCodeCategory, parseTrackingSettings } from "@/lib/tracking/schema";
import { createOffer } from "@/server/services/offers";
import { savePageCode } from "@/server/services/page-code";
import { createPage } from "@/server/services/pages";
import { createEventRule, createPixel, savePageCodeCategory } from "@/server/services/tracking";
import { resetDatabase } from "../setup/per-file";
import { choose, openPanel, panelBundle, panelCss, type Session, waitToast } from "./tracking-ui-harness";

const META_BASE =
  "<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){};t=b.createElement(e);t.src=v;b.head.appendChild(t)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','123456789012345');fbq('track','PageView');</script>";
const GTAG =
  '<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123DEF4"></script><script>gtag("config","G-ABC123DEF4")</script>';

let browser: Browser;
const sessions: Session[] = [];

beforeAll(async () => {
  await Promise.all([panelBundle(), panelCss()]);
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  for (const s of sessions) await s.page.close().catch(() => undefined);
  await browser?.close();
});

beforeEach(async () => {
  await resetDatabase();
});

async function open(kind: Parameters<typeof openPanel>[1], offerId: string, props?: Record<string, unknown>) {
  const s = await openPanel(browser, kind, offerId, props);
  sessions.push(s);
  return s;
}

async function offerFixture() {
  const offer = await createOffer({ name: "Oferta Revisão" });
  const home = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id, isHome: true } });
  const legal = await createPage({ offerId: offer.id, name: "Política de privacidade", type: "LEGAL" });
  return { offerId: offer.id, homeId: home.id, legalId: legal.id };
}

async function tracking(offerId: string) {
  return parseTrackingSettings((await prisma.offer.findUniqueOrThrow({ where: { id: offerId } })).tracking);
}

const summary = (s: Session) => s.page.getByRole("list", { name: "Resumo" });

describe("código livre com pixel", () => {
  it("página: automático explica; 'Essencial' com pixel avisa e 'Esperar o Aceitar' salva Marketing em um clique", async () => {
    const { offerId, homeId } = await offerFixture();
    await savePageCode(homeId, { head: META_BASE });
    const s = await open("tracking", offerId, { initialSection: "codigo" });
    const p = s.page;
    const rows = p.getByRole("list", { name: "Código das páginas" });
    // Sem escolha: o código tem pixel, então espera o "Aceitar" sozinho (Marketing).
    await rows
      .getByText("Automático: o código tem Meta Pixel, então espera o “Aceitar” do aviso de cookies.")
      .waitFor();
    expect(await summary(s).textContent()).not.toContain("carrega antes");

    await choose(p, /Quando carrega o código da página Página principal/, "Essencial (carrega sempre)");
    await waitToast(s, "O código da página “Página principal” carrega sempre.");
    expect(explicitPageCodeCategory((await prisma.page.findUniqueOrThrow({ where: { id: homeId } })).customCode)).toBe(
      "NECESSARY",
    );
    const warning = "Este código tem Meta Pixel e carrega antes do “Aceitar” do aviso de cookies";
    await rows.getByText(warning, { exact: false }).waitFor();
    await summary(s).getByText("Código livre com pixel carrega antes do “Aceitar”").waitFor();
    await p
      .getByRole("tab", { name: /Código livre/ })
      .getByLabel("Precisa de atenção")
      .waitFor();

    await rows.getByRole("button", { name: "Esperar o “Aceitar”" }).click();
    await waitToast(s, "O código da página “Página principal” espera o “Aceitar” do aviso de cookies.");
    expect(explicitPageCodeCategory((await prisma.page.findUniqueOrThrow({ where: { id: homeId } })).customCode)).toBe(
      "MARKETING",
    );
    await waitForGone(() => rows.getByText(warning, { exact: false }).count());
    expect(await summary(s).textContent()).not.toContain("carrega antes");
    expect(s.errors).toEqual([]);
  });

  it("oferta: o aviso aparece enquanto digita um pixel em 'Essencial'; o botão troca para Marketing e salva", async () => {
    const { offerId } = await offerFixture();
    const s = await open("tracking", offerId, { initialSection: "codigo" });
    const p = s.page;
    await choose(p, "Quando o código carrega", "Essencial (carrega sempre)");
    await p.getByLabel("No <head>").fill("<script>window.chat = 1</script>");
    expect(await p.getByText("carrega antes do “Aceitar”", { exact: false }).count()).toBe(0);
    await p.getByLabel("No <head>").fill(GTAG);
    await p.getByText("Este código tem Google Analytics e carrega antes do “Aceitar”", { exact: false }).waitFor();
    await p.getByRole("button", { name: "Esperar o “Aceitar”" }).click();
    expect(await p.getByRole("combobox", { name: "Quando o código carrega" }).textContent()).toBe(
      "Marketing (espera o consentimento)",
    );
    expect(await p.getByText("carrega antes do “Aceitar”", { exact: false }).count()).toBe(0);
    await p.getByRole("button", { name: "Salvar código" }).click();
    await waitToast(s, "Código livre salvo.");
    expect((await tracking(offerId)).customCode).toMatchObject({ head: GTAG, category: "MARKETING" });
    expect(s.errors).toEqual([]);
  });

  it("'Só avisar' não avisa (os pixels já carregam direto) e o aviso usa o texto do botão de aceitar", async () => {
    const { offerId, homeId } = await offerFixture();
    await savePageCode(homeId, { head: META_BASE });
    await savePageCodeCategory(homeId, "NECESSARY");
    await prisma.offer.update({
      where: { id: offerId },
      data: { tracking: { consent: { mode: "OPT_IN", acceptLabel: "Concordo" } } },
    });
    let s = await open("tracking", offerId, { initialSection: "codigo" });
    await s.page.getByText("carrega antes do “Concordo”", { exact: false }).first().waitFor();
    await s.page.getByRole("button", { name: "Esperar o “Concordo”" }).waitFor();
    await s.page.close();

    await prisma.offer.update({ where: { id: offerId }, data: { tracking: { consent: { mode: "NOTICE" } } } });
    s = await open("tracking", offerId, { initialSection: "codigo" });
    await s.page.getByText("Código de cada página").waitFor();
    expect(await s.page.getByText("carrega antes do", { exact: false }).count()).toBe(0);
  });
});

describe("regras recomendadas", () => {
  it("mostra só as que faltam; 'Não sugerir mais' esconde e fica salvo", async () => {
    const { offerId } = await offerFixture();
    await createEventRule(offerId, { event: "LEAD", trigger: "FORM_SUBMIT" });
    await createEventRule(offerId, { event: "VIEW_CONTENT", trigger: "TIME_ON_PAGE", value: 15 });
    const s = await open("tracking", offerId, { initialSection: "eventos" });
    const p = s.page;
    await p.getByText("Falta uma regra recomendada").waitFor();
    const missing = p.getByRole("list", { name: "Regras recomendadas que faltam" });
    expect(await missing.getByRole("listitem").allTextContents()).toEqual([
      "InitiateCheckout ao clicar em um botão de checkout",
    ]);
    await p.getByRole("button", { name: "Não sugerir mais" }).click();
    await waitToast(s, "Pronto: as regras recomendadas não aparecem mais aqui.");
    await waitForGone(() => p.getByText("Falta uma regra recomendada").count());
    expect((await tracking(offerId)).dismissedRecommended).toBe(true);
    expect(s.errors).toEqual([]);
  });

  it("oferta sem regras: 'Comece pelos recomendados' sem o 'Não sugerir mais'", async () => {
    const { offerId } = await offerFixture();
    const s = await open("tracking", offerId, { initialSection: "eventos" });
    await s.page.getByText("Comece pelos eventos recomendados").waitFor();
    expect(
      await s.page.getByRole("list", { name: "Regras recomendadas que faltam" }).getByRole("listitem").count(),
    ).toBe(3);
    expect(await s.page.getByRole("button", { name: "Não sugerir mais" }).count()).toBe(0);
  });
});

describe("UTMify: um pixel por oferta", () => {
  it("sem 'Outro pixel' na UTMify; um segundo pixel ativo (de antes) mostra que não carrega", async () => {
    const { offerId } = await offerFixture();
    await createPixel(offerId, { vendor: "UTMIFY", pixelId: "66f1a2b3c4d5e6f7a8b9c0d1" });
    await createPixel(offerId, { vendor: "META", pixelId: "123456789012345" });
    // Pixel salvo antes da regra de um por oferta.
    await prisma.pixelConfig.create({
      data: { offerId, vendor: "UTMIFY", pixelId: "77f1a2b3c4d5e6f7a8b9c0d1", enabled: true },
    });
    const s = await open("tracking", offerId);
    const p = s.page;
    await p.getByRole("button", { name: "Adicionar outro pixel Meta" }).waitFor();
    expect(await p.getByRole("button", { name: /Adicionar outro pixel UTMify/ }).count()).toBe(0);
    const badge = p.getByText("Não carrega: a UTMify aceita um pixel por oferta");
    expect(await badge.count()).toBe(1);
    const row = p.locator("li", { has: badge });
    expect(await row.textContent()).toContain("77f1a2b3c4d5e6f7a8b9c0d1");
    expect(s.errors).toEqual([]);
  });
});

describe("Privacidade (LGPD)", () => {
  it("lista as páginas sem o link 'Preferências de cookies' (ganham o botão flutuante)", async () => {
    const { offerId, homeId } = await offerFixture();
    await prisma.pageDocument.updateMany({
      where: { variant: { pageId: homeId } },
      data: { html: '<html><body><a href="#" data-os-consent-open>Preferências de cookies</a></body></html>' },
    });
    await prisma.pageDocument.updateMany({
      where: { variant: { page: { offerId, isHome: false } } },
      data: { html: "<html><body><h1>Política</h1></body></html>" },
    });
    const s = await open("tracking", offerId, { initialSection: "privacidade" });
    expect(await s.page.getByTestId("pages-without-consent-link").textContent()).toBe(
      "Com o botão “Cookies”: Política de privacidade.",
    );
  });

  it("janela de 1280 px (menu do app + menu das partes): nenhum campo cortado, prévia embaixo", async () => {
    const { offerId } = await offerFixture();
    const s = await open("tracking", offerId, { initialSection: "privacidade" });
    const p = s.page;
    // Largura do conteúdo no AppShell com a janela em 1280 px (1280 − 256 do menu − 64 de margem).
    await p.setViewportSize({ width: 1280, height: 1000 });
    await p.evaluate(() => {
      const root = document.getElementById("root") as HTMLElement;
      root.style.maxWidth = "960px";
      root.style.padding = "0";
    });
    const position = p.getByRole("combobox", { name: "Posição" });
    await position.waitFor();
    const clipped = await p.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('[role="tabpanel"] [data-slot="select-value"]'))
        .filter((el) => el.offsetParent)
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => el.textContent),
    );
    expect(clipped).toEqual([]);
    const text = await p.getByLabel("Texto do aviso").boundingBox();
    const preview = await p.getByTestId("consent-preview-banner").boundingBox();
    expect(text?.width).toBeGreaterThan(400);
    // Pouco espaço: a prévia vai para baixo do formulário (não espreme os campos).
    expect(preview?.y).toBeGreaterThan((text?.y ?? 0) + (text?.height ?? 0));
    // Os botões "Claro/Escuro" cabem na coluna.
    const theme = await p.locator('[data-slot="toggle-group"]').boundingBox();
    const positionBox = await position.boundingBox();
    expect((theme?.x ?? 0) + (theme?.width ?? 0)).toBeLessThanOrEqual((text?.x ?? 0) + (text?.width ?? 0) + 1);
    expect(positionBox?.width).toBeGreaterThan(150);

    // Tela larga de verdade: prévia ao lado.
    await p.setViewportSize({ width: 1800, height: 1000 });
    await p.evaluate(() => {
      (document.getElementById("root") as HTMLElement).style.maxWidth = "1480px";
    });
    await p.waitForFunction(() => {
      const t = document.querySelector("textarea")?.getBoundingClientRect();
      const b = document.querySelector('[data-testid="consent-preview-banner"]')?.getBoundingClientRect();
      return !!t && !!b && b.x > t.x + t.width;
    });
  });
});

describe("celular", () => {
  it("as cinco partes aparecem inteiras (sem faixa cortada) e as setas andam na horizontal", async () => {
    const { offerId } = await offerFixture();
    const s = await open("tracking", offerId);
    const p = s.page;
    await p.setViewportSize({ width: 390, height: 844 });
    await p.evaluate(() => {
      (document.getElementById("root") as HTMLElement).style.padding = "16px";
    });
    const list = p.getByRole("tablist", { name: "Partes do rastreamento" });
    await p.waitForFunction(
      () =>
        document.querySelector('[aria-label="Partes do rastreamento"]')?.getAttribute("aria-orientation") ===
        "horizontal",
    );
    const tabs = list.getByRole("tab");
    expect(await tabs.count()).toBe(5);
    for (let i = 0; i < 5; i++) {
      const box = await tabs.nth(i).boundingBox();
      expect(box, `aba ${i}`).not.toBeNull();
      expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= 390, `aba ${i} dentro da tela`).toBe(true);
      const text = await tabs.nth(i).evaluate((el) => {
        const label = el.querySelector("span span") as HTMLElement;
        return label.scrollWidth <= label.clientWidth + 1 && label.scrollHeight <= label.clientHeight + 1;
      });
      expect(text, `texto da aba ${i} inteiro`).toBe(true);
    }
    expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await tabs.first().focus();
    await p.keyboard.press("ArrowRight");
    await expect.poll(() => p.evaluate(() => document.activeElement?.textContent)).toContain("Eventos");
    await p.getByRole("tabpanel", { name: /Eventos/ }).waitFor();

    // Tela larga: lista na vertical, ao lado.
    await p.setViewportSize({ width: 1400, height: 1000 });
    await p.waitForFunction(
      () =>
        document.querySelector('[aria-label="Partes do rastreamento"]')?.getAttribute("aria-orientation") ===
        "vertical",
    );
    expect(s.errors).toEqual([]);
  });
});

describe("Empresa e SEO", () => {
  it("página sem título de SEO: 'Usa o título da própria página' (e o SEO vale na prévia e no ZIP)", async () => {
    const { offerId } = await offerFixture();
    const s = await open("settings", offerId);
    await s.page.getByText("Usa o título da própria página").first().waitFor();
    expect(await s.page.getByText("Sem título (o navegador mostra o endereço)").count()).toBe(0);
    await s.page.getByText("na prévia e no ZIP", { exact: false }).first().waitFor();
  });
});

async function waitForGone(count: () => Promise<number>, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if ((await count()) === 0) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("o elemento continuou na tela");
}
