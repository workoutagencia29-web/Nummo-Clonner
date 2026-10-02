/**
 * Teste A/B na tela, num Chromium de verdade: a lista de páginas e o diálogo
 * "Teste A/B" (src/components/offers/variants) e o seletor "Versão A / B" do
 * editor. As server actions do Teste A/B e o /api/documents chamam os serviços
 * reais contra o banco de teste (só o login e o revalidatePath são simulados),
 * então cada clique é conferido no banco.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { build, type Plugin } from "esbuild";
import { type Browser, chromium, type Locator, type Page, type Route } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  COPY_SOURCE_GONE,
  LIST_CHANGED,
  PAGE_NOT_FOUND,
  VARIANT_NOT_FOUND,
  WEIGHTS_CHANGED,
} from "@/components/offers/variants/weights";
import { prisma } from "@/lib/db";
import { resolvePreviewToken } from "@/lib/preview";
import * as editorActions from "@/server/actions/editor";
import * as variantActions from "@/server/actions/variants";
import { getEditorPayload, RevisionConflictError, saveEditorDocument } from "@/server/services/documents";
import { createOffer } from "@/server/services/offers";
import { createVariant, deleteVariant, setVariantWeights } from "@/server/services/variants";
import { resetDatabase } from "../setup/per-file";

const ROOT = path.resolve(import.meta.dirname, "../..");
const ORIGIN = "http://variantes.test";

// ─── Montagem (bundle com esbuild) ───────────────────────────────────────────

const ENTRY = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import grapesjs from "grapesjs";
import { EditorApp } from "@/editor/editor-app";
import { PagesList } from "@/components/offers/pages-list";
let root = null;
window.OS = {
  mountEditor(documentId) {
    root = createRoot(document.getElementById("root"));
    root.render(createElement(EditorApp, { documentId }));
  },
  mountPages(props) {
    root = createRoot(document.getElementById("root"));
    root.render(createElement(PagesList, props));
  },
  editor() {
    return grapesjs.editors[grapesjs.editors.length - 1];
  },
};
`;

/** Nomes exportados por um arquivo de server actions (para gerar o stub). */
function actionNames(module: string): string[] {
  const text = readFileSync(path.join(ROOT, "src/server/actions", `${module}.ts`), "utf8");
  return [...text.matchAll(/^export const (\w+)/gm)].map((m) => m[1]);
}

const stubs: Plugin = {
  name: "variants-stubs",
  setup(b) {
    b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "stub" }));
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "stub" }));
    b.onResolve({ filter: /^sonner$/ }, () => ({ path: "sonner", namespace: "stub" }));
    b.onResolve({ filter: /^@\/server\/actions\// }, (args) => ({
      path: args.path.replace("@/server/actions/", ""),
      namespace: "action",
    }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => {
      if (args.path === "navigation") {
        return { loader: "js", contents: "export function useRouter() { return window.__router; }" };
      }
      if (args.path === "link") {
        return {
          loader: "js",
          resolveDir: ROOT,
          contents: `
            import { createElement, forwardRef } from "react";
            const Link = forwardRef(function Link({ href, onClick, children, prefetch, replace, scroll, ...rest }, ref) {
              return createElement("a", { ...rest, ref, href, onClick: (e) => {
                onClick && onClick(e);
                if (e.defaultPrevented) return;
                if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                window.__router.push(href);
              } }, children);
            });
            export default Link;`,
        };
      }
      return {
        loader: "js",
        contents: `
          const calls = (window.__toasts = []);
          const rec = (type) => (message, opts) => {
            calls.push({ type, message, description: opts && opts.description, action: opts && opts.action ? opts.action.label : undefined });
            window.__lastToastAction = opts && opts.action ? opts.action.onClick : window.__lastToastAction;
            return calls.length;
          };
          export const toast = Object.assign(rec("default"), { success: rec("success"), error: rec("error"), warning: rec("warning"), info: rec("info"), loading: rec("loading"), dismiss: () => undefined });`,
      };
    });
    b.onLoad({ filter: /.*/, namespace: "action" }, (args) => ({
      loader: "js",
      contents: actionNames(args.path)
        .map((n) => `export const ${n} = (input) => window.__action(${JSON.stringify(n)}, input);`)
        .join("\n"),
    }));
  },
};

let bundle: Promise<string> | null = null;
function appBundle() {
  bundle ??= build({
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx", sourcefile: "variants-entry.tsx" },
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
    external: ["cheerio"],
    plugins: [stubs],
  }).then((r) => r.outputFiles[0].text);
  return bundle;
}

const GRAPES_CSS = readFileSync(path.join(ROOT, "node_modules/grapesjs/dist/css/grapes.min.css"), "utf8");
const LAYOUT_CSS = `
html,body{margin:0;font:14px sans-serif}
#root{height:900px}
.os-editor{height:900px;display:flex;flex-direction:column}
.os-editor>header{display:flex;align-items:center;gap:4px;height:48px;flex-wrap:nowrap;overflow:hidden}
.os-editor>div{display:flex;flex:1;min-height:0}
.os-editor main{flex:1;min-width:0;display:flex;flex-direction:column;position:relative}
.os-editor main>div:last-child{flex:1;min-height:0;position:relative}
.h-full{height:100%}
.hidden{display:none}
.invisible{visibility:hidden}
aside{width:280px;overflow:auto;flex-shrink:0}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
`;

// ─── Servidor falso (com os serviços de verdade) ─────────────────────────────

/** Actions que rodam de verdade (banco de teste); as outras respondem vazio. */
const REAL_ACTIONS: Record<string, (input: never) => Promise<unknown>> = {
  ...(variantActions as unknown as Record<string, (input: never) => Promise<unknown>>),
  offerPreviewUrlAction: editorActions.offerPreviewUrlAction as (input: never) => Promise<unknown>,
};

