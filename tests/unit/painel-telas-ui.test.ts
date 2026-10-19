/**
 * Telas do painel num Chromium de verdade, com o CSS do painel (Tailwind
 * compilado) e o menu lateral de verdade (AppShell) em volta:
 *
 * - revisão da clonagem: páginas do funil marcadas e ainda não clonadas
 *   perguntam antes de salvar ("Clonar e salvar junto" / "Salvar sem elas");
 *   uma delas falhando não salva; a tela não rola para o lado no celular;
 * - progresso da clonagem: robô parado, outra clonagem na frente,
 *   "Começando…" e clonagem que não avança;
 * - tela da oferta de 768 a 1440 px: o nome com largura e todas as abas à
 *   vista, sem rolagem para o lado;
 * - "Nova oferta" e "Nova página": o botão de criar fica à vista sem rolar;
 * - modelos de Política de privacidade e Termos de uso avisam da lei
 *   brasileira numa oferta de outra moeda.
 *
 * As server actions e o GET /api/clone/<id> são de mentira, com um roteiro por
 * teste. OS_PRINTS_DIR=<pasta> salva capturas de tela.
 */
import path from "node:path";
import { build, type Plugin } from "esbuild";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "u1" } })) }));

import { prisma } from "@/lib/db";
import type { CloneStatus } from "@/server/services/clone";
import { createOffer } from "@/server/services/offers";
import { listVariants } from "@/server/services/variants";
import type { CloneResult } from "@/worker/clone/types";
import { resetDatabase } from "../setup/per-file";
import { panelCss } from "./tracking-ui-harness";

const ROOT = path.resolve(import.meta.dirname, "../..");
const ORIGIN = "http://painel.test";
const PRINTS = process.env.OS_PRINTS_DIR;

const ENTRY = `
import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "@/components/app/app-shell";
import { CreateOfferDialog } from "@/components/app/create-offer-dialog";
import { CloneProgress } from "@/app/(painel)/clonar/[jobId]/clone-progress";
import { CloneReview } from "@/app/(painel)/clonar/[jobId]/clone-review";
import { OfferExportActions } from "@/components/offers/export/offer-export-actions";
import { OfferHeader } from "@/components/offers/offer-header";
import { OfferTabs } from "@/components/offers/offer-tabs";
import { OfferThumbnail } from "@/components/offers/offer-thumbnail";
import { PageDialog } from "@/components/offers/page-dialog";
import { VariantsDialog } from "@/components/offers/variants/variants-dialog";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";

const SHELL = {
  user: { name: "Teste", email: "teste@exemplo.com" },
  sidebar: { folders: [{ id: "f1", name: "Clientes", count: 1 }], activeCount: 3, trashCount: 0 },
  workerOnline: true,
  theme: "light",
};

/** Como src/app/(painel)/ofertas/[offerId]/page.tsx monta o topo da oferta. */
function Offer({ name }) {
  return createElement("div", { className: "flex flex-col gap-6" },
    createElement(OfferHeader, {
      thumbnail: createElement(OfferThumbnail, { name, thumbnailKey: null }),
      title: name,
      actions: createElement(OfferExportActions, {
        offerId: "o1",
        menu: {
          offer: { id: "o1", name, status: "DRAFT", folderId: null, tagIds: [], liveUrl: null },
          folders: [],
          allTags: [],
          afterTrashHref: "/ofertas",
          trigger: createElement(Button, { variant: "outline", size: "sm" }, "Ações"),
        },
      }),
    }, createElement("div", { className: "mt-2 text-sm text-muted-foreground" }, "Rascunho · 4 páginas")),
    createElement(OfferTabs, null,
      createElement(TabsContent, { value: "paginas", keepMounted: true }, "Páginas"),
      createElement(TabsContent, { value: "configuracoes", keepMounted: true }, "Moeda"),
    ),
  );
}
function NewOffer(props) {
  const [open, setOpen] = useState(true);
  return createElement(CreateOfferDialog, { ...props, open, onOpenChange: setOpen });
}
function NewPage(props) {
  const [open, setOpen] = useState(true);
  return createElement(PageDialog, { ...props, open, onOpenChange: setOpen });
}
function Variants(props) {
  return createElement(VariantsDialog, { ...props, onClose: () => {} });
}
const KINDS = { offer: Offer, review: CloneReview, progress: CloneProgress, new: NewOffer, page: NewPage, variants: Variants };
let root = null;
window.OS = {
  render(kind, props, shell) {
    root = root || createRoot(document.getElementById("root"));
    const screen = createElement(KINDS[kind], props);
    root.render(shell ? createElement(AppShell, SHELL, screen) : screen);
  },
};
`;

