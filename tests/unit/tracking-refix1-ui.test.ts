/**
 * Fase 4 — refix 1 da revisão, nas telas "Pixels e rastreamento" e "Empresa e
 * SEO" (Chromium de verdade, tests/unit/tracking-ui-harness.ts):
 *
 * - aviso com botão (Callout) no celular: o botão vai para baixo do texto;
 * - "UTMs e checkout" explica o que muda com "Pedir permissão";
 * - "Só avisar": sem a frase do botão flutuante "Cookies";
 * - código de página "Automático" com script de fora desconhecido: dica de "Marketing";
 * - pixel no HTML da página (fora dos códigos da página): aviso;
 * - imagem de compartilhamento: pede "Onde está no ar" quando falta.
 */
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/api", () => ({ guardApi: vi.fn(async () => null) }));

import { prisma } from "@/lib/db";
import { parseTrackingSettings } from "@/lib/tracking/schema";
import { createOffer } from "@/server/services/offers";
import { savePageCode } from "@/server/services/page-code";
import { createPage } from "@/server/services/pages";
import { createPixel, savePageCodeCategory, saveTrackingSettings, setPixelEnabled } from "@/server/services/tracking";
import { resetDatabase } from "../setup/per-file";
import { choose, openPanel, panelBundle, panelCss, type Session, waitToast } from "./tracking-ui-harness";

const META_BASE =
  "<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){};t=b.createElement(e);t.src=v;b.head.appendChild(t)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','123456789012345');fbq('track','PageView');</script>";

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
  const offer = await createOffer({ name: "Oferta Refix" });
  const home = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id, isHome: true } });
  return { offerId: offer.id, homeId: home.id };
}

async function setConsentMode(offerId: string, mode: "OPT_IN" | "NOTICE" | "OFF") {
  const current = parseTrackingSettings((await prisma.offer.findUniqueOrThrow({ where: { id: offerId } })).tracking);
  await prisma.offer.update({
    where: { id: offerId },
    data: { tracking: { ...current, consent: { ...current.consent, mode } } as object },
  });
}

describe("aviso com botão no celular", () => {
  it("o botão vai para baixo do texto, que usa a largura toda (e volta para o lado numa tela larga)", async () => {
    const { offerId, homeId } = await offerFixture();
    await savePageCode(homeId, { head: META_BASE });
    await savePageCodeCategory(homeId, "NECESSARY");
    const s = await open("tracking", offerId, { initialSection: "codigo" });
    const p = s.page;
    const callout = p.locator('[data-slot="callout"][data-variant="warning"]').filter({ hasText: "Meta Pixel" });
    const button = callout.getByRole("button", { name: /Esperar o/ });
    const title = callout.locator("p").first();

    await p.setViewportSize({ width: 390, height: 844 });
    await expect.poll(async () => (await button.boundingBox())?.y ?? 0).toBeGreaterThan(0);
    const [t, b, c] = await Promise.all([title.boundingBox(), button.boundingBox(), callout.boundingBox()]);
    expect((b?.y ?? 0) >= (t?.y ?? 0) + (t?.height ?? 0) - 1, "botão abaixo do texto").toBe(true);
    // O texto usa quase toda a largura da caixa (menos o ícone e o respiro).
    expect(t?.width ?? 0).toBeGreaterThan((c?.width ?? 0) - 60);

    await p.setViewportSize({ width: 1400, height: 1000 });
    await expect
      .poll(async () => {
        const [t2, b2] = await Promise.all([title.boundingBox(), button.boundingBox()]);
        return (b2?.x ?? 0) > (t2?.x ?? 0) + (t2?.width ?? 0);
      })
      .toBe(true);
    expect(s.errors).toEqual([]);
  });
});

