/**
 * Captura de uma página com o Chromium (Playwright), para um dispositivo.
 *
 * Passos: abre a página → bloqueia rastreadores e chats já na rede → simula
 * interação (libera scripts "atrasados" do WP Rocket/LiteSpeed) → rola até o fim
 * para disparar o lazy load → espera a rede ficar quieta → serializa o DOM
 * (inclui shadow DOM aberto e CSS gerado por JavaScript) → print da página.
 *
 * Todo o tráfego do navegador passa por um proxy local (startGuardedProxy) que
 * recusa endereços internos em cada conexão — inclusive redirecionamentos,
 * navegações feitas por JavaScript, DNS rebinding, IPv6 e WebSockets.
 *
 * Nada aqui contorna proteções anti-robô: se a página exibir um desafio, isso é
 * detectado e informado.
 */
import { isUtf8 } from "node:buffer";
import {
  type Browser,
  type BrowserContext,
  devices,
  type Page,
  type Request,
  type Response,
  type Route,
} from "playwright";
import { decodeText } from "./charset";
import { type GuardedProxy, PROXY_ERROR_HEADER, startGuardedProxy } from "./fetcher";
import { detectProtection } from "./protection";
import { classifyRequest } from "./trackers";
import type { Capture, CapturedResponse, CloneWarning, Device, TrackerMatch } from "./types";
import { safeDecode } from "./urls";

export class CloneCanceledError extends Error {
  constructor() {
    super("Clonagem cancelada.");
    this.name = "CloneCanceledError";
  }
}

export type LogFn = (level: "INFO" | "SUCCESS" | "WARN" | "ERROR", message: string, url?: string) => void;

/** Arquivos servidos localmente em vez da rede (importação de ZIP/HTML). */
export interface VirtualSite {
  /** Origem servida localmente, ex.: "http://importado.offerstudio". */
  origin: string;
  /** `pathname` já decodificado (%XX → caractere), ex.: "/promoção/index.html". */
  get(pathname: string): { body: Buffer; contentType: string } | null;
  /** true: o que não existir localmente vem da rede (HTML colado com URL de origem). */
  fallthrough?: boolean;
}

export interface CaptureOptions {
  browser: Browser;
  device: Device;
  url: string;
  log: LogFn;
  hostMap?: Record<string, string>;
  allowPrivate?: boolean;
  signal?: AbortSignal;
  virtualSite?: VirtualSite;
  /** Limite de tempo para rolar a página (ms). */
  maxScrollMs?: number;
}

/** Captura + avisos para a tela de revisão (página que não terminou de carregar, print que falhou). */
export type CaptureResult = Capture & { warnings: CloneWarning[] };

const MAX_BODY_BYTES = 25 * 1024 * 1024;
const SCREENSHOT_MAX_HEIGHT = 12_000;

export const DESKTOP_CONTEXT = {
  ...devices["Desktop Chrome"],
  viewport: { width: 1440, height: 900 },
};
/** Celular Android (maioria do tráfego no Brasil; coerente com o motor Chromium). */
export const MOBILE_CONTEXT = devices["Pixel 7"];

function stripHash(url: string) {
  const i = url.indexOf("#");
  return i >= 0 ? url.slice(0, i) : url;
}

function throwIfCanceled(signal?: AbortSignal) {
  if (signal?.aborted) throw new CloneCanceledError();
}

// ─── Charset dos corpos capturados ───────────────────────────────────────────

const TEXT_MIME_RE =
  /^(?:text\/[\w.+-]+|application\/(?:[\w.+-]+\+)?(?:json|xml)|application\/(?:x-)?(?:javascript|ecmascript)|image\/svg\+xml)$/i;
/** Tipo de conteúdo presumido quando o servidor não manda Content-Type. */
const MIME_BY_RESOURCE: Record<string, string> = {
  document: "text/html",
  stylesheet: "text/css",
  script: "text/javascript",
};

/**
 * Content-Type para guardar um corpo capturado pelo Chromium. Recursos de
 * texto chegam já decodificados pelo navegador (com o charset do cabeçalho,
 * do <meta> ou do @charset) e o Playwright os devolve em UTF-8. Manter o
 * charset original (ex.: iso-8859-1) faria o texto ser decodificado duas
 * vezes ("PromoÃ§Ã£o"). Corpo que não é UTF-8 válido não foi convertido e
 * fica com o tipo original.
 */
