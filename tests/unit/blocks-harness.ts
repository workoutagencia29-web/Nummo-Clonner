/**
 * Utilidades dos testes de blocos/widgets (tests/unit/blocks-*.test.ts):
 *
 * - openEditor: abre o editor de verdade (createEditor de src/editor/grapes/setup,
 *   compilado com esbuild) num Chromium, sem rede externa.
 * - exportPage: HTML final de uma página montada no editor (mesmo caminho do
 *   salvamento: getHtml + getCss → finalizeFromEditor) com o script das páginas.
 * - openSite: abre esse HTML num endereço de teste (http://site.test/...), com
 *   localStorage/sessionStorage funcionando e rede externa bloqueada.
 */
import path from "node:path";
import { build } from "esbuild";
import type { Editor } from "grapesjs";
import type { Browser, BrowserContext, BrowserContextOptions, Page, Route } from "playwright";
import type { OsBlock } from "@/editor/blocks";
import type { registerDynamicTraits } from "@/editor/grapes/components";
import type { applyLegacyRepair } from "@/editor/grapes/legacy-repair";
import type { installNewLinkOption } from "@/editor/grapes/new-link";
import type { createEditor, importPageHtml } from "@/editor/grapes/setup";
import type { setWidgetContext } from "@/editor/widgets";
import type { bindQuizLink } from "@/editor/widgets/quiz";
import type { bindWheelLink } from "@/editor/widgets/wheel";
import { finalizeFromEditor } from "@/lib/editor-html";
import type { OfferLinkValue } from "@/lib/offer-links";
import { renderPageHtml } from "@/lib/page-render";
import { runtimeScript } from "@/lib/runtime-bundle";
import type { WheelRender } from "@/lib/wheel-prizes";

/** O que o bundle de teste expõe na janela do navegador. */
export interface EditorWindow {
  ed: Editor;
  OS: {
    createEditor: typeof createEditor;
    importPageHtml: typeof importPageHtml;
    registerDynamicTraits: typeof registerDynamicTraits;
    setWidgetContext: typeof setWidgetContext;
    installNewLinkOption: typeof installNewLinkOption;
    applyLegacyRepair: typeof applyLegacyRepair;
    bindQuizLink: typeof bindQuizLink;
    bindWheelLink: typeof bindWheelLink;
    ALL_BLOCKS: OsBlock[];
  };
}

let bundle: Promise<string> | null = null;