const stubs: Plugin = {
  name: "painel-telas-stubs",
  setup(b) {
    b.onResolve({ filter: /^sonner$/ }, () => ({ path: "sonner", namespace: "stub" }));
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "stub" }));
    b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "stub" }));
    b.onResolve({ filter: /^@\/server\/actions\// }, (args) => ({
      path: path.join(ROOT, "src/server/actions", `${args.path.replace("@/server/actions/", "")}.ts`),
      namespace: "action",
    }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
      loader: "js",
      resolveDir: ROOT,
      contents:
        args.path === "sonner"
          ? `const rec = (type) => (m) => (window.__toasts = [...(window.__toasts || []), { type, message: String(m) }]);
             export const toast = Object.assign(rec("default"), { success: rec("success"), error: rec("error"), warning: rec("warning"), info: rec("info"), dismiss: () => {} });`
          : args.path === "navigation"
            ? `import { useSyncExternalStore } from "react";
               const sub = (cb) => { addEventListener("popstate", cb); return () => removeEventListener("popstate", cb); };
               export function useSearchParams() { return new URLSearchParams(useSyncExternalStore(sub, () => location.search)); }
               export function usePathname() { return location.pathname; }
               export function useRouter() {
                 return { push: (h) => (window.__navs = [...(window.__navs || []), h]), replace: () => {}, refresh: () => {}, back: () => {}, prefetch: () => {} };
               }`
            : `import { createElement } from "react";
               export default function Link({ href, children, scroll, prefetch, ...rest }) {
                 return createElement("a", { href, ...rest }, children);
               }`,
    }));
    // Cada server action vira uma chamada ao teste (window.__osAction), com o nome da de verdade.
    b.onLoad({ filter: /.*/, namespace: "action" }, async (args) => {
      const { readFile } = await import("node:fs/promises");
      const source = await readFile(args.path, "utf8");
      const names = [...source.matchAll(/export\s+(?:const|async\s+function|function)\s+(\w+)/g)].map((m) => m[1]);
      return {
        loader: "js",
        contents: names
          .map((n) => `export const ${n} = (input) => window.__osAction(${JSON.stringify(n)}, input);`)
          .join("\n"),
      };
    });
  },
};

let bundle: string;
let browser: Browser;

