/**
 * Fase 4 — ganchos do editor para o rastreamento, no editor de verdade
 * (GrapesJS no Chromium, tests/unit/blocks-harness.ts):
 *
 * - "Evento ao clicar" (data-os-event) em links, botões e elementos clicáveis;
 * - "Preferências de cookies" (data-os-consent-open) nos blocos de rodapé;
 * - a página montada no editor, com o script de rastreamento em modo teste:
 *   o clique no elemento dispara o evento, o link do rodapé reabre o aviso de
 *   cookies e os passos informados viram a conferência da tela "Testar pixels".
 *
 * Nada vai para a internet: o script da Meta é uma versão local.
 */
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { consentState, describeRow, vendorChecklist } from "@/components/offers/pixel-test/logic";
import { CLICK_EVENT_ATTR, isClickableElement } from "@/editor/grapes/components";
import { inlineTrackingScriptTag } from "@/lib/runtime-bundle";
import { composeTrackingConfig } from "@/lib/tracking/compose";
import { injectTracking } from "@/lib/tracking/inject";
import type { PixelTestReport } from "@/lib/tracking/runtime-config";
import { parseTrackingSettings, RULE_EVENTS, TRACKING_EVENT_LABEL } from "@/lib/tracking/schema";
import { type PixelTestEventRow, parsePixelTestReport, summarizePixelTest } from "@/lib/tracking/test-report";
import {
  addBlock,
  attrs,
  type EditorWindow,
  editorOutput,
  exportPage,
  openEditor,
  pageErrors,
  setTrait,
} from "./blocks-harness";

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

const LINKS = [{ key: "checkout", label: "Checkout", kind: "CHECKOUT" }];

/** Seleciona o elemento e devolve os nomes das Configurações (traits) dele. */
async function traitsOf(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const ed = (window as unknown as EditorWindow).ed;
    const comp = ed.getWrapper()?.find(sel)[0];
    if (!comp) throw new Error(`nada com ${sel}`);
    ed.select(comp);
    return comp.getTraits().map((t) => String(t.getName()));
  }, selector);
}

async function traitOptions(page: Page, selector: string) {
  return page.evaluate(
    ([sel, name]) => {
      const comp = (window as unknown as EditorWindow).ed.getWrapper()?.find(sel)[0];
      const trait = comp?.getTrait(name);
      return {
        label: String(trait?.get("label") ?? ""),
        value: String(trait?.getValue() ?? ""),
        options: ((trait?.get("options") ?? []) as { id: string; label: string }[]).map((o) => [o.id, o.label]),
      };
    },
    [selector, CLICK_EVENT_ATTR] as const,
  );
}

describe("isClickableElement", () => {
  it("links, botões, inputs de envio e elementos com clique", () => {
    expect(isClickableElement("A", {})).toBe(true);
    expect(isClickableElement("button", {})).toBe(true);
    expect(isClickableElement("input", { type: "submit" })).toBe(true);
    expect(isClickableElement("input", { type: "image" })).toBe(true);
    expect(isClickableElement("input", { type: "email" })).toBe(false);
    expect(isClickableElement("div", { role: "Button" })).toBe(true);
    expect(isClickableElement("div", { "data-os-href": "https://x.com" })).toBe(true);
    expect(isClickableElement("span", { "data-os-on-click": "comprar()" })).toBe(true);
    expect(isClickableElement("div", { "data-os-checkout": "" })).toBe(true);
    expect(isClickableElement("div", { [CLICK_EVENT_ATTR]: "LEAD" })).toBe(true);
    expect(isClickableElement("p", {})).toBe(false);
    expect(isClickableElement("section", { class: "cta" })).toBe(false);
  });
});

