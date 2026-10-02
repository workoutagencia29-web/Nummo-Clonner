-- DropForeignKey
ALTER TABLE "Asset" DROP CONSTRAINT "Asset_offerId_fkey";

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Usuário único: o banco recusa uma segunda conta mesmo que dois cadastros
-- cheguem ao mesmo tempo (o hook do login mostra a mensagem amigável).
CREATE UNIQUE INDEX "user_singleton" ON "user" ((true));
