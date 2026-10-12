/**
 * Clonagem, lado do painel: cria os pedidos (CloneJob) que o worker executa,
 * informa o progresso e salva o resultado revisado como oferta.
 */
import { randomUUID } from "node:crypto";
import * as cheerio from "cheerio";
import type { CloneStatus as CloneJobStatus, PageType, Prisma } from "@/generated/prisma/client";
import { rewriteScriptPageUrls } from "@/lib/clone-routes";
import { prisma } from "@/lib/db";
import { restoreDoctype } from "@/lib/doctype";
import { UserError } from "@/lib/errors";
import { internalLink } from "@/lib/internal-links";
import { bindUrlToLink, linkKey } from "@/lib/offer-links";
import { deleteObject, getObject, objectExists, putObject } from "@/lib/storage";
import type { StoreCurrency } from "@/lib/store";
import { slugify, uniqueSlug } from "@/lib/text";
import { keptNeedsConsent } from "@/lib/tracking/code-trackers";
import { isWorkerOnline, WORKER_SILENT_MS } from "@/server/services/export";
import { rememberOfferCurrency } from "@/server/services/preferences";
import { cleanUrl } from "@/worker/clone/funnel";
import { isSyntheticOrigin } from "@/worker/clone/synthetic";
import type {
  CloneModeValue,
  CloneResult,
  Device,
  FunnelPageInfo,
  FunnelPageKind,
  FunnelSuggestion,
} from "@/worker/clone/types";

export interface StartOptions {
  devices: ("desktop" | "mobile")[];
  maxVideoMb: number;
  /** "Clonar o funil inteiro": as páginas a que esta leva entram na fila sozinhas (clone-funnel.ts). */
  funnel?: boolean;
}

/**
 * Limite de páginas do funil por clonagem (além da página principal): quiz,
 * roleta, loja e os produtos dela cabem com folga.
 */
export const FUNNEL_PAGE_LIMIT = 40;
export const FUNNEL_LIMIT_MESSAGE = `Cada oferta pode ter no máximo ${FUNNEL_PAGE_LIMIT} páginas de funil.`;
/** Mensagem quando os arquivos de uma clonagem já foram apagados (limpeza automática). */
export const CLONE_FILES_GONE =
  "Os arquivos desta clonagem foram apagados para liberar espaço. Clone a página de novo.";

/**
 * ZIP e HTML colado sem link de origem são abertos num endereço interno
 * (http://importado.offerstudio/…, http://colado.offerstudio/…). Esse endereço
 * não existe na internet: nunca pode virar link, "página original" ou funil.
 */
export function isVirtualCloneUrl(url: string | null | undefined) {
  // Mesma regra do clonador (synthetic.ts), inclusive com ponto final no host.
  return isSyntheticOrigin(url);
}

/** Página sem <title> importada de ZIP/HTML: o clonador usa o domínio interno como título. */
export function isVirtualTitle(title: string | null | undefined) {
  return Boolean(title && /^(?:[a-z0-9-]+\.)+offerstudio$/i.test(title.trim()));
}

/**
 * Chave para comparar endereços de páginas do funil. Mesma regra das
 * sugestões (funnel.ts): sem #hash e sem parâmetros de rastreamento (utm_*,
 * fbclid, ttclid, _gl…), e aqui também sem "www.", sem barra final, sem
 * index.html e sem diferenciar http/https. `base` resolve links relativos.
 * Devolve null para o que não é página (mailto:, javascript:, lixo).
 */
export function funnelMatchKey(raw: string | null | undefined, base?: string): string | null {
  if (!raw) return null;
  const clean = cleanUrl(raw, base);
  if (!clean) return null;
  const u = new URL(clean);
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  let path = u.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // %-encoding inválido: compara como veio.
  }
  path =
    path
      .replace(/\/index\.(?:html?|php)$/i, "/")
      .replace(/\/+$/, "")
      .toLowerCase() || "/";
  const params = [...u.searchParams].sort(([a], [b]) => a.localeCompare(b));
  const search = params.length ? `?${new URLSearchParams(params).toString()}` : "";
  return `${u.host.toLowerCase().replace(/^www\./, "")}${path}${search}`;
}

/** Clonagem que pode ser salva: pronta para revisar, ou salva numa oferta que foi excluída de vez. */
function isSaveable(job: { status: CloneJobStatus; offerId: string | null }) {
  return job.status === "REVIEW" || (job.status === "SAVED" && !job.offerId);
}
const SAVEABLE_WHERE = {
  OR: [{ status: "REVIEW" as const }, { status: "SAVED" as const, offerId: null }],
} satisfies Prisma.CloneJobWhereInput;

/** Aceita "site.com/x" e completa com https://. */
export function normalizeCloneUrl(raw: string) {
  let value = raw.trim();
  if (!value) throw new UserError("Cole o link da página que você quer clonar.", "url");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new UserError("Esse link não parece válido. Copie o endereço completo da barra do navegador.", "url");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new UserError("Use um link que comece com http:// ou https://", "url");
  }
  if (!u.hostname.includes(".") && u.hostname !== "localhost") {
    throw new UserError("Esse link não parece válido. Confira o domínio.", "url");
  }
  if (isVirtualCloneUrl(u.href)) {
    throw new UserError(
      "Esse endereço é de um arquivo importado (ZIP ou HTML colado) e não existe na internet. Para clonar essa página, importe o arquivo dela.",
      "url",
    );
  }
  u.hash = "";
  return u.href;
}