describe("Evento ao clicar (editor)", () => {
  let page: Page;
  beforeAll(async () => {
    page = await openEditor(browser, { links: LINKS });
    await addBlock(page, "cta-checkout");
    await addBlock(page, "form-captura");
    await page.evaluate(() => {
      (window as unknown as EditorWindow).ed
        .getWrapper()
        ?.append(
          '<div id="rb" role="button">Quero</div><span id="oc" data-os-on-click="abrir()">Abrir</span><p id="pp">Texto comum</p><a id="custom" href="#" data-os-event="custom_evt">Outro</a>',
        );
    });
  }, 60_000);
  afterAll(() => page?.close());

  it("aparece em links (depois das Configurações que já existiam) com os eventos em português", async () => {
    const names = await traitsOf(page, "a[data-os-link]");
    expect(names).toContain("data-os-link");
    expect(names).toContain("target");
    expect(names.filter((n) => n === CLICK_EVENT_ATTR)).toHaveLength(1);
    expect(names.indexOf(CLICK_EVENT_ATTR)).toBeGreaterThan(names.indexOf("data-os-link"));

    const trait = await traitOptions(page, "a[data-os-link]");
    expect(trait.label).toBe("Evento ao clicar");
    expect(trait.value).toBe("");
    expect(trait.options).toEqual([["", "— nenhum —"], ...RULE_EVENTS.map((e) => [e, TRACKING_EVENT_LABEL[e]])]);
    expect(trait.options.map((o) => o[0])).not.toContain("PAGE_VIEW");

    // Selecionar de novo não duplica.
    await traitsOf(page, "#pp");
    expect((await traitsOf(page, "a[data-os-link]")).filter((n) => n === CLICK_EVENT_ATTR)).toHaveLength(1);
  });

  it("escolher grava data-os-event; “— nenhum —” tira o atributo (pelo painel Configurações)", async () => {
    await traitsOf(page, "a[data-os-link]");
    const select = page.locator(`#traits .gjs-trt-trait__wrp-${CLICK_EVENT_ATTR} select`);
    await expect.poll(() => select.count()).toBe(1);
    expect(await page.locator("#traits").textContent()).toContain("Evento ao clicar");
    await select.selectOption("LEAD");
    expect((await attrs(page, "a[data-os-link]"))[CLICK_EVENT_ATTR]).toBe("LEAD");
    const { html } = await editorOutput(page);
    expect(html).toMatch(/<a[^>]*data-os-event="LEAD"[^>]*>QUERO COMPRAR AGORA/);

    await select.selectOption("");
    expect(CLICK_EVENT_ATTR in (await attrs(page, "a[data-os-link]"))).toBe(false);
    expect((await editorOutput(page)).html).toMatch(/<a href="#" data-os-link="checkout"[^>]*>QUERO COMPRAR AGORA/);
    expect((await editorOutput(page)).html).not.toMatch(/<a[^>]*data-os-event="LEAD"/);
    // Continua ligado ao checkout.
    expect((await attrs(page, "a[data-os-link]"))["data-os-link"]).toBe("checkout");
  });

  it("botões, role=button e onclick do clone também; texto comum não", async () => {
    expect(await traitsOf(page, 'form[data-os-widget="lead-form"] button')).toContain(CLICK_EVENT_ATTR);
    expect(await traitsOf(page, "#rb")).toContain(CLICK_EVENT_ATTR);
    expect(await traitsOf(page, "#oc")).toContain(CLICK_EVENT_ATTR);
    expect(await traitsOf(page, "#pp")).not.toContain(CLICK_EVENT_ATTR);
    await setTrait(page, "#rb", CLICK_EVENT_ATTR, "CONTACT");
    expect((await attrs(page, "#rb"))[CLICK_EVENT_ATTR]).toBe("CONTACT");
  });

  it("valor desconhecido (vindo do código) continua escolhido, como “Outro”", async () => {
    await traitsOf(page, "#custom");
    const trait = await traitOptions(page, "#custom");
    expect(trait.value).toBe("custom_evt");
    expect(trait.options.at(-1)).toEqual(["custom_evt", "Outro: custom_evt"]);
    expect(pageErrors(page)).toEqual([]);
  });
});

describe("Preferências de cookies (blocos de rodapé)", () => {
  it("o rodapé com políticas traz o link; há também o bloco só com o link", async () => {
    const page = await openEditor(browser);
    const ids = await page.evaluate(() =>
      (window as unknown as EditorWindow).OS.ALL_BLOCKS.filter((b) => b.category === "rodape").map((b) => b.id),
    );
    expect(ids).toEqual(["rodape", "aviso-legal", "preferencias-cookies"]);
    await addBlock(page, "rodape");
    await addBlock(page, "preferencias-cookies");
    const { html } = await editorOutput(page);
    const links = html.match(/<a[^>]*data-os-consent-open[^>]*>[^<]*<\/a>/g) ?? [];
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toContain('href="#"');
      expect(link).not.toContain("target=");
      expect(link).toContain(">Preferências de cookies</a>");
    }
    // Termos e política continuam lá.
    expect(html).toContain(">Termos de uso</a>");
    expect(html).toContain(">Política de privacidade</a>");
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });
});

// ─── Página montada no editor + script de rastreamento em modo teste ────────

const TOKEN = "abcdefghijklmnopqrstuvwxyz";
const FB_STUB = `(function(){var c=window.__calls=window.__calls||[];
  var q=fbq.queue.slice();fbq.queue.length=0;
  fbq.callMethod=function(){c.push([].slice.call(arguments))};
  q.forEach(function(a){fbq.callMethod.apply(fbq,a)});})();`;