describe("textos de consentimento", () => {
  it("'UTMs e checkout' explica o 'Pedir permissão'; no 'Só avisar' a nota some", async () => {
    const { offerId } = await offerFixture();
    const s = await open("tracking", offerId, { initialSection: "utms" });
    const note = s.page.getByTestId("forwarding-consent-note");
    await expect.poll(() => note.textContent()).toContain("só vão para o checkout depois do “Aceitar”");
    expect(await s.page.getByText(/só para quem clicou em “Aceitar”/).count()).toBe(1);

    await setConsentMode(offerId, "NOTICE");
    const notice = await open("tracking", offerId, { initialSection: "utms" });
    await notice.page.getByText("Lembrar por quantos dias").waitFor();
    expect(await notice.page.getByTestId("forwarding-consent-note").count()).toBe(0);
  });

  it("'Só avisar': sem a frase do botão flutuante 'Cookies' nem a lista de páginas com ele", async () => {
    const { offerId } = await offerFixture();
    await setConsentMode(offerId, "NOTICE");
    const s = await open("tracking", offerId, { initialSection: "privacidade" });
    await s.page.getByText(/não ganham o botão flutuante/).waitFor();
    expect(await s.page.getByText(/ganham um botão flutuante/).count()).toBe(0);
    expect(await s.page.getByTestId("pages-without-consent-link").count()).toBe(0);
  });
});

describe("código de página e HTML da página", () => {
  it("'Automático' com script de fora desconhecido: dica de escolher 'Marketing'; com rastreador conhecido, não", async () => {
    const { offerId, homeId } = await offerFixture();
    const other = await createPage({ offerId, name: "Obrigado", type: "THANK_YOU" });
    await savePageCode(homeId, { bodyEnd: '<script src="https://widget.desconhecido-exemplo.com/w.js"></script>' });
    await savePageCode(other.id, { head: '<script src="https://cdn.mouseflow.com/projects/abc.js"></script>' });
    const s = await open("tracking", offerId, { initialSection: "codigo" });
    const hint = s.page.getByTestId("unknown-script-hint");
    await expect.poll(() => hint.count()).toBe(1);
    expect(await hint.textContent()).toContain("widget.desconhecido-exemplo.com");
    const rows = s.page.getByRole("list", { name: "Código das páginas" });
    await expect.poll(() => rows.textContent()).toContain("o código tem Mouseflow");
  });

  it("pixel no HTML da página (mantido na clonagem): aviso com a página e o rastreador", async () => {
    const { offerId, homeId } = await offerFixture();
    const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId: homeId } } });
    await prisma.pageDocument.update({
      where: { id: doc.id },
      data: { html: `<!doctype html><html><head>${META_BASE}</head><body><h1>Oferta</h1></body></html>` },
    });
    const s = await open("tracking", offerId, { initialSection: "codigo" });
    const list = s.page.getByTestId("html-trackers");
    await expect.poll(() => list.textContent()).toContain("Meta Pixel");
    await expect
      .poll(() => s.page.getByRole("list", { name: "Resumo" }).textContent())
      .toContain("Pixel no HTML de uma página");

    // Só avisar: o pixel carrega na hora de qualquer jeito (sem aviso).
    await setConsentMode(offerId, "NOTICE");
    const notice = await open("tracking", offerId, { initialSection: "codigo" });
    await notice.page.getByText("Código de cada página").waitFor();
    expect(await notice.page.getByTestId("html-trackers").count()).toBe(0);
  });
});

describe("Empresa e SEO", () => {
  it("imagem de compartilhamento: pede 'Onde está no ar' quando falta; telefone e endereço opcionais", async () => {
    const { offerId } = await offerFixture();
    const s = await open("settings", offerId);
    await expect.poll(() => s.page.getByText(/preencha “Onde está no ar” na aba Detalhes/).count()).toBe(1);
    expect(await s.page.getByLabel("Telefone ou WhatsApp (opcional)").count()).toBe(1);
    expect(await s.page.getByLabel("Endereço (opcional)").count()).toBe(1);

    await prisma.offer.update({ where: { id: offerId }, data: { liveUrl: "https://meusite.com.br/oferta" } });
    const withUrl = await open("settings", offerId);
    await withUrl.page
      .getByText("Aparece ao mandar o link no WhatsApp e nas redes. Tamanho ideal: 1200×630.")
      .waitFor();
    expect(await withUrl.page.getByText(/Onde está no ar/).count()).toBe(0);
  });
});

// ─── Refix 2 ────────────────────────────────────────────────────────────────

