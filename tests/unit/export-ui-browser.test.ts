/**
 * Fase 5 — "Baixar ZIP" num Chromium de verdade, com o CSS do painel.
 *
 * Só a tela: as server actions (src/server/actions/export.ts) e o
 * GET /api/exports/<id> são de mentira, com um roteiro por teste (plano, lista
 * de ZIPs e as leituras de progresso de cada ZIP gerado). Assim dá para testar
 * progresso, download automático, falha, retomada, fechar no meio etc. sem
 * depender do tempo real de gerar um ZIP. O ZIP de verdade é testado no E2E
 * (tests/e2e/export.spec.ts).
 *
 * OS_UI_SHOTS=<pasta> salva capturas de tela das etapas.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import tailwind from "@tailwindcss/postcss";
import { build, type Plugin } from "esbuild";
import { type Browser, chromium, type Download, type Page, type Route } from "playwright";
import postcss from "postcss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ExportOptions, ExportPlan, ExportView } from "@/lib/export/options";

const ROOT = path.resolve(import.meta.dirname, "../..");
const ORIGIN = "http://painel.test";
const SHOTS = process.env.OS_UI_SHOTS;

// ─── Montagem da tela (esbuild + stubs) ─────────────────────────────────────

const ENTRY = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { OfferExportActions } from "@/components/offers/export/offer-export-actions";
let root = null;
window.OS = {
  render(props) {
    root = root || createRoot(document.getElementById("root"));
    const trigger = createElement("button", { type: "button", className: "rounded-md border px-3 py-1 text-sm" }, "Ações");
    root.render(createElement(OfferExportActions, { ...props, menu: { ...props.menu, trigger } }));
  },
};
`;

/** Nomes exportados por um arquivo de server actions (o de export segue o contrato). */
function actionNames(mod: string): string[] {
  const names = new Set<string>(
    mod === "export" ? ["startExportAction", "listExportsAction", "deleteExportAction", "exportPlanAction"] : [],
  );
  const file = path.join(ROOT, "src/server/actions", `${mod}.ts`);
  if (existsSync(file)) {
    for (const m of readFileSync(file, "utf8").matchAll(/export\s+(?:const|async\s+function|function)\s+(\w+)/g)) {
      names.add(m[1]);
    }
  }
  return [...names];
}

const stubs: Plugin = {
  name: "export-ui-stubs",
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
          contents: `export function useRouter() { return { push: (h) => (window.__navs = [...(window.__navs || []), h]), replace: () => {}, refresh: () => {}, back: () => {}, prefetch: () => {} }; }`,
        };
      }
      if (args.path === "link") {
        return {
          loader: "js",
          resolveDir: ROOT,
          contents: `
            import { createElement, forwardRef } from "react";
            const Link = forwardRef(function Link({ href, prefetch, replace, scroll, ...rest }, ref) {
              return createElement("a", { ...rest, ref, href, onClick: (e) => {
                rest.onClick && rest.onClick(e);
                e.preventDefault();
                window.__navs = [...(window.__navs || []), href];
              } });
            });
            export default Link;`,
        };
      }
      return {
        loader: "js",
        contents: `
          const calls = (window.__toasts = []);
          const actions = (window.__toastActions = []);
          const rec = (type) => (message, opts) => {
            calls.push({ type, message: String(message), description: opts && opts.description ? String(opts.description) : null, action: opts && opts.action ? opts.action.label : null });
            actions.push(opts && opts.action ? opts.action.onClick : null);
            return calls.length;
          };
          export const toast = Object.assign(rec("default"), { success: rec("success"), error: rec("error"), warning: rec("warning"), info: rec("info"), loading: rec("loading"), dismiss: () => {} });`,
      };
    });
    b.onLoad({ filter: /.*/, namespace: "action" }, (args) => ({
      loader: "js",
      contents: actionNames(args.path)
        .map((n) => `export const ${n} = (input) => window.__osAction(${JSON.stringify(n)}, input);`)
        .join("\n"),
    }));
  },
};

let bundle: Promise<string> | null = null;
function screenBundle(): Promise<string> {
  bundle ??= build({
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx", sourcefile: "export-ui-entry.tsx" },
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
  }).then((r) => r.outputFiles[0].text);
  return bundle;
}

let css: Promise<string> | null = null;
function panelCss(): Promise<string> {
  const from = path.join(ROOT, "src/app/globals.css");
  css ??= postcss([tailwind({ base: ROOT })])
    .process(readFileSync(from, "utf8"), { from })
    .then((r) => r.css);
  return css;
}

// ─── Servidor de mentira ────────────────────────────────────────────────────

type ActionResult = { ok: true; data: unknown } | { ok: false; error: string; field?: string };
/** Uma leitura do GET /api/exports/<id>: mudanças no ZIP, ou uma resposta de erro. */
type Step = Partial<ExportView> | { httpStatus: number; body?: unknown };

interface Session {
  page: Page;
  plan: ExportPlan;
  /** Respostas do exportPlanAction antes do plano normal (uma por chamada). */
  planResults: ActionResult[];
  /** Enquanto existir, o exportPlanAction espera (plano demorando para chegar). */
  planGate: Promise<void> | null;
  exports: ExportView[];
  /** Roteiro de leituras de cada ZIP gerado, na ordem dos "Gerar ZIP". */
  scripts: Step[][];
  byId: Map<string, Step[]>;
  reads: Map<string, number>;
  startError: string | null;
  calls: { name: string; input: Record<string, unknown> }[];
  downloads: string[];
  /** ZIPs cujo arquivo sumiu do disco (o download responde 410 com o motivo). */
  gone: Set<string>;
  downloadEvents: Download[];
  errors: string[];
  seq: number;
}

const DEFAULTS: ExportOptions = { splitter: true, serverEvents: false, optimizeHtml: true };
const FILE = "oferta-teste-2026-09-29.zip";

function view(over: Partial<ExportView> & { id: string }): ExportView {
  return {
    offerId: "o1",
    status: "QUEUED",
    progress: 0,
    step: null,
    options: DEFAULTS,
    fileName: FILE,
    bytes: null,
    errorMessage: null,
    warnings: [],
    createdAt: new Date().toISOString(),
    finishedAt: null,
    ...over,
  };
}

