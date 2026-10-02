/**
 * Execução de uma clonagem (CloneJob): prepara a fonte (link, ZIP ou HTML
 * colado), captura desktop e celular, monta a cópia e grava o resultado para a
 * tela de revisão. Progresso e log em português ficam no banco para o painel.
 */

import { lookup } from "node:dns/promises";
import { rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { type Browser, chromium } from "playwright";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { UserError } from "@/lib/errors";
import { getObject, mimeFromKey, objectExists, putObject, storagePath } from "@/lib/storage";
import { buildClone } from "./build";
import { type CaptureResult, CloneCanceledError, capturePage, type LogFn, type VirtualSite } from "./capture";
import { decodeText } from "./charset";
import { createFetcher, isBlockedAddress, matchHostMap, parseHostMap } from "./fetcher";
import { IMPORT_ORIGIN, PASTE_ORIGIN } from "./synthetic";
import type { CloneWarning, Device } from "./types";
import { safeDecode } from "./urls";
import { findZipFile, readZipSite, ZipImportError } from "./zip-import";

export const CloneOptionsSchema = z.object({
  devices: z
    .array(z.enum(["desktop", "mobile"]))
    .min(1)
    .default(["desktop", "mobile"]),
  maxVideoMb: z.number().int().min(0).max(1000).default(200),
  /** HTML colado: URL de origem opcional para resolver os arquivos relativos. */
  pastedBaseUrl: z.string().url().optional(),
  /** Nome do arquivo enviado (ZIP), para exibir. */
  fileName: z.string().max(300).optional(),
});
export type CloneOptions = z.infer<typeof CloneOptionsSchema>;

/** Origens fictícias das importações (não existem na internet): definidas em synthetic.ts. */
export { IMPORT_ORIGIN, PASTE_ORIGIN };

const INTERNAL_NETWORK_MESSAGE = "Esse endereço aponta para a rede interna e foi bloqueado por segurança.";
const CANCELED_MESSAGE = "Clonagem cancelada.";

/** Código de erro das importações cujo conteúdo é o problema (a tela esconde "Tentar de novo"). */
export const IMPORT_INVALID_CODE = "IMPORT_INVALID";

/**
 * O próprio ZIP/HTML enviado é o problema (ZIP com senha, sem .html, arquivo
 * apagado): tentar de novo com o mesmo arquivo daria o mesmo erro.
 */
export class ImportInvalidError extends UserError {
  constructor(message: string) {
    super(message);
    this.name = "ImportInvalidError";
  }
}

const ZIP_GONE_MESSAGE =
  "O ZIP enviado não está mais disponível (pode ter sido apagado pela limpeza automática). Envie o arquivo de novo.";
const PASTE_GONE_MESSAGE =
  "O HTML colado não está mais disponível (pode ter sido apagado pela limpeza automática). Cole o HTML de novo.";

/** Log em lote: agrupa as linhas e grava a cada ~400 ms. */
function createJobLogger(jobId: string) {
  let buffer: Prisma.CloneLogCreateManyInput[] = [];
  let timer: NodeJS.Timeout | null = null;
  const flush = async () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!buffer.length) return;
    const rows = buffer;
    buffer = [];
    await prisma.cloneLog.createMany({ data: rows }).catch((err) => console.error("[clone] log:", err));
  };
  const log: LogFn = (level, message, url) => {
    buffer.push({ jobId, level, message: message.slice(0, 1000), url: url?.slice(0, 2000) });
    if (!timer) timer = setTimeout(() => void flush(), 400);
  };
  return { log, flush };
}