export async function startUrlClone(rawUrl: string, options: StartOptions, parentJobId?: string) {
  const url = normalizeCloneUrl(rawUrl);
  return prisma.cloneJob.create({
    data: {
      source: "URL",
      sourceUrl: url,
      options: { devices: options.devices, maxVideoMb: options.maxVideoMb, funnel: options.funnel === true },
      parentJobId: parentJobId ?? null,
    },
    select: { id: true },
  });
}

export async function startHtmlClone(html: string, baseUrl: string | null, options: StartOptions) {
  if (!html.trim()) throw new UserError("Cole o código HTML da página.", "html");
  if (!/<(html|body|head|div|section|main|p|img)\b/i.test(html)) {
    throw new UserError("Isso não parece HTML. Copie o código-fonte completo da página.", "html");
  }
  const pastedBaseUrl = baseUrl ? normalizeCloneUrl(baseUrl) : undefined;
  const uploadKey = `uploads/${randomUUID()}.html`;
  await putObject(uploadKey, html);
  try {
    return await prisma.cloneJob.create({
      data: { source: "HTML", sourceUrl: pastedBaseUrl ?? null, uploadKey, options: { ...options, pastedBaseUrl } },
      select: { id: true },
    });
  } catch (err) {
    // Sem clonagem, o HTML guardado não serve para nada.
    await deleteObject(uploadKey).catch(() => {});
    throw err;
  }
}

export async function startZipClone(uploadKey: string, fileName: string, options: StartOptions) {
  return prisma.cloneJob.create({
    data: { source: "ZIP", uploadKey, options: { ...options, fileName: fileName.slice(0, 300) } },
    select: { id: true },
  });
}

export async function cancelClone(jobId: string) {
  const { count } = await prisma.cloneJob.updateMany({
    where: { id: jobId, status: { in: ["QUEUED", "RUNNING"] } },
    data: { status: "CANCELED", finishedAt: new Date() },
  });
  // Cancela também as páginas do funil que ainda estão na fila.
  await prisma.cloneJob.updateMany({
    where: { parentJobId: jobId, status: { in: ["QUEUED", "RUNNING"] } },
    data: { status: "CANCELED", finishedAt: new Date() },
  });
  return count > 0;
}

/** Nova tentativa com a mesma fonte e as mesmas opções. */
export async function retryClone(jobId: string) {
  const job = await prisma.cloneJob.findUnique({ where: { id: jobId } });
  if (!job) throw new UserError("Clonagem não encontrada.");
  // Página do funil: entra de novo pela clonagem principal (mesmas regras de
  // repetição e de limite) e a tela volta para a revisão dela.
  if (job.parentJobId && job.sourceUrl) {
    await startFunnelClones(job.parentJobId, [job.sourceUrl], { from: job.id });
    return { id: job.parentJobId };
  }
  if (job.uploadKey && !objectExists(job.uploadKey)) {
    throw new UserError(
      job.source === "ZIP"
        ? "O ZIP desta clonagem foi apagado para liberar espaço. Envie o arquivo de novo pela aba “Arquivo ZIP”."
        : "O HTML desta clonagem foi apagado para liberar espaço. Cole o código de novo pela aba “Colar HTML”.",
    );
  }
  return prisma.cloneJob.create({
    data: {
      source: job.source,
      sourceUrl: job.sourceUrl,
      uploadKey: job.uploadKey,
      options: job.options ?? {},
      parentJobId: job.parentJobId,
    },
    select: { id: true },
  });
}

/**
 * Clona páginas do funil (upsell, downsell, obrigado, ou coladas) ligadas a
 * uma clonagem. `retry.from`: nova tentativa de uma página do funil — a nova
 * fica no mesmo lugar do mapa (de qual página veio, nível, botão).
 */