/** Editor + blocos + widgets compilados para o navegador (uma vez por arquivo de teste). */
export function editorBundle(): Promise<string> {
  bundle ??= build({
    stdin: {
      contents: `
        import { createEditor, importPageHtml } from "@/editor/grapes/setup";
        import { registerDynamicTraits } from "@/editor/grapes/components";
        import { setWidgetContext } from "@/editor/widgets";
        import { ALL_BLOCKS } from "@/editor/blocks";
        import { installNewLinkOption } from "@/editor/grapes/new-link";
        import { applyLegacyRepair } from "@/editor/grapes/legacy-repair";
        import { bindQuizLink } from "@/editor/widgets/quiz";
        import { bindWheelLink } from "@/editor/widgets/wheel";
        window.OS = { createEditor, importPageHtml, registerDynamicTraits, setWidgetContext, installNewLinkOption, applyLegacyRepair, bindQuizLink, bindWheelLink, ALL_BLOCKS };
      `,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    write: false,
    logLevel: "silent",
    tsconfig: path.join(process.cwd(), "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"' },
  }).then((r) => r.outputFiles[0].text);
  return bundle;
}

export interface TestContext {
  links?: { key: string; label: string; kind?: string; payment?: string | null; paymentLocale?: string | null }[];
  pages?: { id: string; name: string; type?: string }[];
  /** Projeto salvo (getProjectData) para reabrir. */
  project?: unknown;
}

/** Abre o editor numa página em branco. `window.ed` é o editor. */
export async function openEditor(browser: Browser, ctx: TestContext = {}): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  (page as Page & { osErrors?: string[] }).osErrors = errors;
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("http://editor.test/")) {
      return route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
          <div id="canvas" style="height:900px"></div><div id="blocks"></div><div id="layers"></div>
          <div id="styles"></div><div id="traits"></div></body></html>`,
      });
    }
    return route.fulfill({ status: 204, body: "" });
  });
  await page.goto("http://editor.test/");
  await page.addScriptTag({ content: await editorBundle() });
  await page.evaluate(
    (context) =>
      new Promise<void>((resolve) => {
        const w = window as unknown as EditorWindow;
        const [canvas, blocks, layers, styles, traits] = ["canvas", "blocks", "layers", "styles", "traits"].map(
          (id) => document.getElementById(id) as HTMLElement,
        );
        const ed = w.OS.createEditor({ canvas, blocks, layers, styles, traits }, context.project ?? null);
        w.ed = ed;
        w.OS.setWidgetContext(ed, () => ({ links: context.links ?? [], pages: context.pages ?? [] }));
        // Como o editor: "Roleta de desconto: mostrar" quando a página tem roleta.
        w.OS.registerDynamicTraits(ed, () => ({
          links: context.links ?? [],
          pages: context.pages ?? [],
          wheel: (ed.getWrapper()?.find('[data-os-widget="wheel"]').length ?? 0) > 0,
        }));
        ed.on("load", () => resolve());
      }),
    ctx,
  );
  return page;
}

export function pageErrors(page: Page): string[] {
  return (page as Page & { osErrors?: string[] }).osErrors ?? [];
}

/** Adiciona um bloco (pelo id) no fim da página e devolve o id do componente criado. */
export async function addBlock(page: Page, blockId: string): Promise<string> {
  return page.evaluate((id) => {
    const ed = (window as unknown as EditorWindow).ed;
    const block = ed.Blocks.get(id);
    if (!block) throw new Error(`bloco ${id} não existe`);
    const [component] = ed.getWrapper()?.append(block.get("content") as never) ?? [];
    return component.getId();
  }, blockId);
}

/** HTML + CSS exportados pelo editor (como o editor salva). */
export async function editorOutput(page: Page) {
  return page.evaluate(() => {
    const ed = (window as unknown as EditorWindow).ed;
    return { html: ed.getHtml({ asDocument: true } as never), css: ed.getCss({ avoidProtected: true }) ?? "" };
  });
}

/**
 * HTML final da página como o visitante recebe: salvamento (finalizeFromEditor)
 * + renderPageHtml (links da oferta, páginas do funil e script embutido).
 */
export async function exportPage(
  page: Page,
  opts: { links?: OfferLinkValue[]; wheel?: WheelRender | null } = {},
): Promise<string> {
  const { html, css } = await editorOutput(page);
  const doc = /<html/i.test(html) ? html : `<!doctype html><html><head></head><body>${html}</body></html>`;
  return renderPageHtml(finalizeFromEditor(doc, css), {
    links: opts.links ?? [],
    pageHref: (id) => `/p/${id}`,
    runtimeTag: `<script data-os-runtime>${runtimeScript()}</script>`,
    wheel: opts.wheel ?? null,
  });
}

/** Muda um trait (como o painel Configurações faz) no primeiro elemento que casa com o seletor. */
export async function setTrait(page: Page, selector: string, trait: string, value: unknown) {
  await page.evaluate(
    ([sel, name, val]) => {
      const ed = (window as unknown as EditorWindow).ed;
      const comp = ed.getWrapper()?.find(sel as string)[0];
      if (!comp) throw new Error(`nada com ${sel}`);
      ed.select(comp);
      const t = comp.getTrait(name as string);
      if (!t) throw new Error(`trait ${name} não existe em ${sel}`);
      t.setValue(val);
    },
    [selector, trait, value] as const,
  );
}

/** Troca atributos direto no componente (para opções sem campo no painel). */
export async function setAttrs(page: Page, selector: string, attributes: Record<string, string>) {
  await page.evaluate(
    ([sel, a]) => {
      const comp = (window as unknown as EditorWindow).ed.getWrapper()?.find(sel as string)[0];
      if (!comp) throw new Error(`nada com ${sel}`);
      comp.addAttributes(a as Record<string, string>);
    },
    [selector, attributes] as const,
  );
}

export async function attrs(page: Page, selector: string): Promise<Record<string, string>> {
  return page.evaluate((sel) => {
    const comp = (window as unknown as EditorWindow).ed.getWrapper()?.find(sel)[0];
    return (comp?.getAttributes() ?? {}) as Record<string, string>;
  }, selector);
}

export interface Site {
  page: Page;
  context: BrowserContext;
  /** Requisições feitas para fora de site.test (bloqueadas), com corpo. */
  requests: { url: string; method: string; body: string | null; headers: Record<string, string> }[];
}

/**
 * Abre o HTML em http://site.test/oferta. Outras rotas: `extra[url]` responde
 * com o HTML dado; o resto recebe 204 (e fica anotado em `requests`).
 */
export async function openSite(
  browser: Browser,
  html: string,
  opts: {
    path?: string;
    query?: string;
    contextOptions?: BrowserContextOptions;
    extra?: Record<string, string>;
    clock?: boolean;
    /** Script que roda antes da página (ex.: ouvir eventos). */
    init?: string;
    /**
     * Endereços "sem CORS": pedidos JSON falham como no navegador (o Playwright
     * não aplica CORS em respostas simuladas); pedidos simples passam.
     */
    noCors?: string[];
  } = {},
): Promise<Site> {
  const context = await browser.newContext(opts.contextOptions ?? { viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const requests: Site["requests"] = [];
  const pagePath = opts.path ?? "/oferta";
  await page.route("**/*", async (route: Route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith("http://site.test/") && new URL(url).pathname === pagePath) {
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    }
    for (const [prefix, body] of Object.entries(opts.extra ?? {})) {
      if (url.startsWith(prefix)) return route.fulfill({ contentType: "text/html; charset=utf-8", body });
    }
    requests.push({ url, method: req.method(), body: req.postData(), headers: req.headers() });
    const blocked = (opts.noCors ?? []).some((prefix) => url.startsWith(prefix));
    if (blocked && /json/.test(req.headers()["content-type"] ?? "")) return route.abort("failed");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type" },
      body: "{}",
    });
  });
  if (opts.init) await context.addInitScript({ content: opts.init });
  if (opts.clock) await page.clock.install();
  await page.goto(`http://site.test${pagePath}${opts.query ?? ""}`);
  return { page, context, requests };
}
