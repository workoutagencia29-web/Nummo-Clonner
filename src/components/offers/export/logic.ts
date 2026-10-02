/**
 * Regras da tela "Baixar ZIP" (sem React, testáveis): árvore "O que vai no ZIP"
 * de acordo com as opções, etapa do diálogo, tamanhos em português, resumo das
 * opções de um ZIP anterior e o ritmo das leituras de progresso.
 */
import {
  EXPORT_STATUS_LABEL,
  EXPORTS_KEPT_PER_OFFER,
  type ExportOptions,
  ExportOptionsSchema,
  type ExportPlan,
  type ExportView,
  type ServerEventVendor,
  serverEventsTreeLabel,
} from "@/lib/export/options";
import { EVENTOS_CONFIG_FILE, EVENTOS_FILE, HTACCESS_FILE } from "@/lib/export/php";

export type TreeEntry = ExportPlan["tree"][number];
export type TreeKind = TreeEntry["kind"];

/** Uma linha da árvore mostrada no diálogo. */
export interface TreeRow {
  /** Caminho normalizado (pastas terminam em "/"; "pasta/index.html" vira "pasta/"). */
  path: string;
  /** O que aparece na linha: o último pedaço do caminho ("oferta-b/", "LEIA-ME.txt"). */
  name: string;
  depth: number;
  /** "folder" = pasta que só existe porque tem algo dentro (sem item próprio no plano). */
  kind: TreeKind | "folder";
  label: string;
  isFolder: boolean;
}

/**
 * Safari (Mac): com “Abrir arquivos ‘seguros’ após o download” (ligado de
 * fábrica), ele descompacta o ZIP baixado e manda o .zip para a Lixeira — e a
 * hospedagem precisa do .zip. Chrome, Edge, Firefox, Opera e os navegadores que
 * só se parecem com o Safari (CriOS, FxiOS…) ficam de fora.
 */
export function isSafariUserAgent(ua: string | null | undefined): boolean {
  if (!ua) return false;
  return (
    /\bSafari\//.test(ua) &&
    /\bVersion\//.test(ua) &&
    !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|Edg\/|OPR\/|Firefox|SamsungBrowser/i.test(ua)
  );
}

/** Rótulo do index.html quando o divisor está desligado e não dá para saber a página (ele passa a ser a versão de controle). */
export const SPLITTER_OFF_LABEL = "Versão de controle (sem divisor)";
export const EVENTS_FILE = EVENTOS_FILE;
export const EVENTS_CONFIG_FILE = EVENTOS_CONFIG_FILE;

/** Rótulos dos arquivos do eventos.php (os mesmos da prévia do servidor, src/server/services/export/plan.ts). */
export const EVENTS_CONFIG_LABEL = "Tokens do eventos.php (não compartilhe)";
export const EVENTS_HTACCESS_LABEL = "Bloqueia a pasta dos tokens (Apache)";

/** Arquivos que o ZIP ganha com a opção do eventos.php, na ordem em que aparecem. */
export const EVENTS_FILES: TreeEntry[] = [
  { path: EVENTOS_FILE, kind: "file", label: serverEventsTreeLabel(null) },
  { path: EVENTOS_CONFIG_FILE, kind: "file", label: EVENTS_CONFIG_LABEL },
  { path: HTACCESS_FILE, kind: "file", label: EVENTS_HTACCESS_LABEL },
];

/** Os arquivos do eventos.php, com as plataformas atendidas no rótulo (como o servidor mostra). */
export function eventsFilesFor(vendors: readonly ServerEventVendor[] | null | undefined): TreeEntry[] {
  const [php, ...rest] = EVENTS_FILES;
  return [{ ...php, label: serverEventsTreeLabel(vendors) }, ...rest];
}

/**
 * Rótulo do index.html de uma página quando o divisor é desligado (antes do
 * plano novo chegar): "Divisor A/B de “Upsell” (A 50% · B 50%)" →
 * "Upsell — versão de controle".
 */
export function splitterOffLabel(splitterLabel: string): string {
  const m = /^Divisor A\/B de “(.+)” \(.*\)$/.exec(splitterLabel.trim());
  return m ? `${m[1]} — versão de controle` : SPLITTER_OFF_LABEL;
}

