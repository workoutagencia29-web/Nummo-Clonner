/**
 * Servidor de prévia do Offer Studio (porta PREVIEW_PORT, padrão 3001).
 *
 * Cada prévia tem um endereço próprio: http://<token>.localhost:3001/
 * (navegadores resolvem *.localhost para esta máquina). Assim a página roda com
 * os scripts dela, isolada do painel (localhost:3000).
 *
 * Tipos de prévia (ver src/lib/preview.ts):
 *   clone    → resultado de uma clonagem (antes de salvar)
 *   offer    → páginas salvas de uma oferta: "/" é a página pedida (ou a inicial),
 *              "/p/<pageId>" navega pelas outras páginas do funil
 *   document → um documento específico
 *
 * Rotas comuns: /os-assets/<arquivo> (arquivos por hash), /os-runtime.js (script do
 * Offer Studio), /os-tracking.js (script de rastreamento) e, no modo "Preservar
 * JS", os arquivos nos caminhos originais.
 *
 * Rastreamento (Fase 4): páginas de oferta/documento recebem a configuração de
 * pixels da oferta no modo "preview" (pixels NÃO carregam; só aparecem no
 * console). Com ?os_teste=<token> de uma sessão de "Testar pixels" desta oferta,
 * o token vai para um cookie da origem da prévia e a página redireciona para o
 * mesmo endereço sem o token (ele não fica no endereço que os pixels de
 * verdade mandam às plataformas, nem no histórico); com o cookie, a página
 * roda no modo "test" (pixels de verdade), também ao navegar pelo funil. A
 * página manda cada passo para POST /__os/pixel-test (mesma origem, JSON até 4 KB).
 * O token da prévia no nome do host continua indo para as plataformas: é da
 * arquitetura da prévia (e só abre neste Mac).
 *
 * SEO (Empresa e SEO / SEO da página) e idioma entram no <head> das páginas de
 * oferta e documentos.
 */
import "dotenv/config";
import { createReadStream } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { prisma } from "@/lib/db";
import { parseByteRange } from "@/lib/http-range";
import { effectiveSeo, parseOfferSettings, parsePageSeo } from "@/lib/offer-settings";
import { parsePageCode } from "@/lib/page-code";
import { type CategorizedCode, isMobileUserAgent, renderPageHtml, type TrackingRenderOptions } from "@/lib/page-render";
import { type PreviewTarget, resolvePreviewToken } from "@/lib/preview";
import { runtimeScript, TRACKING_SCRIPT_PATH, TRACKING_SCRIPT_TAG, trackingScript } from "@/lib/runtime-bundle";
import { type SeoRender, seoRenderFrom } from "@/lib/seo-render";
import { getObject, mimeFromKey, objectInfo, storagePath } from "@/lib/storage";
import { loadTracking } from "@/lib/tracking/config";
import { PIXEL_TEST_ENDPOINT, PIXEL_TEST_MAX_BODY, PIXEL_TEST_PARAM } from "@/lib/tracking/runtime-config";
import { explicitPageCodeCategory } from "@/lib/tracking/schema";
import { findActivePixelTestSession, PIXEL_TEST_HTTP_STATUS, recordPixelTestEvent } from "@/server/services/pixel-test";
import type { CloneResult } from "@/worker/clone/types";
import { findMappedAsset } from "./asset-map";

const PORT = Number(process.env.PREVIEW_PORT || 3001);
const PANEL_PORT = Number(process.env.PORT || 3000);
const RUNTIME_TAG = '<script src="/os-runtime.js" data-os-runtime></script>';
const STORAGE_KEY_RE = /^a\/[a-f0-9]{2}\/[a-f0-9]{64}\.[a-z0-9]{1,8}$/;
/** Cookie (da origem da prévia) que mantém o modo "Testar pixels" ao navegar pelo funil. */
const TEST_COOKIE = "os_teste";

const tokenCache = new Map<string, { at: number; target: PreviewTarget | null }>();

