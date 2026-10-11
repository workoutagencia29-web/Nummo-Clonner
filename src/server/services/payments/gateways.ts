/**
 * Conta de cada gateway de pagamento de cada OFERTA (aba "Links e checkouts" →
 * cartões "Pagamento na página — conta da Kyvo desta oferta" e "Checkout do
 * Offer Studio — conta da FlevoPay/BlackCat desta oferta"): chave da API
 * criptografada no banco (como os tokens dos pixels, src/lib/crypto.ts — entra
 * no backup com a APP_ENCRYPTION_KEY do secrets.json), "Testar conexão", "Usar
 * a mesma chave de outra oferta" (copiada criptografada, aqui no servidor) e a
 * leitura da chave para o pagamento.php do ZIP da oferta.
 *
 * A chave nunca sai daqui para a tela: o painel recebe só a dica mascarada
 * ("••••••a1b2").
 */
import { decryptSecret, encryptSecret, maskSecret, tryDecryptSecret } from "@/lib/crypto";
import { type Db, prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import type {
  ConnectionStatus,
  PaymentAccountView,
  PaymentGatewayAdapter,
  PaymentKeySource,
} from "@/lib/payments/gateway";
import {
  CONNECTION_MESSAGE,
  connectionMessage,
  PAYMENT_PROVIDERS,
  type PaymentProviderId,
  PROVIDER_LABEL,
} from "@/lib/payments/rules";
import { blackcatGateway } from "./blackcat";
import { flevopayGateway } from "./flevopay";
import { kyvoGateway } from "./kyvo";

const ADAPTERS: Record<PaymentProviderId, PaymentGatewayAdapter> = {
  KYVO: kyvoGateway,
  FLEVOPAY: flevopayGateway,
  BLACKCAT: blackcatGateway,
};

export function gatewayAdapter(provider: PaymentProviderId): PaymentGatewayAdapter {
  return ADAPTERS[provider];
}

/** Onde a chave fica (texto dos erros). */
export const PAYMENT_ACCOUNT_PLACE = "na aba “Links e checkouts” da oferta";

const STATUSES = Object.keys(CONNECTION_MESSAGE) as ConnectionStatus[];

function checkStatusOf(v: string | null): ConnectionStatus | null {
  return v && (STATUSES as string[]).includes(v) ? (v as ConnectionStatus) : null;
}

const NOT_FOUND = "Oferta não encontrada.";

async function requireOffer(offerId: string, db: Db = prisma) {
  const offer = await db.offer.findFirst({ where: { id: offerId, deletedAt: null }, select: { id: true, name: true } });
  if (!offer) throw new UserError(NOT_FOUND);
  return offer;
}

/** Contas da oferta (todos os gateways, configurados ou não), na ordem de PAYMENT_PROVIDERS. */
export async function offerPaymentAccounts(offerId: string, db: Db = prisma): Promise<PaymentAccountView[]> {
  const rows = await db.paymentGateway.findMany({ where: { offerId } });
  return PAYMENT_PROVIDERS.map((provider) => {
    const row = rows.find((r) => r.provider === provider);
    const key = tryDecryptSecret(row?.apiKeyEnc);
    return {
      provider,
      label: PROVIDER_LABEL[provider],
      configured: Boolean(row),
      keyHint: key ? maskSecret(key) : null,
      keyUnreadable: Boolean(row) && key === null,
      checkedAt: row?.checkedAt?.toISOString() ?? null,
      checkStatus: checkStatusOf(row?.checkStatus ?? null),
    };
  });
}

/** Chave legível da oferta (null = sem chave ou ilegível). */
async function readableKey(offerId: string, provider: PaymentProviderId, db: Db = prisma) {
  const row = await db.paymentGateway.findUnique({
    where: { offerId_provider: { offerId, provider } },
    select: { apiKeyEnc: true },
  });
  return tryDecryptSecret(row?.apiKeyEnc);
}

/** Outras ofertas (fora da lixeira) com chave legível deste gateway, já decifrada (só aqui no servidor). */
async function otherOfferKeys(offerId: string, provider: PaymentProviderId, db: Db = prisma) {
  const rows = await db.paymentGateway.findMany({
    where: { provider, offerId: { not: offerId }, offer: { deletedAt: null } },
    orderBy: [{ offer: { name: "asc" } }, { offerId: "asc" }],
    select: { offerId: true, apiKeyEnc: true, offer: { select: { name: true } } },
  });
  return rows.flatMap((r) => {
    const key = tryDecryptSecret(r.apiKeyEnc);
    return key ? [{ offerId: r.offerId, offerName: r.offer.name, key }] : [];
  });
}

/**
 * Outras ofertas (fora da lixeira) com chave legível deste gateway, para "Usar
 * a mesma chave de outra oferta" e para o aviso do "Trocar chave" (`sameKey`:
 * a mesma chave desta oferta — comparada decifrada, porque a mesma chave colada
 * em duas ofertas fica cifrada diferente). Só o nome e o final mascarado.
 */
export async function paymentKeySources(
  offerId: string,
  provider: PaymentProviderId,
  db: Db = prisma,
): Promise<PaymentKeySource[]> {
  const [own, others] = await Promise.all([readableKey(offerId, provider, db), otherOfferKeys(offerId, provider, db)]);
  return others.map((o) => ({
    offerId: o.offerId,
    offerName: o.offerName,
    keyHint: maskSecret(o.key),
    sameKey: own !== null && o.key === own,
  }));
}

/**
 * Confere a chave colada (sem rede). Kyvo: kyvo_live_… (ou kyvo_test_…).
 * FlevoPay e BlackCat: o formato não é documentado de um jeito que dê para
 * conferir aqui (o "Testar conexão" confere de verdade); só a chave de outro
 * gateway com prefixo conhecido (kyvo_, flevopay_) colada no cartão errado é
 * recusada.
 */
export function cleanApiKey(provider: PaymentProviderId, raw: string): string {
  const key = raw
    .trim()
    .replace(/^Bearer\s+/i, "")
    .replace(/^["']|["']$/g, "");
  if (!key) throw new UserError("Cole a chave da API.", "apiKey");
  if (/\s/.test(key))
    throw new UserError("A chave não pode ter espaços nem quebras de linha. Copie de novo.", "apiKey");
  if (!/^[\x21-\x7e]+$/.test(key)) {
    throw new UserError("A chave tem caracteres inválidos. Copie de novo, direto do painel do gateway.", "apiKey");
  }
  // Chave de outro gateway colada no cartão errado (os prefixos conhecidos: kyvo_ e flevopay_).
  const other = /^kyvo_/i.test(key) ? "KYVO" : /^flevopay_/i.test(key) ? "FLEVOPAY" : null;
  if (other && other !== provider) {
    throw new UserError(
      `Essa é uma chave da ${PROVIDER_LABEL[other]}. Cole aqui a chave da API da ${PROVIDER_LABEL[provider]} (no painel da ${PROVIDER_LABEL[provider]}).`,
      "apiKey",
    );
  }
  if (provider === "KYVO") {
    if (!/^kyvo_/i.test(key)) {
      throw new UserError("A chave da Kyvo começa com “kyvo_live_”. Confira se copiou a chave da API certa.", "apiKey");
    }
    if (!/^kyvo_[A-Za-z0-9_-]+$/.test(key)) {
      throw new UserError("A chave tem caracteres inválidos. Copie de novo, direto do painel da Kyvo.", "apiKey");
    }
  }
  // Kyvo: kyvo_live_ + o segredo; nos outros, o formato não é documentado (só um mínimo que pega a chave cortada).
  if (key.length < (provider === "KYVO" ? 20 : 12) || key.length > 500) {
    throw new UserError("Essa chave parece incompleta. Copie de novo a chave inteira.", "apiKey");
  }
  return key;
}

/**
 * Salva (ou troca) a chave da oferta. `alsoOfferIds` ("Trocar também nelas"):
 * outras ofertas que usavam a MESMA chave desta oferta recebem a nova junto
 * (tudo ou nada). O servidor confere que cada uma ainda tem a chave antiga:
 * uma oferta com outra chave nunca é trocada por aqui.
 */
export async function savePaymentGatewayKey(
  offerId: string,
  provider: PaymentProviderId,
  raw: string,
  alsoOfferIds: string[] = [],
): Promise<{ alsoChanged: number }> {
  const key = cleanApiKey(provider, raw);
  await requireOffer(offerId);
  const others = [...new Set(alsoOfferIds)].filter((id) => id !== offerId);
  const apiKeyEnc = encryptSecret(key);
  return prisma.$transaction(async (tx) => {
    if (others.length) {
      const own = await readableKey(offerId, provider, tx);
      const sharing = new Set(
        (await otherOfferKeys(offerId, provider, tx))
          .filter((o) => own !== null && o.key === own)
          .map((o) => o.offerId),
      );
      if (others.some((id) => !sharing.has(id))) {
        throw new UserError(
          `Alguma das outras ofertas já não usa a mesma chave da ${PROVIDER_LABEL[provider]} desta. Recarregue a página e tente de novo.`,
        );
      }
      // Chave nova: o teste anterior não vale mais.
      await tx.paymentGateway.updateMany({
        where: { provider, offerId: { in: others } },
        data: { apiKeyEnc, checkedAt: null, checkStatus: null },
      });
    }
    await tx.paymentGateway.upsert({
      where: { offerId_provider: { offerId, provider } },
      create: { offerId, provider, apiKeyEnc },
      update: { apiKeyEnc, checkedAt: null, checkStatus: null },
    });
    return { alsoChanged: others.length };
  });
}

export async function removePaymentGatewayKey(offerId: string, provider: PaymentProviderId) {
  await prisma.paymentGateway.deleteMany({ where: { offerId, provider } });
}

/**
 * "Usar a mesma chave de outra oferta": copia a chave criptografada de uma
 * oferta para a outra aqui no servidor (ela nunca passa pelo navegador). O
 * resultado do "Testar conexão" não vem junto: a tela pede para testar de novo.
 */
export async function copyPaymentGatewayKey(input: {
  offerId: string;
  fromOfferId: string;
  provider: PaymentProviderId;
}) {
  const { offerId, fromOfferId, provider } = input;
  const label = PROVIDER_LABEL[provider];
  if (offerId === fromOfferId) throw new UserError("Escolha outra oferta.", "fromOfferId");
  await requireOffer(offerId);
  const source = await prisma.paymentGateway.findFirst({
    where: { offerId: fromOfferId, provider, offer: { deletedAt: null } },
    select: { apiKeyEnc: true, offer: { select: { name: true } } },
  });
  if (!source) throw new UserError(`Essa oferta não tem chave da ${label} salva. Escolha outra.`, "fromOfferId");
  if (!tryDecryptSecret(source.apiKeyEnc)) {
    throw new UserError(
      `A chave da ${label} dessa oferta não pode ser lida neste Mac. Cole a chave aqui, direto do painel da ${label}.`,
      "fromOfferId",
    );
  }
  await prisma.paymentGateway.upsert({
    where: { offerId_provider: { offerId, provider } },
    create: { offerId, provider, apiKeyEnc: source.apiKeyEnc },
    update: { apiKeyEnc: source.apiKeyEnc, checkedAt: null, checkStatus: null },
  });
  return { offerName: source.offer.name };
}

/**
 * Chave da API da oferta para uso no servidor (pagamento.php do ZIP). null =
 * não cadastrada; chave ilegível → UserError pedindo para colar de novo.
 */
export async function paymentGatewayKey(
  offerId: string,
  provider: PaymentProviderId,
  db: Db = prisma,
): Promise<string | null> {
  const row = await db.paymentGateway.findUnique({
    where: { offerId_provider: { offerId, provider } },
    select: { apiKeyEnc: true },
  });
  if (!row) return null;
  try {
    return decryptSecret(row.apiKeyEnc);
  } catch {
    throw new UserError(
      `Não foi possível ler a chave da ${PROVIDER_LABEL[provider]} salva. Cole a chave de novo ${PAYMENT_ACCOUNT_PLACE}.`,
    );
  }
}

export interface ConnectionResult {
  status: ConnectionStatus;
  message: string;
  checkedAt: string;
}

/** "Testar conexão": o servidor do app consulta o gateway com a chave salva na oferta. */
export async function testPaymentGateway(offerId: string, provider: PaymentProviderId): Promise<ConnectionResult> {
  const key = await paymentGatewayKey(offerId, provider);
  if (!key) throw new UserError(`Cadastre a chave da ${PROVIDER_LABEL[provider]} desta oferta antes de testar.`);
  const status = await gatewayAdapter(provider).testConnection(key);
  const checkedAt = new Date();
  await prisma.paymentGateway.updateMany({ where: { offerId, provider }, data: { checkedAt, checkStatus: status } });
  return { status, message: connectionMessage(provider, status), checkedAt: checkedAt.toISOString() };
}
