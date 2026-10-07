/**
 * Bloco "Acesso ao produto" no editor de verdade (GrapesJS no Chromium): nasce
 * no idioma do produto de pagamento da oferta, mostra as três partes com
 * rótulos só no canvas (nada roda lá), "Idioma dos textos" troca os textos, o
 * botão de acesso não tem "Link da oferta" nem "Página do funil" (o destino
 * vem do servidor) e as partes não saem do bloco. Na página exportada, sem
 * pedido, só a mensagem de "não encontramos" aparece.
 */
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACCESS_TEXTS } from "@/editor/widgets/access-content";
import {
  addBlock,
  attrs,
  type EditorWindow,
  exportPage,
  openEditor,
  openSite,
  pageErrors,
  setTrait,
} from "./blocks-harness";
import { fakeId } from "./helpers";

const ACCESS = '[data-os-widget="access"]';

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

const texts = (page: Page) =>
  page.evaluate(() => {
    const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
    const out: Record<string, string> = {};
    for (const el of Array.from(doc.querySelectorAll("[data-os-ac-text]"))) {
      out[el.getAttribute("data-os-ac-text") as string] = (el.textContent ?? "").trim();
    }
    return out;
  });

const traitNames = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const ed = (window as unknown as EditorWindow).ed;
    const comp = ed.getWrapper()?.find(sel)[0];
    if (!comp) throw new Error(`nada com ${sel}`);
    ed.select(comp);
    return comp.getTraits().map((t) => String(t.get("name")));
  }, selector);

describe("bloco “Acesso ao produto”", () => {
  let page: Page;
  beforeAll(async () => {
    page = await openEditor(browser, {
      pages: [
        { id: fakeId("vendas"), name: "Vendas" },
        { id: fakeId("obrigado"), name: "Obrigado", type: "THANK_YOU" },
      ],
      links: [
        { key: "checkout", label: "Checkout", kind: "CHECKOUT" },
        {
          key: "masterclass",
          label: "Masterclass",
          kind: "CHECKOUT",
          payment: "Masterclass · US$ 19,00",
          paymentLocale: "en",
        },
      ],
    });
    await addBlock(page, "acesso-produto");
    await page.waitForTimeout(100);
  }, 60_000);
  afterAll(() => page?.close());

  it("nasce no idioma do produto de pagamento, com as três partes rotuladas no canvas e nada rodando", async () => {
    expect(pageErrors(page)).toEqual([]);
    expect((await attrs(page, ACCESS))["data-os-lang"]).toBe("en");
    expect(await texts(page)).toEqual(ACCESS_TEXTS.en);
    const canvas = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const doc = ed.Canvas.getDocument() as Document;
      const view = doc.defaultView as Window;
      const parts = ["wait", "ok", "none"].map((p) => doc.querySelector(`[data-os-ac-${p}]`) as HTMLElement);
      return {
        shown: parts.map((p) => view.getComputedStyle(p).display !== "none"),
        labels: parts.map((p) => view.getComputedStyle(p, "::before").content),
        running: !!doc.querySelector(".os-ac-ok, .os-ac-none, .os-ac-wait"),
        aux: JSON.stringify(ed.getProjectData()).includes("osAccessLang"),
      };
    });
    expect(canvas.shown).toEqual([true, true, true]);
    expect(canvas.labels[0]).toContain("Enquanto confere o pagamento");
    expect(canvas.labels[1]).toContain("Pagamento confirmado");
    expect(canvas.labels[2]).toContain("Sem pagamento confirmado");
    expect(canvas.running).toBe(false);
    expect(canvas.aux).toBe(false);
  });

  it("Configurações: explicação, idioma e cor; o botão não tem link da oferta nem página do funil", async () => {
    expect(await traitNames(page, ACCESS)).toEqual(["os-ac-note", "data-os-lang", "os-ac-go-color"]);
    // A cor do botão aparece no campo (está no próprio botão, não só na classe).
    expect(
      await page.evaluate(() => {
        const ed = (window as unknown as EditorWindow).ed;
        return ed.getWrapper()?.find('[data-os-widget="access"]')[0]?.getTrait("os-ac-go-color")?.getValue();
      }),
    ).toBe("#16a34a");
    const go = await traitNames(page, "[data-os-ac-go]");
    expect(go).toContain("target");
    expect(go).not.toContain("data-os-link");
    expect(go).not.toContain("os-page");
    expect(go).not.toContain("href");
    // As partes e o botão não saem do bloco.
    const removable = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      return ["[data-os-ac-wait]", "[data-os-ac-ok]", "[data-os-ac-none]", "[data-os-ac-go]"].map((sel) =>
        ed.getWrapper()?.find(sel)[0]?.get("removable"),
      );
    });
    expect(removable).toEqual([false, false, false, false]);
  });

  it("“Idioma dos textos” troca os textos do bloco", async () => {
    await setTrait(page, ACCESS, "data-os-lang", "es");
    expect(await texts(page)).toEqual(ACCESS_TEXTS.es);
    await setTrait(page, ACCESS, "data-os-lang", "pt");
    expect(await texts(page)).toEqual(ACCESS_TEXTS.pt);
  });

  it("na página exportada, sem pedido, só “Ainda não encontramos seu pagamento” aparece", async () => {
    const html = await exportPage(page);
    expect(html).toContain('data-os-widget="access"');
    expect(html).toContain("data-os-ac-go");
    expect(html).not.toContain("osAccessLang");
    const site = await openSite(browser, html);
    await expect.poll(() => site.page.locator("[data-os-ac-none]").isVisible()).toBe(true);
    expect(await site.page.locator("[data-os-ac-wait]").isVisible()).toBe(false);
    expect(await site.page.locator("[data-os-ac-ok]").isVisible()).toBe(false);
    expect(await site.page.locator("[data-os-ac-none] h2").textContent()).toBe(ACCESS_TEXTS.pt.noneTitle);
    await site.context.close();
  });
});
