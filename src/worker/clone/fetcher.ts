/**
 * Download seguro de arquivos da internet para o clonador.
 *
 * - Só http/https; resolve o DNS e recusa endereços internos (localhost, rede
 *   privada, link-local/metadados de nuvem, CGNAT, multicast…) em TODA conexão,
 *   inclusive após cada redirecionamento (proteção contra SSRF/DNS rebinding).
 * - Segue redirecionamentos manualmente (máx. 5), revalidando cada salto.
 * - Limita o tamanho (inclusive depois de descompactar) e o tempo.
 * - Descompacta gzip/deflate/br.
 * - `startGuardedProxy`: as mesmas regras de conexão para o Chromium da
 *   captura, que passa a navegar só através desse proxy local.
 *
 * `hostMap` (só para testes) aponta nomes para um servidor local, ex.:
 * `{ "*.fixture.test": "127.0.0.1:4555" }` — nomes mapeados ignoram o bloqueio.
 */
import { createHash } from "node:crypto";
import dns from "node:dns";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { type Duplex, type Readable, Transform, type TransformCallback, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";
import ipaddr from "ipaddr.js";
import { Agent, buildConnector, request } from "undici";
import { UserError } from "@/lib/errors";

export interface FetcherOptions {
  /** Tamanho máximo de cada resposta (depois de descompactar). Padrão: 25 MB. */
  maxBytes?: number;
  /** Tempo máximo até a resposta começar e tempo máximo parado no meio do download. Padrão: 20 s. */
  timeoutMs?: number;
  userAgent?: string;
  /** Só para testes: nome → "ip:porta". Padrão: variável OS_CLONE_HOST_MAP. */
  hostMap?: Record<string, string>;
  /** Permite endereços internos (localhost, rede privada). Padrão: false. */
  allowPrivate?: boolean;
  /** Cancelamento (ex.: a clonagem foi cancelada): interrompe na hora os downloads em andamento. */
  signal?: AbortSignal;
}

export interface FetchInit {
  referer?: string;
  /** Cabeçalho Accept (padrão: "*\/*"). */
  accept?: string;
}

export interface FetchResult {
  /** true quando a resposta final é 2xx e o corpo foi lido inteiro. */
  ok: boolean;
  /** Código HTTP final (0 quando nem houve resposta). */
  status: number;
  /** URL depois dos redirecionamentos (sem #hash). */
  finalUrl: string;
  /** Cabeçalho Content-Type da resposta ("" se ausente). */
  contentType: string;
  body: Buffer;
  /** Motivo da falha, em português. */
  error?: string;
}

export interface DownloadResult {
  bytes: number;
  sha256: string;
  contentType: string;
  finalUrl: string;
}

export interface Fetcher {
  /** Baixa para a memória. Nunca lança erro: falhas voltam em `error`. */
  fetchResource(url: string, init?: FetchInit): Promise<FetchResult>;
  /** Baixa direto para um arquivo, calculando o SHA-256. Lança `FetchError` em caso de falha. */
  downloadToFile(url: string, destPath: string, maxBytes: number, init?: FetchInit): Promise<DownloadResult>;
  close(): Promise<void>;
}

export const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 20_000;
export const MAX_REDIRECTS = 5;
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

/** Erro de download com mensagem pronta para o usuário (em português). */
export class FetchError extends UserError {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 0,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

// ─── Endereços bloqueados ────────────────────────────────────────────────────

function embeddedIpv4(addr: ipaddr.IPv6, highPartIndex: number) {
  const hi = addr.parts[highPartIndex];
  const lo = addr.parts[highPartIndex + 1];
  return new ipaddr.IPv4([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]);
}

/**
 * true quando o IP não é um endereço público da internet: loopback, rede
 * privada, link-local (169.254/16, metadados de nuvem), CGNAT, 0.0.0.0/8,
 * multicast, reservados, fc00::/7, fe80::/10, ::1… IPv4 dentro de IPv6
 * (::ffff:a.b.c.d, NAT64, 6to4) é verificado pelo IPv4 embutido.
 * Texto que não é IP válido também é bloqueado.
 */
export function isBlockedAddress(ip: string): boolean {
  let raw = ip.trim();
  if (raw.startsWith("[") && raw.endsWith("]")) raw = raw.slice(1, -1);
  const zone = raw.indexOf("%");
  if (zone !== -1) raw = raw.slice(0, zone);
  if (!raw || !ipaddr.isValid(raw)) return true;

  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.process(raw);
  } catch {
    return true;
  }
  if (addr.kind() === "ipv4") return (addr as ipaddr.IPv4).range() !== "unicast";

  const v6 = addr as ipaddr.IPv6;
  // ::/96 (IPv4-compatível, obsoleto) — inclui ::, ::1 e ::7f00:1.
  if (v6.parts.slice(0, 6).every((p) => p === 0)) return true;
  const range = v6.range();
  if (range === "rfc6052" || range === "rfc6145") return embeddedIpv4(v6, 6).range() !== "unicast";
  if (range === "6to4") return embeddedIpv4(v6, 1).range() !== "unicast";
  return range !== "unicast";
}

// ─── Mapa de hosts (testes) ──────────────────────────────────────────────────

function cleanHostname(hostname: string) {
  let h = hostname.trim().toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  return h.endsWith(".") ? h.slice(0, -1) : h;
}

/**
 * Procura o hostname no mapa. Aceita nomes exatos e curingas "*.sufixo"
 * (que valem para qualquer subdomínio e para o próprio sufixo). O nome exato
 * tem prioridade; entre curingas, vence o sufixo mais longo.
 */
export function matchHostMap(hostname: string, hostMap?: Record<string, string> | null): string | null {
  if (!hostMap) return null;
  const host = cleanHostname(hostname);
  if (!host) return null;
  let best: { len: number; target: string } | null = null;
  for (const [rawKey, target] of Object.entries(hostMap)) {
    const key = cleanHostname(rawKey);
    if (!key || !target) continue;
    if (key === host) return target;
    if (key.startsWith("*.")) {
      const suffix = key.slice(2);
      if (host === suffix || host.endsWith(`.${suffix}`)) {
        if (!best || suffix.length > best.len) best = { len: suffix.length, target };
      }
    }
  }
  return best?.target ?? null;
}

/** Lê OS_CLONE_HOST_MAP ("*.fixture.test=127.0.0.1:4555,outro.test=127.0.0.1:4556"). */
export function parseHostMap(envValue: string | undefined = process.env.OS_CLONE_HOST_MAP): Record<string, string> {
  const map: Record<string, string> = {};
  if (!envValue) return map;
  for (const item of envValue.split(/[,;\s]+/)) {
    const eq = item.indexOf("=");
    if (eq <= 0) continue;
    const key = cleanHostname(item.slice(0, eq));
    const value = item.slice(eq + 1).trim();
    if (key && value) map[key] = value;
  }
  return map;
}

/** Separa "ip:porta", "[::1]:porta" ou só "ip". */
function splitHostPort(target: string): { host: string; port?: string } {
  const t = target.trim();
  if (t.startsWith("[")) {
    const end = t.indexOf("]");
    const host = t.slice(1, end === -1 ? undefined : end);
    const rest = end === -1 ? "" : t.slice(end + 1);
    return rest.startsWith(":") && rest.length > 1 ? { host, port: rest.slice(1) } : { host };
  }
  const colons = t.split(":").length - 1;
  if (colons === 1) {
    const [host, port] = t.split(":");
    return port ? { host, port } : { host };
  }
  return { host: t };
}

// ─── Conexão segura ──────────────────────────────────────────────────────────

class BlockedAddressError extends Error {
  readonly code = "OS_BLOCKED_ADDRESS";
  constructor(hostname: string) {
    super(`Endereço bloqueado por segurança: "${hostname}" aponta para uma rede interna ou local.`);
    this.name = "BlockedAddressError";
  }
}

/** dns.lookup que recusa o nome se QUALQUER endereço resolvido for interno. */
const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as dns.LookupAddress[];
    if (!list.length) return callback(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }), "", 0);
    if (list.some((a) => isBlockedAddress(a.address))) return callback(new BlockedAddressError(hostname), "", 0);
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