describe("página do editor com o rastreamento (modo teste)", () => {
  it("clique no elemento dispara o evento, o rodapé reabre o aviso e a tela entende cada passo", async () => {
    const editor = await openEditor(browser, { links: LINKS });
    await addBlock(editor, "cta-checkout");
    await editor.evaluate(() => {
      (window as unknown as EditorWindow).ed.getWrapper()?.append('<a id="cadastro" href="#">Quero me cadastrar</a>');
    });
    await setTrait(editor, "#cadastro", CLICK_EVENT_ATTR, "LEAD");
    await addBlock(editor, "rodape");
    const exported = await exportPage(editor, { links: [{ key: "checkout", url: "https://pay.hotmart.com/X1" }] });
    await editor.close();

    const config = composeTrackingConfig({
      mode: "test",
      settings: parseTrackingSettings({}),
      pixels: [{ vendor: "META", pixelId: "123456789012345", enabled: true, options: {} }],
      rules: [
        {
          pageId: null,
          event: "INITIATE_CHECKOUT",
          trigger: "CHECKOUT_CLICK",
          value: null,
          selector: null,
          enabled: true,
        },
      ],
      links: [{ key: "checkout", kind: "CHECKOUT", url: "https://pay.hotmart.com/X1" }],
      pageId: null,
      policyUrl: null,
      test: { endpoint: "/__os/pixel-test", token: TOKEN },
    });
    const html = injectTracking(exported, config, inlineTrackingScriptTag());
    expect(html).toContain('data-os-event="LEAD"');

    const context = await browser.newContext();
    const site = await context.newPage();
    const reports: PixelTestReport[] = [];
    const outside: string[] = [];
    await context.route("**/*", async (route) => {
      const req = route.request();
      const url = req.url();
      if (url === "http://site.test/oferta") {
        return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
      }
      if (url === "http://site.test/__os/pixel-test" && req.method() === "POST") {
        const parsed = parsePixelTestReport(JSON.parse(req.postData() ?? "null"));
        if (parsed) reports.push(parsed);
        return route.fulfill({ status: 204, body: "" });
      }
      if (url === "https://connect.facebook.net/en_US/fbevents.js") {
        return route.fulfill({ contentType: "application/javascript", body: FB_STUB });
      }
      outside.push(url);
      return route.abort();
    });
    const errors: string[] = [];
    site.on("pageerror", (e) => errors.push(String(e)));
    await site.goto("http://site.test/oferta");

    // Aviso de cookies (pede permissão): recusa, reabre pelo rodapé e aceita.
    await site.getByRole("button", { name: "Recusar" }).click();
    await expect.poll(() => site.getByRole("dialog", { name: "Aviso de cookies" }).count()).toBe(0);
    await site.getByRole("link", { name: "Preferências de cookies" }).click();
    await site.getByRole("button", { name: "Aceitar" }).click();
    await expect
      .poll(() => site.evaluate(() => (window as unknown as { __calls?: unknown[][] }).__calls?.length ?? 0))
      .toBeGreaterThanOrEqual(2);

    await site.getByRole("link", { name: "Quero me cadastrar" }).click();
    await expect
      .poll(() => reports.some((r) => r.vendor === "META" && r.event === "Lead" && r.status === "FIRED"))
      .toBe(true);
    const calls = await site.evaluate(() => (window as unknown as { __calls: unknown[][] }).__calls);
    expect(calls.map((c) => c.slice(0, 2))).toEqual([
      ["init", "123456789012345"],
      ["track", "PageView"],
      ["track", "Lead"],
    ]);

    // Os passos informados, como a tela os recebe (ordem de chegada).
    const rows: PixelTestEventRow[] = reports.map((r, i) => ({
      id: i + 1,
      at: new Date().toISOString(),
      vendor: r.vendor,
      event: r.event,
      status: r.status,
      detail: r.detail ?? {},
    }));
    expect(rows.filter((r) => r.vendor === "CONSENT").map((r) => r.event)).toEqual(
      expect.arrayContaining(["WAITING", "BANNER", "REJECTED", "ACCEPTED"]),
    );
    const consent = consentState(rows);
    expect(consent.state).toBe("ACCEPTED");
    const [summary] = summarizePixelTest(rows, ["META"]);
    expect(summary.state).toBe("LOADED");
    const checklist = vendorChecklist({
      vendor: "META",
      pixels: [{ id: "p", vendor: "META", pixelId: "123456789012345", label: null, conversionLabels: {} }],
      rules: [{ pageId: null, event: "INITIATE_CHECKOUT", trigger: "CHECKOUT_CLICK", value: null, selector: null }],
      eventNames: {},
      links: LINKS,
      events: rows,
      summary,
      consent,
    });
    expect(checklist.items.map((i) => [i.label, i.state])).toEqual([
      ["Pixel carregou", "done"],
      ["PageView disparou", "done"],
      ["InitiateCheckout ao clicar no checkout", "pending"],
    ]);
    const lead = rows.find((r) => r.vendor === "META" && r.event === "Lead") as PixelTestEventRow;
    expect(describeRow(lead)).toEqual({ title: "Lead", subtitle: "Cadastro / lead (Lead)", hint: null });
    expect(describeRow(rows.find((r) => r.event === "load") as PixelTestEventRow)).toMatchObject({
      title: "Pixel carregou",
      subtitle: "ID 123456789012345",
    });
    expect(errors).toEqual([]);
    expect(outside).toEqual([]);
    await context.close();
  });
});
