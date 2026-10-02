/**
 * Fase 3 — correções do grupo S nos documentos e versões do editor:
 * - #4: ofertas na lixeira não ganham versões manuais (serviço e rota);
 * - #12: o editor recebe o modo da clonagem (cloneMode) para travar "Preservar JS";
 * - #19: restaurar versão só grava se ninguém salvou no meio (sem revisão repetida);
 * - #20: versões podadas e documentos excluídos não deixam arquivos no disco;
 * - #21: restaurar a "Versão original" não cria outra "Versão original".
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, rm, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, beforeVersionWrite } = vi.hoisted(() => ({
  getSession: vi.fn(),
  /** Gancho: roda antes de gravar o próximo arquivo de versão (simula outra aba salvando). */
  beforeVersionWrite: { fn: null as null | (() => Promise<void>) },
}));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("@/lib/storage", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/storage")>();
  return {
    ...original,
    putObject: async (key: string, data: Uint8Array | string) => {
      const hook = beforeVersionWrite.fn;
      if (hook && key.startsWith("versions/")) {
        beforeVersionWrite.fn = null;
        await hook();
      }
      return original.putObject(key, data);
    },
  };
});

import { POST as createVersionRoute } from "@/app/api/documents/[id]/versions/route";
import { prisma } from "@/lib/db";
import { storagePath } from "@/lib/storage";
import { cleanupCloneArtifacts, describeCleanup, removeOrphanVersionFiles } from "@/server/services/clone-cleanup";
import {
  createVersion,
  getEditorPayload,
  listVersions,
  RESTORE_CONFLICT_MESSAGE,
  RevisionConflictError,
  restoreVersion,
  saveEditorDocument,
} from "@/server/services/documents";
import { createOffer, deleteOfferForever, emptyTrash, trashOffer } from "@/server/services/offers";
import { createPage, deletePage } from "@/server/services/pages";
import { resetDatabase } from "../setup/per-file";
import { catchError, expectUserError } from "./helpers";

const HOST = `localhost:${process.env.PORT || "3000"}`;
const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await resetDatabase();
  beforeVersionWrite.fn = null;
  getSession.mockReset();
  getSession.mockResolvedValue({ user: { id: "u1" }, session: { id: "s1" } });
});

const touchedDocs = new Set<string>();
afterAll(async () => {
  const { removeVersionFiles } = await import("@/server/services/documents");
  await removeVersionFiles(touchedDocs);
});

async function newDoc(name = "Oferta") {
  const offer = await createOffer({ name });
  const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { page: { offerId: offer.id } } } });
  touchedDocs.add(doc.id);
  return { offerId: offer.id, docId: doc.id };
}

function save(documentId: string, revision: number, body: string) {
  return saveEditorDocument({
    documentId,
    revision,
    project: { pages: [{ component: body }] },
    html: `<!doctype html><html><head></head><body><p>${body}</p></body></html>`,
    css: "",
  });
}

async function versionFiles(documentId: string) {
  try {
    return (await readdir(storagePath(`versions/${documentId}`))).map((f) => `versions/${documentId}/${f}`).sort();
  } catch {
    return [];
  }
}

async function versionKeys(documentId: string) {
  return (await prisma.pageVersion.findMany({ where: { documentId }, select: { storageKey: true } }))
    .map((v) => v.storageKey)
    .sort();
}

function readSnapshotFile(key: string) {
  return JSON.parse(gunzipSync(readFileSync(storagePath(key))).toString("utf8")) as {
    project: unknown;
    html: string | null;
  };
}

// ─── #21 ─────────────────────────────────────────────────────────────────────

