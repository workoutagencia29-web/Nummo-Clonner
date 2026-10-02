/**
 * Blocos e widgets dentro do editor de verdade (GrapesJS no Chromium):
 * todos os blocos entram sem erro, nada roda no canvas, as Configurações de
 * cada widget gravam o que devem, ajustes de celular, ligação automática ao
 * checkout e às páginas legais.
 */
import * as cheerio from "cheerio";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addBlock, attrs, type EditorWindow, editorOutput, openEditor, pageErrors, setTrait } from "./blocks-harness";
import { fakeId } from "./helpers";

let browser: Browser;

/** HTML com os atributos em ordem alfabética (o GrapesJS pode trocar id/class de lugar). */
function sortedAttrs(html: string) {
  const $ = cheerio.load(html);
  $("*").each((_, el) => {
    if (!("attribs" in el)) return;
    const entries = Object.entries(el.attribs).sort(([a], [b]) => a.localeCompare(b));
    el.attribs = Object.fromEntries(entries);
  });
  return $.html();
}

beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

async function innerHtml(page: Page, selector: string): Promise<string> {
  return page.evaluate(
    (sel) => (window as unknown as EditorWindow).ed.getWrapper()?.find(sel)[0]?.getInnerHTML() ?? "",
    selector,
  );
}

describe("todos os blocos", () => {
  let page: Page;
  beforeAll(async () => {
    page = await openEditor(browser);
    const ids = await page.evaluate(() => (window as unknown as EditorWindow).OS.ALL_BLOCKS.map((b) => b.id));
    for (const id of ids) await addBlock(page, id);
  }, 60_000);
  afterAll(() => page?.close());

  it("entram na página sem erros e com ajustes de celular", async () => {
    expect(pageErrors(page)).toEqual([]);
    const { html, css } = await editorOutput(page);
    expect(css).toContain("@media (max-width: 480px)");
    expect(html).toContain('data-os-widget="countdown"');
    // Propriedades auxiliares dos blocos não vão para o HTML nem para o projeto.
    const project = await page.evaluate(() => JSON.stringify((window as unknown as EditorWindow).ed.getProjectData()));
    for (const helper of ["osMobile", "osAutoLink", "osLegal"]) {
      expect(html).not.toContain(helper);
      expect(project).not.toContain(helper);
    }
    // O CSS dos botões (realce e pulso) vai junto com a página.
    expect(css).toMatch(/\.os-btn:hover\{/);
    expect(css).toMatch(/@keyframes os-pulse/);
  });

  it("nada executa no canvas: widgets mostram a aparência final, parados", async () => {
    const before = await page.evaluate(() => {
      const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
      return Array.from(doc.querySelectorAll("[data-os-cd]")).map((n) => n.textContent);
    });
    await page.waitForTimeout(1500);
    const state = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const doc = ed.Canvas.getDocument() as Document;
      const win = ed.Canvas.getWindow() as Window & { __osRuntime?: boolean };
      const shown = (sel: string) => {
        const el = doc.querySelector(sel) as HTMLElement;
        return !!el && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().height > 40;
      };
      return {
        digits: Array.from(doc.querySelectorAll("[data-os-cd]")).map((n) => n.textContent),
        runtime: !!win.__osRuntime || !!doc.getElementById("os-widgets-css"),
        popup: shown('[data-os-widget="exit-popup"]'),
        popupLabel: getComputedStyle(doc.querySelector('[data-os-widget="exit-popup"]') as Element, "::before").content,
        notification: shown('[data-os-widget="sales-notification"]'),
        notificationLabel: getComputedStyle(
          doc.querySelector('[data-os-widget="sales-notification"]') as Element,
          "::before",
        ).content,
        daysHidden: getComputedStyle(doc.querySelector('[data-os-cd-unit="d"]') as Element).display === "none",
        hint: getComputedStyle(doc.querySelector('a[data-os-link=""]') as Element, "::after").content,
        iframes: doc.querySelectorAll("iframe").length,
        videoPoster: (doc.querySelector("video[data-os-file]") as HTMLVideoElement).getAttribute("poster") ?? "",
      };
    });
    expect(state.digits).toEqual(before);
    expect(state.digits.slice(0, 4)).toEqual(["00", "00", "15", "00"]);
    expect(state.runtime).toBe(false);
    expect(state.popup).toBe(true);
    expect(state.popupLabel).toContain("Popup de saída (aparece ao sair)");
    expect(state.notification).toBe(true);
    expect(state.notificationLabel).toContain("Notificação de compra");
    expect(state.daysHidden).toBe(true);
    expect(state.hint).toContain("Escolha o link da oferta em Configurações");
    // Vídeos viram marcadores (nenhum iframe de terceiro carrega no painel).
    expect(state.iframes).toBe(0);
    expect(decodeURIComponent(state.videoPoster)).toContain("Escolha o arquivo do vídeo");
  });
});

