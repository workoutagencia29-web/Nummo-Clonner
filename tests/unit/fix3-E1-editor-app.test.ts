/**
 * Correções do editor (Fase 3, grupo E1), com o editor-app.tsx de verdade num
 * Chromium (tests/unit/fix3-E1-harness.ts): salvar o texto que está sendo
 * digitado, ⌘S, sair do editor sem perder nada, conflito entre abas, gravações
 * em fila, novas tentativas, versão celular, "Preservar JS", painel vazio sem
 * seleção e link de prévia vencido.
 */
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  actionCalls,
  appBundle,
  FakeServer,
  makePayload,
  OFFER_ID,
  openApp,
  type Session,
  saveStatusText,
  setActionResult,
  sleep,
  toasts,
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
async function open(server: FakeServer, id: string, opts?: Parameters<typeof openApp>[3]) {
  const s = await openApp(browser, server, id, opts);
  sessions.push(s);
  return s;
}
afterAll(async () => {
  for (const s of sessions) await s.page.close().catch(() => undefined);
});

/** Documento comum já aberto e salvo uma vez (primeira abertura). */
async function freshDoc(id: string, over: Parameters<typeof makePayload>[0] = { documentId: id }) {
  const server = new FakeServer();
  server.add(makePayload({ ...over, documentId: id }));
  const s = await open(server, id);
  await waitFor(() => server.okPuts.length === 1, 8000, "primeiro salvamento");
  await waitFor(async () => (await saveStatusText(s.page)).startsWith("Salvo"), 4000, "Salvo");
  return s;
}

const frameH1 = (s: Session) => s.page.frameLocator("iframe.gjs-frame").locator("h1");
const frameP = (s: Session) => s.page.frameLocator("iframe.gjs-frame").locator("p").first();

async function startTyping(s: Session, text: string) {
  const h1 = frameH1(s);
  await h1.dblclick();
  await waitFor(async () => (await h1.getAttribute("contenteditable")) === "true", 4000, "edição de texto");
  await s.page.keyboard.press("End");
  await s.page.keyboard.type(text);
}

/** Muda um estilo pelo editor (como o painel Estilo faria). */
function setStyle(s: Session, selector: string, style: Record<string, string>) {
  return withEditor(
    s.page,
    `(ed, [sel, style]) => { const c = ed.getWrapper().find(sel)[0]; c.addStyle(style); return true; }`,
    [selector, style],
  );
}

describe("texto sendo digitado (editor de texto aberto)", () => {
  it("conta como alteração; ⌘S grava sem fechar a edição e sem abrir o 'Salvar como' do navegador", async () => {
    const s = await freshDoc("doctexto0000000000000001");
    const { page, server } = s;
    await startTyping(s, " NOVO");
    await waitFor(async () => (await saveStatusText(page)) === "Alterações não salvas", 3000, "estado não salvo");

    // Enquanto digita, o salvamento automático espera (gravar mexeria no cursor).
    await sleep(2000);
    expect(server.puts).toHaveLength(1);

    // A tecla de verdade (dentro do canvas) também é cancelada: nada de "Salvar como…".
    await page
      .frameLocator("iframe.gjs-frame")
      .locator("body")
      .evaluate((body) => {
        body.ownerDocument.addEventListener("keydown", (e) => {
          (body.ownerDocument.defaultView as unknown as { __lastKey: KeyboardEvent }).__lastKey = e;
        });
      });
    await page.keyboard.press("ControlOrMeta+s");
    await waitFor(() => server.okPuts.length === 2, 4000, "gravação do ⌘S");
    expect(server.okPuts[1].html).toContain("Título NOVO");
    const prevented = await page
      .frameLocator("iframe.gjs-frame")
      .locator("body")
      .evaluate(
        (body) =>
          (body.ownerDocument.defaultView as unknown as { __lastKey: KeyboardEvent }).__lastKey?.defaultPrevented,
      );
    expect(prevented).toBe(true);

    // A edição continua aberta, com o cursor no mesmo lugar.
    expect(await frameH1(s).getAttribute("contenteditable")).toBe("true");
    await page.keyboard.type(" MAIS");
    await expect.poll(() => frameH1(s).textContent()).toBe("Título NOVO MAIS");

    // Fechando a edição (clique em outro elemento), o resto é salvo sozinho.
    await frameP(s).click();
    await waitFor(() => server.okPuts.some((p) => p.html.includes("Título NOVO MAIS")), 5000, "salvamento automático");
    await waitFor(async () => (await saveStatusText(page)).startsWith("Salvo"), 4000, "Salvo");
    expect(server.puts.every((p) => p.status === 200)).toBe(true);
    expect(s.errors).toEqual([]);
  });

  it("fechar a aba durante a digitação avisa e grava o texto", async () => {
    const s = await freshDoc("doctexto0000000000000002");
    await startTyping(s, " FECHANDO");
    const prevented = await s.page.evaluate(() => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(prevented).toBe(true);
    await waitFor(() => s.server.okPuts.some((p) => p.html.includes("Título FECHANDO")), 4000, "gravação ao fechar");
  });

  it("'Ver página' grava o texto digitado antes de abrir a aba", async () => {
    const s = await freshDoc("doctexto0000000000000003");
    await startTyping(s, " VISITANTE");
    // Clique sem mousedown (toque no trackpad rápido): a edição ainda está aberta.
    await s.page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Ver página");
      btn?.click();
    });
    await waitFor(() => s.server.log.some((e) => e.kind === "open"), 5000, "abrir como visitante");
    const putIndex = s.server.log.findIndex((e) => e.kind === "put" && e.put.html.includes("Título VISITANTE"));
    const openIndex = s.server.log.findIndex((e) => e.kind === "open");
    expect(putIndex).toBeGreaterThanOrEqual(0);
    expect(putIndex).toBeLessThan(openIndex);
  });
});

