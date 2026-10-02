/**
 * Pasta de backup que já não responde antes de o backup começar (NAS, rede ou
 * disco externo travados): conferir a pasta, limpar temporários, criar a pasta
 * e escolher o nome têm limite de tempo — o pedido falha com mensagem clara em
 * vez de ficar "Fazendo backup" para sempre (com uma restauração esperando
 * atrás dele). A conferência da pasta no worker não usa chamadas síncronas.
 *
 * Simula a pasta travada: as funções de node:fs/promises nunca respondem para
 * caminhos com o marcador.
 */
import { mkdir, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  BACKUP_STALLED_MESSAGE,
  createBackupArchive,
  folderStalled,
  withinStall,
} from "@/server/services/backup/archive";
import { failInterruptedBackups, runBackupJob } from "@/server/services/backup/jobs";
import { BACKUP_SETTING_KEY, folderErrorMessage } from "@/server/services/backup/settings";
import { resetDatabase } from "../setup/per-file";
import { expectUserError } from "./helpers";

const hang = vi.hoisted(() => ({
  marker: "pasta-que-travou",
  calls: [] as string[],
  /** Faz os pedidos travados voltarem (com erro, como um disco de rede que desiste). */
  release: [] as (() => void)[],
  /** Pasta que passa a travar no meio do backup (null: nenhuma). */
  armed: null as string | null,
  /** Chamadas síncronas de node:fs a algo dentro de /Volumes. */
  syncVolumeCalls: [] as string[],
}));

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  const watch =
    <A extends unknown[], R>(name: string, fn: (...args: A) => R) =>
    (...args: A): R => {
      if (String(args[0]).startsWith("/Volumes/")) hang.syncVolumeCalls.push(name);
      return fn(...args);
    };
  const patched = {
    ...real,
    existsSync: watch("existsSync", real.existsSync),
    statSync: watch("statSync", real.statSync as (...a: unknown[]) => unknown),
  };
  return { ...patched, default: patched };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  const wrap =
    <A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>) =>
    (...args: A): Promise<R> => {
      const target = String(args[0]);
      if (target.includes(hang.marker) || (hang.armed !== null && target.startsWith(hang.armed))) {
        hang.calls.push(name);
        return new Promise<R>((_, reject) => {
          hang.release.push(() => reject(Object.assign(new Error("tempo esgotado"), { code: "ETIMEDOUT" })));
        });
      }
      return fn(...args);
    };
  const patched = {
    ...real,
    stat: wrap("stat", real.stat as (...a: unknown[]) => Promise<unknown>),
    lstat: wrap("lstat", real.lstat as (...a: unknown[]) => Promise<unknown>),
    mkdir: wrap("mkdir", real.mkdir as (...a: unknown[]) => Promise<unknown>),
    readdir: wrap("readdir", real.readdir as (...a: unknown[]) => Promise<unknown>),
    realpath: wrap("realpath", real.realpath as (...a: unknown[]) => Promise<unknown>),
    writeFile: wrap("writeFile", real.writeFile as (...a: unknown[]) => Promise<unknown>),
    rm: wrap("rm", real.rm as (...a: unknown[]) => Promise<unknown>),
  };
  return { ...patched, default: patched };
});

let work: string;
let stuck: string;

beforeAll(async () => {
  await resetDatabase();
  work = path.join(os.tmpdir(), `os-backup-stall-${process.pid}`);
  stuck = path.join(work, hang.marker, "Backups");
  await mkdir(work, { recursive: true });
});

afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

