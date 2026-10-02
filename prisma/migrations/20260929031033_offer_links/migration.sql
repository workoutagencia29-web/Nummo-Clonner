-- CreateEnum
CREATE TYPE "OfferLinkKind" AS ENUM ('CHECKOUT', 'UPSELL', 'DOWNSELL', 'WHATSAPP', 'OTHER');

-- CreateTable
CREATE TABLE "OfferLink" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kind" "OfferLinkKind" NOT NULL DEFAULT 'CHECKOUT',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfferLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfferLink_offerId_position_idx" ON "OfferLink"("offerId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "OfferLink_offerId_key_key" ON "OfferLink"("offerId", "key");

-- AddForeignKey
ALTER TABLE "OfferLink" ADD CONSTRAINT "OfferLink_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
