/**
 * "Esconder sobreposições" no editor de verdade (GrapesJS no Chromium): o botão
 * esconde no CANVAS tudo que flutua por cima (fixo/sticky e modal grande — como
 * o aviso de cookies/CEP/pagamento de uma página clonada) e o pop-up de saída do
 * Offer Studio, deixa o conteúdo normal intacto, volta ao clicar de novo e NÃO
 * mexe no HTML salvo.
 */
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type EditorWindow, exportPage, openEditor, pageErrors } from "./blocks-harness";

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

/** Monta uma página com sobreposições + conteúdo normal no editor. */
async function setPage(page: Page) {
  await page.evaluate(() => {
    const ed = (window as unknown as EditorWindow).ed;
    // O harness não carrega o CSS do GrapesJS, então o quadro fica no tamanho padrão (300x150).
    // Damos um tamanho realista para "fixed no rodapé" ficar mesmo no rodapé (e não perto do topo).
    const frame = ed.Canvas.getFrameEl() as HTMLIFrameElement | undefined;
    if (frame) {
      frame.style.width = "1200px";
      frame.style.height = "800px";
    }
    ed.setComponents(
      [
        // Barras fixas coladas no topo que DEVEM FICAR (navbar + cronômetro empilhado).
        '<header class="navbar" style="position:fixed;top:0;left:0;right:0;height:64px;z-index:1000;background:#222;color:#fff">menu</header>',
        '<div class="cron" style="position:fixed;top:64px;left:0;right:0;height:48px;z-index:1000;background:#c00;color:#fff">00:10:00</div>',
        // Página clonada: barra de cookies fixa (no rodapé), modal grande e um selo pequeno (não é sobreposição).
        '<div class="cookie" style="position:fixed;left:0;right:0;bottom:0;height:60px;z-index:2147483647;background:#111;color:#fff">cookies</div>',
        '<div class="modal" style="position:absolute;top:0;left:0;width:80vw;height:60vh;z-index:9999;background:#000">modal</div>',
        '<span class="badge" style="position:absolute;top:4px;left:4px;width:100px;height:40px;z-index:9999;background:#f00">-50%</span>',
        // Pop-up de saída do próprio Offer Studio.
        '<div data-os-widget="exit-popup" class="saida">Volte!</div>',
        // Conteúdo normal da página (o que a pessoa quer editar).
        '<section class="conteudo" style="min-height:1200px">Conteúdo da página</section>',
      ].join(""),
    );
  });
}

/** display calculado de cada seletor no canvas do editor. */
async function displays(page: Page, selectors: string[]): Promise<Record<string, string>> {
  return page.evaluate((sels) => {
    const ed = (window as unknown as EditorWindow).ed;
    const doc = ed.Canvas.getDocument();
    const win = doc?.defaultView;
    const out: Record<string, string> = {};
    for (const sel of sels) {
      const el = doc?.body.querySelector(sel);
      out[sel] = el && win ? win.getComputedStyle(el).display : "sem-elemento";
    }
    return out;
  }, selectors);
}

const SELS = [".navbar", ".cron", ".cookie", ".modal", ".badge", '[data-os-widget="exit-popup"]', ".conteudo"];

describe("esconder sobreposições no editor", () => {
  it("esconde fixo/modal/pop-up, mantém o conteúdo e o selo pequeno, e volta ao desligar", async () => {
    const page = await openEditor(browser);
    await setPage(page);

    // Antes: nada escondido pela sobreposição (o modal/cookie cobrem o conteúdo).
    const before = await displays(page, SELS);
    expect(before[".conteudo"]).not.toBe("none");
    expect(before[".cookie"]).not.toBe("none");

    // Liga o "Esconder sobreposições".
    await page.evaluate(() => {
      const w = window as unknown as EditorWindow & { __hider?: ReturnType<EditorWindow["OS"]["createOverlayHider"]> };
      w.__hider = w.OS.createOverlayHider(w.ed);
      w.__hider.enable();
    });
    const on = await displays(page, SELS);
    expect(on[".cookie"]).toBe("none"); // barra de cookies no rodapé
    expect(on[".modal"]).toBe("none"); // modal grande
    expect(on['[data-os-widget="exit-popup"]']).toBe("none"); // pop-up de saída
    expect(on[".badge"]).not.toBe("none"); // selo pequeno continua (não cobre)
    expect(on[".conteudo"]).not.toBe("none"); // o conteúdo da página continua editável
    // As barras coladas no topo FICAM (navbar e cronômetro são para editar, não cobrem o conteúdo).
    expect(on[".navbar"]).not.toBe("none");
    expect(on[".cron"]).not.toBe("none");
    // O atributo liga no <html> do canvas (não no modelo).
    expect(
      await page.evaluate(() =>
        (window as unknown as EditorWindow).ed.Canvas.getDocument()?.documentElement.hasAttribute("data-os-hide-ov"),
      ),
    ).toBe(true);

    // Desliga: as sobreposições voltam.
    await page.evaluate(() => {
      (window as unknown as EditorWindow & { __hider: { disable(): void } }).__hider.disable();
    });
    const off = await displays(page, SELS);
    expect(off[".cookie"]).not.toBe("none");
    expect(off[".modal"]).not.toBe("none");

    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });

  it("não vai para o HTML salvo (nem o atributo nem o esconder)", async () => {
    const page = await openEditor(browser);
    await setPage(page);
    // Esconde e exporta: o salvamento sai limpo e com as sobreposições intactas.
    await page.evaluate(() => {
      const w = window as unknown as EditorWindow;
      w.OS.createOverlayHider(w.ed).enable();
    });
    const html = await exportPage(page);
    expect(html).not.toContain("data-os-hide-ov");
    expect(html).not.toContain("data-os-ov");
    expect(html).toContain("cookies"); // a barra de cookies continua na página final
    expect(html).toContain("Conteúdo da página");
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });
});
