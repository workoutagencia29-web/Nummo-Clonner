-- AlterTable
ALTER TABLE "PageDocument" ADD COLUMN     "assetMap" JSONB;

-- CreateTable
CREATE TABLE "PreviewToken" (
    "id" TEXT NOT NULL,
    "target" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreviewToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PreviewToken_expiresAt_idx" ON "PreviewToken"("expiresAt");