beforeAll(async () => {
  const out = await build({
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx", sourcefile: "painel-telas-entry.tsx" },
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
}, 180_000);

afterAll(async () => {
  await browser?.close();
});

beforeEach(async () => {
  await resetDatabase();
});

type Kind = "offer" | "review" | "progress" | "new" | "page" | "variants";
type ActionResult = { ok: true; data: unknown } | { ok: false; error: string; field?: string };

interface Session {
  page: Page;
  errors: string[];
  calls: { name: string; input: Record<string, unknown> }[];
  /** Resposta de cada action (padrão: ok, sem dados). */
  replies: Map<string, (input: Record<string, unknown>) => ActionResult>;
  /** Resposta do GET /api/clone/<id> (a tela consulta o progresso). */
  status: (() => unknown) | null;
}

async function open(
  kind: Kind,
  props: Record<string, unknown>,
  opts: {
    viewport?: { width: number; height: number };
    shell?: boolean;
    path?: string;
    /** Respostas preparadas antes de montar a tela (ações pedidas logo ao abrir). */
    setup?: (s: Session) => void;
  } = {},
): Promise<Session> {
  const page = await browser.newPage({ locale: "pt-BR", viewport: opts.viewport ?? { width: 1280, height: 900 } });
  page.setDefaultTimeout(8000);
  const s: Session = { page, errors: [], calls: [], replies: new Map(), status: null };
  page.on("pageerror", (e) => s.errors.push(String(e)));
  const css = await panelCss();
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) return route.abort();
    if (url.pathname.startsWith("/api/clone/")) {
      return s.status
        ? route.fulfill({ contentType: "application/json", body: JSON.stringify(s.status()) })
        : route.fulfill({ status: 404, body: "{}" });
    }
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 404, body: "{}" });
    return route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html lang="pt-BR" class="light"><head><meta charset="utf-8"><style>${css}</style></head>
        <body><div id="root"${opts.shell ? "" : ' style="padding:24px"'}></div></body></html>`,
    });
  });
  await page.exposeFunction("__osAction", async (name: string, input: Record<string, unknown>) => {
    s.calls.push({ name, input });
    const reply = s.replies.get(name);
    return reply ? reply(input) : { ok: true, data: name.startsWith("list") ? [] : {} };
  });
  opts.setup?.(s);
  await page.goto(`${ORIGIN}${opts.path ?? "/ofertas/o1"}`);
  await page.addScriptTag({ content: bundle });
  await page.evaluate(
    ([k, p, shell]) =>
      (window as unknown as { OS: { render(k: string, p: unknown, shell: boolean): void } }).OS.render(k, p, shell),
    [kind, props, Boolean(opts.shell)] as const,
  );
  return s;
}

const toasts = (page: Page) =>
  page.evaluate(() => (window as unknown as { __toasts?: { type: string; message: string }[] }).__toasts ?? []);
const navs = (page: Page) => page.evaluate(() => (window as unknown as { __navs?: string[] }).__navs ?? []);
const callsOf = (s: Session, name: string) => s.calls.filter((c) => c.name === name).map((c) => c.input);

async function waitFor(check: () => boolean | Promise<boolean>, label: string, timeout = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`tempo esgotado esperando ${label}`);
}

/** Rolagem lateral da página inteira (px a mais que a janela). */
const pageOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// ─── Revisão da clonagem ─────────────────────────────────────────────────────

const OBRIGADO = "https://loja.exemplo.com/obrigado";
const UPSELL = "https://loja.exemplo.com/upsell";
const MANUAL = "https://loja.exemplo.com/downsell-especial";

const CLONE_RESULT: CloneResult = {
  title: "Loja",
  finalUrl: "https://loja.exemplo.com/",
  responsive: true,
  devices: {
    desktop: {
      outputs: {
        EDITABLE: { htmlKey: "clones/x/d-e.html" },
        PRESERVE_JS: { htmlKey: "clones/x/d-p.html", assetMap: {} },
      },
    },
  },
  removed: [],
  checkouts: [],
  funnel: [
    { url: OBRIGADO, label: "Acesse as instruções de acesso", kind: "THANK_YOU", reason: "Link com “obrigado”." },
    { url: UPSELL, label: "Kit Festas Lucrativas", kind: "UPSELL", reason: "Link com “upsell”." },
  ],
  videos: [],
  delay: null,
  warnings: [],
  suggestedMode: "EDITABLE",
  assets: [],
  stats: { assets: 1, bytes: 1, failed: 0, blockedRequests: 0, durationMs: 1 },
};

const reviewProps = (extra: Record<string, unknown> = {}) => ({
  jobId: "job1",
  label: "https://loja.exemplo.com/",
  result: CLONE_RESULT,
  defaultName: "Loja",
  previews: {},
  folders: [],
  initialChildren: [],
  funnelKeys: { [OBRIGADO]: "loja.exemplo.com/obrigado", [UPSELL]: "loja.exemplo.com/upsell" },
  capturedDevices: ["desktop"],
  ...extra,
});

type Child = CloneStatus["children"][number];

/**
 * Servidor de mentira da clonagem: o startFunnelClonesAction cria as páginas
 * pedidas, que ficam "rodando" por `polls` consultas e depois terminam no
 * estado escolhido por endereço (`outcome`; padrão: prontas para revisão).
 */
function fakeFunnel(s: Session, outcome: Record<string, "REVIEW" | "FAILED"> = {}, polls = 1) {
  const children: (Child & { left: number })[] = [];
  s.replies.set("startFunnelClonesAction", (input) => {
    const created: string[] = [];
    for (const url of input.urls as string[]) {
      const id = `c${children.length + 1}`;
      children.push({
        id,
        status: "QUEUED",
        progress: 0,
        step: null,
        sourceUrl: url,
        errorMessage: null,
        title: null,
        devices: ["desktop"],
        matchKey: url.replace(/^https?:\/\//, ""),
        from: "main",
        depth: 1,
        order: 0,
        via: "manual",
        linkLabel: "",
        product: false,
        kind: null,
        name: "",
        finalKey: null,
        suggestedMode: null,
        thumbnailKey: null,
        duplicate: false,
        checkouts: 0,
        checkoutPlatform: null,
        exploreStop: null,
        left: polls,
      });
      created.push(id);
    }
    return { ok: true, data: { created } };
  });
  s.replies.set("saveCloneAction", () => ({ ok: true, data: { id: "oferta-salva" } }));
  s.status = () => {
    for (const c of children) {
      if (c.left > 0) {
        c.left--;
        c.status = "RUNNING";
        c.progress = 50;
      } else {
        c.status = outcome[c.sourceUrl ?? ""] ?? "REVIEW";
        c.progress = 100;
        c.title = c.sourceUrl?.split("/").pop() ?? null;
        if (c.status === "FAILED") c.errorMessage = "A página não respondeu (erro 500).";
      }
    }
    return {
      id: "job1",
      status: "REVIEW",
      progress: 100,
      step: null,
      errorMessage: null,
      offerId: null,
      workerOnline: null,
      otherRunning: false,
      stalled: false,
      logs: [],
      children: children.map(({ left, ...c }) => c),
    } satisfies CloneStatus;
  };
  return children;
}

async function markFunnel(page: Page) {
  await page.getByRole("checkbox", { name: /^Obrigado · Acesse as instruções/ }).click();
  await page.getByRole("checkbox", { name: /^Upsell · Kit Festas Lucrativas/ }).click();
}

describe("Revisão da clonagem: páginas do funil marcadas e ainda não clonadas", () => {
  it("“Salvar oferta” pergunta antes; “Clonar e salvar junto” clona as duas e salva a oferta com 3 páginas", async () => {
    const s = await open("review", reviewProps(), { shell: true, path: "/clonar/job1" });
    fakeFunnel(s);
    const { page } = s;
    await markFunnel(page);
    await page.getByRole("button", { name: "Salvar oferta" }).click();
    const ask = page.getByRole("alertdialog", { name: "2 páginas do funil marcadas ainda não foram clonadas" });
    await ask.waitFor();
    await ask.getByText("Se salvar agora, ficam de fora.", { exact: false }).waitFor();
    expect(await ask.getByRole("listitem").allTextContents()).toEqual([
      "Obrigado · Acesse as instruções de acesso",
      "Upsell · Kit Festas Lucrativas",
    ]);
    if (PRINTS) {
      await page.waitForTimeout(300); // fim da animação de abrir
      await page.screenshot({ path: path.join(PRINTS, "revisao-funil-pergunta.png") });
    }
    // Nada foi salvo nem clonado só por abrir a pergunta.
    expect(s.calls).toEqual([]);

    await ask.getByRole("button", { name: "Clonar e salvar junto" }).click();
    await ask.waitFor({ state: "hidden" });
    expect(callsOf(s, "startFunnelClonesAction")).toEqual([{ parentId: "job1", urls: [OBRIGADO, UPSELL] }]);
    // Enquanto as páginas clonam, o botão espera e explica que salva sozinho.
    await page.getByRole("button", { name: "Aguardando páginas do funil…" }).waitFor();
    await page.getByText("A oferta é salva sozinha quando elas terminarem.", { exact: false }).waitFor();
    expect(callsOf(s, "saveCloneAction")).toEqual([]);

    await waitFor(() => callsOf(s, "saveCloneAction").length > 0, "o salvamento automático");
    expect(callsOf(s, "saveCloneAction")).toEqual([
      {
        jobId: "job1",
        name: "Loja",
        folderId: null,
        mode: "EDITABLE",
        currency: "BRL",
        keepRemoved: [],
        childJobIds: ["c1", "c2"],
        // Modo de cada página (o mapa do funil deixa escolher; aqui, o recomendado).
        modes: { job1: "EDITABLE", c1: "EDITABLE", c2: "EDITABLE" },
      },
    ]);
    await waitFor(async () => (await navs(page)).length > 0, "a ida para a oferta");
    expect(await navs(page)).toEqual(["/ofertas/oferta-salva"]);
    // Uma vez só.
    await page.waitForTimeout(2500);
    expect(callsOf(s, "saveCloneAction")).toHaveLength(1);
    expect(s.errors).toEqual([]);
    await page.close();
  });

  it("“Salvar sem elas” salva só a página principal, sem clonar nada", async () => {
    const s = await open("review", reviewProps());
    fakeFunnel(s);
    const { page } = s;
    await markFunnel(page);
    await page.getByRole("button", { name: "Salvar oferta" }).click();
    const ask = page.getByRole("alertdialog");
    await ask.getByRole("button", { name: "Salvar sem elas" }).click();
    await waitFor(() => callsOf(s, "saveCloneAction").length > 0, "o salvamento");
    expect(callsOf(s, "saveCloneAction")[0]).toMatchObject({ childJobIds: [] });
    expect(callsOf(s, "startFunnelClonesAction")).toEqual([]);
    expect(s.errors).toEqual([]);
    await page.close();
  });

  it("“Voltar” não salva; link colado também conta (uma página: textos no singular)", async () => {
    const s = await open("review", reviewProps());
    fakeFunnel(s);
    const { page } = s;
    await page.getByLabel("Link de outra página do funil").fill(MANUAL);
    await page.getByRole("button", { name: "Salvar oferta" }).click();
    const ask = page.getByRole("alertdialog", { name: "Uma página do funil marcada ainda não foi clonada" });
    await ask.waitFor();
    await ask.getByText("Ela só entra na oferta depois de clonada. Se salvar agora, fica de fora.").waitFor();
    expect(await ask.getByRole("listitem").allTextContents()).toEqual([MANUAL]);
    await ask.getByRole("button", { name: "Salvar sem ela" }).waitFor();
    await ask.getByRole("button", { name: "Voltar" }).click();
    await ask.waitFor({ state: "hidden" });
    await page.waitForTimeout(300);
    expect(s.calls).toEqual([]);
    // O link continua no campo.
    expect(await page.getByLabel("Link de outra página do funil").inputValue()).toBe(MANUAL);
    expect(s.errors).toEqual([]);
    await page.close();
  });

  it("páginas já clonadas e prontas não perguntam nada", async () => {
    const s = await open("review", reviewProps());
    const children = fakeFunnel(s, {}, 0);
    const { page } = s;
    await markFunnel(page);
    await page.getByRole("button", { name: "Clonar páginas selecionadas" }).click();
    await waitFor(() => children.length === 2, "as páginas na fila");
    const save = page.getByRole("button", { name: "Salvar oferta" });
    await page.getByText("3 páginas no funil", { exact: false }).waitFor({ timeout: 10_000 });
    await save.click();
    await waitFor(() => callsOf(s, "saveCloneAction").length > 0, "o salvamento");
    expect(await page.getByRole("alertdialog").count()).toBe(0);
    expect(callsOf(s, "saveCloneAction")[0]).toMatchObject({ childJobIds: ["c1", "c2"] });
    await page.close();
  });

  it("uma página do funil falha: avisa em português e não salva; depois, “Salvar oferta” salva sem ela", async () => {
    const s = await open("review", reviewProps());
    fakeFunnel(s, { [UPSELL]: "FAILED" });
    const { page } = s;
    await markFunnel(page);
    await page.getByRole("button", { name: "Salvar oferta" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Clonar e salvar junto" }).click();
    await waitFor(async () => (await toasts(page)).some((t) => t.type === "error"), "o aviso de que a página falhou");
    expect((await toasts(page)).filter((t) => t.type === "error")).toEqual([
      {
        type: "error",
        message:
          "Uma página do funil não pôde ser clonada, e a oferta ainda não foi salva. Veja o erro em “Páginas do funil”: tente de novo ou clique em “Salvar oferta” para salvar sem ela.",
      },
    ]);
    await page.getByText("A página não respondeu (erro 500).").waitFor();
    expect(callsOf(s, "saveCloneAction")).toEqual([]);
    if (PRINTS) await page.screenshot({ path: path.join(PRINTS, "revisao-funil-falha.png") });

    // As marcações foram para a fila: salvar agora não pergunta de novo e leva a que ficou pronta.
    await page.getByRole("button", { name: "Salvar oferta" }).click();
    await waitFor(() => callsOf(s, "saveCloneAction").length > 0, "o salvamento");
    expect(await page.getByRole("alertdialog").count()).toBe(0);
    expect(callsOf(s, "saveCloneAction")[0]).toMatchObject({ childJobIds: ["c1"] });
    expect(s.errors).toEqual([]);
    await page.close();
  });

  it("cancelar uma página enquanto espera: salva sem ela (“Não quer esperar?”)", async () => {
    const s = await open("review", reviewProps());
    const children = fakeFunnel(s, {}, 1000);
    s.replies.set("cancelCloneAction", (input) => {
      const c = children.find((x) => x.id === input.id);
      if (c) {
        c.left = 0;
        c.status = "CANCELED";
      }
      return { ok: true, data: undefined };
    });
    // Cancelada fica cancelada (o servidor de mentira não a termina).
    const status = s.status as () => CloneStatus;
    s.status = () => {
      for (const c of children) if (c.status === "CANCELED") c.left = -1;
      const view = status();
      for (const c of view.children) {
        const real = children.find((x) => x.id === c.id);
        if (real?.left === -1) Object.assign(c, { status: "CANCELED", progress: 0 });
      }
      return view;
    };
    const { page } = s;
    await page.getByRole("checkbox", { name: /^Upsell · Kit Festas Lucrativas/ }).click();
    await page.getByRole("button", { name: "Salvar oferta" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Clonar e salvar junto" }).click();
    await page.getByRole("button", { name: /^Cancelar / }).click();
    await waitFor(() => callsOf(s, "saveCloneAction").length > 0, "o salvamento");
    expect(callsOf(s, "saveCloneAction")[0]).toMatchObject({ childJobIds: [] });
    expect((await toasts(page)).filter((t) => t.type === "error")).toEqual([]);
    expect(s.errors).toEqual([]);
    await page.close();
  });

  it("no celular (360, 390 e 430 px), a revisão não rola para o lado (computador, celular e original)", async () => {
    // Revisão completa: prévias dos dois aparelhos, print, vídeo com delay, rastreadores, checkouts e avisos.
    const full: CloneResult = {
      ...CLONE_RESULT,
      devices: {
        desktop: { ...CLONE_RESULT.devices.desktop, screenshotKey: "clones/x/print-d.png" } as never,
        mobile: { ...CLONE_RESULT.devices.desktop, screenshotKey: "clones/x/print-m.png" } as never,
      },
      removed: [
        {
          vendor: "Meta Pixel",
          category: "PIXEL",
          pixelId: "123456789012345",
          snippet: "<script>fbq('init','123456789012345')</script>",
          location: "head",
          kind: "script-inline",
        } as never,
      ],
      checkouts: [
        {
          url: "https://pay.hotmart.com/A12345678B?off=abc123&checkoutMode=10&src=campanha-muito-longa-de-teste",
          platform: "Hotmart",
          label: "Quero garantir minha vaga com desconto",
          source: "HREF",
          confidence: 100,
          occurrences: 3,
        },
      ],
      videos: [{ provider: "VTURB", videoId: "6650f0c1a2b3c4d5e6f7a8b9", thirdParty: true }],
      delay: { seconds: 412, elements: 4 },
      warnings: [
        {
          code: "PRESERVE_JS_ORIGIN",
          message: "No modo “Com scripts”, os scripts da página ainda buscam 1 endereço(s) no site original.",
          url: "https://loja.exemplo.com/wp-admin/admin-ajax.php?action=carregar_dados_do_formulario",
        },
      ],
      suggestedMode: "PRESERVE_JS",
    };
    for (const width of [360, 390, 430]) {
      const s = await open(
        "review",
        reviewProps({
          result: full,
          capturedDevices: ["desktop", "mobile"],
          frozenTimer: true,
          previews: {
            desktop: { EDITABLE: `${ORIGIN}/previa/d-e`, PRESERVE_JS: `${ORIGIN}/previa/d-p` },
            mobile: { EDITABLE: `${ORIGIN}/previa/m-e`, PRESERVE_JS: `${ORIGIN}/previa/m-p` },
          },
        }),
        { viewport: { width, height: 800 }, shell: true, path: "/clonar/job1" },
      );
      const { page } = s;
      await page.getByRole("heading", { name: "Revisar cópia" }).waitFor();
      expect(await pageOverflow(page), `${width} computador`).toBe(0);
      await page.getByRole("radio", { name: "Celular" }).click();
      await page.locator('iframe[title="Prévia da cópia (celular)"]').waitFor();
      expect(await pageOverflow(page), `${width} celular`).toBe(0);
      const frame = await page.locator('iframe[title="Prévia da cópia (celular)"]').boundingBox();
      expect((frame?.x ?? 0) + (frame?.width ?? 0), `${width} prévia do celular`).toBeLessThanOrEqual(width);
      await page.getByRole("radio", { name: "Original" }).click();
      expect(await pageOverflow(page), `${width} original`).toBe(0);
      if (PRINTS) await page.screenshot({ path: path.join(PRINTS, `revisao-celular-${width}.png`), fullPage: true });
      expect(s.errors).toEqual([]);
      await page.close();
    }
  });
});

// ─── Progresso da clonagem ───────────────────────────────────────────────────

const progressStatus = (over: Partial<CloneStatus>): CloneStatus => ({
  id: "job1",
  status: "QUEUED",
  progress: 0,
  step: null,
  errorMessage: null,
  offerId: null,
  workerOnline: true,
  otherRunning: false,
  stalled: false,
  logs: [],
  children: [],
  ...over,
});

describe("Progresso da clonagem: o que a fila está esperando", () => {
  const cases: { name: string; status: Partial<CloneStatus>; title: string; has: string[]; not: string[] }[] = [
    {
      name: "robô parado",
      status: { workerOnline: false, otherRunning: true },
      title: "Na fila…",
      has: [
        "O robô de tarefas está parado",
        "A clonagem começa quando ele voltar. Feche o Offer Studio e abra de novo pelo atalho.",
      ],
      not: ["Outra clonagem está em andamento"],
    },
    {
      name: "outra clonagem rodando",
      status: { otherRunning: true },
      title: "Na fila…",
      has: ["Outra clonagem está em andamento. Esta começa em seguida."],
      not: ["O robô de tarefas está parado"],
    },
    {
      name: "nenhuma rodando e robô ligado",
      status: {},
      title: "Começando…",
      has: ["Pode levar de 30 segundos a alguns minutos"],
      not: ["Outra clonagem está em andamento", "O robô de tarefas está parado"],
    },
    {
      name: "rodando sem avançar",
      status: { status: "RUNNING", progress: 40, step: "Baixando arquivos", stalled: true },
      title: "Baixando arquivos",
      has: ["A clonagem não avança há mais de 3 minutos", "cancele e tente de novo"],
      not: ["O robô de tarefas está parado"],
    },
    {
      name: "rodando com o robô parado",
      status: { status: "RUNNING", progress: 40, step: "Baixando arquivos", workerOnline: false, stalled: true },
      title: "Baixando arquivos",
      has: ["O robô de tarefas está parado", "A clonagem parou no meio."],
      not: ["A clonagem não avança há mais de 3 minutos"],
    },
  ];
  for (const c of cases) {
    it(c.name, async () => {
      const status = progressStatus(c.status);
      const s = await open(
        "progress",
        { jobId: "job1", label: "https://loja.exemplo.com/", initial: status },
        { setup: (x) => (x.status = () => status) },
      );
      const { page } = s;
      await page.getByText(c.title, { exact: true }).waitFor();
      for (const text of c.has) await page.getByText(text, { exact: false }).waitFor();
      // Depois de consultar o servidor de novo, continua igual.
      await page.waitForTimeout(1300);
      for (const text of c.has) expect(await page.getByText(text, { exact: false }).count(), text).toBeGreaterThan(0);
      for (const text of c.not) expect(await page.getByText(text, { exact: false }).count(), text).toBe(0);
      await page.getByRole("button", { name: "Cancelar" }).waitFor();
      if (PRINTS) await page.screenshot({ path: path.join(PRINTS, `progresso-${c.name.replace(/\s+/g, "-")}.png`) });
      expect(s.errors).toEqual([]);
      await page.close();
    });
  }
});

// ─── Tela da oferta ──────────────────────────────────────────────────────────

const LONG_NAME = "Emagrecimento Definitivo 30 Dias — VSL principal com quiz e upsell";

describe("Tela da oferta em janelas de 768 a 1440 px", () => {
  it("o nome tem largura (não quebra letra a letra) e todas as abas ficam à vista, sem rolar para o lado", async () => {
    for (const width of [768, 800, 900, 1024, 1280, 1440]) {
      const s = await open("offer", { name: LONG_NAME }, { viewport: { width, height: 900 }, shell: true });
      const { page } = s;
      await page.getByRole("heading", { level: 1 }).waitFor();
      const m = await page.evaluate(() => {
        const h1 = document.querySelector("h1") as HTMLElement;
        const tabs = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="tabs-trigger"]'));
        const list = document.querySelector('[data-slot="tabs-list"]') as HTMLElement;
        return {
          h1: Math.round(h1.getBoundingClientRect().width),
          tabsOut: tabs
            .filter((t) => {
              const r = t.getBoundingClientRect();
              return r.left < 0 || r.right > window.innerWidth || t.scrollWidth > t.clientWidth + 1;
            })
            .map((t) => t.textContent),
          listScroll: list.scrollWidth - list.clientWidth,
          page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      expect(m.h1, `${width}: largura do nome`).toBeGreaterThanOrEqual(200);
      expect({ tabsOut: m.tabsOut, listScroll: m.listScroll, page: m.page }, String(width)).toEqual({
        tabsOut: [],
        listScroll: 0,
        page: 0,
      });
      if (PRINTS) await page.screenshot({ path: path.join(PRINTS, `oferta-${width}.png`) });
      expect(s.errors).toEqual([]);
      await page.close();
    }
  });

  it("telas largas: uma linha; no lg justo a última aba desce em vez de rolar; abaixo do lg, grade de duas colunas", async () => {
    // 900: grade de 2 colunas (6 abas = 3 linhas cheias). 1024: o menu lateral ocupa
    // 256 px e as 6 abas passam pouco da linha, então a última desce (sem rolagem lateral —
    // o teste de overflow acima confere). 1440: sobra espaço, uma linha só.
    for (const [width, rows] of [
      [900, 3],
      [1024, 2],
      [1440, 1],
    ] as const) {
      const s = await open("offer", { name: LONG_NAME }, { viewport: { width, height: 900 }, shell: true });
      const tops = await s.page
        .locator('[data-slot="tabs-trigger"]')
        .evaluateAll((els) => [...new Set(els.map((el) => Math.round(el.getBoundingClientRect().top)))]);
      expect(tops.length, String(width)).toBe(rows);
      await s.page.close();
    }
  });

  it("no celular (390 px): o nome e as abas como antes (botão embaixo do nome, grade de duas colunas)", async () => {
    const s = await open("offer", { name: LONG_NAME }, { viewport: { width: 390, height: 844 }, shell: true });
    const { page } = s;
    const h1 = await page.getByRole("heading", { level: 1 }).boundingBox();
    const actions = await page.getByRole("button", { name: "Ações" }).boundingBox();
    expect(actions && h1 && actions.y).toBeGreaterThan((h1?.y ?? 0) + (h1?.height ?? 0) - 1);
    const tops = await page
      .locator('[data-slot="tabs-trigger"]')
      .evaluateAll((els) => [...new Set(els.map((el) => Math.round(el.getBoundingClientRect().top)))]);
    expect(tops).toHaveLength(3);
    expect(await pageOverflow(page)).toBe(0);
    await page.close();
  });
});

// ─── "Nova oferta" e "Nova página" ───────────────────────────────────────────

/** O botão está inteiro dentro da janela (sem rolar nada)? */
async function inView(page: Page, name: string) {
  const box = await page.getByRole("button", { name, exact: true }).boundingBox();
  const vp = page.viewportSize();
  return Boolean(box && vp && box.y >= 0 && box.y + box.height <= vp.height && box.x + box.width <= vp.width);
}

describe("“Nova oferta” e “Nova página”: o botão de criar fica à vista", () => {
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    it(`${viewport.width}×${viewport.height}: “Criar oferta” e “Criar página” sem rolar; o miolo rola`, async () => {
      const a = await open("new", { folders: [] }, { viewport });
      const offerDialog = a.page.getByRole("dialog", { name: "Nova oferta" });
      await offerDialog.waitFor();
      expect(await inView(a.page, "Criar oferta")).toBe(true);
      // A galeria rola dentro do diálogo; o rodapé continua no lugar.
      const body = offerDialog.locator("form > div").nth(1);
      expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(viewport.height < 1000);
      await body.evaluate((el) => el.scrollTo(0, el.scrollHeight));
      expect(await inView(a.page, "Criar oferta")).toBe(true);
      expect(await offerDialog.evaluate((el) => el.scrollHeight - el.clientHeight)).toBe(0);
      if (PRINTS) {
        await a.page.waitForTimeout(300); // fim da animação de abrir
        await a.page.screenshot({ path: path.join(PRINTS, `nova-oferta-${viewport.width}.png`) });
      }
      // Teclado: do nome, o Tab chega ao "Criar oferta".
      await offerDialog.getByLabel("Nome da oferta").focus();
      let reached = false;
      for (let i = 0; i < 12 && !reached; i++) {
        await a.page.keyboard.press("Tab");
        reached = await a.page.evaluate(() => document.activeElement?.textContent?.trim() === "Criar oferta");
      }
      expect(reached).toBe(true);
      expect(a.errors).toEqual([]);
      await a.page.close();

      const b = await open("page", { offerId: "o1", existingSlugs: [] }, { viewport });
      await b.page.getByRole("dialog", { name: "Nova página" }).waitFor();
      expect(await inView(b.page, "Criar página")).toBe(true);
      // Escolher um modelo legal (o aviso aparece) não empurra o botão para fora.
      await b.page.getByRole("radio", { name: "Termos de uso" }).click();
      expect(await inView(b.page, "Criar página")).toBe(true);
      if (PRINTS) await b.page.screenshot({ path: path.join(PRINTS, `nova-pagina-${viewport.width}.png`) });
      expect(b.errors).toEqual([]);
      await b.page.close();

      // Criar sem nome (em branco): o campo com o erro aparece (o botão está à vista, os campos podem não estar).
      const c = await open("page", { offerId: "o1", existingSlugs: [] }, { viewport });
      const pageDialog = c.page.getByRole("dialog", { name: "Nova página" });
      await pageDialog
        .locator("form > div")
        .nth(1)
        .evaluate((el) => el.scrollTo(0, 0));
      await c.page.getByRole("button", { name: "Criar página", exact: true }).click();
      await pageDialog.getByText("Dê um nome para a página.").waitFor();
      await c.page.waitForFunction(() => document.activeElement?.id === "page-name");
      const field = await pageDialog.getByLabel("Nome", { exact: true }).boundingBox();
      const area = await pageDialog.locator("form > div").nth(1).boundingBox();
      expect(field && area && field.y >= area.y && field.y + field.height <= area.y + area.height).toBe(true);
      expect(callsOf(c, "createPageAction")).toEqual([]);
      await c.page.close();
    });
  }

  it("“Editar página” continua pequeno, sem rolagem", async () => {
    const s = await open("page", { offerId: "o1", page: { id: "p1", name: "Upsell", slug: "upsell", type: "UPSELL" } });
    const dialog = s.page.getByRole("dialog", { name: "Editar página" });
    await dialog.waitFor();
    const box = await dialog.boundingBox();
    expect(box?.width).toBeLessThanOrEqual(448);
    expect(await inView(s.page, "Salvar")).toBe(true);
    await s.page.close();
  });
});

// ─── Páginas legais × moeda ──────────────────────────────────────────────────

const LEGAL = "Texto pensado para a lei brasileira (LGPD).";

describe("Política de privacidade e Termos de uso numa oferta de outra moeda", () => {
  it("Nova página: peso mexicano + Política de privacidade avisa (com a moeda); real, não; outro modelo, não", async () => {
    const s = await open("page", { offerId: "o1", existingSlugs: [], offerCurrency: "MXN" });
    const dialog = s.page.getByRole("dialog", { name: "Nova página" });
    await dialog.getByRole("radio", { name: "Política de privacidade" }).click();
    await dialog
      .getByText(
        `Esta oferta roda em peso mexicano. ${LEGAL} Para vender no México, peça a um advogado a versão local.`,
      )
      .waitFor();
    await dialog.getByRole("radio", { name: "Termos de uso" }).click();
    await dialog.getByText(LEGAL, { exact: false }).waitFor();
    await dialog.getByRole("radio", { name: "Obrigado" }).click();
    expect(await dialog.getByText(LEGAL, { exact: false }).count()).toBe(0);
    expect(s.errors).toEqual([]);
    await s.page.close();

    for (const [currency, where] of [
      ["EUR", "na Europa"],
      ["USD", "fora do Brasil"],
    ] as const) {
      const o = await open("page", { offerId: "o1", existingSlugs: [], offerCurrency: currency });
      await o.page.getByRole("radio", { name: "Política de privacidade" }).click();
      await o.page.getByText(`Para vender ${where}, peça a um advogado a versão local.`, { exact: false }).waitFor();
      await o.page.close();
    }

    const real = await open("page", { offerId: "o1", existingSlugs: [], offerCurrency: "BRL" });
    await real.page.getByRole("radio", { name: "Política de privacidade" }).click();
    await real.page.getByRole("radio", { name: "Política de privacidade", checked: true }).waitFor();
    expect(await real.page.getByText(LEGAL, { exact: false }).count()).toBe(0);
    await real.page.close();
  });

  it("versão A/B a partir do modelo: euro avisa; real, não", async () => {
    const offer = await createOffer({ name: "Portugal", currency: "EUR" });
    const home = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id } });
    const view = await listVariants(home.id);
    for (const [currency, count] of [
      ["EUR", 1],
      ["BRL", 0],
    ] as const) {
      const s = await open(
        "variants",
        { page: { id: home.id, name: home.name }, offerCurrency: currency },
        // A lista de versões é pedida logo ao abrir.
        { setup: (x) => x.replies.set("listVariantsAction", () => ({ ok: true, data: view })) },
      );
      const dialog = s.page.getByRole("dialog");
      await dialog.getByRole("button", { name: "Modelo ou outra versão…" }).click();
      await dialog.getByRole("radio", { name: /Modelo pronto ou em branco/ }).click();
      await dialog.getByRole("radio", { name: "Termos de uso" }).click();
      await dialog.getByRole("radio", { name: "Termos de uso", checked: true }).waitFor();
      expect(await dialog.getByText(`Esta oferta roda em euro. ${LEGAL}`, { exact: false }).count(), currency).toBe(
        count,
      );
      if (PRINTS && count) await s.page.screenshot({ path: path.join(PRINTS, "versao-ab-termos-euro.png") });
      expect(s.errors).toEqual([]);
      await s.page.close();
    }
  });
});
