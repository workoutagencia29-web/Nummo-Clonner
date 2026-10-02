/**
 * Fase 6 (polimento E), no editor-app.tsx de verdade (harness E1):
 * - clique no texto de um botão (Elementor: <a><span><span>) seleciona o botão;
 *   outro clique entra no texto, com o atalho "Configurar o botão"; dois cliques editam;
 * - painéis recolhíveis ("[" e "]", guardado), zoom com "Tamanho real (100%)"
 *   e rolagem para os lados, janela estreita com aviso;
 * - Modo prévia esconde os painéis; "Histórico", "Ver página", "Computador";
 * - Estilo: classes e estados em "Avançado", aviso do estado ":hover";
 * - "Escolher imagem" com role=dialog, "Cancelar" e Esc; iframe do canvas com título;
 * - nome da página igual ao da oferta aparece uma vez.
 */
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  appBundle,
  FakeServer,
  makePayload,
  openApp,
  type Session,
  sleep,
  waitFor,
  withEditor,
} from "./fix3-E1-harness";

let browser: Browser;
beforeAll(async () => {
  await appBundle();
  browser = await chromium.launch();
}, 180_000);
afterAll(async () => {
  await browser?.close();
});

const sessions: Session[] = [];
afterAll(async () => {
  for (const s of sessions) await s.page.close().catch(() => undefined);
});

const BUTTON_PAGE = `<!doctype html><html><head><title>T</title></head><body>
<h1 id="t">Título</h1>
<a id="cta" href="#" data-os-link="" class="elementor-button"><span class="elementor-button-content-wrapper"><span id="txt" class="elementor-button-text">QUERO COMEÇAR AGORA</span></span></a>
<p id="p">Parágrafo da página</p>
<img id="img" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="">
</body></html>`;

async function openDoc(
  id: string,
  over: Partial<Parameters<typeof makePayload>[0]> = {},
  opts: Parameters<typeof openApp>[3] = {},
) {
  const server = new FakeServer();
  server.add(makePayload({ documentId: id, html: BUTTON_PAGE, ...over }));
  const s = await openApp(browser, server, id, opts);
  sessions.push(s);
  if (opts.waitReady !== false) await waitFor(() => server.okPuts.length === 1, 8000, "primeiro salvamento");
  return s;
}

const selectedId = (s: Session) => withEditor<string | null>(s.page, "(ed) => ed.getSelected()?.getId() ?? null");
const frame = (s: Session) => s.page.frameLocator("iframe.gjs-frame");
const left = (s: Session) => s.page.locator('aside[aria-label="Blocos e camadas"]');
const right = (s: Session) => s.page.locator('aside[aria-label="Estilo e configurações"]');

/**
 * Leva o mouse para o canvas antes do primeiro clique: no Chromium do teste, o
 * primeiro clique num link logo ao entrar no iframe não chega ao GrapesJS.
 */
async function enterCanvas(s: Session) {
  await frame(s).locator("#p").hover();
}

/** Clique num botão da barra (o harness não tem o Tailwind: a barra corta o que não cabe). */
async function clickHidden(s: Session, name: RegExp) {
  await s.page.getByRole("button", { name }).evaluate((b) => (b as HTMLButtonElement).click());
}

/** Tira o foco de campos e do canvas (as teclas "[" e "]" valem fora deles). */
async function blur(s: Session) {
  await s.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
}

describe("clique no botão de página clonada", { timeout: 40_000 }, () => {
  it("1º clique seleciona o link (com Link da oferta); outro clique entra no texto; o atalho volta ao botão", async () => {
    const s = await openDoc("docbotaoclique0000000001");
    await enterCanvas(s);
    await frame(s).locator("#txt").click();
    await waitFor(async () => (await selectedId(s)) === "cta", 3000, "link selecionado");
    await s.page.getByRole("tab", { name: "Configurações" }).click();
    const traits = s.page.locator('[data-os-panel="config"]');
    await traits.getByText("Link da oferta", { exact: true }).waitFor();
    expect(await traits.getByText("Evento ao clicar", { exact: true }).count()).toBe(1);

    // Outro clique (com o botão já selecionado): entra no texto, e o painel mostra o atalho.
    await sleep(600);
    await frame(s).locator("#txt").click();
    await waitFor(async () => (await selectedId(s)) === "txt", 3000, "texto selecionado");
    await traits.getByText("Este texto está dentro de um botão ou link.").waitFor();
    await traits.getByRole("button", { name: "Configurar o botão" }).click();
    await waitFor(async () => (await selectedId(s)) === "cta", 3000, "voltou ao link");
    expect(s.errors).toEqual([]);
  });

  it("dois cliques editam o texto do botão (o botão continua selecionado)", async () => {
    const s = await openDoc("docbotaoclique0000000002");
    await enterCanvas(s);
    await frame(s).locator("#txt").dblclick();
    await waitFor(
      () => withEditor<boolean>(s.page, "(ed) => Boolean(ed.getEditing())"),
      3000,
      "edição de texto aberta",
    );
    expect(await selectedId(s)).toBe("cta");
    expect(s.errors).toEqual([]);
  });

  it("título e parágrafo fora de botão: o clique seleciona o próprio elemento", async () => {
    const s = await openDoc("docbotaoclique0000000003");
    await enterCanvas(s);
    await frame(s).locator("#p").click();
    await waitFor(async () => (await selectedId(s)) === "p", 3000, "parágrafo");
    // Seleção pelas camadas/código não é desviada.
    await withEditor(s.page, `(ed) => { ed.select(ed.getWrapper().find("#txt")[0]); return true; }`);
    expect(await selectedId(s)).toBe("txt");
  });
});

