-- CreateEnum
CREATE TYPE "OfferLinkTarget" AS ENUM ('URL', 'PAYMENT');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('KYVO');

-- CreateEnum
CREATE TYPE "PaymentCurrency" AS ENUM ('MXN', 'EUR', 'USD');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('SPEI', 'CARD', 'BIZUM', 'MB_WAY');

-- CreateEnum
CREATE TYPE "PaymentLocale" AS ENUM ('ES', 'EN', 'PT');

-- AlterTable
ALTER TABLE "OfferLink" ADD COLUMN     "target" "OfferLinkTarget" NOT NULL DEFAULT 'URL';

-- CreateTable
CREATE TABLE "PaymentGateway" (
    "provider" "PaymentProvider" NOT NULL,
    "apiKeyEnc" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3),
    "checkStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentGateway_pkey" PRIMARY KEY ("provider")
);

-- CreateTable
CREATE TABLE "PaymentProduct" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'KYVO',
    "name" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" "PaymentCurrency" NOT NULL,
    "methods" "PaymentMethod"[],
    "locale" "PaymentLocale" NOT NULL,
    "thankYouPageId" TEXT,
    "accessUrl" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentProduct_linkId_key" ON "PaymentProduct"("linkId");

-- CreateIndex
CREATE INDEX "PaymentProduct_thankYouPageId_idx" ON "PaymentProduct"("thankYouPageId");

-- AddForeignKey
ALTER TABLE "PaymentProduct" ADD CONSTRAINT "PaymentProduct_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "OfferLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProduct" ADD CONSTRAINT "PaymentProduct_thankYouPageId_fkey" FOREIGN KEY ("thankYouPageId") REFERENCES "Page"("id") ON DELETE SET NULL ON UPDATE CASCADE;
