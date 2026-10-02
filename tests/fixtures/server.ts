/**
 * Servidor HTTP de sites de teste (offline) para o clonador.
 *
 * Roteia pelo cabeçalho Host: "<nome>.fixture.test" → tests/fixtures/sites/<nome>/.
 * Cada site pode ter um `_site.json` com comportamentos especiais:
 *   { "charset": "iso-8859-1", "uaSplit": true, "challenge": true, "delayMs": 0 }
 *
 * Em arquivos de texto (HTML/CSS/JS/JSON/SVG), o marcador `__ORIGIN__` vira a
 * origem real da requisição (ex.: http://vendas.fixture.test:54321), para
 * simular URLs absolutas do próprio site (og:image, CSS do Elementor…).
 *
 * Toda requisição fica registrada em `requests` (para os testes conferirem que
 * o clone não faz nenhuma requisição à origem).
 *
 * Uso manual: `npx tsx tests/fixtures/server.ts [porta]` e abra o Chromium com
 * `--host-resolver-rules="MAP *.fixture.test 127.0.0.1"`.
 */
import dns from "node:dns";
import { readdir, readFile, stat } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURE_DOMAIN = "fixture.test";
export const FIXTURES_DIR = path.dirname(fileURLToPath(import.meta.url));
export const SITES_DIR = path.join(FIXTURES_DIR, "sites");
export const ZIPS_DIR = path.join(FIXTURES_DIR, "zips");

/** Marcador trocado pela origem real nos arquivos de texto. */
export const ORIGIN_TOKEN = "__ORIGIN__";

/** Regra para o Chromium resolver *.fixture.test para este servidor. */
export const HOST_RESOLVER_RULES = `MAP *.${FIXTURE_DOMAIN} 127.0.0.1`;

/** Argumentos de linha de comando do Chromium (Playwright `launch({ args })`). */
export function fixtureChromiumArgs(): string[] {
  return [`--host-resolver-rules=${HOST_RESOLVER_RULES}`];
}

export interface FixtureRequest {
  /** Hostname sem porta, em minúsculas (ex.: "vendas.fixture.test"). */
  host: string;
  /** Caminho com query string, como veio na requisição. */
  path: string;
  ua: string;
}

export interface FixtureServer {
  port: number;
  /** URL absoluta: url("vendas", "/upsell") → http://vendas.fixture.test:<porta>/upsell */
  url(host: string, path?: string): string;
  close(): Promise<void>;
  /** Todas as requisições recebidas (zere com `requests.length = 0`). */
  requests: FixtureRequest[];
}

export interface SiteConfig {
  charset: string;
  uaSplit: boolean;
  challenge: boolean;
  delayMs: number;
}

const DEFAULT_CONFIG: SiteConfig = { charset: "utf-8", uaSplit: false, challenge: false, delayMs: 0 };

const MOBILE_UA = /iPhone|Android|Mobile/i;

const TYPES: Record<string, { type: string; text: boolean }> = {
  ".html": { type: "text/html", text: true },
  ".htm": { type: "text/html", text: true },
  ".css": { type: "text/css", text: true },
  ".js": { type: "text/javascript", text: true },
  ".mjs": { type: "text/javascript", text: true },
  ".json": { type: "application/json", text: true },
  ".txt": { type: "text/plain", text: true },
  ".xml": { type: "application/xml", text: true },
  ".svg": { type: "image/svg+xml", text: true },
  ".png": { type: "image/png", text: false },
  ".jpg": { type: "image/jpeg", text: false },
  ".jpeg": { type: "image/jpeg", text: false },
  ".gif": { type: "image/gif", text: false },
  ".webp": { type: "image/webp", text: false },
  ".avif": { type: "image/avif", text: false },
  ".ico": { type: "image/x-icon", text: false },
  ".woff2": { type: "font/woff2", text: false },
  ".woff": { type: "font/woff", text: false },
  ".ttf": { type: "font/ttf", text: false },
  ".otf": { type: "font/otf", text: false },
  ".mp4": { type: "video/mp4", text: false },
  ".webm": { type: "video/webm", text: false },
  ".mp3": { type: "audio/mpeg", text: false },
  ".pdf": { type: "application/pdf", text: false },
};

/** Content-Type de um arquivo (texto recebe o charset do site). */
export function contentTypeFor(file: string, charset = "utf-8"): string {
  const t = TYPES[path.extname(file).toLowerCase()];
  if (!t) return "application/octet-stream";
  return t.text ? `${t.type}; charset=${charset}` : t.type;
}

function isText(file: string): boolean {
  return TYPES[path.extname(file).toLowerCase()]?.text ?? false;
}