export function capturedContentType(contentType: string, body: Buffer, resourceType = ""): string {
  const parts = contentType.split(";");
  const mime = parts[0].trim().toLowerCase() || MIME_BY_RESOURCE[resourceType] || "";
  if (!mime || !TEXT_MIME_RE.test(mime) || !isUtf8(body)) return contentType;
  const params = parts
    .slice(1)
    .map((p) => p.trim())
    .filter((p) => p && !/^charset\s*=/i.test(p));
  return [mime, ...params, "charset=utf-8"].join("; ");
}

// ─── Doctype ─────────────────────────────────────────────────────────────────

// Funções puras em doctype.ts (também usadas pelo painel, sem carregar o Playwright).
export { doctypeOf, restoreDoctype } from "@/lib/doctype";

// ─── Scripts executados dentro da página ─────────────────────────────────────

/** Script executado dentro da página para serializar o DOM final. */
function serializeDomInPage(): string {
  // Animações de rolagem do AOS: com o padrão `once: false`, o AOS tira a
  // classe "aos-animate" de tudo que ficou abaixo da dobra quando a página
  // volta ao topo. Sem o JavaScript (modo Editável) esses blocos ficariam
  // invisíveis para sempre; o estado final do AOS é "aos-init aos-animate".
  for (const el of Array.from(document.querySelectorAll("[data-aos]"))) el.classList.add("aos-init", "aos-animate");

  // CSS gerado por JavaScript (styled-components, emotion…): as regras existem
  // no CSSOM mas não no texto do <style>. Copiamos para o texto.
  for (const sheet of Array.from(document.styleSheets)) {
    const owner = sheet.ownerNode as HTMLElement | null;
    if (!owner || owner.tagName !== "STYLE") continue;
    try {
      const rules = Array.from(sheet.cssRules).map((r) => r.cssText);
      if (rules.length && !(owner.textContent ?? "").trim()) owner.textContent = rules.join("\n");
    } catch {
      // folha de outra origem: ignora
    }
  }
  const adopted = (document as Document & { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets ?? [];
  if (adopted.length) {
    const style = document.createElement("style");
    style.setAttribute("data-os-adopted", "");
    style.textContent = adopted
      .flatMap((s) => {
        try {
          return Array.from(s.cssRules).map((r) => r.cssText);
        } catch {
          return [];
        }
      })
      .join("\n");
    document.head.appendChild(style);
  }

  // Congela valores de formulários.
  for (const el of Array.from(document.querySelectorAll("input"))) {
    if (el.type === "checkbox" || el.type === "radio") {
      if (el.checked) el.setAttribute("checked", "");
      else el.removeAttribute("checked");
    } else if (el.type !== "password" && el.type !== "file" && el.value) {
      el.setAttribute("value", el.value);
    }
  }
  for (const el of Array.from(document.querySelectorAll("textarea"))) el.textContent = el.value;
  for (const el of Array.from(document.querySelectorAll("select"))) {
    for (const opt of Array.from(el.options)) {
      if (opt.selected) opt.setAttribute("selected", "");
      else opt.removeAttribute("selected");
    }
  }

  // Shadow DOM aberto (web components) vira <template shadowrootmode="open">.
  const roots: ShadowRoot[] = [];
  const visit = (node: Document | ShadowRoot) => {
    for (const el of Array.from(node.querySelectorAll("*"))) {
      if (el.shadowRoot) {
        roots.push(el.shadowRoot);
        visit(el.shadowRoot);
      }
    }
  };
  visit(document);

  const html = document.documentElement as HTMLElement & {
    getHTML?: (opts: { serializableShadowRoots?: boolean; shadowRoots?: ShadowRoot[] }) => string;
  };
  const inner = html.getHTML ? html.getHTML({ shadowRoots: roots }) : html.innerHTML;
  const attrs = Array.from(html.attributes)
    .map((a) => ` ${a.name}="${a.value.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`)
    .join("");
  // O doctype original decide o modo de renderização (padrão, quase-padrão ou
  // quirks); páginas sem doctype continuam sem.
  const dt = document.doctype;
  const doctype = dt
    ? `<!DOCTYPE ${dt.name}${dt.publicId ? ` PUBLIC "${dt.publicId}"` : ""}${
        dt.systemId ? `${dt.publicId ? "" : " SYSTEM"} "${dt.systemId}"` : ""
      }>\n`
    : "";
  return `${doctype}<html${attrs}>${inner}</html>`;
}

async function autoScroll(page: Page, device: Device, maxMs: number, signal?: AbortSignal) {
  const start = Date.now();
  let stable = 0;
  let lastHeight = 0;
  for (let step = 0; step < 300; step++) {
    throwIfCanceled(signal);
    const { height, y, inner } = await page.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      y: window.scrollY,
      inner: window.innerHeight,
    }));
    if (y + inner >= height - 4) {
      stable = height === lastHeight ? stable + 1 : 0;
      if (stable >= 3 || height > 60_000) break;
    }
    lastHeight = height;
    if (Date.now() - start > maxMs) break;
    const delta = Math.round(inner * 0.8);
    if (device === "desktop") await page.mouse.wheel(0, delta);
    else await page.evaluate((d) => window.scrollBy(0, d), delta);
    await page.waitForTimeout(250);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
}

