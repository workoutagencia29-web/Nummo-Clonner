-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('DRAFT', 'LIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PageType" AS ENUM ('SALES', 'VSL', 'ADVERTORIAL', 'QUIZ', 'CAPTURE', 'UPSELL', 'DOWNSELL', 'THANK_YOU', 'LEGAL', 'OTHER');

-- CreateEnum
CREATE TYPE "CloneMode" AS ENUM ('EDITABLE', 'PRESERVE_JS');

-- CreateEnum
CREATE TYPE "DeviceTarget" AS ENUM ('ALL', 'DESKTOP', 'MOBILE');

-- CreateEnum
CREATE TYPE "VersionKind" AS ENUM ('AUTO', 'MANUAL', 'CLONE', 'IMPORT', 'RESTORE', 'BULK_REPLACE', 'EXPORT');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('IMAGE', 'FONT', 'VIDEO', 'STYLE', 'SCRIPT', 'ICON', 'DOCUMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "CloneSource" AS ENUM ('URL', 'ZIP', 'HTML');

-- CreateEnum
CREATE TYPE "CloneStatus" AS ENUM ('QUEUED', 'RUNNING', 'REVIEW', 'SAVED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('INFO', 'SUCCESS', 'WARN', 'ERROR');

-- CreateEnum
CREATE TYPE "RemovedCategory" AS ENUM ('PIXEL', 'ANALYTICS', 'TAG_MANAGER', 'CHAT', 'ADS', 'OTHER');

-- CreateEnum
CREATE TYPE "CheckoutSource" AS ENUM ('HREF', 'ONCLICK', 'FORM', 'SCRIPT', 'MANUAL');

-- CreateEnum
CREATE TYPE "PixelVendor" AS ENUM ('META', 'TIKTOK', 'KWAI', 'GA4', 'GOOGLE_ADS', 'UTMIFY');

-- CreateEnum
CREATE TYPE "TrackingEvent" AS ENUM ('PAGE_VIEW', 'VIEW_CONTENT', 'INITIATE_CHECKOUT', 'LEAD');

-- CreateEnum
CREATE TYPE "EventTrigger" AS ENUM ('PAGE_LOAD', 'TIME_ON_PAGE', 'SCROLL_DEPTH', 'CHECKOUT_CLICK', 'ELEMENT_CLICK', 'FORM_SUBMIT');

-- CreateEnum
CREATE TYPE "PixelTestStatus" AS ENUM ('LOADED', 'FIRED', 'BLOCKED', 'ERROR');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "BackupKind" AS ENUM ('AUTO', 'MANUAL');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rateLimit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "rateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'slate',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferTag" (
    "offerId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "OfferTag_pkey" PRIMARY KEY ("offerId","tagId")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "status" "OfferStatus" NOT NULL DEFAULT 'DRAFT',
    "liveUrl" TEXT,
    "sourceUrl" TEXT,
    "folderId" TEXT,
    "thumbnailKey" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "tracking" JSONB NOT NULL DEFAULT '{}',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Page" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" "PageType" NOT NULL DEFAULT 'SALES',
    "position" INTEGER NOT NULL DEFAULT 0,
    "isHome" BOOLEAN NOT NULL DEFAULT false,
    "cloneMode" "CloneMode" NOT NULL DEFAULT 'EDITABLE',
    "sourceUrl" TEXT,
    "seo" JSONB NOT NULL DEFAULT '{}',
    "customCode" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageVariant" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT,
    "isControl" BOOLEAN NOT NULL DEFAULT false,
    "weight" INTEGER NOT NULL DEFAULT 100,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PageVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageDocument" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "device" "DeviceTarget" NOT NULL DEFAULT 'ALL',
    "html" TEXT,
    "project" BYTEA,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PageDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "kind" "VersionKind" NOT NULL,
    "label" TEXT,
    "storageKey" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "offerId" TEXT,
    "sha256" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "originalName" TEXT,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloneJob" (
    "id" TEXT NOT NULL,
    "source" "CloneSource" NOT NULL,
    "sourceUrl" TEXT,
    "uploadKey" TEXT,
    "options" JSONB NOT NULL DEFAULT '{}',
    "status" "CloneStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "step" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "result" JSONB,
    "bossJobId" TEXT,
    "parentJobId" TEXT,
    "offerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "CloneJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloneLog" (
    "id" SERIAL NOT NULL,
    "jobId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" "LogLevel" NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "url" TEXT,
    "bytes" INTEGER,

    CONSTRAINT "CloneLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemovedItem" (
    "id" TEXT NOT NULL,
    "jobId" TEXT,
    "pageId" TEXT,
    "vendor" TEXT NOT NULL,
    "category" "RemovedCategory" NOT NULL,
    "pixelId" TEXT,
    "snippet" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "restored" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemovedItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckoutLink" (
    "id" TEXT NOT NULL,
    "jobId" TEXT,
    "pageId" TEXT,
    "platform" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "source" "CheckoutSource" NOT NULL,
    "confidence" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckoutLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PixelConfig" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "vendor" "PixelVendor" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "pixelId" TEXT NOT NULL,
    "label" TEXT,
    "accessTokenEnc" TEXT,
    "testEventCode" TEXT,
    "options" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PixelConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventRule" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "pageId" TEXT,
    "event" "TrackingEvent" NOT NULL,
    "trigger" "EventTrigger" NOT NULL,
    "value" INTEGER,
    "selector" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PixelTestSession" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "pageId" TEXT,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PixelTestSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PixelTestEvent" (
    "id" SERIAL NOT NULL,
    "sessionId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vendor" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "status" "PixelTestStatus" NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "PixelTestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Export" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "options" JSONB NOT NULL DEFAULT '{}',
    "fileKey" TEXT,
    "bytes" INTEGER,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Export_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Backup" (
    "id" TEXT NOT NULL,
    "kind" "BackupKind" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "filePath" TEXT,
    "bytes" BIGINT,
    "offerCount" INTEGER,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Backup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ServiceHeartbeat" (
    "name" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "info" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "ServiceHeartbeat_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "rateLimit_key_key" ON "rateLimit"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Folder_nameKey_key" ON "Folder"("nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_nameKey_key" ON "Tag"("nameKey");

-- CreateIndex
CREATE INDEX "OfferTag_tagId_idx" ON "OfferTag"("tagId");

-- CreateIndex
CREATE INDEX "Offer_folderId_idx" ON "Offer"("folderId");

-- CreateIndex
CREATE INDEX "Offer_deletedAt_updatedAt_idx" ON "Offer"("deletedAt", "updatedAt");

-- CreateIndex
CREATE INDEX "Offer_status_idx" ON "Offer"("status");

-- CreateIndex
CREATE INDEX "Page_offerId_position_idx" ON "Page"("offerId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Page_offerId_slug_key" ON "Page"("offerId", "slug");

-- CreateIndex
CREATE INDEX "PageVariant_pageId_idx" ON "PageVariant"("pageId");

-- CreateIndex
CREATE UNIQUE INDEX "PageVariant_pageId_name_key" ON "PageVariant"("pageId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PageDocument_variantId_device_key" ON "PageDocument"("variantId", "device");

-- CreateIndex
CREATE INDEX "PageVersion_documentId_createdAt_idx" ON "PageVersion"("documentId", "createdAt");

-- CreateIndex
CREATE INDEX "Asset_offerId_kind_idx" ON "Asset"("offerId", "kind");

-- CreateIndex
CREATE INDEX "Asset_sha256_idx" ON "Asset"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_offerId_key_key" ON "Asset"("offerId", "key");

-- CreateIndex
CREATE INDEX "CloneJob_status_createdAt_idx" ON "CloneJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CloneJob_parentJobId_idx" ON "CloneJob"("parentJobId");

-- CreateIndex
CREATE INDEX "CloneJob_offerId_idx" ON "CloneJob"("offerId");

-- CreateIndex
CREATE INDEX "CloneLog_jobId_id_idx" ON "CloneLog"("jobId", "id");

-- CreateIndex
CREATE INDEX "RemovedItem_jobId_idx" ON "RemovedItem"("jobId");

-- CreateIndex
CREATE INDEX "RemovedItem_pageId_idx" ON "RemovedItem"("pageId");

-- CreateIndex
CREATE INDEX "CheckoutLink_jobId_idx" ON "CheckoutLink"("jobId");

-- CreateIndex
CREATE INDEX "CheckoutLink_pageId_idx" ON "CheckoutLink"("pageId");

-- CreateIndex
CREATE INDEX "PixelConfig_offerId_idx" ON "PixelConfig"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX "PixelConfig_offerId_vendor_pixelId_key" ON "PixelConfig"("offerId", "vendor", "pixelId");

-- CreateIndex
CREATE INDEX "EventRule_offerId_idx" ON "EventRule"("offerId");

-- CreateIndex
CREATE INDEX "EventRule_pageId_idx" ON "EventRule"("pageId");

-- CreateIndex
CREATE UNIQUE INDEX "PixelTestSession_token_key" ON "PixelTestSession"("token");

-- CreateIndex
CREATE INDEX "PixelTestSession_offerId_idx" ON "PixelTestSession"("offerId");

-- CreateIndex
CREATE INDEX "PixelTestEvent_sessionId_id_idx" ON "PixelTestEvent"("sessionId", "id");

-- CreateIndex
CREATE INDEX "Export_offerId_createdAt_idx" ON "Export"("offerId", "createdAt");

-- CreateIndex
CREATE INDEX "Backup_startedAt_idx" ON "Backup"("startedAt");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferTag" ADD CONSTRAINT "OfferTag_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferTag" ADD CONSTRAINT "OfferTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageVariant" ADD CONSTRAINT "PageVariant_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageDocument" ADD CONSTRAINT "PageDocument_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "PageVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageVersion" ADD CONSTRAINT "PageVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "PageDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloneJob" ADD CONSTRAINT "CloneJob_parentJobId_fkey" FOREIGN KEY ("parentJobId") REFERENCES "CloneJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloneJob" ADD CONSTRAINT "CloneJob_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloneLog" ADD CONSTRAINT "CloneLog_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "CloneJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemovedItem" ADD CONSTRAINT "RemovedItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "CloneJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemovedItem" ADD CONSTRAINT "RemovedItem_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutLink" ADD CONSTRAINT "CheckoutLink_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "CloneJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutLink" ADD CONSTRAINT "CheckoutLink_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PixelConfig" ADD CONSTRAINT "PixelConfig_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRule" ADD CONSTRAINT "EventRule_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRule" ADD CONSTRAINT "EventRule_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PixelTestSession" ADD CONSTRAINT "PixelTestSession_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PixelTestEvent" ADD CONSTRAINT "PixelTestEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PixelTestSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Export" ADD CONSTRAINT "Export_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Regras que o schema do Prisma não expressa (índices parciais e CHECKs).
-- ─────────────────────────────────────────────────────────────────────────────

-- Uma única página inicial por oferta.
CREATE UNIQUE INDEX "Page_one_home_per_offer" ON "Page"("offerId") WHERE "isHome";

-- Uma única variação de controle por página.
CREATE UNIQUE INDEX "PageVariant_one_control_per_page" ON "PageVariant"("pageId") WHERE "isControl";

-- Slugs sempre em minúsculas, só letras, números e hífen.
ALTER TABLE "Page" ADD CONSTRAINT "Page_slug_format"
  CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("slug") <= 80);

-- Pesos do divisor A/B entre 0 e 100.
ALTER TABLE "PageVariant" ADD CONSTRAINT "PageVariant_weight_range" CHECK ("weight" BETWEEN 0 AND 100);

-- Progresso sempre entre 0 e 100.
ALTER TABLE "CloneJob" ADD CONSTRAINT "CloneJob_progress_range" CHECK ("progress" BETWEEN 0 AND 100);
ALTER TABLE "Export" ADD CONSTRAINT "Export_progress_range" CHECK ("progress" BETWEEN 0 AND 100);