/** Mensagem clara para erros do navegador/rede. */
export function friendlyCloneError(err: unknown): string {
  if (err instanceof UserError) return err.message;
  const msg = err instanceof Error ? err.message : String(err);
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND/.test(msg))
    return "Não encontramos esse endereço. Confira se o link está certo.";
  if (/ERR_CONNECTION_REFUSED|ECONNREFUSED|ERR_CONNECTION_RESET|ECONNRESET/.test(msg))
    return "O site recusou a conexão. Confira o link ou tente de novo mais tarde.";
  if (/ERR_INTERNET_DISCONNECTED|ENETUNREACH/.test(msg)) return "Sem internet. Confira sua conexão e tente de novo.";
  if (/Timeout|ERR_TIMED_OUT|ETIMEDOUT/i.test(msg)) {
    return "A página não respondeu a tempo. O site pode estar fora do ar, muito lento ou bloqueado na sua rede. Tente de novo em alguns minutos.";
  }
  if (/ERR_TOO_MANY_REDIRECTS/.test(msg)) return "A página entrou num ciclo de redirecionamentos.";
  if (/ERR_ADDRESS_UNREACHABLE|Endereço interno/.test(msg)) return INTERNAL_NETWORK_MESSAGE;
  return "Não foi possível clonar esta página. Tente de novo ou importe o HTML/ZIP salvo pelo navegador.";
}

/** O link precisa ser http(s) e não pode apontar para a rede interna. */
export async function assertPublicUrl(url: string, hostMap: Record<string, string>, allowPrivate: boolean) {
  const u = new URL(url);
  if (u.protocol !== "http:" && u.protocol !== "https:")
    throw new UserError("Use um link que comece com http:// ou https://");
  if (allowPrivate || matchHostMap(u.hostname, hostMap)) return;
  // IP escrito no link (IPv6 vem entre colchetes: "[::1]"): não há DNS a consultar.
  const literal = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(literal)) {
    if (isBlockedAddress(literal)) throw new UserError(INTERNAL_NETWORK_MESSAGE);
    return;
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(literal, { all: true });
  } catch {
    throw new UserError("Não encontramos esse endereço. Confira se o link está certo.");
  }
  if (addrs.some((a) => isBlockedAddress(a.address))) throw new UserError(INTERNAL_NETWORK_MESSAGE);
}

/**
 * Argumentos do Chromium da clonagem. O tráfego HTTP passa pelo proxy seguro
 * de cada captura; QUIC e WebRTC usariam UDP direto, fora do proxy.
 */