const PLAN: ExportPlan = {
  offerName: "Oferta Teste",
  hasVariants: true,
  hasServerEventTokens: true,
  serverEventVendors: ["META"],
  preserveJsPages: [],
  warnings: [],
  tree: [
    { path: "index.html", kind: "splitter", label: "Divisor A/B de “Página principal” (A 50% · B 50%)" },
    { path: "oferta-a/index.html", kind: "variant", label: "Página principal — versão A (50%)" },
    { path: "oferta-b/index.html", kind: "variant", label: "Página principal — versão B (50%)" },
    { path: "obrigado/index.html", kind: "page", label: "Obrigado" },
    { path: "obrigado/celular/index.html", kind: "mobile", label: "Obrigado — versão celular" },
    { path: "politica/index.html", kind: "legal", label: "Política de privacidade" },
    { path: "assets/", kind: "file", label: "Imagens, CSS e fontes (12 arquivos)" },
    { path: "LEIA-ME.txt", kind: "file", label: "Como subir na hospedagem" },
  ],
};

const PHP_WARNING =
  "O eventos.php só funciona em hospedagem com PHP (Hostinger, HostGator, cPanel). Em Netlify, Vercel ou outra hospedagem só de arquivos, não suba o eventos.php nem a pasta eventos-dados: os tokens ficariam visíveis.";

/** Plano como o servidor devolve para as opções pedidas (como src/server/services/export/plan.ts). */
function planFor(base: ExportPlan, raw?: Partial<ExportOptions>): ExportPlan {
  const o = { splitter: true, serverEvents: false, ...raw };
  let tree = base.tree.map((e) =>
    e.kind === "splitter" && !o.splitter
      ? { ...e, kind: "page" as const, label: "Página principal — versão A (principal)" }
      : e,
  );
  const events = o.serverEvents && base.hasServerEventTokens;
  if (events) {
    const readme = tree.findIndex((e) => e.path === "LEIA-ME.txt");
    tree = [
      ...tree.slice(0, readme),
      { path: "eventos.php", kind: "file", label: "Precisa de PHP · envia os eventos para a Meta pelo servidor" },
      { path: "eventos-dados/config.php", kind: "file", label: "Tokens do eventos.php (não compartilhe)" },
      { path: "eventos-dados/.htaccess", kind: "file", label: "Bloqueia a pasta dos tokens (Apache)" },
      ...tree.slice(readme),
    ];
  }
  return { ...base, tree, warnings: [...base.warnings, ...(events ? [PHP_WARNING] : [])] };
}

const DONE_STEP: Step = { status: "DONE", progress: 100, step: "Pronto para baixar", bytes: 2.4 * 1024 * 1024 };

async function action(s: Session, name: string, input: Record<string, unknown>): Promise<ActionResult> {
  s.calls.push({ name, input });
  switch (name) {
    case "exportPlanAction":
      if (s.planGate) await s.planGate;
      return s.planResults.shift() ?? { ok: true, data: planFor(s.plan, input.options as Partial<ExportOptions>) };
    case "listExportsAction":
      return { ok: true, data: s.exports.map((e) => ({ ...e })) };
    case "startExportAction": {
      if (s.startError) return { ok: false, error: s.startError };
      const id = `exp-${++s.seq}`;
      s.exports.unshift(view({ id, options: input.options as ExportOptions }));
      s.byId.set(id, s.scripts.shift() ?? [DONE_STEP]);
      return { ok: true, data: { exportId: id } };
    }
    case "deleteExportAction":
      s.exports = s.exports.filter((e) => e.id !== input.exportId);
      return { ok: true, data: undefined };
    default:
      throw new Error(`action sem roteiro: ${name}`);
  }
}

async function handleRoute(route: Route, s: Session) {
  const req = route.request();
  const url = new URL(req.url());
  if (url.origin !== ORIGIN) return route.abort();
  const download = /^\/api\/exports\/([^/]+)\/download$/.exec(url.pathname);
  if (download) {
    const id = decodeURIComponent(download[1]);
    if (s.gone.has(id)) {
      return route.fulfill({
        status: 410,
        contentType: "application/json",
        body:
          req.method() === "HEAD"
            ? ""
            : JSON.stringify({ error: "O arquivo deste ZIP não existe mais. Gere de novo." }),
      });
    }
    if (req.method() !== "HEAD") s.downloads.push(id);
    const exp = s.exports.find((e) => e.id === id);
    return route.fulfill({
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${exp?.fileName ?? "x.zip"}"`,
      },
      body: Buffer.from([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]),
    });
  }
  const status = /^\/api\/exports\/([^/]+)$/.exec(url.pathname);
  if (status) {
    const id = decodeURIComponent(status[1]);
    const steps = s.byId.get(id);
    const exp = s.exports.find((e) => e.id === id);
    if (!steps || !exp) {
      return route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"ZIP não encontrado."}' });
    }
    const n = s.reads.get(id) ?? 0;
    s.reads.set(id, n + 1);
    const step = steps[Math.min(n, steps.length - 1)];
    if ("httpStatus" in step) {
      return route.fulfill({
        status: step.httpStatus,
        contentType: "application/json",
        body: JSON.stringify(step.body ?? {}),
      });
    }
    Object.assign(exp, step);
    if (exp.status === "DONE" || exp.status === "FAILED") exp.finishedAt ??= new Date().toISOString();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(exp) });
  }
  return route.fulfill({
    contentType: "text/html; charset=utf-8",
    body: `<!doctype html><html lang="pt-BR" class="light"><head><meta charset="utf-8"><title>Oferta</title>
<style>${await panelCss()}</style></head><body><main id="root" style="padding:24px;display:flex;justify-content:flex-end"></main></body></html>`,
  });
}

let browser: Browser;
const sessions: Session[] = [];

beforeAll(async () => {
  await Promise.all([screenBundle(), panelCss()]);
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  for (const s of sessions) await s.page.close().catch(() => undefined);
  await browser?.close();
});