function createConnector(opts: {
  timeoutMs: number;
  hostMap: Record<string, string>;
  allowPrivate: boolean;
}): buildConnector.connector {
  const safe = buildConnector({ timeout: opts.timeoutMs, lookup: safeLookup });
  const trusted = buildConnector({ timeout: opts.timeoutMs });
  return (options, callback) => {
    const mapped = matchHostMap(options.hostname, opts.hostMap);
    if (mapped) {
      const target = splitHostPort(mapped);
      return trusted({ ...options, hostname: target.host, port: target.port ?? options.port }, callback);
    }
    if (opts.allowPrivate) return trusted(options, callback);
    const hostname = cleanHostname(options.hostname);
    if (net.isIP(hostname) && isBlockedAddress(hostname)) {
      process.nextTick(() => callback(new BlockedAddressError(options.hostname), null));
      return;
    }
    return safe(options, callback);
  };
}

/**
 * Abre uma conexão TCP com as mesmas regras do fetcher: nomes do `hostMap`
 * vão para o destino mapeado; IPs literais e nomes resolvidos para a rede
 * interna são recusados (BlockedAddressError), inclusive IPv6 ([::1],
 * [::ffff:127.0.0.1]). A checagem vale para o IP realmente conectado, então
 * cobre redirecionamentos e DNS rebinding.
 */