describe("sair do editor", () => {
  it("'Voltar para a oferta' logo depois de uma mudança salva antes de sair", async () => {
    const s = await freshDoc("docsair00000000000000001");
    await setStyle(s, "#p", { color: "rgb(1, 2, 3)" });
    await s.page.getByRole("link", { name: "Voltar para a oferta" }).click();
    await waitFor(() => s.server.navs.length === 1, 5000, "navegação");
    expect(s.server.navs).toEqual([`/ofertas/${OFFER_ID}`]);
    const putIndex = s.server.log.findIndex((e) => e.kind === "put" && e.put.css.includes("rgb(1, 2, 3)"));
    const navIndex = s.server.log.findIndex((e) => e.kind === "nav");
    expect(putIndex).toBeGreaterThanOrEqual(0);
    expect(putIndex).toBeLessThan(navIndex);
  });

  it("digitando e saindo pela aba Páginas: o texto vai junto", async () => {
    const s = await freshDoc("docsair00000000000000002");
    await startTyping(s, " PÁGINAS");
    await s.page.getByRole("tab", { name: "Páginas" }).click();
    await s.page.getByRole("button", { name: /Obrigado/ }).click();
    await waitFor(() => s.server.navs.length === 1, 5000, "navegação");
    expect(s.server.navs).toEqual(["/editor/outrodoc000000000000001"]);
    expect(s.server.okPuts.some((p) => p.html.includes("Título PÁGINAS"))).toBe(true);
  });

  it("navegação sem aviso (botão voltar do navegador): grava o pendente ao fechar o editor", async () => {
    const s = await freshDoc("docsair00000000000000003");
    await setStyle(s, "#p", { color: "rgb(4, 5, 6)" });
    await s.page.evaluate(() => (window as unknown as { OS: { unmount(): void } }).OS.unmount());
    await waitFor(() => s.server.okPuts.some((p) => p.css.includes("rgb(4, 5, 6)")), 4000, "gravação ao desmontar");
  });

  it("se não der para salvar, pergunta antes de sair (e não grava depois de 'Sair sem salvar')", async () => {
    const s = await freshDoc("docsair00000000000000004");
    s.server.failNext = ["500", "500", "500"];
    await setStyle(s, "#p", { color: "rgb(7, 8, 9)" });
    await s.page.getByRole("link", { name: "Voltar para a oferta" }).click();
    const dialog = s.page.getByRole("alertdialog", { name: "Sair sem salvar?" });
    await dialog.waitFor();
    expect(s.server.navs).toEqual([]);
    await dialog.getByRole("button", { name: "Sair sem salvar" }).click();
    await waitFor(() => s.server.navs.length === 1, 4000, "navegação");
    const puts = s.server.puts.length;
    await sleep(3500);
    expect(s.server.puts.length).toBe(puts);
  });
});