interface Log {
  navs: string[];
  opens: string[];
  puts: { id: string; status: number }[];
  actions: { name: string; input: unknown }[];
}

async function handle(route: Route, log: Log) {
  const req = route.request();
  const url = new URL(req.url());
  if (url.origin !== ORIGIN) return route.abort();
  if (url.pathname.startsWith("/app/")) {
    return route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Teste A/B</title>
<style>${GRAPES_CSS}</style><style>${LAYOUT_CSS}</style></head><body><div id="root"></div></body></html>`,
    });
  }
  if (url.pathname === "/__nav") {
    log.navs.push(url.searchParams.get("href") ?? "");
    return route.fulfill({ status: 204, body: "" });
  }
  if (url.pathname === "/__open") {
    log.opens.push(url.searchParams.get("url") ?? "");
    return route.fulfill({ status: 204, body: "" });
  }
  const m = /^\/api\/documents\/([^/]+)$/.exec(url.pathname);
  if (m && req.method() === "GET") {
    try {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(await getEditorPayload(m[1])) });
    } catch (err) {
      return route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: String(err) }),
      });
    }
  }
  if (m && req.method() === "PUT") {
    const body = JSON.parse(req.postData() ?? "{}");
    try {
      const saved = await saveEditorDocument({ documentId: m[1], ...body });
      log.puts.push({ id: m[1], status: 200 });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(saved) });
    } catch (err) {
      const status = err instanceof RevisionConflictError ? 409 : 400;
      log.puts.push({ id: m[1], status });
      return route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error: String(err) }) });
    }
  }
  if (url.pathname.startsWith("/os-assets/")) return route.fulfill({ contentType: "text/css", body: "" });
  if (url.pathname.startsWith("/api/")) {
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: [] }) });
  }
  return route.fulfill({ status: 204, body: "" });
}

let browser: Browser;
const pages: Page[] = [];

beforeAll(async () => {
  await appBundle();
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  for (const p of pages) await p.close().catch(() => undefined);
  await browser?.close();
});

beforeEach(async () => {
  await resetDatabase();
});

async function openPage(): Promise<{ page: Page; log: Log; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  pages.push(page);
  const log: Log = { navs: [], opens: [], puts: [], actions: [] };
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.exposeFunction("__serverAction", async (name: string, input: unknown) => {
    log.actions.push({ name, input });
    const fn = REAL_ACTIONS[name];
    if (!fn) return { ok: true, data: {} };
    return JSON.parse(JSON.stringify(await fn(input as never)));
  });
  await page.route("**/*", (route) => handle(route, log));
  await page.goto(`${ORIGIN}/app/`);
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const ping = (p: string, key: string, value: string) =>
      void fetch(`${p}?${key}=${encodeURIComponent(value)}`).catch(() => undefined);
    w.__router = {
      push: (href: string) => ping("/__nav", "href", href),
      replace: (href: string) => ping("/__nav", "href", href),
      back: () => undefined,
      forward: () => undefined,
      refresh: () => undefined,
      prefetch: () => undefined,
    };
    w.open = (url: string) => {
      ping("/__open", "url", url);
      return null;
    };
    w.__action = (name: string, input: unknown) =>
      (w.__serverAction as (n: string, i: unknown) => Promise<unknown>)(name, input);
  });
  await page.addScriptTag({ content: await appBundle() });
  return { page, log, errors };
}

async function waitFor(check: () => boolean | Promise<boolean>, label: string, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`tempo esgotado esperando ${label}`);
}

function toasts(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __toasts: { type: string; message: string; action?: string }[] }).__toasts,
  );
}

// ─── Dados ───────────────────────────────────────────────────────────────────

async function seedOffer() {
  const offer = await createOffer({ name: "Oferta A/B" });
  const page = await prisma.page.findFirstOrThrow({
    where: { offerId: offer.id },
    include: { variants: { include: { documents: true } } },
  });
  return { offerId: offer.id, pageId: page.id, aDoc: page.variants[0].documents[0].id };
}

function variantsOf(pageId: string) {
  return prisma.pageVariant.findMany({
    where: { pageId },
    orderBy: { position: "asc" },
    include: { documents: { orderBy: { device: "asc" } } },
  });
}

async function mountPages(page: Page, offerId: string, pageId: string, variantCount = 1) {
  const rows = [
    {
      id: pageId,
      name: "Página principal",
      slug: "principal",
      type: "SALES",
      isHome: true,
      variantCount,
      documentId: null,
      mobileDocumentId: null,
    },
  ];
  await page.evaluate((props) => (window as unknown as { OS: { mountPages(p: unknown): void } }).OS.mountPages(props), {
    offerId,
    pages: rows,
  });
}

async function openAbFromMenu(page: Page) {
  await page.getByRole("button", { name: "Ações da página Página principal" }).click();
  await page.getByRole("menuitem", { name: /^Teste A\/B/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("list", { name: "Versões da página" }).waitFor();
  return dialog;
}

// ─── Testes ──────────────────────────────────────────────────────────────────

describe("diálogo Teste A/B", () => {
  it("abre pelo menu da página, cria a versão B como cópia num clique e divide 50/50", async () => {
    const { offerId, pageId } = await seedOffer();
    const { page, errors } = await openPage();
    await mountPages(page, offerId, pageId);

    const dialog = await openAbFromMenu(page);
    await expect(dialog.getByRole("heading", { name: /Teste A\/B/ }).textContent()).resolves.toContain(
      "Página principal",
    );
    const rows = dialog.getByRole("listitem");
    expect(await rows.count()).toBe(1);
    const rowA = dialog.getByRole("listitem", { name: "Versão A" });
    expect(await rowA.textContent()).toContain("Controle");
    // Uma versão só: fica no endereço da própria página (não existe oferta-a/ no ZIP).
    expect(await rowA.textContent()).toContain("Início do site (/)");
    expect(await rowA.textContent()).not.toContain("oferta-a");
    expect(await rowA.textContent()).toContain("Computador e celular");
    expect(await rowA.textContent()).not.toContain("há 0 segundos");
    // Uma versão só: sem divisão do tráfego.
    expect(await dialog.getByText("Divisão do tráfego").count()).toBe(0);
    expect(await dialog.getByText("1 de 5 versões").count()).toBe(1);

    // O caso mais comum (cópia da de controle) é um clique só, sem formulário.
    await dialog.getByRole("button", { name: "Criar versão B (cópia da A)" }).click();

    await dialog.getByRole("listitem", { name: "Versão B" }).waitFor();
    const variants = await variantsOf(pageId);
    expect(variants.map((v) => [v.name, v.label, v.isControl, v.weight])).toEqual([
      ["A", null, true, 50],
      ["B", null, false, 50],
    ]);
    expect(variants[1].documents[0].html).toBe(variants[0].documents[0].html);
    const rowB = dialog.getByRole("listitem", { name: "Versão B" });
    expect(await rowB.textContent()).toContain("50% do tráfego");
    expect(await rowB.textContent()).toContain("/oferta-b/");
    expect(await dialog.getByRole("listitem", { name: "Versão A" }).textContent()).toContain("/oferta-a/");
    // Editar leva ao editor da versão B.
    expect(await rowB.getByRole("link", { name: "Editar a versão B" }).getAttribute("href")).toBe(
      `/editor/${variants[1].documents[0].id}`,
    );
    // Aviso dentro do diálogo (um toast cobriria o botão de criar a próxima).
    const notice = dialog.getByRole("status").filter({ hasText: "Versão B criada." });
    expect(await notice.textContent()).toContain("dividido por igual entre as 2 versões");
    expect(await notice.textContent()).toContain("“Divisão do tráfego”");
    expect(await notice.getByRole("link", { name: "Editar agora" }).getAttribute("href")).toBe(
      `/editor/${variants[1].documents[0].id}`,
    );
    expect((await toasts(page)).some((t) => t.message.includes("criada"))).toBe(false);
    expect(await dialog.getByRole("button", { name: "Criar versão C (cópia da A)" }).count()).toBe(1);
    expect(errors).toEqual([]);
  });

  it("“Modelo ou outra versão…”: formulário com cópia por padrão e nome da versão", async () => {
    const { offerId, pageId } = await seedOffer();
    const { page } = await openPage();
    await mountPages(page, offerId, pageId);
    const dialog = await openAbFromMenu(page);
    await dialog.getByRole("button", { name: "Modelo ou outra versão…" }).click();
    // Padrão: cópia da versão A.
    expect(await dialog.getByRole("radio", { name: /Cópia de uma versão/ }).getAttribute("aria-checked")).toBe("true");
    await dialog.getByLabel("Nome da versão (opcional)").fill("Headline nova");
    await dialog.getByRole("button", { name: "Criar versão B" }).click();
    await dialog.getByRole("listitem", { name: "Versão B" }).waitFor();
    expect((await variantsOf(pageId)).map((v) => [v.name, v.label])).toEqual([
      ["A", null],
      ["B", "Headline nova"],
    ]);
    expect(await dialog.getByRole("listitem", { name: "Versão B" }).textContent()).toContain("Headline nova");
    await dialog.getByRole("status").filter({ hasText: "Versão B criada." }).waitFor();
  });

  it("divisão mudada e não salva: fechar, Esc e criar versão perguntam antes (salvar ou descartar)", async () => {
    const { offerId, pageId } = await seedOffer();
    await createVariant({ pageId });
    const { page } = await openPage();
    await mountPages(page, offerId, pageId, 2);
    let dialog = await openAbFromMenu(page);
    await dialog.getByLabel("Percentual da versão A").fill("80");
    expect(await dialog.getByLabel("Percentual da versão B").inputValue()).toBe("20");

    // Fechar → pergunta; "Salvar" grava e fecha.
    await dialog.getByRole("button", { name: "Fechar", exact: true }).first().click();
    let ask = page.getByRole("alertdialog");
    expect(await ask.textContent()).toContain("Salvar a divisão do tráfego?");
    expect(await ask.textContent()).toContain("A 80% · B 20%");
    expect(await ask.textContent()).toContain("A 50% · B 50%");
    await ask.getByRole("button", { name: "Salvar" }).click();
    await dialog.waitFor({ state: "detached" });
    expect((await variantsOf(pageId)).map((v) => v.weight)).toEqual([80, 20]);

    // Esc → pergunta; "Continuar editando" mantém o diálogo; "Descartar" fecha sem gravar.
    dialog = await openAbFromMenu(page);
    await dialog.getByLabel("Percentual da versão A").fill("60");
    await page.keyboard.press("Escape");
    ask = page.getByRole("alertdialog");
    await ask.getByRole("button", { name: "Continuar editando" }).click();
    await ask.waitFor({ state: "detached" });
    expect(await dialog.getByLabel("Percentual da versão A").inputValue()).toBe("60");
    await dialog.getByRole("button", { name: "Criar versão C (cópia da A)" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Descartar" }).click();
    // Descartou: criou a C sem gravar os 60%.
    await dialog.getByRole("listitem", { name: "Versão C" }).waitFor();
    const weights = (await variantsOf(pageId)).map((v) => [v.name, v.weight]);
    expect(weights.map(([n]) => n)).toEqual(["A", "B", "C"]);
    expect(weights.reduce((a, [, w]) => a + (w as number), 0)).toBe(100);
    expect(weights[0][1]).not.toBe(60);
  });

  it("divisão do tráfego: 70 em A ajusta B para 30; salvar grava no banco", async () => {
    const { offerId, pageId } = await seedOffer();
    await createVariant({ pageId });
    const { page } = await openPage();
    await mountPages(page, offerId, pageId, 2);

    // O selo "2 versões A/B" também abre o teste.
    await page.getByRole("button", { name: "2 versões A/B" }).click();
    const dialog = page.getByRole("dialog");
    const inputA = dialog.getByLabel("Percentual da versão A");
    await inputA.waitFor();
    const inputB = dialog.getByLabel("Percentual da versão B");
    const save = dialog.getByRole("button", { name: "Salvar divisão" });
    expect(await save.isDisabled()).toBe(true);

    await inputA.fill("70");
    expect(await inputB.inputValue()).toBe("30");
    expect(await dialog.getByText("Total: 100%.").count()).toBe(1);

    // Número inválido: aviso em português e não salva.
    await inputB.fill("");
    expect(await dialog.getByRole("alert").textContent()).toBe("Digite um número inteiro de 0 a 100 em cada versão.");
    expect(await save.isDisabled()).toBe(true);
    await inputB.fill("150");
    expect(await inputB.getAttribute("aria-invalid")).toBe("true");
    expect(await save.isDisabled()).toBe(true);
    await inputB.fill("30");
    expect(await inputA.inputValue()).toBe("70");

    await save.click();
    await waitFor(
      async () => (await variantsOf(pageId)).map((v) => v.weight).join() === "70,30",
      "percentuais gravados",
    );
    await dialog.getByRole("listitem", { name: "Versão A" }).getByText("70% do tráfego").waitFor();
    expect((await toasts(page)).some((t) => t.message === "Divisão do tráfego salva.")).toBe(true);
    await waitFor(async () => save.isDisabled(), "salvar desabilitado depois de gravar");

    // "Dividir por igual" volta para 50/50 (sem gravar até salvar).
    await dialog.getByRole("button", { name: "Dividir por igual" }).click();
    expect(await inputA.inputValue()).toBe("50");
    expect(await inputB.inputValue()).toBe("50");
    expect((await variantsOf(pageId)).map((v) => v.weight)).toEqual([70, 30]);
    await dialog.getByRole("button", { name: "Desfazer" }).click();
    expect(await inputA.inputValue()).toBe("70");
  });

  it("três versões: a que você já escolheu fica, a não mexida ajusta", async () => {
    const { offerId, pageId } = await seedOffer();
    await createVariant({ pageId });
    await createVariant({ pageId });
    const { page } = await openPage();
    await mountPages(page, offerId, pageId, 3);
    const dialog = await openAbFromMenu(page);
    const input = (n: string) => dialog.getByLabel(`Percentual da versão ${n}`);
    expect([await input("A").inputValue(), await input("B").inputValue(), await input("C").inputValue()]).toEqual([
      "34",
      "33",
      "33",
    ]);
    await input("A").fill("50");
    expect([await input("B").inputValue(), await input("C").inputValue()]).toEqual(["25", "25"]);
    await input("B").fill("30");
    expect([await input("A").inputValue(), await input("C").inputValue()]).toEqual(["50", "20"]);
  });

  it("renomear, tornar controle e excluir (com confirmação)", async () => {
    const { offerId, pageId } = await seedOffer();
    const b = await createVariant({ pageId });
    const [a] = await variantsOf(pageId);
    await setVariantWeights({
      pageId,
      weights: [
        { variantId: a.id, weight: 70 },
        { variantId: b.id, weight: 30 },
      ],
    });
    const { page } = await openPage();
    await mountPages(page, offerId, pageId, 2);
    const dialog = await openAbFromMenu(page);
    const rowB = dialog.getByRole("listitem", { name: "Versão B" });

    // Dar um nome.
    await rowB.getByRole("button", { name: "Ações da versão B" }).click();
    await page.getByRole("menuitem", { name: "Dar um nome" }).click();
    await rowB.getByLabel(/Nome da versão B/).fill("Preço 197");
    await rowB.getByRole("button", { name: "Salvar" }).click();
    await rowB.getByText("· Preço 197").waitFor();
    expect((await variantsOf(pageId))[1].label).toBe("Preço 197");

    // Tornar controle.
    await rowB.getByRole("button", { name: "Ações da versão B" }).click();
    await page.getByRole("menuitem", { name: "Tornar controle" }).click();
    await rowB.getByText("Controle").waitFor();
    expect((await variantsOf(pageId)).map((v) => [v.name, v.isControl])).toEqual([
      ["A", false],
      ["B", true],
    ]);
    expect(await dialog.getByRole("listitem", { name: "Versão A" }).getByText("Controle").count()).toBe(0);

    // Excluir a B (controle): confirmação explica o que acontece.
    await rowB.getByRole("button", { name: "Ações da versão B" }).click();
    await page.getByRole("menuitem", { name: "Excluir versão" }).click();
    const confirm = page.getByRole("alertdialog");
    const text = await confirm.textContent();
    expect(text).toContain("Excluir a versão B?");
    expect(text).toContain("A versão A passa a ser o controle.");
    expect(text).toContain("A versão A passa a receber 100% do tráfego.");
    await confirm.getByRole("button", { name: "Excluir versão B" }).click();
    await confirm.waitFor({ state: "detached" });
    await waitFor(async () => (await dialog.getByRole("listitem").count()) === 1, "lista com uma versão");
    expect((await variantsOf(pageId)).map((v) => [v.name, v.isControl, v.weight])).toEqual([["A", true, 100]]);
    expect((await toasts(page)).some((t) => t.message === "Versão B excluída. A versão A agora é o controle.")).toBe(
      true,
    );

    // A última versão não pode ser excluída.
    await dialog.getByRole("button", { name: "Ações da versão A" }).click();
    const only = page.getByRole("menuitem", { name: "É a única versão" });
    expect(await only.getAttribute("aria-disabled")).toBe("true");
  });

  it("prévia abre a versão numa aba nova (link direto nela)", async () => {
    const { offerId, pageId } = await seedOffer();
    const b = await createVariant({ pageId });
    const { page, log } = await openPage();
    await mountPages(page, offerId, pageId, 2);
    const dialog = await openAbFromMenu(page);
    await dialog.getByRole("button", { name: "Ver página da versão B" }).click();
    await waitFor(() => log.opens.length === 1, "janela da prévia");
    const token = /^http:\/\/([a-z2-7]{26})\.localhost:\d+\/$/.exec(log.opens[0])?.[1];
    expect(token).toBeTruthy();
    expect(await resolvePreviewToken(token as string)).toEqual({ kind: "offer", offerId, pageId, variantId: b.id });
  });

  it("cria a partir de um modelo e respeita o limite de 5 versões", async () => {
    const { offerId, pageId } = await seedOffer();
    for (let i = 0; i < 3; i++) await createVariant({ pageId });
    const { page } = await openPage();
    await mountPages(page, offerId, pageId, 4);
    const dialog = await openAbFromMenu(page);
    await dialog.getByRole("button", { name: "Modelo ou outra versão…" }).click();
    await dialog.getByRole("radio", { name: /Modelo pronto ou em branco/ }).click();
    await dialog.getByRole("radio", { name: "VSL" }).click();
    await dialog.getByRole("button", { name: "Criar versão E" }).click();
    await dialog.getByRole("listitem", { name: "Versão E" }).waitFor();

    const variants = await variantsOf(pageId);
    expect(variants.map((v) => v.weight)).toEqual([20, 20, 20, 20, 20]);
    const e = variants.find((v) => v.name === "E");
    expect(e?.documents.map((d) => d.device)).toEqual(["ALL"]);
    expect(e?.documents[0].html).not.toBe(variants[0].documents[0].html);
    // Limite: sem botão de criar, com aviso.
    expect(await dialog.getByRole("button", { name: /Criar versão/ }).count()).toBe(0);
    expect(await dialog.getByRole("button", { name: "Modelo ou outra versão…" }).count()).toBe(0);
    expect(await dialog.getByText(/5 de 5 versões — limite atingido/).count()).toBe(1);
  });

  it("Esc no formulário de criar volta para a lista (não fecha o diálogo)", async () => {
    const { offerId, pageId } = await seedOffer();
    const { page } = await openPage();
    await mountPages(page, offerId, pageId);
    const dialog = await openAbFromMenu(page);
    await dialog.getByRole("button", { name: "Modelo ou outra versão…" }).click();
    await dialog.getByRole("radio", { name: /Cópia de uma versão/ }).waitFor();
    await page.keyboard.press("Escape");
    await dialog.getByRole("list", { name: "Versões da página" }).waitFor();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    expect(await prisma.pageVariant.count({ where: { pageId } })).toBe(1);
  });
});

describe("versões pausadas e mudanças feitas em outra aba", () => {
  async function setWeights(pageId: string, weights: number[]) {
    const variants = await variantsOf(pageId);
    await setVariantWeights({ pageId, weights: variants.map((v, i) => ({ variantId: v.id, weight: weights[i] })) });
  }
  const weightsNow = async (pageId: string) => (await variantsOf(pageId)).map((v) => `${v.name}:${v.weight}`);
  const STALE_DESCRIPTION = "A lista de versões foi atualizada com o que está salvo agora.";

  it("criar uma versão não tira da pausa a que está com 0% (e o aviso diz isso)", async () => {
    const { offerId, pageId } = await seedOffer();
    await createVariant({ pageId });
    await createVariant({ pageId });
    await setWeights(pageId, [90, 10, 0]);
    const { page, errors } = await openPage();
    await mountPages(page, offerId, pageId, 3);
    const dialog = await openAbFromMenu(page);

    // O formulário já avisa como fica a divisão.
    await dialog.getByRole("button", { name: "Modelo ou outra versão…" }).click();
    expect(await dialog.getByText(/O tráfego passa a ser/).textContent()).toBe(
      "O tráfego passa a ser dividido por igual entre as 3 versões ativas; a pausada (0%) continua pausada (dá para ajustar depois).",
    );
    await dialog.getByRole("button", { name: "Voltar", exact: true }).click();

    await dialog.getByRole("button", { name: "Criar versão D (cópia da A)" }).click();
    const notice = dialog.getByRole("status").filter({ hasText: "Versão D criada." });
    await notice.waitFor();
    expect(await notice.textContent()).toContain(
      "O tráfego foi dividido por igual entre as 3 versões ativas; a pausada (0%) continua pausada",
    );
    expect(await weightsNow(pageId)).toEqual(["A:34", "B:33", "C:0", "D:33"]);
    expect(await dialog.getByRole("listitem", { name: "Versão C" }).textContent()).toContain("0% do tráfego");
    expect(await dialog.getByLabel("Percentual da versão C").inputValue()).toBe("0");
    expect(errors).toEqual([]);
  });

  it("versão criada em outra aba: salvar a divisão recarrega a lista (sem fechar o diálogo)", async () => {
    const { offerId, pageId } = await seedOffer();
    await createVariant({ pageId });
    const { page, errors } = await openPage();
    await mountPages(page, offerId, pageId, 2);
    const dialog = await openAbFromMenu(page);
    await dialog.getByLabel("Percentual da versão A").fill("70");

    // Outra aba cria a C.
    await createVariant({ pageId });
    await dialog.getByRole("button", { name: "Salvar divisão" }).click();

    await dialog.getByRole("listitem", { name: "Versão C" }).waitFor();
    expect(await dialog.getByRole("listitem").count()).toBe(3);
    const input = (n: string) => dialog.getByLabel(`Percentual da versão ${n}`);
    expect([await input("A").inputValue(), await input("B").inputValue(), await input("C").inputValue()]).toEqual([
      "34",
      "33",
      "33",
    ]);
    expect(await weightsNow(pageId)).toEqual(["A:34", "B:33", "C:33"]);
    const warned = (await toasts(page)).find((t) => t.type === "warning");
    expect(warned).toMatchObject({ message: LIST_CHANGED, description: STALE_DESCRIPTION });
    expect(LIST_CHANGED).not.toContain("Feche e abra");
    // Nada de erro velho na tela nem pergunta de "salvar a divisão".
    expect(await dialog.getByRole("alert").count()).toBe(0);
    expect(await dialog.getByRole("button", { name: "Salvar divisão" }).isDisabled()).toBe(true);
    // Dá para salvar de novo na hora.
    await input("A").fill("50");
    await dialog.getByRole("button", { name: "Salvar divisão" }).click();
    await waitFor(async () => (await weightsNow(pageId)).join() === "A:50,B:25,C:25", "divisão nova gravada");
    expect(errors).toEqual([]);
  });

  it("divisão mudada em outra aba: não sobrescreve; mostra a divisão atual", async () => {
    const { offerId, pageId } = await seedOffer();
    await createVariant({ pageId });
    const { page } = await openPage();
    await mountPages(page, offerId, pageId, 2);
    const dialog = await openAbFromMenu(page);
    await dialog.getByLabel("Percentual da versão A").fill("70");

    await setWeights(pageId, [90, 10]);
    await dialog.getByRole("button", { name: "Salvar divisão" }).click();

    await waitFor(
      async () => (await dialog.getByLabel("Percentual da versão A").inputValue()) === "90",
      "divisão atual na tela",
    );
    expect(await dialog.getByLabel("Percentual da versão B").inputValue()).toBe("10");
    expect(await weightsNow(pageId)).toEqual(["A:90", "B:10"]);
    expect((await toasts(page)).find((t) => t.type === "warning")?.message).toBe(WEIGHTS_CHANGED);
  });

  it("“Salvar” da pergunta ao sair com a divisão mudada em outra aba: fica para conferir", async () => {
    const { offerId, pageId } = await seedOffer();
    await createVariant({ pageId });
    const { page } = await openPage();
    await mountPages(page, offerId, pageId, 2);
    const dialog = await openAbFromMenu(page);
    await dialog.getByLabel("Percentual da versão A").fill("70");
    await setWeights(pageId, [90, 10]);
    await dialog.getByRole("button", { name: "Fechar", exact: true }).first().click();
    const ask = page.getByRole("alertdialog");
    await ask.getByRole("button", { name: "Salvar" }).click();
    await ask.waitFor({ state: "detached" });
    // O diálogo continua aberto, com a divisão de agora.
    await waitFor(
      async () => (await dialog.getByLabel("Percentual da versão A").inputValue()) === "90",
      "divisão atual na tela",
    );
    expect(await dialog.isVisible()).toBe(true);
    expect(await weightsNow(pageId)).toEqual(["A:90", "B:10"]);
    expect((await toasts(page)).find((t) => t.type === "warning")?.message).toBe(WEIGHTS_CHANGED);
  });

  it("versão excluída em outra aba: tornar controle, prévia, renomear e excluir recarregam a lista", async () => {
    const { offerId, pageId } = await seedOffer();
    const b = await createVariant({ pageId });
    const c = await createVariant({ pageId });
    const d = await createVariant({ pageId });
    const e = await createVariant({ pageId });
    const { page, log, errors } = await openPage();
    await mountPages(page, offerId, pageId, 5);
    const dialog = await openAbFromMenu(page);
    const row = (n: string) => dialog.getByRole("listitem", { name: `Versão ${n}` });
    const gone = (n: string) => waitFor(async () => (await row(n).count()) === 0, `versão ${n} fora da lista`);
    const lastToast = async () => (await toasts(page)).at(-1);

    // Tornar controle.
    await deleteVariant(e.id);
    await row("E").getByRole("button", { name: "Ações da versão E" }).click();
    await page.getByRole("menuitem", { name: "Tornar controle" }).click();
    await gone("E");
    expect(await lastToast()).toMatchObject({
      type: "warning",
      message: VARIANT_NOT_FOUND,
      description: STALE_DESCRIPTION,
    });

    // Prévia.
    await deleteVariant(d.id);
    await row("D").getByRole("button", { name: "Ver página da versão D" }).click();
    await gone("D");
    expect(await lastToast()).toMatchObject({ type: "warning", message: VARIANT_NOT_FOUND });
    expect(log.opens).toEqual([]);

    // Renomear: o formulário fecha junto.
    await row("C").getByRole("button", { name: "Ações da versão C" }).click();
    await page.getByRole("menuitem", { name: "Dar um nome" }).click();
    await row("C")
      .getByLabel(/Nome da versão C/)
      .fill("Nova");
    await deleteVariant(c.id);
    await row("C").getByRole("button", { name: "Salvar" }).click();
    await gone("C");
    expect(await lastToast()).toMatchObject({ type: "warning", message: VARIANT_NOT_FOUND });
    expect(await dialog.getByRole("textbox", { name: /Nome da versão/ }).count()).toBe(0);

    // Excluir: a confirmação fecha.
    await row("B").getByRole("button", { name: "Ações da versão B" }).click();
    await page.getByRole("menuitem", { name: "Excluir versão" }).click();
    const confirm = page.getByRole("alertdialog");
    await deleteVariant(b.id);
    await confirm.getByRole("button", { name: "Excluir versão B" }).click();
    await confirm.waitFor({ state: "detached" });
    await gone("B");
    expect(await lastToast()).toMatchObject({ type: "warning", message: VARIANT_NOT_FOUND });
    expect(await dialog.getByRole("listitem").count()).toBe(1);
    expect((await toasts(page)).filter((t) => t.type === "error")).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("versão escolhida para copiar excluída em outra aba: erro no formulário e a lista certa no seletor", async () => {
    const { offerId, pageId } = await seedOffer();
    const b = await createVariant({ pageId });
    const { page } = await openPage();
    await mountPages(page, offerId, pageId, 2);
    const dialog = await openAbFromMenu(page);
    await dialog.getByRole("button", { name: "Modelo ou outra versão…" }).click();
    await dialog.getByRole("combobox", { name: "Copiar a versão" }).click();
    await page.getByRole("option", { name: "Versão B" }).click();
    await deleteVariant(b.id);
    await dialog.getByRole("button", { name: "Criar versão C" }).click();

    await dialog.getByText(COPY_SOURCE_GONE).waitFor();
    // A lista recarregou: com uma versão só, o seletor some e a cópia volta a ser da A.
    await waitFor(
      async () => (await dialog.getByRole("combobox", { name: "Copiar a versão" }).count()) === 0,
      "seletor sem a B",
    );
    expect(await dialog.getByText(/começa igual à Versão A/).count()).toBe(1);
    expect((await toasts(page)).some((t) => t.type === "warning")).toBe(false);
    await dialog.getByRole("button", { name: /^Criar versão/ }).click();
    await dialog.getByRole("list", { name: "Versões da página" }).waitFor();
    const variants = await variantsOf(pageId);
    // Uma versão nova (a letra seguinte à maior em uso: B de novo), cópia da A.
    expect(variants.map((v) => v.name)).toEqual(["A", "B"]);
    expect(variants[1].id).not.toBe(b.id);
    expect(variants[1].documents[0].html).toBe(variants[0].documents[0].html);
  });

  /** Conta os router.refresh() da tela (a lista de páginas por trás do diálogo). */
  async function countRefreshes(page: Page) {
    await page.evaluate(() => {
      const w = window as unknown as { __router: { refresh(): void }; __refreshes: number };
      w.__refreshes = 0;
      w.__router.refresh = () => {
        w.__refreshes += 1;
      };
    });
    return () => page.evaluate(() => (window as unknown as { __refreshes: number }).__refreshes);
  }

  /** O diálogo mostra só o erro da página (sem a lista velha, que não tem mais o que fazer). */
  async function expectOnlyPageError(dialog: Locator) {
    await dialog.getByText(PAGE_NOT_FOUND).waitFor();
    expect(await dialog.getByRole("list", { name: "Versões da página" }).count()).toBe(0);
    expect(await dialog.getByRole("listitem").count()).toBe(0);
    expect(await dialog.getByRole("button", { name: "Salvar divisão" }).count()).toBe(0);
    expect(
      await dialog.getByRole("button", { name: /^Ver página da versão|^Ações da versão|^Criar versão/ }).count(),
    ).toBe(0);
    // Tentar de novo nunca daria certo (a página não volta): no lugar, um "Fechar" que fecha de verdade.
    expect(await dialog.getByRole("button", { name: "Tentar de novo" }).count()).toBe(0);
    expect(await closeButton(dialog).count()).toBe(1);
    expect(await dialog.getByText("A lista de páginas da oferta já foi atualizada.").count()).toBe(1);
  }

  /** O "Fechar" do erro (não o X do canto, que também se chama "Fechar"). */
  function closeButton(dialog: Locator) {
    return dialog.locator('[data-slot="button"]', { hasText: /^Fechar$/ });
  }

  it("página excluída em outra aba: a ação que esbarra nela mostra só o erro (sem dizer que a lista de versões foi atualizada) e “Fechar”", async () => {
    const { offerId, pageId } = await seedOffer();
    await createVariant({ pageId });
    const { page, log, errors } = await openPage();
    const refreshes = await countRefreshes(page);
    await mountPages(page, offerId, pageId, 2);
    const dialog = await openAbFromMenu(page);

    // Outra aba exclui a página (as versões vão junto): "Tornar controle" da B esbarra nisso.
    await prisma.page.delete({ where: { id: pageId } });
    await dialog.getByRole("listitem", { name: "Versão B" }).getByRole("button", { name: "Ações da versão B" }).click();
    await page.getByRole("menuitem", { name: "Tornar controle" }).click();

    await expectOnlyPageError(dialog);
    // Nenhum aviso de "lista atualizada" (ela não foi) nem o erro repetido num toast.
    expect((await toasts(page)).filter((t) => t.type !== "success")).toEqual([]);
    // A lista de páginas por trás se atualiza (a página excluída sai dela).
    await waitFor(async () => (await refreshes()) === 1, "lista de páginas atualizada");

    // "Fechar" fecha o diálogo (sem perguntar nada nem chamar o servidor de novo).
    const listCalls = log.actions.filter((a) => a.name === "listVariantsAction").length;
    await closeButton(dialog).click();
    await dialog.waitFor({ state: "detached" });
    expect(await page.getByRole("alertdialog").count()).toBe(0);
    expect(log.actions.filter((a) => a.name === "listVariantsAction").length).toBe(listCalls);
    expect(await refreshes()).toBe(1);
    expect(errors).toEqual([]);
  });

  it("outro erro ao carregar (Offer Studio fora do ar por um instante): “Tentar de novo” continua e funciona", async () => {
    const { offerId, pageId } = await seedOffer();
    await createVariant({ pageId });
    const { page, errors } = await openPage();
    // A primeira leitura da lista falha como quando o Offer Studio não responde.
    await page.evaluate(() => {
      const w = window as unknown as { __action: (n: string, i: unknown) => Promise<unknown> };
      const real = w.__action;
      let failed = false;
      w.__action = (name, input) => {
        if (name === "listVariantsAction" && !failed) {
          failed = true;
          return Promise.reject(new Error("fora do ar"));
        }
        return real(name, input);
      };
    });
    await mountPages(page, offerId, pageId, 2);
    await page.getByRole("button", { name: "Ações da página Página principal" }).click();
    await page.getByRole("menuitem", { name: /^Teste A\/B/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("Não foi possível falar com o Offer Studio. Ele ainda está aberto?").waitFor();
    expect(await closeButton(dialog).count()).toBe(0);
    expect(await dialog.getByText("A lista de páginas da oferta já foi atualizada.").count()).toBe(0);

    await dialog.getByRole("button", { name: "Tentar de novo" }).click();
    await dialog.getByRole("list", { name: "Versões da página" }).waitFor();
    expect(await dialog.getByRole("list", { name: "Versões da página" }).getByRole("listitem").count()).toBe(2);
    expect(await dialog.getByRole("button", { name: "Tentar de novo" }).count()).toBe(0);
    expect(errors).toEqual([]);
  });

  it("oferta na lixeira em outra aba com a divisão por salvar: “Salvar divisão” mostra o erro e fechar não pergunta", async () => {
    const { offerId, pageId } = await seedOffer();
    await createVariant({ pageId });
    const { page, errors } = await openPage();
    const refreshes = await countRefreshes(page);
    await mountPages(page, offerId, pageId, 2);
    const dialog = await openAbFromMenu(page);
    await dialog.getByLabel("Percentual da versão A").fill("70");

    await prisma.offer.update({ where: { id: offerId }, data: { deletedAt: new Date() } });
    await dialog.getByRole("button", { name: "Salvar divisão" }).click();

    await expectOnlyPageError(dialog);
    expect((await toasts(page)).filter((t) => t.type !== "success")).toEqual([]);
    await waitFor(async () => (await refreshes()) === 1, "lista de páginas atualizada");

    // A divisão por salvar não tem mais onde ficar: fechar não pergunta "salvar ou descartar".
    // Pelo X do canto (o "Fechar" do erro está no teste acima).
    await dialog.locator('[data-slot="dialog-close"]').click();
    await dialog.waitFor({ state: "detached" });
    expect(await page.getByRole("alertdialog").count()).toBe(0);
    expect(await variantsOf(pageId).then((v) => v.map((x) => x.weight))).toEqual([50, 50]);
    expect(errors).toEqual([]);
  });
});

describe("seletor de versão no editor", () => {
  async function mountEditor(page: Page, documentId: string) {
    await page.evaluate(
      (id) => (window as unknown as { OS: { mountEditor(id: string): void } }).OS.mountEditor(id),
      documentId,
    );
    await page.getByRole("button", { name: "Modo prévia" }).waitFor();
    await page.waitForFunction(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Modo prévia");
      return btn && !(btn as HTMLButtonElement).disabled;
    });
  }

  it("página com uma versão: sem seletor", async () => {
    const { aDoc } = await seedOffer();
    const { page } = await openPage();
    await mountEditor(page, aDoc);
    expect(await page.getByRole("radiogroup", { name: "Versão A/B da página" }).count()).toBe(0);
  });

  it("mostra A (controle) e B; trocar salva antes e abre a outra versão", async () => {
    const { pageId, aDoc } = await seedOffer();
    const b = await createVariant({ pageId, label: "Headline nova" });
    const { page, log, errors } = await openPage();
    await mountEditor(page, aDoc);
    // Primeira abertura: o editor grava a página importada.
    await waitFor(() => log.puts.length >= 1, "primeira gravação");
    const group = page.getByRole("radiogroup", { name: "Versão A/B da página" });
    const itemA = group.getByRole("radio", { name: "Versão A, controle" });
    const itemB = group.getByRole("radio", { name: "Versão B" });
    expect(await itemA.getAttribute("aria-checked")).toBe("true");
    expect(await itemB.getAttribute("title")).toBe("Versão B · Headline nova · 50% do tráfego no divisor");
    expect(await page.locator("header").textContent()).toContain("Versão A (controle)");

    // Uma alteração ainda não salva: trocar de versão grava antes de sair.
    const putsBefore = log.puts.length;
    await page.evaluate(() => {
      const os = (window as unknown as { OS: { editor(): { getWrapper(): { append(html: string): void } } } }).OS;
      os.editor().getWrapper().append("<p>Novo parágrafo da versão A</p>");
    });
    await itemB.click();
    await waitFor(() => log.navs.length === 1, "troca de versão");
    expect(log.navs[0]).toBe(`/editor/${b.documentId}`);
    expect(log.puts.length).toBeGreaterThan(putsBefore);
    const saved = await prisma.pageDocument.findUniqueOrThrow({ where: { id: aDoc } });
    expect(saved.html).toContain("Novo parágrafo da versão A");
    expect(errors).toEqual([]);
  });

  it("versão celular aberta: a outra versão abre também na versão celular", async () => {
    const { pageId } = await seedOffer();
    const a = (await variantsOf(pageId))[0];
    await prisma.pageDocument.deleteMany({ where: { variantId: a.id } });
    await prisma.pageDocument.createMany({
      data: [
        { variantId: a.id, device: "DESKTOP", html: "<!doctype html><html><body><h1>Computador</h1></body></html>" },
        { variantId: a.id, device: "MOBILE", html: "<!doctype html><html><body><h1>Celular</h1></body></html>" },
      ],
    });
    const b = await createVariant({ pageId });
    const docs = await variantsOf(pageId);
    const aMobile = docs[0].documents.find((d) => d.device === "MOBILE")?.id as string;
    const bMobile = docs[1].documents.find((d) => d.device === "MOBILE")?.id as string;
    expect(b.documentId).not.toBe(bMobile);

    const { page, log } = await openPage();
    await mountEditor(page, aMobile);
    await page
      .getByRole("radiogroup", { name: "Versão A/B da página" })
      .getByRole("radio", { name: "Versão B" })
      .click();
    await waitFor(() => log.navs.length === 1, "troca de versão");
    expect(log.navs[0]).toBe(`/editor/${bMobile}`);
  });
});
