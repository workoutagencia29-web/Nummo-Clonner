import { expect, request as playwrightRequest, test } from "@playwright/test";
import { createOffer, uid } from "./helpers";

/**
 * Proteções encontradas na revisão da Fase 1:
 * - nenhuma tela entrega dados sem login, nem com cookie falso nem com
 *   cabeçalhos de navegação interna (RSC/prefetch);
 * - o painel só responde nos próprios endereços (bloqueia DNS rebinding);
 * - o limite de tentativas não é burlado com X-Forwarded-For (ver auth.spec.ts).
 */
test.describe("segurança do painel", () => {
  test("dados não vazam sem login (cookie falso e requisição RSC/prefetch)", async ({ page, baseURL }) => {
    const name = `Secreta ${uid()}`;
    const offerId = await createOffer(page, name);

    const anon = await playwrightRequest.newContext({ baseURL });
    const tree = encodeURIComponent(
      JSON.stringify(["", { children: ["(painel)", { children: ["configuracoes", { children: ["__PAGE__", {}] }] }] }]),
    );
    const attempts: Record<string, string>[] = [
      { RSC: "1", purpose: "prefetch", "Next-Router-State-Tree": tree },
      { RSC: "1", "Next-Router-State-Tree": tree, Cookie: "offerstudio.session_token=falso" },
      { Cookie: "offerstudio.session_token=falso" },
    ];
    for (const path of ["/ofertas", "/lixeira", `/ofertas/${offerId}`, "/clonar"]) {
      for (const headers of attempts) {
        const res = await anon.get(path, { headers, maxRedirects: 0 });
        const body = await res.text();
        expect(body, `${path} com ${Object.keys(headers).join("+")}`).not.toContain(name);
      }
    }
    await anon.dispose();
  });

  test("o painel recusa endereços que não são dele (DNS rebinding)", async ({ baseURL }) => {
    const ctx = await playwrightRequest.newContext({ baseURL });
    const res = await ctx.get("/entrar", { headers: { Host: "evil.example:3200" } });
    expect(res.status()).toBe(403);
    const api = await ctx.get("/api/health", { headers: { Host: "evil.example" } });
    expect(api.status()).toBe(403);
    const ok = await ctx.get("/api/health");
    expect(ok.status()).toBe(200);
    await ctx.dispose();
  });

  test("arquivos: chave inválida e pasta dão 400/404 (não 500)", async ({ page }) => {
    const bad = await page.request.get("/api/files/..%2F..%2F.env");
    expect([400, 404]).toContain(bad.status());
    const dir = await page.request.get("/api/files/a");
    expect(dir.status()).toBe(404);
  });
});