/** Espera a rede ficar quieta (sem requisições pendentes por 1 s), no máximo maxMs. */
async function waitForQuiet(inflight: () => number, maxMs: number) {
  const start = Date.now();
  let quietSince = inflight() === 0 ? Date.now() : 0;
  while (Date.now() - start < maxMs) {
    if (inflight() === 0) {
      if (!quietSince) quietSince = Date.now();
      if (Date.now() - quietSince >= 1000) return;
    } else {
      quietSince = 0;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * Erro de navegação com o motivo real: o proxy sabe por que a conexão falhou
 * (endereço interno, DNS, recusa…); o Chromium só diz "túnel falhou".
 * As mensagens casam com `friendlyCloneError` (job.ts).
 */
function navigationError(proxy: GuardedProxy, url: string | undefined, fallback: unknown): Error {
  let host = "";
  try {
    host = url ? new URL(url).hostname : "";
  } catch {
    // URL inválida: usa o erro original
  }
  const code = host ? proxy.failureFor(host)?.code : undefined;
  if (code === "BLOCKED") return new Error("Endereço interno bloqueado por segurança.");
  if (code === "DNS") return new Error("net::ERR_NAME_NOT_RESOLVED");
  if (code === "REFUSED") return new Error("net::ERR_CONNECTION_REFUSED");
  if (code === "RESET") return new Error("net::ERR_CONNECTION_RESET");
  if (code === "TIMEOUT") return new Error("net::ERR_TIMED_OUT");
  return fallback instanceof Error ? fallback : new Error(String(fallback));
}

export async function capturePage(opts: CaptureOptions): Promise<CaptureResult> {
  const { browser, device, url, log, signal } = opts;
  throwIfCanceled(signal);
  const responses = new Map<string, CapturedResponse>();
  const blocked: { url: string; match: TrackerMatch }[] = [];
  const blockedSeen = new Set<string>();
  const warnings: CloneWarning[] = [];
  let inflightCount = 0;

  const blockedHosts = new Set<string>();
  const proxy = await startGuardedProxy({
    hostMap: opts.hostMap ?? {},
    allowPrivate: opts.allowPrivate ?? false,
    onBlocked: (target) => {
      const host = target.replace(/^[a-z]+:\/\//i, "").split(/[/?#]/)[0];
      if (blockedHosts.has(host)) return;
      blockedHosts.add(host);
      log("WARN", "Endereço interno bloqueado por segurança.", target);
    },
  });

  let context: BrowserContext | null = null;
  // Cancelar fecha o navegador na hora (goto e esperas longas terminam junto).
  const onAbort = () => void context?.close().catch(() => {});
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    context = await browser.newContext({
      ...(device === "desktop" ? DESKTOP_CONTEXT : MOBILE_CONTEXT),
      locale: "pt-BR",
      timezoneId: "America/Sao_Paulo",
      serviceWorkers: "block",
      ignoreHTTPSErrors: true,
      // "<-loopback>": nem localhost/127.0.0.1/[::1] escapam do proxy.
      proxy: { server: proxy.server, bypass: "<-loopback>" },
    });
    throwIfCanceled(signal);

    // O tsx/esbuild pode envolver funções com __name(); a função de serialização
    // roda dentro da página, então garantimos que esse helper exista lá.
    await context.addInitScript("window.__name = window.__name || function (f) { return f; };");
    await context.route("**/*", async (route: Route, request: Request) => {
      try {
        const reqUrl = request.url();
        if (reqUrl.startsWith("data:") || reqUrl.startsWith("blob:")) return await route.continue();
        let parsed: URL;
        try {
          parsed = new URL(reqUrl);
        } catch {
          return await route.abort();
        }

        // Importação: arquivos locais no lugar da rede.
        const site = opts.virtualSite;
        if (site && parsed.origin === site.origin) {
          const file = site.get(safeDecode(parsed.pathname));
          if (file) return await route.fulfill({ status: 200, body: file.body, contentType: file.contentType });
          if (!site.fallthrough) return await route.fulfill({ status: 404, body: "" });
        }

        // Imagens, CSS e fontes de CDNs de marketing (RD Station, ActiveCampaign…) são
        // conteúdo da página: só são bloqueadas por assinatura própria ou caminho de pixel.
        const match = classifyRequest(reqUrl, request.resourceType());
        if (match) {
          const key = `${match.vendor}|${parsed.hostname}`;
          if (!blockedSeen.has(key)) {
            blockedSeen.add(key);
            blocked.push({ url: reqUrl, match });
          }
          return await route.abort("blockedbyclient");
        }
        // Endereços internos são barrados pelo proxy, conexão a conexão.
        return await route.continue();
      } catch {
        // Uma requisição com problema (ou a página já fechada) nunca derruba a captura.
        await route.abort().catch(() => {});
      }
    });

    const page = await context.newPage();
    const isMainNavigation = (req: Request) => {
      try {
        return req.isNavigationRequest() && req.frame() === page.mainFrame();
      } catch {
        return false;
      }
    };
    const nav: { response: Response | null; failure: { url: string; errorText: string } | null } = {
      response: null,
      failure: null,
    };
    page.on("request", (req) => {
      if (req.resourceType() !== "media") inflightCount++;
    });
    const done = (req: Request) => {
      if (req.resourceType() !== "media") inflightCount = Math.max(0, inflightCount - 1);
    };
    page.on("requestfinished", done);
    page.on("requestfailed", (req) => {
      done(req);
      if (isMainNavigation(req)) nav.failure = { url: req.url(), errorText: req.failure()?.errorText ?? "" };
    });
    page.on("response", async (resp) => {
      try {
        const req = resp.request();
        if (isMainNavigation(req)) nav.response = resp;
        const status = resp.status();
        if (req.resourceType() === "media" || status < 200 || status >= 300) return;
        if (resp.headers()[PROXY_ERROR_HEADER]) return;
        const respUrl = stripHash(resp.url());
        if (respUrl.startsWith("data:") || responses.has(respUrl)) return;
        const length = Number(resp.headers()["content-length"] ?? 0);
        if (length > MAX_BODY_BYTES) return;
        const body = await resp.body();
        if (body.length > MAX_BODY_BYTES) return;
        responses.set(respUrl, {
          url: respUrl,
          status,
          contentType: capturedContentType(resp.headers()["content-type"] ?? "", body, req.resourceType()),
          body,
        });
      } catch {
        // corpo indisponível (redirect, navegação cancelada…)
      }
    });

    /** A página principal atual veio do proxy com erro (ou é a página de erro do Chromium)? */
    const assertMainDocument = () => {
      const current = nav.response;
      if (current?.headers()[PROXY_ERROR_HEADER]) {
        throw navigationError(proxy, current.url(), new Error("A página não abriu."));
      }
      if (page.url().startsWith("chrome-error:")) {
        throw navigationError(proxy, nav.failure?.url, new Error(nav.failure?.errorText || "A página não abriu."));
      }
    };

    throwIfCanceled(signal);
    // Só exigimos a resposta do servidor. Um script travado (ex.: arquivo de um
    // domínio fora do ar) pode segurar a montagem da página; nesse caso seguimos
    // com o que já carregou, com aviso.
    let response: Response | null;
    try {
      response = await page.goto(url, { waitUntil: "commit", timeout: 45_000 });
    } catch (err) {
      throwIfCanceled(signal);
      throw navigationError(proxy, nav.failure?.url ?? url, err);
    }
    if (!response) throw new Error("A página não respondeu.");
    // Redirecionamento para a rede interna: o proxy recusou e respondeu com erro.
    if (response.headers()[PROXY_ERROR_HEADER]) {
      throw navigationError(proxy, response.url(), new Error("A página não abriu."));
    }
    let stalled = false;
    await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {
      stalled = true;
    });
    if (!stalled) {
      await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => {
        stalled = true;
      });
    }
    throwIfCanceled(signal);
    if (stalled) {
      log("WARN", "A página continuou carregando por muito tempo; seguimos com o que já tinha carregado.");
      warnings.push({
        code: "PAGE_STALLED",
        message:
          "A página continuou carregando por muito tempo e a cópia foi feita com o que já tinha carregado. Confira se falta alguma parte.",
      });
    }
    const status = response.status();
    const headers = response.headers();
    let originalBody: Buffer;
    try {
      originalBody = await response.body();
    } catch {
      originalBody = Buffer.from(await page.content());
    }
    const originalHtml = decodeText(
      originalBody,
      capturedContentType(headers["content-type"] ?? "", originalBody, "document"),
    ).text;

    // Proteção anti-robô: dá alguns segundos (desafios automáticos às vezes
    // se resolvem sozinhos) e, se continuar, informa — nunca contorna.
    const checkProtection = async () =>
      detectProtection({
        status,
        headers,
        html: await page.content(),
        title: await page.title(),
        bodyTextLength: await page.evaluate(() => document.body?.innerText.length ?? 0),
      });
    let protection = await checkProtection();
    if (protection?.kind === "BOT_CHALLENGE") {
      await page.waitForTimeout(6000);
      protection = await checkProtection();
    }

    if (!protection || protection.kind === "EMPTY_SHELL") {
      await page.evaluate(() => document.fonts?.ready).catch(() => {});
      // Interação simulada sem clicar em nada.
      await page.mouse.move(200, 200).catch(() => {});
      await page.evaluate(() => {
        for (const type of ["mousemove", "touchstart", "touchmove", "wheel", "keydown", "scroll"]) {
          window.dispatchEvent(new Event(type));
          document.dispatchEvent(new Event(type));
        }
      });
      await page.waitForTimeout(800);
      await autoScroll(page, device, opts.maxScrollMs ?? 30_000, signal);
      await waitForQuiet(() => inflightCount, 8000);
      // "Quase vazia" foi medido antes de rolar e esperar os scripts: a
      // captura precisa dizer como a página terminou.
      if (protection?.kind === "EMPTY_SHELL") {
        const before = protection;
        protection = await checkProtection().catch(() => before);
      }
    }
    throwIfCanceled(signal);
    assertMainDocument();

    const renderedHtml = await page.evaluate(serializeDomInPage);
    const title = (await page.title()).trim();
    // A serialização marcou as animações AOS como concluídas: deixa a transição terminar antes do print.
    if (/\sdata-aos[\s=>]/i.test(renderedHtml)) await page.waitForTimeout(1000);
    let screenshot: Buffer | undefined;
    try {
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      const width = page.viewportSize()?.width ?? 1440;
      screenshot = await page.screenshot({
        fullPage: true,
        type: "jpeg",
        quality: 72,
        clip: { x: 0, y: 0, width, height: Math.min(height, SCREENSHOT_MAX_HEIGHT) },
        timeout: 20_000,
      });
    } catch {
      throwIfCanceled(signal);
      log("WARN", "Não foi possível tirar o print da página inteira.");
      warnings.push({
        code: "SCREENSHOT_FAILED",
        message: "Não foi possível tirar o print da página original, então a comparação com a cópia fica sem imagem.",
      });
    }

    return {
      device,
      requestedUrl: url,
      finalUrl: stripHash(page.url()),
      status,
      title,
      originalHtml,
      renderedHtml,
      responses,
      blocked,
      screenshot,
      protection,
      warnings,
    };
  } catch (err) {
    if (signal?.aborted) throw new CloneCanceledError();
    throw err;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await context?.close().catch(() => {});
    await proxy.close().catch(() => {});
  }
}