describe("refix 2: Empresa e SEO", () => {
  it("dados da empresa: o aviso diz que telefone e endereço vazios somem (nome, CNPJ/CPF e e-mail deixam o marcador)", async () => {
    const { offerId } = await offerFixture();
    const s = await open("settings", offerId);
    const callout = s.page.locator('[data-slot="callout"]').filter({ hasText: "{{EMPRESA}}" });
    await expect.poll(() => callout.textContent()).toContain("Nome, CNPJ/CPF e e-mail vazios deixam o marcador");
    expect(await callout.textContent()).toContain("telefone e endereço são opcionais e somem da página");
    expect(await callout.textContent()).not.toContain("Campo vazio deixa o marcador na página");
  });

  it("idioma: o padrão é 'Igual à página'; dá para escolher um idioma e voltar", async () => {
    const { offerId } = await offerFixture();
    const s = await open("settings", offerId);
    const p = s.page;
    const select = p.getByRole("combobox", { name: "Idioma das páginas" });
    await expect.poll(() => select.textContent()).toBe("Igual à página (não muda)");
    await choose(p, "Idioma das páginas", "Inglês");
    await p.getByRole("button", { name: "Salvar SEO padrão" }).click();
    await waitToast(s, "SEO padrão salvo.");
    const lang = async () =>
      ((await prisma.offer.findUniqueOrThrow({ where: { id: offerId } })).settings as { language?: string }).language;
    expect(await lang()).toBe("en");
    await choose(p, "Idioma das páginas", "Igual à página (não muda)");
    await p.getByRole("button", { name: "Salvar SEO padrão" }).click();
    await waitToast(s, "SEO padrão salvo.");
    expect(await lang()).toBe("");
    expect(s.errors).toEqual([]);
  });

  it("SEO da página: a prévia do Google usa o título que a página já tem (nunca o nome interno) e lembra do 'Onde está no ar'", async () => {
    const { offerId, homeId } = await offerFixture();
    await prisma.page.update({ where: { id: homeId }, data: { name: "Página clonada (sem rodapé)" } });
    const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId: homeId } } });
    await prisma.pageDocument.update({
      where: { id: doc.id },
      data: {
        html: `<!doctype html><html><head><title>Método X — Oferta Original</title><meta name="description" content="Descrição da página"></head><body><h1>Oferta</h1></body></html>`,
      },
    });
    const s = await open("settings", offerId);
    const p = s.page;
    await p.getByRole("button", { name: "SEO da página Página clonada (sem rodapé)" }).click();
    const dialog = p.getByRole("dialog");
    const preview = dialog.getByRole("figure", { name: "Prévia no Google" });
    await expect.poll(() => preview.textContent()).toContain("Método X — Oferta Original");
    expect(await preview.textContent()).toContain("Descrição da página");
    expect(await preview.textContent()).not.toContain("Página clonada (sem rodapé)");
    expect(await dialog.getByTestId("page-own-title").textContent()).toContain("“Método X — Oferta Original”");
    expect(await dialog.getByText(/preencha “Onde está no ar” na aba Detalhes/).count()).toBe(1);
    // Com título próprio digitado, vale ele.
    await dialog.getByLabel("Título", { exact: true }).fill("Novo título");
    await expect.poll(() => preview.textContent()).toContain("Novo título");
    expect(await dialog.getByTestId("page-own-title").count()).toBe(0);
    expect(s.errors).toEqual([]);
  });
});