async function open(
  opts: {
    plan?: Partial<ExportPlan>;
    exports?: ExportView[];
    scripts?: Step[][];
    url?: string;
    autoOpen?: boolean;
    viewport?: { width: number; height: number };
    /** Navegador "de mentira" pelo User-Agent (ex.: Safari). */
    userAgent?: string;
  } = {},
): Promise<Session> {
  const page = await browser.newPage({
    viewport: opts.viewport ?? { width: 1280, height: 900 },
    locale: "pt-BR",
    acceptDownloads: true,
    ...(opts.userAgent ? { userAgent: opts.userAgent } : {}),
  });
  page.setDefaultTimeout(8000);
  const s: Session = {
    page,
    plan: { ...PLAN, ...opts.plan },
    planResults: [],
    planGate: null,
    exports: opts.exports ?? [],
    scripts: opts.scripts ?? [],
    byId: new Map(),
    reads: new Map(),
    startError: null,
    calls: [],
    downloads: [],
    gone: new Set(),
    downloadEvents: [],
    errors: [],
    seq: 0,
  };
  sessions.push(s);
  page.on("pageerror", (e) => s.errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) s.errors.push(m.text());
  });
  page.on("download", (d) => s.downloadEvents.push(d));
  await page.route("**/*", (route) => handleRoute(route, s));
  await page.exposeFunction("__osAction", (name: string, input: Record<string, unknown>) => action(s, name, input));
  await page.goto(`${ORIGIN}${opts.url ?? "/ofertas/o1"}`);
  await page.addScriptTag({ content: await screenBundle() });
  await page.evaluate((props) => (window as unknown as { OS: { render(p: unknown): void } }).OS.render(props), {
    offerId: "o1",
    autoOpen: opts.autoOpen ?? false,
    menu: {
      offer: { id: "o1", name: "Oferta Teste", status: "DRAFT", folderId: null, tagIds: [] },
      folders: [],
      allTags: [],
    },
  });
  return s;
}

/** expect.poll com o mesmo limite das outras esperas (8 s). */
const poll = <T>(fn: () => T | Promise<T>) => expect.poll(fn, { timeout: 8000, interval: 50 });
const dialog = (s: Session) => s.page.getByRole("dialog", { name: "Baixar ZIP" });
/** Rodapé do diálogo (o "X" do canto também se chama "Fechar"). */
const footer = (s: Session) => dialog(s).locator('[data-slot="dialog-footer"]');
const callsOf = (s: Session, name: string) => s.calls.filter((c) => c.name === name);
const toasts = (s: Session) =>
  s.page.evaluate(
    () =>
      (
        window as unknown as {
          __toasts: { type: string; message: string; description: string | null; action: string | null }[];
        }
      ).__toasts,
  );

async function waitFor(check: () => boolean | Promise<boolean>, label: string, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`tempo esgotado esperando ${label}`);
}

async function shot(s: Session, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await s.page.screenshot({ path: path.join(SHOTS, `export-${name}.png`) });
}

async function openDialog(s: Session) {
  await s.page.getByRole("button", { name: "Baixar ZIP" }).click();
  await poll(() => dialog(s).isVisible()).toBe(true);
  return dialog(s);
}

async function treePaths(s: Session) {
  const list = dialog(s).getByRole("list", { name: "Arquivos e pastas do ZIP" });
  await list.waitFor();
  return list.getByRole("listitem").evaluateAll((els) => els.map((el) => el.getAttribute("data-path")));
}

const treeLabel = (s: Session, p: string) => dialog(s).locator(`li[data-path="${p}"]`);

// ─── Testes ─────────────────────────────────────────────────────────────────

