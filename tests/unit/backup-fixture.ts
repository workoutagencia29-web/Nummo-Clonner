/**
 * Dados de teste do backup (Fase 6): uma instalação "cheia" — conta, pastas,
 * tags, oferta do "Baixar ZIP" (páginas, versões A/B, documentos, CSS em
 * cadeia, Preservar JS, pixels com token criptografado, regras), oferta na
 * lixeira, projeto do editor compactado, versões salvas, arquivos, clonagens
 * (salva, do funil e em revisão, com logs), sessão de "Testar pixels", ZIPs,
 * configurações — e utilidades para fotografar as tabelas e reescrever um
 * arquivo de backup (formato antigo, versão nova, arquivo danificado).
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import sharp from "sharp";
import { ZipFile } from "yazl";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { putContentAddressed, putObject, storagePath } from "@/lib/storage";
import type { BackupManifest } from "@/server/services/backup/format";
import { prismaQueryable } from "@/server/services/backup/queue";
import { backupTableNames, ident, loadSchema } from "@/server/services/backup/tables";
import { createExportFixture, type ExportFixture, readZip } from "./export-fixture";

export const STORAGE_ROOT = path.join(env.dataDir, "storage");

export async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), `os-${prefix}-`));
}

export const TRICKY_TEXT = 'Notas: "aspas", \\barra\\, quebra\nde linha, tab\t, emoji 🚀, separador   e ç/ã/é — fim';

export interface RichData {
  fx: ExportFixture;
  userId: string;
  trashOfferId: string;
  documentId: string;
  /** Chaves de storage que precisam ir para o backup (citadas só num lugar difícil). */
  hidden: {
    inProject: string;
    inVersion: string;
    inClone: string;
    cloneHtml: string;
    cloneShot: string;
    version: string;
  };
  /** Chaves que NÃO podem ir para o backup. */
  excluded: { upload: string; exportZip: string; orphan: string };
  /** Arquivos criados fora do endereçamento por hash (para apagar no fim). */
  cleanup: string[];
}

let seed = 0;
async function uniquePng(): Promise<Buffer> {
  seed++;
  return sharp({
    create: {
      width: 3 + (seed % 7),
      height: 2 + Math.floor(Math.random() * 50),
      channels: 3,
      background: { r: Math.floor(Math.random() * 255), g: seed % 255, b: 77 },
    },
  })
    .png()
    .toBuffer();
}

async function storeUnique(ext: string, data?: Buffer): Promise<string> {
  const saved = await putContentAddressed(data ?? (await uniquePng()), ext);
  return saved.key;
}

const fileOf = (key: string) => key.split("/").pop() as string;