describe("gravações e erros", () => {
  it("gravações que se sobrepõem entram em fila: nunca duas com a mesma revisão (sem conflito falso)", async () => {
    const s = await freshDoc("docfila00000000000000001");
    s.server.putDelayMs = 900;
    await setStyle(s, "#p", { color: "rgb(10, 0, 0)" });
    await sleep(1700); // o salvamento automático começou e está demorando
    await setStyle(s, "#p", { color: "rgb(20, 0, 0)" });
    const results = await s.page.evaluate(() => {
      const fire = () => {
        const e = new KeyboardEvent("keydown", {
          key: "s",
          metaKey: true,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        });
        window.dispatchEvent(e);
        return e.defaultPrevented;
      };
      return [fire(), fire()];
    });
    expect(results).toEqual([true, true]);
    await setStyle(s, "#p", { color: "rgb(30, 0, 0)" });
    await waitFor(() => s.server.okPuts.some((p) => p.css.includes("rgb(30, 0, 0)")), 10_000, "última gravação");
    await sleep(500);
    expect(s.server.puts.map((p) => p.status).filter((st) => st !== 200)).toEqual([]);
    const revisions = s.server.okPuts.map((p) => p.revision);
    expect(new Set(revisions).size).toBe(revisions.length);
    await expect.poll(() => s.page.getByRole("dialog", { name: /alterada em outra aba/ }).count()).toBe(0);
  });

  it("falha ao salvar: avisa e tenta de novo sozinho", async () => {
    const s = await freshDoc("docerro00000000000000001");
    s.server.failNext = ["500"];
    await setStyle(s, "#p", { color: "rgb(0, 50, 0)" });
    await waitFor(async () => (await saveStatusText(s.page)).startsWith("Erro ao salvar"), 5000, "erro");
    const toasts = await s.page.evaluate(
      () => (window as unknown as { __toasts: { type: string; id?: string }[] }).__toasts,
    );
    expect(toasts.filter((t) => t.type === "error" && t.id === "os-save")).toHaveLength(1);
    // Nova tentativa em ~3 s, sem nenhuma ação.
    await waitFor(() => s.server.okPuts.some((p) => p.css.includes("rgb(0, 50, 0)")), 6000, "nova tentativa");
    await waitFor(async () => (await saveStatusText(s.page)).startsWith("Salvo"), 3000, "Salvo");
  });

  it("sem conexão: mostra aviso (antes só mudava o texto da barra) e tenta de novo", async () => {
    const s = await freshDoc("docerro00000000000000002");
    s.server.failNext = ["abort"];
    await setStyle(s, "#p", { color: "rgb(0, 60, 0)" });
    await waitFor(async () => (await saveStatusText(s.page)).startsWith("Erro ao salvar"), 5000, "erro");
    const toasts = await s.page.evaluate(
      () => (window as unknown as { __toasts: { type: string; message: string }[] }).__toasts,
    );
    expect(toasts.some((t) => t.type === "error" && t.message === "Sem conexão com o Offer Studio.")).toBe(true);
    await waitFor(() => s.server.okPuts.some((p) => p.css.includes("rgb(0, 60, 0)")), 6000, "nova tentativa");
  });

  it("⌘S com o foco num campo do painel salva e não abre o 'Salvar como'", async () => {
    const s = await freshDoc("docatalho0000000000000001");
    await withEditor(s.page, `(ed) => { ed.select(ed.getWrapper().find("#t")[0]); return true; }`);
    const input = s.page.locator(".gjs-sm-property input").first();
    await input.focus();
    const check = s.page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const onKey = (e: KeyboardEvent) => {
            if (e.key !== "s") return;
            window.removeEventListener("keydown", onKey);
            resolve(e.defaultPrevented);
          };
          window.addEventListener("keydown", onKey);
        }),
    );
    await s.page.keyboard.press("ControlOrMeta+s");
    expect(await check).toBe(true);
    await waitFor(() => s.server.okPuts.length === 2, 4000, "gravação");
  });

  it("⌘S com um valor digitado (sem Enter) num campo do Estilo: o valor entra no que é salvo", async () => {
    const s = await freshDoc("docatalho0000000000000002");
    await withEditor(s.page, `(ed) => { ed.select(ed.getWrapper().find("#t")[0]); return true; }`);
    await sleep(200);
    const input = s.page.locator(".gjs-sm-property__font-size input").first();
    await input.click();
    await input.fill("61");
    await s.page.keyboard.press("ControlOrMeta+s");
    await waitFor(() => s.server.okPuts.length === 2, 4000, "gravação do ⌘S");
    expect(s.server.okPuts[1].css).toMatch(/#t\{[^}]*font-size:61px/);
    const size = await s.page
      .frameLocator("iframe.gjs-frame")
      .locator("h1")
      .evaluate((el) => getComputedStyle(el).fontSize);
    expect(size).toBe("61px");
    await waitFor(async () => (await saveStatusText(s.page)).startsWith("Salvo"), 4000, "Salvo");
    // Nada pendente: fechar a aba não avisa.
    const prevented = await s.page.evaluate(() => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(prevented).toBe(false);
  });

  it("⌘S com um endereço digitado em Configurações: o endereço novo é salvo", async () => {
    const id = "docatalho0000000000000003";
    const s = await freshDoc(id, {
      documentId: id,
      html: `<!doctype html><html><head><title>T</title></head><body><h1 id="t">T</h1><a id="buy" href="https://old.example.com/x">Comprar</a></body></html>`,
    });
    await withEditor(s.page, `(ed) => { ed.select(ed.getWrapper().find("#buy")[0]); return true; }`);
    await s.page.getByRole("tab", { name: "Configurações" }).click();
    await sleep(200);
    const field = s.page.locator(".gjs-trt-trait", { hasText: "Endereço do link" }).locator("input").first();
    await field.click();
    await field.fill("https://pay.hotmart.com/NOVO");
    await s.page.keyboard.press("ControlOrMeta+s");
    await waitFor(() => s.server.okPuts.length === 2, 4000, "gravação do ⌘S");
    expect(s.server.okPuts[1].html).toContain('href="https://pay.hotmart.com/NOVO"');
  });

  it("fechar a aba com um valor digitado (sem Enter) num campo: avisa e grava", async () => {
    const s = await freshDoc("docatalho0000000000000004");
    await withEditor(s.page, `(ed) => { ed.select(ed.getWrapper().find("#t")[0]); return true; }`);
    await sleep(200);
    const input = s.page.locator(".gjs-sm-property__font-size input").first();
    await input.click();
    await input.fill("47");
    const prevented = await s.page.evaluate(() => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(prevented).toBe(true);
    await waitFor(() => s.server.okPuts.some((p) => /font-size:47px/.test(p.css)), 4000, "gravação ao fechar");
  });
});

describe("conflito entre abas", () => {
  async function conflicted(id: string) {
    const s = await freshDoc(id);
    // Outra aba salvou: o servidor está numa revisão mais nova.
    const doc = s.server.docs.get(id);
    if (doc) doc.revision = 7;
    await setStyle(s, "#p", { color: "rgb(90, 0, 0)" });
    const dialog = s.page.getByRole("dialog", { name: "Esta página foi alterada em outra aba" });
    await dialog.waitFor();
    return { s, dialog };
  }

  it("fechar o diálogo e continuar editando não grava por cima da outra aba", async () => {
    const { s } = await conflicted("docconflito00000000000001");
    await s.page.keyboard.press("Escape");
    await setStyle(s, "#p", { color: "rgb(91, 0, 0)" });
    const puts = s.server.puts.length;
    await sleep(2500);
    expect(s.server.puts.length).toBe(puts);
    expect(await saveStatusText(s.page)).toBe("Conflito ao salvar");
    // Fechar a aba avisa, mas não grava.
    const prevented = await s.page.evaluate(() => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(prevented).toBe(true);
    await sleep(500);
    expect(s.server.puts.length).toBe(puts);
    // O aviso da barra reabre a escolha; "Manter a minha" grava com a revisão nova.
    await s.page.getByRole("button", { name: "Conflito ao salvar" }).click();
    const dialog = s.page.getByRole("dialog", { name: "Esta página foi alterada em outra aba" });
    await dialog.getByRole("button", { name: "Manter a minha (sobrescrever)" }).click();
    await waitFor(() => s.server.okPuts.some((p) => p.css.includes("rgb(91, 0, 0)")), 4000, "sobrescrever");
    expect(s.server.okPuts.at(-1)?.revision).toBe(7);
  });

  it("sair quando o salvamento dá conflito agora: uma pergunta só (não duas janelas uma sobre a outra)", async () => {
    const id = "docconflito00000000000003";
    const s = await freshDoc(id);
    const doc = s.server.docs.get(id);
    if (doc) doc.revision = 9;
    await setStyle(s, "#p", { color: "rgb(92, 0, 0)" });
    const dialogs = () =>
      s.page.evaluate(() =>
        [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].map(
          (d) => `${d.getAttribute("role")}: ${d.querySelector("h2")?.textContent ?? ""}`,
        ),
      );
    await s.page.getByRole("link", { name: "Voltar para a oferta" }).click();
    await s.page.getByRole("alertdialog", { name: "Sair sem salvar?" }).waitFor();
    await sleep(300);
    expect(await dialogs()).toEqual(["alertdialog: Sair sem salvar?"]);
    expect(await s.page.getByRole("alertdialog").textContent()).toContain("salva em outra aba");

    // "Continuar editando": volta a escolha do conflito (só ela).
    await s.page.getByRole("button", { name: "Continuar editando" }).click();
    await s.page.getByRole("dialog", { name: "Esta página foi alterada em outra aba" }).waitFor();
    await sleep(300);
    expect(await dialogs()).toEqual(["dialog: Esta página foi alterada em outra aba"]);

    // Fecha, tenta sair de novo e sai sem salvar: nada é gravado por cima da outra aba.
    await s.page.keyboard.press("Escape");
    await s.page.getByRole("dialog").waitFor({ state: "hidden" });
    const puts = s.server.puts.length;
    await s.page.getByRole("link", { name: "Voltar para a oferta" }).click();
    await s.page.getByRole("alertdialog", { name: "Sair sem salvar?" }).waitFor();
    expect(await dialogs()).toEqual(["alertdialog: Sair sem salvar?"]);
    await s.page.getByRole("button", { name: "Sair sem salvar" }).click();
    await waitFor(() => s.server.navs.length === 1, 4000, "navegação");
    expect(s.server.navs).toEqual([`/ofertas/${OFFER_ID}`]);
    await sleep(300);
    expect(await dialogs()).toEqual([]);
    expect(s.server.puts.length).toBe(puts);
  });

  it("'Recarregar o que foi salvo' recarrega sem gravar nada", async () => {
    const { s, dialog } = await conflicted("docconflito00000000000002");
    const puts = s.server.puts.length;
    const reloaded = s.page.waitForEvent("load");
    await dialog.getByRole("button", { name: "Recarregar o que foi salvo" }).click();
    await reloaded;
    await sleep(500);
    expect(s.server.puts.length).toBe(puts);
  });
});

describe("painel da direita sem nada selecionado", () => {
  it("mostra o que fazer em vez de controles que não agem", async () => {
    const s = await freshDoc("docvazio00000000000000001");
    const estilo = s.page.locator('[data-os-panel="estilo"]');
    const config = s.page.locator('[data-os-panel="config"]');
    await expect.poll(() => s.page.getByText("Selecione um elemento na página").count()).toBe(2);
    expect(await estilo.getAttribute("class")).toContain("hidden");
    expect(await config.getAttribute("class")).toContain("hidden");
    await withEditor(s.page, `(ed) => { ed.select(ed.getWrapper().find("#t")[0]); return true; }`);
    await expect.poll(() => s.page.getByText("Selecione um elemento na página").count()).toBe(0);
    expect(await estilo.getAttribute("class")).not.toContain("hidden");
    // Apagou o elemento selecionado: volta a explicação.
    await withEditor(s.page, `(ed) => { ed.getWrapper().find("#t")[0].remove(); return true; }`);
    await expect.poll(() => s.page.getByText("Selecione um elemento na página").count()).toBe(2);
  });
});

describe("modo prévia e 'Ver página'", () => {
  it("'Ver página' tem nome acessível e dica mesmo com a tela estreita", async () => {
    const server = new FakeServer();
    server.add(makePayload({ documentId: "docvisitante0000000000001" }));
    const s = await open(server, "docvisitante0000000000001", { viewport: { width: 1100, height: 900 } });
    await expect.poll(() => s.page.getByRole("button", { name: "Ver página" }).count()).toBe(1);
  });

  it("a Prévia tem a largura real do dispositivo (Desktop 1280px), reduzida para caber na área", async () => {
    const id = "docprevialargura000000001";
    const server = new FakeServer();
    server.add(makePayload({ documentId: id }));
    const s = await open(server, id, { viewport: { width: 1280, height: 800 } });
    await waitFor(() => server.okPuts.length === 1, 8000, "primeiro salvamento");
    await s.page.getByRole("button", { name: "Modo prévia" }).click();
    const frame = s.page.locator('iframe[title="Prévia da página"]');
    const measure = async () => {
      await frame.waitFor();
      await s.page.frameLocator('iframe[title="Prévia da página"]').locator("h1").waitFor();
      const inner = await s.page
        .frameLocator('iframe[title="Prévia da página"]')
        .locator("h1")
        .evaluate(() => window.innerWidth);
      const box = await frame.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const a = (el.parentElement as HTMLElement).getBoundingClientRect();
        return { left: r.left - a.left, right: a.right - r.right, bottom: a.bottom - r.bottom, width: r.width };
      });
      return { inner, ...box };
    };
    const desk = await measure();
    expect(desk.inner).toBe(1280);
    // Cabe na área (reduzida), sem cortar dos lados nem embaixo.
    expect(desk.width).toBeLessThan(1280);
    expect(desk.left).toBeGreaterThanOrEqual(0);
    expect(desk.right).toBeGreaterThanOrEqual(0);
    expect(desk.bottom).toBeGreaterThanOrEqual(-1);

    await s.page.getByRole("radio", { name: "Tablet" }).click();
    await expect.poll(async () => (await measure()).inner).toBe(768);
    await s.page.getByRole("radio", { name: "Celular", exact: true }).click();
    await expect.poll(async () => (await measure()).inner).toBe(375);
    const mob = await measure();
    expect(mob.width).toBeCloseTo(375, 0);
    expect(Math.abs(mob.left - mob.right)).toBeLessThan(2);
  });

  it("pede um link de prévia novo quando o anterior está para vencer (12 h)", async () => {
    const s = await freshDoc("docprevia000000000000001");
    const visitor = s.page.getByRole("button", { name: "Ver página" });
    await visitor.click();
    await waitFor(() => s.server.log.filter((e) => e.kind === "open").length === 1, 4000, "primeira aba");
    await visitor.click();
    await waitFor(() => s.server.log.filter((e) => e.kind === "open").length === 2, 4000, "segunda aba");
    const calls = () =>
      s.page.evaluate(
        () =>
          (window as unknown as { __actionCalls: { name: string }[] }).__actionCalls.filter(
            (c) => c.name === "offerPreviewUrlAction",
          ).length,
      );
    expect(await calls()).toBe(1);
    // 11 h e meia depois (o link vale 12 h).
    await s.page.evaluate(() => {
      const real = Date.now.bind(Date);
      Date.now = () => real() + 11.5 * 60 * 60 * 1000;
    });
    await visitor.click();
    await waitFor(() => s.server.log.filter((e) => e.kind === "open").length === 3, 4000, "terceira aba");
    expect(await calls()).toBe(2);
    const opened = s.server.log.flatMap((e) => (e.kind === "open" ? [e.url] : []));
    expect(opened).toEqual(["http://preview.test/t1/", "http://preview.test/t1/", "http://preview.test/t2/"]);
  });
});

