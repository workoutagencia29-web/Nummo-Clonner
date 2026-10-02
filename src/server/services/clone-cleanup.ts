/**
 * Limpeza automática dos arquivos de clonagens antigas (o disco não cresce
 * para sempre com ZIPs de 200 MB, prints e vídeos de clonagens abandonadas).
 *
 * O que é apagado, por "família" (clonagem principal + páginas do funil),
 * quando ninguém mexe nela há mais de N dias:
 *   - clones/<jobId>/  (HTML das duas saídas e prints do original)
 *   - uploads/<…>      (ZIP enviado / HTML colado), se nenhuma clonagem ainda
 *                      em uso aponta para o mesmo arquivo ("Tentar de novo" reusa)
 *   - tmp/clone/<jobId>/ (downloads pela metade de clonagens interrompidas)
 *   - arquivos baixados (a/…, endereçados por hash) que NÃO são usados por
 *     nenhuma oferta: nem por linhas de Asset, nem por documentos, versões,
 *     configurações ou outras clonagens ainda em uso.
 *
 * E, independente das clonagens: arquivos de versão (versions/<documento>/…)
 * sem linha em PageVersion há mais de 1 dia (versões podadas ou de páginas e
 * ofertas excluídas cujo arquivo ficou para trás).
 *
 * Clonagens salvas mantêm a oferta intacta (o HTML já está no banco e os
 * arquivos têm linhas em Asset). Clonagens prontas para revisar e nunca salvas
 * viram "expiradas" (FAILED/EXPIRED) — a tela explica e oferece clonar de novo.
 *
 * Chamada pelo worker entre uma clonagem e outra (nunca durante uma clonagem).
 */
import type { Dirent } from "node:fs";
import { readdir, readFile, rm, rmdir, stat } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { storagePath } from "@/lib/storage";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Arquivos soltos (upload sem clonagem, envio interrompido) só depois de 1 dia. */
const ORPHAN_AGE_MS = DAY_MS;

export const EXPIRED_CODE = "EXPIRED";
export const EXPIRED_MESSAGE =
  "Esta clonagem ficou muito tempo sem ser salva e os arquivos dela foram apagados para liberar espaço. Clone a página de novo.";

/** Chave de arquivo endereçado por hash: a/<2>/<sha256>.<ext>. */
const CONTENT_KEY = /^a\/[0-9a-f]{2}\/([0-9a-f]{64})\.[a-z0-9]{1,8}$/;
const SHA_RE = /[0-9a-f]{64}/g;

export interface CleanupOptions {
  /** Clonagens salvas, com falha ou canceladas: apagar arquivos depois de N dias. Padrão: 14. */
  olderThanDays?: number;
  /** Clonagens prontas para revisar e nunca salvas: depois de N dias. Padrão: 30. */
  reviewOlderThanDays?: number;
  /** Relógio (testes). */
  now?: Date;
}

export interface CleanupReport {
  /** Clonagens cujos arquivos foram apagados nesta rodada. */
  jobs: number;
  /** Clonagens prontas para revisar que expiraram. */
  expired: number;
  uploads: number;
  cloneFolders: number;
  assets: number;
  tmp: number;
  /** Arquivos de versão sem dono (histórico de páginas excluídas, versões podadas). */
  versions?: number;
  bytes: number;
  /** true quando os arquivos baixados ficaram para a próxima (havia clonagem rodando). */
  assetsDeferred: boolean;
}

interface JobRow {
  id: string;
  parentJobId: string | null;
  status: string;
  offerId: string | null;
  uploadKey: string | null;
  updatedAt: Date;
  cleaned: boolean;
}

async function sizeOf(target: string): Promise<number> {
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(target);
  } catch {
    return 0;
  }
  if (!info.isDirectory()) return info.size;
  let total = 0;
  let entries: Dirent[] = [];
  try {
    entries = await readdir(target, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) total += await sizeOf(path.join(target, e.name));
  return total;
}

/** Apaga (arquivo ou pasta) e devolve quantos bytes liberou; 0 se não existia. */
async function remove(target: string): Promise<number> {
  const bytes = await sizeOf(target);
  await rm(target, { recursive: true, force: true });
  return bytes;
}

