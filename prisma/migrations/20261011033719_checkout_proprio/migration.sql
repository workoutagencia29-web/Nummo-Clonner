-- Checkout próprio do Offer Studio (só ADITIVA): destino de link CHECKOUT, PIX
-- em real pela FlevoPay e pela BlackCat (gateways, forma de pagamento e moeda
-- novos) e a tabela do produto do checkout (CheckoutProduct), com a
-- configuração da página em JSON (src/lib/checkout/config.ts).

-- AlterEnum
ALTER TYPE "OfferLinkTarget" ADD VALUE 'CHECKOUT';

-- AlterEnum
ALTER TYPE "PaymentCurrency" ADD VALUE 'BRL';

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'PIX';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentProvider" ADD VALUE 'FLEVOPAY';
ALTER TYPE "PaymentProvider" ADD VALUE 'BLACKCAT';

-- CreateTable
CREATE TABLE "CheckoutProduct" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "name" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" "PaymentCurrency" NOT NULL,
    "methods" "PaymentMethod"[],
    "locale" "PaymentLocale" NOT NULL,
    "thankYouPageId" TEXT,
    "accessUrl" TEXT NOT NULL DEFAULT '',
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutProduct_linkId_key" ON "CheckoutProduct"("linkId");

-- CreateIndex
CREATE INDEX "CheckoutProduct_thankYouPageId_idx" ON "CheckoutProduct"("thankYouPageId");

-- AddForeignKey
ALTER TABLE "CheckoutProduct" ADD CONSTRAINT "CheckoutProduct_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "OfferLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutProduct" ADD CONSTRAINT "CheckoutProduct_thankYouPageId_fkey" FOREIGN KEY ("thankYouPageId") REFERENCES "Page"("id") ON DELETE SET NULL ON UPDATE CASCADE;