describe("páginas com versão para computador e versão celular", { timeout: 40_000 }, () => {
  const DESKTOP = "docdesktop000000000000001";
  const MOBILE = "doccelular000000000000001";

  it("na versão celular, as edições valem para qualquer celular (sem @media de 480 px)", async () => {
    const s = await freshDoc(MOBILE, {
      documentId: MOBILE,
      device: "MOBILE",
      documents: [
        { id: DESKTOP, device: "DESKTOP" },
        { id: MOBILE, device: "MOBILE" },
      ],
    });
    await withEditor(s.page, `(ed) => { ed.select(ed.getWrapper().find("#t")[0]); return true; }`);
    await waitFor(
      () => withEditor<boolean>(s.page, "(ed) => ed.StyleManager.getSelectedAll().length > 0"),
      3000,
      "alvo do Estilo",
    );
    await withEditor(
      s.page,
      `(ed) => { ed.StyleManager.getSelected().addStyle({ color: "rgb(0, 0, 200)" }); return true; }`,
    );
    await waitFor(() => s.server.okPuts.some((p) => p.css.includes("rgb(0, 0, 200)")), 5000, "gravação");
    const css = s.server.okPuts.at(-1)?.css ?? "";
    expect(css).toContain("#t{color:rgb(0, 0, 200);}");
    expect(css).not.toContain("@media");

    // Trocar para a versão computador: salva e abre o outro documento.
    await s.page.getByRole("radio", { name: "Layout do computador" }).click();
    await waitFor(() => s.server.navs.length === 1, 4000, "navegação");
    expect(s.server.navs).toEqual([`/editor/${DESKTOP}`]);

    // "Ver página" no layout do celular abre o layout do celular.
    await s.page.getByRole("button", { name: "Ver página" }).click();
    await waitFor(() => s.server.log.some((e) => e.kind === "open"), 4000, "visitante");
    const opened = s.server.log.find((e) => e.kind === "open");
    expect(opened?.kind === "open" && opened.url).toBe("http://preview.test/t1/?dispositivo=celular");
  });

  it("na versão computador, olhar o celular avisa que o celular vê outra versão", async () => {
    const s = await freshDoc(DESKTOP, {
      documentId: DESKTOP,
      device: "DESKTOP",
      documents: [
        { id: DESKTOP, device: "DESKTOP" },
        { id: MOBILE, device: "MOBILE" },
      ],
    });
    expect(await s.page.getByText(/layout separado para celular/).count()).toBe(0);
    await s.page.getByRole("radio", { name: "Celular", exact: true }).click();
    await s.page.getByText(/layout separado para celular/).waitFor();
    await s.page.getByRole("button", { name: "Editar o layout do celular" }).click();
    await waitFor(() => s.server.navs.length === 1, 4000, "navegação");
    expect(s.server.navs).toEqual([`/editor/${MOBILE}`]);
  });
});

