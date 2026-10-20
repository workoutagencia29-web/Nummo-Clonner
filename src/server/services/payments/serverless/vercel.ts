/**
 * Casca da Vercel (função Node em api/pagamento.mjs → /api/pagamento). Só
 * traduz o pedido/resposta HTTP; a lógica fica em ./core. A config da oferta é
 * injetada pelo empacotador (esbuild define __OS_CONFIG__); as chaves e o
 * segredo vêm das variáveis de ambiente da Vercel.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { PAYMENT_MAX_BODY } from "@/lib/payments/contract";
import type { ServerlessConfig } from "./config";
import { createServerlessApp, type HttpInput } from "./core";

declare const __OS_CONFIG__: string;
const app = createServerlessApp(JSON.parse(__OS_CONFIG__) as ServerlessConfig);

/** Lê o corpo cru da stream, parando em PAYMENT_MAX_BODY (não parseia nada grande). */
function readBody(req: IncomingMessage): Promise<{ body: string; tooLarge: boolean }> {
  return new Promise((resolve) => {
    let data = "";
    let tooLarge = false;
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      if (tooLarge) return;
      data += chunk;
      if (data.length > PAYMENT_MAX_BODY) {
        tooLarge = true;
        data = data.slice(0, PAYMENT_MAX_BODY + 1);
      }
    });
    req.on("end", () => resolve({ body: data, tooLarge }));
    req.on("error", () => resolve({ body: "", tooLarge: false }));
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const headers: Record<string, string | undefined> = {};
  for (const name of Object.keys(req.headers)) {
    const v = req.headers[name];
    headers[name.toLowerCase()] = Array.isArray(v) ? v.join(",") : v;
  }
  const url = new URL(req.url ?? "/", `http://${headers.host ?? "localhost"}`);
  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    query[k] = v;
  });
  const read = req.method === "POST" ? await readBody(req) : { body: "", tooLarge: false };
  const input: HttpInput = {
    method: req.method ?? "GET",
    headers,
    host: headers["x-forwarded-host"] ?? headers.host ?? null,
    rawBody: read.body,
    tooLarge: read.tooLarge,
    query,
  };
  const r = await app.handle(input);
  res.writeHead(r.status, r.headers);
  res.end(r.body);
}
