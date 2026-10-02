/**
 * Revisão da Fase 3 (grupo W): editor de verdade (GrapesJS num Chromium).
 *
 * - #23 CSS dos widgets no canvas sobrevive à primeira abertura (asDocument);
 * - #34 formulário sem destino ganha rótulo de aviso no canvas; modelos com
 *   mensagem de sucesso neutra;
 * - #51 o destino escolhido por último vale (endereço/página do funil desligam
 *   o link da oferta; número do WhatsApp e endereço do botão também);
 * - #55 endereços sem https:// ganham o https:// (formulário, webhook e botão);
 * - #54 "Tocar sozinho" do vídeo (arquivo) liga junto "sem som";
 * - #59 link que não é de vídeo incorporável avisa no canvas;
 * - #2 chave de link apagada aparece escapada na lista (sem virar HTML no painel).
 */
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureHtml } from "@/editor/templates/capture";
import { leadForm } from "@/editor/templates/widgets";
import {
  addBlock,
  attrs,
  type EditorWindow,
  exportPage,
  openEditor,
  pageErrors,
  setAttrs,
  setTrait,
} from "./blocks-harness";
import { fakeId } from "./helpers";

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

/** Estilo calculado de um elemento no canvas (ou de um pseudo-elemento). */
function canvasStyle(page: Page, selector: string, prop: string, pseudo?: string) {
  return page.evaluate(
    ([sel, p, ps]) => {
      const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
      const el = doc.querySelector(sel as string);
      if (!el) return null;
      return doc.defaultView?.getComputedStyle(el, (ps as string) || null).getPropertyValue(p as string) ?? null;
    },
    [selector, prop, pseudo ?? ""] as const,
  );
}

// ─── #23 ─────────────────────────────────────────────────────────────────────

describe("#23 CSS dos widgets no canvas na primeira abertura", () => {
  it("depois do setComponents(html, { asDocument }) do editor-app, popup e rótulos continuam aparecendo", async () => {
    const page = await openEditor(browser);
    // Mesma ordem do editor-app na primeira abertura (payload.project === null).
    await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      ed.setComponents(
        '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Vendas</title></head><body><h1>Oferta</h1><a href="#" class="os-btn" data-os-link="">Comprar</a></body></html>',
        { asDocument: true } as never,
      );
    });
    await addBlock(page, "popup-saida");
    await addBlock(page, "notificacao-compra");
    await page.waitForTimeout(50);
    expect(await canvasStyle(page, '[data-os-widget="exit-popup"]', "display")).not.toBe("none");
    expect(await canvasStyle(page, '[data-os-widget="sales-notification"]', "display")).not.toBe("none");
    expect(await canvasStyle(page, '[data-os-widget="exit-popup"]', "content", "::before")).toContain("Popup de saída");
    expect(await canvasStyle(page, 'a[data-os-link=""]', "content", "::after")).toContain("Escolha o link");
    // A cópia no <head> voltou sozinha (e não duplicou).
    const count = await page.evaluate(
      () =>
        ((window as unknown as EditorWindow).ed.Canvas.getDocument() as Document).querySelectorAll("#os-widgets-canvas")
          .length,
    );
    expect(count).toBe(1);
    // Nada disso vai para a página.
    const html = await exportPage(page);
    expect(html).not.toContain("os-widgets-canvas");
    expect(html).not.toContain("Escolha o link");
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });
});

// ─── #34 ─────────────────────────────────────────────────────────────────────

