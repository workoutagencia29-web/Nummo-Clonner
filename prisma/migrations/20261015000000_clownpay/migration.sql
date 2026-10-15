-- ClownPay: mais um gateway de PIX em real no checkout do Offer Studio
-- (só ADITIVA: um valor novo no enum PaymentProvider).

-- AlterEnum
ALTER TYPE "PaymentProvider" ADD VALUE 'CLOWNPAY';