/** O disco "volta": os pedidos travados terminam e a pasta é liberada. */
async function releaseHung() {
  // Um pedido que volta com erro pode levar a outro na mesma pasta (a pasta de cima…): até acabar.
  for (let round = 0; round < 50; round++) {
    const pending = hang.release.splice(0);
    if (!pending.length && !folderStalled(stuck)) return;
    for (const release of pending) release();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("pedidos travados não terminaram");
}

afterEach(releaseHung);

describe("pasta de backup que já não responde", () => {
  it("withinStall: desiste com a mensagem do backup travado; sem limite (0), espera", async () => {
    await expectUserError(withinStall(new Promise(() => undefined), 50), BACKUP_STALLED_MESSAGE);
    expect(await withinStall(Promise.resolve(7), 50)).toBe(7);
    expect(await withinStall(new Promise((r) => setTimeout(() => r("ok"), 30)), 0)).toBe("ok");
    await expect(withinStall(Promise.reject(new Error("x")), 50)).rejects.toThrow("x");
  });

  it("criar a pasta e escolher o nome: o vigia vale desde o primeiro acesso", async () => {
    hang.calls = [];
    const started = Date.now();
    await expectUserError(
      createBackupArchive({ folder: stuck, kind: "MANUAL", installId: "os-teste", stallMs: 300 }),
      BACKUP_STALLED_MESSAGE,
    );
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(hang.calls.length).toBeGreaterThan(0);
  });

  it("automático numa pasta escolhida travada: falha com mensagem clara (conferência e limpeza com limite)", async () => {
    await prisma.appSetting.upsert({
      where: { key: BACKUP_SETTING_KEY },
      create: { key: BACKUP_SETTING_KEY, value: { folder: "custom", customPath: stuck, auto: true, hour: 3, keep: 3 } },
      update: { value: { folder: "custom", customPath: stuck, auto: true, hour: 3, keep: 3 } },
    });
    const job = await prisma.backup.create({ data: { kind: "AUTO", status: "RUNNING", startedAt: new Date() } });
    hang.calls = [];
    const started = Date.now();
    await expectUserError(runBackupJob(job.id, { stallMs: 300 }), BACKUP_STALLED_MESSAGE);
    expect(Date.now() - started).toBeLessThan(5_000);
    // A conferência da pasta (fora da pasta de dados) usou as funções que não travam o processo.
    expect(hang.calls[0]).toBe("realpath");
    expect(await prisma.backup.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: "FAILED",
      errorMessage: BACKUP_STALLED_MESSAGE,
    });
  });

  it("só a limpeza dos temporários trava (pasta padrão): também desiste", async () => {
    await prisma.appSetting.deleteMany({ where: { key: BACKUP_SETTING_KEY } });
    const job = await prisma.backup.create({ data: { kind: "MANUAL", status: "RUNNING", startedAt: new Date() } });
    hang.calls = [];
    await expectUserError(runBackupJob(job.id, { folder: stuck, stallMs: 300 }), BACKUP_STALLED_MESSAGE);
    expect(hang.calls[0]).toBe("readdir");
    expect((await prisma.backup.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("FAILED");
  });
  it("pasta que continua travada: a próxima tentativa falha na hora, sem tocar na pasta de novo", async () => {
    await prisma.appSetting.upsert({
      where: { key: BACKUP_SETTING_KEY },
      create: { key: BACKUP_SETTING_KEY, value: { folder: "custom", customPath: stuck, auto: true, hour: 3, keep: 3 } },
      update: { value: { folder: "custom", customPath: stuck, auto: true, hour: 3, keep: 3 } },
    });
    hang.calls = [];
    const first = await prisma.backup.create({ data: { kind: "AUTO", status: "RUNNING", startedAt: new Date() } });
    await expectUserError(runBackupJob(first.id, { stallMs: 300 }), BACKUP_STALLED_MESSAGE);
    // Um pedido ficou preso (uma linha de trabalho de disco do worker ocupada).
    expect(hang.calls).toEqual(["realpath"]);
    expect(folderStalled(stuck)).toBe(true);
    // Outra pasta do mesmo lugar travado (pasta de dentro) também espera.
    expect(folderStalled(path.join(stuck, "sub"))).toBe(true);
    expect(folderStalled(path.join(work, "outra-pasta"))).toBe(false);

    // Automático de hora em hora, “Fazer backup agora”, backup de segurança: falham na hora.
    for (const kind of ["AUTO", "MANUAL", "SAFETY"] as const) {
      const again = await prisma.backup.create({ data: { kind, status: "RUNNING", startedAt: new Date() } });
      const started = Date.now();
      await expectUserError(
        runBackupJob(again.id, kind === "SAFETY" ? { folder: stuck, stallMs: 300 } : { stallMs: 300 }),
        BACKUP_STALLED_MESSAGE,
      );
      expect(Date.now() - started).toBeLessThan(250);
      expect(await prisma.backup.findUniqueOrThrow({ where: { id: again.id } })).toMatchObject({
        status: "FAILED",
        errorMessage: BACKUP_STALLED_MESSAGE,
      });
    }
    await expectUserError(
      createBackupArchive({ folder: stuck, kind: "MANUAL", installId: "os-teste", stallMs: 300 }),
      BACKUP_STALLED_MESSAGE,
    );
    // Ao abrir o worker, a limpeza da pasta também não prende mais um.
    await failInterruptedBackups();
    // Nenhum pedido novo à pasta travada.
    expect(hang.calls).toEqual(["realpath"]);

    // O disco respondeu (mesmo com erro): a pasta é liberada e a próxima tentativa tenta de verdade.
    await releaseHung();
    expect(folderStalled(stuck)).toBe(false);
    hang.calls = [];
    const retry = await prisma.backup.create({ data: { kind: "AUTO", status: "RUNNING", startedAt: new Date() } });
    await expectUserError(runBackupJob(retry.id, { stallMs: 300 }), BACKUP_STALLED_MESSAGE);
    expect(hang.calls).toEqual(["realpath"]);
    await prisma.appSetting.deleteMany({ where: { key: BACKUP_SETTING_KEY } });
  });

  it("pasta que trava no meio do backup: o pedido que não voltou fica registrado e a próxima tentativa falha na hora", async () => {
    const folder = path.join(work, "trava-no-meio");
    hang.calls = [];
    await expectUserError(
      createBackupArchive({
        folder,
        kind: "MANUAL",
        installId: "os-teste",
        stallMs: 300,
        // O disco para de responder bem na conferência do espaço livre.
        freeBytes: () => {
          hang.armed = folder;
          return new Promise<number>(() => undefined);
        },
      }),
      BACKUP_STALLED_MESSAGE,
    );
    // A remoção do temporário também não voltou: a pasta fica marcada.
    expect(hang.calls).toEqual(["rm"]);
    expect(folderStalled(folder)).toBe(true);
    const started = Date.now();
    await expectUserError(
      createBackupArchive({ folder, kind: "MANUAL", installId: "os-teste", stallMs: 300 }),
      BACKUP_STALLED_MESSAGE,
    );
    expect(Date.now() - started).toBeLessThan(250);
    expect(hang.calls).toEqual(["rm"]);
    // O disco voltou: o temporário sai e a pasta é liberada.
    hang.armed = null;
    for (const release of hang.release.splice(0)) release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(folderStalled(folder)).toBe(false);
  }, 30_000);

  it("erro do disco num /Volumes: a mensagem não consulta o próprio disco (que pode estar travado)", async () => {
    const mounted = (await readdir("/Volumes"))[0];
    const timedOut = Object.assign(new Error("tempo esgotado"), { code: "ETIMEDOUT" });
    hang.syncVolumeCalls = [];
    if (mounted) {
      expect(await folderErrorMessage(timedOut, `/Volumes/${mounted}/Backups`)).toMatch(
        /Não foi possível usar essa pasta/,
      );
    }
    expect(await folderErrorMessage(timedOut, "/Volumes/DiscoQueNaoExiste123/Backups")).toMatch(
      /“DiscoQueNaoExiste123” não está conectado/,
    );
    // Nenhuma chamada síncrona ao disco (que congelaria o worker inteiro num disco de rede travado).
    expect(hang.syncVolumeCalls).toEqual([]);
  });
});