describe("#34 formulário sem destino", () => {
  const FORM = '[data-os-widget="lead-form"]';
  const label = (page: Page) => canvasStyle(page, FORM, "content", "::before");

  it("o canvas avisa até ter webhook, endereço, página do funil ou link da oferta", async () => {
    const page = await openEditor(browser, {
      pages: [
        { id: fakeId("vendas"), name: "Vendas" },
        { id: fakeId("obrigado"), name: "Obrigado" },
      ],
      links: [{ key: "checkout", label: "Checkout", kind: "CHECKOUT" }],
    });
    await addBlock(page, "form-captura");
    expect(await label(page)).toContain("Formulário sem destino");

    await setTrait(page, FORM, "data-os-webhook", "https://hooks.test/lead");
    expect(await label(page)).toBe("none");
    await setTrait(page, FORM, "data-os-webhook", "");
    expect(await label(page)).toContain("Formulário sem destino");

    await setTrait(page, FORM, "os-lf-url", "https://exemplo.com/obrigado");
    expect(await label(page)).toBe("none");
    await setTrait(page, FORM, "os-lf-url", "");
    expect(await label(page)).toContain("Formulário sem destino");

    await setTrait(page, FORM, "os-lf-page", fakeId("obrigado"));
    expect(await label(page)).toBe("none");
    await setTrait(page, FORM, "os-lf-page", "");
    await setTrait(page, FORM, "data-os-link", "checkout");
    expect(await label(page)).toBe("none");
    // O rótulo é só do canvas.
    expect(await exportPage(page, { links: [{ key: "checkout", url: "https://pay.test/x" }] })).not.toContain(
      "Formulário sem destino",
    );
    await page.close();
  });

  it("o formulário dos modelos (sem atributo action) também ganha o aviso", async () => {
    const page = await openEditor(browser);
    await page.evaluate(
      (html) => {
        (window as unknown as EditorWindow).ed.getWrapper()?.append(html);
      },
      leadForm({ button: "QUERO" }),
    );
    expect(await label(page)).toContain("Formulário sem destino");
    await page.close();
  });

  it("modelos: mensagem de sucesso neutra (não promete e-mail nem material)", () => {
    expect(captureHtml).not.toMatch(/Enviamos/);
    expect(captureHtml).toContain('data-os-success="Pronto! Recebemos seus dados."');
    expect(leadForm({ button: "x" })).toContain('data-os-success="Pronto! Recebemos seus dados."');
  });
});

// ─── #51 / #55 ───────────────────────────────────────────────────────────────

