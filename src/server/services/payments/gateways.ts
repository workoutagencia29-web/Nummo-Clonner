/**
 * Contas dos gateways de pagamento (Configurações → Pagamentos): chave da API
 * criptografada no banco (como os tokens dos pixels, src/lib/crypto.ts — entra
 * no backup com a APP_ENCRYPTION_KEY do secrets.json), "Testar conexão" e a
 * leitura da chave para o pagamento.php do ZIP.
 *
 * A chave nunca sai daqui para a tela: o painel recebe só a dica mascarada
 * ("••••••a1b2").
 */
import { decryptSecret, encryptSecret, maskSecret, tryDecryptSecret } from "@/lib/crypto";
import { type Db, prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import type { ConnectionStatus, PaymentGatewayAdapter } from "@/lib/payments/gateway";
import { CONNECTION_MESSAGE, PAYMENT_PROVIDERS, type PaymentProviderId, PROVIDER_LABEL } from "@/lib/payments/rules";
import { kyvoGateway } from "./kyvo";

const ADAPTERS: Record<PaymentProviderId, PaymentGatewayAdapter> = { KYVO: kyvoGateway };

export function gatewayAdapter(provider: PaymentProviderId): PaymentGatewayAdapter {
  return ADAPTERS[provider];
}

export interface PaymentGatewayView {
  provider: PaymentProviderId;
  label: string;
  configured: boolean;
  /** Final da chave ("••••••a1b2"), nunca a chave. */
  keyHint: string | null;
  /** A chave salva não pode ser lida (APP_ENCRYPTION_KEY trocada): cole de novo. */
  keyUnreadable: boolean;
  /** Último "Testar conexão" (ISO) e o resultado. */
  checkedAt: string | null;
  checkStatus: ConnectionStatus | null;
}

const STATUSES = Object.keys(CONNECTION_MESSAGE) as ConnectionStatus[];

function checkStatusOf(v: string | null): ConnectionStatus | null {
  return v && (STATUSES as string[]).includes(v) ? (v as ConnectionStatus) : null;
}

/** Gateways (todos, configurados ou não), na ordem de PAYMENT_PROVIDERS. */
export async function listPaymentGateways(): Promise<PaymentGatewayView[]> {
  const rows = await prisma.paymentGateway.findMany();
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

/** Confere a chave colada (sem rede). Kyvo: kyvo_live_… (ou kyvo_test_…). */
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
  if (provider === "KYVO") {
    if (!/^kyvo_/i.test(key)) {
      throw new UserError("A chave da Kyvo começa com “kyvo_live_”. Confira se copiou a chave da API certa.", "apiKey");
    }
    if (!/^kyvo_[A-Za-z0-9_-]+$/.test(key)) {
      throw new UserError("A chave tem caracteres inválidos. Copie de novo, direto do painel da Kyvo.", "apiKey");
    }
  }
  if (key.length < 20 || key.length > 500) {
    throw new UserError("Essa chave parece incompleta. Copie de novo a chave inteira.", "apiKey");
  }
  return key;
}

export async function savePaymentGatewayKey(provider: PaymentProviderId, raw: string) {
  const key = cleanApiKey(provider, raw);
  const apiKeyEnc = encryptSecret(key);
  await prisma.paymentGateway.upsert({
    where: { provider },
    create: { provider, apiKeyEnc },
    // Chave nova: o teste anterior não vale mais.
    update: { apiKeyEnc, checkedAt: null, checkStatus: null },
  });
}

export async function removePaymentGatewayKey(provider: PaymentProviderId) {
  await prisma.paymentGateway.deleteMany({ where: { provider } });
}

/**
 * Chave da API para uso no servidor (pagamento.php do ZIP). null = não
 * cadastrada; chave ilegível → UserError pedindo para colar de novo.
 */
export async function paymentGatewayKey(provider: PaymentProviderId, db: Db = prisma): Promise<string | null> {
  const row = await db.paymentGateway.findUnique({ where: { provider }, select: { apiKeyEnc: true } });
  if (!row) return null;
  try {
    return decryptSecret(row.apiKeyEnc);
  } catch {
    throw new UserError(
      `Não foi possível ler a chave da ${PROVIDER_LABEL[provider]} salva. Cole a chave de novo em Configurações → Pagamentos.`,
    );
  }
}

export interface ConnectionResult {
  status: ConnectionStatus;
  message: string;
  checkedAt: string;
}

/** "Testar conexão": o servidor do app consulta o gateway com a chave salva. */
export async function testPaymentGateway(provider: PaymentProviderId): Promise<ConnectionResult> {
  const key = await paymentGatewayKey(provider);
  if (!key) throw new UserError(`Cadastre a chave da ${PROVIDER_LABEL[provider]} antes de testar.`);
  const status = await gatewayAdapter(provider).testConnection(key);
  const checkedAt = new Date();
  await prisma.paymentGateway.updateMany({ where: { provider }, data: { checkedAt, checkStatus: status } });
  return { status, message: CONNECTION_MESSAGE[status], checkedAt: checkedAt.toISOString() };
}