export async function startFunnelClones(parentJobId: string, urls: string[], retry?: { from: string }) {
  // Links inválidos aparecem antes de qualquer página entrar na fila.
  const wanted = urls.map((raw) => normalizeCloneUrl(raw));
  return prisma.$transaction(async (tx) => {
    // Trava a clonagem principal: dois pedidos ao mesmo tempo (duas abas, clique
    // duplo) não criam a mesma página duas vezes nem passam do limite.
    await tx.$queryRaw`select id from "CloneJob" where id = ${parentJobId} for update`;
    const parent = await tx.cloneJob.findUnique({
      where: { id: parentJobId },
      select: { status: true, offerId: true, options: true, sourceUrl: true, result: true },
    });
    if (!parent || !isSaveable(parent)) throw new UserError("A clonagem principal não está pronta.");
    const existing = await tx.cloneJob.findMany({
      where: { parentJobId, status: { notIn: ["CANCELED", "FAILED"] } },
      select: { sourceUrl: true },
    });
    // A própria página principal e as páginas já clonadas (com ou sem barra
    // final, index.html, utm_*…) não entram de novo.
    const already = new Set<string>();
    for (const u of [
      parent.sourceUrl,
      (parent.result as CloneResult | null)?.finalUrl,
      ...existing.map((e) => e.sourceUrl),
    ]) {
      const key = funnelMatchKey(u);
      if (key) already.add(key);
    }
    const toCreate: string[] = [];
    for (const url of wanted) {
      const key = funnelMatchKey(url) ?? url;
      if (already.has(key)) continue;
      already.add(key);
      toCreate.push(url);
    }
    if (existing.length + toCreate.length > FUNNEL_PAGE_LIMIT) {
      const left = Math.max(0, FUNNEL_PAGE_LIMIT - existing.length);
      throw new UserError(
        left
          ? `${FUNNEL_LIMIT_MESSAGE} Você ainda pode adicionar ${left === 1 ? "1 página" : `${left} páginas`}.`
          : `${FUNNEL_LIMIT_MESSAGE} Esta clonagem já chegou ao limite.`,
      );
    }
    const options = (parent.options ?? {}) as unknown as StartOptions;
    // Nova tentativa: herda o lugar no funil da tentativa anterior.
    const previous = retry
      ? await tx.cloneJob.findFirst({ where: { id: retry.from, parentJobId }, select: { options: true } })
      : null;
    const inherited = (previous?.options as { step?: unknown } | null)?.step;
    const created: string[] = [];
    for (const url of toCreate) {
      const job = await tx.cloneJob.create({
        data: {
          source: "URL",
          sourceUrl: url,
          options: {
            devices: options.devices ?? ["desktop", "mobile"],
            maxVideoMb: options.maxVideoMb ?? 200,
            // Funil inteiro: a página colada também segue para as próximas.
            ...(options.funnel ? { funnel: true } : {}),
            step: (inherited ?? {
              from: parentJobId,
              depth: 1,
              label: "",
              via: "manual",
              order: created.length,
            }) as Prisma.InputJsonValue,
          },
          parentJobId,
        },
        select: { id: true },
      });
      created.push(job.id);
    }
    return created;
  });
}

const LOG_PAGE = 200;

/** Clonagem rodando sem nenhum sinal (progresso ou linha no log) há mais que isso: a tela avisa que pode ter travado. */
export const CLONE_STALL_MS = 3 * 60_000;

/**
 * Para a tela de progresso, enquanto a clonagem espera ou roda: o robô de
 * tarefas está vivo? Há outra clonagem rodando na frente desta (na fila)? Esta
 * está parada há mais de CLONE_STALL_MS (rodando)?
 */
async function queueInfo(
  job: { id: string; status: CloneJobStatus; updatedAt: Date },
  now: number,
): Promise<{ workerOnline: boolean | null; otherRunning: boolean; stalled: boolean }> {
  if (job.status !== "QUEUED" && job.status !== "RUNNING") {
    return { workerOnline: null, otherRunning: false, stalled: false };
  }
  const [workerOnline, others, lastLog] = await Promise.all([
    isWorkerOnline(now),
    job.status === "QUEUED" ? prisma.cloneJob.count({ where: { status: "RUNNING", id: { not: job.id } } }) : 0,
    job.status === "RUNNING"
      ? prisma.cloneLog.findFirst({ where: { jobId: job.id }, orderBy: { id: "desc" }, select: { at: true } })
      : null,
  ]);
  const lastSign = Math.max(job.updatedAt.getTime(), lastLog?.at.getTime() ?? 0);
  return {
    // Clonagem que acabou de avançar prova que o robô está vivo (o sinal de vida
    // dele pode atrasar enquanto ele processa uma página pesada).
    workerOnline: workerOnline || (job.status === "RUNNING" && now - lastSign < WORKER_SILENT_MS),
    otherRunning: others > 0,
    stalled: job.status === "RUNNING" && now - lastSign > CLONE_STALL_MS,
  };
}

/**
 * Progresso para a tela (polling). `tail`: as últimas linhas do log (tela de
 * falha, que mostra o fim — onde está o erro — e não consulta de novo).
 * Na fila ou rodando, diz também se o robô está vivo (`workerOnline`; null nos
 * outros estados), se outra clonagem está na frente (`otherRunning`) e se esta
 * parou de avançar (`stalled`).
 */
export async function getCloneStatus(jobId: string, afterLogId = 0, opts: { tail?: boolean; now?: number } = {}) {
  const job = await prisma.cloneJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      status: true,
      progress: true,
      step: true,
      errorMessage: true,
      sourceUrl: true,
      offerId: true,
      updatedAt: true,
      logs: opts.tail
        ? { orderBy: { id: "desc" }, take: LOG_PAGE }
        : { where: { id: { gt: afterLogId } }, orderBy: { id: "asc" }, take: LOG_PAGE },
    },
  });
  if (!job) return null;
  const children = await funnelChildren(job.id);
  const logs = opts.tail ? [...job.logs].reverse() : job.logs;
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    step: job.step,
    errorMessage: job.errorMessage,
    offerId: job.offerId,
    ...(await queueInfo(job, opts.now ?? Date.now())),
    logs: logs.map((l) => ({ id: l.id, at: l.at.toISOString(), level: l.level, message: l.message, url: l.url })),
    children,
  };
}

