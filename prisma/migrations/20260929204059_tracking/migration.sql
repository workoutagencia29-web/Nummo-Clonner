-- Fase 4 (pixels e rastreamento).

-- Eventos novos das regras (CompleteRegistration, Contact, AddToCart, Purchase).
ALTER TYPE "TrackingEvent" ADD VALUE IF NOT EXISTS 'COMPLETE_REGISTRATION';
ALTER TYPE "TrackingEvent" ADD VALUE IF NOT EXISTS 'CONTACT';
ALTER TYPE "TrackingEvent" ADD VALUE IF NOT EXISTS 'ADD_TO_CART';
ALTER TYPE "TrackingEvent" ADD VALUE IF NOT EXISTS 'PURCHASE';

-- Tela "Testar pixels": contador de eventos recebidos (limite por sessão, sem count(*)).
ALTER TABLE "PixelTestSession" ADD COLUMN "eventCount" INTEGER NOT NULL DEFAULT 0;

-- Limpeza das sessões de teste vencidas.
CREATE INDEX "PixelTestSession_expiresAt_idx" ON "PixelTestSession"("expiresAt");

-- Regras de uma oferta listadas por data de criação.
CREATE INDEX "EventRule_offerId_createdAt_idx" ON "EventRule"("offerId", "createdAt");
DROP INDEX "EventRule_offerId_idx";