async function listDir(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function collectShas(text: string | null | undefined, wanted: Set<string>, into: Set<string>) {
  if (!text) return;
  for (const m of text.matchAll(SHA_RE)) if (wanted.has(m[0])) into.add(m[0]);
}

/** Arquivos endereçados por hash citados no resultado de uma clonagem. */
function resultKeys(result: unknown): string[] {
  const r = result as { assets?: { key?: string }[]; thumbnailKey?: string | null } | null;
  const keys = (r?.assets ?? []).map((a) => a?.key).filter((k): k is string => typeof k === "string");
  if (r?.thumbnailKey) keys.push(r.thumbnailKey);
  return keys;
}

/**
 * Hashes (dentre `wanted`) que ainda são usados por alguma oferta, documento,
 * versão, configuração ou clonagem em uso. Na dúvida, o arquivo fica.
 */
async function referencedShas(wanted: Set<string>, keepJobIds: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  const list = [...wanted];

  // Arquivos registrados em alguma oferta (inclusive na lixeira).
  for (let i = 0; i < list.length; i += 1000) {
    const rows = await prisma.asset.findMany({
      where: { sha256: { in: list.slice(i, i + 1000) } },
      select: { sha256: true },
    });
    for (const r of rows) found.add(r.sha256);
  }

  // Miniaturas e configurações (favicon, imagem de compartilhamento…).
  const offers = await prisma.offer.findMany({ select: { thumbnailKey: true, settings: true, tracking: true } });
  for (const o of offers) {
    collectShas(o.thumbnailKey, wanted, found);
    collectShas(JSON.stringify(o.settings), wanted, found);
    collectShas(JSON.stringify(o.tracking), wanted, found);
  }
  const pages = await prisma.page.findMany({ select: { seo: true, customCode: true } });
  for (const p of pages) {
    collectShas(JSON.stringify(p.seo), wanted, found);
    collectShas(JSON.stringify(p.customCode), wanted, found);
  }
  const settings = await prisma.appSetting.findMany({ select: { value: true } });
  for (const s of settings) collectShas(JSON.stringify(s.value), wanted, found);

  // Clonagens ainda em uso (revisão, fila) podem usar o mesmo arquivo.
  for (let i = 0; i < keepJobIds.length; i += 100) {
    const jobs = await prisma.cloneJob.findMany({
      where: { id: { in: keepJobIds.slice(i, i + 100) } },
      select: { result: true },
    });
    for (const j of jobs) for (const key of resultKeys(j.result)) collectShas(key, wanted, found);
  }

  // Documentos das páginas: HTML, mapa do "Preservar JS" e projeto do editor.
  let cursor: string | undefined;
  for (;;) {
    const docs = await prisma.pageDocument.findMany({
      take: 20,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: { id: true, html: true, assetMap: true, project: true },
    });
    if (!docs.length) break;
    for (const d of docs) {
      collectShas(d.html, wanted, found);
      collectShas(d.assetMap ? JSON.stringify(d.assetMap) : null, wanted, found);
      if (d.project) {
        try {
          collectShas(gunzipSync(d.project).toString("utf8"), wanted, found);
        } catch {
          collectShas(Buffer.from(d.project).toString("utf8"), wanted, found);
        }
      }
    }
    cursor = docs.at(-1)?.id;
  }

  // Versões guardadas (restaurar uma versão antiga precisa dos arquivos dela).
  cursor = undefined;
  for (;;) {
    const versions: { id: string; storageKey: string }[] = await prisma.pageVersion.findMany({
      take: 50,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: { id: true, storageKey: true },
    });
    if (!versions.length) break;
    for (const v of versions) {
      try {
        const data = await readFile(storagePath(v.storageKey));
        let text: string;
        try {
          text = gunzipSync(data).toString("utf8");
        } catch {
          text = data.toString("utf8");
        }
        collectShas(text, wanted, found);
      } catch {
        // Versão sem arquivo: nada a proteger.
      }
    }
    cursor = versions.at(-1)?.id;
  }
  return found;
}

/**
 * Arquivos de versão (versions/<documentId>/<arquivo>) que nenhuma linha de
 * PageVersion usa e com mais de `cutoffMs` de idade: versões podadas, de
 * páginas/ofertas excluídas, ou gravações interrompidas (.tmp). Pastas que
 * ficam vazias saem junto.
 */
export async function removeOrphanVersionFiles(cutoffMs: number): Promise<{ files: number; bytes: number }> {
  const out = { files: 0, bytes: 0 };
  let root: string;
  try {
    root = path.dirname(storagePath("versions/_"));
  } catch {
    return out;
  }
  const folders = (await listDir(root)).filter((e) => e.isDirectory()).map((e) => e.name);
  for (let i = 0; i < folders.length; i += 500) {
    const chunk = folders.slice(i, i + 500);
    const used = new Set(
      (
        await prisma.pageVersion.findMany({
          where: { documentId: { in: chunk } },
          select: { storageKey: true },
        })
      ).map((v) => v.storageKey),
    );
    const liveDocs = new Set(
      (await prisma.pageDocument.findMany({ where: { id: { in: chunk } }, select: { id: true } })).map((d) => d.id),
    );
    for (const folder of chunk) {
      const dir = path.join(root, folder);
      const entries = await listDir(dir);
      let left = entries.length;
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const key = `versions/${folder}/${entry.name}`;
        if (used.has(key)) continue;
        const full = path.join(dir, entry.name);
        const info = await stat(full).catch(() => null);
        if (!info || info.mtimeMs >= cutoffMs) continue;
        // Última conferência: a linha pode ter sido criada agora (restauração de backup etc.).
        if (await prisma.pageVersion.count({ where: { storageKey: key } })) continue;
        out.bytes += await remove(full);
        out.files++;
        left--;
      }
      // Pasta vazia de documento que não existe mais (ninguém grava versões nela).
      if (!left && !liveDocs.has(folder)) await rmdir(dir).catch(() => undefined);
    }
  }
  return out;
}

