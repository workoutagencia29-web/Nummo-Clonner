-- Fase 6 (Backup automático): fila e histórico dos backups (com andamento) e
-- pedidos de restauração. A tabela "Backup" existia desde o início, sem uso.

-- AlterEnum
ALTER TYPE "BackupKind" ADD VALUE 'SAFETY';

-- AlterTable
ALTER TABLE "Backup" ADD COLUMN "progress" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Backup" ADD COLUMN "step" TEXT;
ALTER TABLE "Backup" ADD COLUMN "warnings" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Backup" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Backup" ALTER COLUMN "startedAt" DROP NOT NULL;
ALTER TABLE "Backup" ALTER COLUMN "startedAt" DROP DEFAULT;

-- DropIndex
DROP INDEX "Backup_startedAt_idx";

-- CreateIndex
CREATE INDEX "Backup_status_createdAt_idx" ON "Backup"("status", "createdAt");
CREATE INDEX "Backup_kind_status_finishedAt_idx" ON "Backup"("kind", "status", "finishedAt");

-- CreateTable
CREATE TABLE "BackupRestore" (
    "id" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "step" TEXT,
    "sourcePath" TEXT NOT NULL,
    "accountEmail" TEXT,
    "safetyPath" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "BackupRestore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackupRestore_status_createdAt_idx" ON "BackupRestore"("status", "createdAt");
