import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Roda antes de cada requisição ao painel:
 * 1. Só aceita os endereços do próprio painel (localhost/127.0.0.1 na porta dele).
 *    Isso bloqueia sites maliciosos que tentem falar com o Offer Studio usando
 *    "DNS rebinding".
 * 2. Redirecionamento otimista para o login (só olha se o cookie existe). A
 *    proteção de verdade está em requireSession(), chamada por toda tela, ação
 *    e rota que lê ou altera dados.
 * 3. Content-Security-Policy com nonce: só scripts do próprio painel executam.
 */
const PUBLIC_PATHS = ["/entrar"];

function allowedHosts() {
  const port = process.env.PORT || "3000";
  return new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
}

export function proxy(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").toLowerCase();
  if (!allowedHosts().has(host)) {
    return new NextResponse("Endereço não permitido.", { status: 403 });
  }

  const { pathname, search } = request.nextUrl;
  // Rotas de API fazem a própria checagem de login e respondem JSON.
  if (pathname.startsWith("/api/")) return NextResponse.next();

  const hasSession = Boolean(getSessionCookie(request, { cookiePrefix: "offerstudio" }));
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!hasSession && !isPublic) {
    const url = new URL("/entrar", request.url);
    if (pathname !== "/") url.searchParams.set("voltar", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }
  // Quem já está logado e abre /entrar é redirecionado pela própria página, que
  // confere a sessão de verdade (um cookie antigo não pode causar loop).

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  // Prévias rodam em <token>.localhost:<porta de prévia> e aparecem em iframes.
  const previewOrigin = `http://*.localhost:${process.env.PREVIEW_PORT || "3001"}`;
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // i.ytimg.com: capa dos vídeos do YouTube no marcador do editor (só imagem).
    "img-src 'self' blob: data: https://i.ytimg.com",
    "font-src 'self' data:",
    "connect-src 'self'",
    `frame-src ${previewOrigin}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "same-origin");
  return response;
}

export const config = {
  // Rotas com corpos grandes (ZIP, projeto do editor, imagens) ficam de fora: com o
  // proxy, o Next guardaria o corpo inteiro na memória (e cortaria acima de 10 MB).
  // Elas fazem as próprias checagens de endereço e login (src/server/api.ts).
  // Os ícones da aba (favicon.ico, icon.svg, apple-icon.png) valem também na tela de login.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|api/clone/zip|api/documents|api/assets).*)",
  ],
};
