-- Chave da API do gateway de pagamento POR OFERTA (antes: uma só para o app
-- inteiro, em Configurações → Pagamentos). Cada oferta pode cobrar numa conta
-- diferente da Kyvo.
--
-- Funciona com a tabela vazia (banco que aplica esta migração logo depois da
-- de pagamentos) e com uma chave global já salva: ela é copiada, com o
-- resultado do último "Testar conexão", para cada oferta que tem link de
-- pagamento na página (destino "Pagamento na página" ou produto guardado), e a
-- forma global some.

-- DropPrimaryKey
ALTER TABLE "PaymentGateway" DROP CONSTRAINT "PaymentGateway_pkey";

-- AlterTable
ALTER TABLE "PaymentGateway" ADD COLUMN "offerId" TEXT;

-- Copia a chave global para as ofertas com pagamento na página.
INSERT INTO "PaymentGateway" ("offerId", "provider", "apiKeyEnc", "checkedAt", "checkStatus", "createdAt", "updatedAt")
SELECT o."id", g."provider", g."apiKeyEnc", g."checkedAt", g."checkStatus", g."createdAt", g."updatedAt"
FROM "PaymentGateway" g
JOIN "Offer" o ON EXISTS (
    SELECT 1
    FROM "OfferLink" l
    LEFT JOIN "PaymentProduct" p ON p."linkId" = l."id"
    WHERE l."offerId" = o."id"
      AND (l."target" = 'PAYMENT' OR p."provider" = g."provider")
)
WHERE g."offerId" IS NULL;

-- Nada global sobra.
DELETE FROM "PaymentGateway" WHERE "offerId" IS NULL;

-- AlterTable
ALTER TABLE "PaymentGateway" ALTER COLUMN "offerId" SET NOT NULL;

-- AddPrimaryKey
ALTER TABLE "PaymentGateway" ADD CONSTRAINT "PaymentGateway_pkey" PRIMARY KEY ("offerId", "provider");

-- AddForeignKey
ALTER TABLE "PaymentGateway" ADD CONSTRAINT "PaymentGateway_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
