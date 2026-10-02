/**
 * Documentos de página no editor: abrir, salvar (com checagem de revisão para
 * não sobrescrever o que outra aba salvou) e histórico de versões.
 */
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import { Prisma, type VersionKind } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { baseStylesheetText, finalizeFromEditor, linkBaseStylesheet, prepareForEditor } from "@/lib/editor-html";
import { UserError } from "@/lib/errors";
import {
  computeLegacyRepair,
  hasLegacySignals,
  type LegacyRepair,
  legacySignals,
  withProjectFormat,
} from "@/lib/legacy-repair";
import { packProject, unpackProject } from "@/lib/project-data";
import { deleteObject, getObject, putContentAddressed, putObject, storagePath } from "@/lib/storage";
import { blankPageHtml } from "@/lib/templates";

const ASSET = "/os-assets/";
/** Quantas versões automáticas guardar por documento. */
const MAX_AUTO_VERSIONS = 50;
/** Intervalo mínimo entre versões automáticas durante a edição. */
const AUTO_VERSION_EVERY_MS = 10 * 60 * 1000;

async function documentOrThrow(documentId: string) {
  const doc = await prisma.pageDocument.findFirst({
    where: { id: documentId, variant: { page: { offer: { deletedAt: null } } } },
    include: {
      variant: {
        include: {
          page: {
            include: {
              offer: {
                select: {
                  id: true,
                  name: true,
                  pages: {
                    orderBy: { position: "asc" },
                    select: {
                      id: true,
                      name: true,
                      slug: true,
                      type: true,
                      isHome: true,
                      variants: {
                        orderBy: [{ isControl: "desc" }, { position: "asc" }],
                        take: 1,
                        select: { documents: { select: { id: true, device: true } } },
                      },
                    },
                  },
                  links: {
                    orderBy: { position: "asc" },
                    select: { id: true, key: true, label: true, url: true, kind: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!doc) throw new UserError("Página não encontrada. Ela pode ter sido excluída.");
  return doc;
}

/**
 * Converte o HTML guardado (clone, modelo ou página em branco) no HTML que o
 * editor recebe: CSS original numa folha base em camada e scripts inertes.
 */
export async function htmlForEditor(storedHtml: string) {
  const prepared = prepareForEditor(storedHtml);
  const files: { href: string; media?: string }[] = [];
  for (const style of prepared.styles) {
    if (style.kind === "link" && style.href) {
      files.push({ href: style.href, media: style.media });
    } else if (style.text) {
      const stored = await putContentAddressed(Buffer.from(style.text, "utf8"), "css");
      files.push({ href: `${ASSET}${stored.sha256}.css`, media: style.media });
    }
  }
  if (!files.length) return prepared.html;
  const base = await putContentAddressed(Buffer.from(baseStylesheetText(files), "utf8"), "css");
  return linkBaseStylesheet(prepared.html, `${ASSET}${base.sha256}.css`);
}

/** Versão A/B da página aberta no editor (seletor "Versão A / B" na barra). */
export interface EditorVariant {
  id: string;
  name: string;
  label: string | null;
  isControl: boolean;
  /** Percentual do tráfego no divisor do ZIP (0–100). */
  weight: number;
  documents: { id: string; device: "ALL" | "DESKTOP" | "MOBILE" }[];
}

export interface EditorPayload {
  documentId: string;
  revision: number;
  /** JSON do projeto do editor (quando já foi aberto antes). */
  project: unknown | null;
  /** HTML para importar (primeira abertura). */
  html: string | null;
  device: "ALL" | "DESKTOP" | "MOBILE";
  cloneMode: "EDITABLE" | "PRESERVE_JS";
  /**
   * "Preservar JS" com a cópia editável da clonagem guardada: "Converter para
   * editável" troca a página por ela (convertToEditable). Sem ela (páginas
   * salvas antes), o editor abre o HTML original sem os scripts.
   */
  convertible?: boolean;
  page: { id: string; name: string; slug: string; type: string };
  variant: { id: string; name: string; label?: string | null; isControl?: boolean };
  /**
   * Versões A/B da página, na ordem, com os documentos de cada uma (para trocar
   * de versão no editor). Opcional: payloads montados à mão (testes) não têm.
   */
  variants?: EditorVariant[];
  offer: { id: string; name: string };
  /** Páginas do funil, com o documento principal de cada uma (para trocar de página no editor). */
  pages: { id: string; name: string; slug: string; type: string; isHome: boolean; documentId: string | null }[];
  links: { id: string; key: string; label: string; url: string; kind: string }[];
  documents: { id: string; device: "ALL" | "DESKTOP" | "MOBILE" }[];
  /** Página aberta antes de correções do editor: o que reparar ao abrir (src/lib/legacy-repair.ts). */
  repair?: LegacyRepair | null;
}

/**
 * Reparo de projetos gravados antes das correções de <noscript> e de ids
 * repetidos. Só lê a "Versão original" quando o projeto tem sinais disso.
 */
async function legacyRepairFor(documentId: string, project: unknown): Promise<LegacyRepair | null> {
  const signals = legacySignals(project);
  if (!hasLegacySignals(signals)) return null;
  const original = await prisma.pageVersion.findFirst({
    where: { documentId, kind: { in: ["CLONE", "IMPORT"] } },
    orderBy: { createdAt: "asc" },
    select: { storageKey: true },
  });
  if (!original) return null;
  try {
    const snapshot = await readSnapshot(original.storageKey);
    return snapshot.html ? computeLegacyRepair(snapshot.html, signals) : null;
  } catch {
    // Sem o arquivo da versão original: abre sem reparo.
    return null;
  }
}

export async function getEditorPayload(documentId: string): Promise<EditorPayload> {
  const doc = await documentOrThrow(documentId);
  const page = doc.variant.page;
  const siblings = await prisma.pageDocument.findMany({
    where: { variantId: doc.variantId },
    select: { id: true, device: true },
    orderBy: { device: "asc" },
  });
  const variants = await prisma.pageVariant.findMany({
    where: { pageId: page.id },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      label: true,
      isControl: true,
      weight: true,
      documents: { select: { id: true, device: true }, orderBy: { device: "asc" } },
    },
  });
  const project = doc.project ? unpackProject(doc.project) : null;
  return {
    documentId: doc.id,
    revision: doc.revision,
    project,
    html: doc.project ? null : await htmlForEditor(doc.html ?? blankPageHtml(page.name)),
    repair: project ? await legacyRepairFor(doc.id, project) : null,
    device: doc.device,
    // "Preservar JS" vale para o documento com os arquivos originais (assetMap).
    // Uma versão A/B criada de um modelo ou em branco nessa página é comum.
    cloneMode: page.cloneMode === "PRESERVE_JS" && doc.assetMap === null ? "EDITABLE" : page.cloneMode,
    convertible: page.cloneMode === "PRESERVE_JS" && doc.assetMap !== null && Boolean(doc.editableHtml),
    page: { id: page.id, name: page.name, slug: page.slug, type: page.type },
    variant: {
      id: doc.variant.id,
      name: doc.variant.name,
      label: doc.variant.label,
      isControl: doc.variant.isControl,
    },
    variants,
    offer: { id: page.offer.id, name: page.offer.name },
    pages: page.offer.pages.map((p) => {
      const docs = p.variants[0]?.documents ?? [];
      const main = docs.find((d) => d.device === "ALL") ?? docs.find((d) => d.device === "DESKTOP") ?? docs[0];
      return { id: p.id, name: p.name, slug: p.slug, type: p.type, isHome: p.isHome, documentId: main?.id ?? null };
    }),
    links: page.offer.links,
    documents: siblings,
  };
}

// ─── Versões ─────────────────────────────────────────────────────────────────

/** Estado "Preservar JS" de um documento: arquivos nos caminhos originais e a cópia editável. */
interface PreserveState {
  assetMap: unknown;
  editableHtml: string | null;
}

interface VersionSnapshot {
  project: unknown | null;
  html: string | null;
  /**
   * Modo da página quando a versão foi gravada: null = editável; objeto =
   * "Preservar JS". Restaurar volta o modo junto. Ausente nas versões gravadas
   * antes desta marca (restaurar não mexe no modo).
   */
  preserve?: PreserveState | null;
}

function preserveStateOf(doc: { assetMap: unknown; editableHtml: string | null }): PreserveState | null {
  return doc.assetMap === null ? null : { assetMap: doc.assetMap, editableHtml: doc.editableHtml };
}

/**
 * O modo da página acompanha os documentos: "Preservar JS" enquanto algum
 * documento dela ainda tem os arquivos nos caminhos originais (assetMap).
 */
async function syncCloneMode(pageId: string) {
  const docs = await prisma.pageDocument.findMany({ where: { variant: { pageId } }, select: { assetMap: true } });
  const cloneMode = docs.some((d) => d.assetMap !== null) ? "PRESERVE_JS" : "EDITABLE";
  await prisma.page.updateMany({ where: { id: pageId, NOT: { cloneMode } }, data: { cloneMode } });
}

/** Pasta dos arquivos de versão de um documento no storage. */
function versionFolder(documentId: string) {
  return `versions/${documentId}`;
}

async function writeSnapshot(documentId: string, snapshot: VersionSnapshot) {
  const key = `${versionFolder(documentId)}/${randomUUID()}.json.gz`;
  const data = gzipSync(Buffer.from(JSON.stringify(snapshot), "utf8"));
  await putObject(key, data);
  return { key, bytes: data.byteLength };
}

async function readSnapshot(key: string): Promise<VersionSnapshot> {
  let data: Buffer;
  try {
    data = await getObject(key);
  } catch {
    throw new UserError("O arquivo desta versão não foi encontrado. Escolha outra versão.");
  }
  return JSON.parse(gunzipSync(data).toString("utf8")) as VersionSnapshot;
}

/**
 * Apaga versões (linhas e arquivos .json.gz). O arquivo sai depois da linha: se
 * a remoção do arquivo falhar, a limpeza automática (clone-cleanup) o recolhe.
 */
async function deleteVersions(versions: { id: string; storageKey: string }[]) {
  if (!versions.length) return;
  await prisma.pageVersion.deleteMany({ where: { id: { in: versions.map((v) => v.id) } } });
  await Promise.all(versions.map((v) => deleteObject(v.storageKey).catch(() => undefined)));
}

/**
 * Apaga do disco os arquivos de versão de documentos que acabaram de ser
 * excluídos do banco (página excluída, oferta excluída de vez, lixeira esvaziada).
 * Falhas são ignoradas: a limpeza automática recolhe o que sobrar.
 */
export async function removeVersionFiles(documentIds: Iterable<string>) {
  for (const id of new Set(documentIds)) {
    try {
      await rm(storagePath(versionFolder(id)), { recursive: true, force: true });
    } catch {
      // ID inválido para o storage ou erro de disco: nada a fazer aqui.
    }
  }
}

/**
 * Nova versão (do estado salvo atual, sem `snapshot`). `openAsIs`: o projeto
 * guardado leva a marca do editor corrigido — restaurado, abre como está, sem o
 * reparo de páginas antigas (a versão "Antes do reparo automático").
 */
export async function createVersion(
  documentId: string,
  kind: VersionKind,
  label: string | null,
  snapshot?: VersionSnapshot,
  { openAsIs = false }: { openAsIs?: boolean } = {},
) {
  let data = snapshot;
  if (!data || !("preserve" in data)) {
    // Mesma regra de documentOrThrow: documentos de ofertas na lixeira não ganham versões.
    const doc = await prisma.pageDocument.findFirst({
      where: { id: documentId, variant: { page: { offer: { deletedAt: null } } } },
      select: { project: true, html: true, assetMap: true, editableHtml: true },
    });
    if (!doc) throw new UserError("Página não encontrada. Ela pode ter sido excluída.");
    // A versão guarda também o modo atual da página (com ou sem os scripts originais).
    data = {
      ...(data ?? { project: doc.project ? unpackProject(doc.project) : null, html: doc.html }),
      preserve: preserveStateOf(doc),
    };
  }
  if (openAsIs && data.project) data = { ...data, project: withProjectFormat(data.project) };
  return insertVersion(documentId, kind, label, await writeSnapshot(documentId, data));
}

/** Cria a linha da versão para um arquivo já gravado (e poda as automáticas antigas). */
async function insertVersion(
  documentId: string,
  kind: VersionKind,
  label: string | null,
  stored: { key: string; bytes: number },
) {
  let version: { id: string; kind: VersionKind; label: string | null; createdAt: Date; bytes: number };
  try {
    version = await prisma.pageVersion.create({
      data: { documentId, kind, label: label?.slice(0, 120) || null, storageKey: stored.key, bytes: stored.bytes },
      select: { id: true, kind: true, label: true, createdAt: true, bytes: true },
    });
  } catch (err) {
    // Documento excluído no meio: o arquivo não teria dono.
    await deleteObject(stored.key).catch(() => undefined);
    throw err;
  }
  if (kind === "AUTO") {
    // Mantém só as últimas N automáticas (as manuais e de restauração ficam).
    const old = await prisma.pageVersion.findMany({
      where: { documentId, kind: "AUTO" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: MAX_AUTO_VERSIONS,
      select: { id: true, storageKey: true },
    });
    await deleteVersions(old);
  }
  return version;
}

/**
 * Dá um nome claro à versão mais recente de cada documento (ex.: as versões
 * "antes" que uma operação em todas as páginas acabou de criar).
 */
export async function relabelLatestVersions(documentIds: string[], kind: VersionKind, label: string) {
  if (!documentIds.length) return;
  const latest = await prisma.pageVersion.findMany({
    where: { documentId: { in: documentIds }, kind },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    distinct: ["documentId"],
    select: { id: true },
  });
  if (!latest.length) return;
  await prisma.pageVersion.updateMany({
    where: { id: { in: latest.map((v) => v.id) } },
    data: { label: label.slice(0, 120) },
  });
}

/** Desfaz uma versão recém-criada (a operação que ela protegia não aconteceu). */
async function discardVersion(versionId: string) {
  const row = await prisma.pageVersion.findUnique({ where: { id: versionId }, select: { id: true, storageKey: true } });
  if (row) await deleteVersions([row]);
}

export async function listVersions(documentId: string) {
  await documentOrThrow(documentId);
  return prisma.pageVersion.findMany({
    where: { documentId },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, kind: true, label: true, createdAt: true, bytes: true },
  });
}

// ─── Salvar ──────────────────────────────────────────────────────────────────

export interface SaveInput {
  documentId: string;
  /** Revisão que o editor conhecia. */
  revision: number;
  project: unknown;
  /** HTML completo exportado pelo editor (getHtml asDocument). */
  html: string;
  /** CSS das edições (getCss). */
  css: string;
}

export class RevisionConflictError extends Error {
  constructor(public readonly current: number) {
    super("Esta página foi alterada em outra aba ou janela.");
  }
}

export async function saveEditorDocument(input: SaveInput) {
  const doc = await documentOrThrow(input.documentId);
  if (doc.revision !== input.revision) throw new RevisionConflictError(doc.revision);

  // Primeira gravação de um documento importado: guarda o original como versão.
  // Só uma vez por documento (restaurar a "Versão original" volta o projeto para
  // vazio, e a gravação seguinte não pode criar outra cópia dela) e só por quem
  // venceu a checagem de revisão (duas abas na primeira gravação: uma versão).
  // O arquivo é gravado antes (falha de disco não altera nada); a linha, depois.
  let original: { key: string; bytes: number } | null = null;
  if (!doc.project) {
    const hasOriginal = await prisma.pageVersion.findFirst({
      where: { documentId: doc.id, kind: { in: ["CLONE", "IMPORT"] } },
      select: { id: true },
    });
    if (!hasOriginal) {
      original = await writeSnapshot(doc.id, { project: null, html: doc.html, preserve: preserveStateOf(doc) });
    }
  }

  const finalHtml = finalizeFromEditor(input.html, input.css, doc.html);
  // Gravado pelo editor corrigido: nunca passa pelo reparo de páginas antigas.
  const project = withProjectFormat(input.project);
  const next = doc.revision + 1;
  const { count } = await prisma.pageDocument.updateMany({
    where: { id: doc.id, revision: doc.revision },
    data: { project: packProject(project), html: finalHtml, revision: next },
  });
  if (!count) {
    // Outra aba gravou antes (e guardou a versão original, se era a primeira vez).
    if (original) await deleteObject(original.key).catch(() => undefined);
    const current = await prisma.pageDocument.findUnique({ where: { id: doc.id }, select: { revision: true } });
    throw new RevisionConflictError(current?.revision ?? doc.revision);
  }
  if (original) {
    try {
      await insertVersion(doc.id, doc.variant.page.sourceUrl ? "CLONE" : "IMPORT", "Versão original", original);
    } catch (err) {
      // A página já foi salva: não desfaz a gravação por causa do histórico.
      console.error("[editor] versão original:", err);
    }
  }
  const now = new Date();
  await prisma.page.update({ where: { id: doc.variant.page.id }, data: { updatedAt: now } });
  await prisma.offer.update({ where: { id: doc.variant.page.offer.id }, data: { updatedAt: now } });

  // Versão automática de tempos em tempos.
  const lastAuto = await prisma.pageVersion.findFirst({
    where: { documentId: doc.id, kind: "AUTO" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (!lastAuto || Date.now() - lastAuto.createdAt.getTime() > AUTO_VERSION_EVERY_MS) {
    await createVersion(doc.id, "AUTO", null, { project, html: finalHtml });
  }
  return { revision: next, savedAt: now.toISOString() };
}

export const RESTORE_CONFLICT_MESSAGE = "Esta página foi salva em outra aba agora. Tente restaurar de novo.";

/**
 * Volta para uma versão (a situação atual vira uma versão antes, para poder
 * desfazer). A gravação só acontece se ninguém salvou a página no meio: a
 * versão "Antes de restaurar" é exatamente o que estava gravado na revisão lida.
 */
export async function restoreVersion(documentId: string, versionId: string) {
  const doc = await documentOrThrow(documentId);
  const version = await prisma.pageVersion.findFirst({ where: { id: versionId, documentId } });
  if (!version) throw new UserError("Versão não encontrada.");
  const snapshot = await readSnapshot(version.storageKey);
  const before = await createVersion(doc.id, "RESTORE", "Antes de restaurar uma versão", {
    project: doc.project ? unpackProject(doc.project) : null,
    html: doc.html,
    preserve: preserveStateOf(doc),
  });
  const next = doc.revision + 1;
  // Versões com o modo gravado voltam com ele (ex.: "Original com scripts" depois de converter).
  const mode =
    snapshot.preserve === undefined
      ? {}
      : snapshot.preserve === null
        ? { assetMap: Prisma.DbNull, editableHtml: null }
        : {
            assetMap: (snapshot.preserve.assetMap ?? {}) as Prisma.InputJsonValue,
            editableHtml: snapshot.preserve.editableHtml,
          };
  const { count } = await prisma.pageDocument.updateMany({
    where: { id: doc.id, revision: doc.revision },
    data: {
      project: snapshot.project ? packProject(snapshot.project) : null,
      html: snapshot.html,
      ...mode,
      revision: next,
    },
  });
  if (!count) {
    // Outra aba salvou no meio: nada foi restaurado, e a versão "antes" não vale.
    await discardVersion(before.id);
    throw new UserError(RESTORE_CONFLICT_MESSAGE);
  }
  if (snapshot.preserve !== undefined) await syncCloneMode(doc.variant.page.id);
  const now = new Date();
  await prisma.page.update({ where: { id: doc.variant.page.id }, data: { updatedAt: now } });
  await prisma.offer.update({ where: { id: doc.variant.page.offer.id }, data: { updatedAt: now } });
  return { revision: next };
}

// ─── Converter "Preservar JS" para editável ──────────────────────────────────

export const CONVERT_NOT_AVAILABLE =
  "Esta página não tem a cópia editável da clonagem (ela foi salva numa versão antiga do Offer Studio). Clone a página de novo e escolha “Editável”.";
export const CONVERT_CONFLICT_MESSAGE = "Esta página foi salva em outra aba agora. Tente converter de novo.";

/**
 * "Converter para editável": troca a página "Preservar JS" pela cópia editável
 * da mesma clonagem — a página como aparece (animações no estado final, imagens
 * carregadas, vídeos no player comum), sem os scripts do site original. O
 * editor não roda scripts, então abrir o HTML original nele mostraria a página
 * em branco onde os scripts montavam o conteúdo.
 *
 * Vale para a versão A/B inteira (computador e celular juntos). Cada documento
 * ganha duas versões no Histórico: "Original com scripts" (restaurar volta o
 * modo "Preservar JS") e "Versão original" (a cópia editável, antes de editar).
 */
export async function convertToEditable(documentId: string) {
  const doc = await documentOrThrow(documentId);
  if (doc.assetMap === null) return { revision: doc.revision };
  if (!doc.editableHtml) throw new UserError(CONVERT_NOT_AVAILABLE);
  const siblings = await prisma.pageDocument.findMany({
    where: { variantId: doc.variantId, id: { not: doc.id }, editableHtml: { not: null } },
    select: { id: true, revision: true, html: true, project: true, assetMap: true, editableHtml: true },
  });
  let revision = doc.revision;
  for (const d of [doc, ...siblings]) {
    if (d.assetMap === null || !d.editableHtml) continue;
    const before = await createVersion(d.id, "CLONE", "Original com scripts (antes de converter)", {
      project: d.project ? unpackProject(d.project) : null,
      html: d.html,
      preserve: preserveStateOf(d),
    });
    const next = d.revision + 1;
    const { count } = await prisma.pageDocument.updateMany({
      where: { id: d.id, revision: d.revision },
      data: { html: d.editableHtml, project: null, assetMap: Prisma.DbNull, editableHtml: null, revision: next },
    });
    if (!count) {
      await discardVersion(before.id);
      // O documento aberto não mudou: nada foi convertido. Um irmão salvo no meio fica como estava.
      if (d.id === doc.id) throw new UserError(CONVERT_CONFLICT_MESSAGE);
      continue;
    }
    if (d.id === doc.id) revision = next;
    // A primeira gravação no editor não cria outra "Versão original": já existe uma de clonagem.
    await createVersion(d.id, "CLONE", "Versão original (editável)", {
      project: null,
      html: d.editableHtml,
      preserve: null,
    });
  }
  await syncCloneMode(doc.variant.page.id);
  const now = new Date();
  await prisma.page.update({ where: { id: doc.variant.page.id }, data: { updatedAt: now } });
  await prisma.offer.update({ where: { id: doc.variant.page.offer.id }, data: { updatedAt: now } });
  return { revision };
}