describe("páginas 'Preservar JS'", () => {
  it("não abrem direto no editor; convertendo, nada é gravado até uma alteração de verdade", async () => {
    const id = "docpreserva0000000000001";
    const server = new FakeServer();
    server.add(
      makePayload({
        documentId: id,
        cloneMode: "PRESERVE_JS",
        html: `<!doctype html><html><head><title>Quiz</title></head><body><h1 id="t">Quiz</h1><a id="btn" href="javascript:void(0)">Começar</a><p id="p">Pergunta</p></body></html>`,
      }),
    );
    const s = await open(server, id, { waitReady: false });
    await s.page.getByText("Esta página usa os scripts originais (“Preservar JS”)").waitFor();
    await expect
      .poll(() => s.page.locator('iframe[title="Prévia da página"]').getAttribute("src"))
      .toBe("http://preview.test/t1/?dispositivo=desktop");
    expect(await s.page.locator("iframe.gjs-frame").count()).toBe(0);
    await sleep(800);
    expect(server.puts).toEqual([]);

    await s.page.getByRole("button", { name: "Converter para editável" }).click();
    await s.page.getByRole("alertdialog").getByRole("button", { name: "Converter e abrir no editor" }).click();
    await s.page.locator("iframe.gjs-frame").waitFor();
    await s.page.frameLocator("iframe.gjs-frame").locator("h1").waitFor();
    await sleep(2500);
    expect(server.puts).toEqual([]);
    expect(await saveStatusText(s.page)).toBe("Salvo");

    await setStyle(s, "#p", { color: "rgb(0, 99, 0)" });
    await waitFor(() => server.okPuts.some((p) => p.css.includes("rgb(0, 99, 0)")), 5000, "primeira gravação");
  });

  it("'Ver página' pede um link de prévia novo quando o da tela está para vencer (12 h)", async () => {
    const id = "docpreserva0000000000002";
    const server = new FakeServer();
    server.add(makePayload({ documentId: id, cloneMode: "PRESERVE_JS" }));
    const s = await open(server, id, { waitReady: false });
    const visitor = s.page.getByRole("button", { name: "Ver página" });
    await expect.poll(() => visitor.isEnabled()).toBe(true);
    await visitor.click();
    await waitFor(() => server.log.filter((e) => e.kind === "open").length === 1, 4000, "primeira aba");
    // A tela ficou aberta a noite toda.
    await s.page.evaluate(() => {
      const real = Date.now.bind(Date);
      Date.now = () => real() + 11.5 * 60 * 60 * 1000;
    });
    await visitor.click();
    await waitFor(() => server.log.filter((e) => e.kind === "open").length === 2, 4000, "segunda aba");
    const opened = server.log.flatMap((e) => (e.kind === "open" ? [e.url] : []));
    expect(opened).toEqual([
      "http://preview.test/t1/?dispositivo=desktop",
      "http://preview.test/t2/?dispositivo=desktop",
    ]);
    expect((await actionCalls(s, "offerPreviewUrlAction")).length).toBe(2);
    // A prévia da tela também passa a usar o link novo.
    await expect
      .poll(() => s.page.locator('iframe[title="Prévia da página"]').getAttribute("src"))
      .toBe("http://preview.test/t2/?dispositivo=desktop");
  });
});

describe("página gravada antes das correções (reparo ao abrir)", () => {
  it("repara, guarda a situação de antes em Versões e grava — uma vez só", async () => {
    const id = "docreparo0000000000000001";
    const NOSCRIPT_CSS = ".rll-youtube-player, [data-lazy-src]{display:none !important;}";
    // Projeto como o editor antigo gravava: CSS do <noscript> nas regras e o id "comprar-2".
    const project = {
      pages: [
        {
          frames: [
            {
              component: {
                type: "wrapper",
                components: [
                  { tagName: "noscript" },
                  {
                    tagName: "div",
                    classes: ["rll-youtube-player"],
                    components: [{ type: "textnode", content: "vídeo" }],
                  },
                  { tagName: "p", attributes: { id: "comprar" }, components: [{ type: "textnode", content: "1" }] },
                  { tagName: "p", attributes: { id: "comprar-2" }, components: [{ type: "textnode", content: "2" }] },
                ],
              },
            },
          ],
        },
      ],
      styles: [
        { selectors: ["rll-youtube-player"], selectorsAdd: "[data-lazy-src]", style: { display: "none !important" } },
        { selectors: ["#comprar-2"], style: { color: "rgb(0, 0, 255)" } },
      ],
    };
    const server = new FakeServer();
    server.add(
      makePayload({
        documentId: id,
        project,
        html: null,
        repair: { noscriptCss: [NOSCRIPT_CSS], dupIds: { "comprar-2": "comprar" } },
      }),
    );
    const s = await open(server, id);
    await waitFor(() => server.okPuts.length === 1, 8000, "gravação do reparo");
    const kinds = server.log.filter((e) => e.kind === "version" || e.kind === "put").map((e) => e.kind);
    expect(kinds).toEqual(["version", "put"]);
    // Guardada com a marca do editor corrigido: restaurada, abre como estava (sem novo reparo).
    expect(server.log.find((e) => e.kind === "version")).toEqual({
      kind: "version",
      label: "Antes do reparo automático",
      openAsIs: true,
    });
    const put = server.okPuts[0];
    expect(put.css).not.toContain("display:none");
    // A edição feita no repetido continua (o salvar põe o id original de volta).
    expect(put.css).toContain("#comprar-2{color:rgb(0, 0, 255);}");
    expect(put.html).toMatch(/<p id="comprar-2" data-os-dup-id="comprar">2<\/p>/);
    // O reparo não entra no Desfazer.
    expect(await withEditor<boolean>(s.page, `(ed) => ed.UndoManager.hasUndo()`)).toBe(false);
    await sleep(2000);
    expect(server.okPuts).toHaveLength(1);
    expect(await saveStatusText(s.page)).toMatch(/^Salvo/);
  });

  it("sem nada a reparar, abrir não grava nada", async () => {
    const id = "docreparo0000000000000002";
    const server = new FakeServer();
    server.add(
      makePayload({
        documentId: id,
        project: { pages: [{ frames: [{ component: { type: "wrapper", components: [{ tagName: "h1" }] } }] }] },
        html: null,
        repair: { noscriptCss: [".x{color:red}"], dupIds: { "a-2": "a" } },
      }),
    );
    await open(server, id);
    await sleep(2000);
    expect(server.log.filter((e) => e.kind === "version" || e.kind === "put")).toEqual([]);
  });
});

