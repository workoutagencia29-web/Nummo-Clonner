/**
 * Fase 4 — telas "Pixels e rastreamento" e "Empresa e SEO" renderizadas no
 * servidor (primeira pintura, sem JavaScript): todas as partes já vêm no HTML,
 * estados vazios, avisos, esqueletos e nenhum segredo na página.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/actions/tracking", () => ({
  createPixelAction: vi.fn(),
  updatePixelAction: vi.fn(),
  setPixelTokenAction: vi.fn(),
  removePixelTokenAction: vi.fn(),
  setPixelEnabledAction: vi.fn(),
  deletePixelAction: vi.fn(),
  saveTrackingSettingsAction: vi.fn(),
  savePageCodeCategoryAction: vi.fn(),
  createEventRuleAction: vi.fn(),
  updateEventRuleAction: vi.fn(),
  setEventRuleEnabledAction: vi.fn(),
  deleteEventRuleAction: vi.fn(),
  applyRecommendedRulesAction: vi.fn(),
  dismissRecommendedRulesAction: vi.fn(),
}));
vi.mock("@/server/actions/offer-settings", () => ({
  saveOfferSettingsAction: vi.fn(),
  getPageSeoAction: vi.fn(),
  savePageSeoAction: vi.fn(),
}));

import { OfferSettingsPanel } from "@/components/offers/settings/offer-settings-panel";
import { OfferSettingsSkeleton } from "@/components/offers/settings/settings-skeleton";
import { TrackingPanel } from "@/components/offers/tracking/tracking-panel";
import { TrackingSkeleton } from "@/components/offers/tracking/tracking-skeleton";
import { parseOfferSettings, parsePageSeo } from "@/lib/offer-settings";
import { parseTrackingSettings, RECOMMENDED_RULES } from "@/lib/tracking/schema";
import type { OfferSettingsPanel as SettingsData } from "@/server/services/offer-settings";
import type { TrackingPanel as PanelData, PixelView } from "@/server/services/tracking";

const count = (html: string, text: string) => html.split(text).length - 1;

function panel(over: Partial<PanelData> = {}): PanelData {
  return {
    offer: { id: "oferta1", name: "Oferta" },
    pixels: [],
    settings: parseTrackingSettings({}),
    rules: [],
    pages: [
      {
        id: "p1",
        name: "Vendas",
        slug: "vendas",
        type: "SALES",
        isHome: true,
        codeCategory: "NECESSARY",
        codeCategoryAuto: true,
        codeTrackers: [],
        codeUnknownScripts: [],
        hasCode: false,
        hasConsentLink: false,
        htmlTrackers: [],
      },
      {
        id: "p2",
        name: "Política",
        slug: "politica",
        type: "LEGAL",
        isHome: false,
        codeCategory: "NECESSARY",
        codeCategoryAuto: true,
        codeTrackers: [],
        codeUnknownScripts: [],
        hasCode: true,
        hasConsentLink: true,
        htmlTrackers: [],
      },
    ],
    links: [
      { id: "l1", key: "checkout", label: "Checkout principal", kind: "CHECKOUT", url: "https://pay.hotmart.com/X" },
    ],
    missingRecommended: [...RECOMMENDED_RULES],
    pixelsNeedingToken: 0,
    offerCodeTrackers: [],
    ...over,
  };
}

const metaNeedingToken = {
  id: "px1",
  vendor: "META",
  pixelId: "123456789012345",
  label: null,
  enabled: true,
  options: { capi: true },
  hasToken: false,
  tokenHint: null,
  tokenUnreadable: false,
  testEventCode: null,
  needsToken: true,
  createdAt: new Date(),
} as PixelView;

function render(data: PanelData, section?: Parameters<typeof TrackingPanel>[0]["initialSection"]) {
  return renderToStaticMarkup(createElement(TrackingPanel, { data, initialSection: section }));
}

describe("Pixels e rastreamento (primeira pintura)", () => {
  it("todas as partes vêm no HTML (a aberta visível, as outras escondidas) e o “Testar pixels” aponta para a tela de teste", () => {
    const html = render(panel(), "privacidade");
    expect(count(html, 'role="tabpanel"')).toBe(5);
    expect(count(html, 'data-state="active"')).toBeGreaterThanOrEqual(2); // aba + painel
    expect(html).toMatch(/data-state="active"[^>]*role="tabpanel"[^>]*aria-labelledby="[^"]*-privacidade"/);
    expect(count(html, 'data-state="inactive" data-orientation="vertical" role="tabpanel"')).toBe(4);
    expect(html).toContain('href="/ofertas/oferta1/testar-pixels"');
    expect(html).toContain("Testar pixels");
    expect(html).toContain("data-[state=inactive]:hidden");
  });

  it("oferta nova: grade de plataformas, recomendados, aviso de cookies com permissão e resumo", () => {
    const html = render(panel());
    expect(html).toContain("Nenhum pixel nesta oferta ainda");
    for (const name of [
      "Meta (Facebook e Instagram)",
      "TikTok",
      "Kwai",
      "Google Analytics 4",
      "Google Ads",
      "UTMify",
    ]) {
      expect(html).toContain(name);
    }
    expect(html).toContain("Comece pelos eventos recomendados");
    expect(html).toContain("Usar recomendados");
    expect(html).toContain("Nenhuma regra ainda");
    expect(html).toContain("Nenhum pixel");
    expect(html).toContain("Só PageView");
    expect(html).toContain("Pede permissão (LGPD)");
    expect(html).toContain("Repassa UTMs");
    // Política: páginas LEGAL primeiro; o código da página "Política" aparece para escolher a categoria.
    expect(html).toContain("Código de cada página");
    expect(html).toContain("Quando carrega o código da página Política");
  });

  it("pixel com envio pelo servidor sem token: aviso na parte Pixels e no menu; nenhum token no HTML", () => {
    const html = render(panel({ pixels: [metaNeedingToken], pixelsNeedingToken: 1 }));
    expect(html).toContain("Falta o token de acesso");
    expect(html).toContain("API de Conversões sem token");
    expect(html).toContain('aria-label="Precisa de atenção"');
    expect(html).toContain("1 pixel ativo");
    expect(html).not.toMatch(/type="password"/);
  });

  it("sem banner e com pixels: resumo em alerta; regras recomendadas já criadas escondem o botão", () => {
    const settings = parseTrackingSettings({ consent: { mode: "OFF" } });
    const rule = {
      id: "r1",
      pageId: null,
      pageName: null,
      event: "LEAD" as const,
      trigger: "FORM_SUBMIT" as const,
      value: null,
      selector: null,
      enabled: true,
      createdAt: new Date(),
    };
    const html = render(
      panel({
        settings,
        pixels: [{ ...metaNeedingToken, needsToken: false, options: { capi: false } } as PixelView],
        rules: [rule],
        missingRecommended: [],
      }),
    );
    expect(html).toContain("Sem aviso de cookies");
    expect(html).toContain("PageView + 1 regra");
    expect(html).not.toContain("Usar recomendados");
    expect(html).toContain("Ao enviar um formulário");
    expect(html).toContain("Todas as páginas");
  });

  it("refix 4 — pixels todos desligados: resumo em cinza (nenhum evento sai), sem alerta de 'Sem aviso de cookies'", () => {
    /** Cor do ponto do item do resumo com este texto. */
    const dot = (html: string, text: string) =>
      new RegExp(
        `<li[^>]*><span aria-hidden="true" class="([^"]*)"></span>${text.replace(/[()+]/g, "\\$&")}</li>`,
      ).exec(html)?.[1];
    const rule = {
      id: "r1",
      pageId: null,
      pageName: null,
      event: "LEAD" as const,
      trigger: "FORM_SUBMIT" as const,
      value: null,
      selector: null,
      enabled: true,
      createdAt: new Date(),
    };
    const pixel = (id: string, enabled: boolean) =>
      ({ ...metaNeedingToken, id, enabled, needsToken: false, options: { capi: false } }) as PixelView;
    const rules = [rule, { ...rule, id: "r2" }];

    const off = render(panel({ pixels: [pixel("a", false), pixel("b", false)], rules, missingRecommended: [] }));
    expect(dot(off, "Nenhum pixel ativo (2 desligados)")).toContain("bg-muted-foreground/40");
    expect(dot(off, "PageView + 2 regras (sem pixel ativo)")).toContain("bg-muted-foreground/40");
    expect(off).not.toContain("0 de 2");

    // Sem nenhum pixel: as regras também não mandam nada.
    const none = render(panel({ rules, missingRecommended: [] }));
    expect(dot(none, "Nenhum pixel")).toContain("bg-muted-foreground/40");
    expect(dot(none, "PageView + 2 regras (sem pixel ativo)")).toContain("bg-muted-foreground/40");

    // Um ativo: verde, e as regras sem a ressalva.
    const one = render(panel({ pixels: [pixel("a", true), pixel("b", false)], rules, missingRecommended: [] }));
    expect(dot(one, "1 de 2 pixels ativos")).toContain("bg-success");
    expect(dot(one, "PageView + 2 regras")).toContain("bg-success");

    // "Sem aviso de cookies" com os pixels desligados: nada carrega sem perguntar (sem alerta).
    const settings = parseTrackingSettings({ consent: { mode: "OFF" } });
    const offMode = render(panel({ settings, pixels: [pixel("a", false)] }), "privacidade");
    expect(dot(offMode, "Sem aviso de cookies")).toContain("bg-muted-foreground/40");
    expect(offMode).not.toContain('aria-label="Precisa de atenção"');
    expect(offMode).not.toContain("Hoje esta oferta tem pixels que vão carregar sem perguntar.");
    const offActive = render(panel({ settings, pixels: [pixel("a", true)] }), "privacidade");
    expect(dot(offActive, "Sem aviso de cookies")).toContain("bg-warning");
    expect(offActive).toContain("Hoje esta oferta tem pixels que vão carregar sem perguntar.");
  });

  it("esqueleto enquanto carrega", () => {
    const html = renderToStaticMarkup(createElement(TrackingSkeleton));
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Carregando pixels e rastreamento…");
  });
});