/** Linha das páginas do funil lida direto do JSON (o resultado inteiro tem a lista de arquivos: pesado a cada 2 s). */
interface ChildRow {
  id: string;
  status: CloneJobStatus;
  progress: number;
  step: string | null;
  sourceUrl: string | null;
  errorMessage: string | null;
  errorCode: string | null;
  options: unknown;
  title: string | null;
  finalUrl: string | null;
  page: FunnelPageInfo | null;
  suggestedMode: CloneModeValue | null;
  thumbnailKey: string | null;
  desktop: boolean;
  mobile: boolean;
  checkouts: number;
  checkoutPlatform: string | null;
  exploreStop: string | null;
}

/** Páginas do funil de uma clonagem, para a tela (polling) e o mapa do funil. */
async function funnelChildren(jobId: string) {
  const rows = await prisma.$queryRaw<ChildRow[]>`
    select id, status::text as status, progress, step, "sourceUrl", "errorMessage", "errorCode", options,
      result->>'title' as title,
      result->>'finalUrl' as "finalUrl",
      result->'page' as page,
      result->>'suggestedMode' as "suggestedMode",
      result->>'thumbnailKey' as "thumbnailKey",
      coalesce(result->'devices' ? 'desktop', false) as desktop,
      coalesce(result->'devices' ? 'mobile', false) as mobile,
      coalesce(jsonb_array_length(case when jsonb_typeof(result->'checkouts') = 'array' then result->'checkouts' end), 0)::int as checkouts,
      result->'checkouts'->0->>'platform' as "checkoutPlatform",
      result->'explored'->>'stop' as "exploreStop"
    from "CloneJob" where "parentJobId" = ${jobId} order by "createdAt" asc, id asc`;
  return rows.map((c) => {
    type RawStep = {
      from?: unknown;
      depth?: unknown;
      order?: unknown;
      label?: unknown;
      via?: unknown;
      product?: unknown;
    };
    const step = (c.options as { step?: RawStep } | null)?.step;
    return {
      id: c.id,
      status: c.status,
      progress: c.progress,
      step: c.step,
      sourceUrl: c.sourceUrl,
      errorMessage: c.errorMessage,
      title: c.title,
      /** Versões que existem na cópia (a prévia abre uma delas). */
      devices: (["desktop", "mobile"] as const).filter((d): d is Device => (d === "desktop" ? c.desktop : c.mobile)),
      /** Para reconhecer a sugestão de funil correspondente. */
      matchKey: funnelMatchKey(c.sourceUrl),
      /** Mapa do funil: de qual página veio, nível, texto do botão/link e como foi achada. */
      from: typeof step?.from === "string" ? step.from : jobId,
      depth: typeof step?.depth === "number" ? step.depth : 1,
      order: typeof step?.order === "number" ? step.order : 0,
      via: typeof step?.via === "string" ? step.via : "manual",
      linkLabel: typeof step?.label === "string" ? step.label : "",
      /** Veio de um cartão de produto da loja. */
      product: step?.product === true,
      /** Tipo e nome da página no funil (quiz, roleta, loja, produto…). */
      kind: c.page?.kind ?? null,
      name: c.page?.name ?? "",
      finalKey: funnelMatchKey(c.finalUrl),
      suggestedMode: c.suggestedMode,
      thumbnailKey: c.thumbnailKey,
      /** Abriu a mesma página de outra (redirecionamento): fora do mapa. */
      duplicate: c.errorCode === "DUPLICATE",
      /** Botões de checkout na página (o mapa mostra "→ Checkout"). */
      checkouts: c.checkouts,
      checkoutPlatform: c.checkoutPlatform,
      /** Por que o robô parou de clicar ("contact": a etapa pede e-mail/telefone). */
      exploreStop: c.exploreStop,
    };
  });
}

export type CloneStatus = NonNullable<Awaited<ReturnType<typeof getCloneStatus>>>;

// ─── Salvar ──────────────────────────────────────────────────────────────────

export interface SaveCloneInput {
  jobId: string;
  name: string;
  folderId: string | null;
  mode: CloneModeValue;
  /** Índices de result.removed que o usuário quer manter, por job: "jobId:índice". */
  keepRemoved: string[];
  /** Clonagens do funil (filhas) que entram como páginas. */
  childJobIds: string[];
  /**
   * Modo de cada página (id da clonagem → modo): no funil, quiz e roleta
   * costumam ir "Com scripts" e a loja/produtos "Editável". Sem a página
   * aqui, vale `mode`.
   */
  modes?: Record<string, CloneModeValue>;
  /**
   * Moeda em que a oferta vai rodar: fica nas configurações (vale para o que
   * for criado depois: as páginas clonadas ficam como vieram) e vem marcada na
   * próxima oferta. Sem ela: real (e a última escolhida não muda).
   */
  currency?: StoreCurrency;
}