describe("editor que não abre", () => {
  /** Servidor que responde erro (não 404) ao abrir a página: o Offer Studio com problema. */
  class BrokenServer extends FakeServer {
    async handle(route: Parameters<FakeServer["handle"]>[0]) {
      const url = new URL(route.request().url());
      if (route.request().method() === "GET" && /^\/api\/documents\/[^/]+$/.test(url.pathname)) {
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Algo deu errado ao abrir esta página." }),
        });
      }
      return super.handle(route);
    }
  }

  it("página excluída (404): a mesma tela de 'não encontrada' do resto do app", async () => {
    const server = new FakeServer();
    const s = await open(server, "naoexiste123", { waitReady: false });
    await s.page.getByRole("heading", { name: "Página não encontrada" }).waitFor();
    await s.page.getByText("Esta página foi excluída, ou a oferta dela está na lixeira.").waitFor();
    expect(await s.page.getByRole("link", { name: "Ir para as ofertas" }).getAttribute("href")).toBe("/ofertas");
    expect(await s.page.getByRole("link", { name: "Abrir a lixeira" }).getAttribute("href")).toBe("/lixeira");
  });

  it("'Voltar' numa aba sem histórico (aberta direto no endereço) leva para as ofertas", async () => {
    const server = new BrokenServer();
    const s = await open(server, "naoabre123", { waitReady: false });
    await s.page.getByRole("heading", { name: "Não foi possível abrir o editor" }).waitFor();
    await s.page.getByText("Algo deu errado ao abrir esta página.").waitFor();
    // Aba nova (⌘-clique, favorito): o histórico só tem esta página.
    await s.page.evaluate(() => Object.defineProperty(window.history, "length", { value: 1 }));
    await s.page.getByRole("button", { name: "Voltar" }).click();
    await waitFor(() => server.navs.length === 1, 4000, "navegação");
    expect(server.navs).toEqual(["/ofertas"]);
  });

  it("'Voltar' com histórico volta para a tela anterior", async () => {
    const server = new BrokenServer();
    const s = await open(server, "naoabre456", { waitReady: false });
    await s.page.getByRole("heading", { name: "Não foi possível abrir o editor" }).waitFor();
    await s.page.evaluate(() => Object.defineProperty(window.history, "length", { value: 3 }));
    await s.page.getByRole("button", { name: "Voltar" }).click();
    await waitFor(() => server.navs.length === 1, 4000, "navegação");
    expect(server.navs).toEqual(["<back>"]);
  });
});

describe("CSS da página (diálogo Código)", () => {
  it("aplicar conta como alteração (salva e liga o Desfazer); desfazer também salva", async () => {
    const s = await freshDoc("doccss0000000000000000001");
    const result = await withEditor<{ ok: boolean }>(
      s.page,
      `(ed) => window.OS.applyPageCss(ed, "#t { letter-spacing: 3px; }")`,
    );
    expect(result.ok).toBe(true);
    await waitFor(() => s.server.okPuts.some((p) => p.css.includes("letter-spacing:3px")), 5000, "gravação do CSS");
    const undo = s.page.getByRole("button", { name: "Desfazer (⌘Z)" });
    await expect.poll(() => undo.isEnabled()).toBe(true);
    await undo.click();
    await waitFor(
      () => {
        const last = s.server.okPuts.at(-1);
        return !!last && !last.css.includes("letter-spacing");
      },
      5000,
      "gravação do desfazer",
    );
  });

  it("@import e outras regras que o editor descartaria são recusadas com explicação", async () => {
    const s = await freshDoc("doccss0000000000000000002");
    const imp = await withEditor<{ ok: boolean; error?: string }>(
      s.page,
      `(ed) => window.OS.applyPageCss(ed, '@import url("https://fonts.googleapis.com/css2?family=Inter"); #t { color: red; }')`,
    );
    expect(imp.ok).toBe(false);
    expect(imp.error).toContain("@import");
    expect(imp.error).toContain("Códigos da página");
    const prop = await withEditor<{ ok: boolean; error?: string }>(
      s.page,
      `(ed) => window.OS.applyPageCss(ed, '@property --x { syntax: "<length>"; inherits: false; initial-value: 0px; } #t { color: red; }')`,
    );
    expect(prop.ok).toBe(false);
    expect(prop.error).toContain("@property");
    const found = await s.page.evaluate(() => {
      const f = (window as unknown as { OS: { unsupportedCssAtRules(css: string): string[] } }).OS
        .unsupportedCssAtRules;
      return {
        ok: f(
          "@media (max-width: 600px) { .a { color: red } } @font-face { font-family: X; src: url(x@2x.woff) } @keyframes k { from { opacity: 0 } } @supports (display:grid) { .b{} } @layer base { .c{} } /* @import no comentário */ .d::after { content: '@import' }",
        ),
        bad: f("@charset 'utf-8'; @import 'x.css'; @namespace svg url(http://www.w3.org/2000/svg); @layer a, b; .x{}"),
      };
    });
    expect(found.ok).toEqual([]);
    expect(found.bad).toEqual(["@import", "@namespace", "@layer (sem bloco)"]);
    // Nada mudou no editor.
    await sleep(1800);
    expect(s.server.okPuts).toHaveLength(1);
  });

  it("nada some em silêncio: CSS aninhado, @counter-style e o que o editor mudaria são recusados", async () => {
    const s = await freshDoc("doccss0000000000000000003");
    const apply = (css: string) =>
      withEditor<{ ok: boolean; error?: string }>(s.page, `(ed, css) => window.OS.applyPageCss(ed, css)`, css);
    const before = await withEditor<string>(s.page, `(ed) => ed.getCss({ avoidProtected: true })`);

    for (const nested of [
      "#t{color:blue} .card { color: red; .title { color: green } }",
      ".a { &:hover { color: red } }",
    ]) {
      const r = await apply(nested);
      expect(r.ok, nested).toBe(false);
      expect(r.error).toContain("Regras dentro de regras (CSS aninhado ou &)");
    }
    // Antes: "nenhuma regra CSS válida" (o analisador não lia nada com @counter-style no meio).
    const counter = await apply("#t{color:blue} @counter-style x { system: cyclic; symbols: '*'; } .x{color:red}");
    expect(counter.ok).toBe(false);
    expect(counter.error).toContain("O editor não guarda @counter-style");
    for (const at of ["@document", "@viewport", "@font-feature-values"]) {
      const r = await apply(`${at} x { } #t{color:blue}`);
      expect(r.ok, at).toBe(false);
      expect(r.error).toContain(`O editor não guarda ${at}`);
    }
    // O analisador perderia a @media de dentro e o atalho com var(): recusados, dizendo quais.
    const inner = await apply("#t{color:blue} @supports (display:grid){@media (min-width:1px){.g{display:grid}}}");
    expect(inner.ok).toBe(false);
    expect(inner.error).toContain("“@supports (display:grid) @media (min-width: 1px) .g”");
    const variable = await apply("#t{color:blue} .a{margin:var(--espaco)}");
    expect(variable.ok).toBe(false);
    expect(variable.error).toContain("“.a”");
    expect(variable.error).not.toContain("#t");
    // Nada mudou no editor, nada foi gravado nem entrou no Desfazer.
    expect(await withEditor<string>(s.page, `(ed) => ed.getCss({ avoidProtected: true })`)).toBe(before);
    expect(await withEditor<boolean>(s.page, `(ed) => ed.UndoManager.hasUndo()`)).toBe(false);
    await sleep(1800);
    expect(s.server.okPuts).toHaveLength(1);
  });

  it("CSS válido que o editor guarda passa inteiro (mesmo seletor repetido não perde declarações)", async () => {
    const s = await freshDoc("doccss0000000000000000004");
    const css = [
      ".a{color:red} .a{background-color:blue}",
      ".b, .c:hover, #t::before{content:'x';letter-spacing:1px}",
      ":is(.d, .e) > p{margin:0 auto !important}",
      "[data-x='1, 2']{color:green}",
      "@media (max-width: 480px){.a{font-size:20px}}",
      "@supports (display:grid){.g{display:grid}}",
      "@container (min-width: 400px){.k{color:red}}",
      "@layer base{.l{color:red}}",
      "@keyframes pulsar{from{opacity:0}to{opacity:1}}",
      "@font-face{font-family:A;src:url(/os-assets/a.woff2)} @font-face{font-family:B;src:url(/os-assets/b.woff2)}",
      "@page{margin:1cm}",
      ".v{--cor:red;color:var(--cor)}",
    ].join("\n");
    const result = await withEditor<{ ok: boolean; error?: string }>(
      s.page,
      `(ed, css) => window.OS.applyPageCss(ed, css)`,
      css,
    );
    expect(result).toEqual({ ok: true });
    const out = await withEditor<string>(s.page, `(ed) => ed.getCss({ avoidProtected: true })`);
    expect(out).toContain(".a{color:red;");
    expect(out).toMatch(/\.a\{[^}]*background-color:blue;/);
    expect(out).toContain("font-family:A;");
    expect(out).toContain("font-family:B;");
    expect(out).toContain("@keyframes pulsar");
    await waitFor(() => s.server.okPuts.some((p) => p.css.includes("font-family:B")), 5000, "gravação");
  });
});