const CHROMIUM_ARGS = ["--disable-quic", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"];

/** Tipos de texto servidos a partir do ZIP (convertidos para UTF-8). */
const ZIP_TEXT_MIME: Record<string, string> = {
  html: "text/html",
  htm: "text/html",
  shtml: "text/html",
  xhtml: "application/xhtml+xml",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  json: "application/json",
  svg: "image/svg+xml",
  xml: "application/xml",
  txt: "text/plain",
};

/**
 * Resposta para um arquivo do ZIP. Páginas salvas pelo navegador ficam na
 * codificação original (ex.: ISO-8859-1 com <meta http-equiv>); texto é
 * decodificado como o navegador faria (BOM → <meta>/@charset → UTF-8 →
 * windows-1252) e servido em UTF-8, com cabeçalho coerente.
 */
export function zipFileResponse(pathname: string, body: Buffer): { body: Buffer; contentType: string } {
  const ext = pathname.split("/").pop()?.split(".").pop()?.toLowerCase() ?? "";
  const textMime = ZIP_TEXT_MIME[ext];
  if (!textMime) return { body, contentType: mimeFromKey(pathname) };
  const { text } = decodeText(body, textMime);
  return { body: Buffer.from(text, "utf8"), contentType: `${textMime}; charset=utf-8` };
}

/** Site virtual a partir de um ZIP enviado. */
async function zipSource(uploadKey: string): Promise<{ url: string; site: VirtualSite; warnings: string[] }> {
  // Sem o arquivo, o leitor de ZIP diria "corrompido ou malicioso".
  if (!objectExists(uploadKey)) throw new ImportInvalidError(ZIP_GONE_MESSAGE);
  let zip: Awaited<ReturnType<typeof readZipSite>>;
  try {
    zip = await readZipSite(storagePath(uploadKey));
  } catch (err) {
    // As mensagens do leitor de ZIP já são escritas para o usuário.
    if (err instanceof UserError) throw new ImportInvalidError(err.message);
    console.error("[clone] leitura do ZIP:", err);
    throw new ImportInvalidError("Não foi possível ler o ZIP. Compacte a pasta de novo e envie outra vez.");
  }
  const { files, indexPath, rootDir, warnings } = zip;
  const site: VirtualSite = {
    origin: IMPORT_ORIGIN,
    get(pathname) {
      const rel = pathname.replace(/^\/+/, "");
      // Site zipado dentro de uma pasta: links "/css/…" partem da pasta da página inicial.
      const found = findZipFile(files, rel) ?? (rootDir ? findZipFile(files, `${rootDir}${rel}`) : null);
      return found ? zipFileResponse(pathname, found) : null;
    },
  };
  const url = `${IMPORT_ORIGIN}/${indexPath.split("/").map(encodeURIComponent).join("/")}`;
  return { url, site, warnings };
}

/** Site virtual a partir de HTML colado (com URL de origem opcional). */
export async function pasteSource(uploadKey: string, baseUrl?: string): Promise<{ url: string; site: VirtualSite }> {
  if (!objectExists(uploadKey)) throw new ImportInvalidError(PASTE_GONE_MESSAGE);
  const html = await getObject(uploadKey);
  const url = baseUrl ?? `${PASTE_ORIGIN}/index.html`;
  const u = new URL(url);
  // A captura entrega o caminho decodificado ("/promoção"); o da URL vem codificado.
  const basePath = safeDecode(u.pathname);
  const site: VirtualSite = {
    origin: u.origin,
    fallthrough: Boolean(baseUrl),
    get(pathname) {
      const isPage = pathname === basePath || pathname === u.pathname || (!baseUrl && pathname === "/");
      return isPage ? { body: html, contentType: "text/html; charset=utf-8" } : null;
    },
  };
  return { url, site };
}

/**
 * Marca como falhas as clonagens que estavam rodando quando o Offer Studio foi
 * fechado (chamado quando o worker inicia).
 */
export async function failInterruptedJobs() {
  const interrupted = await prisma.cloneJob.findMany({ where: { status: "RUNNING" }, select: { id: true } });
  if (!interrupted.length) return;
  await prisma.cloneJob.updateMany({
    where: { id: { in: interrupted.map((j) => j.id) }, status: "RUNNING" },
    data: {
      status: "FAILED",
      errorCode: "INTERRUPTED",
      errorMessage: "O Offer Studio foi fechado durante a clonagem. Clique em “Tentar de novo”.",
      finishedAt: new Date(),
    },
  });
  // Downloads pela metade (vídeos .part) dessas clonagens.
  for (const { id } of interrupted) {
    await rm(path.join(env.dataDir, "tmp", "clone", id), { recursive: true, force: true }).catch(() => {});
  }
}

/** Pega a próxima clonagem da fila (atômico, seguro com mais de um worker). */
export async function claimNextJob(): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    update "CloneJob" set status = 'RUNNING', "startedAt" = now(), "updatedAt" = now(), progress = 1
    where id = (
      select id from "CloneJob" where status = 'QUEUED' order by "createdAt" asc limit 1 for update skip locked
    )
    returning id`;
  return rows[0]?.id ?? null;
}

// ─── Estado final ────────────────────────────────────────────────────────────

/** Esperas entre tentativas de gravar no banco (o Postgres pode estar reiniciando). */
const DB_RETRY_DELAYS_MS = [0, 300, 1000, 3000];

async function withDbRetry<T>(write: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (const delay of DB_RETRY_DELAYS_MS) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    try {
      return await write();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

type FinalState = Prisma.CloneJobUpdateManyMutationInput;

/**
 * Clonagens que terminaram sem conseguir gravar o estado final (banco fora do
 * ar): o worker tenta de novo em `settlePendingJobs`, sem perder o resultado.
 */
const pendingFinalStates = new Map<string, FinalState>();

const GENERIC_FAILURE: FinalState = {
  status: "FAILED",
  errorCode: "ERROR",
  errorMessage: "Não foi possível clonar esta página. Tente de novo.",
};

/** Grava os estados finais pendentes (chamado a cada volta do worker). */
export async function settlePendingJobs() {
  for (const [jobId, data] of pendingFinalStates) {
    try {
      await prisma.cloneJob.updateMany({ where: { id: jobId, status: "RUNNING" }, data });
      pendingFinalStates.delete(jobId);
    } catch {
      // banco ainda indisponível: tenta na próxima volta
    }
  }
}

/** A clonagem terminou de forma inesperada: marca como falha assim que o banco permitir. */
export function deferJobFailure(jobId: string) {
  if (!pendingFinalStates.has(jobId)) pendingFinalStates.set(jobId, { ...GENERIC_FAILURE, finishedAt: new Date() });
}

/** Clonagens com estado final ainda não gravado (para testes e diagnóstico). */
export function pendingJobIds(): string[] {
  return [...pendingFinalStates.keys()];
}

/**
 * Grava o estado final só se a clonagem ainda estiver rodando: se o usuário
 * cancelou depois da última checagem, o cancelamento vale. Devolve false
 * quando ela já não estava rodando. Se o banco não responder, o estado fica
 * pendente e é gravado depois (a clonagem nunca fica "rodando" para sempre).
 */
async function settleJob(jobId: string, data: FinalState): Promise<boolean> {
  try {
    const { count } = await withDbRetry(() =>
      prisma.cloneJob.updateMany({ where: { id: jobId, status: "RUNNING" }, data }),
    );
    return count > 0;
  } catch (err) {
    console.error(`[clone ${jobId}] não foi possível gravar o resultado; nova tentativa em seguida:`, err);
    pendingFinalStates.set(jobId, data);
    return true;
  }
}

// ─── Avisos para a revisão ───────────────────────────────────────────────────

function deviceLabel(device: Device) {
  return device === "desktop" ? "desktop" : "celular";
}

/** Página importada (ZIP/HTML) que abriu vazia: "importe aqui" não ajudaria. */
const EMPTY_IMPORT_MESSAGE =
  "A página importada abriu praticamente vazia: o conteúdo é montado por JavaScript que não veio no arquivo. Abra a página no navegador, espere carregar por completo, salve com Arquivo → Salvar como (página completa) e importe de novo.";

/**
 * Avisos das capturas (página quase vazia, carregamento interrompido, print
 * que falhou): um por tipo, dizendo a versão quando só uma foi afetada.
 */
function captureWarnings(captures: CaptureResult[], imported: boolean): CloneWarning[] {
  const byCode = new Map<string, { message: string; devices: Device[] }>();
  for (const capture of captures) {
    const list = [...capture.warnings];
    if (capture.protection?.kind === "EMPTY_SHELL") {
      list.push({ code: "EMPTY_PAGE", message: imported ? EMPTY_IMPORT_MESSAGE : capture.protection.message });
    }
    for (const w of list) {
      const entry = byCode.get(w.code) ?? { message: w.message, devices: [] };
      if (!entry.devices.includes(capture.device)) entry.devices.push(capture.device);
      byCode.set(w.code, entry);
    }
  }
  return [...byCode].map(([code, { message, devices }]) => ({
    code,
    message: devices.length < captures.length ? `Versão ${devices.map(deviceLabel).join(" e ")}: ${message}` : message,
  }));
}

// ─── Execução ────────────────────────────────────────────────────────────────

export async function runCloneJob(jobId: string) {
  const { log, flush } = createJobLogger(jobId);
  const controller = new AbortController();
  const startedAt = Date.now();
  let lastProgress = 0;
  /** O estado final já foi gravado (ou a clonagem não é mais deste worker). */
  let settled = false;
  let cancelWatcher: NodeJS.Timeout | null = null;

  const setProgress = async (progress: number, step: string) => {
    const p = Math.max(lastProgress, Math.min(99, Math.round(progress)));
    lastProgress = p;
    try {
      const { count } = await prisma.cloneJob.updateMany({
        where: { id: jobId, status: "RUNNING" },
        data: { progress: p, step },
      });
      // Cancelada pelo painel: para já, sem esperar a próxima checagem.
      if (count === 0) controller.abort();
    } catch {
      // banco indisponível por um instante: o progresso volta na próxima etapa
    }
  };

  const hostMap = parseHostMap(process.env.OS_CLONE_HOST_MAP);
  const allowPrivate = process.env.OS_CLONE_ALLOW_PRIVATE === "1";
  const fetcher = createFetcher({ hostMap, allowPrivate, maxBytes: 25 * 1024 * 1024, signal: controller.signal });
  let browser: Browser | null = null;

  try {
    // Chamada direta (sem passar pela fila): a clonagem entra em execução aqui.
    await prisma.cloneJob.updateMany({
      where: { id: jobId, status: "QUEUED" },
      data: { status: "RUNNING", startedAt: new Date(), progress: 1 },
    });
    const job = await prisma.cloneJob.findUnique({ where: { id: jobId } });
    if (!job || job.status !== "RUNNING") {
      // Cancelada antes de começar (ou apagada): nada a fazer.
      settled = true;
      return;
    }

    // Cancelamento: o painel muda o status para CANCELED; o worker percebe aqui.
    cancelWatcher = setInterval(() => {
      void prisma.cloneJob
        .findUnique({ where: { id: jobId }, select: { status: true } })
        .then((row) => {
          if (!row || row.status !== "RUNNING") controller.abort();
        })
        .catch(() => {});
    }, 1500);

    const options = CloneOptionsSchema.parse(job.options ?? {});
    await setProgress(2, "Preparando");

    let url: string;
    let virtualSite: VirtualSite | undefined;
    const importWarnings: CloneWarning[] = [];
    if (job.source === "URL") {
      if (!job.sourceUrl) throw new UserError("Informe o link da página.");
      url = job.sourceUrl;
      await assertPublicUrl(url, hostMap, allowPrivate);
      log("INFO", "Abrindo a página…", url);
    } else if (job.source === "ZIP") {
      if (!job.uploadKey) throw new ImportInvalidError(ZIP_GONE_MESSAGE);
      log("INFO", `Lendo o ZIP ${options.fileName ?? ""}…`.trim());
      const src = await zipSource(job.uploadKey);
      for (const w of src.warnings) {
        log("WARN", w);
        importWarnings.push({ code: "IMPORT", message: w });
      }
      url = src.url;
      virtualSite = src.site;
    } else {
      if (!job.uploadKey) throw new ImportInvalidError(PASTE_GONE_MESSAGE);
      if (options.pastedBaseUrl) await assertPublicUrl(options.pastedBaseUrl, hostMap, allowPrivate);
      const src = await pasteSource(job.uploadKey, options.pastedBaseUrl);
      url = src.url;
      virtualSite = src.site;
      log(
        "INFO",
        options.pastedBaseUrl ? "Usando o HTML colado com os arquivos do site de origem…" : "Usando o HTML colado…",
      );
    }
    if (controller.signal.aborted) throw new CloneCanceledError();

    browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
    // Desktop e celular são capturados ao mesmo tempo (contextos separados).
    const deviceList = options.devices as Device[];
    const labels = deviceList.map(deviceLabel);
    await setProgress(5, `Abrindo a página (${labels.join(" e ")})`);
    let finishedCaptures = 0;
    const captures: CaptureResult[] = await Promise.all(
      deviceList.map(async (device) => {
        const capture = await capturePage({
          browser: browser as Browser,
          device,
          url,
          log,
          hostMap,
          allowPrivate,
          signal: controller.signal,
          virtualSite,
        });
        finishedCaptures++;
        await setProgress(5 + (finishedCaptures / deviceList.length) * 50, "Abrindo a página");
        const summary = `${capture.responses.size} arquivos carregados, ${capture.blocked.length} rastreador(es) bloqueado(s)`;
        if (capture.protection?.kind === "EMPTY_SHELL") {
          const message = job.source === "URL" ? capture.protection.message : EMPTY_IMPORT_MESSAGE;
          log("WARN", `Página aberta no ${deviceLabel(device)} (${summary}). ${message}`);
        } else if (!capture.protection) {
          log("SUCCESS", `Página aberta no ${deviceLabel(device)}: ${summary}.`);
        }
        return capture;
      }),
    );

    const blockedCapture = captures.find((c) => c.protection && c.protection.kind !== "EMPTY_SHELL");
    if (blockedCapture?.protection) {
      const protection = blockedCapture.protection;
      const shotKey = blockedCapture.screenshot ? `clones/${jobId}/bloqueio.jpg` : null;
      if (shotKey && blockedCapture.screenshot) await putObject(shotKey, blockedCapture.screenshot);
      const written = await settleJob(jobId, {
        status: "FAILED",
        errorCode: protection.kind,
        errorMessage: protection.message,
        result: { protection, screenshotKey: shotKey } as unknown as Prisma.InputJsonValue,
        finishedAt: new Date(),
      });
      settled = true;
      log(written ? "ERROR" : "WARN", written ? protection.message : CANCELED_MESSAGE);
      return;
    }

    await setProgress(55, "Baixando arquivos e montando a cópia");
    const result = await buildClone({
      jobId,
      captures,
      fetcher,
      log,
      maxVideoBytes: options.maxVideoMb * 1024 * 1024,
      signal: controller.signal,
      startedAt,
      virtualSite,
      fileName: options.fileName,
      onProgress: (f) => void setProgress(55 + f * 40, "Baixando arquivos e montando a cópia"),
    });
    if (controller.signal.aborted) throw new CloneCanceledError();
    // Avisos que antes só apareciam no log (que some quando a revisão abre).
    result.warnings.push(...importWarnings, ...captureWarnings(captures, job.source !== "URL"));

    const written = await settleJob(jobId, {
      status: "REVIEW",
      progress: 100,
      step: "Pronto para revisar",
      result: result as unknown as Prisma.InputJsonValue,
      finishedAt: new Date(),
    });
    settled = true;
    if (written) {
      log(
        "SUCCESS",
        `Cópia pronta: ${result.stats.assets} arquivos (${(result.stats.bytes / 1024 / 1024).toFixed(1)} MB), ${result.removed.length} rastreador(es) removido(s), ${result.checkouts.length} link(s) de checkout.`,
      );
    } else {
      log("WARN", CANCELED_MESSAGE);
    }
  } catch (err) {
    if (err instanceof CloneCanceledError || controller.signal.aborted) {
      log("WARN", CANCELED_MESSAGE);
      settled = true;
      const data: FinalState = { status: "CANCELED", finishedAt: new Date() };
      await withDbRetry(() =>
        prisma.cloneJob.updateMany({ where: { id: jobId, status: { in: ["RUNNING", "CANCELED"] } }, data }),
      ).catch(() => pendingFinalStates.set(jobId, data));
    } else {
      const message = friendlyCloneError(err);
      console.error(`[clone ${jobId}]`, err);
      log("ERROR", message);
      // ZIP/HTML inválido: "Tentar de novo" com o mesmo arquivo daria o mesmo erro.
      const errorCode =
        err instanceof ImportInvalidError || err instanceof ZipImportError ? IMPORT_INVALID_CODE : "ERROR";
      await settleJob(jobId, { status: "FAILED", errorCode, errorMessage: message, finishedAt: new Date() });
      settled = true;
    }
  } finally {
    if (cancelWatcher) clearInterval(cancelWatcher);
    if (!settled) deferJobFailure(jobId);
    await flush();
    await browser?.close().catch(() => {});
    await fetcher.close().catch(() => {});
    await rm(path.join(env.dataDir, "tmp", "clone", jobId), { recursive: true, force: true }).catch(() => {});
  }
}
