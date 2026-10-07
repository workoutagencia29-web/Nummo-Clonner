/**
 * Editor completo (src/editor/editor-app.tsx, com React, painéis e diálogos)
 * num Chromium de verdade, sem Next e sem banco:
 *
 * - next/navigation e next/link viram versões de teste (a navegação só é anotada);
 * - server actions viram funções que o teste responde (window.__actions);
 * - toasts (sonner) só são anotados;
 * - /api/documents/<id> é um servidor falso em memória (revisão, 409, falhas,
 *   demora), com um registro em ordem de tudo o que chegou.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { build, type Plugin } from "esbuild";
import type { Browser, Page, Route } from "playwright";
import type { EditorPayload } from "@/server/services/documents";

const ROOT = path.resolve(import.meta.dirname, "../..");
export const ORIGIN = "http://editor.test";
export const OFFER_ID = "oferta00000000000000001";

const ENTRY = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import grapesjs from "grapesjs";
import { EditorApp, flushTextEditing } from "@/editor/editor-app";
import { applyPageCss, unsupportedCssAtRules } from "@/editor/panels/code-dialog";
import { PagesList } from "@/components/offers/pages-list";

let root = null;
window.OS = {
  mount(documentId) {
    root = createRoot(document.getElementById("root"));
    root.render(createElement(EditorApp, { documentId }));
  },
  mountPages(props) {
    root = createRoot(document.getElementById("root"));
    root.render(createElement(PagesList, props));
  },
  unmount() {
    root?.unmount();
    root = null;
  },
  editor() {
    return grapesjs.editors[grapesjs.editors.length - 1];
  },
  applyPageCss,
  unsupportedCssAtRules,
  flushTextEditing,
};
`;

const stubs: Plugin = {
  name: "e1-stubs",
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
        return {
          loader: "js",
          contents: `export function useRouter() { return window.__router; }`,
        };
      }
      if (args.path === "link") {
        return {
          loader: "js",
          resolveDir: ROOT,
          contents: `
            import { createElement } from "react";
            export default function Link({ href, onClick, children, prefetch, replace, scroll, ...rest }) {
              return createElement("a", { ...rest, href, onClick: (e) => {
                onClick && onClick(e);
                if (e.defaultPrevented) return;
                if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                window.__router.push(href);
              } }, children);
            }`,
        };
      }
      return {
        loader: "js",
        contents: `
          const calls = (window.__toasts = []);
          const rec = (type) => (message, opts) => { calls.push({ type, message, id: opts && opts.id, description: opts && opts.description }); return (opts && opts.id) || calls.length; };
          export const toast = Object.assign(rec("default"), { success: rec("success"), error: rec("error"), warning: rec("warning"), info: rec("info"), loading: rec("loading"), dismiss: (id) => calls.push({ type: "dismiss", id }) });`,
      };
    });
    const ACTIONS: Record<string, string[]> = {
      editor: ["offerPreviewUrlAction", "convertToEditableAction"],
      "bulk-replace": ["bulkReplaceAction", "bulkLinkAction", "classifyLinksAction"],
      "offer-links": ["createOfferLinkAction", "updateOfferLinkAction"],
      "page-code": ["getPageCodeAction", "savePageCodeAction"],
      // "SEO da página" no menu da lista de páginas (Fase 4).
      "offer-settings": ["getPageSeoAction", "savePageSeoAction", "saveOfferSettingsAction"],
      // "Teste A/B" na lista de páginas e troca de versão no editor (Fase 5).
      variants: [
        "listVariantsAction",
        "createVariantAction",
        "renameVariantAction",
        "setControlVariantAction",
        "setVariantWeightsAction",
        "deleteVariantAction",
        "variantPreviewUrlAction",
      ],
      pages: [
        "pageReferencesAction",
        "deletePageAction",
        "createPageAction",
        "updatePageAction",
        "reorderPagesAction",
        "setHomePageAction",
        "duplicatePageAction",
      ],
      // "Adicionar funil Quiz → Roleta" na lista de páginas (Fase 2B do funil com quiz).
      funnel: ["createQuizWheelFunnelAction"],
    };
    b.onLoad({ filter: /.*/, namespace: "action" }, (args) => {
      const names = ACTIONS[args.path];
      if (!names) throw new Error(`server action sem stub: ${args.path}`);
      return {
        loader: "js",
        contents: names
          .map((n) => `export const ${n} = (input) => window.__action(${JSON.stringify(n)}, input);`)
          .join("\n"),
      };
    });
  },
};

let bundle: Promise<string> | null = null;

