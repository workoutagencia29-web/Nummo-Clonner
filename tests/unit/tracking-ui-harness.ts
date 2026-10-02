/**
 * Telas da Fase 4 ("Pixels e rastreamento" e "Empresa e SEO") num Chromium de
 * verdade, com o CSS do painel (Tailwind compilado) e as server actions DE
 * VERDADE rodando no Node com o banco de teste:
 *
 * - o navegador chama window.__osAction(nome, entrada) → a action real
 *   (src/server/actions/tracking.ts / offer-settings.ts) roda aqui, com login e
 *   revalidatePath simulados pelo arquivo de teste (vi.mock);
 * - depois de cada alteração, a tela recebe os dados novos do banco
 *   (getTrackingPanel / getOfferSettingsPanel), como o Next faz com o
 *   revalidatePath;
 * - /api/assets/upload chama a rota real de envio de imagens;
 * - toasts (sonner), next/link e next/navigation são anotados;
 * - nada sai para a internet: todo pedido fora de http://painel.test é abortado.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import tailwind from "@tailwindcss/postcss";
import { build, type Plugin } from "esbuild";
import type { Browser, Page, Route } from "playwright";
import postcss from "postcss";
import { POST as uploadRoute } from "@/app/api/assets/upload/route";
import * as settingsActions from "@/server/actions/offer-settings";
import * as trackingActions from "@/server/actions/tracking";
import { getOfferSettingsPanel } from "@/server/services/offer-settings";
import { getTrackingPanel } from "@/server/services/tracking";

const ROOT = path.resolve(import.meta.dirname, "../..");
export const ORIGIN = "http://painel.test";

const ENTRY = `
import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { TrackingPanel } from "@/components/offers/tracking/tracking-panel";
import { OfferSettingsPanel } from "@/components/offers/settings/offer-settings-panel";
import { PageSeoDialog } from "@/components/offers/settings/page-seo-dialog";

let root = null;
function SeoHarness({ offerId, page, startClosed }) {
  const [open, setOpen] = useState(startClosed ? null : page);
  return createElement("div", null,
    createElement("button", { type: "button", onClick: () => setOpen(page) }, "Abrir SEO"),
    createElement(PageSeoDialog, { offerId, page: open, onClose: () => { setOpen(null); window.__closed = (window.__closed || 0) + 1; } }),
  );
}
window.OS = {
  render(kind, props) {
    root = root || createRoot(document.getElementById("root"));
    if (kind === "tracking") root.render(createElement(TrackingPanel, props));
    else if (kind === "settings") root.render(createElement(OfferSettingsPanel, props));
    else root.render(createElement(SeoHarness, props));
  },
};
`;

const ACTION_MODULES: Record<string, Record<string, unknown>> = {
  tracking: trackingActions,
  "offer-settings": settingsActions,
};

const stubs: Plugin = {
  name: "tracking-ui-stubs",
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
          const rec = (type) => (message) => { calls.push({ type, message: String(message) }); return calls.length; };
          export const toast = Object.assign(rec("default"), { success: rec("success"), error: rec("error"), warning: rec("warning"), info: rec("info"), loading: rec("loading"), dismiss: () => {} });`,
      };
    });
    b.onLoad({ filter: /.*/, namespace: "action" }, (args) => {
      const mod = ACTION_MODULES[args.path];
      if (!mod) throw new Error(`server action sem stub: ${args.path}`);
      return {
        loader: "js",
        contents: Object.keys(mod)
          .map((n) => `export const ${n} = (input) => window.__osAction(${JSON.stringify(n)}, input);`)
          .join("\n"),
      };
    });
  },
};

let bundle: Promise<string> | null = null;
export function panelBundle(): Promise<string> {
  bundle ??= build({
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx", sourcefile: "tracking-ui-entry.tsx" },
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
/** CSS do painel (o mesmo globals.css do app, compilado pelo Tailwind). */
export function panelCss(): Promise<string> {
  const from = path.join(ROOT, "src/app/globals.css");
  css ??= postcss([tailwind({ base: ROOT })])
    .process(readFileSync(from, "utf8"), { from })
    .then((r) => r.css);
  return css;
}

/** PNG 1×1 para as imagens da biblioteca na tela. */
const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

export type Kind = "tracking" | "settings" | "seo";

export interface ActionCall {
  name: string;
  input: Record<string, unknown>;
  result: { ok: boolean; error?: string; field?: string; data?: unknown };
}

export interface Session {
  page: Page;
  offerId: string;
  calls: ActionCall[];
  errors: string[];
  uploads: number;
  /** Próxima resposta de uma action (em vez da real), uma vez. */
  override: Map<string, (input: Record<string, unknown>) => unknown>;
  /** Quantas vezes a tela recebeu dados novos (como o revalidatePath do Next). */
  refreshes: number;
  /** Toasts já conferidos por waitToast (texto → quantidade). */
  seenToasts: Map<string, number>;
}

async function dataFor(kind: Kind, offerId: string) {
  if (kind === "tracking") return getTrackingPanel(offerId);
  if (kind === "settings") return getOfferSettingsPanel(offerId);
  return null;
}

async function handleRoute(route: Route, s: Session) {
  const req = route.request();
  const url = new URL(req.url());
  if (url.origin !== ORIGIN) return route.abort();
  if (url.pathname === "/") {
    return route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html lang="pt-BR" class="light"><head><meta charset="utf-8"><title>Painel</title>
<style>${await panelCss()}</style></head><body><main id="root" style="padding:24px"></main></body></html>`,
    });
  }
  if (url.pathname === "/api/assets/upload" && req.method() === "POST") {
    s.uploads++;
    const res = await uploadRoute(
      new Request(`http://localhost:3000/api/assets/upload`, {
        method: "POST",
        headers: { "content-type": req.headers()["content-type"] ?? "" },
        body: new Uint8Array(req.postDataBuffer() ?? Buffer.alloc(0)),
      }),
    );
    return route.fulfill({
      status: res.status,
      contentType: "application/json",
      body: Buffer.from(await res.arrayBuffer()),
    });
  }
  if (url.pathname.startsWith("/os-assets/")) return route.fulfill({ contentType: "image/png", body: PIXEL_PNG });
  return route.fulfill({ status: 404, body: "" });
}

