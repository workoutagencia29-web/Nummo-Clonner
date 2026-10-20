/**
 * Núcleo da função serverless, igual para a Vercel e a Netlify: aplica as
 * defesas de borda (método, mesma origem, tipo e tamanho do corpo, cabeçalhos
 * no-store) e um limite por IP (melhor esforço, só nesta instância), lê as
 * chaves e o segredo do AMBIENTE e despacha para o motor (./engine).
 *
 * As cascas de cada plataforma (./vercel, ./netlify) só traduzem o formato do
 * pedido/resposta; a lógica fica aqui, testável sem plataforma nenhuma.
 */
import { PAYMENT_MAX_BODY, paymentError } from "@/lib/payments/contract";
import { GATEWAY_KEY_ENV, type ServerlessConfig, type ServerlessProvider } from "./config";
import { handleServerlessPayment } from "./engine";
import { sameOriginOk } from "./same-origin";
import { SERVERLESS_SECRET_ENV, serverlessSecret } from "./token";

/** Pedido HTTP já normalizado pela casca da plataforma. */
export interface HttpInput {
  method: string;
  /** Cabeçalhos em minúsculas. */
  headers: Record<string, string | undefined>;
  host: string | null;
  /** Corpo cru (a casca para de ler em PAYMENT_MAX_BODY e marca tooLarge). */
  rawBody: string;
  tooLarge?: boolean;
  /** Parâmetros da query (?webhook=…). */
  query: Record<string, string | undefined>;
}

export interface HttpResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const JSON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex",
};

function reply(status: number, body: unknown): HttpResult {
  return { status, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

const err = (code: Parameters<typeof paymentError>[0]): HttpResult => {
  const e = paymentError(code);
  return reply(e.status, e.body);
};

/** Limite por IP (melhor esforço, só nesta instância): freia carding e abuso de custo. */
function createRateLimiter(limit = 30, windowMs = 600_000) {
  const hits = new Map<string, number[]>();
  return (ip: string): boolean => {
    const now = Date.now();
    if (hits.size > 5000) hits.clear();
    const arr = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
    hits.set(ip, arr);
    if (arr.length >= limit) return true;
    arr.push(now);
    return false;
  };
}

/** IP de quem chama (cabeçalho confiável da plataforma; melhor esforço). */
function clientIp(h: Record<string, string | undefined>): string {
  const fwd = h["x-vercel-forwarded-for"] || h["x-real-ip"] || h["x-forwarded-for"] || "";
  return fwd.split(",")[0].trim() || "sem-ip";
}

function contentTypeOk(h: Record<string, string | undefined>): boolean {
  const ct = (h["content-type"] || "").toLowerCase();
  return ct.startsWith("application/json") || ct.startsWith("text/plain");
}

/** Monta a função a partir da config embutida (chaves e segredo vêm do ambiente). */
export function createServerlessApp(config: ServerlessConfig) {
  const overLimit = createRateLimiter();

  function deps(ip: string) {
    return {
      config,
      key: (provider: ServerlessProvider): string | null => process.env[GATEWAY_KEY_ENV[provider]]?.trim() || null,
      secret: serverlessSecret(process.env[SERVERLESS_SECRET_ENV]),
      now: () => Date.now(),
      rateLimited: () => overLimit(ip),
    };
  }

  async function handle(input: HttpInput): Promise<HttpResult> {
    // GET: só um resumo de saúde (nada secreto), para conferir o deploy.
    if (input.method === "GET") {
      const chaves: Record<string, boolean> = {};
      for (const p of Object.keys(GATEWAY_KEY_ENV) as ServerlessProvider[]) {
        chaves[p] = !!process.env[GATEWAY_KEY_ENV[p]]?.trim();
      }
      return reply(200, {
        ok: true,
        pagamento: config.payments.length,
        checkout: config.checkouts.length,
        segredo: !!serverlessSecret(process.env[SERVERLESS_SECRET_ENV]),
        chaves,
      });
    }
    // Webhook: não usamos (a página confere por consulta); responde 200 sem fazer nada.
    if (input.query.webhook) return reply(200, { ok: true });
    if (input.method !== "POST") return err("invalido");
    if (!sameOriginOk(input.host, input.headers.origin ?? null, input.headers.referer ?? null)) {
      return err("origem");
    }
    if (!contentTypeOk(input.headers)) return err("invalido");
    if (input.tooLarge || input.rawBody.length > PAYMENT_MAX_BODY) return err("corpo_grande");
    let raw: unknown;
    try {
      raw = input.rawBody ? JSON.parse(input.rawBody) : null;
    } catch {
      return err("invalido");
    }
    const r = await handleServerlessPayment(raw, deps(clientIp(input.headers)));
    return reply(r.status, r.body);
  }

  return { handle };
}

export type ServerlessApp = ReturnType<typeof createServerlessApp>;