export async function createRichData(): Promise<RichData> {
  const fx = await createExportFixture({ liveUrl: "https://exemplo.com.br/oferta" });
  const run = randomUUID().slice(0, 8);

  // Conta (Better Auth) e uma sessão aberta.
  const userId = `user_${run}`;
  await prisma.user.create({
    data: { id: userId, name: "Ana Backup", email: `ana-${run}@backup.test`, emailVerified: true },
  });
  await prisma.account.create({
    data: {
      id: `acc_${run}`,
      accountId: userId,
      providerId: "credential",
      userId,
      password: "c2NyeXB0:ZmFrZS1oYXNo",
    },
  });
  await prisma.session.create({
    data: { id: `sess_${run}`, token: `tok_${run}`, userId, expiresAt: new Date(Date.now() + 86_400_000) },
  });

  // Organização.
  const folder = await prisma.folder.create({
    data: { name: "Lançamentos", nameKey: `lancamentos-${run}`, position: 2 },
  });
  const tag = await prisma.tag.create({ data: { name: "Black Friday", nameKey: `black-friday-${run}`, color: "red" } });
  const thumb = await storeUnique(
    "webp",
    await sharp(await uniquePng())
      .webp()
      .toBuffer(),
  );
  await prisma.offer.update({
    where: { id: fx.offerId },
    data: {
      folderId: folder.id,
      notes: TRICKY_TEXT,
      status: "LIVE",
      thumbnailKey: thumb,
      tracking: { consent: { mode: "OPT_IN" }, forwarding: { days: 30 } },
      tags: { create: { tagId: tag.id } },
    },
  });
  await prisma.offerLink.create({
    data: {
      offerId: fx.offerId,
      key: "whatsapp",
      label: "WhatsApp",
      url: "https://wa.me/5511999999999",
      kind: "WHATSAPP",
      position: 1,
    },
  });
  const trash = await prisma.offer.create({
    data: {
      name: "Oferta na lixeira",
      deletedAt: new Date("2026-09-30T12:00:00.123Z"),
      settings: { seo: { title: "x" } },
    },
  });

  // Projeto do editor (gzip) citando um arquivo que só aparece ali.
  const inProject = await storeUnique("png");
  const doc = await prisma.pageDocument.findFirstOrThrow({
    where: { variant: { pageId: fx.homeId, name: "A" } },
    select: { id: true },
  });
  const project = gzipSync(
    Buffer.from(JSON.stringify({ pages: [{ component: `<img src="/os-assets/${fileOf(inProject)}">` }] }), "utf8"),
  );
  await prisma.pageDocument.update({ where: { id: doc.id }, data: { project, revision: 7 } });

  // Versão salva (arquivo .json.gz no storage) citando outro arquivo.
  const inVersion = await storeUnique("png");
  const version = `versions/${doc.id}/${randomUUID()}.json.gz`;
  const versionData = gzipSync(
    Buffer.from(JSON.stringify({ project: null, html: `<img src="/os-assets/${fileOf(inVersion)}">` }), "utf8"),
  );
  await putObject(version, versionData);
  await prisma.pageVersion.create({
    data: {
      documentId: doc.id,
      kind: "MANUAL",
      label: "Antes da troca",
      storageKey: version,
      bytes: versionData.length,
    },
  });

  // Arquivos registrados na oferta.
  for (const key of [inProject, inVersion]) {
    const sha = fileOf(key).split(".")[0];
    await prisma.asset.create({
      data: {
        offerId: fx.offerId,
        sha256: sha,
        key,
        kind: "IMAGE",
        mime: "image/png",
        bytes: 100,
        width: 3,
        height: 2,
        originalName: "foto.png",
      },
    });
  }

  // Clonagens: uma salva (com página do funil) e uma em revisão.
  const saved = await prisma.cloneJob.create({
    data: {
      source: "URL",
      sourceUrl: "https://original.example/vendas",
      status: "SAVED",
      progress: 100,
      offerId: fx.offerId,
      options: { devices: ["desktop", "mobile"] },
      result: { title: "Original", assets: [] },
      startedAt: new Date("2026-09-29T10:00:00.000Z"),
      finishedAt: new Date("2026-09-29T10:01:00.000Z"),
    },
  });
  // Filho criado antes do pai na ordem do id (a restauração não pode depender da ordem).
  await prisma.cloneJob.create({
    data: {
      id: `a${run}child`,
      source: "URL",
      sourceUrl: "https://original.example/upsell",
      status: "SAVED",
      parentJobId: saved.id,
    },
  });
  const reviewId = `z${run}review`;
  const inClone = await storeUnique("png");
  const cloneHtml = `clones/${reviewId}/desktop-editable.html`;
  const cloneShot = `clones/${reviewId}/desktop.jpg`;
  await putObject(cloneHtml, `<html><body><img src="/os-assets/${fileOf(inClone)}"></body></html>`);
  await putObject(
    cloneShot,
    await sharp(await uniquePng())
      .jpeg()
      .toBuffer(),
  );
  const upload = `uploads/${randomUUID()}.html`;
  await putObject(upload, "<html>enviado</html>");
  await prisma.cloneJob.create({
    data: {
      id: reviewId,
      source: "HTML",
      uploadKey: upload,
      status: "REVIEW",
      progress: 100,
      result: { devices: { desktop: { outputs: { EDITABLE: { htmlKey: cloneHtml } }, screenshotKey: cloneShot } } },
    },
  });
  for (const [i, level] of (["INFO", "WARN", "SUCCESS"] as const).entries()) {
    await prisma.cloneLog.create({ data: { jobId: saved.id, level, message: `Passo ${i} ✓`, bytes: i * 1000 } });
  }
  await prisma.removedItem.create({
    data: {
      jobId: saved.id,
      pageId: fx.homeId,
      vendor: "Meta",
      category: "PIXEL",
      pixelId: "999",
      snippet: "<script>fbq()</script>",
      location: "head",
    },
  });
  await prisma.checkoutLink.create({
    data: {
      jobId: saved.id,
      pageId: fx.homeId,
      platform: "hotmart",
      url: "https://pay.hotmart.com/X1",
      source: "HREF",
      confidence: 90,
    },
  });
  await prisma.eventRule.create({
    data: { offerId: fx.offerId, pageId: fx.upsellId, event: "PURCHASE", trigger: "TIME_ON_PAGE", value: 15 },
  });

  // Teste de pixels com eventos (id autoincremento).
  const session = await prisma.pixelTestSession.create({
    data: {
      offerId: fx.offerId,
      pageId: fx.homeId,
      token: `pt_${run}`,
      expiresAt: new Date(Date.now() + 3_600_000),
      eventCount: 2,
    },
  });
  await prisma.pixelTestEvent.create({
    data: { sessionId: session.id, vendor: "META", event: "PageView", status: "FIRED", detail: { id: 1 } },
  });
  await prisma.pixelTestEvent.create({
    data: { sessionId: session.id, vendor: "GA4", event: "page_view", status: "BLOCKED" },
  });

  // ZIP gerado (a linha vai; o arquivo não).
  const exportRow = await prisma.export.create({
    data: {
      offerId: fx.offerId,
      status: "DONE",
      progress: 100,
      step: "ZIP pronto",
      options: { splitter: true, serverEvents: false, optimizeHtml: true },
      fileName: "oferta.zip",
      bytes: 1234,
      warnings: ["Aviso de teste"],
      startedAt: new Date(),
      finishedAt: new Date(),
    },
  });
  const exportZip = `exports/${fx.offerId}/${exportRow.id}.zip`;
  await putObject(exportZip, "zip de teste");
  await prisma.export.update({ where: { id: exportRow.id }, data: { fileKey: exportZip } });

  // Configurações (as deste Mac ficam de fora), estado local e passageiro.
  await prisma.appSetting.create({ data: { key: "preferencias", value: { tema: "escuro", lista: [1, 2, 3] } } });
  await prisma.appSetting.create({
    data: { key: "backup", value: { folder: "documents", auto: false, hour: 5, keep: 3 } },
  });
  await prisma.backup.create({ data: { kind: "MANUAL", status: "DONE", filePath: "/tmp/x.zip", bytes: BigInt(10) } });
  await prisma.previewToken.create({
    data: { id: `pv_${run}`, target: { kind: "x" }, expiresAt: new Date(Date.now() + 60_000) },
  });
  await prisma.rateLimit.create({
    data: { id: `rl_${run}`, key: `k_${run}`, count: 3, lastRequest: BigInt("9007199254740993") },
  });

  // Arquivo sem uso: não vai para o backup.
  const orphan = await storeUnique("png");

  return {
    fx,
    userId,
    trashOfferId: trash.id,
    documentId: doc.id,
    hidden: { inProject, inVersion, inClone, cloneHtml, cloneShot, version },
    excluded: { upload, exportZip, orphan },
    cleanup: [version, cloneHtml, cloneShot, upload, exportZip],
  };
}

