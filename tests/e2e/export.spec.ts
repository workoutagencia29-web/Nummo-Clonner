/**
 * Fase 5 — "Baixar ZIP" de ponta a ponta: do botão na tela da oferta até o
 * arquivo baixado, aberto aqui com o yauzl para conferir o que foi para dentro
 * (página inicial na raiz, pasta de cada página, arquivos em assets/ com
 * endereços relativos). Também o caminho pelo menu do card e o teste A/B
 * (pastas oferta-a/ e oferta-b/ + divisor no index.html).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { type Download, expect, type Locator, type Page, test } from "@playwright/test";
import { parse } from "dotenv";
import { Client } from "pg";
import yauzl from "yauzl";
import { addPage, createOffer, createOfferFromTemplate, openCardMenu, uid } from "./helpers";

/** Banco dos testes E2E (scripts/e2e-server.ts). Nunca o "offerstudio" (dados reais). */
const E2E_DB = "offerstudio_e2e_auto";

async function withDb<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const env = parse(readFileSync(path.join(process.cwd(), ".env")));
  const client = new Client({
    host: "127.0.0.1",
    port: Number(env.PG_PORT || 5433),
    user: env.PG_USER || "offerstudio",
    password: env.PG_PASSWORD,
    database: E2E_DB,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Id no formato do Prisma (cuid, 25 caracteres). */
function newId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`.slice(
    0,
    25,
  );
}

/** Todos os arquivos do ZIP (caminho → conteúdo). */
function readZip(file: string): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err);
      const files = new Map<string, Buffer>();
      zip.on("entry", (entry: yauzl.Entry) => {
        if (entry.fileName.endsWith("/")) return zip.readEntry();
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return reject(e);
          const chunks: Buffer[] = [];
          stream.on("data", (c: Buffer) => chunks.push(c));
          stream.on("end", () => {
            files.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
          stream.on("error", reject);
        });
      });
      zip.on("end", () => resolve(files));
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}

/** Endereços de src/href de um HTML que apontam para a pasta assets/. */
function assetRefs(html: string): string[] {
  const refs: string[] = [];
  for (const m of html.matchAll(/\s(?:src|href)\s*=\s*["']([^"'#?]+)[^"']*["']/gi)) {
    if (/(^|\/)assets\//.test(m[1])) refs.push(m[1]);
  }
  return refs;
}

/** Resolve um endereço relativo a partir da pasta do arquivo, dentro do ZIP ("obrigado/" + "../assets/x" → "assets/x"). */
function resolveInZip(fromDir: string, ref: string) {
  return path.posix.normalize(path.posix.join(fromDir, ref));
}

/** Confere que o HTML só usa endereços relativos para os arquivos e que todos existem no ZIP. */
function expectRelativeAssets(files: Map<string, Buffer>, htmlPath: string, prefix: string) {
  const html = files.get(htmlPath)?.toString("utf8") ?? "";
  expect(html, `${htmlPath} existe`).not.toBe("");
  expect(html).not.toContain("/os-assets/");
  expect(html).not.toMatch(/(?:src|href)\s*=\s*["']\/assets\//i);
  expect(html).not.toMatch(/(?:src|href)\s*=\s*["']https?:\/\/(?:localhost|127\.0\.0\.1)/i);
  const refs = assetRefs(html);
  expect(refs.length, `${htmlPath} usa arquivos de assets/`).toBeGreaterThan(0);
  const dir = path.posix.dirname(htmlPath) === "." ? "" : `${path.posix.dirname(htmlPath)}/`;
  for (const ref of refs) {
    expect(ref.startsWith(`${prefix}assets/`), `${htmlPath}: "${ref}" começa com "${prefix}assets/"`).toBe(true);
    const target = resolveInZip(dir, ref);
    expect(files.has(target), `${htmlPath}: "${ref}" → "${target}" está no ZIP`).toBe(true);
  }
}

const exportDialog = (page: Page) => page.getByRole("dialog", { name: "Baixar ZIP" });

/** Itens da árvore "O que vai no ZIP" (data-path). */
async function treePaths(dialog: Locator) {
  const list = dialog.getByRole("list", { name: "Arquivos e pastas do ZIP" });
  await expect(list).toBeVisible();
  return list.getByRole("listitem").evaluateAll((els) => els.map((el) => el.getAttribute("data-path")));
}

/** "Gerar ZIP" e espera o download automático. */
async function generateAndDownload(page: Page, dialog: Locator): Promise<Download> {
  const downloadPromise = page.waitForEvent("download", { timeout: 90_000 });
  await dialog.getByRole("button", { name: "Gerar ZIP" }).click();
  await expect(dialog.getByRole("progressbar", { name: "Progresso do ZIP" })).toBeVisible();
  const download = await downloadPromise;
  await expect(dialog.getByText("ZIP pronto! O download começou.")).toBeVisible({ timeout: 30_000 });
  return download;
}

test.describe("Baixar ZIP", () => {
  test("da tela da oferta: gera, baixa e o ZIP tem a página inicial, a pasta da página e os arquivos", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const name = `Oferta ZIP ${uid()}`;
    await createOfferFromTemplate(page, name, "Upsell");
    await addPage(page, "Obrigado", { type: "Obrigado" });

    // 1º clique: botão principal no cabeçalho da oferta.
    await page.getByRole("button", { name: "Baixar ZIP" }).click();
    const dialog = exportDialog(page);
    await expect(dialog).toBeVisible();
    await expect.poll(() => treePaths(dialog)).toEqual(expect.arrayContaining(["index.html", "obrigado/", "assets/"]));
    await expect(dialog.getByText("Nenhum ZIP gerado ainda.")).toBeVisible();
    // Oferta sem versões A/B e sem token: só a opção do HTML.
    await expect(dialog.getByRole("switch")).toHaveCount(1);
    await expect(dialog.getByRole("switch", { name: "HTML otimizado" })).toBeChecked();

    // 2º clique: gerar. O download começa sozinho.
    const download = await generateAndDownload(page, dialog);
    // Nome com a data e a hora (dois ZIPs do mesmo dia não saem com o mesmo nome).
    expect(download.suggestedFilename()).toMatch(/^oferta-zip-[a-z0-9-]+-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/);
    const file = await download.path();
    const files = await readZip(file);
    const names = [...files.keys()];

    expect(names).toContain("index.html");
    expect(names).toContain("obrigado/index.html");
    expect(names).toContain("LEIA-ME.txt");
    expect(names.some((n) => /^assets\/.+/.test(n))).toBe(true);
    // Nada de caminho absoluto nem subindo pastas dentro do ZIP.
    for (const n of names) {
      expect(n.startsWith("/"), n).toBe(false);
      expect(n.split("/").includes(".."), n).toBe(false);
    }
    expect(files.get("index.html")?.toString("utf8")).toMatch(/<html[\s>]/i);
    expectRelativeAssets(files, "index.html", "");
    expectRelativeAssets(files, "obrigado/index.html", "../");
    expect(files.get("LEIA-ME.txt")?.toString("utf8")).toContain("public_html");

    // "Baixar de novo" (confere com o servidor antes) baixa o mesmo arquivo.
    const again = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Baixar de novo" }).click();
    expect((await again).suggestedFilename()).toBe(download.suggestedFilename());

    // Fechar e abrir de novo: o ZIP aparece em "ZIPs anteriores", com baixar.
    await dialog.locator('[data-slot="dialog-footer"]').getByRole("button", { name: "Fechar" }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "Baixar ZIP" }).click();
    const history = dialog.getByRole("list", { name: "ZIPs anteriores" });
    await expect(history.getByRole("listitem")).toHaveCount(1);
    await expect(history.getByRole("listitem")).toContainText(download.suggestedFilename());
    await expect(history.getByRole("button", { name: /^Baixar / })).toBeVisible();

    // Apagar o ZIP anterior.
    await history.getByRole("button", { name: /^Apagar / }).click();
    await expect(dialog.getByText("Nenhum ZIP gerado ainda.")).toBeVisible();
  });

  test("pelo menu do card, com teste A/B: pastas oferta-a/ e oferta-b/ e o divisor no index.html", async ({ page }) => {
    test.setTimeout(150_000);
    const name = `Oferta AB ${uid()}`;
    const offerId = await createOffer(page, name);

    // Segunda versão (B) da página inicial, 50% / 50%.
    await withDb(async (db) => {
      const home = await db.query<{ id: string; variantId: string; html: string | null }>(
        `SELECT p.id, v.id AS "variantId", d.html FROM "Page" p
           JOIN "PageVariant" v ON v."pageId" = p.id
           JOIN "PageDocument" d ON d."variantId" = v.id
          WHERE p."offerId" = $1 AND p."isHome"`,
        [offerId],
      );
      expect(home.rowCount).toBe(1);
      const { id: pageId, variantId, html } = home.rows[0];
      await db.query(`UPDATE "PageVariant" SET weight = 50, "updatedAt" = now() WHERE id = $1`, [variantId]);
      const variantB = newId();
      await db.query(
        `INSERT INTO "PageVariant" (id, "pageId", name, label, "isControl", weight, position, "createdAt", "updatedAt")
         VALUES ($1, $2, 'B', 'Headline nova', false, 50, 1, now(), now())`,
        [variantB, pageId],
      );
      await db.query(
        `INSERT INTO "PageDocument" (id, "variantId", device, html, revision, "createdAt", "updatedAt")
         VALUES ($1, $2, 'ALL', $3, 0, now(), now())`,
        [newId(), variantB, (html ?? "").replace("</body>", "<h1>Versão B</h1></body>")],
      );
    });

    // Do painel: menu do card → "Baixar ZIP" abre a oferta já com o diálogo.
    await page.goto("/ofertas");
    await openCardMenu(page, name);
    await page.getByRole("menuitem", { name: "Baixar ZIP" }).click();
    await expect(page).toHaveURL(new RegExp(`/ofertas/${offerId}$`));
    const dialog = exportDialog(page);
    await expect(dialog).toBeVisible();

    await expect
      .poll(() => treePaths(dialog))
      .toEqual(expect.arrayContaining(["index.html", "oferta-a/", "oferta-b/", "assets/"]));
    await expect(dialog.locator('li[data-path="index.html"]')).toHaveAttribute("data-kind", "splitter");
    await expect(dialog.getByRole("switch", { name: "Divisor A/B" })).toBeChecked();

    const download = await generateAndDownload(page, dialog);
    const files = await readZip(await download.path());
    expect(files.has("index.html")).toBe(true);
    expect(files.has("oferta-a/index.html")).toBe(true);
    expect(files.has("oferta-b/index.html")).toBe(true);
    // O divisor sorteia entre as pastas das versões (endereços relativos).
    const splitter = files.get("index.html")?.toString("utf8") ?? "";
    expect(splitter).toContain("oferta-a/");
    expect(splitter).toContain("oferta-b/");
    expect(files.get("oferta-b/index.html")?.toString("utf8")).toContain("Versão B");
    expect(files.get("oferta-a/index.html")?.toString("utf8")).not.toContain("Versão B");
  });
});