function guessMainType(result: CloneResult): PageType {
  if (result.videos.some((v) => v.provider !== "NATIVE") || result.delay) return "VSL";
  return "SALES";
}

function funnelType(kind: FunnelSuggestion["kind"] | undefined): PageType {
  if (kind === "UPSELL") return "UPSELL";
  if (kind === "DOWNSELL") return "DOWNSELL";
  if (kind === "THANK_YOU") return "THANK_YOU";
  return "OTHER";
}

/** Tipo da página na oferta pelo tipo no funil (roleta e loja: "Outra", como os modelos; produto: vendas). */
const PAGE_TYPE_BY_KIND: Record<FunnelPageKind, PageType> = {
  QUIZ: "QUIZ",
  WHEEL: "OTHER",
  STORE: "OTHER",
  PRODUCT: "SALES",
  VSL: "VSL",
  SALES: "SALES",
  CAPTURE: "CAPTURE",
  UPSELL: "UPSELL",
  DOWNSELL: "DOWNSELL",
  THANK_YOU: "THANK_YOU",
  OTHER: "OTHER",
};

/** Nível no funil, ordem em que foi achada e texto do botão que leva à página (clonar o funil inteiro). */
function funnelStepOf(options: unknown): { depth: number; order: number; label: string } {
  const step = (options as { step?: { depth?: unknown; order?: unknown; label?: unknown } } | null)?.step;
  return {
    depth: typeof step?.depth === "number" ? step.depth : 1,
    order: typeof step?.order === "number" ? step.order : 0,
    label: typeof step?.label === "string" ? step.label : "",
  };
}

/**
 * Recoloca rastreadores que o usuário decidiu manter. O trecho entra por uma
 * função: como texto de substituição, "$'", "$&" ou "$$" dentro do código do
 * pixel (ex.: 'R$') seriam interpretados e corromperiam a página.
 */
export function restoreSnippets(html: string, snippets: { snippet: string; location: "head" | "body" }[]) {
  let out = html;
  for (const { snippet, location } of snippets) {
    if (!snippet) continue;
    if (location === "head" && /<\/head>/i.test(out)) out = out.replace(/<\/head>/i, () => `${snippet}\n</head>`);
    else if (/<\/body>(?![\s\S]*<\/body>)/i.test(out))
      out = out.replace(/<\/body>(?![\s\S]*<\/body>)/i, () => `${snippet}\n</body>`);
    else out += snippet;
  }
  return out;
}

/**
 * Rastreadores mantidos que esperam o consentimento vão para os códigos da
 * página (Page.customCode, categoria "Marketing"): no HTML da página eles
 * carregariam antes do "Aceitar" do aviso de cookies. null = nenhum.
 */
export function keptPageCode(snippets: { snippet: string; location: "head" | "body" }[]) {
  if (!snippets.length) return null;
  const join = (where: "head" | "body") =>
    snippets
      .filter((x) => x.location === where)
      .map((x) => x.snippet.trim())
      .join("\n");
  return { head: join("head"), bodyStart: "", bodyEnd: join("body"), category: "MARKETING" as const };
}

/** Tem esquema (https:, mailto:, os-page:…), é âncora/consulta da própria página ou é protocolo-relativo. */
const NOT_RELATIVE_PAGE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\?)/i;

export interface PageLinkOptions {
  /** Endereço da página clonada: resolve os links relativos. */
  pageUrl: string;
  /**
   * Modo "Preservar JS": o HTML guarda os links relativos do site original
   * ("/politica", "obrigado.html"). Os que não são páginas do funil nem
   * arquivos da cópia (assetMap) passam a apontar para o site original, como
   * no modo Editável — senão levariam a uma página inexistente na cópia.
   */
  assetMap?: Record<string, string> | null;
}

/**
 * Links para outras páginas clonadas do mesmo funil viram os-page:<id>. Links
 * relativos (comuns no modo "Preservar JS") são resolvidos pelo endereço da
 * página antes de comparar.
 */
export function linkFunnelPages(html: string, targets: Map<string, string>, opts: PageLinkOptions) {
  const base = isVirtualCloneUrl(opts.pageUrl) ? null : opts.pageUrl;
  const absolutize = Boolean(opts.assetMap && base);
  if (!base || (!targets.size && !absolutize)) return html;
  const $ = cheerio.load(html);
  let changed = false;
  $("a[href], area[href], [data-os-href]").each((_, el) => {
    for (const attr of ["href", "data-os-href"]) {
      const value = $(el).attr(attr)?.trim();
      if (!value) continue;
      const pageId = targets.get(funnelMatchKey(value, base) ?? "");
      if (pageId) {
        $(el).attr(attr, internalLink(pageId));
        changed = true;
        continue;
      }
      if (!absolutize || attr !== "href" || NOT_RELATIVE_PAGE.test(value) || value.startsWith("/os-assets/")) continue;
      let abs: URL;
      try {
        abs = new URL(value, base);
      } catch {
        continue;
      }
      const local = opts.assetMap?.[`${abs.pathname}${abs.search}`] ?? opts.assetMap?.[abs.pathname];
      if (local) continue;
      $(el).attr(attr, abs.href);
      changed = true;
    }
  });
  // O cheerio troca qualquer doctype por <!DOCTYPE html> (tiraria páginas antigas do modo quirks).
  return changed ? restoreDoctype($.html(), html) : html;
}