describe("projeto salvo e reaberto", () => {
  it("os widgets voltam com o mesmo tipo, as mesmas Configurações e o mesmo HTML", async () => {
    const first = await openEditor(browser);
    for (const id of [
      "contador",
      "escassez",
      "notificacao-compra",
      "popup-saida",
      "form-captura",
      "whatsapp-botao",
      "video-youtube",
      "video-vturb",
      "video-arquivo",
      "cta-grande",
    ]) {
      await addBlock(first, id);
    }
    const project = await first.evaluate(() => (window as unknown as EditorWindow).ed.getProjectData());
    const before = await editorOutput(first);
    await first.close();

    const again = await openEditor(browser, { project: JSON.parse(JSON.stringify(project)) });
    const types = await again.evaluate(() => {
      const wrapper = (window as unknown as EditorWindow).ed.getWrapper();
      const typeOf = (sel: string) => wrapper?.find(sel)[0]?.get("type");
      return {
        countdown: typeOf('[data-os-widget="countdown"]'),
        scarcity: typeOf('[data-os-widget="scarcity"]'),
        notification: typeOf('[data-os-widget="sales-notification"]'),
        popup: typeOf('[data-os-widget="exit-popup"]'),
        form: typeOf('[data-os-widget="lead-form"]'),
        whatsapp: typeOf('[data-os-widget="whatsapp"]'),
        video: typeOf("[data-os-video]"),
        vturb: typeOf('[data-os-widget="vturb"]'),
        file: typeOf("[data-os-file]"),
        button: typeOf("a.os-btn"),
      };
    });
    expect(types).toEqual({
      countdown: "os-countdown",
      scarcity: "os-scarcity",
      notification: "os-sales-notification",
      popup: "os-exit-popup",
      form: "os-lead-form",
      whatsapp: "os-whatsapp",
      video: "os-video-embed",
      vturb: "os-vturb-player",
      file: "os-video-file",
      button: "os-button",
    });
    // As Configurações (com funções próprias) continuam funcionando depois de reabrir.
    await setTrait(again, "[data-os-video]", "os-video-url", "https://youtu.be/dQw4w9WgXcQ");
    expect((await attrs(again, "[data-os-video]")).src).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0");
    await setTrait(again, "[data-os-video]", "os-video-url", "");
    const after = await editorOutput(again);
    expect(sortedAttrs(after.html)).toBe(sortedAttrs(before.html));
    expect(after.css).toBe(before.css);
    expect(pageErrors(again)).toEqual([]);
    await again.close();
  });
});

describe("ligações automáticas ao soltar o bloco", () => {
  it("botão do checkout e WhatsApp pegam o link da oferta; rodapé liga as páginas legais", async () => {
    const terms = fakeId("termos");
    const privacy = fakeId("priv");
    const page = await openEditor(browser, {
      links: [
        { key: "upsell", label: "Upsell", kind: "UPSELL" },
        { key: "checkout-principal", label: "Checkout principal", kind: "CHECKOUT" },
        { key: "whats-suporte", label: "WhatsApp", kind: "WHATSAPP" },
      ],
      pages: [
        { id: fakeId("vendas"), name: "Página de vendas", type: "SALES" },
        { id: terms, name: "Termos de uso", type: "LEGAL" },
        { id: privacy, name: "Política de privacidade", type: "LEGAL" },
      ],
    });
    for (const id of ["cta-checkout", "tabela-precos", "whatsapp-botao", "rodape"]) await addBlock(page, id);
    const { html } = await editorOutput(page);
    expect(html).toMatch(/<a[^>]*data-os-link="checkout-principal"[^>]*>QUERO COMPRAR AGORA/);
    // Tabela de 3 planos: cada plano escolhe o próprio link (não liga sozinho).
    expect(html.match(/data-os-link=""/g)?.length).toBe(3);
    expect(html).toMatch(
      /data-os-widget="whatsapp"[^>]*data-os-link="whats-suporte"|data-os-link="whats-suporte"[^>]*data-os-widget="whatsapp"/,
    );
    expect(html).toContain(`href="os-page:${terms}"`);
    expect(html).toContain(`href="os-page:${privacy}"`);
    await page.close();
  });

  it("sem links na oferta, o botão fica esperando a escolha (data-os-link vazio)", async () => {
    const page = await openEditor(browser);
    await addBlock(page, "cta-checkout");
    await addBlock(page, "rodape");
    const { html } = await editorOutput(page);
    expect(html).toMatch(/<a[^>]*data-os-link=""[^>]*>QUERO COMPRAR AGORA/);
    expect(html).not.toContain("os-page:");
    await page.close();
  });

  it("bloco solto no modo Celular continua com o visual no computador", async () => {
    const page = await openEditor(browser);
    await page.evaluate(() => (window as unknown as EditorWindow).ed.setDevice("mobile"));
    const id = await addBlock(page, "cartao");
    const rules = await page.evaluate((cid) => {
      const css = (window as unknown as EditorWindow).ed.Css;
      return {
        base: css.getIdRule(cid, { mediaText: "" })?.getStyle() ?? null,
        mobile: css.getIdRule(cid, { mediaText: "(max-width: 480px)" })?.getStyle() ?? null,
      };
    }, id);
    expect(rules.base).toMatchObject({ "max-width": "420px", "border-radius": "18px" });
    expect(rules.mobile).toBeNull();
    await page.close();
  });
});