describe("#51 o destino escolhido por último vale", () => {
  const FORM = '[data-os-widget="lead-form"]';
  const thanks = fakeId("obrigado");
  const ctx = {
    pages: [
      { id: fakeId("vendas"), name: "Vendas" },
      { id: thanks, name: "Obrigado" },
    ],
    links: [
      { key: "checkout", label: "Checkout", kind: "CHECKOUT" },
      { key: "whats", label: "WhatsApp", kind: "WHATSAPP" },
    ],
  };
  const LINKS = [
    { key: "checkout", url: "https://pay.test/checkout" },
    { key: "whats", url: "https://wa.me/5561999990000" },
  ];

  it("formulário: link da oferta e depois página do funil → vai para a página", async () => {
    const page = await openEditor(browser, ctx);
    await addBlock(page, "form-captura");
    await setTrait(page, FORM, "data-os-link", "checkout");
    await setTrait(page, FORM, "os-lf-page", thanks);
    const a = await attrs(page, FORM);
    expect(a.action).toBe(`os-page:${thanks}`);
    expect("data-os-link" in a).toBe(false);
    const html = await exportPage(page, { links: LINKS });
    expect(html).toContain(`action="/p/${thanks}"`);
    expect(html).not.toContain("pay.test");
    await page.close();
  });

  it("formulário: link da oferta e depois endereço (sem https://) → vai para o endereço", async () => {
    const page = await openEditor(browser, ctx);
    await addBlock(page, "form-captura");
    await setTrait(page, FORM, "data-os-link", "checkout");
    await setTrait(page, FORM, "os-lf-url", "meusite.com.br/obrigado");
    const a = await attrs(page, FORM);
    expect(a.action).toBe("https://meusite.com.br/obrigado");
    expect("data-os-link" in a).toBe(false);
    expect(await exportPage(page, { links: LINKS })).toContain('action="https://meusite.com.br/obrigado"');
    await page.close();
  });

  it("formulário: página do funil e depois link da oferta → vai para o link (os campos de antes se limpam)", async () => {
    const page = await openEditor(browser, ctx);
    await addBlock(page, "form-captura");
    await setTrait(page, FORM, "os-lf-page", thanks);
    await setTrait(page, FORM, "data-os-link", "checkout");
    const shown = await page.evaluate(() => {
      const comp = (window as unknown as EditorWindow).ed.getWrapper()?.find('[data-os-widget="lead-form"]')[0];
      return { url: comp?.getTrait("os-lf-url")?.getValue(), page: comp?.getTrait("os-lf-page")?.getValue() };
    });
    expect(shown).toEqual({ url: "", page: "" });
    expect(await exportPage(page, { links: LINKS })).toContain('action="https://pay.test/checkout"');
    // "— nenhum —" desliga o link.
    await setTrait(page, FORM, "data-os-link", "");
    expect("data-os-link" in (await attrs(page, FORM))).toBe(false);
    await page.close();
  });

  it("webhook digitado sem https:// é guardado com https://", async () => {
    const page = await openEditor(browser);
    await addBlock(page, "form-captura");
    await setTrait(page, FORM, "data-os-webhook", " hooks.zapier.com/hooks/catch/1/abc/ ");
    expect((await attrs(page, FORM))["data-os-webhook"]).toBe("https://hooks.zapier.com/hooks/catch/1/abc/");
    await page.close();
  });

  it("WhatsApp ligado sozinho ao link da oferta: digitar o número passa a valer", async () => {
    const page = await openEditor(browser, ctx);
    await addBlock(page, "whatsapp-botao");
    const sel = '[data-os-widget="whatsapp"]';
    expect((await attrs(page, sel))["data-os-link"]).toBe("whats");
    // Só a mensagem, com o número de exemplo do bloco: o link continua (nunca manda
    // o visitante para o número de exemplo).
    await setTrait(page, sel, "os-wa-message", "Quero o desconto");
    expect((await attrs(page, sel))["data-os-link"]).toBe("whats");
    await setTrait(page, sel, "os-wa-phone", "(21) 98888-7777");
    expect("data-os-link" in (await attrs(page, sel))).toBe(false);
    const html = await exportPage(page, { links: LINKS });
    expect(html).toContain("https://wa.me/5521988887777?text=Quero%20o%20desconto");
    expect(html).not.toContain("5561999990000");
    await page.close();
  });

  it("botão do checkout: endereço digitado (sem https://) passa a valer e tira o 'escolha o link'", async () => {
    // Sem links na oferta o botão nasce esperando a escolha (data-os-link="").
    // (Com um link ligado, o campo de endereço fica escondido — src/editor/grapes/components.ts.)
    const page = await openEditor(browser);
    await addBlock(page, "cta-checkout");
    const sel = "a.os-btn";
    expect((await attrs(page, sel))["data-os-link"]).toBe("");
    // "#" não é um destino: continua pedindo o link.
    await setTrait(page, sel, "href", "#");
    expect((await attrs(page, sel))["data-os-link"]).toBe("");
    await setTrait(page, sel, "href", "meusite.com.br/oferta");
    const a = await attrs(page, sel);
    expect(a.href).toBe("https://meusite.com.br/oferta");
    expect("data-os-link" in a).toBe(false);
    expect(await exportPage(page, { links: LINKS })).toContain('href="https://meusite.com.br/oferta"');
    await page.close();
  });

  it("o campo de endereço do botão (mesmo trait) desliga um link da oferta ligado antes", async () => {
    const page = await openEditor(browser, ctx);
    await addBlock(page, "cta-checkout");
    const a = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const comp = ed.getWrapper()?.find("a.os-btn")[0];
      if (!comp) throw new Error("sem botão");
      // O tipo os-button define o trait; chamado direto (o painel pode escondê-lo enquanto há link).
      const def = (ed.DomComponents.getType("os-button")?.model.prototype.defaults.traits as { name: string }[]).find(
        (t) => t.name === "href",
      ) as unknown as { setValue: (o: unknown) => void };
      def.setValue({ component: comp, value: "pay.outro.com/x" });
      return comp.getAttributes();
    });
    expect(a.href).toBe("https://pay.outro.com/x");
    expect("data-os-link" in a).toBe(false);
    await page.close();
  });
});

// ─── #54 / #59 ───────────────────────────────────────────────────────────────