describe("Empresa e SEO (primeira pintura)", () => {
  function settingsData(): SettingsData {
    const settings = parseOfferSettings({ company: { name: "ACME" }, seo: { title: "Título padrão" } });
    const own = parsePageSeo({ title: "Obrigado!", noindex: true });
    const none = parsePageSeo({});
    return {
      offer: { id: "oferta1", name: "Oferta", liveUrl: null },
      settings,
      faviconSrc: null,
      ogImageSrc: null,
      pages: [
        {
          id: "p1",
          name: "Vendas",
          type: "SALES",
          isHome: true,
          seo: none,
          effective: { ...settings.seo },
          offerSeo: settings.seo,
          faviconSrc: null,
          ogImageSrc: null,
        },
        {
          id: "p2",
          name: "Obrigado",
          type: "THANK_YOU",
          isHome: false,
          seo: own,
          effective: { ...settings.seo, title: "Obrigado!", noindex: true },
          offerSeo: settings.seo,
          faviconSrc: null,
          ogImageSrc: null,
        },
      ],
    };
  }

  it("explica os marcadores das páginas legais e mostra o SEO de cada página", () => {
    const html = renderToStaticMarkup(createElement(OfferSettingsPanel, { data: settingsData() }));
    for (const marker of ["{{EMPRESA}}", "{{CNPJ}}", "{{EMAIL}}", "{{TELEFONE}}", "{{ENDERECO}}"]) {
      expect(html).toContain(marker);
    }
    expect(html).toContain('value="ACME"');
    expect(html).toContain('value="Título padrão"');
    expect(html).toContain("Usa o padrão");
    expect(html).toContain("SEO próprio");
    expect(html).toContain("Fora do Google");
    expect(html).toContain('aria-label="SEO da página Obrigado"');
    expect(html).toContain("Ícone da aba (favicon)");
    expect(html).toContain("Imagem de compartilhamento");
  });

  it("esqueleto enquanto carrega", () => {
    const html = renderToStaticMarkup(createElement(OfferSettingsSkeleton));
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Carregando dados da empresa e SEO…");
  });
});