/**
 * Apaga os arquivos de clonagens antigas. Seguro para rodar a qualquer
 * momento entre clonagens; na dúvida, mantém o arquivo.
 */
export async function cleanupCloneArtifacts(opts: CleanupOptions = {}): Promise<CleanupReport> {
  const now = opts.now ?? new Date();
  const doneCutoff = now.getTime() - (opts.olderThanDays ?? 14) * DAY_MS;
  const reviewCutoff = now.getTime() - (opts.reviewOlderThanDays ?? 30) * DAY_MS;
  const report: CleanupReport = {
    jobs: 0,
    expired: 0,
    uploads: 0,
    cloneFolders: 0,
    assets: 0,
    tmp: 0,
    versions: 0,
    bytes: 0,
    assetsDeferred: false,
  };

  const rows = await prisma.$queryRaw<JobRow[]>`
    select id, "parentJobId", status::text as status, "offerId", "uploadKey", "updatedAt",
           (result ->> 'cleanedAt') is not null as cleaned
    from "CloneJob"`;
  const byId = new Map(rows.map((r) => [r.id, r]));

  // Famílias: a clonagem principal e as páginas do funil dela expiram juntas.
  const families = new Map<string, JobRow[]>();
  for (const r of rows) {
    const root = r.parentJobId && byId.has(r.parentJobId) ? r.parentJobId : r.id;
    const list = families.get(root) ?? [];
    list.push(r);
    families.set(root, list);
  }
  const expiredIds = new Set<string>();
  const toClean: JobRow[] = [];
  for (const [rootId, members] of families) {
    const root = byId.get(rootId) as JobRow;
    if (members.some((m) => m.status === "QUEUED" || m.status === "RUNNING")) continue;
    const lastActivity = Math.max(...members.map((m) => new Date(m.updatedAt).getTime()));
    // Pronta para revisar (ou salva numa oferta excluída de vez): ainda dá para salvar.
    const saveable = root.status === "REVIEW" || (root.status === "SAVED" && !root.offerId);
    if (lastActivity >= (saveable ? reviewCutoff : doneCutoff)) continue;
    for (const m of members) {
      expiredIds.add(m.id);
      if (!m.cleaned) toClean.push(m);
    }
  }
  const keepJobIds = rows.filter((r) => !expiredIds.has(r.id)).map((r) => r.id);

  // Arquivos baixados citados pelas clonagens que vão ser limpas (lidos antes de marcar).
  const candidateKeys = new Set<string>();
  for (let i = 0; i < toClean.length; i += 100) {
    const jobs = await prisma.cloneJob.findMany({
      where: { id: { in: toClean.slice(i, i + 100).map((j) => j.id) } },
      select: { result: true },
    });
    for (const j of jobs) for (const key of resultKeys(j.result)) if (CONTENT_KEY.test(key)) candidateKeys.add(key);
  }

  // 1) Pastas da clonagem (HTML + prints) e downloads pela metade.
  for (const job of toClean) {
    const bytes = await remove(storagePath(`clones/${job.id}`));
    if (bytes) report.cloneFolders++;
    report.bytes += bytes;
    report.bytes += await remove(path.join(env.dataDir, "tmp", "clone", job.id));
  }

  // 2) ZIP/HTML enviados: só quando todas as clonagens que usam o arquivo expiraram.
  const jobsByUpload = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.uploadKey) continue;
    jobsByUpload.set(r.uploadKey, [...(jobsByUpload.get(r.uploadKey) ?? []), r.id]);
  }
  for (const key of new Set(toClean.map((j) => j.uploadKey).filter((k): k is string => Boolean(k)))) {
    if (!(jobsByUpload.get(key) ?? []).every((id) => expiredIds.has(id))) continue;
    let target: string;
    try {
      target = storagePath(key);
    } catch {
      continue;
    }
    const bytes = await remove(target);
    if (bytes) report.uploads++;
    report.bytes += bytes;
  }

  // 3) Clonagens que só esperavam revisão (ou uma oferta excluída) ficam
  //    "expiradas": a tela explica e oferece clonar de novo. Sem mexer em
  //    updatedAt, para a família continuar contando como antiga.
  const toCleanIds = toClean.map((j) => j.id);
  for (let i = 0; i < toCleanIds.length; i += 500) {
    const chunk = toCleanIds.slice(i, i + 500);
    report.expired += await prisma.$executeRaw`
      update "CloneJob"
      set status = 'FAILED', "errorCode" = ${EXPIRED_CODE}, "errorMessage" = ${EXPIRED_MESSAGE}
      where id in (${Prisma.join(chunk)})
        and (status = 'REVIEW' or (status = 'SAVED' and "offerId" is null))`;
  }
  report.jobs = toClean.length;

  // 4) Sobras: uploads sem clonagem (envio que não chegou a criar a clonagem),
  //    pastas temporárias de clonagens que não estão rodando e envios de ZIP
  //    interrompidos.
  const referencedUploads = new Set(rows.map((r) => r.uploadKey).filter(Boolean));
  const orphanCutoff = now.getTime() - ORPHAN_AGE_MS;
  for (const entry of await listDir(path.dirname(storagePath("uploads/_")))) {
    if (!entry.isFile()) continue;
    const key = `uploads/${entry.name}`;
    if (referencedUploads.has(key)) continue;
    const full = storagePath(key);
    const info = await stat(full).catch(() => null);
    if (!info || info.mtimeMs >= orphanCutoff) continue;
    // Pode ter virado clonagem agora mesmo.
    if (await prisma.cloneJob.count({ where: { uploadKey: key } })) continue;
    report.bytes += await remove(full);
    report.uploads++;
  }
  const tmpClone = path.join(env.dataDir, "tmp", "clone");
  const tmpDirs = (await listDir(tmpClone)).filter((e) => e.isDirectory()).map((e) => e.name);
  if (tmpDirs.length) {
    const busy = new Set(
      (
        await prisma.cloneJob.findMany({
          where: { id: { in: tmpDirs }, status: { in: ["QUEUED", "RUNNING"] } },
          select: { id: true },
        })
      ).map((j) => j.id),
    );
    for (const name of tmpDirs) {
      if (busy.has(name)) continue;
      // Pasta recém-criada pode ser de uma clonagem que acabou de começar.
      const info = await stat(path.join(tmpClone, name)).catch(() => null);
      if (!info || info.mtimeMs >= orphanCutoff) continue;
      const bytes = await remove(path.join(tmpClone, name));
      report.bytes += bytes;
      report.tmp++;
    }
  }
  for (const entry of await listDir(path.join(env.dataDir, "tmp"))) {
    // Envios de ZIP interrompidos e cópias de restaurações de backup interrompidas
    // (o worker também apaga essas ao iniciar).
    const restoreDir = entry.isDirectory() && entry.name.startsWith("restore-");
    if (!restoreDir && (!entry.isFile() || !entry.name.endsWith(".zip.part"))) continue;
    const full = path.join(env.dataDir, "tmp", entry.name);
    const info = await stat(full).catch(() => null);
    if (!info || info.mtimeMs >= orphanCutoff) continue;
    if (
      restoreDir &&
      (await prisma.backupRestore.count({
        where: { id: entry.name.slice("restore-".length), status: { in: ["QUEUED", "RUNNING"] } },
      }))
    ) {
      continue;
    }
    report.bytes += await remove(full);
    report.tmp++;
  }

  // 4b) Arquivos de versão sem linha em PageVersion (só os antigos: o arquivo é
  //     gravado um instante antes da linha).
  const versionReport = await removeOrphanVersionFiles(orphanCutoff);
  report.versions = versionReport.files;
  report.bytes += versionReport.bytes;

  // 5) Arquivos baixados que nenhuma oferta usa. Com uma clonagem rodando, fica
  //    para a próxima: ela pode estar reaproveitando um desses arquivos agora.
  const onDisk: string[] = [];
  for (const key of candidateKeys) if (await stat(storagePath(key)).catch(() => null)) onDisk.push(key);
  if (onDisk.length) {
    if (await prisma.cloneJob.count({ where: { status: "RUNNING" } })) {
      report.assetsDeferred = true;
    } else {
      const shaOf = (key: string) => (CONTENT_KEY.exec(key) as RegExpExecArray)[1];
      const wanted = new Set(onDisk.map(shaOf));
      const used = await referencedShas(wanted, keepJobIds);
      let doomed = onDisk.filter((key) => !used.has(shaOf(key)));
      // Última conferência logo antes de apagar (algo pode ter sido salvo agora).
      if (doomed.length) {
        const late = await prisma.asset.findMany({
          where: { sha256: { in: [...new Set(doomed.map(shaOf))] } },
          select: { sha256: true },
        });
        const lateSet = new Set(late.map((a) => a.sha256));
        doomed = doomed.filter((key) => !lateSet.has(shaOf(key)));
      }
      for (const key of doomed) {
        const bytes = await remove(storagePath(key));
        if (bytes) report.assets++;
        report.bytes += bytes;
      }
    }
  }

  // 6) Marca as clonagens limpas (não são processadas de novo). Se os arquivos
  //    baixados ficaram para depois, a próxima rodada volta nelas.
  if (!report.assetsDeferred) {
    for (let i = 0; i < toCleanIds.length; i += 500) {
      const chunk = toCleanIds.slice(i, i + 500);
      await prisma.$executeRaw`
        update "CloneJob"
        set result = coalesce(result, '{}'::jsonb) || jsonb_build_object('cleanedAt', ${now.toISOString()}::text)
        where id in (${Prisma.join(chunk)})`;
    }
  }

  return report;
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1).replace(".", ",")} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Linha de log em português com o resumo da limpeza; null quando nada foi apagado. */
export function describeCleanup(report: CleanupReport): string | null {
  if (!report.bytes && !report.jobs) return null;
  const parts: string[] = [];
  if (report.jobs) parts.push(`${report.jobs} clonage${report.jobs === 1 ? "m antiga" : "ns antigas"}`);
  if (report.uploads)
    parts.push(`${report.uploads} arquivo${report.uploads === 1 ? "" : "s"} enviado${report.uploads === 1 ? "" : "s"}`);
  if (report.assets)
    parts.push(
      `${report.assets} arquivo${report.assets === 1 ? "" : "s"} baixado${report.assets === 1 ? "" : "s"} sem uso`,
    );
  if (report.tmp) parts.push(`${report.tmp} sobra${report.tmp === 1 ? "" : "s"} de clonagens interrompidas`);
  if (report.versions) {
    parts.push(
      `${report.versions} arquivo${report.versions === 1 ? "" : "s"} de versões antigas ou de páginas excluídas`,
    );
  }
  return `Limpeza automática: ${parts.join(", ")} (${formatBytes(report.bytes)} liberados).`;
}
