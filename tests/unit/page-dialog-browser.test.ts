/**
 * "Editar página" num Chromium de verdade (2ª rodada de correções da Fase 5):
 * uma página antiga cujo endereço passou a ser reservado (oferta-b, celular…)
 * continua podendo mudar de nome e de tipo sem trocar o endereço — como o
 * servidor, a tela só confere um endereço NOVO. As server actions são de
 * mentira (registram o que foi pedido).
 */
import path from "node:path";
import { build, type Plugin } from "esbuild";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../..");

const ENTRY = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { PageDialog } from "@/components/offers/page-dialog";
let root = null;
window.OS = {
  render(props) {
    root = root || createRoot(document.getElementById("root"));
    root.render(createElement(PageDialog, { ...props, open: true, onOpenChange: (o) => (window.__open = o) }));
  },
};
`;

const stubs: Plugin = {
  name: "page-dialog-stubs",
  setup(b) {
    b.onResolve({ filter: /^sonner$/ }, () => ({ path: "sonner", namespace: "stub" }));
    b.onResolve({ filter: /^@\/server\/actions\/pages$/ }, () => ({ path: "pages", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
      loader: "js",
      contents:
        args.path === "sonner"
          ? `const rec = (type) => (m) => (window.__toasts = [...(window.__toasts || []), { type, message: String(m) }]);
             export const toast = Object.assign(rec("default"), { success: rec("success"), error: rec("error") });`
          : ["createPageAction", "updatePageAction"]
              .map(
                (n) =>
                  `export const ${n} = async (input) => { (window.__calls = window.__calls || []).push({ name: ${JSON.stringify(n)}, input }); return { ok: true, data: { id: "p1" } }; };`,
              )
              .join("\n"),
    }));
  },
};

let bundle: string;
let browser: Browser;

beforeAll(async () => {
  const out = await build({
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx", sourcefile: "page-dialog-entry.tsx" },
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    jsx: "automatic",
    write: false,
    logLevel: "silent",
    tsconfig: path.join(ROOT, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"' },
    loader: { ".css": "empty" },
    plugins: [stubs],
  });
  bundle = out.outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

async function openDialog(props: Record<string, unknown>): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ locale: "pt-BR" });
  page.setDefaultTimeout(8000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setContent('<!doctype html><html lang="pt-BR"><body><main id="root"></main></body></html>');
  await page.addScriptTag({ content: bundle });
  await page.evaluate((p) => (window as unknown as { OS: { render(p: unknown): void } }).OS.render(p), {
    offerId: "o1",
    ...props,
  });
  await page.getByRole("dialog").waitFor();
  return { page, errors };
}

const calls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __calls?: { name: string; input: unknown }[] }).__calls ?? []);

describe("Editar página com endereço que passou a ser reservado", () => {
  it("muda o nome sem trocar o endereço “oferta-b”: salva (e avisa, sem bloquear)", async () => {
    const { page, errors } = await openDialog({
      page: { id: "p1", name: "Oferta B antiga", slug: "oferta-b", type: "SALES" },
    });
    const dialog = page.getByRole("dialog", { name: "Editar página" });
    await dialog.getByText("Este endereço passou a ser reservado").waitFor();
    await dialog.getByLabel("Nome").fill("Oferta B (nova)");
    await dialog.getByRole("button", { name: "Salvar" }).click();
    await expect
      .poll(() => calls(page))
      .toEqual([
        { name: "updatePageAction", input: { id: "p1", name: "Oferta B (nova)", slug: "oferta-b", type: "SALES" } },
      ]);
    expect(await dialog.getByText("é reservado pelo sistema").count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __open?: boolean }).__open)).toBe(false);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("trocar para um endereço reservado continua bloqueado na tela", async () => {
    const { page } = await openDialog({ page: { id: "p1", name: "Upsell", slug: "upsell", type: "UPSELL" } });
    const dialog = page.getByRole("dialog", { name: "Editar página" });
    expect(await dialog.getByText("Este endereço passou a ser reservado").count()).toBe(0);
    await dialog.getByLabel("Endereço da página").fill("celular");
    await dialog.getByRole("button", { name: "Salvar" }).click();
    await dialog.getByText('"celular" é reservado pelo sistema', { exact: false }).waitFor();
    expect(await calls(page)).toEqual([]);
    await page.close();
  });

  it("página nova com endereço reservado: bloqueado", async () => {
    const { page } = await openDialog({ page: null, existingSlugs: [] });
    const dialog = page.getByRole("dialog", { name: "Nova página" });
    await dialog.getByLabel("Nome").fill("Oferta B");
    await dialog.getByLabel("Endereço da página").fill("oferta-b");
    await dialog.getByRole("button", { name: "Criar página" }).click();
    await dialog.getByText("é reservado pelo sistema", { exact: false }).waitFor();
    expect(await calls(page)).toEqual([]);
    await page.close();
  });
});