describe("refix 2: textos de consentimento", () => {
  it("'UTMs e checkout' sem pixels no 'Pedir permissão': explica que o aviso aparece para quem chega de um anúncio", async () => {
    const { offerId } = await offerFixture();
    const s = await open("tracking", offerId, { initialSection: "utms" });
    const note = s.page.getByTestId("forwarding-no-pixels-note");
    await expect
      .poll(() => note.textContent())
      .toContain("o aviso de cookies só aparece para quem chega de um anúncio");

    await createPixel(offerId, { vendor: "META", pixelId: "123456789012345" });
    const withPixel = await open("tracking", offerId, { initialSection: "utms" });
    await withPixel.page.getByText("Lembrar por quantos dias").waitFor();
    expect(await withPixel.page.getByTestId("forwarding-no-pixels-note").count()).toBe(0);
  });

  it("Privacidade: o aviso também aparece para quem chega de anúncio; 'Só avisar' explica quem recusou antes", async () => {
    const { offerId } = await offerFixture();
    const s = await open("tracking", offerId, { initialSection: "privacidade" });
    await s.page
      .getByText(/também aparece para quem chega de um anúncio com IDs de clique \(fbclid, gclid…\) ou UTMs\./)
      .waitFor();
    await s.page.getByText(/Quem recusou quando a oferta pedia permissão continua sem pixels/).waitFor();
  });

  it("refix 4 — Privacidade: quem chega de anúncio segue o “Lembrar” e o repasse salvos", async () => {
    const { offerId } = await offerFixture();
    const privacy = (s: Session) =>
      s.page.locator("section[aria-labelledby='os-consent-title']").locator("div").first();
    const settledPrivacy = (s: Session) => s.page.getByText("Como os pixels carregam", { exact: true }).waitFor();

    // "Lembrar" em 0: UTMs sozinhas não pedem o aviso (nada fica guardado).
    await saveTrackingSettings(offerId, { forwarding: { persistDays: 0 } });
    const zero = await open("tracking", offerId, { initialSection: "privacidade" });
    await settledPrivacy(zero);
    const zeroText = await privacy(zero).textContent();
    expect(zeroText).toContain("também aparece para quem chega de um anúncio com IDs de clique (fbclid, gclid…).");
    expect(zeroText).not.toContain("UTMs");

    // Repasse desligado: só o formulário de captura com webhook lê os IDs de clique.
    await saveTrackingSettings(offerId, { forwarding: { enabled: false, persistDays: 30 } });
    const off = await open("tracking", offerId, { initialSection: "privacidade" });
    await settledPrivacy(off);
    const offText = await privacy(off).textContent();
    expect(offText).toContain(
      "também aparece para quem chega com IDs de clique (fbclid, gclid…) numa página com formulário de captura ligado a um webhook.",
    );
    expect(offText).not.toContain("de um anúncio com IDs de clique (fbclid, gclid…) ou UTMs");

    // Sem IDs de clique na lista, com UTMs guardadas.
    await saveTrackingSettings(offerId, { forwarding: { enabled: true, params: ["utm_source"], persistDays: 7 } });
    const utms = await open("tracking", offerId, { initialSection: "privacidade" });
    await settledPrivacy(utms);
    expect(await privacy(utms).textContent()).toContain(
      "também aparece para quem chega com UTMs ou com IDs de clique (fbclid, gclid…) numa página com formulário de captura ligado a um webhook.",
    );
    for (const s of [zero, off, utms]) expect(s.errors).toEqual([]);
  });
});