/**
 * Salva a clonagem revisada como uma oferta nova: uma página por clonagem
 * (principal + funil), com documentos desktop/celular quando o site separa as
 * versões, rastreadores removidos, checkouts e arquivos.
 */
export async function saveClone(input: SaveCloneInput) {
  const main = await prisma.cloneJob.findUnique({
    where: { id: input.jobId },
    include: { offer: { select: { deletedAt: true } } },
  });
  if (!main) throw new UserError("Clonagem não encontrada.");
  if (main.status === "SAVED" && main.offerId) {
    throw new UserError(
      main.offer?.deletedAt
        ? "Esta clonagem já foi salva como oferta, que está na lixeira. Restaure a oferta pela Lixeira."
        : "Esta clonagem já foi salva como oferta.",
    );
  }
  if (!isSaveable(main)) throw new UserError("A clonagem ainda não está pronta para salvar.");
  if (input.childJobIds.length > FUNNEL_PAGE_LIMIT) throw new UserError(FUNNEL_LIMIT_MESSAGE);
  const children = input.childJobIds.length
    ? await prisma.cloneJob.findMany({
        where: { id: { in: input.childJobIds }, parentJobId: main.id, ...SAVEABLE_WHERE },
        orderBy: { createdAt: "asc" },
      })
    : [];
  // Sugestão de funil (tipo e nome) de cada página, pela mesma regra de endereço.
  const suggestionByKey = new Map<string, FunnelSuggestion>();
  for (const f of (main.result as unknown as CloneResult | null)?.funnel ?? []) {
    const key = funnelMatchKey(f.url);
    if (key && !suggestionByKey.has(key)) suggestionByKey.set(key, f);
  }
  const suggestionFor = (url: string | null) => suggestionByKey.get(funnelMatchKey(url) ?? "");
  // Ordem natural do funil: por nível (quiz → roleta → loja → produtos) e, no mesmo
  // nível, upsell → downsell → outras → obrigado, na ordem em que foram achadas.
  const rank = (url: string | null) => {
    const kind = suggestionFor(url)?.kind;
    return kind === "UPSELL" ? 0 : kind === "DOWNSELL" ? 1 : kind === "THANK_YOU" ? 3 : 2;
  };
  children.sort(
    (a, b) =>
      funnelStepOf(a.options).depth - funnelStepOf(b.options).depth ||
      rank(a.sourceUrl) - rank(b.sourceUrl) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      funnelStepOf(a.options).order - funnelStepOf(b.options).order,
  );
  const jobs = [main, ...children];
  const results = new Map(jobs.map((j) => [j.id, j.result as unknown as CloneResult]));
  const mainResult = results.get(main.id) as CloneResult;
  const modeOf = (jobId: string): CloneModeValue => input.modes?.[jobId] ?? input.mode;
  if (input.folderId) {
    const folder = await prisma.folder.count({ where: { id: input.folderId } });
    if (!folder) throw new UserError("A pasta escolhida não existe mais.", "folderId");
  }

  // Lê os HTMLs escolhidos antes da transação (arquivos no disco).
  // "Preservar JS" guarda também a cópia editável (para "Converter para editável").
  type SavedHtml = {
    device: "ALL" | "DESKTOP" | "MOBILE";
    html: string;
    assetMap: Record<string, string> | null;
    editableHtml: string | null;
  };
  const htmlByJob = new Map<string, SavedHtml[]>();
  for (const job of jobs) {
    const r = results.get(job.id) as CloneResult;
    const entries: SavedHtml[] = [];
    const devicesToSave: ["ALL" | "DESKTOP" | "MOBILE", "desktop" | "mobile"][] = r.responsive
      ? [["ALL", r.devices.desktop ? "desktop" : "mobile"]]
      : [
          ["DESKTOP", "desktop"],
          ["MOBILE", "mobile"],
        ];
    const mode = modeOf(job.id);
    for (const [docDevice, source] of devicesToSave) {
      const out = r.devices?.[source]?.outputs[mode];
      if (!out) continue;
      // Arquivos apagados pela limpeza automática (clonagem antiga).
      if (!objectExists(out.htmlKey)) throw new UserError(CLONE_FILES_GONE);
      const html = (await getObject(out.htmlKey)).toString("utf8");
      const editable = mode === "PRESERVE_JS" ? r.devices?.[source]?.outputs.EDITABLE : undefined;
      const editableHtml =
        editable && objectExists(editable.htmlKey) ? (await getObject(editable.htmlKey)).toString("utf8") : null;
      entries.push({ device: docDevice, html, assetMap: "assetMap" in out ? out.assetMap : null, editableHtml });
    }
    if (!entries.length) throw new UserError(CLONE_FILES_GONE);
    htmlByJob.set(job.id, entries);
  }

  const keep = new Set(input.keepRemoved);

  // Cada checkout detectado vira um "link da oferta" (a URL fica a original até
  // você trocar pela sua em "Links e checkouts"; todos os botões acompanham).
  const linkPlan = new Map<string, { key: string; label: string; kind: "CHECKOUT" | "UPSELL" | "DOWNSELL" }>();
  const labelCount = new Map<string, number>();
  for (const [index, job] of jobs.entries()) {
    const r = results.get(job.id) as CloneResult;
    const suggestion = index === 0 ? undefined : suggestionFor(job.sourceUrl);
    const funnelKind = suggestion?.kind ?? (index === 0 ? undefined : r.page?.kind);
    const kind = funnelKind === "UPSELL" ? "UPSELL" : funnelKind === "DOWNSELL" ? "DOWNSELL" : "CHECKOUT";
    for (const c of r.checkouts) {
      if (linkPlan.has(c.url)) continue;
      const base =
        kind === "UPSELL"
          ? "Checkout do upsell"
          : kind === "DOWNSELL"
            ? "Checkout do downsell"
            : `Checkout ${c.platform === "Desconhecida" ? "" : c.platform}`.trim();
      const n = (labelCount.get(base) ?? 0) + 1;
      labelCount.set(base, n);
      const label = n > 1 ? `${base} ${n}` : base;
      linkPlan.set(c.url, {
        key: linkKey(
          label,
          [...linkPlan.values()].map((l) => l.key),
        ),
        label,
        kind,
      });
    }
  }
  const bindLinks = (html: string, urls: string[]) => {
    let out = html;
    for (const url of urls) {
      const plan = linkPlan.get(url);
      if (plan) out = bindUrlToLink(out, url, plan.key).html;
    }
    // bindUrlToLink monta com o cheerio, que troca qualquer doctype por <!DOCTYPE html>.
    return out === html ? html : restoreDoctype(out, html);
  };

  return prisma.$transaction(
    async (tx) => {
      // Reserva a clonagem antes de criar qualquer coisa: um segundo "Salvar"
      // (outra aba) espera esta transação e depois não encontra mais a clonagem
      // disponível — nada de duas ofertas iguais.
      const claimed = await tx.cloneJob.updateMany({
        where: { id: main.id, ...SAVEABLE_WHERE },
        data: { status: "SAVED" },
      });
      if (!claimed.count) throw new UserError("Esta clonagem já foi salva como oferta.");

      const offer = await tx.offer.create({
        data: {
          name: input.name,
          folderId: input.folderId,
          // ZIP e HTML colado sem link não têm "página original".
          sourceUrl: main.sourceUrl ?? (isVirtualCloneUrl(mainResult.finalUrl) ? null : mainResult.finalUrl) ?? null,
          thumbnailKey: mainResult.thumbnailKey ?? null,
          ...(input.currency ? { settings: { currency: input.currency } } : {}),
        },
        select: { id: true },
      });
      // A moeda escolhida vem marcada na próxima oferta (clonada ou nova).
      if (input.currency) await rememberOfferCurrency(input.currency, tx);

      // 1ª passada: páginas (para conhecer os IDs e ligar o funil).
      const takenSlugs: string[] = [];
      const pageIds = new Map<string, string>();
      const urlTargets = new Map<string, string>();
      for (const [index, job] of jobs.entries()) {
        const r = results.get(job.id) as CloneResult;
        const isMain = index === 0;
        const suggestion = suggestionFor(job.sourceUrl);
        const virtual = isVirtualCloneUrl(r.finalUrl);
        const pathSlug = (() => {
          try {
            const segs = new URL(r.finalUrl).pathname.split("/").filter(Boolean);
            return slugify(segs.at(-1) ?? "");
          } catch {
            return "";
          }
        })();
        const slug = uniqueSlug(
          isMain ? "principal" : pathSlug || suggestion?.kind?.toLowerCase() || "pagina",
          takenSlugs,
        );
        takenSlugs.push(slug);
        // Sem <title>, o clonador usa o domínio; o domínio interno não é um nome.
        const title = isVirtualTitle(r.title) ? "" : r.title;
        // Funil inteiro: "Roleta", "Loja", o nome do produto… (num site-aplicativo
        // todas as páginas têm o mesmo título; aí vale o texto do botão que leva a ela).
        const mainTitle = isVirtualTitle(mainResult.title) ? "" : mainResult.title;
        const ownTitle = title && title !== mainTitle ? title : "";
        const name = isMain
          ? title || "Página principal"
          : r.page?.name ||
            ownTitle ||
            funnelStepOf(job.options).label ||
            suggestion?.label ||
            title ||
            `Página ${index + 1}`;
        const pageKind = r.page && r.page.kind !== "OTHER" ? PAGE_TYPE_BY_KIND[r.page.kind] : null;
        const page = await tx.page.create({
          data: {
            offerId: offer.id,
            name: name.slice(0, 120),
            slug,
            type: isMain
              ? r.page && !["OTHER", "SALES", "VSL"].includes(r.page.kind)
                ? PAGE_TYPE_BY_KIND[r.page.kind]
                : guessMainType(r)
              : suggestion
                ? funnelType(suggestion.kind)
                : (pageKind ?? "OTHER"),
            position: index,
            isHome: isMain,
            cloneMode: modeOf(job.id),
            sourceUrl: virtual ? (job.sourceUrl ?? null) : r.finalUrl,
          },
          select: { id: true },
        });
        pageIds.set(job.id, page.id);
        for (const u of [r.finalUrl, job.sourceUrl]) {
          const key = isVirtualCloneUrl(u) ? null : funnelMatchKey(u);
          if (key) urlTargets.set(key, page.id);
        }
      }

      // 2ª passada: documentos, rastreadores, checkouts.
      for (const job of jobs) {
        const r = results.get(job.id) as CloneResult;
        const pageId = pageIds.get(job.id) as string;
        const kept = r.removed
          .map((item, i) => ({ item, kept: keep.has(`${job.id}:${i}`) }))
          .filter((x) => x.kept && x.item.snippet);
        // Pixels mantidos esperam o "Aceitar" (códigos da página); chats voltam ao HTML.
        const toSnippet = (k: (typeof kept)[number]) => ({ snippet: k.item.snippet, location: k.item.location });
        const keptCode = keptPageCode(kept.filter((k) => keptNeedsConsent(k.item)).map(toSnippet));
        const keptHtml = kept.filter((k) => !keptNeedsConsent(k.item)).map(toSnippet);
        const ownTargets = new Map([...urlTargets].filter(([, id]) => id !== pageId));
        const finish = (html: string, assetMap: Record<string, string> | null) => {
          const out = bindLinks(
            linkFunnelPages(restoreSnippets(html, keptHtml), ownTargets, { pageUrl: r.finalUrl, assetMap }),
            r.checkouts.map((c) => c.url),
          );
          // "Com scripts" (o HTML com assetMap; a cópia editável não): os endereços completos das
          // páginas salvas juntas, nos scripts inline, viram o caminho original ("/roleta") — sem a
          // API Navigation (Safari), location.href = "https://site.com/roleta" sairia da cópia.
          if (!assetMap) return out;
          const urls = jobs.flatMap((j) => [results.get(j.id)?.finalUrl, j.sourceUrl]);
          return rewriteScriptPageUrls(
            out,
            urls.filter((u): u is string => !!u && !isVirtualCloneUrl(u)).map((url) => ({ url })),
          );
        };
        const docs = (htmlByJob.get(job.id) ?? []).map((d) => ({
          device: d.device,
          html: finish(d.html, d.assetMap),
          assetMap: (d.assetMap ?? undefined) as Prisma.InputJsonValue | undefined,
          editableHtml: d.editableHtml === null ? null : finish(d.editableHtml, null),
        }));
        await tx.pageVariant.create({
          data: { pageId, name: "A", isControl: true, weight: 100, documents: { create: docs } },
        });
        if (keptCode) await tx.page.update({ where: { id: pageId }, data: { customCode: keptCode } });
        if (r.removed.length) {
          await tx.removedItem.createMany({
            data: r.removed.map((item, i) => ({
              jobId: job.id,
              pageId,
              vendor: item.vendor,
              category: item.category,
              pixelId: item.pixelId ?? null,
              snippet: item.snippet ?? "",
              location: item.location,
              restored: keep.has(`${job.id}:${i}`),
            })),
          });
        }
        if (r.checkouts.length) {
          await tx.checkoutLink.createMany({
            data: r.checkouts.map((c) => ({
              jobId: job.id,
              pageId,
              platform: c.platform,
              url: c.url,
              label: c.label ?? null,
              source: c.source,
              confidence: c.confidence,
            })),
          });
        }
        if (r.assets?.length) {
          await tx.asset.createMany({
            data: r.assets.map((a) => ({
              offerId: offer.id,
              sha256: a.sha256,
              key: a.key,
              kind: a.kind,
              mime: a.mime,
              bytes: a.bytes,
              sourceUrl: a.sourceUrl.slice(0, 2000),
            })),
            skipDuplicates: true,
          });
        }
      }

      if (linkPlan.size) {
        await tx.offerLink.createMany({
          data: [...linkPlan.entries()].map(([url, plan], position) => ({
            offerId: offer.id,
            key: plan.key,
            label: plan.label.slice(0, 60),
            url,
            kind: plan.kind,
            position,
          })),
        });
      }

      await tx.cloneJob.update({ where: { id: main.id }, data: { offerId: offer.id } });
      if (children.length) {
        await tx.cloneJob.updateMany({
          where: { id: { in: children.map((c) => c.id) }, ...SAVEABLE_WHERE },
          data: { status: "SAVED", offerId: offer.id },
        });
      }
      return offer;
    },
    // Um funil inteiro (até 40 páginas, cada uma com computador e celular) grava bastante.
    { timeout: 180_000 },
  );
}