async function targetFor(token: string) {
  const hit = tokenCache.get(token);
  if (hit && Date.now() - hit.at < 30_000) return hit.target;
  const target = await resolvePreviewToken(token);
  tokenCache.set(token, { at: Date.now(), target });
  return target;
}

function baseHeaders(res: ServerResponse) {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  // Só a origem (http://<token>.localhost:porta, que não abre fora deste Mac) vai
  // para outros sites. Sem nenhum Referer o YouTube recusa tocar (erro 153).
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Só o painel pode mostrar a prévia dentro de um iframe.
  res.setHeader(
    "Content-Security-Policy",
    `frame-ancestors http://localhost:${PANEL_PORT} http://127.0.0.1:${PANEL_PORT}`,
  );
}

function sendText(res: ServerResponse, status: number, body: string, type = "text/html; charset=utf-8") {
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}

function errorPage(title: string, message: string) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f6f7f9;color:#1f2430}main{max-width:28rem;padding:2rem;text-align:center}h1{font-size:1.25rem}p{color:#5b6475}</style></head>
<body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;
}

/** Arquivo do storage, com suporte a Range (o Safari só toca vídeos assim). */
async function sendStorage(req: IncomingMessage, res: ServerResponse, key: string, immutable: boolean) {
  const info = await objectInfo(key);
  if (!info) {
    sendText(res, 404, "Arquivo não encontrado.", "text/plain; charset=utf-8");
    return;
  }
  res.setHeader("Content-Type", mimeFromKey(key));
  res.setHeader("Cache-Control", immutable ? "public, max-age=31536000, immutable" : "no-cache");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Accept-Ranges", "bytes");
  const range = parseByteRange(req.headers.range, info.size);
  if (range === "invalid") {
    res.statusCode = 416;
    res.setHeader("Content-Range", `bytes */${info.size}`);
    res.end();
    return;
  }
  if (range) {
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${info.size}`);
    res.setHeader("Content-Length", String(range.end - range.start + 1));
  } else {
    res.statusCode = 200;
    res.setHeader("Content-Length", String(info.size));
  }
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  const stream = createReadStream(storagePath(key), range ?? {});
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}

interface Resolved {
  /** HTML pronto para servir, ou null se o caminho não é uma página. */
  html: string | null;
  assetMap: Record<string, string>;
  /** Status da resposta (padrão 200). */
  status?: number;
  /** Cabeçalhos Set-Cookie (modo teste). */
  cookies?: string[];
  /** Redireciona para este endereço (302), com os cookies. */
  redirect?: string;
}

function readCookie(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

type TestMode =
  | { kind: "off"; cookies?: string[] }
  | { kind: "on"; token: string; cookies?: string[] }
  | { kind: "enter"; cookies: string[]; redirect: string }
  | { kind: "invalid" };

/** O mesmo endereço sem o ?os_teste= (os outros parâmetros, como as UTMs, ficam). */
function withoutTestParam(url: URL): string {
  const params = new URLSearchParams(url.search);
  params.delete(PIXEL_TEST_PARAM);
  const query = params.toString();
  return `${url.pathname}${query ? `?${query}` : ""}`;
}

/**
 * Modo "Testar pixels": ?os_teste=<token> válido grava o cookie e redireciona
 * para o endereço sem o token ("enter"); o cookie de uma visita anterior nesta
 * origem liga o modo teste. Token de outra oferta ou vencido na URL → aviso;
 * no cookie → volta à prévia normal (e apaga o cookie).
 */
async function testModeFor(req: IncomingMessage, url: URL, offerId: string): Promise<TestMode> {
  const fromQuery = url.searchParams.get(PIXEL_TEST_PARAM);
  const token = fromQuery ?? readCookie(req, TEST_COOKIE);
  if (!token) return { kind: "off" };
  const session = await findActivePixelTestSession(token, offerId);
  if (!session) {
    if (fromQuery !== null) return { kind: "invalid" };
    return { kind: "off", cookies: [`${TEST_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`] };
  }
  const maxAge = Math.max(1, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));
  if (fromQuery !== null) {
    return {
      kind: "enter",
      cookies: [`${TEST_COOKIE}=${session.token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`],
      redirect: withoutTestParam(url),
    };
  }
  return { kind: "on", token: session.token };
}

const TEST_EXPIRED_PAGE = () =>
  errorPage(
    "Este teste de pixels terminou",
    "O link do teste venceu ou não é desta oferta. Volte ao Offer Studio e clique em “Testar pixels” de novo.",
  );

/** Rastreamento da página (prévia: sem pixels; teste: pixels de verdade). */
async function trackingFor(
  offerId: string,
  pageId: string | null,
  test: TestMode,
  pageHref: (id: string) => string,
  /** Versão A/B mostrada (os eventos saem com os_versao; página com uma versão só: nenhuma). */
  variantId: string | null = null,
): Promise<TrackingRenderOptions | null> {
  const loaded = await loadTracking({
    offerId,
    pageId,
    variantId,
    mode: test.kind === "on" ? "test" : "preview",
    test: test.kind === "on" ? { endpoint: PIXEL_TEST_ENDPOINT, token: test.token } : null,
    pageHref,
  });
  if (!loaded) return null;
  return { config: loaded.config, scriptTag: TRACKING_SCRIPT_TAG, offerCode: loaded.settings.customCode };
}

/**
 * Códigos livres da página com a categoria escolhida (sem escolha: a
 * renderização decide pela detecção de pixels, ver resolveCodeCategory).
 */
function pageCodeOf(customCode: unknown): CategorizedCode {
  return { ...parsePageCode(customCode), category: explicitPageCodeCategory(customCode) };
}

/** SEO efetivo da página (o dela, completando com o padrão da oferta) + idioma. */
function seoOf(offerSettings: unknown, pageSeo: unknown): SeoRender {
  const settings = parseOfferSettings(offerSettings);
  return seoRenderFrom(effectiveSeo(settings, parsePageSeo(pageSeo)), settings.language);
}

/**
 * Documento de uma página: variação pedida (ou controle), versão por aparelho.
 * Vem junto com os códigos livres da página (head / início e fim do body).
 */
async function offerPageDocument(
  offerId: string,
  pageId: string | null,
  variantId: string | undefined,
  mobile: boolean,
) {
  const pageSelect = { id: true, customCode: true, seo: true } as const;
  const page = pageId
    ? await prisma.page.findFirst({ where: { id: pageId, offerId, offer: { deletedAt: null } }, select: pageSelect })
    : await prisma.page.findFirst({ where: { offerId, isHome: true, offer: { deletedAt: null } }, select: pageSelect });
  if (!page) return null;
  const variant =
    (variantId &&
      (await prisma.pageVariant.findFirst({ where: { id: variantId, pageId: page.id }, select: { id: true } }))) ||
    (await prisma.pageVariant.findFirst({
      where: { pageId: page.id },
      orderBy: [{ isControl: "desc" }, { position: "asc" }],
      select: { id: true },
    }));
  if (!variant) return null;
  const docs = await prisma.pageDocument.findMany({
    where: { variantId: variant.id },
    select: { device: true, html: true, assetMap: true },
  });
  const wanted = mobile ? "MOBILE" : "DESKTOP";
  const doc = docs.find((d) => d.device === wanted) ?? docs.find((d) => d.device === "ALL") ?? docs[0] ?? null;
  return doc
    ? { ...doc, pageId: page.id, variantId: variant.id, customCode: pageCodeOf(page.customCode), seo: page.seo }
    : null;
}

async function resolve(
  target: PreviewTarget,
  pathname: string,
  req: IncomingMessage,
  url: URL,
): Promise<Resolved | null> {
  const isRoot = pathname === "/" || pathname === "/index.html";

  if (target.kind === "clone") {
    const job = await prisma.cloneJob.findUnique({ where: { id: target.jobId }, select: { result: true } });
    const out = (job?.result as CloneResult | null | undefined)?.devices?.[target.device]?.outputs?.[target.mode];
    if (!out) return null;
    const assetMap = "assetMap" in out ? (out.assetMap as Record<string, string>) : {};
    if (!isRoot) return { html: null, assetMap };
    const html = (await getObject(out.htmlKey)).toString("utf8");
    return { html: renderPageHtml(html, { links: [], pageHref: () => "#", runtimeTag: RUNTIME_TAG }), assetMap };
  }

  if (target.kind === "document") {
    // Ofertas na lixeira não têm prévia (mesma regra do editor e da prévia da oferta).
    const doc = await prisma.pageDocument.findFirst({
      where: { id: target.documentId, variant: { page: { offer: { deletedAt: null } } } },
      select: {
        html: true,
        assetMap: true,
        variant: {
          select: {
            id: true,
            page: {
              select: { id: true, offerId: true, customCode: true, seo: true, offer: { select: { settings: true } } },
            },
          },
        },
      },
    });
    if (!doc) return null;
    const assetMap = (doc.assetMap as Record<string, string> | null) ?? {};
    if (!isRoot) return { html: null, assetMap };
    const { page } = doc.variant;
    const test = await testModeFor(req, url, page.offerId);
    if (test.kind === "invalid") return { html: TEST_EXPIRED_PAGE(), assetMap, status: 410 };
    if (test.kind === "enter") return { html: null, assetMap, cookies: test.cookies, redirect: test.redirect };
    const links = await prisma.offerLink.findMany({
      where: { offerId: page.offerId },
      select: { key: true, url: true },
    });
    const html = renderPageHtml(doc.html ?? "", {
      links,
      pageHref: () => "#",
      runtimeTag: RUNTIME_TAG,
      customCode: pageCodeOf(page.customCode),
      tracking: await trackingFor(page.offerId, page.id, test, () => "#", doc.variant.id),
      company: parseOfferSettings(page.offer.settings).company,
      seo: seoOf(page.offer.settings, page.seo),
    });
    return { html, assetMap, cookies: test.cookies };
  }

  // Oferta: "/" (página pedida ou inicial) ou "/p/<pageId>" (outras páginas do funil).
  const device = url.searchParams.get("dispositivo");
  const mobile = device ? device === "celular" : isMobileUserAgent(req.headers["user-agent"]);
  const match = /^\/p\/([a-z0-9]{20,32})\/?$/.exec(pathname);
  if (!isRoot && !match) {
    // Arquivos de "Preservar JS" (caminhos originais) de qualquer página da oferta.
    const docs = await prisma.pageDocument.findMany({
      where: { variant: { page: { offerId: target.offerId, offer: { deletedAt: null } } } },
      select: { assetMap: true },
    });
    const assetMap: Record<string, string> = {};
    for (const d of docs) Object.assign(assetMap, (d.assetMap as Record<string, string> | null) ?? {});
    return { html: null, assetMap };
  }
  const pageId = match ? match[1] : (target.pageId ?? null);
  // Prévia de uma versão A/B: um link do funil de volta para a mesma página continua nela
  // (como o divisor, que lembra a versão); as outras páginas abrem na de controle.
  const variantId = match && match[1] !== target.pageId ? undefined : target.variantId;
  const doc = await offerPageDocument(target.offerId, pageId, variantId, mobile);
  if (!doc) return null;
  const assetMap = (doc.assetMap as Record<string, string> | null) ?? {};
  const test = await testModeFor(req, url, target.offerId);
  if (test.kind === "invalid") return { html: TEST_EXPIRED_PAGE(), assetMap, status: 410 };
  if (test.kind === "enter") return { html: null, assetMap, cookies: test.cookies, redirect: test.redirect };
  const [links, offer] = await Promise.all([
    prisma.offerLink.findMany({ where: { offerId: target.offerId }, select: { key: true, url: true } }),
    prisma.offer.findUnique({ where: { id: target.offerId }, select: { settings: true } }),
  ]);
  const pageHref = (id: string) => `/p/${id}`;
  return {
    html: renderPageHtml(doc.html ?? "", {
      links,
      pageHref,
      runtimeTag: RUNTIME_TAG,
      customCode: doc.customCode,
      tracking: await trackingFor(target.offerId, doc.pageId, test, pageHref, doc.variantId),
      company: parseOfferSettings(offer?.settings).company,
      seo: seoOf(offer?.settings, doc.seo),
    }),
    assetMap,
    cookies: test.cookies,
  };
}

/** Oferta da prévia (para os passos da tela de teste). null = clone ou item excluído. */
async function offerIdOf(target: PreviewTarget): Promise<string | null> {
  if (target.kind === "offer") {
    const offer = await prisma.offer.count({ where: { id: target.offerId, deletedAt: null } });
    return offer ? target.offerId : null;
  }
  if (target.kind === "document") {
    const doc = await prisma.pageDocument.findFirst({
      where: { id: target.documentId, variant: { page: { offer: { deletedAt: null } } } },
      select: { variant: { select: { page: { select: { offerId: true } } } } },
    });
    return doc?.variant.page.offerId ?? null;
  }
  return null;
}

/** Corpo do pedido até `limit` bytes (null = passou do limite). */
function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > limit) {
      req.resume();
      resolve(null);
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      if (over) return;
      size += chunk.length;
      if (size > limit) {
        over = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(over ? null : Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  sendText(res, status, JSON.stringify(body), "application/json; charset=utf-8");
}

const TEST_ERRORS: Record<keyof typeof PIXEL_TEST_HTTP_STATUS, string> = {
  invalid: "Passo do teste em formato inválido.",
  "not-found": "Teste de pixels não encontrado.",
  "wrong-offer": "Este teste é de outra oferta.",
  expired: "Este teste de pixels terminou.",
  limit: "Este teste chegou ao limite de eventos.",
  "rate-limited": "Muitos eventos de uma vez. Tente de novo em instantes.",
};

/**
 * POST /__os/pixel-test: um passo da página em modo teste (pixel carregado,
 * evento disparado, bloqueado…). Só da própria página (mesma origem), JSON até
 * 4 KB, token de uma sessão desta oferta e ainda válida.
 */
async function handlePixelTest(req: IncomingMessage, res: ServerResponse, host: string, target: PreviewTarget) {
  const origin = req.headers.origin;
  const fetchSite = req.headers["sec-fetch-site"];
  const sameOrigin = origin ? origin.toLowerCase() === `http://${host}` : !fetchSite || fetchSite === "same-origin";
  if (!sameOrigin) {
    sendJson(res, 403, { error: "Pedido de outro site recusado." });
    return;
  }
  const type = String(req.headers["content-type"] ?? "").toLowerCase();
  if (type && !type.startsWith("application/json") && !type.startsWith("text/plain")) {
    sendJson(res, 415, { error: "Envie JSON." });
    return;
  }
  const offerId = await offerIdOf(target);
  if (!offerId) {
    sendJson(res, 404, { error: TEST_ERRORS["not-found"] });
    return;
  }
  const body = await readBody(req, PIXEL_TEST_MAX_BODY);
  if (body === null) {
    sendJson(res, 413, { error: "Passo do teste grande demais." });
    return;
  }
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    sendJson(res, 400, { error: TEST_ERRORS.invalid });
    return;
  }
  const result = await recordPixelTestEvent(json, { offerId });
  if (result.ok) {
    res.statusCode = 204;
    res.setHeader("Cache-Control", "no-store");
    res.end();
    return;
  }
  sendJson(res, PIXEL_TEST_HTTP_STATUS[result.reason], { error: TEST_ERRORS[result.reason] });
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  baseHeaders(res);
  const host = (req.headers.host ?? "").toLowerCase();
  const token = host.split(".")[0] ?? "";
  const url = new URL(req.url ?? "/", "http://preview.local");
  // Caminho decodificado só para as rotas do Offer Studio; os arquivos de
  // "Preservar JS" são procurados pelo caminho como veio (findMappedAsset).
  let pathname = url.pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    // "%" solto no nome do arquivo: segue com o caminho como veio
  }

  const isTestReport = req.method === "POST" && pathname === PIXEL_TEST_ENDPOINT;
  if (req.method !== "GET" && req.method !== "HEAD" && !isTestReport) {
    sendText(res, 405, "Método não permitido.", "text/plain; charset=utf-8");
    return;
  }
  if (!host.endsWith(`.localhost:${PORT}`) && !host.endsWith(".localhost")) {
    sendText(res, 404, errorPage("Prévia não encontrada", "Abra a prévia pelo Offer Studio."));
    return;
  }

  const target = await targetFor(token);
  if (!target) {
    sendText(
      res,
      404,
      errorPage("Esta prévia expirou", "Volte ao Offer Studio e abra a prévia de novo para gerar um link novo."),
    );
    return;
  }

  if (isTestReport) {
    await handlePixelTest(req, res, host, target);
    return;
  }

  if (pathname === "/os-runtime.js") {
    sendText(res, 200, runtimeScript(), "text/javascript; charset=utf-8");
    return;
  }

  if (pathname === TRACKING_SCRIPT_PATH) {
    let js: string;
    try {
      js = trackingScript();
    } catch (err) {
      // Só acontece com o código do script quebrado (desenvolvimento): a página abre sem rastreamento.
      console.error("[prévia] o script de rastreamento não compilou", err);
      sendText(
        res,
        500,
        'console.error("[Offer Studio] O script de rastreamento não compilou. Veja o terminal do Offer Studio.");',
        "text/javascript; charset=utf-8",
      );
      return;
    }
    sendText(res, 200, js, "text/javascript; charset=utf-8");
    return;
  }

  if (pathname.startsWith("/os-assets/")) {
    const file = pathname.slice("/os-assets/".length);
    if (!/^[a-f0-9]{64}\.[a-z0-9]{1,8}$/.test(file)) {
      sendText(res, 404, "Arquivo não encontrado.", "text/plain; charset=utf-8");
      return;
    }
    await sendStorage(req, res, `a/${file.slice(0, 2)}/${file}`, true);
    return;
  }

  const resolved = await resolve(target, pathname, req, url);
  if (!resolved) {
    sendText(res, 404, errorPage("Página não encontrada", "Esta página não existe mais nesta oferta."));
    return;
  }
  if (resolved.redirect) {
    // Entrou no modo teste: o token fica só no cookie (HttpOnly), fora do endereço.
    if (resolved.cookies?.length) res.setHeader("Set-Cookie", resolved.cookies);
    res.statusCode = 302;
    res.setHeader("Location", resolved.redirect);
    res.setHeader("Cache-Control", "no-store");
    res.end();
    return;
  }
  if (resolved.html !== null) {
    if (resolved.cookies?.length) res.setHeader("Set-Cookie", resolved.cookies);
    sendText(res, resolved.status ?? 200, resolved.html);
    return;
  }

  // "Preservar JS": arquivos nos caminhos originais do site (só chaves válidas do storage).
  const mapped = findMappedAsset(resolved.assetMap, url);
  if (mapped && STORAGE_KEY_RE.test(mapped)) {
    await sendStorage(req, res, mapped, false);
    return;
  }
  sendText(res, 404, "Arquivo não encontrado nesta cópia.", "text/plain; charset=utf-8");
}

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error("[prévia]", err);
    if (!res.headersSent) sendText(res, 500, errorPage("Erro na prévia", "Tente abrir a prévia de novo."));
    else res.end();
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[prévia] servidor de prévia em http://*.localhost:${PORT}`);
});

function stop() {
  server.close();
  void prisma.$disconnect().finally(() => process.exit(0));
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