describe("Versão original (#21)", () => {
  it("restaurar a versão original e salvar de novo não cria outra 'Versão original'", async () => {
    const { docId } = await newDoc();
    const first = await save(docId, 0, "v1");
    const original = (await listVersions(docId)).find((v) => v.kind === "IMPORT");
    expect(original?.label).toBe("Versão original");

    const restored = await restoreVersion(docId, original?.id as string);
    expect(restored.revision).toBe(first.revision + 1);
    const payload = await getEditorPayload(docId);
    expect(payload.project).toBeNull(); // volta pelo caminho da primeira abertura

    await save(docId, payload.revision, "v2");
    const again = await restoreVersion(docId, original?.id as string);
    await save(docId, again.revision, "v3");

    const kinds = (await listVersions(docId)).map((v) => v.kind);
    expect(kinds.filter((k) => k === "IMPORT" || k === "CLONE")).toHaveLength(1);
    expect(kinds.filter((k) => k === "RESTORE")).toHaveLength(2);
    // Cada linha tem o seu arquivo, e nenhum arquivo ficou sem linha.
    expect(await versionFiles(docId)).toEqual(await versionKeys(docId));
  });

  it("duas abas fazendo a primeira gravação ao mesmo tempo: uma 'Versão original' só", async () => {
    const { docId } = await newDoc();
    const results = await Promise.allSettled([save(docId, 0, "aba A"), save(docId, 0, "aba B")]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(RevisionConflictError);

    const originals = await prisma.pageVersion.count({
      where: { documentId: docId, kind: { in: ["CLONE", "IMPORT"] } },
    });
    expect(originals).toBe(1);
    expect(await versionFiles(docId)).toEqual(await versionKeys(docId));
  });

  it("página clonada: a original é do tipo CLONE e também só aparece uma vez", async () => {
    const { docId } = await newDoc();
    const doc = await prisma.pageDocument.findUniqueOrThrow({ where: { id: docId }, include: { variant: true } });
    await prisma.page.update({ where: { id: doc.variant.pageId }, data: { sourceUrl: "https://site.com" } });
    const r1 = await save(docId, 0, "v1");
    const original = (await listVersions(docId)).find((v) => v.kind === "CLONE");
    expect(original).toBeTruthy();
    const back = await restoreVersion(docId, original?.id as string);
    await save(docId, back.revision, "v2");
    expect(r1.revision).toBe(1);
    expect(await prisma.pageVersion.count({ where: { documentId: docId, kind: "CLONE" } })).toBe(1);
  });
});

// ─── #19 ─────────────────────────────────────────────────────────────────────

describe("restaurar versão com outra aba salvando (#19)", () => {
  it("se outra aba salva no meio da restauração, nada é sobrescrito e a restauração é recusada", async () => {
    const { docId } = await newDoc();
    await save(docId, 0, "v1");
    const r2 = await save(docId, 1, "v2");
    const target = (await listVersions(docId)).find((v) => v.kind === "IMPORT");

    // Aba B salva exatamente enquanto a restauração grava a versão "antes".
    let tabB: { revision: number } | null = null;
    beforeVersionWrite.fn = async () => {
      tabB = await save(docId, r2.revision, "aba B");
    };
    const err = await expectUserError(restoreVersion(docId, target?.id as string), RESTORE_CONFLICT_MESSAGE);
    expect(err).toBeTruthy();
    expect(tabB).not.toBeNull();

    // O que a aba B salvou continua lá, com a revisão dela.
    const doc = await prisma.pageDocument.findUniqueOrThrow({ where: { id: docId } });
    expect(doc.html).toContain("aba B");
    expect(doc.revision).toBe((tabB as unknown as { revision: number }).revision);
    // A versão "Antes de restaurar" da tentativa recusada não fica na lista (nem no disco).
    expect(await prisma.pageVersion.count({ where: { documentId: docId, kind: "RESTORE" } })).toBe(0);
    expect(await versionFiles(docId)).toEqual(await versionKeys(docId));

    // Tentando de novo, funciona — e a versão "antes" guarda exatamente o que a aba B salvou.
    const ok = await restoreVersion(docId, target?.id as string);
    expect(ok.revision).toBe(doc.revision + 1);
    const before = await prisma.pageVersion.findFirstOrThrow({ where: { documentId: docId, kind: "RESTORE" } });
    expect(readSnapshotFile(before.storageKey).html).toContain("aba B");
  });

  it("depois de restaurar, uma aba com a revisão antiga recebe conflito (a revisão nunca se repete)", async () => {
    const { docId } = await newDoc();
    const r1 = await save(docId, 0, "v1");
    const auto = (await listVersions(docId)).find((v) => v.kind === "AUTO");
    const restored = await restoreVersion(docId, auto?.id as string);
    expect(restored.revision).toBe(r1.revision + 1);
    const err = await catchError(save(docId, r1.revision, "aba antiga"));
    expect(err).toBeInstanceOf(RevisionConflictError);
    expect((err as RevisionConflictError).current).toBe(restored.revision);
    const doc = await prisma.pageDocument.findUniqueOrThrow({ where: { id: docId } });
    expect(doc.html).toContain("v1");
  });

  it("arquivo da versão sumiu: mensagem clara em português", async () => {
    const { docId } = await newDoc();
    await save(docId, 0, "v1");
    const v = await prisma.pageVersion.findFirstOrThrow({ where: { documentId: docId, kind: "IMPORT" } });
    await rm(storagePath(v.storageKey));
    await expectUserError(
      restoreVersion(docId, v.id),
      "O arquivo desta versão não foi encontrado. Escolha outra versão.",
    );
  });
});

// ─── #4 ──────────────────────────────────────────────────────────────────────

describe("ofertas na lixeira (#4)", () => {
  it("createVersion sem snapshot recusa documento de oferta na lixeira e não grava nada", async () => {
    const { offerId, docId } = await newDoc();
    await trashOffer(offerId);
    await expectUserError(
      createVersion(docId, "MANUAL", "Minha versão"),
      "Página não encontrada. Ela pode ter sido excluída.",
    );
    expect(await prisma.pageVersion.count({ where: { documentId: docId } })).toBe(0);
    expect(await versionFiles(docId)).toEqual([]);
  });

  it("POST /api/documents/<id>/versions: 400 em oferta na lixeira, 200 fora dela", async () => {
    const { offerId, docId } = await newDoc();
    const post = () =>
      createVersionRoute(
        new Request(`http://${HOST}/api/documents/${docId}/versions`, {
          method: "POST",
          headers: { host: HOST, "content-type": "application/json" },
          body: JSON.stringify({ label: "Antes da headline" }),
        }),
        { params: Promise.resolve({ id: docId }) },
      );
    const ok = await post();
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ kind: "MANUAL", label: "Antes da headline" });

    await trashOffer(offerId);
    const refused = await post();
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: "Página não encontrada. Ela pode ter sido excluída." });
    expect(await prisma.pageVersion.count({ where: { documentId: docId } })).toBe(1);
  });
});