/**
 * Nome da opção do eventos.php conforme as plataformas com token salvo
 * (só a Meta, só o TikTok ou as duas).
 */
export function serverEventsLabel(vendors: readonly ServerEventVendor[] | null | undefined): string {
  const meta = Boolean(vendors?.includes("META"));
  const tiktok = Boolean(vendors?.includes("TIKTOK"));
  if (meta && !tiktok) return "API de Conversões (Meta)";
  if (tiktok && !meta) return "Events API (TikTok)";
  return "API de Conversões (Meta) e Events API (TikTok)";
}

/** Quem recebe as conversões pelo servidor, para a explicação da opção ("da Meta", "do TikTok"). */
export function serverEventsWho(vendors: readonly ServerEventVendor[] | null | undefined): string {
  const meta = Boolean(vendors?.includes("META"));
  const tiktok = Boolean(vendors?.includes("TIKTOK"));
  if (meta && !tiktok) return "para a Meta";
  if (tiktok && !meta) return "para o TikTok";
  return "para a Meta e o TikTok";
}

/** " · 50%" do fim do rótulo de uma versão (só vale com o divisor ligado). */
const SHARE_SUFFIX = /\s*·\s*\d+(?:[.,]\d+)?\s*%$/;

/** Opções que mudam a árvore (o "HTML otimizado" não muda). */
export type TreeOptions = Pick<ExportOptions, "splitter" | "serverEvents">;

/** Opções com que o plano é pedido (sem token, nunca com o eventos.php). */
export function planOptionsFor(options: TreeOptions, hasServerEventTokens: boolean | undefined): TreeOptions {
  return { splitter: options.splitter, serverEvents: Boolean(options.serverEvents && hasServerEventTokens) };
}

function cleanPath(raw: string) {
  return raw
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^(\.\/|\/)+/, "");
}

/** "oferta-a/index.html" → "oferta-a/" (a pasta É a página); "index.html" e arquivos soltos ficam como estão. */
export function nodePath(raw: string) {
  const p = cleanPath(raw);
  if (p !== "index.html" && p.endsWith("/index.html")) return p.slice(0, -"index.html".length);
  return p;
}

function trimSlash(p: string) {
  return p.endsWith("/") ? p.slice(0, -1) : p;
}

function parentOf(p: string): string | null {
  const t = trimSlash(p);
  const i = t.lastIndexOf("/");
  return i < 0 ? null : t.slice(0, i + 1);
}

function nameOf(p: string) {
  const t = trimSlash(p);
  return t.slice(t.lastIndexOf("/") + 1) + (p.endsWith("/") ? "/" : "");
}

/**
 * Árvore mostrada enquanto o plano das opções novas não chega: o plano vem do
 * servidor para as opções `planFor`; se a pessoa acabou de mudar alguma, ajusta
 * na hora o que dá para prever — sem divisor, o index.html que seria o divisor
 * mostra a versão de controle; o eventos.php (e os arquivos dele) entra ou sai.
 * Com as mesmas opções do plano, devolve a árvore dele como está.
 */
export function treeForOptions(
  plan: Pick<ExportPlan, "tree" | "hasServerEventTokens"> & Partial<Pick<ExportPlan, "serverEventVendors">>,
  options: TreeOptions,
  planFor: TreeOptions = { splitter: true, serverEvents: false },
): TreeEntry[] {
  const want = planOptionsFor(options, plan.hasServerEventTokens);
  const had = planOptionsFor(planFor, plan.hasServerEventTokens);
  const eventsNames = new Set(EVENTS_FILES.map((e) => e.path));
  const isEvents = (e: TreeEntry) => eventsNames.has(nodePath(e.path));
  let entries = plan.tree;
  if (had.splitter && !want.splitter) {
    // Sem divisor, a versão de controle ocupa o index.html e as versões não mostram mais o percentual.
    entries = entries.map((e) =>
      e.kind === "splitter"
        ? { ...e, kind: "page", label: splitterOffLabel(e.label) }
        : e.kind === "variant" && SHARE_SUFFIX.test(e.label)
          ? { ...e, label: e.label.replace(SHARE_SUFFIX, "") }
          : e,
    );
  }
  if (had.serverEvents && !want.serverEvents) entries = entries.filter((e) => !isEvents(e));
  if (!had.serverEvents && want.serverEvents && !entries.some(isEvents)) {
    const files = eventsFilesFor(plan.serverEventVendors);
    const readme = entries.findIndex((e) => /^leia-me/i.test(nodePath(e.path)));
    entries = [...entries];
    if (readme >= 0) entries.splice(readme, 0, ...files);
    else entries.push(...files);
  }
  return entries;
}