describe("Links e checkouts", { timeout: 40_000 }, () => {
  const BUY_HTML = `<!doctype html><html><head><title>T</title></head><body><h1 id="t">Oferta</h1><a id="buy1" href="#" data-os-link="">QUERO AGORA</a><p id="p">Texto</p><a id="buy2" href="#" data-os-link="">QUERO JÁ</a></body></html>`;
  const CREATE_LINK = `(input) => ({ ok: true, data: { id: "link1", key: "checkout-principal", label: input.label, url: input.url, kind: input.kind } })`;

  it("mostra os botões de compra sem link e liga todos a um link novo", async () => {
    const id = "doclinks00000000000000001";
    const s = await freshDoc(id, { documentId: id, html: BUY_HTML });
    await setActionResult(s, "createOfferLinkAction", CREATE_LINK);
    await s.page.getByRole("button", { name: "Links e checkouts" }).click();
    const dialog = s.page.getByRole("dialog", { name: "Links e checkouts" });
    const group = dialog.getByRole("listitem").filter({ hasText: "Botões de compra sem link" });
    await group.waitFor();
    expect(await group.textContent()).toContain("2 elementos");
    expect(await dialog.textContent()).toContain("2 botões de compra sem link");
    expect(await dialog.getByText(/ainda não tem links nem botões/).count()).toBe(0);

    await group.getByRole("button", { name: "Criar link da oferta" }).click();
    expect(await group.getByRole("textbox", { name: "Nome do link" }).inputValue()).toBe("Checkout principal");
    await group.getByRole("textbox", { name: "Endereço do link" }).fill("pay.hotmart.com/E1X");
    await group.getByRole("button", { name: "Criar e ligar" }).click();
    await waitFor(
      () => s.server.okPuts.some((p) => (p.html.match(/data-os-link="checkout-principal"/g) ?? []).length === 2),
      6000,
      "ligação gravada",
    );
    const calls = await actionCalls(s, "createOfferLinkAction");
    expect(calls[0]?.input).toMatchObject({
      label: "Checkout principal",
      url: "https://pay.hotmart.com/E1X",
      kind: "CHECKOUT",
    });
    await dialog.getByRole("listitem").filter({ hasText: "Checkout principal" }).waitFor();
    expect(await dialog.getByText("Botões de compra sem link").count()).toBe(0);
  });

  it("link criado nas configurações do botão aparece na hora (a lista é lida de novo ao abrir)", async () => {
    const id = "doclinks00000000000000002";
    const s = await freshDoc(id, { documentId: id, html: BUY_HTML });
    await setActionResult(s, "createOfferLinkAction", CREATE_LINK);
    // O diálogo já foi aberto uma vez (a lista ficava guardada daí).
    await s.page.getByRole("button", { name: "Links e checkouts" }).click();
    const dialog = s.page.getByRole("dialog", { name: "Links e checkouts" });
    await dialog.waitFor();
    await s.page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });

    // "＋ Criar link da oferta…" nas configurações do botão.
    await withEditor(
      s.page,
      `(ed) => { const c = ed.getWrapper().find("#buy1")[0]; ed.select(c); c.addAttributes({ "data-os-link": "__novo-link__" }); return true; }`,
    );
    const create = s.page.getByRole("dialog", { name: "Novo link da oferta" });
    await create.waitFor();
    await create.getByLabel("Endereço", { exact: true }).fill("https://pay.hotmart.com/E1Y");
    await create.getByRole("button", { name: "Criar e ligar" }).click();
    await create.waitFor({ state: "hidden" });

    await s.page.getByRole("button", { name: "Links e checkouts" }).click();
    const group = dialog.getByRole("listitem").filter({ hasText: "“QUERO AGORA”" });
    await group.waitFor();
    expect(await group.textContent()).toContain("Checkout principal");
    expect(await group.textContent()).not.toContain("não existe mais");
    expect(await group.textContent()).not.toContain("foi excluído");
  });

  it("Localizar e substituir mostra pelo nome o link criado depois de abrir (não a chave)", async () => {
    const id = "doclinks00000000000000004";
    const s = await freshDoc(id, {
      documentId: id,
      html: `<!doctype html><html><head><title>T</title></head><body><h1 id="t">Oferta</h1><a id="buy1" href="https://old.example.com/x" data-os-link="">QUERO</a></body></html>`,
    });
    await setActionResult(
      s,
      "createOfferLinkAction",
      `(input) => ({ ok: true, data: { id: "link1", key: "chave-xyz", label: input.label, url: input.url, kind: input.kind } })`,
    );
    // O diálogo já foi aberto uma vez (a lista de nomes ficava guardada daí).
    await s.page.getByRole("button", { name: "Localizar e substituir" }).click();
    const find = s.page.getByRole("dialog", { name: /Localizar/ });
    await find.waitFor();
    await s.page.keyboard.press("Escape");
    await find.waitFor({ state: "hidden" });

    await withEditor(
      s.page,
      `(ed) => { const c = ed.getWrapper().find("#buy1")[0]; ed.select(c); c.addAttributes({ "data-os-link": "__novo-link__" }); return true; }`,
    );
    const create = s.page.getByRole("dialog", { name: "Novo link da oferta" });
    await create.waitFor();
    await create.getByRole("button", { name: "Criar e ligar" }).click();
    await create.waitFor({ state: "hidden" });

    await s.page.getByRole("button", { name: "Localizar e substituir" }).click();
    await find.waitFor();
    await find.getByRole("textbox").first().fill("old.example");
    const bound = find.locator('[aria-label="Ligado a um link da oferta"]');
    await bound.first().waitFor();
    await bound.first().hover();
    const tooltip = s.page.getByRole("tooltip").first();
    await tooltip.waitFor();
    const text = (await tooltip.textContent()) ?? "";
    expect(text).toContain("Checkout principal");
    expect(text).not.toContain("chave-xyz");
  });

  it("o atalho para a aba de links da oferta salva antes e abre direto nela", async () => {
    const id = "doclinks00000000000000003";
    const s = await freshDoc(id, { documentId: id, html: BUY_HTML });
    await setStyle(s, "#p", { color: "rgb(3, 3, 3)" });
    await s.page.getByRole("button", { name: "Links e checkouts" }).click();
    await s.page.getByRole("link", { name: "Links e checkouts da oferta" }).click();
    await waitFor(() => s.server.navs.length === 1, 5000, "navegação");
    expect(s.server.navs).toEqual([`/ofertas/${OFFER_ID}?aba=links`]);
    expect(s.server.okPuts.some((p) => p.css.includes("rgb(3, 3, 3)"))).toBe(true);
  });
});