// ─── #12 ─────────────────────────────────────────────────────────────────────

describe("modo da clonagem no editor (#12)", () => {
  it("getEditorPayload informa cloneMode (EDITABLE por padrão, PRESERVE_JS nas páginas com scripts)", async () => {
    const { docId } = await newDoc();
    expect((await getEditorPayload(docId)).cloneMode).toBe("EDITABLE");
    const doc = await prisma.pageDocument.findUniqueOrThrow({ where: { id: docId }, include: { variant: true } });
    await prisma.page.update({ where: { id: doc.variant.pageId }, data: { cloneMode: "PRESERVE_JS" } });
    // Documento sem os arquivos originais (versão A/B de um modelo ou em branco): editável.
    expect((await getEditorPayload(docId)).cloneMode).toBe("EDITABLE");
    // Documento da clonagem "Preservar JS" (com assetMap, mesmo vazio): travado.
    await prisma.pageDocument.update({ where: { id: docId }, data: { assetMap: {} } });
    expect((await getEditorPayload(docId)).cloneMode).toBe("PRESERVE_JS");
  });
});

// ─── #20 ─────────────────────────────────────────────────────────────────────

describe("arquivos de versão no disco (#20)", () => {
  it("versões automáticas podadas (mais de 50) levam o arquivo junto", async () => {
    const { docId } = await newDoc();
    const created: string[] = [];
    for (let i = 0; i < 53; i++) {
      const v = await createVersion(docId, "AUTO", null, { project: { i }, html: `<p>${i}</p>` });
      created.push(v.id);
    }
    await createVersion(docId, "MANUAL", "Minha", { project: null, html: "<p>m</p>" });
    const rows = await prisma.pageVersion.findMany({ where: { documentId: docId }, select: { id: true, kind: true } });
    expect(rows.filter((r) => r.kind === "AUTO")).toHaveLength(50);
    expect(rows.some((r) => r.id === created[0])).toBe(false);
    expect(rows.some((r) => r.id === created[52])).toBe(true);
    expect(await versionFiles(docId)).toEqual(await versionKeys(docId));
    expect(await versionFiles(docId)).toHaveLength(51);
  });

  it("excluir a página apaga a pasta de versões dela (e só a dela)", async () => {
    const { offerId, docId: homeDoc } = await newDoc();
    const other = await createPage({ offerId, name: "Obrigado" });
    const otherDoc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId: other.id } } });
    touchedDocs.add(otherDoc.id);
    await save(otherDoc.id, 0, "obrigado");
    await save(homeDoc, 0, "principal");
    expect((await versionFiles(otherDoc.id)).length).toBeGreaterThan(0);

    await deletePage(other.id);
    expect(existsSync(storagePath(`versions/${otherDoc.id}`))).toBe(false);
    expect((await versionFiles(homeDoc)).length).toBeGreaterThan(0);
  });

  it("excluir a oferta de vez e esvaziar a lixeira apagam as pastas de versões", async () => {
    const a = await newDoc("A");
    const b = await newDoc("B");
    const c = await newDoc("C (fica)");
    for (const d of [a, b, c]) await save(d.docId, 0, "x");
    await trashOffer(a.offerId);
    await trashOffer(b.offerId);

    await deleteOfferForever(a.offerId);
    expect(existsSync(storagePath(`versions/${a.docId}`))).toBe(false);
    expect(existsSync(storagePath(`versions/${b.docId}`))).toBe(true);

    expect(await emptyTrash()).toBe(1);
    expect(existsSync(storagePath(`versions/${b.docId}`))).toBe(false);
    // A oferta fora da lixeira não perde nada.
    expect(await versionFiles(c.docId)).toEqual(await versionKeys(c.docId));
    expect((await versionFiles(c.docId)).length).toBeGreaterThan(0);
  });

  it("limpeza automática recolhe arquivos de versão sem linha (antigos), nunca os em uso ou recentes", async () => {
    const { docId } = await newDoc();
    await save(docId, 0, "v1");
    const [used] = await versionKeys(docId);

    const old = Date.now() - 3 * DAY;
    const age = (full: string) => utimes(full, old / 1000, old / 1000);
    const write = async (key: string) => {
      const full = storagePath(key);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, "x");
      return full;
    };
    // Documento que existe: um arquivo solto antigo, um recente e um .tmp antigo.
    const looseOld = await write(`versions/${docId}/solto-antigo.json.gz`);
    const looseNew = await write(`versions/${docId}/solto-recente.json.gz`);
    const tmpOld = await write(`versions/${docId}/x.json.gz.123.tmp`);
    // Documento que não existe mais (página excluída antes desta correção).
    const ghostId = `cfix3sfantasma${Date.now().toString(36)}`;
    touchedDocs.add(ghostId);
    const ghost = await write(`versions/${ghostId}/antigo.json.gz`);
    for (const f of [looseOld, tmpOld, ghost, storagePath(used)]) await age(f);

    const report = await removeOrphanVersionFiles(Date.now() - DAY);
    expect(report.files).toBeGreaterThanOrEqual(3);
    expect(existsSync(looseOld)).toBe(false);
    expect(existsSync(tmpOld)).toBe(false);
    expect(existsSync(ghost)).toBe(false);
    expect(existsSync(path.dirname(ghost))).toBe(false);
    // Em uso (mesmo antigo) e recente: ficam.
    expect(existsSync(storagePath(used))).toBe(true);
    expect(existsSync(looseNew)).toBe(true);
    // A versão continua restaurável.
    const v = await prisma.pageVersion.findFirstOrThrow({ where: { storageKey: used } });
    await expect(restoreVersion(docId, v.id)).resolves.toMatchObject({ revision: 2 });
  });

  it("a limpeza automática do worker inclui os arquivos de versão sem dono (e diz no log)", async () => {
    const ghostId = `cfix3sfantasmb${Date.now().toString(36)}`;
    touchedDocs.add(ghostId);
    const full = storagePath(`versions/${ghostId}/antigo.json.gz`);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, "x".repeat(2048));
    const old = (Date.now() - 3 * DAY) / 1000;
    await utimes(full, old, old);

    const report = await cleanupCloneArtifacts();
    expect(existsSync(full)).toBe(false);
    expect(report.versions).toBeGreaterThanOrEqual(1);
    expect(describeCleanup(report)).toMatch(/arquivos? de versões antigas ou de páginas excluídas/);
    expect(describeCleanup({ ...report, jobs: 0, uploads: 0, assets: 0, tmp: 0, versions: 1, bytes: 2048 })).toBe(
      "Limpeza automática: 1 arquivo de versões antigas ou de páginas excluídas (2 KB liberados).",
    );
  });
});