/** Nome do site a partir do Host ("vendas.fixture.test:1234" → "vendas"). */
export function siteNameFromHost(host: string): string | null {
  const hostname = stripPort(host).toLowerCase();
  const suffix = `.${FIXTURE_DOMAIN}`;
  if (!hostname.endsWith(suffix)) return null;
  const name = hostname.slice(0, -suffix.length);
  return /^[a-z0-9-]+$/.test(name) ? name : null;
}

function stripPort(host: string): string {
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1);
  return host.replace(/:\d*$/, "");
}

/** Lê o `_site.json` (ou usa o padrão). */
export async function readSiteConfig(site: string): Promise<SiteConfig> {
  try {
    const raw = JSON.parse(await readFile(path.join(SITES_DIR, site, "_site.json"), "utf8")) as Partial<SiteConfig>;
    return {
      charset: typeof raw.charset === "string" ? raw.charset : DEFAULT_CONFIG.charset,
      uaSplit: raw.uaSplit === true,
      challenge: raw.challenge === true,
      delayMs: typeof raw.delayMs === "number" && raw.delayMs > 0 ? raw.delayMs : 0,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve o caminho da URL para um arquivo dentro da pasta do site.
 * Retorna null para caminhos inválidos, fora da pasta ou "escondidos" (_*, .*).
 */
async function resolveFile(siteDir: string, rawUrl: string, mobile: boolean): Promise<string | null> {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(rawUrl, "http://x").pathname);
  } catch {
    return null;
  }
  if (pathname.includes("\0") || pathname.includes("\\")) return null;
  const segments = pathname.split("/").filter(Boolean);
  if (segments.some((s) => s === ".." || s.startsWith("_") || s.startsWith("."))) return null;

  let file = path.join(siteDir, ...segments);
  if (file !== siteDir && !file.startsWith(siteDir + path.sep)) return null;
  if (pathname.endsWith("/") || (await isDir(file))) file = path.join(file, "index.html");

  if (mobile && path.basename(file) === "index.html") {
    const mobileFile = path.join(path.dirname(file), "index.mobile.html");
    if (await isFile(mobileFile)) return mobileFile;
  }
  return (await isFile(file)) ? file : null;
}

const NOT_FOUND_HTML = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Página não encontrada</title></head>
<body><h1>404</h1><p>Página não encontrada.</p></body></html>
`;

const UNKNOWN_HOST_HTML = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Site desconhecido</title></head>
<body><h1>404</h1><p>Site de teste desconhecido.</p></body></html>
`;

/** Página imitando o desafio anti-robô da Cloudflare. */
export function challengeHtml(host: string): string {
  return `<!DOCTYPE html>
<html lang="en-US"><head><title>Just a moment...</title>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta http-equiv="X-UA-Compatible" content="IE=Edge">
<meta name="robots" content="noindex,nofollow">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box;margin:0;padding:0}html{line-height:1.15;color:#313131;font-family:system-ui,-apple-system,sans-serif}body{display:flex;flex-direction:column;height:100vh;min-height:100vh}.main-content{margin:8rem auto;max-width:60rem;padding-left:1.5rem}</style>
</head><body class="no-js">
<div class="main-wrapper" role="main"><div class="main-content">
<h1 class="zone-name-title h1">${host}</h1>
<h2 id="challenge-running" class="h2">Checking if the site connection is secure</h2>
<div id="challenge-stage"></div>
<div id="challenge-body-text" class="core-msg spacer">${host} needs to review the security of your connection before proceeding.</div>
<noscript><div id="challenge-error-title"><div class="h2"><span id="challenge-error-text">Enable JavaScript and cookies to continue</span></div></div></noscript>
</div></div>
<script>(function(){window._cf_chl_opt={cvId:'3',cZone:"${host}",cType:'managed',cRay:'8c1f2a3b4d5e6f70',cH:'fixture'};var cpo=document.createElement('script');cpo.src='/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1?ray=8c1f2a3b4d5e6f70';window._cf_chl_opt.cOgUHash=location.hash;document.getElementsByTagName('head')[0].appendChild(cpo);}());</script>
<div class="footer" role="contentinfo"><div class="footer-inner"><div class="text-center" id="footer-text">Performance &amp; security by Cloudflare</div></div></div>
</body></html>
`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function send(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  status: number,
  headers: Record<string, string>,
  body: Buffer | string,
): void {
  const buf = typeof body === "string" ? Buffer.from(body, "utf8") : body;
  res.writeHead(status, { ...headers, "content-length": String(buf.length) });
  res.end(req.method === "HEAD" ? undefined : buf);
}

/** Troca `__ORIGIN__` preservando os bytes (funciona em UTF-8 e Latin-1). */
function replaceOrigin(body: Buffer, origin: string): Buffer {
  const text = body.toString("latin1");
  if (!text.includes(ORIGIN_TOKEN)) return body;
  return Buffer.from(text.replaceAll(ORIGIN_TOKEN, origin), "latin1");
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse, requests: FixtureRequest[]): Promise<void> {
  const hostHeader = req.headers.host ?? "";
  const rawUrl = req.url ?? "/";
  requests.push({
    host: stripPort(hostHeader).toLowerCase(),
    path: rawUrl,
    ua: req.headers["user-agent"] ?? "",
  });

  const site = siteNameFromHost(hostHeader);
  const siteDir = site ? path.join(SITES_DIR, site) : null;
  if (!site || !siteDir || !(await isDir(siteDir))) {
    send(req, res, 404, { "content-type": "text/html; charset=utf-8" }, UNKNOWN_HOST_HTML);
    return;
  }

  const config = await readSiteConfig(site);
  if (config.delayMs > 0) await sleep(config.delayMs);

  if (config.challenge) {
    send(
      req,
      res,
      403,
      {
        "content-type": "text/html; charset=UTF-8",
        "cf-mitigated": "challenge",
        "cf-ray": "8c1f2a3b4d5e6f70-GRU",
        server: "cloudflare",
        "cache-control": "private, max-age=0, no-store, no-cache, must-revalidate",
      },
      challengeHtml(`${site}.${FIXTURE_DOMAIN}`),
    );
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    send(req, res, 405, { "content-type": "text/plain; charset=utf-8", allow: "GET, HEAD" }, "Método não permitido");
    return;
  }

  const mobile = config.uaSplit && MOBILE_UA.test(req.headers["user-agent"] ?? "");
  const file = await resolveFile(siteDir, rawUrl, mobile);
  const baseHeaders: Record<string, string> = { "x-fixture-site": site };
  if (config.uaSplit) baseHeaders.vary = "User-Agent";

  if (!file) {
    send(req, res, 404, { ...baseHeaders, "content-type": "text/html; charset=utf-8" }, NOT_FOUND_HTML);
    return;
  }

  let body: Buffer = await readFile(file);
  if (isText(file)) body = replaceOrigin(body, `http://${hostHeader}`);
  send(req, res, 200, { ...baseHeaders, "content-type": contentTypeFor(file, config.charset) }, body);
}

/** Liga o servidor em 127.0.0.1 (porta 0 = aleatória). */
export async function startFixtureServer(port = 0): Promise<FixtureServer> {
  const requests: FixtureRequest[] = [];
  const server = http.createServer((req, res) => {
    handle(req, res, requests).catch((err: unknown) => {
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(`Erro no servidor de testes: ${err instanceof Error ? err.message : String(err)}`);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const actualPort = (server.address() as AddressInfo).port;

  return {
    port: actualPort,
    requests,
    url(host: string, urlPath = "/") {
      const name = host.toLowerCase().endsWith(`.${FIXTURE_DOMAIN}`) ? host.toLowerCase() : `${host}.${FIXTURE_DOMAIN}`;
      return `http://${name}:${actualPort}${urlPath.startsWith("/") ? urlPath : `/${urlPath}`}`;
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      });
    },
  };
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

/**
 * `lookup` compatível com net/undici que resolve *.fixture.test para 127.0.0.1
 * e delega o resto ao DNS do sistema.
 * Ex.: `new Agent({ connect: { lookup: fixtureLookup } })`.
 */
export function fixtureLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback): void {
  const h = hostname.toLowerCase();
  if (h === FIXTURE_DOMAIN || h.endsWith(`.${FIXTURE_DOMAIN}`)) {
    if (options.all) callback(null, [{ address: "127.0.0.1", family: 4 }]);
    else callback(null, "127.0.0.1", 4);
    return;
  }
  const systemLookup = dns.lookup as unknown as (h: string, o: dns.LookupOptions, cb: LookupCallback) => void;
  systemLookup(hostname, options, callback);
}

// ─── CLI: npx tsx tests/fixtures/server.ts [porta] ──────────────────────────

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

async function cli(): Promise<void> {
  const argPort = Number(process.argv[2] ?? 0);
  const srv = await startFixtureServer(Number.isInteger(argPort) && argPort >= 0 ? argPort : 0);
  const sites = (await readdir(SITES_DIR, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  console.log(`Servidor de fixtures na porta ${srv.port}`);
  for (const s of sites.sort()) console.log(`  ${srv.url(s)}`);
  console.log(`Chromium: --host-resolver-rules="${HOST_RESOLVER_RULES}"`);
  console.log(`curl: curl -H "Host: vendas.${FIXTURE_DOMAIN}" http://127.0.0.1:${srv.port}/`);
  const stop = () => {
    srv.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

if (isMain) {
  cli().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