export function appBundle(): Promise<string> {
  bundle ??= build({
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx", sourcefile: "e1-entry.tsx" },
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

/** Só o necessário para o canvas ter tamanho (sem o Tailwind do app). */
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
`;

export interface Put {
  id: string;
  revision: number;
  status: number;
  html: string;
  css: string;
}

export type LogEntry =
  | { kind: "put"; put: Put }
  | { kind: "nav"; href: string }
  | { kind: "open"; url: string }
  | { kind: "version"; label: string; openAsIs?: true };

export interface FakeDoc {
  revision: number;
  payload: EditorPayload;
}

/** Servidor falso: documentos, respostas programadas e o registro em ordem. */
export class FakeServer {
  docs = new Map<string, FakeDoc>();
  log: LogEntry[] = [];
  /** Próximas respostas do PUT: "500" ou "abort" (sem conexão). */
  failNext: ("500" | "abort")[] = [];
  putDelayMs = 0;
  versions: unknown[] = [];
  restores = 0;

  get puts(): Put[] {
    return this.log.flatMap((e) => (e.kind === "put" ? [e.put] : []));
  }
  get okPuts(): Put[] {
    return this.puts.filter((p) => p.status === 200);
  }
  get navs(): string[] {
    return this.log.flatMap((e) => (e.kind === "nav" ? [e.href] : []));
  }

  add(payload: EditorPayload) {
    this.docs.set(payload.documentId, { revision: payload.revision, payload });
  }

  async handle(route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === "http://preview.test") {
      return route.fulfill({ contentType: "text/html", body: "<!doctype html><h1>Prévia</h1>" });
    }
    if (url.origin !== ORIGIN) return route.abort();
    if (url.pathname.startsWith("/editor/")) {
      return route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Editor</title>
<style>${GRAPES_CSS}</style><style>${LAYOUT_CSS}</style></head><body><div id="root"></div></body></html>`,
      });
    }
    if (url.pathname === "/__nav") {
      this.log.push({ kind: "nav", href: url.searchParams.get("href") ?? "" });
      return route.fulfill({ status: 204, body: "" });
    }
    if (url.pathname === "/__open") {
      this.log.push({ kind: "open", url: url.searchParams.get("url") ?? "" });
      return route.fulfill({ status: 204, body: "" });
    }
    const versions = /^\/api\/documents\/([^/]+)\/versions$/.exec(url.pathname);
    if (versions && req.method() === "POST") {
      const body = JSON.parse(req.postData() ?? "{}") as { label?: string; openAsIs?: boolean };
      this.log.push({ kind: "version", label: body.label ?? "", ...(body.openAsIs === true && { openAsIs: true }) });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "v-nova" }) });
    }
    if (versions) return route.fulfill({ contentType: "application/json", body: JSON.stringify(this.versions) });
    if (/^\/api\/documents\/[^/]+\/versions\/[^/]+\/restore$/.test(url.pathname)) {
      this.restores++;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ revision: 99 }) });
    }
    const m = /^\/api\/documents\/([^/]+)$/.exec(url.pathname);
    if (m) {
      const doc = this.docs.get(m[1]);
      if (req.method() === "GET") {
        if (!doc) {
          return route.fulfill({
            status: 404,
            contentType: "application/json",
            body: JSON.stringify({ error: "Página não encontrada. Ela pode ter sido excluída." }),
          });
        }
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ ...doc.payload, revision: doc.revision }),
        });
      }
      if (req.method() === "PUT" && doc) {
        const body = JSON.parse(req.postData() ?? "{}") as { revision: number; html: string; css: string };
        if (this.putDelayMs) await new Promise((r) => setTimeout(r, this.putDelayMs));
        const fail = this.failNext.shift();
        const put: Put = { id: m[1], revision: body.revision, status: 0, html: body.html, css: body.css };
        if (fail === "abort") {
          put.status = -1;
          this.log.push({ kind: "put", put });
          return route.abort("connectionrefused");
        }
        if (fail === "500") {
          put.status = 500;
          this.log.push({ kind: "put", put });
          return route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: "Erro de teste." }),
          });
        }
        if (body.revision !== doc.revision) {
          put.status = 409;
          this.log.push({ kind: "put", put });
          return route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({ revision: doc.revision, error: "Esta página foi alterada em outra aba ou janela." }),
          });
        }
        doc.revision++;
        put.status = 200;
        this.log.push({ kind: "put", put });
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ revision: doc.revision, savedAt: new Date().toISOString() }),
        });
      }
    }
    if (url.pathname.startsWith("/api/")) {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: [] }) });
    }
    return route.fulfill({ status: 204, body: "" });
  }
}

