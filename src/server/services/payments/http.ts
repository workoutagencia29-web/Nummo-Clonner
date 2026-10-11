/**
 * Conversa HTTP com os gateways de PIX (FlevoPay, BlackCat): endereço base que
 * só troca para um servidor deste Mac (os servidores falsos dos testes, como o
 * OS_KYVO_API_BASE da Kyvo), JSON com tempo limite e sem seguir redirecionamento.
 * A chave nunca vai para log nem para mensagem de erro.
 */
import { type ConnectionStatus, type GatewayErrorCode, PaymentGatewayError } from "@/lib/payments/gateway";

const TIMEOUT_MS = 20_000;
const LOCAL_HOSTS = ["127.0.0.1", "localhost", "[::1]"];

/**
 * Endereço base da API: o de verdade, ou o da variável `envName` quando ela
 * aponta para este Mac (127.0.0.1/localhost — os testes). Qualquer outro
 * endereço na variável é ignorado (com aviso): ninguém desvia a cobrança.
 */
export function gatewayApiBase(envName: string, real: string, label: string): string {
  const override = process.env[envName]?.trim();
  if (override) {
    try {
      const url = new URL(override);
      if (/^https?:$/.test(url.protocol) && LOCAL_HOSTS.includes(url.hostname)) return url.href.replace(/\/+$/, "");
    } catch {
      // inválido: usa o gateway de verdade
    }
    console.warn(`[pagamentos] ${envName} ignorado: só é aceito um endereço deste Mac (testes da ${label}).`);
  }
  return real;
}

export interface GatewayResponse {
  status: number;
  ok: boolean;
  body: unknown;
}

/** Faz a chamada e lê o JSON (sem conexão / tempo esgotado → PaymentGatewayError "network"). */
export async function gatewayFetch(
  url: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: unknown },
): Promise<GatewayResponse> {
  const headers: Record<string, string> = { Accept: "application/json", ...init.headers };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    });
  } catch {
    throw new PaymentGatewayError("network");
  }
  const text = await res.text().catch(() => "");
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, ok: res.ok, body };
}

/** Código de erro pelo status HTTP (o mesmo para os gateways de PIX). */
export function httpErrorCode(status: number): GatewayErrorCode {
  if (status === 401) return "invalid_key";
  if (status === 403) return "missing_scope";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429 || status >= 500) return "unavailable";
  if (status >= 400) return "invalid_request";
  return "unexpected";
}

export const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const strOr = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

/** Valor em centavos (número inteiro ≥ 0, ou texto só com algarismos). */
export function centsOf(v: unknown): number {
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return v;
  if (typeof v === "string" && /^\d{1,12}$/.test(v)) return Number(v);
  throw new PaymentGatewayError("unexpected");
}

/** Id do gateway como texto (número ou texto). */
export function idOf(v: unknown): string {
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return String(v);
  if (typeof v === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(v)) return v;
  throw new PaymentGatewayError("unexpected");
}

/**
 * Data do gateway em ISO 8601. "2025-08-22 21:30:00" (sem fuso) é horário de
 * Brasília (-03:00), como os painéis dos gateways mostram; com fuso, vale o dele.
 */
export function isoDate(v: unknown): string | null {
  const s = strOr(v).trim();
  if (!s) return null;
  const naive = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/.exec(s);
  const text = naive ? `${naive[1]}T${naive[2].length === 5 ? `${naive[2]}:00` : naive[2]}-03:00` : s;
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Imagem do QR: só PNG/JPEG/GIF/WebP em base64 (com ou sem o "data:"); o resto vira null. */
export function qrImageOf(v: unknown): string | null {
  const s = strOr(v).trim();
  if (!s) return null;
  if (/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/.test(s) && s.length < 300_000) {
    return s.replace(/\s+/g, "");
  }
  if (/^[A-Za-z0-9+/=\s]{64,300000}$/.test(s)) return `data:image/png;base64,${s.replace(/\s+/g, "")}`;
  return null;
}

/** Código PIX "copia e cola" (EMV): só caracteres imprimíveis, tamanho de um código de verdade. */
export function pixCodeOf(v: unknown): string | null {
  const s = strOr(v).trim();
  return s.length >= 20 && s.length <= 1000 && /^[\x20-\x7e]+$/.test(s) ? s : null;
}

/** Erro do "Testar conexão" → ConnectionStatus (o mesmo nos gateways de PIX). */
export function connectionStatusOf(err: unknown): ConnectionStatus {
  if (!(err instanceof PaymentGatewayError)) return "unexpected";
  if (err.code === "invalid_key") return "invalid_key";
  if (err.code === "missing_scope") return "missing_scope";
  if (err.code === "network") return "offline";
  if (err.code === "unavailable") return "unavailable";
  return "unexpected";
}