describe("Configurações dos widgets", () => {
  let page: Page;
  const pageId = fakeId("obrigado");
  beforeAll(async () => {
    page = await openEditor(browser, {
      links: [{ key: "checkout-principal", label: "Checkout <principal>", kind: "CHECKOUT" }],
      pages: [
        { id: fakeId("vendas"), name: "Vendas" },
        { id: pageId, name: "Obrigado", type: "THANK_YOU" },
      ],
    });
    for (const id of [
      "contador",
      "escassez",
      "notificacao-compra",
      "video-youtube",
      "video-vturb",
      "whatsapp-botao",
      "form-captura",
      "cta-grande",
      "popup-saida",
    ]) {
      await addBlock(page, id);
    }
  }, 60_000);
  afterAll(() => page?.close());

  it("contador: minutos, data fixa e cores", async () => {
    const sel = '[data-os-widget="countdown"]';
    await setTrait(page, sel, "data-os-minutes", "45");
    expect((await attrs(page, sel))["data-os-minutes"]).toBe("45");
    expect(await innerHtml(page, '[data-os-cd="m"]')).toBe("45");
    await setTrait(page, sel, "data-os-mode", "date");
    await setTrait(page, sel, "data-os-until", "2099-01-01T00:00");
    expect((await attrs(page, sel))["data-os-cd-days"]).toBe("1");
    await setTrait(page, sel, "os-cd-bg", "#ff0000");
    const colors = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      return ed
        .getWrapper()
        ?.find(".os-cd-unit")
        .map((c) => ed.Css.getIdRule(c.getId(), { mediaText: "" })?.getStyle()["background-color"]);
    });
    expect(colors).toEqual(["#ff0000", "#ff0000", "#ff0000", "#ff0000"]);
  });

  it("escassez: a porcentagem muda a barra e o número", async () => {
    await setTrait(page, '[data-os-widget="scarcity"]', "data-os-percent", "42");
    expect(await innerHtml(page, "[data-os-sc-value]")).toBe("42%");
    const width = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const fill = ed.getWrapper()?.find("[data-os-sc-fill]")[0];
      return fill ? ed.Css.getIdRule(fill.getId(), { mediaText: "" })?.getStyle().width : null;
    });
    expect(width).toBe("42%");
  });

  it("notificação: a lista de nomes atualiza o cartão de exemplo", async () => {
    await setTrait(page, '[data-os-widget="sales-notification"]', "data-os-people", "Lia - Natal\nRui - Belém");
    await setTrait(page, '[data-os-widget="sales-notification"]', "data-os-product", "o Curso <Y>");
    expect(await innerHtml(page, '[data-os-sn="title"]')).toBe("Lia, de Natal");
    expect(await innerHtml(page, '[data-os-sn="text"]')).toBe("acabou de comprar o Curso &#60;Y&#62;");
  });

  it("vídeo: qualquer link do YouTube vira embed e 'tocar sozinho' é mantido", async () => {
    const sel = "[data-os-video]";
    await setTrait(page, sel, "os-video-url", "https://youtu.be/dQw4w9WgXcQ?t=42");
    expect((await attrs(page, sel)).src).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0&start=42");
    await setTrait(page, sel, "os-video-autoplay", true);
    expect((await attrs(page, sel)).src).toContain("autoplay=1&mute=1");
    await setTrait(page, sel, "os-video-url", "https://vimeo.com/76979871");
    expect(await attrs(page, sel)).toMatchObject({
      src: "https://player.vimeo.com/video/76979871?autoplay=1&muted=1",
      "data-os-video": "vimeo",
    });
    // Texto que não é vídeo não apaga o que já estava.
    await setTrait(page, sel, "os-video-url", "não sei");
    expect((await attrs(page, sel)).src).toContain("player.vimeo.com");
    const placeholder = await page.evaluate(() => {
      const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
      return doc.querySelector('[data-os-video="vimeo"]')?.textContent ?? "";
    });
    expect(placeholder).toContain("Vídeo do Vimeo");
  });

  it("VTurb: colar o código preenche conta, player e versão", async () => {
    const code =
      '<vturb-smartplayer id="vid-68a1f2c3d4e5f60718293a4b"></vturb-smartplayer><script>var s=document.createElement("script"); s.src="https://scripts.converteai.net/8e0d41ae-6a4d-4f4b-9c56-0e5b1d8c5a11/players/68a1f2c3d4e5f60718293a4b/v4/player.js"</script>';
    await setTrait(page, '[data-os-widget="vturb"]', "os-vturb-code", code);
    expect(await attrs(page, '[data-os-widget="vturb"]')).toMatchObject({
      "data-os-account": "8e0d41ae-6a4d-4f4b-9c56-0e5b1d8c5a11",
      "data-os-player": "68a1f2c3d4e5f60718293a4b",
      "data-os-version": "v4",
    });
  });

  it("WhatsApp: número e mensagem montam o link wa.me", async () => {
    const sel = '[data-os-widget="whatsapp"]';
    await setTrait(page, sel, "os-wa-phone", "(21) 98888-7777");
    await setTrait(page, sel, "os-wa-message", "Quero o desconto");
    expect(await attrs(page, sel)).toMatchObject({
      "data-os-phone": "5521988887777",
      href: "https://wa.me/5521988887777?text=Quero%20o%20desconto",
    });
  });

  it("formulário: liga/desliga campos na ordem certa e escolhe o destino", async () => {
    const sel = '[data-os-widget="lead-form"]';
    const fields = () =>
      page.evaluate(() =>
        (window as unknown as EditorWindow).ed
          .getWrapper()
          ?.find('[data-os-widget="lead-form"] [data-os-field]')
          .map((c) => c.getAttributes()["data-os-field"]),
      );
    expect(await fields()).toEqual(["name", "email", "phone"]);
    await setTrait(page, sel, "os-field-email", false);
    await setTrait(page, sel, "os-field-name", false);
    expect(await fields()).toEqual(["phone"]);
    await setTrait(page, sel, "os-field-email", true);
    await setTrait(page, sel, "os-field-name", true);
    expect(await fields()).toEqual(["name", "email", "phone"]);

    await setTrait(page, sel, "os-lf-page", pageId);
    expect((await attrs(page, sel)).action).toBe(`os-page:${pageId}`);
    const urlShown = await page.evaluate(() => {
      const comp = (window as unknown as EditorWindow).ed.getWrapper()?.find('[data-os-widget="lead-form"]')[0];
      return comp?.getTrait("os-lf-url")?.getValue();
    });
    expect(urlShown).toBe("");
    await setTrait(page, sel, "os-lf-url", "https://exemplo.com/obrigado");
    expect((await attrs(page, sel)).action).toBe("https://exemplo.com/obrigado");

    // Listas da oferta nas Configurações (com o nome do link escapado).
    const options = await page.evaluate(() => {
      const comp = (window as unknown as EditorWindow).ed.getWrapper()?.find('[data-os-widget="lead-form"]')[0];
      const opts = (name: string) => (comp?.getTrait(name)?.get("options") ?? []) as { id: string; label: string }[];
      return { pages: opts("os-lf-page"), links: opts("data-os-link") };
    });
    expect(options.pages.map((o) => o.label)).toEqual(["— nenhuma —", "Vendas", "Obrigado"]);
    expect(options.links).toEqual([
      { id: "", label: "— nenhum —" },
      { id: "checkout-principal", label: "Checkout &#60;principal&#62;" },
      { id: "__novo-link__", label: "＋ Criar link da oferta…" },
    ]);
  });

  it("botão: pulsar liga e desliga a classe", async () => {
    const sel = "a.os-btn";
    await setTrait(page, sel, "os-pulse", true);
    expect((await attrs(page, sel)).class).toContain("os-pulse");
    await setTrait(page, sel, "os-pulse", false);
    expect((await attrs(page, sel)).class ?? "").not.toContain("os-pulse");
  });

  it("o painel Configurações mostra as opções em português e o liga/desliga funciona", async () => {
    await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const popup = ed.getWrapper()?.find('[data-os-widget="exit-popup"]')[0];
      if (popup) ed.select(popup);
    });
    const panel = page.locator("#traits");
    await expect.poll(() => panel.textContent()).toContain("Quando tentar voltar (botão voltar)");
    const text = (await panel.textContent()) ?? "";
    expect(text).toContain("Computador: quando o mouse sair da página");
    expect(text).toContain("Uma vez por visita");
    const row = panel.locator(".gjs-trt-trait__wrp-data-os-back");
    const box = row.locator('input[type="checkbox"]');
    expect(await box.isChecked()).toBe(false);
    await row.locator("label").click();
    expect((await attrs(page, '[data-os-widget="exit-popup"]'))["data-os-back"]).toBe("1");
    expect(pageErrors(page)).toEqual([]);
  });
});
