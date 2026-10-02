import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

/**
 * O app é local e não fica atrás de proxy: ignoramos qualquer X-Forwarded-For
 * enviado pelo cliente, senão bastaria mudar esse cabeçalho a cada tentativa
 * para escapar do limite de 5 logins por minuto.
 *
 * A requisição é recriada do zero (os corpos do login são JSON pequenos); não
 * dá para clonar o NextRequest com `new Request(req, …)`.
 */
const handler = toNextJsHandler(async (req: Request) => {
  const headers = new Headers(req.headers);
  headers.set("x-forwarded-for", "127.0.0.1");
  headers.delete("x-real-ip");
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const body = hasBody ? await req.arrayBuffer() : undefined;
  return auth.handler(new Request(req.url, { method: req.method, headers, body }));
});

export const { GET, POST } = handler;
