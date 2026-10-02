/**
 * Fase 3 — quinta rodada, no editor-app.tsx de verdade (harness E1):
 * - versão computador de uma página com versão celular separada: quem visita
 *   pelo celular recebe a outra versão, então uma edição no Desktop não mantém
 *   o valor "do celular" do original nem manda ajustar no modo Celular;
 * - a mesma página sem versão celular separada continua mantendo (controle).
 */
import type { Route } from "playwright";
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { baseStylesheetText, linkBaseStylesheet, prepareForEditor } from "@/lib/editor-html";
import {
  appBundle,
  FakeServer,
  makePayload,
  openApp,
  type Session,
  saveStatusText,
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
afterAll(async () => {
  for (const s of sessions) await s.page.close().catch(() => undefined);
});

/** Servidor falso que também serve o CSS original da página (/os-assets/…). */
class AssetServer extends FakeServer {
  assets = new Map<string, string>();
  async handle(route: Route) {
    const url = new URL(route.request().url());
    const css = url.pathname.startsWith("/os-assets/") ? this.assets.get(url.pathname) : undefined;
    if (css !== undefined) return route.fulfill({ contentType: "text/css", body: css });
    return super.handle(route);
  }
}

/** O que htmlForEditor faz: o CSS original numa folha base, servida pelo servidor falso. */
function editorHtml(server: AssetServer, stored: string) {
  const prepared = prepareForEditor(stored);
  const files = prepared.styles.map((style, i) => {
    const href = `/os-assets/s${i}.css`;
    server.assets.set(href, style.text ?? "");
    return { href, media: style.media };
  });
  server.assets.set("/os-assets/base.css", baseStylesheetText(files));
  return linkBaseStylesheet(prepared.html, "/os-assets/base.css");
}

const STORED = `<!doctype html><html><head><meta charset="utf-8"><title>T</title>
<style>h1{font-size:48px} @media (max-width:767px){h1{font-size:28px}}</style></head><body><h1 id="t">Título</h1></body></html>`;

async function editTitle(documentId: string, documents: { id: string; device: "ALL" | "DESKTOP" | "MOBILE" }[]) {
  const server = new AssetServer();
  const device = documents.find((d) => d.id === documentId)?.device ?? "ALL";
  server.add(makePayload({ documentId, html: editorHtml(server, STORED), device, documents }));
  const s = await openApp(browser, server, documentId);
  sessions.push(s);
  await waitFor(() => server.okPuts.length === 1, 8000, "primeiro salvamento");
  await withEditor(s.page, `(ed) => { ed.select(ed.getWrapper().find("#t")[0]); return true; }`);
  await sleep(300);
  await s.page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>(".gjs-sm-property__font-size input");
    if (!input) throw new Error("campo font-size não encontrado");
    input.value = "60px";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(300);
  await waitFor(async () => (await saveStatusText(s.page)).startsWith("Salvo"), 8000, "salvo");
  const css = await withEditor<string>(s.page, `(ed) => ed.getCss({ avoidProtected: true })`);
  return { s, css, toasts: await toasts(s) };
}

describe("edição no Desktop × versão celular separada", () => {
  it("versão computador com versão celular separada: sem regra do celular e sem mandar ajustar no modo Celular", async () => {
    const id = "docsplit0000000000000001";
    const {
      s,
      css,
      toasts: shown,
    } = await editTitle(id, [
      { id, device: "DESKTOP" },
      { id: "docsplit0000000000000002", device: "MOBILE" },
    ]);
    expect(css).toBe("#t{font-size:60px;}");
    expect(shown.filter((t) => /celular/i.test(`${t.message} ${t.description ?? ""}`))).toEqual([]);
    expect(s.server.okPuts.at(-1)?.css).toBe("#t{font-size:60px;}");
    expect(s.errors).toEqual([]);
  });

  it("mesma página sem versão celular separada: o celular mantém o original e o aviso explica o modo Celular", async () => {
    const id = "docsplit0000000000000003";
    const { css, toasts: shown } = await editTitle(id, [{ id, device: "ALL" }]);
    expect(css).toBe("#t{font-size:60px;}@media (max-width: 767px){:is(#t){font-size:revert-layer;}}");
    expect(shown.filter((t) => t.type === "info")).toEqual([
      expect.objectContaining({
        message: "Mudou no computador. No celular, este elemento continua como na página original.",
        description: "Para mudar no celular também, escolha o modo Celular no topo e ajuste lá.",
      }),
    ]);
  });
});