/**
 * Abre a tela indicada para a oferta. `props` completa as props de montagem
 * (ex.: { initialSection: "eventos" } ou, para "seo", { page: { id, name } }).
 */
export async function openPanel(
  browser: Browser,
  kind: Kind,
  offerId: string,
  props: Record<string, unknown> = {},
): Promise<Session> {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, locale: "pt-BR" });
  // Falhas aparecem com a mensagem do Playwright antes do limite do teste (20 s).
  page.setDefaultTimeout(8000);
  const s: Session = {
    page,
    offerId,
    calls: [],
    errors: [],
    uploads: 0,
    override: new Map(),
    refreshes: 0,
    seenToasts: new Map(),
  };
  page.on("pageerror", (e) => s.errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) s.errors.push(m.text());
  });
  await page.route("**/*", (route) => handleRoute(route, s));

  const render = async () => {
    const data = await dataFor(kind, offerId);
    if (kind === "seo") return;
    await page.evaluate(([k, p]) => (window as unknown as OSWindow).OS.render(k, p), [
      kind,
      { ...props, data },
    ] as const);
  };

  await page.exposeFunction("__osAction", async (name: string, input: Record<string, unknown>) => {
    const custom = s.override.get(name);
    let result: ActionCall["result"];
    if (custom) {
      s.override.delete(name);
      result = (await custom(input)) as ActionCall["result"];
    } else {
      const mod = [trackingActions, settingsActions].find((m) => name in m) as
        | Record<string, (i: unknown) => Promise<ActionCall["result"]>>
        | undefined;
      if (!mod) throw new Error(`action desconhecida: ${name}`);
      result = await mod[name](input);
    }
    s.calls.push({ name, input, result });
    // Alterou algo: a tela recebe os dados novos antes da action terminar (como no Next).
    if (result.ok && !/^(get|list)/.test(name)) {
      s.refreshes++;
      await render();
    }
    return result;
  });

  await page.goto(`${ORIGIN}/`);
  await page.addScriptTag({ content: await panelBundle() });
  if (kind === "seo") {
    await page.evaluate(([k, p]) => (window as unknown as OSWindow).OS.render(k, p), [
      kind,
      { offerId, ...props },
    ] as const);
  } else await render();
  return s;
}

interface OSWindow {
  OS: { render(kind: string, props: unknown): void };
  __toasts: { type: string; message: string }[];
  __navs?: string[];
}

export function toasts(s: Session) {
  return s.page.evaluate(() => (window as unknown as OSWindow).__toasts);
}

export function lastToast(s: Session) {
  return toasts(s).then((t) => t.at(-1));
}

/**
 * Espera um toast NOVO com o texto (sucesso ou erro): cada chamada consome um
 * toast, então dois salvamentos seguidos com a mesma mensagem esperam dois toasts.
 */
export async function waitToast(s: Session, text: string | RegExp, type?: string, timeout = 8000) {
  const key = `${type ?? "*"}:${String(text)}`;
  const seen = s.seenToasts.get(key) ?? 0;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const list = await toasts(s);
    const count = list.filter(
      (t) => (typeof text === "string" ? t.message === text : text.test(t.message)) && (!type || t.type === type),
    ).length;
    if (count > seen) {
      s.seenToasts.set(key, seen + 1);
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`toast não apareceu: ${text} — recebidos: ${JSON.stringify(await toasts(s))}`);
}

export function callsOf(s: Session, name: string) {
  return s.calls.filter((c) => c.name === name);
}

export async function waitFor(check: () => boolean | Promise<boolean>, timeout = 8000, label = "condição") {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`tempo esgotado esperando ${label}`);
}

/** Escolhe uma opção num Select (Radix) pelo nome acessível do combobox. */
export async function choose(
  page: Page,
  combobox: string | RegExp,
  option: string | RegExp,
  scope?: Page | ReturnType<Page["locator"]>,
) {
  await (scope ?? page).getByRole("combobox", { name: combobox }).click();
  await page.getByRole("option", { name: option }).click();
}
