/**
 * Casca da Netlify (função em netlify/functions/pagamento.mjs). Usa a assinatura
 * clássica `export const handler` (event/retorno {statusCode,headers,body}), a
 * mais compatível. Só traduz o pedido/resposta; a lógica fica em ./core. A
 * config é injetada pelo empacotador (__OS_CONFIG__); chaves e segredo vêm das
 * variáveis de ambiente da Netlify.
 */
import { PAYMENT_MAX_BODY } from "@/lib/payments/contract";
import type { ServerlessConfig } from "./config";
import { createServerlessApp, type HttpInput } from "./core";

declare const __OS_CONFIG__: string;
const app = createServerlessApp(JSON.parse(__OS_CONFIG__) as ServerlessConfig);

interface NetlifyEvent {
  httpMethod?: string;
  headers?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined> | null;
  body?: string | null;
  isBase64Encoded?: boolean;
}

export const handler = async (event: NetlifyEvent) => {
  const headers: Record<string, string | undefined> = {};
  for (const name of Object.keys(event.headers ?? {})) headers[name.toLowerCase()] = event.headers?.[name];
  const raw =
    event.body == null ? "" : event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  const tooLarge = raw.length > PAYMENT_MAX_BODY;
  const input: HttpInput = {
    method: event.httpMethod ?? "GET",
    headers,
    host: headers["x-forwarded-host"] ?? headers.host ?? null,
    rawBody: tooLarge ? raw.slice(0, PAYMENT_MAX_BODY + 1) : raw,
    tooLarge,
    query: event.queryStringParameters ?? {},
  };
  const r = await app.handle(input);
  return { statusCode: r.status, headers: r.headers, body: r.body };
};