export async function cleanupRichData(data: RichData | undefined) {
  if (!data) return;
  for (const key of data.cleanup) await rm(storagePath(key), { force: true }).catch(() => undefined);
  await rm(storagePath(`clones/${data.hidden.cloneHtml.split("/")[1]}`), { recursive: true, force: true }).catch(
    () => undefined,
  );
  await rm(storagePath(`exports/${data.fx.offerId}`), { recursive: true, force: true }).catch(() => undefined);
}

/** Tabelas do app (as que vão para o backup). */
export async function appTables(): Promise<string[]> {
  return backupTableNames(await loadSchema(prismaQueryable)).sort();
}

/** Cada tabela do app como texto (row_to_json), em ordem da chave primária. */
export async function snapshotTables(): Promise<Record<string, string[]>> {
  const schema = await loadSchema(prismaQueryable);
  const out: Record<string, string[]> = {};
  for (const name of backupTableNames(schema).sort()) {
    const meta = schema.get(name);
    if (!meta) continue;
    const order = meta.primaryKey.map(ident).join(", ");
    const rows = await prisma.$queryRawUnsafe<{ j: string }[]>(
      `select row_to_json(t)::text as j from ${ident(name)} t order by ${order}`,
    );
    out[name] = rows.map((r) => r.j);
  }
  return out;
}

/** Esvazia as tabelas do app e as passageiras (como uma instalação apagada). */
export async function wipeAppTables() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    select tablename from pg_tables where schemaname = 'public' and tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(
    `truncate table ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} restart identity cascade`,
  );
}

export function sha256(data: Buffer | string) {
  return createHash("sha256").update(data).digest("hex");
}

export async function fileSha(full: string) {
  return sha256(await readFile(full));
}

/**
 * Reescreve um backup: `edit` recebe cada entrada (nome, conteúdo) e devolve o
 * novo conteúdo (ou null para tirar). Com `fixManifest`, as entradas db/ e o
 * índice alterados têm tamanho, SHA-256 e linhas acertados no manifest (que
 * também pode ser alterado por `manifest`).
 */
export async function rewriteArchive(
  src: string,
  dest: string,
  opts: {
    edit?: (name: string, data: Buffer) => Buffer | null;
    manifest?: (m: BackupManifest) => BackupManifest;
    fixManifest?: boolean;
  },
) {
  const entries = await readZip(src);
  const out = new Map<string, Buffer>();
  for (const [name, item] of entries) {
    if (name === "manifest.json") continue;
    const data = opts.edit ? opts.edit(name, item.data) : item.data;
    if (data) out.set(name, data);
  }
  let manifest = JSON.parse((entries.get("manifest.json") as { data: Buffer }).data.toString("utf8")) as BackupManifest;
  if (opts.fixManifest) {
    manifest = {
      ...manifest,
      tables: manifest.tables.map((t) => {
        const data = out.get(t.file);
        if (!data) return t;
        return {
          ...t,
          bytes: data.length,
          sha256: sha256(data),
          rows: data.toString("utf8").split("\n").filter(Boolean).length,
        };
      }),
    };
  }
  if (opts.manifest) manifest = opts.manifest(manifest);
  out.set("manifest.json", Buffer.from(JSON.stringify(manifest), "utf8"));
  const zip = new ZipFile();
  for (const [name, data] of out) zip.addBuffer(data, name);
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream as AsyncIterable<Buffer>) chunks.push(chunk);
  await writeFile(dest, Buffer.concat(chunks));
}