export function makePayload(over: Partial<EditorPayload> & { documentId: string }): EditorPayload {
  return {
    revision: 0,
    project: null,
    html: `<!doctype html><html><head><title>T</title></head><body><h1 id="t">Título</h1><p id="p">Parágrafo da página</p></body></html>`,
    device: "ALL",
    cloneMode: "EDITABLE",
    page: { id: "pagina00000000000000001", name: "Página de vendas", slug: "vendas", type: "SALES" },
    variant: { id: "variante000000000000001", name: "A" },
    offer: { id: OFFER_ID, name: "Oferta de teste" },
    pages: [
      {
        id: "pagina00000000000000001",
        name: "Página de vendas",
        slug: "vendas",
        type: "SALES",
        isHome: true,
        documentId: over.documentId,
      },
      {
        id: "pagina00000000000000002",
        name: "Obrigado",
        slug: "obrigado",
        type: "THANK_YOU",
        isHome: false,
        documentId: "outrodoc000000000000001",
      },
    ],
    links: [],
    documents: [{ id: over.documentId, device: over.device ?? "ALL" }],
    ...over,
  };
}

export interface Session {
  page: Page;
  server: FakeServer;
  errors: string[];
}

/** Abre uma aba com o editor montado no documento indicado. */
export async function openApp(
  browser: Browser,
  server: FakeServer,
  documentId: string,
  opts: { waitReady?: boolean; viewport?: { width: number; height: number }; pages?: unknown } = {},
): Promise<Session> {
  const page = await browser.newPage({ viewport: opts.viewport ?? { width: 1500, height: 950 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/*", (route) => server.handle(route));
  await page.goto(`${ORIGIN}/editor/${documentId}`);
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const log = (path: string, key: string, value: string) =>
      void fetch(`${path}?${key}=${encodeURIComponent(value)}`).catch(() => undefined);
    w.__router = {
      push: (href: string) => log("/__nav", "href", href),
      replace: (href: string) => log("/__nav", "href", href),
      back: () => log("/__nav", "href", "<back>"),
      forward: () => undefined,
      refresh: () => undefined,
      prefetch: () => undefined,
    };
    w.open = (url: string) => {
      log("/__open", "url", url);
      return null;
    };
    const calls: { name: string; input: unknown }[] = [];
    w.__actionCalls = calls;
    let previews = 0;
    w.__action = async (name: string, input: unknown) => {
      calls.push({ name, input });
      await new Promise((r) => setTimeout(r, 0));
      const custom = (w.__actionResults as Record<string, (input: unknown) => unknown> | undefined)?.[name];
      if (custom) return custom(input);
      if (name === "offerPreviewUrlAction") {
        previews++;
        return { ok: true, data: { url: `http://preview.test/t${previews}/` } };
      }
      if (name === "getPageCodeAction") return { ok: true, data: { head: "", bodyStart: "", bodyEnd: "" } };
      if (name === "classifyLinksAction") return { ok: true, data: {} };
      return { ok: true, data: {} };
    };
  });
  await page.addScriptTag({ content: await appBundle() });
  if (opts.pages) {
    await page.evaluate(
      (props) => (window as unknown as { OS: { mountPages(p: unknown): void } }).OS.mountPages(props),
      opts.pages,
    );
    return { page, server, errors };
  }
  await page.evaluate((id) => (window as unknown as { OS: { mount(id: string): void } }).OS.mount(id), documentId);
  if (opts.waitReady !== false) {
    await page.getByRole("button", { name: "Modo prévia" }).waitFor();
    await page.waitForFunction(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Modo prévia");
      return btn && !(btn as HTMLButtonElement).disabled;
    });
  }
  return { page, server, errors };
}

/** Texto da situação do salvamento na barra superior. */
export function saveStatusText(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector("header");
    const el = [...(header?.querySelectorAll("span,button") ?? [])].find((e) =>
      /^(Salvo|Salvando…|Alterações não salvas|Conflito ao salvar|Erro ao salvar)/.test(e.textContent?.trim() ?? ""),
    );
    return el?.textContent?.trim() ?? "";
  });
}

export async function waitFor(check: () => boolean | Promise<boolean>, timeout = 8000, label = "condição") {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`tempo esgotado esperando ${label}`);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Executa uma função (em texto) com o editor (window.OS.editor()) dentro da página. */
export function withEditor<T>(page: Page, fn: string, arg?: unknown): Promise<T> {
  return page.evaluate(`(${fn})(window.OS.editor(), ${JSON.stringify(arg ?? null)})`) as Promise<T>;
}

/** Chamadas feitas a uma server action (na ordem). */
export function actionCalls(s: Session, name: string) {
  return s.page.evaluate(
    (n) =>
      (window as unknown as { __actionCalls: { name: string; input: Record<string, unknown> }[] }).__actionCalls.filter(
        (c) => c.name === n,
      ),
    name,
  );
}

/** Define a resposta de uma server action (função no navegador, em texto). */
export function setActionResult(s: Session, name: string, fn: string) {
  return s.page.evaluate(
    `(window.__actionResults = window.__actionResults || {})[${JSON.stringify(name)}] = (${fn}); true`,
  );
}

export function toasts(s: Session) {
  return s.page.evaluate(
    () =>
      (window as unknown as { __toasts: { type: string; message: string; id?: string; description?: string }[] })
        .__toasts,
  );
}
