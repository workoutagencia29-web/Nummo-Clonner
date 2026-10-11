/**
 * Progresso da clonagem (getCloneStatus, o mesmo do GET /api/clone/<id>): a tela
 * de progresso precisa saber se o robô de tarefas está vivo, se outra clonagem
 * está rodando na frente e se esta parou de avançar — antes, "Outra clonagem
 * está em andamento" aparecia sempre na fila, até com o robô parado.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { CloneStatus as JobStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { CLONE_STALL_MS, getCloneStatus } from "@/server/services/clone";
import { WORKER_SILENT_MS } from "@/server/services/export";
import { resetDatabase } from "../setup/per-file";

beforeEach(async () => {
  await resetDatabase();
  await prisma.serviceHeartbeat.deleteMany({ where: { name: "worker" } });
});

async function job(status: JobStatus, data: { updatedAt?: Date; parentJobId?: string } = {}) {
  const row = await prisma.cloneJob.create({
    data: { source: "URL", sourceUrl: "https://site.exemplo.com/", status, parentJobId: data.parentJobId },
    select: { id: true },
  });
  // O @updatedAt do Prisma não aceita valor próprio no create: grava direto.
  if (data.updatedAt) {
    await prisma.$executeRaw`update "CloneJob" set "updatedAt" = ${data.updatedAt} where id = ${row.id}`;
  }
  return row.id;
}

async function heartbeat(ago: number, now: number) {
  await prisma.serviceHeartbeat.upsert({
    where: { name: "worker" },
    create: { name: "worker", lastSeenAt: new Date(now - ago) },
    update: { lastSeenAt: new Date(now - ago) },
  });
}

const info = async (id: string, now: number) => {
  const s = await getCloneStatus(id, 0, { now });
  return { workerOnline: s?.workerOnline, otherRunning: s?.otherRunning, stalled: s?.stalled };
};

describe("getCloneStatus — robô, fila e clonagem parada", () => {
  it("na fila sem sinal de vida do robô (ou com sinal velho): workerOnline false", async () => {
    const now = Date.now();
    const id = await job("QUEUED");
    expect(await info(id, now)).toEqual({ workerOnline: false, otherRunning: false, stalled: false });
    await heartbeat(WORKER_SILENT_MS + 5000, now);
    expect((await info(id, now)).workerOnline).toBe(false);
    await heartbeat(2000, now);
    expect(await info(id, now)).toEqual({ workerOnline: true, otherRunning: false, stalled: false });
  });

  it("na fila com outra clonagem rodando: otherRunning true; sem ela, false", async () => {
    const now = Date.now();
    await heartbeat(1000, now);
    const id = await job("QUEUED");
    const other = await job("RUNNING");
    expect(await info(id, now)).toEqual({ workerOnline: true, otherRunning: true, stalled: false });
    await prisma.cloneJob.update({ where: { id: other }, data: { status: "REVIEW" } });
    expect((await info(id, now)).otherRunning).toBe(false);
    // Uma página do funil rodando (de outra clonagem) também está na frente.
    const parent = await job("REVIEW");
    await job("RUNNING", { parentJobId: parent });
    expect((await info(id, now)).otherRunning).toBe(true);
  });

  it("rodando: ela mesma não conta como 'outra'", async () => {
    const now = Date.now();
    await heartbeat(1000, now);
    const id = await job("RUNNING");
    expect(await info(id, now)).toEqual({ workerOnline: true, otherRunning: false, stalled: false });
  });

  it("rodando sem progresso nem log há mais de 3 minutos: stalled; um log recente tira o aviso", async () => {
    const now = Date.now();
    await heartbeat(1000, now);
    const id = await job("RUNNING", { updatedAt: new Date(now - CLONE_STALL_MS - 10_000) });
    expect(await info(id, now)).toEqual({ workerOnline: true, otherRunning: false, stalled: true });
    // Log antigo não conta como avanço.
    await prisma.cloneLog.create({
      data: { jobId: id, message: "Baixando", at: new Date(now - CLONE_STALL_MS - 5000) },
    });
    expect((await info(id, now)).stalled).toBe(true);
    await prisma.cloneLog.create({ data: { jobId: id, message: "Baixando vídeo", at: new Date(now - 20_000) } });
    expect((await info(id, now)).stalled).toBe(false);
  });

  it("rodando e avançando agora: o robô está vivo mesmo com o sinal de vida atrasado", async () => {
    const now = Date.now();
    await heartbeat(WORKER_SILENT_MS + 15_000, now);
    const id = await job("RUNNING", { updatedAt: new Date(now - 3000) });
    expect((await info(id, now)).workerOnline).toBe(true);
    // Sem avanço recente e sem sinal de vida: parado.
    await prisma.$executeRaw`update "CloneJob" set "updatedAt" = ${new Date(now - 60_000)} where id = ${id}`;
    expect((await info(id, now)).workerOnline).toBe(false);
  });

  it("fora da fila (revisão, falha): nada disso é consultado", async () => {
    const now = Date.now();
    for (const status of ["REVIEW", "FAILED", "CANCELED", "SAVED"] as const) {
      const id = await job(status, { updatedAt: new Date(now - CLONE_STALL_MS * 3) });
      expect(await info(id, now), status).toEqual({ workerOnline: null, otherRunning: false, stalled: false });
    }
  });
});