function connectGuarded(
  rawHost: string,
  port: number,
  opts: { hostMap: Record<string, string>; allowPrivate: boolean; timeoutMs: number },
): Promise<net.Socket> {
  const host = cleanHostname(rawHost);
  return new Promise((resolve, reject) => {
    let target: net.NetConnectOpts;
    const mapped = matchHostMap(host, opts.hostMap);
    if (mapped) {
      const t = splitHostPort(mapped);
      target = { host: t.host, port: t.port ? Number(t.port) : port };
    } else if (opts.allowPrivate) {
      target = { host, port };
    } else if (net.isIP(host)) {
      if (isBlockedAddress(host)) return reject(new BlockedAddressError(host));
      target = { host, port };
    } else {
      target = { host, port, lookup: safeLookup };
    }
    const socket = net.connect(target);
    socket.setTimeout(opts.timeoutMs, () =>
      socket.destroy(Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" })),
    );
    socket.once("error", reject);
    socket.once("connect", () => {
      socket.setTimeout(0);
      socket.off("error", reject);
      resolve(socket);
    });
  });
}

// ─── Proxy para o Chromium ───────────────────────────────────────────────────

/** Cabeçalho das respostas de erro do proxy (conexão recusada ou que falhou). */
export const PROXY_ERROR_HEADER = "x-offerstudio-proxy-error";

export interface GuardedProxyOptions {
  hostMap?: Record<string, string>;
  allowPrivate?: boolean;
  /** Tempo máximo para conectar ao servidor de destino. Padrão: 20 s. */
  timeoutMs?: number;
  /** Chamado quando uma conexão é recusada por apontar para a rede interna. */
  onBlocked?: (target: string) => void;
}

export interface GuardedProxy {
  /** Endereço para o Playwright (`proxy.server`), ex.: "http://127.0.0.1:54321". */
  server: string;
  /** Último erro de conexão com um host (null se a última tentativa deu certo). */
  failureFor(hostname: string): FetchError | null;
  close(): Promise<void>;
}

/** Cabeçalhos que valem só para um salto (não passam pelo proxy). */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function forwardableHeaders(raw: string[]): string[] {
  const listed = new Set<string>();
  for (let i = 0; i < raw.length; i += 2) {
    if (raw[i].toLowerCase() === "connection") {
      for (const name of raw[i + 1].split(",")) listed.add(name.trim().toLowerCase());
    }
  }
  const out: string[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    const name = raw[i].toLowerCase();
    if (!HOP_BY_HOP.has(name) && !listed.has(name)) out.push(raw[i], raw[i + 1]);
  }
  return out;
}

function proxyErrorStatus(error: FetchError) {
  if (error.code === "BLOCKED") return 403;
  return error.code === "TIMEOUT" ? 504 : 502;
}

/**
 * Proxy HTTP local por onde passa TODO o tráfego do Chromium na captura
 * (use com `proxy: { server, bypass: "<-loopback>" }` para que nem localhost
 * escape). Cada conexão passa por `connectGuarded`: é a proteção contra SSRF
 * da captura, válida para redirecionamentos, navegações feitas por
 * JavaScript, DNS rebinding, IPv6 e WebSockets — o navegador sozinho não
 * revalida esses casos. Escuta só em 127.0.0.1, numa porta aleatória.
 */
export async function startGuardedProxy(options: GuardedProxyOptions = {}): Promise<GuardedProxy> {
  const cfg = {
    hostMap: options.hostMap ?? {},
    allowPrivate: options.allowPrivate ?? false,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
  const failures = new Map<string, FetchError>();
  const sockets = new Set<Duplex>();
  const track = (socket: Duplex) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  };

  const recordFailure = (host: string, target: string, err: unknown) => {
    const error = toFetchError(err, { host, timedOut: false, timeoutMs: cfg.timeoutMs });
    failures.set(cleanHostname(host), error);
    if (error.code === "BLOCKED") options.onBlocked?.(target);
    return error;
  };

  // Conexões reaproveitadas (keep-alive) para http:// simples; cada conexão nova é verificada.
  const agent = new http.Agent({ keepAlive: true });
  agent.createConnection = (opts, callback) => {
    connectGuarded(String(opts.host ?? ""), Number(opts.port ?? 80), cfg).then(
      (socket) => {
        track(socket);
        callback?.(null, socket);
      },
      (err) => callback?.(err as Error, undefined as unknown as Duplex),
    );
    return undefined;
  };

  const server = http.createServer();
  server.on("connection", track);
  server.on("clientError", (_err, socket) => socket.destroy());

  // http:// → requisição com URL absoluta ("GET http://site/caminho").
  server.on("request", (req: http.IncomingMessage, res: http.ServerResponse) => {
    let target: URL;
    try {
      target = new URL(req.url ?? "");
      if (target.protocol !== "http:") throw new Error("protocolo");
    } catch {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("Requisição inválida.");
      return;
    }
    const host = cleanHostname(target.hostname);
    // Sem corpo, a requisição pode ser repetida numa conexão nova.
    const replayable = req.method === "GET" || req.method === "HEAD";
    let upstream: http.ClientRequest | null = null;
    res.on("close", () => {
      if (!res.writableFinished) upstream?.destroy();
    });
    const forward = (attempt: number) => {
      const current = http.request(
        {
          agent,
          host,
          port: Number(target.port || 80),
          method: req.method,
          path: `${target.pathname}${target.search}`,
          headers: forwardableHeaders(req.rawHeaders),
        },
        (up) => {
          failures.delete(host);
          try {
            res.sendDate = false;
            res.writeHead(up.statusCode ?? 502, up.statusMessage, forwardableHeaders(up.rawHeaders));
          } catch {
            // cabeçalho que o Node não aceita repassar
            up.destroy();
            if (!res.headersSent) res.writeHead(502, { [PROXY_ERROR_HEADER]: "NETWORK" });
            res.end();
            return;
          }
          up.on("error", () => res.destroy());
          up.pipe(res);
        },
      );
      upstream = current;
      current.on("error", (err) => {
        if (res.headersSent) return res.destroy();
        // Conexão keep-alive fechada pelo servidor bem na hora de reaproveitar: tenta numa nova.
        if (replayable && attempt === 0 && current.reusedSocket && (err as { code?: string }).code === "ECONNRESET") {
          return forward(1);
        }
        const error = recordFailure(host, target.href, err);
        res
          .writeHead(proxyErrorStatus(error), {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
            [PROXY_ERROR_HEADER]: error.code,
          })
          .end(error.message);
      });
      if (replayable) current.end();
      else req.pipe(current);
    };
    req.on("error", () => upstream?.destroy());
    forward(0);
  });

  // https:// e WebSockets → túnel CONNECT ("CONNECT site:443").
  server.on("connect", (req: http.IncomingMessage, client: Duplex, head: Buffer) => {
    track(client);
    client.on("error", () => client.destroy());
    let target: URL;
    try {
      target = new URL(`http://${req.url ?? ""}`);
    } catch {
      client.end("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    const host = cleanHostname(target.hostname);
    const port = Number(target.port || 80);
    connectGuarded(host, port, cfg).then(
      (upstream) => {
        track(upstream);
        failures.delete(host);
        upstream.on("error", () => client.destroy());
        upstream.once("close", () => client.destroy());
        client.once("close", () => upstream.destroy());
        if (client.destroyed) return upstream.destroy();
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
      },
      (err) => {
        const error = recordFailure(host, `${target.hostname}:${port}`, err);
        client.end(
          `HTTP/1.1 ${proxyErrorStatus(error)} Offer Studio\r\n${PROXY_ERROR_HEADER}: ${error.code}\r\nContent-Length: 0\r\n\r\n`,
        );
      },
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const { port } = server.address() as net.AddressInfo;

  return {
    server: `http://127.0.0.1:${port}`,
    failureFor: (hostname) => failures.get(cleanHostname(hostname)) ?? null,
    close: async () => {
      agent.destroy();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

// ─── Mensagens ───────────────────────────────────────────────────────────────

/** "25 MB", "1,5 MB", "10 KB". */
export function formatLimit(bytes: number): string {
  const MB = 1024 * 1024;
  if (bytes >= MB) {
    const mb = bytes / MB;
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1).replace(".", ",")} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} milissegundos`;
  const s = Math.round(ms / 1000);
  return s === 1 ? "1 segundo" : `${s} segundos`;
}

function tooLargeError(maxBytes: number) {
  return new FetchError(`Arquivo maior que o limite de ${formatLimit(maxBytes)}.`, "TOO_LARGE");
}

function canceledError() {
  return new FetchError("O download foi cancelado.", "ABORTED");
}

function timeoutError(timeoutMs: number) {
  return new FetchError(
    `Tempo esgotado: o servidor demorou mais de ${formatDuration(timeoutMs)} para responder.`,
    "TIMEOUT",
  );
}

function httpStatusMessage(status: number): string {
  if (status === 404) return "O servidor respondeu 404: arquivo não encontrado.";
  if (status === 401 || status === 403) return `O servidor recusou o acesso (código ${status}).`;
  if (status === 429) return "O servidor recusou por excesso de acessos (código 429). Tente mais tarde.";
  if (status >= 500) return `O servidor está com problemas (código ${status}).`;
  return `O servidor respondeu com o código ${status}.`;
}

function errorChain(err: unknown): unknown[] {
  const chain: unknown[] = [];
  let cur: unknown = err;
  while (cur && chain.length < 8 && !chain.includes(cur)) {
    chain.push(cur);
    if (cur instanceof AggregateError) chain.push(...cur.errors);
    cur = (cur as { cause?: unknown }).cause;
  }
  return chain;
}

/** Converte qualquer erro de rede em FetchError com mensagem em português. */
function toFetchError(err: unknown, ctx: { host: string; timedOut: boolean; timeoutMs: number }): FetchError {
  const chain = errorChain(err);
  const known = chain.find((e): e is FetchError => e instanceof FetchError);
  if (known) return known;
  const blocked = chain.find((e): e is BlockedAddressError => e instanceof BlockedAddressError);
  if (blocked) return new FetchError(blocked.message, "BLOCKED");
  if (ctx.timedOut) return timeoutError(ctx.timeoutMs);

  const codes = chain.map((e) => String((e as { code?: unknown })?.code ?? "")).filter(Boolean);
  const has = (...list: string[]) => codes.some((c) => list.includes(c));
  if (has("UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_CONNECT_TIMEOUT", "ETIMEDOUT")) {
    return timeoutError(ctx.timeoutMs);
  }
  if (has("ENOTFOUND", "EAI_AGAIN", "EAI_NONAME", "EAI_FAIL")) {
    return new FetchError(`Não foi possível encontrar o servidor "${ctx.host}". Confira o endereço.`, "DNS");
  }
  if (has("ECONNREFUSED")) return new FetchError(`O servidor "${ctx.host}" recusou a conexão.`, "REFUSED");
  if (has("ECONNRESET", "EPIPE", "UND_ERR_SOCKET", "ERR_STREAM_PREMATURE_CLOSE", "UND_ERR_CLOSED")) {
    return new FetchError("A conexão com o servidor caiu no meio do download.", "RESET");
  }
  if (codes.some((c) => /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|ALTNAME/i.test(c))) {
    return new FetchError(`O certificado de segurança (HTTPS) de "${ctx.host}" é inválido.`, "TLS");
  }
  if (codes.some((c) => /^Z_|ZLIB|BROTLI|ZSTD/i.test(c))) {
    return new FetchError("Não foi possível descompactar a resposta do servidor.", "DECODE");
  }
  if (has("UND_ERR_ABORTED", "ABORT_ERR")) return new FetchError("O download foi cancelado.", "ABORTED");
  const code = codes[0];
  return new FetchError(`Falha ao baixar o arquivo${code ? ` (${code})` : ""}.`, "NETWORK");
}

// ─── URL ─────────────────────────────────────────────────────────────────────

function parseTarget(raw: string | URL, base?: URL): URL {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    throw new FetchError(`Endereço inválido: ${String(raw).slice(0, 200)}`, "INVALID_URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FetchError(
      `Endereço não suportado (${url.protocol.replace(":", "")}): só é possível baixar links http:// ou https://.`,
      "PROTOCOL",
    );
  }
  if (!url.hostname) throw new FetchError(`Endereço inválido: ${url.href.slice(0, 200)}`, "INVALID_URL");
  url.hash = "";
  return url;
}

// ─── Descompactação ──────────────────────────────────────────────────────────

const ZLIB_OPTS: zlib.ZlibOptions = { flush: zlib.constants.Z_SYNC_FLUSH, finishFlush: zlib.constants.Z_SYNC_FLUSH };
const BROTLI_OPTS: zlib.BrotliOptions = {
  flush: zlib.constants.BROTLI_OPERATION_FLUSH,
  finishFlush: zlib.constants.BROTLI_OPERATION_FLUSH,
};

/** "deflate" deveria vir com cabeçalho zlib, mas alguns servidores mandam deflate cru. */
class InflateAuto extends Transform {
  private inner: zlib.Inflate | zlib.InflateRaw | null = null;

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
    if (!chunk.length) return cb();
    if (!this.inner) {
      const inner = (chunk[0] & 0x0f) === 0x08 ? zlib.createInflate(ZLIB_OPTS) : zlib.createInflateRaw(ZLIB_OPTS);
      inner.on("data", (d: Buffer) => this.push(d));
      inner.on("error", (e) => this.destroy(e));
      this.inner = inner;
    }
    if (this.inner.write(chunk)) cb();
    else this.inner.once("drain", () => cb());
  }

  override _flush(cb: TransformCallback) {
    const inner = this.inner;
    if (!inner) return cb();
    inner.once("end", () => cb());
    inner.end();
  }

  override _destroy(err: Error | null, cb: (error?: Error | null) => void) {
    this.inner?.destroy();
    cb(err);
  }
}

function decodersFor(contentEncoding: string): Transform[] {
  const codings = contentEncoding
    .toLowerCase()
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c && c !== "identity");
  // Aplicadas na ordem inversa da declarada.
  return codings.reverse().map((c): Transform => {
    if (c === "gzip" || c === "x-gzip") return zlib.createGunzip(ZLIB_OPTS);
    if (c === "deflate") return new InflateAuto();
    if (c === "br") return zlib.createBrotliDecompress(BROTLI_OPTS);
    if (c === "zstd" && typeof zlib.createZstdDecompress === "function") return zlib.createZstdDecompress();
    throw new FetchError(`O servidor usou uma compressão não suportada (${c}).`, "DECODE");
  });
}

/** Conta bytes (e opcionalmente calcula o hash), falhando acima do limite. */
class Meter extends Transform {
  bytes = 0;
  private readonly hash = createHash("sha256");
  constructor(private readonly maxBytes: number) {
    super();
  }
  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
    this.bytes += chunk.length;
    if (this.bytes > this.maxBytes) return cb(tooLargeError(this.maxBytes));
    this.hash.update(chunk);
    cb(null, chunk);
  }
  digest() {
    return this.hash.digest("hex");
  }
}

/** Junta os pedaços na memória, falhando acima do limite. */
class Collector extends Writable {
  private chunks: Buffer[] = [];
  private total = 0;
  constructor(private readonly maxBytes: number) {
    super();
  }
  override _write(chunk: Buffer, _enc: BufferEncoding, cb: (error?: Error | null) => void) {
    this.total += chunk.length;
    if (this.total > this.maxBytes) return cb(tooLargeError(this.maxBytes));
    this.chunks.push(chunk);
    cb();
  }
  result() {
    return Buffer.concat(this.chunks, this.total);
  }
}

function headerValue(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// ─── Fetcher ─────────────────────────────────────────────────────────────────

interface OpenResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Readable;
  finalUrl: string;
}

/** Cria um cliente HTTP seguro. Lembre de chamar `close()` no fim. */
export function createFetcher(options: FetcherOptions = {}): Fetcher {
  const maxBytesDefault = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const hostMap = options.hostMap ?? parseHostMap();
  const allowPrivate = options.allowPrivate ?? false;
  /** Teto absoluto de um download (resposta lenta "a conta-gotas"). */
  const maxDurationMs = Math.max(timeoutMs * 10, 60_000);

  const agent = new Agent({
    connect: createConnector({ timeoutMs, hostMap, allowPrivate }),
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    connections: 8,
  });

  /** Faz o GET seguindo redirecionamentos (cada salto é revalidado). */
  async function open(url: URL, init: FetchInit, signal: AbortSignal, onHop: (u: URL) => void): Promise<OpenResponse> {
    let current = url;
    for (let hop = 0; ; hop++) {
      onHop(current);
      const headers: Record<string, string> = {
        "user-agent": userAgent,
        accept: init.accept ?? "*/*",
        "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "accept-encoding": "gzip, deflate, br",
      };
      if (init.referer) headers.referer = init.referer;
      const res = await request(current, { dispatcher: agent, method: "GET", headers, signal });
      const location = headerValue(res.headers.location);
      if (REDIRECT_STATUSES.has(res.statusCode) && location) {
        res.body.dump({ limit: 64 * 1024 }).catch(() => {});
        if (hop >= MAX_REDIRECTS) {
          throw new FetchError(`Redirecionamentos demais (mais de ${MAX_REDIRECTS}).`, "TOO_MANY_REDIRECTS");
        }
        current = parseTarget(location, current);
        continue;
      }
      return { status: res.statusCode, headers: res.headers, body: res.body, finalUrl: current.href };
    }
  }

  /**
   * Executa um download com prazo: `timeoutMs` até os cabeçalhos chegarem,
   * depois `maxDurationMs` para o corpo (e `timeoutMs` parado, via undici).
   */
  async function run<T>(
    rawUrl: string,
    init: FetchInit,
    handle: (res: OpenResponse, signal: AbortSignal) => Promise<T>,
  ): Promise<{ value: T; finalUrl: string }> {
    const url = parseTarget(rawUrl);
    if (options.signal?.aborted) throw canceledError();
    let current = url;
    const controller = new AbortController();
    // Prazo próprio + cancelamento de fora (a clonagem inteira foi cancelada).
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    let timedOut = false;
    let timer = setTimeout(() => {
      timedOut = true;
      controller.abort(timeoutError(timeoutMs));
    }, timeoutMs);
    try {
      const res = await open(url, init, signal, (u) => {
        current = u;
      });
      clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort(timeoutError(maxDurationMs));
      }, maxDurationMs);
      try {
        return { value: await handle(res, signal), finalUrl: res.finalUrl };
      } finally {
        // Corpo não lido (erro, limite): descarta sem gerar "error" sem ouvinte.
        if (!res.body.destroyed) res.body.on("error", () => {}).destroy();
      }
    } catch (err) {
      const error = options.signal?.aborted
        ? canceledError()
        : toFetchError(err, { host: current.hostname, timedOut, timeoutMs });
      throw Object.assign(error, { finalUrl: current.href });
    } finally {
      clearTimeout(timer);
    }
  }

  function checkDeclaredLength(res: OpenResponse, maxBytes: number) {
    const encoding = headerValue(res.headers["content-encoding"]).trim();
    const length = Number(headerValue(res.headers["content-length"]));
    if ((!encoding || encoding === "identity") && Number.isFinite(length) && length > maxBytes) {
      throw tooLargeError(maxBytes);
    }
  }

  async function fetchResource(url: string, init: FetchInit = {}): Promise<FetchResult> {
    let status = 0;
    let contentType = "";
    try {
      const { value, finalUrl } = await run(url, init, async (res, signal) => {
        status = res.status;
        contentType = headerValue(res.headers["content-type"]).trim();
        checkDeclaredLength(res, maxBytesDefault);
        const collector = new Collector(maxBytesDefault);
        const decoders = decodersFor(headerValue(res.headers["content-encoding"]));
        await pipeline([res.body, ...decoders, collector], { signal });
        return collector.result();
      });
      const ok = status >= 200 && status < 300;
      return {
        ok,
        status,
        finalUrl,
        contentType,
        body: value,
        ...(ok ? {} : { error: httpStatusMessage(status) }),
      };
    } catch (err) {
      const e = err as FetchError & { finalUrl?: string };
      return {
        ok: false,
        status,
        finalUrl: e.finalUrl ?? url,
        contentType,
        body: Buffer.alloc(0),
        error: e.message,
      };
    }
  }

  async function downloadToFile(
    url: string,
    destPath: string,
    maxBytes: number,
    init: FetchInit = {},
  ): Promise<DownloadResult> {
    await mkdir(path.dirname(destPath), { recursive: true });
    try {
      const { value, finalUrl } = await run(url, init, async (res, signal) => {
        if (res.status < 200 || res.status >= 300) {
          throw new FetchError(httpStatusMessage(res.status), "HTTP_STATUS", res.status);
        }
        checkDeclaredLength(res, maxBytes);
        const meter = new Meter(maxBytes);
        const decoders = decodersFor(headerValue(res.headers["content-encoding"]));
        await pipeline([res.body, ...decoders, meter, createWriteStream(destPath)], { signal });
        return {
          bytes: meter.bytes,
          sha256: meter.digest(),
          contentType: headerValue(res.headers["content-type"]).trim(),
        };
      });
      return { ...value, finalUrl };
    } catch (err) {
      await rm(destPath, { force: true }).catch(() => {});
      throw err;
    }
  }

  return {
    fetchResource,
    downloadToFile,
    close: () => agent.close(),
  };
}