describe("#54 e #59 vídeos", () => {
  it("vídeo (arquivo): 'Tocar sozinho' liga junto 'sem som' e 'tocar na página'", async () => {
    const page = await openEditor(browser);
    await addBlock(page, "video-arquivo");
    const sel = "video[data-os-file]";
    await setAttrs(page, sel, { src: "https://cdn.test/v.mp4" });
    await setAttrs(page, sel, { playsinline: "" });
    await page.evaluate(() => {
      (window as unknown as EditorWindow).ed
        .getWrapper()
        ?.find("video[data-os-file]")[0]
        ?.removeAttributes("playsinline");
    });
    await setTrait(page, sel, "os-autoplay", true);
    const on = await attrs(page, sel);
    expect(on.autoplay).toBeTruthy();
    expect(on.muted).toBeTruthy();
    expect(on.playsinline).toBeTruthy();
    const html = await exportPage(page);
    expect(html).toMatch(/<video[^>]*\sautoplay[\s>=]/);
    expect(html).toMatch(/<video[^>]*\smuted[\s>=]/);
    expect(html).toMatch(/<video[^>]*\splaysinline[\s>=]/);
    // "Sem som" continua marcado no painel (checkbox lê o atributo).
    const muted = await page.evaluate(() =>
      (window as unknown as EditorWindow).ed
        .getWrapper()
        ?.find("video[data-os-file]")[0]
        ?.getTrait("muted")
        ?.getValue(),
    );
    expect(muted).toBeTruthy();
    await setTrait(page, sel, "os-autoplay", false);
    expect("autoplay" in (await attrs(page, sel))).toBe(false);
    expect(
      await page.evaluate(() =>
        (window as unknown as EditorWindow).ed
          .getWrapper()
          ?.find("video[data-os-file]")[0]
          ?.getTrait("os-autoplay")
          ?.getValue(),
      ),
    ).toBe(false);
    await page.close();
  });

  it("link que não é de vídeo (canal, painel do Panda) não troca o vídeo e avisa no canvas", async () => {
    const page = await openEditor(browser);
    await addBlock(page, "video-youtube");
    const sel = "[data-os-video]";
    await setTrait(page, sel, "os-video-url", "https://youtu.be/dQw4w9WgXcQ");
    const placeholder = () =>
      page.evaluate(() => {
        const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
        return doc.querySelector("[data-os-video]")?.textContent ?? "";
      });
    expect(await placeholder()).not.toContain("não é de um vídeo");
    await setTrait(page, sel, "os-video-url", "https://www.youtube.com/@meucanal");
    expect((await attrs(page, sel)).src).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0");
    expect(await placeholder()).toContain("Esse link não é de um vídeo que dá para incorporar");
    await setTrait(page, sel, "os-video-url", "https://www.youtube.com/playlist?list=PL123abc");
    expect((await attrs(page, sel)).src).toBe("https://www.youtube.com/embed/videoseries?list=PL123abc&rel=0");
    expect(await placeholder()).not.toContain("não é de um vídeo");
    await page.close();
  });
});

// ─── #2 ──────────────────────────────────────────────────────────────────────

describe("#2 rótulo de link apagado", () => {
  it("a chave que não existe mais aparece escapada e não vira HTML no painel", async () => {
    const page = await openEditor(browser, { links: [{ key: "checkout", label: "Checkout", kind: "CHECKOUT" }] });
    await addBlock(page, "form-captura");
    const key = '<img id="pwn" src="x"><b id="pwn2">x</b>';
    await setAttrs(page, '[data-os-widget="lead-form"]', { "data-os-link": key });
    const lists = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const comp = ed.getWrapper()?.find('[data-os-widget="lead-form"]')[0];
      const trait = comp?.getTrait("data-os-link");
      if (!comp || !trait) throw new Error("sem formulário");
      // Cada lista que chega ao campo (a das Configurações do widget vem primeiro).
      const seen: { id: string; label: string }[][] = [];
      trait.on("change:options", () => seen.push((trait.get("options") ?? []) as { id: string; label: string }[]));
      ed.select(null as never);
      ed.select(comp);
      return seen;
    });
    const removed = lists.flat().find((o) => o.id === key);
    for (const list of lists) for (const o of list) expect(o.label).not.toContain("<");
    expect(removed?.label).toBe(
      "&#60;img id=&#34;pwn&#34; src=&#34;x&#34;&#62;&#60;b id=&#34;pwn2&#34;&#62;x&#60;/b&#62; (removido)",
    );
    expect(await page.evaluate(() => !!document.getElementById("pwn") || !!document.getElementById("pwn2"))).toBe(
      false,
    );
    await page.close();
  });
});
