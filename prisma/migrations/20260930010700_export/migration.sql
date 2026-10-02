-- Fase 5 (Download ZIP): etapa, nome do arquivo, avisos e início de cada exportação.
ALTER TABLE "Export" ADD COLUMN "step" TEXT;
ALTER TABLE "Export" ADD COLUMN "fileName" TEXT;
ALTER TABLE "Export" ADD COLUMN "warnings" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Export" ADD COLUMN "startedAt" TIMESTAMP(3);

-- Fila do worker (status = 'QUEUED' em ordem de criação).
CREATE INDEX "Export_status_createdAt_idx" ON "Export"("status", "createdAt");