describe("espaço na tela", { timeout: 40_000 }, () => {
  it("'[' e ']' recolhem os painéis (guardado); o zoom cresce com mais espaço", async () => {
    const s = await openDoc("docpaineis00000000000001");
    const zoom = s.page.getByRole("button", { name: /^Zoom da página/ });
    const percent = async () => Number.parseInt((await zoom.textContent()) ?? "0", 10);
    await waitFor(async () => (await percent()) > 0, 3000, "zoom");
    const before = await percent();
    expect(before).toBeLessThan(100);
    expect(await left(s).isVisible()).toBe(true);

    await blur(s);
    await s.page.keyboard.press("[");
    await waitFor(async () => !(await left(s).isVisible()), 2000, "blocos escondidos");
    await s.page.keyboard.press("]");
    await waitFor(async () => !(await right(s).isVisible()), 2000, "estilo escondido");
    await waitFor(async () => (await percent()) > before, 3000, "zoom maior");
    expect(await s.page.evaluate(() => localStorage.getItem("offerstudio.editor.paineis"))).toBe(
      JSON.stringify({ left: false, right: false }),
    );

    // Botões da barra fazem o mesmo.
    await clickHidden(s, /^Mostrar os blocos/);
    await waitFor(() => left(s).isVisible(), 2000, "blocos de volta");
    await clickHidden(s, /^Mostrar estilo e configurações/);
    await waitFor(() => right(s).isVisible(), 2000, "estilo de volta");

    // Digitando num campo, "[" é só um caractere.
    const search = s.page.getByRole("textbox", { name: "Achar elemento pelo texto" });
    await s.page.getByRole("tab", { name: "Camadas" }).click();
    await search.fill("");
    await search.type("[");
    expect(await search.inputValue()).toBe("[");
    expect(await left(s).isVisible()).toBe(true);
    await s.page.evaluate(() => localStorage.removeItem("offerstudio.editor.paineis"));
  });

  it("Tamanho real (100%): rola para os lados; Ajustar à janela volta a reduzir", async () => {
    const s = await openDoc("doczoom00000000000000001");
    await s.page.getByRole("button", { name: /^Zoom da página/ }).click();
    await s.page.getByRole("menuitemradio", { name: "Tamanho real (100%)" }).click();
    await waitFor(() => withEditor<boolean>(s.page, "(ed) => ed.Canvas.getZoom() === 100"), 3000, "zoom 100");
    const slider = s.page.getByRole("slider", { name: "Rolar a página para os lados" });
    await slider.waitFor();
    await s.page.evaluate(() => {
      const el = document.querySelector<HTMLInputElement>('input[aria-label="Rolar a página para os lados"]');
      if (!el) throw new Error("sem o controle");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, "200");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await waitFor(
      () => withEditor<boolean>(s.page, "(ed) => ed.Canvas.getCoords().x < -100"),
      3000,
      "página deslocada",
    );
    await s.page.getByRole("button", { name: /^Zoom da página/ }).click();
    await s.page.getByRole("menuitemradio", { name: "Ajustar à janela" }).click();
    await waitFor(() => withEditor<boolean>(s.page, "(ed) => ed.Canvas.getZoom() < 100"), 3000, "ajustado");
    expect(await slider.count()).toBe(0);
    expect(s.errors).toEqual([]);
  });

  it("janela média: Blocos começa recolhido; janela estreita: aviso com 'Ver página' e 'Voltar para a oferta'", async () => {
    const medium = await openDoc("docjanelamedia0000000001", {}, { viewport: { width: 1100, height: 900 } });
    expect(await left(medium).isVisible()).toBe(false);
    expect(await right(medium).isVisible()).toBe(true);
    expect(await medium.page.getByText("O editor precisa de uma janela maior").count()).toBe(0);

    const narrow = await openDoc("docjanelaestreita0000001", {}, { viewport: { width: 800, height: 900 } });
    const notice = narrow.page.getByRole("alertdialog", { name: "O editor precisa de uma janela maior" });
    await notice.waitFor();
    await notice.getByRole("link", { name: "Voltar para a oferta" }).click();
    await waitFor(() => narrow.server.navs.length === 1, 4000, "navegação");
    expect(narrow.server.navs).toEqual(["/ofertas/oferta00000000000000001"]);
  });
});

describe("modo prévia e nomes", { timeout: 40_000 }, () => {
  it("Modo prévia esconde os painéis e explica; 'Voltar a editar' traz de volta", async () => {
    const s = await openDoc("docmodoprevia00000000001");
    await s.page.getByRole("button", { name: "Modo prévia" }).click();
    await s.page.getByText(/^Modo prévia: a página funciona como para o visitante/).waitFor();
    expect(await left(s).isVisible()).toBe(false);
    expect(await right(s).isVisible()).toBe(false);
    await s.page.getByRole("button", { name: "Voltar a editar" }).click();
    await waitFor(() => left(s).isVisible(), 2000, "painéis de volta");
    expect(await right(s).isVisible()).toBe(true);
  });

  it("barra: 'Histórico', 'Ver página' e o aparelho 'Computador'; o iframe do canvas tem título", async () => {
    const s = await openDoc("docnomesbarra00000000001");
    expect(await s.page.getByRole("button", { name: /^Histórico/ }).count()).toBe(1);
    expect(await s.page.getByRole("button", { name: "Versões" }).count()).toBe(0);
    expect(await s.page.getByRole("button", { name: "Ver página" }).count()).toBe(1);
    expect(await s.page.getByRole("radio", { name: "Computador", exact: true }).count()).toBe(1);
    expect(await s.page.getByRole("radio", { name: "Desktop" }).count()).toBe(0);
    expect(await s.page.locator("iframe.gjs-frame").getAttribute("title")).toBe("Página em edição");

    await s.page.getByRole("button", { name: /^Histórico/ }).click();
    const dialog = s.page.getByRole("dialog", { name: "Histórico" });
    await dialog.getByRole("button", { name: "Salvar ponto de restauração" }).waitFor();
  });

  it("página com o mesmo nome da oferta: o nome aparece uma vez, com o tipo e o endereço embaixo", async () => {
    const id = "docmesmonome000000000001";
    const base = makePayload({ documentId: id });
    const s = await openDoc(id, {
      offer: { id: base.offer.id, name: "Página de vendas" },
    });
    const header = s.page.locator("header");
    const text = (await header.textContent()) ?? "";
    expect(text.split("Página de vendas").length - 1).toBe(2);
    expect(text).toContain("Página de vendas · /");
  });
});

describe("painel de Estilo", { timeout: 40_000 }, () => {
  it("classes e estados ficam em 'Avançado'; mudar o estado mostra o aviso e 'Voltar ao normal'", async () => {
    const s = await openDoc("docestiloavancado0000001");
    await withEditor(s.page, `(ed) => { ed.select(ed.getWrapper().find("#t")[0]); return true; }`);
    const estilo = s.page.locator('[data-os-panel="estilo"]');
    const advanced = estilo.locator("details");
    expect(await advanced.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);
    expect(await advanced.locator("#gjs-clm-states").count()).toBe(1);

    await withEditor(s.page, `(ed) => { ed.Selectors.setState("hover"); return true; }`);
    await estilo.getByText("Você está mudando o estilo “ao passar o mouse”.").waitFor();
    expect(await advanced.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(true);
    await estilo.getByRole("button", { name: "Voltar ao normal" }).click();
    await waitFor(() => withEditor<boolean>(s.page, `(ed) => !ed.Selectors.getState()`), 2000, "estado normal");
    expect(await estilo.getByText(/Você está mudando o estilo/).count()).toBe(0);
  });

  it("o campo 'id' aparece como 'Âncora (para links #)'", async () => {
    const s = await openDoc("docancora000000000000001");
    await withEditor(s.page, `(ed) => { ed.select(ed.getWrapper().find("#p")[0]); return true; }`);
    const labels = await s.page
      .locator('[data-os-panel="config"] .gjs-label')
      .evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()));
    expect(labels).toContain("Âncora (para links #)");
    expect(labels).not.toContain("Id");
  });
});

describe("Escolher imagem", { timeout: 40_000 }, () => {
  it("é um diálogo de verdade: nome, 'Cancelar', Esc fecha", async () => {
    const s = await openDoc("docescolherimagem0000001");
    const openPicker = () =>
      withEditor(
        s.page,
        `(ed) => { const img = ed.getWrapper().find("#img")[0]; ed.select(img); ed.runCommand("open-assets", { target: img, types: ["image"], accept: "image/*" }); return true; }`,
      );
    await openPicker();
    const dialog = s.page.getByRole("dialog", { name: "Escolher imagem" });
    await dialog.waitFor();
    expect(await dialog.getAttribute("aria-modal")).toBe("true");
    expect(await dialog.getByRole("button", { name: "Fechar" }).count()).toBe(1);
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await waitFor(() => withEditor<boolean>(s.page, "(ed) => !ed.Modal.isOpen()"), 2000, "fechou pelo Cancelar");

    await openPicker();
    await dialog.waitFor();
    await s.page.keyboard.press("Escape");
    await waitFor(() => withEditor<boolean>(s.page, "(ed) => !ed.Modal.isOpen()"), 2000, "fechou pelo Esc");
    expect(s.errors).toEqual([]);
  });
});