describe("Baixar ZIP — diálogo", () => {
  it("abre pelo botão: o que vai no ZIP, opções que se aplicam, ZIPs anteriores vazio e o passo a passo", async () => {
    const s = await open();
    const d = await openDialog(s);
    await poll(() => treePaths(s)).toEqual([
      "index.html",
      "oferta-a/",
      "oferta-b/",
      "obrigado/",
      "obrigado/celular/",
      "politica/",
      "assets/",
      "LEIA-ME.txt",
    ]);
    expect(await treeLabel(s, "index.html").textContent()).toContain(
      "Divisor A/B de “Página principal” (A 50% · B 50%)",
    );
    expect(await treeLabel(s, "oferta-b/").textContent()).toContain("versão B (50%)");
    // "celular/" fica dentro de "obrigado/".
    const indent = await treeLabel(s, "obrigado/celular/").evaluate((el) => getComputedStyle(el).paddingLeft);
    expect(indent).toBe("32px");
    expect(await d.getByText("Endereços relativos: funciona na raiz do domínio").isVisible()).toBe(true);

    const splitter = d.getByRole("switch", { name: "Divisor A/B" });
    const events = d.getByRole("switch", { name: "API de Conversões (Meta)", exact: true });
    const optimize = d.getByRole("switch", { name: "HTML otimizado" });
    expect(await splitter.getAttribute("aria-checked")).toBe("true");
    expect(await events.getAttribute("aria-checked")).toBe("false");
    expect(await optimize.getAttribute("aria-checked")).toBe("true");
    expect(await d.getByText("Só ligue se a sua hospedagem tiver PHP").count()).toBe(0);

    // eventos.php: aviso do PHP e os arquivos entram na árvore (antes do LEIA-ME).
    await events.click();
    await d.getByText("Só ligue se a sua hospedagem tiver PHP").waitFor();
    await poll(async () => (await treePaths(s)).slice(-5)).toEqual([
      "eventos.php",
      "eventos-dados/",
      "eventos-dados/config.php",
      "eventos-dados/.htaccess",
      "LEIA-ME.txt",
    ]);
    // Sem divisor: o index.html vira a versão A (o plano é pedido de novo com as opções).
    await splitter.click();
    await poll(() => treeLabel(s, "index.html").textContent()).toContain("versão A (principal)");
    await poll(() => callsOf(s, "exportPlanAction").at(-1)?.input).toEqual({
      offerId: "o1",
      options: { splitter: false, serverEvents: true },
    });
    // O aviso de PHP do plano não se repete em "Antes de subir" (já está na opção).
    expect(await d.getByText("Antes de subir").count()).toBe(0);
    await shot(s, "setup");

    // ZIPs anteriores: vazio.
    await d.getByText("Nenhum ZIP gerado ainda.").waitFor();
    // Passo a passo: fechado; abre com um clique.
    expect(await d.getByText("public_html", { exact: false }).count()).toBe(0);
    await d.getByRole("button", { name: "Como subir na hospedagem" }).click();
    await d.getByText("Gerenciador de arquivos").first().waitFor();
    expect(await d.getByText("Meta Pixel Helper").isVisible()).toBe(true);

    // Cancelar fecha sem gerar nada.
    await d.getByRole("button", { name: "Cancelar" }).click();
    await poll(() => d.isVisible()).toBe(false);
    expect(callsOf(s, "startExportAction")).toHaveLength(0);
    expect(s.errors).toEqual([]);
  });

  it("Gerar ZIP → progresso com a etapa → download automático → Baixar de novo → Voltar às opções", async () => {
    const s = await open({
      scripts: [
        [
          { status: "RUNNING", progress: 30, step: "Montando as páginas (1 de 3)…" },
          { status: "RUNNING", progress: 80, step: "Compactando o ZIP…" },
          { ...DONE_STEP, warnings: ["A página Obrigado não tem título: o Google mostra o endereço no lugar."] },
        ],
      ],
    });
    const d = await openDialog(s);
    await treePaths(s);
    const firstDownload = s.page.waitForEvent("download", { timeout: 15_000 });
    await d.getByRole("button", { name: "Gerar ZIP" }).click();

    await d.getByText("Montando as páginas (1 de 3)…").waitFor();
    const bar = d.getByRole("progressbar", { name: "Progresso do ZIP" });
    expect(await bar.getAttribute("aria-valuenow")).toBe("30");
    expect(await d.getByText("30%").isVisible()).toBe(true);
    expect(await d.getByText("Pode fechar esta janela").isVisible()).toBe(true);
    // A barra pinta 30% do trilho.
    await poll(() =>
      d.locator('[data-slot="progress-indicator"]').evaluate((el) => {
        const bar = el.getBoundingClientRect();
        const track = (el.parentElement as HTMLElement).getBoundingClientRect();
        return Math.round(((bar.right - track.left) / track.width) * 100);
      }),
    ).toBe(30);
    await shot(s, "progress");
    await d.getByText("Compactando o ZIP…").waitFor();
    expect(await bar.getAttribute("aria-valuenow")).toBe("80");

    const download = await firstDownload;
    expect(new URL(download.url()).pathname).toBe("/api/exports/exp-1/download");
    expect(download.suggestedFilename()).toBe(FILE);
    expect(callsOf(s, "startExportAction")[0].input).toEqual({ offerId: "o1", options: DEFAULTS });

    await d.getByText("ZIP pronto! O download começou.").waitFor();
    expect(await d.getByText(`${FILE}`, { exact: true }).first().isVisible()).toBe(true);
    expect(await d.getByText("· 2,4 MB").isVisible()).toBe(true);
    expect(await d.getByText("A página Obrigado não tem título").isVisible()).toBe(true);
    // Primeiro ZIP da oferta: o passo a passo já abre.
    expect(await d.getByText("Gerenciador de arquivos").first().isVisible()).toBe(true);
    // A lista foi relida quando o ZIP ficou pronto; o ZIP de cima não se repete nela e, sem
    // outros, a parte "ZIPs anteriores" nem aparece.
    await waitFor(() => callsOf(s, "listExportsAction").length >= 2, "lista relida");
    expect(await d.getByRole("heading", { name: "ZIPs anteriores" }).count()).toBe(0);
    await shot(s, "done");

    const again = s.page.waitForEvent("download");
    await d.getByRole("button", { name: "Baixar de novo" }).click();
    expect(new URL((await again).url()).pathname).toBe("/api/exports/exp-1/download");

    await d.getByRole("button", { name: "Voltar às opções" }).click();
    await d.getByRole("button", { name: "Gerar ZIP" }).waitFor();
    const row = d.getByRole("list", { name: "ZIPs anteriores" }).getByRole("listitem");
    expect(await row.count()).toBe(1);
    expect(await row.textContent()).toContain("2,4 MB · Divisor A/B · HTML otimizado");
    const fromList = s.page.waitForEvent("download");
    await row.getByRole("button", { name: /^Baixar oferta-teste-2026-09-29\.zip de / }).click();
    expect(new URL((await fromList).url()).pathname).toBe("/api/exports/exp-1/download");
    expect((await toasts(s)).filter((t) => t.type === "error")).toEqual([]);
    expect(s.errors).toEqual([]);
  });

  it("Safari: o “ZIP pronto” avisa que ele pode descompactar o ZIP sozinho (no Chrome, não)", async () => {
    const SAFARI =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
    for (const [userAgent, shows] of [
      [SAFARI, true],
      [undefined, false],
    ] as const) {
      const s = await open({ userAgent, scripts: [[DONE_STEP]] });
      const d = await openDialog(s);
      await treePaths(s);
      await d.getByRole("button", { name: "Gerar ZIP" }).click();
      await d.getByText("ZIP pronto! O download começou.").waitFor();
      const tip = d.locator('[data-slot="export-notice"]').filter({ hasText: "Baixou pelo Safari?" });
      expect(await tip.count(), String(userAgent)).toBe(shows ? 1 : 0);
      if (shows) {
        const text = await tip.textContent();
        expect(text).toContain("pegue o .zip na Lixeira");
        expect(text).toContain("Não compacte a pasta de novo");
      }
      // O passo a passo (aberto no primeiro ZIP) traz o mesmo aviso em qualquer navegador.
      expect(await d.getByRole("heading", { name: "Baixou pelo Safari?" }).count()).toBe(1);
      expect(s.errors).toEqual([]);
      await s.page.close();
    }
  });

  it("falha: mensagem amigável; Tentar de novo usa as mesmas opções", async () => {
    const s = await open({
      scripts: [
        [
          { status: "RUNNING", progress: 20, step: "Lendo a oferta…" },
          {
            status: "FAILED",
            progress: 40,
            errorMessage: 'A página "Obrigado" está sem conteúdo. Abra no editor e salve de novo.',
          },
        ],
        [DONE_STEP],
      ],
    });
    const d = await openDialog(s);
    await treePaths(s);
    await d.getByRole("switch", { name: "HTML otimizado" }).click();
    await d.getByRole("button", { name: "Gerar ZIP" }).click();
    const alert = d.getByRole("alert");
    await alert.getByText("Não foi possível gerar o ZIP").waitFor();
    expect(await alert.textContent()).toContain('A página "Obrigado" está sem conteúdo.');
    await shot(s, "failed");
    expect(s.downloadEvents).toHaveLength(0);
    // Com o diálogo aberto, o erro aparece nele (sem toast).
    expect((await toasts(s)).filter((t) => t.type === "error")).toEqual([]);

    const download = s.page.waitForEvent("download", { timeout: 15_000 });
    await d.getByRole("button", { name: "Tentar de novo" }).click();
    await download;
    const starts = callsOf(s, "startExportAction").map((c) => c.input);
    expect(starts).toEqual([
      { offerId: "o1", options: { ...DEFAULTS, optimizeHtml: false } },
      { offerId: "o1", options: { ...DEFAULTS, optimizeHtml: false } },
    ]);
    await d.getByText("ZIP pronto! O download começou.").waitFor();
    // Já existe um ZIP anterior (o que falhou): a lista mostra o selo.
    const failedRow = d.getByRole("list", { name: "ZIPs anteriores" }).locator('li[data-export-id="exp-1"]');
    await failedRow.getByText("Falhou").waitFor();
  });

  it("fechar no meio: o ZIP continua, aviso com Baixar quando fica pronto e o diálogo mostra o resultado", async () => {
    const s = await open({
      scripts: [
        [
          { status: "RUNNING", progress: 10, step: "Lendo a oferta…" },
          { status: "RUNNING", progress: 50, step: "Copiando imagens e arquivos…" },
          { status: "RUNNING", progress: 90, step: "Compactando o ZIP…" },
          DONE_STEP,
        ],
      ],
    });
    const d = await openDialog(s);
    await treePaths(s);
    await d.getByRole("button", { name: "Gerar ZIP" }).click();
    await d.getByText("Lendo a oferta…").waitFor();
    await footer(s).getByRole("button", { name: "Fechar" }).click();
    await poll(() => d.isVisible()).toBe(false);
    // O botão continua lá (com o indicador de "gerando").
    const button = s.page.getByRole("button", { name: "Baixar ZIP" });
    expect(await button.locator("svg.animate-spin").count()).toBe(1);

    await waitFor(
      async () => (await toasts(s)).some((t) => t.message === "Seu ZIP está pronto."),
      "aviso de pronto",
      12_000,
    );
    const ready = (await toasts(s)).find((t) => t.message === "Seu ZIP está pronto.");
    expect(ready).toMatchObject({ type: "success", description: FILE, action: "Baixar" });
    // Com o diálogo fechado, nada baixa sozinho.
    expect(s.downloadEvents).toHaveLength(0);
    expect(await button.locator("svg.animate-spin").count()).toBe(0);

    const download = s.page.waitForEvent("download");
    await s.page.evaluate(() => {
      const w = window as unknown as { __toasts: { message: string }[]; __toastActions: ((() => void) | null)[] };
      const i = w.__toasts.findIndex((t) => t.message === "Seu ZIP está pronto.");
      w.__toastActions[i]?.();
    });
    expect(new URL((await download).url()).pathname).toBe("/api/exports/exp-1/download");

    // Reabrindo: mostra o ZIP pronto (sem dizer que o download começou sozinho).
    await openDialog(s);
    await d.getByText("ZIP pronto!", { exact: true }).waitFor();
    // Fechar com o ZIP pronto: na próxima vez começa pelas opções.
    await s.page.keyboard.press("Escape");
    await poll(() => d.isVisible()).toBe(false);
    await openDialog(s);
    await d.getByRole("button", { name: "Gerar ZIP" }).waitFor();
  });

  it("falha com o diálogo fechado → aviso de erro", async () => {
    const s = await open({
      scripts: [
        [
          { status: "RUNNING", progress: 10 },
          { status: "FAILED", errorMessage: "Faltou espaço no disco." },
        ],
      ],
    });
    const d = await openDialog(s);
    await treePaths(s);
    await d.getByRole("button", { name: "Gerar ZIP" }).click();
    await d.getByRole("heading", { name: "Gerando o ZIP…" }).waitFor();
    await d.getByText("Preparando os arquivos…").waitFor();
    await s.page.keyboard.press("Escape");
    await waitFor(
      async () => (await toasts(s)).some((t) => t.type === "error" && t.message === "Faltou espaço no disco."),
      "aviso de erro",
    );
  });

  it('?baixar=1 abre o diálogo e sai do endereço; o menu não repete o ZIP; o "Próximos passos" abre o mesmo diálogo', async () => {
    const s = await open({ url: "/ofertas/o1?aba=links&baixar=1", autoOpen: true });
    await poll(() => dialog(s).isVisible()).toBe(true);
    expect(await s.page.evaluate(() => location.pathname + location.search)).toBe("/ofertas/o1?aba=links");
    await s.page.keyboard.press("Escape");
    await poll(() => dialog(s).isVisible()).toBe(false);
    // Não reabre sozinho depois de fechado.
    await s.page.waitForTimeout(300);
    expect(await dialog(s).isVisible()).toBe(false);

    // O menu "Ações" não repete o botão principal "Baixar ZIP" ao lado.
    await s.page.getByRole("button", { name: "Ações" }).click();
    await s.page.getByRole("menuitem", { name: "Renomear…" }).waitFor();
    expect(await s.page.getByRole("menuitem", { name: "Baixar ZIP" }).count()).toBe(0);
    await s.page.keyboard.press("Escape");
    // O cartão "Próximos passos" abre o mesmo diálogo pelo evento da janela.
    await s.page.evaluate(() => window.dispatchEvent(new Event("os:abrir-zip")));
    await poll(() => dialog(s).isVisible()).toBe(true);
    expect(await s.page.evaluate(() => (window as unknown as { __navs?: string[] }).__navs ?? [])).toEqual([]);
  });

  it("ZIPs anteriores: opções do último ZIP, falhou com o motivo, apagar", async () => {
    const day = (d: number) => new Date(Date.UTC(2026, 8, d, 15, 0)).toISOString();
    const s = await open({
      exports: [
        view({
          id: "e3",
          status: "DONE",
          progress: 100,
          bytes: 850 * 1024,
          createdAt: day(28),
          options: { splitter: false, serverEvents: true, optimizeHtml: true },
        }),
        view({ id: "e2", status: "FAILED", progress: 40, createdAt: day(27), errorMessage: "A página X está vazia." }),
        view({ id: "e1", status: "DONE", progress: 100, bytes: 3 * 1024 * 1024, createdAt: day(26) }),
      ],
    });
    const d = await openDialog(s);
    const list = d.getByRole("list", { name: "ZIPs anteriores" });
    await poll(() => list.getByRole("listitem").count()).toBe(3);
    const e3 = list.locator('li[data-export-id="e3"]');
    expect(await e3.textContent()).toContain("850 KB · eventos.php · HTML otimizado");
    const e2 = list.locator('li[data-export-id="e2"]');
    expect(await e2.textContent()).toContain("Falhou");
    expect(await e2.textContent()).toContain("A página X está vazia.");
    expect(await e2.getByRole("button", { name: /^Baixar / }).count()).toBe(0);

    // O formulário começa com as opções do último ZIP pronto.
    await poll(() => d.getByRole("switch", { name: "Divisor A/B" }).getAttribute("aria-checked")).toBe("false");
    expect(
      await d.getByRole("switch", { name: "API de Conversões (Meta)", exact: true }).getAttribute("aria-checked"),
    ).toBe("true");
    await d.getByText("Só ligue se a sua hospedagem tiver PHP").waitFor();
    expect(await treePaths(s)).toContain("eventos.php");
    // Já tem ZIP pronto: o passo a passo não abre sozinho.
    expect(await d.getByText("Gerenciador de arquivos").count()).toBe(0);
    await shot(s, "history");

    await e2.getByRole("button", { name: /^Apagar / }).click();
    await poll(() => list.getByRole("listitem").count()).toBe(2);
    expect(callsOf(s, "deleteExportAction").map((c) => c.input)).toEqual([{ exportId: "e2" }]);
    expect((await toasts(s)).some((t) => t.type === "success" && t.message === "ZIP apagado.")).toBe(true);

    const download = s.page.waitForEvent("download");
    await list
      .locator('li[data-export-id="e1"]')
      .getByRole("button", { name: /^Baixar / })
      .click();
    expect(new URL((await download).url()).pathname).toBe("/api/exports/e1/download");

    // Gerar usa as opções mostradas.
    await d.getByRole("button", { name: "Gerar ZIP" }).click();
    await waitFor(() => callsOf(s, "startExportAction").length === 1, "Gerar ZIP");
    expect(callsOf(s, "startExportAction")[0].input).toEqual({
      offerId: "o1",
      options: { splitter: false, serverEvents: true, optimizeHtml: true },
    });
  });

  it("ZIP parado na fila com o robô de tarefas parado: explica, cancela o pedido e volta às opções", async () => {
    const old = new Date(Date.now() - 60_000).toISOString();
    const s = await open({ exports: [view({ id: "e5", status: "QUEUED", createdAt: old })] });
    s.byId.set("e5", [{ status: "QUEUED", workerOnline: false }]);
    const d = await openDialog(s);
    // Reaberto com o ZIP na fila: acompanha ele, mas dá para sair.
    await d.getByText("O ZIP não começou").waitFor();
    expect(await d.getByText("O robô de tarefas do Offer Studio parece parado").isVisible()).toBe(true);
    expect(await d.getByRole("heading", { name: "Na fila para gerar o ZIP…" }).isVisible()).toBe(true);
    expect(await footer(s).getByRole("button", { name: "Voltar às opções" }).isVisible()).toBe(true);
    await shot(s, "stalled");
    await footer(s).getByRole("button", { name: "Cancelar pedido" }).click();
    await footer(s).getByRole("button", { name: "Gerar ZIP" }).waitFor();
    expect(callsOf(s, "deleteExportAction").map((c) => c.input)).toEqual([{ exportId: "e5" }]);
    expect((await toasts(s)).some((t) => t.type === "success" && t.message === "Pedido do ZIP cancelado.")).toBe(true);
    expect(s.errors).toEqual([]);
  });

  it("robô de tarefas funcionando: na fila sem aviso de parado", async () => {
    const old = new Date(Date.now() - 60_000).toISOString();
    const s = await open({ exports: [view({ id: "e6", status: "QUEUED", createdAt: old })] });
    s.byId.set("e6", [{ status: "QUEUED", workerOnline: true }]);
    const d = await openDialog(s);
    await d.getByRole("heading", { name: "Na fila para gerar o ZIP…" }).waitFor();
    await s.page.waitForTimeout(1500);
    expect(await d.getByText("O ZIP não começou").count()).toBe(0);
    // Na fila: dá para cancelar; voltar às opções não apaga o pedido.
    await footer(s).getByRole("button", { name: "Voltar às opções" }).click();
    await footer(s).getByRole("button", { name: "Gerar ZIP" }).waitFor();
    expect(callsOf(s, "deleteExportAction")).toHaveLength(0);
    // O pedido continua em "ZIPs anteriores" (dá para cancelar ali).
    const row = dialog(s).getByRole("list", { name: "ZIPs anteriores" }).locator('li[data-export-id="e6"]');
    await row.getByText("Na fila").waitFor();
  });

  it("Voltar às opções com o ZIP sendo gerado: segue em ZIPs anteriores com o andamento e avisa quando fica pronto", async () => {
    const s = await open({
      scripts: [
        [
          { status: "RUNNING", progress: 10, step: "Lendo a oferta…" },
          { status: "RUNNING", progress: 40, step: "Copiando imagens e arquivos…" },
          { status: "RUNNING", progress: 40, step: "Copiando imagens e arquivos…" },
          { status: "RUNNING", progress: 70, step: "Compactando o ZIP…" },
          DONE_STEP,
        ],
      ],
    });
    const d = await openDialog(s);
    await treePaths(s);
    await d.getByRole("button", { name: "Gerar ZIP" }).click();
    await d.getByText("Lendo a oferta…").waitFor();
    await footer(s).getByRole("button", { name: "Voltar às opções" }).click();
    await footer(s).getByRole("button", { name: "Gerar ZIP" }).waitFor();
    // Daqui em diante a tela fica nas opções (nada de voltar sozinha para o progresso).
    await s.page.evaluate(() => {
      const w = window as unknown as { __stages: string[] };
      w.__stages = [];
      const el = document.querySelector("[data-stage]") as HTMLElement;
      new MutationObserver(() => w.__stages.push(el.dataset.stage ?? "")).observe(el, {
        attributes: true,
        attributeFilter: ["data-stage"],
      });
    });
    const row = d.getByRole("list", { name: "ZIPs anteriores" }).locator('li[data-export-id="exp-1"]');
    await row.getByText(/Gerando o ZIP · (40|70)%/).waitFor();
    await shot(s, "detached-running");

    await waitFor(
      async () => (await toasts(s)).some((t) => t.message === "Seu ZIP está pronto."),
      "aviso de pronto",
      12_000,
    );
    expect((await toasts(s)).find((t) => t.message === "Seu ZIP está pronto.")).toMatchObject({
      type: "success",
      description: FILE,
      action: "Baixar",
    });
    await row.getByRole("button", { name: /^Baixar / }).waitFor();
    expect(await row.textContent()).toContain("2,4 MB");
    expect(await s.page.evaluate(() => (window as unknown as { __stages: string[] }).__stages)).toEqual([]);
    expect(await footer(s).getByRole("button", { name: "Gerar ZIP" }).isVisible()).toBe(true);
    // Nada baixa sozinho (a pessoa saiu da tela de progresso): o aviso e a linha têm "Baixar".
    expect(s.downloadEvents).toHaveLength(0);
    const download = s.page.waitForEvent("download");
    await row.getByRole("button", { name: /^Baixar / }).click();
    expect(new URL((await download).url()).pathname).toBe("/api/exports/exp-1/download");
    expect((await toasts(s)).filter((t) => t.type === "error")).toEqual([]);
    expect(s.errors).toEqual([]);
  });

  it("Voltar às opções e fechar: o botão mostra que está gerando, reabrir não prende no progresso e o aviso chega", async () => {
    const s = await open({
      scripts: [
        [
          { status: "RUNNING", progress: 10, step: "Lendo a oferta…" },
          { status: "RUNNING", progress: 30 },
          { status: "RUNNING", progress: 50 },
          { status: "RUNNING", progress: 60 },
          { status: "RUNNING", progress: 80 },
          DONE_STEP,
        ],
      ],
    });
    const d = await openDialog(s);
    await treePaths(s);
    await d.getByRole("button", { name: "Gerar ZIP" }).click();
    await d.getByText("Lendo a oferta…").waitFor();
    await footer(s).getByRole("button", { name: "Voltar às opções" }).click();
    await footer(s).getByRole("button", { name: "Gerar ZIP" }).waitFor();
    await s.page.keyboard.press("Escape");
    await poll(() => d.isVisible()).toBe(false);
    const button = s.page.getByRole("button", { name: "Baixar ZIP" });
    expect(await button.locator("svg.animate-spin").count()).toBe(1);
    // Reabrindo antes de ficar pronto: as opções, com o ZIP em "ZIPs anteriores".
    await openDialog(s);
    await footer(s).getByRole("button", { name: "Gerar ZIP" }).waitFor();
    await d.getByRole("list", { name: "ZIPs anteriores" }).locator('li[data-export-id="exp-1"]').waitFor();
    expect(await d.getByRole("heading", { name: "Gerando o ZIP…" }).count()).toBe(0);
    await s.page.keyboard.press("Escape");
    await poll(() => d.isVisible()).toBe(false);
    await waitFor(
      async () => (await toasts(s)).some((t) => t.message === "Seu ZIP está pronto."),
      "aviso de pronto",
      12_000,
    );
    expect(await button.locator("svg.animate-spin").count()).toBe(0);
    expect(s.downloadEvents).toHaveLength(0);
    expect(s.errors).toEqual([]);
  });

  it("Voltar às opções com o ZIP na fila: cancela pelo item em ZIPs anteriores", async () => {
    const s = await open({ scripts: [[{ status: "QUEUED", workerOnline: true }]] });
    const d = await openDialog(s);
    await treePaths(s);
    await d.getByRole("button", { name: "Gerar ZIP" }).click();
    await d.getByRole("heading", { name: "Na fila para gerar o ZIP…" }).waitFor();
    await footer(s).getByRole("button", { name: "Voltar às opções" }).click();
    await footer(s).getByRole("button", { name: "Gerar ZIP" }).waitFor();
    const row = d.getByRole("list", { name: "ZIPs anteriores" }).locator('li[data-export-id="exp-1"]');
    await row.getByText("Na fila").waitFor();
    await row.getByRole("button", { name: /^Cancelar / }).click();
    await poll(() => row.count()).toBe(0);
    expect(callsOf(s, "deleteExportAction").map((c) => c.input)).toEqual([{ exportId: "exp-1" }]);
    expect((await toasts(s)).some((t) => t.type === "success" && t.message === "Pedido do ZIP cancelado.")).toBe(true);
    // Nada de aviso de pronto ou de erro de um pedido cancelado.
    await s.page.waitForTimeout(1500);
    expect((await toasts(s)).filter((t) => t.message === "Seu ZIP está pronto." || t.type === "error")).toEqual([]);
    expect(await footer(s).getByRole("button", { name: "Gerar ZIP" }).isVisible()).toBe(true);
    expect(s.errors).toEqual([]);
  });

  it("baixar um ZIP cujo arquivo sumiu: mostra o motivo em português (sem download que falha calado)", async () => {
    const s = await open({ exports: [view({ id: "e7", status: "DONE", progress: 100, bytes: 1024 })] });
    s.gone.add("e7");
    const d = await openDialog(s);
    const row = d.getByRole("list", { name: "ZIPs anteriores" }).locator('li[data-export-id="e7"]');
    const before = callsOf(s, "listExportsAction").length;
    await row.getByRole("button", { name: /^Baixar / }).click();
    await poll(async () => (await toasts(s)).filter((t) => t.type === "error").map((t) => t.message)).toEqual([
      "O arquivo deste ZIP não existe mais. Gere de novo.",
    ]);
    // A lista é relida (o ZIP pode ter sido apagado de vez).
    await waitFor(() => callsOf(s, "listExportsAction").length > before, "lista relida");
    expect(s.downloadEvents).toHaveLength(0);
    expect(s.downloads).toEqual([]);
  });

  it("sem versões e sem token: só 'HTML otimizado', e o eventos.php nunca é pedido", async () => {
    const s = await open({
      plan: {
        hasVariants: false,
        hasServerEventTokens: false,
        serverEventVendors: [],
        tree: [
          { path: "index.html", kind: "page", label: "Página inicial" },
          { path: "obrigado/index.html", kind: "page", label: "Obrigado" },
          { path: "assets/", kind: "file", label: "Imagens, CSS e fontes" },
        ],
      },
      exports: [
        view({
          id: "e1",
          status: "DONE",
          progress: 100,
          options: { splitter: true, serverEvents: true, optimizeHtml: true },
        }),
      ],
    });
    const d = await openDialog(s);
    await poll(() => treePaths(s)).toEqual(["index.html", "obrigado/", "assets/"]);
    expect(await d.getByRole("switch").count()).toBe(1);
    expect(await d.getByRole("switch", { name: "HTML otimizado" }).count()).toBe(1);
    // O resumo do ZIP anterior não fala em divisor (a oferta não tem versões).
    const row = d.getByRole("list", { name: "ZIPs anteriores" }).getByRole("listitem");
    expect(await row.textContent()).not.toContain("Divisor A/B");
    await d.getByRole("button", { name: "Gerar ZIP" }).click();
    await waitFor(() => callsOf(s, "startExportAction").length === 1, "Gerar ZIP");
    expect((callsOf(s, "startExportAction")[0].input.options as ExportOptions).serverEvents).toBe(false);
    for (const c of callsOf(s, "exportPlanAction")) {
      expect((c.input.options as ExportOptions).serverEvents).toBe(false);
    }
  });

  it("retoma um ZIP que ainda estava sendo gerado (tela recarregada) e baixa quando fica pronto", async () => {
    const s = await open({
      exports: [view({ id: "e9", status: "RUNNING", progress: 60, step: "Copiando imagens e arquivos…" })],
    });
    s.byId.set("e9", [{ status: "RUNNING", progress: 60, step: "Copiando imagens e arquivos…" }, DONE_STEP]);
    const download = s.page.waitForEvent("download", { timeout: 15_000 });
    const d = await openDialog(s);
    await d.getByText("Copiando imagens e arquivos…").waitFor();
    expect(new URL((await download).url()).pathname).toBe("/api/exports/e9/download");
    await d.getByText("ZIP pronto! O download começou.").waitFor();
  });

  it("avisos do plano e páginas Preservar JS", async () => {
    const warning = 'A página "Quiz" usa o modo Preservar JS: hospede a oferta na raiz do domínio, não numa subpasta.';
    const s = await open({ plan: { warnings: [warning], preserveJsPages: ["Quiz"] } });
    const d = await openDialog(s);
    await treePaths(s);
    await d.getByText("Antes de subir").waitFor();
    expect(await d.getByText(warning).isVisible()).toBe(true);
    expect(await d.getByText("Endereços relativos").count()).toBe(0);
    await d.getByRole("button", { name: "Como subir na hospedagem" }).click();
    await d.getByText(/só funciona na raiz do domínio/).waitFor();
  });

  it("erros: plano que não carrega (Tentar de novo), não conseguiu começar, ZIP apagado no meio", async () => {
    const s = await open({
      scripts: [
        [
          { status: "RUNNING", progress: 5 },
          { httpStatus: 404, body: { error: "x" } },
        ],
      ],
    });
    s.planResults.push({ ok: false, error: "Oferta não encontrada." });
    const d = await openDialog(s);
    const alert = d.getByRole("alert");
    await alert.getByText("Oferta não encontrada.").waitFor();
    await alert.getByRole("button", { name: "Tentar de novo" }).click();
    await treePaths(s);

    s.startError = "Esta oferta não tem páginas para exportar.";
    await d.getByRole("button", { name: "Gerar ZIP" }).click();
    await waitFor(
      async () => (await toasts(s)).some((t) => t.type === "error" && t.message === s.startError),
      "erro ao começar",
    );
    // Continua nas opções.
    await poll(() => d.getByRole("button", { name: "Gerar ZIP" }).isEnabled()).toBe(true);

    s.startError = null;
    await d.getByRole("button", { name: "Gerar ZIP" }).click();
    await d
      .getByRole("alert")
      .getByText(/Este ZIP não existe mais/)
      .waitFor();
    expect(await d.getByRole("button", { name: "Tentar de novo" }).isVisible()).toBe(true);
    await d.getByRole("button", { name: "Voltar às opções" }).click();
    await d.getByRole("button", { name: "Gerar ZIP" }).waitFor();
  });

  it("Gerar ZIP espera o plano chegar (sem ele, não dá para saber se o eventos.php pode ir)", async () => {
    let release = () => {};
    const s = await open({
      exports: [
        view({
          id: "e1",
          status: "DONE",
          progress: 100,
          options: { splitter: true, serverEvents: true, optimizeHtml: true },
        }),
      ],
    });
    s.planGate = new Promise<void>((r) => {
      release = r;
    });
    const d = await openDialog(s);
    const generate = d.getByRole("button", { name: "Gerar ZIP" });
    await generate.waitFor();
    expect(await generate.isDisabled()).toBe(true);
    expect(await d.locator('[aria-busy="true"]').count()).toBeGreaterThan(0);
    s.planGate = null;
    release();
    await poll(() => generate.isEnabled()).toBe(true);
    await generate.click();
    // Com o plano (há token), as opções do último ZIP vão como estavam, com o eventos.php.
    await poll(() => callsOf(s, "startExportAction")[0]?.input).toEqual({
      offerId: "o1",
      options: { splitter: true, serverEvents: true, optimizeHtml: true },
    });
  });

  it("sem conexão por um tempo: avisa e continua tentando até ficar pronto", async () => {
    const s = await open({
      scripts: [[{ status: "RUNNING", progress: 10 }, { httpStatus: 500, body: {} }, { httpStatus: 503 }, DONE_STEP]],
    });
    const d = await openDialog(s);
    await treePaths(s);
    const download = s.page.waitForEvent("download", { timeout: 20_000 });
    await d.getByRole("button", { name: "Gerar ZIP" }).click();
    await d.getByText("Sem conexão com o Offer Studio. Tentando de novo…").waitFor({ timeout: 8000 });
    await download;
    await d.getByText("ZIP pronto! O download começou.").waitFor();
  }, 30_000);
  it("cabe no celular: sem rolagem para o lado, com o rodapé à vista", async () => {
    const day = new Date(Date.UTC(2026, 8, 28, 15, 0)).toISOString();
    const s = await open({
      viewport: { width: 375, height: 740 },
      exports: [view({ id: "e1", status: "DONE", progress: 100, bytes: 5 * 1024 * 1024, createdAt: day })],
    });
    const d = await openDialog(s);
    await treePaths(s);
    await d.getByRole("button", { name: "Como subir na hospedagem" }).click();
    await d.getByText("Gerenciador de arquivos").first().waitFor();
    const overflow = await d.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return {
        dialog: box.width <= window.innerWidth && box.left >= 0,
        page: document.documentElement.scrollWidth <= window.innerWidth,
      };
    });
    expect(overflow.dialog).toBe(true);
    expect(overflow.page).toBe(true);
    expect(await footer(s).getByRole("button", { name: "Gerar ZIP" }).isVisible()).toBe(true);
    const box = await footer(s).getByRole("button", { name: "Gerar ZIP" }).boundingBox();
    expect(box && box.y + box.height).toBeLessThanOrEqual(740);
    await shot(s, "mobile");
  });
});