/**
 * Avisos do plano que aparecem em "Antes de subir". O aviso de que o eventos.php
 * precisa de PHP já aparece na própria opção (ligada) ou não se aplica (desligada).
 */
export function visiblePlanWarnings(warnings: string[] | null | undefined): string[] {
  return (warnings ?? []).filter((w) => !(/eventos\.php/.test(w) && /\bPHP\b/.test(w)));
}

/**
 * Monta a árvore (pastas antes do conteúdo, na ordem em que o plano lista) e
 * devolve as linhas já com a profundidade. Caminhos repetidos valem uma vez;
 * pastas que só aparecem dentro de um caminho viram linhas "folder".
 */
export function buildTreeRows(entries: TreeEntry[]): TreeRow[] {
  interface Node {
    row: Omit<TreeRow, "depth">;
    children: string[];
  }
  const nodes = new Map<string, Node>();
  const roots: string[] = [];

  const ensure = (path: string, entry?: TreeEntry) => {
    const existing = nodes.get(path);
    if (existing) {
      // Pasta criada antes por causa de um filho: agora ganha o próprio item.
      if (entry && existing.row.kind === "folder")
        existing.row = { ...existing.row, kind: entry.kind, label: entry.label };
      return;
    }
    const parent = parentOf(path);
    if (parent) ensure(parent);
    nodes.set(path, {
      row: {
        path,
        name: nameOf(path),
        kind: entry?.kind ?? "folder",
        label: entry?.label ?? "",
        isFolder: path.endsWith("/"),
      },
      children: [],
    });
    if (parent) nodes.get(parent)?.children.push(path);
    else roots.push(path);
  };

  for (const entry of entries) {
    const path = nodePath(entry.path);
    if (path) ensure(path, entry);
  }

  const rows: TreeRow[] = [];
  const walk = (path: string, depth: number) => {
    const node = nodes.get(path);
    if (!node) return;
    rows.push({ ...node.row, depth });
    for (const child of node.children) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  return rows;
}

/** Tamanho em português: "850 KB", "2,4 MB" (o mesmo da revisão da clonagem). */
export { formatBytes } from "@/lib/format";

/** Opções ligadas de um ZIP, em palavras ("Divisor A/B", "eventos.php", "HTML otimizado"). */
export function optionsSummary(options: Partial<ExportOptions> | null | undefined, hasVariants: boolean): string[] {
  const o = ExportOptionsSchema.parse(options ?? {});
  const out: string[] = [];
  if (hasVariants && o.splitter) out.push("Divisor A/B");
  if (o.serverEvents) out.push(EVENTS_FILE);
  if (o.optimizeHtml) out.push("HTML otimizado");
  return out;
}

/** Opções iniciais do formulário: as do último ZIP pronto desta oferta, ou o padrão. */
export function initialOptions(history: ExportView[] | null | undefined): ExportOptions {
  const last = history?.find((e) => e.status === "DONE");
  const parsed = ExportOptionsSchema.safeParse(last?.options ?? {});
  return parsed.success ? parsed.data : ExportOptionsSchema.parse({});
}

/** O que vai para o servidor: sem token configurado, nunca pede o eventos.php. */
export function optionsToSend(options: ExportOptions, plan: Pick<ExportPlan, "hasServerEventTokens"> | null) {
  return { ...options, serverEvents: Boolean(options.serverEvents && plan?.hasServerEventTokens) };
}

export type ExportStage = "setup" | "progress" | "done" | "failed";

/** Etapa do diálogo a partir do ZIP acompanhado e da última leitura dele. */
export function exportStage(activeId: string | null, view: ExportView | null, fatal: string | null): ExportStage {
  if (!activeId) return "setup";
  if (fatal) return "failed";
  if (!view || view.id !== activeId) return "progress";
  if (view.status === "DONE") return "done";
  if (view.status === "FAILED") return "failed";
  return "progress";
}

/** Quanto esperar na fila antes de avisar que o robô de tarefas parece parado. */
export const QUEUE_STALL_MS = 8000;

/**
 * O ZIP está parado na fila porque o robô de tarefas (worker) não responde:
 * na fila há mais de QUEUE_STALL_MS e o servidor disse que ele está parado.
 */
export function queueStalled(view: ExportView | null, now: number): boolean {
  if (!view || view.status !== "QUEUED" || view.workerOnline !== false) return false;
  const created = Date.parse(view.createdAt);
  return Number.isFinite(created) && now - created > QUEUE_STALL_MS;
}

export function isFinished(status: ExportView["status"]) {
  return status === "DONE" || status === "FAILED";
}

/** 0–100, inteiro. */
export function clampProgress(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Texto da etapa atual ("Copiando imagens…"); sem etapa, a situação ("Na fila…", "Preparando os arquivos…"). */
export function progressStep(view: ExportView | null) {
  if (view?.step?.trim()) return view.step.trim();
  if (!view || view.status === "QUEUED") return `${EXPORT_STATUS_LABEL.QUEUED}…`;
  if (view.status === "RUNNING") return "Preparando os arquivos…";
  return EXPORT_STATUS_LABEL[view.status];
}

/** Lista "ZIPs anteriores": sem o ZIP que está sendo acompanhado lá em cima, no máximo 5. */
export function historyRows(list: ExportView[] | null | undefined, activeId: string | null) {
  return (list ?? []).filter((e) => e.id !== activeId).slice(0, EXPORTS_KEPT_PER_OFFER);
}

/**
 * O ZIP mais novo ainda sendo gerado (para retomar o acompanhamento ao abrir o
 * diálogo), menos os que a pessoa deixou gerando ao "Voltar às opções"
 * (`skip`): esses ficam em "ZIPs anteriores", com o andamento.
 */
export function runningExport(list: ExportView[] | null | undefined, skip: readonly string[] = []) {
  const first = list?.[0];
  return first && !isFinished(first.status) && !skip.includes(first.id) ? first : null;
}

/**
 * Lista de ZIPs com a leitura mais nova de um deles: troca o item (mesmo id)
 * ou, se ainda não está na lista (pedido depois da última leitura da lista),
 * entra na ordem da data, do mais novo para o mais antigo.
 */
export function mergeExportView(list: readonly ExportView[] | null | undefined, item: ExportView): ExportView[] {
  const rest = (list ?? []).filter((e) => e.id !== item.id);
  const at = rest.findIndex((e) => Date.parse(e.createdAt) < Date.parse(item.createdAt));
  if (!(list ?? []).some((e) => e.id === item.id)) {
    return at < 0 ? [...rest, item] : [...rest.slice(0, at), item, ...rest.slice(at)];
  }
  return (list ?? []).map((e) => (e.id === item.id ? item : e));
}

/** Espera até a próxima leitura: 1 s normalmente; com falhas seguidas, vai dobrando até 8 s. */
export function nextPollDelay(failures: number, base = 1000) {
  if (failures <= 0) return base;
  return Math.min(base * 2 ** Math.min(failures, 6), 8000);
}

/** Mensagem para uma resposta de erro do GET /api/exports/<id> (null = falha passageira, tenta de novo). */
export function fatalPollMessage(status: number, bodyError?: string | null): string | null {
  if (status === 404) return "Este ZIP não existe mais (pode ter sido apagado). Gere de novo.";
  if (status === 401) return bodyError || "Sua sessão expirou. Entre de novo.";
  if (status === 403) return bodyError || "Não foi possível acompanhar o ZIP por este endereço.";
  return null;
}

/** Endereço atual sem um parâmetro (ex.: tira o ?baixar=1 depois de abrir o diálogo). */
export function withoutParam(href: string, name: string) {
  const url = new URL(href, "http://localhost");
  url.searchParams.delete(name);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Parâmetro que abre o diálogo ao chegar na tela da oferta (vindo do menu do card). */
export const EXPORT_QUERY_PARAM = "baixar";
export const exportOfferHref = (offerId: string) => `/ofertas/${offerId}?${EXPORT_QUERY_PARAM}=1`;
/** Evento da janela que abre o diálogo do ZIP na tela da oferta (ex.: "Próximos passos"). */
export const OPEN_EXPORT_EVENT = "os:abrir-zip";