describe("refix 3: nota 'sem pixels' em 'UTMs e checkout'", () => {
  const note = (s: Session) => s.page.getByTestId("forwarding-no-pixels-note");
  const settled = (s: Session) => s.page.getByText("Repassar UTMs e IDs de clique").waitFor();

  it("código de marketing da oferta ou de uma página mostra o aviso para todos: sem a nota", async () => {
    const { offerId, homeId } = await offerFixture();
    await saveTrackingSettings(offerId, {
      customCode: { head: "<script>window.__mk=1</script>", category: "MARKETING" },
    });
    const offerCode = await open("tracking", offerId, { initialSection: "utms" });
    await settled(offerCode);
    expect(await note(offerCode).count()).toBe(0);

    // Código da oferta "Essencial" não pede o aviso: a nota volta…
    await saveTrackingSettings(offerId, { customCode: { category: "NECESSARY" } });
    const essential = await open("tracking", offerId, { initialSection: "utms" });
    await expect.poll(() => note(essential).count()).toBe(1);

    // …até uma página ter um pixel no código dela (automático: espera o "Aceitar").
    await savePageCode(homeId, { head: META_BASE });
    const pageCode = await open("tracking", offerId, { initialSection: "utms" });
    await settled(pageCode);
    expect(await note(pageCode).count()).toBe(0);
  });

  it("o texto segue o “Lembrar”, o repasse e os pixels desligados", async () => {
    const { offerId } = await offerFixture();
    const pixel = await createPixel(offerId, { vendor: "META", pixelId: "123456789012345" });
    await setPixelEnabled(pixel.id, false);
    const off = await open("tracking", offerId, { initialSection: "utms" });
    await expect.poll(() => note(off).textContent()).toContain("não tem nenhum pixel ativo");
    expect(await note(off).textContent()).toContain("ou com UTMs (guardadas por 30 dias depois do “Aceitar”)");
    expect(await note(off).textContent()).not.toContain("ainda não tem pixels");

    await saveTrackingSettings(offerId, { forwarding: { persistDays: 0 } });
    const zero = await open("tracking", offerId, { initialSection: "utms" });
    await expect.poll(() => note(zero).textContent()).toContain("só UTMs não pedem o aviso");
    expect(await note(zero).textContent()).not.toContain("ou com UTMs");

    await saveTrackingSettings(offerId, { forwarding: { enabled: false } });
    const disabled = await open("tracking", offerId, { initialSection: "utms" });
    await expect
      .poll(() => note(disabled).textContent())
      .toContain("só aparece nas páginas com formulário de captura ligado a um webhook");

    // Repasse ligado, mas sem IDs de clique na lista: eles só pedem o aviso onde o formulário os manda ao webhook.
    await saveTrackingSettings(offerId, {
      forwarding: { enabled: true, params: ["utm_source", "utm_campaign"], persistDays: 7 },
    });
    const noClickIds = await open("tracking", offerId, { initialSection: "utms" });
    await expect.poll(() => note(noClickIds).textContent()).toContain("a lista do repasse não tem IDs de clique");
    expect(await note(noClickIds).textContent()).toContain(
      "só aparece para quem chega com UTMs (guardadas por 7 dias depois do “Aceitar”) e, nas páginas com formulário de captura ligado a um webhook",
    );

    // Só IDs de clique na lista: nada de UTMs guardadas, e o motivo não é o “Lembrar”.
    await saveTrackingSettings(offerId, { forwarding: { params: ["fbclid", "gclid"], persistDays: 7 } });
    const onlyClickIds = await open("tracking", offerId, { initialSection: "utms" });
    await expect
      .poll(() => note(onlyClickIds).textContent())
      .toContain("só aparece para quem chega de um anúncio com IDs de clique (fbclid, gclid…). O “Aceitar”");
    expect(await note(onlyClickIds).textContent()).not.toContain("UTMs");
  });
});

describe("refix 4: 'UTMs e checkout' legível no celular", () => {
  it("a nota 'sem pixels' fica numa caixa própria, fora do texto da seção; nenhum parágrafo vira um bloco enorme", async () => {
    const { offerId } = await offerFixture();
    const s = await open("tracking", offerId, { initialSection: "utms" });
    const p = s.page;
    await p.setViewportSize({ width: 390, height: 844 });
    const note = p.getByTestId("forwarding-no-pixels-note");
    await expect
      .poll(() => note.textContent())
      .toContain("o aviso de cookies só aparece para quem chega de um anúncio");
    // Numa caixa (Callout) com título, e não no texto do cabeçalho da seção.
    const callout = p.locator('[data-slot="callout"]').filter({ has: note });
    expect(await callout.count()).toBe(1);
    expect(await callout.locator("p").first().textContent()).toBe("Quem vê o aviso de cookies");
    const heading = p.locator("section[aria-labelledby='os-forwarding-title'] > div").first();
    expect(await heading.textContent()).not.toContain("o aviso de cookies só aparece");
    // A nota do "Pedir permissão" é um parágrafo separado da introdução.
    expect(await heading.locator("p").count()).toBe(2);
    expect(await heading.getByTestId("forwarding-consent-note").textContent()).toContain(
      "só vão para o checkout depois do “Aceitar”",
    );
    // Nenhum parágrafo com mais de 8 linhas a 390 px (antes: um bloco de ~14).
    const lines = await heading
      .locator("p")
      .evaluateAll((els) =>
        els.map((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight))),
      );
    for (const n of lines) expect(n).toBeLessThanOrEqual(8);
    expect(s.errors).toEqual([]);
  });
});