describe("Histórico", { timeout: 40_000 }, () => {
  const VERSION = {
    id: "versao1",
    kind: "MANUAL",
    label: "Minha versão",
    createdAt: new Date().toISOString(),
    bytes: 10,
  };

  it("não restaura se a situação atual não puder ser salva", async () => {
    const s = await freshDoc("docversoes000000000000001");
    s.server.versions = [VERSION];
    s.server.failNext = ["500", "500", "500", "500", "500"];
    await setStyle(s, "#p", { color: "rgb(5, 5, 5)" });
    await s.page.getByRole("button", { name: "Histórico" }).click();
    const dialog = s.page.getByRole("dialog", { name: "Histórico" });
    await dialog.getByRole("button", { name: "Restaurar" }).click();
    await s.page
      .getByRole("alertdialog", { name: "Voltar para este ponto?" })
      .getByRole("button", { name: "Restaurar" })
      .click();
    await waitFor(
      async () => (await toasts(s)).some((t) => t.message.startsWith("Não foi possível salvar a situação atual")),
      6000,
      "aviso",
    );
    expect(s.server.restores).toBe(0);
  });

  it("depois de restaurar, recarrega sem gravar o editor por cima da versão restaurada", async () => {
    const s = await freshDoc("docversoes000000000000002");
    s.server.versions = [VERSION];
    await setStyle(s, "#p", { color: "rgb(6, 6, 6)" });
    await s.page.getByRole("button", { name: "Histórico" }).click();
    const dialog = s.page.getByRole("dialog", { name: "Histórico" });
    await dialog.getByRole("button", { name: "Restaurar" }).click();
    const reloaded = s.page.waitForEvent("load");
    await s.page
      .getByRole("alertdialog", { name: "Voltar para este ponto?" })
      .getByRole("button", { name: "Restaurar" })
      .click();
    await reloaded;
    expect(s.server.restores).toBe(1);
    // A alteração pendente foi salva antes (a "situação atual" guardada), e nada depois.
    const last = s.server.puts.at(-1);
    expect(last?.css).toContain("rgb(6, 6, 6)");
    const count = s.server.puts.length;
    await sleep(800);
    expect(s.server.puts.length).toBe(count);
  });
});

describe("lista de páginas da oferta", { timeout: 40_000 }, () => {
  const PAGES = [
    {
      id: "pagA000000000000000000001",
      name: "Vendas",
      slug: "vendas",
      type: "SALES",
      isHome: true,
      variantCount: 1,
      documentId: "docA",
      mobileDocumentId: "docAmobile",
    },
    {
      id: "pagB000000000000000000001",
      name: "Upsell",
      slug: "upsell",
      type: "UPSELL",
      isHome: false,
      variantCount: 1,
      documentId: "docB",
      mobileDocumentId: null,
    },
    {
      id: "pagC000000000000000000001",
      name: "Obrigado",
      slug: "obrigado",
      type: "THANK_YOU",
      isHome: false,
      variantCount: 1,
      documentId: "docC",
      mobileDocumentId: null,
    },
  ];

  it("excluir avisa quais páginas levam a esta e deixa escolher para onde esses links vão", async () => {
    const server = new FakeServer();
    const s = await open(server, "lista", { waitReady: false, pages: { offerId: OFFER_ID, pages: PAGES } });
    await setActionResult(
      s,
      "pageReferencesAction",
      `() => ({ ok: true, data: { count: 1, pages: [{ id: "pagA000000000000000000001", name: "Vendas" }] } })`,
    );
    await setActionResult(s, "deletePageAction", `() => ({ ok: true, data: undefined })`);
    await s.page.getByRole("button", { name: "Ações da página Upsell" }).click();
    await s.page.getByRole("menuitem", { name: "Excluir página" }).click();
    const dialog = s.page.getByRole("alertdialog", { name: 'Excluir a página "Upsell"?' });
    await dialog.getByText("Uma outra página tem botões ou links que levam a esta página (“Vendas”).").waitFor();
    await dialog.getByRole("combobox").click();
    await s.page.getByRole("option", { name: "Obrigado" }).click();
    await dialog.getByRole("button", { name: "Excluir página" }).click();
    await waitFor(async () => (await actionCalls(s, "deletePageAction")).length === 1, 4000, "exclusão");
    expect((await actionCalls(s, "deletePageAction"))[0].input).toEqual({
      id: "pagB000000000000000000001",
      redirectToPageId: "pagC000000000000000000001",
    });
    expect((await actionCalls(s, "pageReferencesAction"))[0].input).toEqual({ pageId: "pagB000000000000000000001" });
  });

  it("página com layout do celular separado: dá para abrir o layout do celular no editor", async () => {
    const server = new FakeServer();
    const s = await open(server, "lista2", { waitReady: false, pages: { offerId: OFFER_ID, pages: PAGES } });
    await s.page.getByText("Layout do celular separado").waitFor();
    expect(await s.page.getByText("Layout do celular separado").count()).toBe(1);
    await s.page.getByRole("button", { name: "Ações da página Vendas" }).click();
    await s.page.getByRole("menuitem", { name: "Editar o layout do celular" }).click();
    await waitFor(() => server.navs.length === 1, 4000, "navegação");
    expect(server.navs).toEqual(["/editor/docAmobile"]);
    // "Editar" continua abrindo a versão para computador.
    expect(await s.page.getByRole("link", { name: "Editar Vendas" }).getAttribute("href")).toBe("/editor/docA");
  });
});
