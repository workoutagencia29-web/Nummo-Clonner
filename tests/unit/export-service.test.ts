/**
 * "Baixar ZIP" com o banco de verdade: fila (startExport → claimNextExport →
 * runExportJob), o conteúdo do ZIP (pastas, links relativos, arquivos, CSS
 * reescrito, divisor, celular, Preservar JS, eventos.php e tokens), ZIP
 * determinístico, avisos, prévia (exportPlan), limpeza, loop do worker e as
 * rotas GET /api/exports/<id> e /download.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { Engine as PhpParser } from "php-parser";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));

import { GET as downloadRoute } from "@/app/api/exports/[id]/download/route";
import { GET as statusRoute } from "@/app/api/exports/[id]/route";
import { prisma } from "@/lib/db";
import { EXPORTS_KEPT_PER_OFFER, type ExportView } from "@/lib/export/options";
import { eventosPhp } from "@/lib/export/php";
import { deleteObject, objectExists, putObject, storagePath } from "@/lib/storage";
import {
  deleteExport,
  exportDownload,
  exportPlan,
  getExportView,
  listExports,
  startExport,
} from "@/server/services/export";
import { buildExport } from "@/server/services/export/build";
import {
  claimNextExport,
  cleanupExports,
  exportFileKey,
  failInterruptedExports,
  friendlyExportError,
  GENERIC_FAILURE_MESSAGE,
  INTERRUPTED_MESSAGE,
  runExportJob,
} from "@/server/services/export/jobs";
import { OFFER_NOT_FOUND } from "@/server/services/export/source";
import { exportLoop } from "@/worker/export";
import { resetDatabase } from "../setup/per-file";
import {
  CHECKOUT_URL,
  createExportFixture,
  type ExportFixture,
  META_PIXEL,
  META_TOKEN,
  readZip,
  removeExportFiles,
  TIKTOK_PIXEL,
  TIKTOK_TOKEN,
  type ZipItem,
} from "./export-fixture";
import { expectUserError } from "./helpers";

const HOST = `localhost:${process.env.PORT || "3000"}`;

afterAll(async () => {
  await removeExportFiles();
});
const php = new PhpParser({ parser: { version: "7.4", extractDoc: false }, ast: {} });

/** Pede, executa e devolve o ZIP lido. */
async function exportNow(offerId: string, options: Record<string, boolean> = {}) {
  const { exportId } = await startExport(offerId, options);
  const claimed = await claimNextExport();
  expect(claimed).toBe(exportId);
  await runExportJob(exportId);
  const view = (await getExportView(exportId)) as ExportView;
  expect(view.errorMessage).toBeNull();
  expect(view.status).toBe("DONE");
  const file = storagePath(exportFileKey(offerId, exportId));
  return { exportId, view, file, zip: await readZip(file) };
}

const text = (zip: Map<string, ZipItem>, name: string) => {
  const item = zip.get(name);
  if (!item) throw new Error(`Faltou no ZIP: ${name}`);
  return item.data.toString("utf8");
};

describe("ZIP completo (A/B, celular, legal, Preservar JS, eventos.php)", () => {
  let fx: ExportFixture;
  let result: Awaited<ReturnType<typeof exportNow>>;

  beforeAll(async () => {
    await removeExportFiles();
    await resetDatabase();
    fx = await createExportFixture();
    result = await exportNow(fx.offerId, { serverEvents: true });
  });

  it("estado final, nome do arquivo e avisos", () => {
    const { view } = result;
    expect(view.progress).toBe(100);
    expect(view.step).toBe("Pronto para baixar");
    expect(view.fileName).toMatch(/^oferta-teste-exportacao-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/);
    expect(view.bytes).toBeGreaterThan(1000);
    expect(view.options).toEqual({ splitter: true, serverEvents: true, optimizeHtml: true });
    const warnings = view.warnings.join("\n");
    expect(warnings).toContain("“Quiz” usa “Preservar JS”: suba a oferta na raiz do domínio");
    expect(warnings).toContain("O eventos.php só funciona em hospedagem com PHP");
    expect(warnings).toContain("preencha “Onde está no ar”");
    expect(warnings).toContain("1 arquivo(s) do “Preservar JS” tinham o mesmo caminho");
    expect(warnings).not.toContain("não foram encontrados");
  });

  it("estrutura de pastas e arquivos", () => {
    const names = [...result.zip.keys()];
    expect(names).toEqual([...names].sort());
    // Nada de .htaccess na raiz (substituiria o da hospedagem): os tokens ficam em eventos-dados/.
    expect(names).not.toContain(".htaccess");
    expect(names).not.toContain("eventos-config.php");
    for (const name of [
      "eventos-dados/.htaccess",
      "LEIA-ME.txt",
      "eventos-dados/config.php",
      "eventos.php",
      "index.html",
      "oferta-a/index.html",
      "oferta-b/index.html",
      "upsell/index.html",
      "upsell/celular/index.html",
      "privacidade/index.html",
      "quiz/index.html",
      "js/quiz.js",
      "img/etapa-2.png",
      "dados/config.json",
      "css/orig.css",
    ]) {
      expect(names).toContain(name);
    }
    expect(names.some((n) => n.startsWith("pasta"))).toBe(false);
    const f = fx.files;
    const assets = names.filter((n) => n.startsWith("assets/")).map((n) => n.slice(7));
    expect(assets.filter((a) => a.startsWith("os-runtime-"))).toHaveLength(1);
    expect(assets.filter((a) => a.startsWith("os-tracking-"))).toHaveLength(1);
    expect(assets).toContain("index-vite123.js");
    expect(assets.filter((a) => /^[0-9a-f]{64}\./.test(a)).sort()).toEqual(
      [f.base, f.main, f.fonts, f.font, f.bg, f.bg2, f.bg3, f.img1, f.img2, f.img3, f.favicon, f.og, f.quizCss].sort(),
    );
  });

  it("entradas determinísticas: mesma data e permissões; imagens sem compactar de novo", () => {
    const items = [...result.zip.values()];
    const dates = new Set(items.map((i) => i.mtime.getTime()));
    expect(dates.size).toBe(1);
    expect(new Set(items.map((i) => i.mode))).toEqual(new Set([0o644]));
    expect(result.zip.get(`assets/${fx.files.img1}`)?.compressed).toBe(false);
    expect(result.zip.get(`assets/${fx.files.font}`)?.compressed).toBe(false);
    expect(result.zip.get("index.html")?.compressed).toBe(true);
    expect(result.zip.get(`assets/${fx.files.main}`)?.compressed).toBe(true);
  });

  it("divisor A/B na raiz, com as metas de compartilhamento da versão de controle", () => {
    const html = text(result.zip, "index.html");
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toMatch(/\[\["oferta-a\/",50,"[a-z0-9]+"\],\["oferta-b\/",50,"[a-z0-9]+"\]\]/);
    expect(html).toContain("<title>Oferta Teste</title>");
    expect(html).toContain('<meta name="description" content="Descrição da oferta de teste">');
    expect(html).toContain('<meta property="og:title" content="Oferta Teste">');
    expect(html).toContain(`<meta property="og:image" content="assets/${fx.files.og}">`);
    expect(html).toContain(`<link rel="icon" href="assets/${fx.files.favicon}">`);
    expect(html).toContain("l.replace(u)");
    expect(html).not.toContain("os-tracking");
    expect(html).not.toContain("os-runtime");
  });

  it("versões: links do funil relativos, arquivos em ../assets/, empresa, SEO e rastreamento ao vivo", () => {
    const f = fx.files;
    const a = text(result.zip, "oferta-a/index.html");
    const b = text(result.zip, "oferta-b/index.html");
    expect(a).toContain('<h1 id="titulo">Versão A</h1>');
    expect(b).toContain('<h1 id="titulo">Versão B</h1>');
    expect(a).toContain('id="ir-upsell" href="../upsell/"');
    expect(a).toContain('id="politica" href="../privacidade/"');
    expect(a).toContain('id="quiz" href="../quiz/"');
    expect(a).toContain(`href="${CHECKOUT_URL.replace("&", "&amp;")}"`);
    expect(a).toContain(`href="../assets/${f.base}"`);
    expect(a).toContain(`srcset="../assets/${f.img1} 1x, ../assets/${f.img2} 2x"`);
    expect(a).toContain(`url('../assets/${f.bg2}')`);
    expect(a).toContain(`url(&quot;../assets/${f.bg}&quot;)`.replace(/&quot;/g, '"'));
    expect(a).toContain(`..\\/assets\\/${f.img3}`);
    expect(a).toContain("Empresa Teste LTDA — CNPJ 12.345.678/0001-90");
    expect(a).not.toContain("/os-assets/");
    expect(a).not.toContain("os-page:");
    // SEO da oferta
    expect(a).toContain("<title>Oferta Teste</title>");
    expect(a).toContain('<meta name="description" content="Descrição da oferta de teste">');
    expect(a).toContain(`<link rel="icon" href="../assets/${f.favicon}">`);
    expect(a).toContain(`<meta property="og:image" content="../assets/${f.og}">`);
    // Canonical: a versão B aponta para a A (o divisor é noindex). Só o canonical,
    // sem noindex (noindex + canonical são sinais contraditórios para o Google).
    expect(a).not.toContain('rel="canonical"');
    expect(b).toContain('<link rel="canonical" href="../oferta-a/">');
    expect(b).not.toContain('name="robots"');
    expect(a).not.toContain('name="robots"');
    // Cada versão guarda a versão vista (quem chega direto continua nela).
    expect(b).toContain('S="oferta-b/"');
    expect(a).toContain('S="oferta-a/"');
    // Rastreamento ao vivo com o eventos.php relativo e a política da oferta.
    const config = JSON.parse(
      /<script type="application\/json" id="os-tracking">([\s\S]*?)<\/script>/.exec(a)?.[1] ?? "",
    );
    expect(config.mode).toBe("live");
    expect(config.server).toEqual({ endpoint: "../eventos.php", vendors: ["META", "TIKTOK"] });
    expect(config.consent.policyUrl).toBe("../privacidade/");
    expect(config.pixels.map((p: { id: string }) => p.id).sort()).toEqual([META_PIXEL, TIKTOK_PIXEL].sort());
    expect(a).toMatch(/<script src="\.\.\/assets\/os-tracking-[0-9a-f]{12}\.js" data-os-tracking><\/script>/);
    expect(a).toMatch(/<script src="\.\.\/assets\/os-runtime-[0-9a-f]{12}\.js" data-os-runtime><\/script>/);
    // Script de chegada antes do rastreamento.
    expect(a.indexOf("data-os-export")).toBeGreaterThan(0);
    expect(a.indexOf("data-os-export")).toBeLessThan(a.indexOf('id="os-tracking"'));
    // HTML otimizado: comentário comum sai, condicional e <pre> ficam.
    expect(a).not.toContain("comentário que some");
    expect(a).toContain("<!--[if IE]><p>navegador antigo</p><![endif]-->");
    expect(a).toContain('<pre id="pre">  espaços    preservados  </pre>');
  });

  it("versão celular separada e canonical/alternate", () => {
    const up = text(result.zip, "upsell/index.html");
    const mobile = text(result.zip, "upsell/celular/index.html");
    expect(up).toContain("Upsell computador");
    expect(mobile).toContain("Upsell celular");
    // Script de chegada com a ida para celular/ (pasta em M, com a trava de redirecionamento sem fim).
    expect(up).toContain('M="celular/";if(m&&!d&&G(H+M,H))');
    expect(up).toContain('<link rel="alternate" media="only screen and (max-width: 640px)" href="celular/">');
    expect(mobile).toContain('<link rel="canonical" href="../">');
    // Mesmo robots nas duas (o Google pede): upsell fica fora do Google por padrão (página depois da compra).
    expect(up).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(mobile).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(mobile).not.toContain('M="celular/"');
    // As duas devolvem a origem da visita guardada antes de um redirecionamento (RESTORE_REF_JS).
    expect(up).toContain('sessionStorage.removeItem("os_ref")');
    expect(mobile).toContain('sessionStorage.removeItem("os_ref")');
    expect(up).toContain('id="voltar" href="../"');
    expect(mobile).toContain('id="voltar" href="../../"');
    expect(mobile).toContain(`href="../../assets/${fx.files.main}"`);
    expect(mobile).toMatch(/src="\.\.\/\.\.\/assets\/os-runtime-/);
    const config = JSON.parse(/id="os-tracking">([\s\S]*?)<\/script>/.exec(mobile)?.[1] ?? "");
    expect(config.server.endpoint).toBe("../../eventos.php");
  });

  it("página legal com os dados da empresa", () => {
    const legal = text(result.zip, "privacidade/index.html");
    expect(legal).toContain("A Empresa Teste LTDA protege seus dados.");
    expect(legal).toContain('id="inicio" href="../"');
  });

  it("Preservar JS: arquivos nos caminhos originais, sem otimizar o HTML", () => {
    const f = fx.files;
    const quiz = text(result.zip, "quiz/index.html");
    expect(quiz).toContain('<script src="/js/quiz.js?v=2"></script>');
    expect(quiz).toContain('<link rel="stylesheet" href="/css/orig.css">');
    expect(quiz).toContain(`href="../assets/${f.quizCss}"`);
    expect(quiz).toContain("<!-- comentário do framework: fica -->");
    expect(text(result.zip, "css/orig.css")).toBe(`.orig{background:url("../assets/${f.bg2}")}\n`);
    expect(text(result.zip, "dados/config.json")).toBe('{"ok":true}');
    expect(text(result.zip, "js/quiz.js")).toContain('img.src="/img/etapa-2.png"');
    expect(result.zip.get("img/etapa-2.png")?.data.subarray(1, 4).toString()).toBe("PNG");
  });

  it("CSS copiado com as referências internas lado a lado (@import, url(), @font-face)", () => {
    const f = fx.files;
    expect(text(result.zip, `assets/${f.base}`)).toBe(
      `@layer os-fix, os-original;\n@import url("${f.main}") layer(os-original);\n`,
    );
    const main = text(result.zip, `assets/${f.main}`);
    expect(main).toContain(`@import "${f.fonts}";`);
    expect(main).toContain(`url(${f.bg3})`);
    expect(text(result.zip, `assets/${f.fonts}`)).toContain(`src:url("${f.font}") format("woff2")`);
    expect(text(result.zip, `assets/${f.quizCss}`)).toContain(`url(${f.bg})`);
  });

  it("eventos.php, eventos-dados/config.php (tokens só nele) e eventos-dados/.htaccess", () => {
    expect(text(result.zip, "eventos.php")).toBe(eventosPhp());
    const config = text(result.zip, "eventos-dados/config.php");
    expect(() => php.parseCode(config, "eventos-config.php")).not.toThrow();
    expect(config).toContain(`'pixel' => '${META_PIXEL}'`);
    expect(config).toContain(`'token' => '${META_TOKEN.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`);
    expect(config).toContain(`'test_event_code' => 'TEST123'`);
    expect(config).toContain(`'pixel' => '${TIKTOK_PIXEL}', 'token' => '${TIKTOK_TOKEN}'`);
    expect(text(result.zip, "eventos-dados/.htaccess")).toContain('<Files "config.php">');
    for (const [name, item] of result.zip) {
      if (name === "eventos-dados/config.php") continue;
      const body = item.data.toString("latin1");
      expect(body.includes(TIKTOK_TOKEN), name).toBe(false);
      expect(body.includes("EAAGm0PX4ZCpsBA"), name).toBe(false);
    }
  });

  it("LEIA-ME em português com o A/B, o eventos.php e os avisos", () => {
    const readme = text(result.zip, "LEIA-ME.txt");
    expect(readme).toContain("Oferta Teste Exportação");
    expect(readme).toContain("oferta-a/  →  versão A (50% das visitas)");
    expect(readme).toContain("oferta-b/  →  versão B (Headline nova) (50% das visitas)");
    expect(readme).toContain("upsell/index.html  →  Upsell (com versão celular)");
    expect(readme).toContain("Meta (API de Conversões), TikTok (Events API)");
    expect(readme).toContain('PÁGINAS "PRESERVAR JS"');
    expect(readme).toContain("AVISOS DESTA EXPORTAÇÃO");
  });

  it("o mesmo pedido gera exatamente o mesmo ZIP; um pedido novo sai com a data dele", async () => {
    const row = await prisma.export.findUniqueOrThrow({ where: { id: result.exportId } });
    const dir = storagePath(`exports/${fx.offerId}`);
    const again = path.join(dir, "de-novo.zip");
    await buildExport({
      offerId: fx.offerId,
      options: row.options as never,
      target: again,
      requestedAt: row.createdAt,
    });
    const [one, two] = await Promise.all([readFile(result.file), readFile(again)]);
    expect(createHash("sha256").update(two).digest("hex")).toBe(createHash("sha256").update(one).digest("hex"));
    // Data dos arquivos: a do pedido (mais nova que a última alteração da oferta).
    const offer = await prisma.offer.findUniqueOrThrow({ where: { id: fx.offerId } });
    const mtime = [...result.zip.values()][0].mtime.getTime();
    expect(mtime).toBeGreaterThanOrEqual(Math.floor(offer.updatedAt.getTime() / 2000) * 2000 - 2000);
    expect(Math.abs(mtime - row.createdAt.getTime())).toBeLessThan(4000);
    // Mesma oferta, pedido depois (ex.: só mudou uma opção): arquivos com data mais nova,
    // senão um "sobrescrever se for mais novo" do FTP pularia a mudança.
    const later = path.join(dir, "depois.zip");
    await buildExport({
      offerId: fx.offerId,
      options: row.options as never,
      target: later,
      requestedAt: new Date(row.createdAt.getTime() + 3600_000),
    });
    const laterZip = await readZip(later);
    expect([...laterZip.values()][0].mtime.getTime()).toBeGreaterThan(mtime + 3500_000);
    await rm(again, { force: true });
    await rm(later, { force: true });
  });

  it("sem eventos.php: nada de tokens nem envio pelo servidor; sem otimizar: comentários ficam", async () => {
    const plain = await exportNow(fx.offerId, { serverEvents: false, optimizeHtml: false });
    expect(plain.zip.has("eventos.php")).toBe(false);
    expect(plain.zip.has("eventos-dados/config.php")).toBe(false);
    expect(plain.zip.has("eventos-dados/.htaccess")).toBe(false);
    const a = text(plain.zip, "oferta-a/index.html");
    const config = JSON.parse(/id="os-tracking">([\s\S]*?)<\/script>/.exec(a)?.[1] ?? "");
    expect(config.server).toBeNull();
    expect(a).toContain("comentário que some");
    expect(plain.view.warnings.join("\n")).not.toContain("eventos.php");
  });

  it("sem divisor: a raiz é a versão de controle e as versões apontam o canonical para a raiz", async () => {
    const noSplit = await exportNow(fx.offerId, { splitter: false });
    const root = text(noSplit.zip, "index.html");
    expect(root).toContain('<h1 id="titulo">Versão A</h1>');
    expect(root).toContain('id="ir-upsell" href="upsell/"');
    expect(root).toContain(`href="assets/${fx.files.base}"`);
    expect(root).not.toContain('rel="canonical"');
    expect(root).not.toContain('name="robots"');
    for (const copy of ["oferta-a/index.html", "oferta-b/index.html"]) {
      expect(text(noSplit.zip, copy)).toContain('<link rel="canonical" href="../">');
      expect(text(noSplit.zip, copy)).not.toContain('name="robots"');
      // Sem divisor não há escolha a guardar.
      expect(text(noSplit.zip, copy)).not.toContain("os_ab_");
    }
  });
});

describe("avisos e casos de borda", () => {
  beforeEach(async () => {
    await removeExportFiles();
    await resetDatabase();
  });

  it("arquivo que sumiu do disco vira aviso (o ZIP sai mesmo assim)", async () => {
    const fx = await createExportFixture();
    await deleteObject(`a/${fx.files.bg3.slice(0, 2)}/${fx.files.bg3}`);
    const { view, zip } = await exportNow(fx.offerId);
    expect(zip.has(`assets/${fx.files.bg3}`)).toBe(false);
    expect(view.warnings.join("\n")).toContain(
      `1 arquivo(s) não foram encontrados no seu computador e ficaram de fora (ex.: assets/${fx.files.bg3})`,
    );
  });

  it("com “Onde está no ar”: canonical e imagem de compartilhamento com endereço completo", async () => {
    const fx = await createExportFixture({ liveUrl: "https://minhaoferta.com.br/lp" });
    const { view, zip } = await exportNow(fx.offerId);
    const b = text(zip, "oferta-b/index.html");
    expect(b).toContain('<link rel="canonical" href="https://minhaoferta.com.br/lp/oferta-a/">');
    // As principais apontam para elas mesmas (endereço completo); o divisor não tem canonical (é noindex).
    expect(text(zip, "oferta-a/index.html")).toContain(
      '<link rel="canonical" href="https://minhaoferta.com.br/lp/oferta-a/">',
    );
    expect(text(zip, "upsell/index.html")).toContain(
      '<link rel="canonical" href="https://minhaoferta.com.br/lp/upsell/">',
    );
    expect(text(zip, "upsell/celular/index.html")).toContain(
      '<link rel="canonical" href="https://minhaoferta.com.br/lp/upsell/">',
    );
    expect(text(zip, "index.html")).not.toContain('rel="canonical"');
    expect(b).toContain(`<meta property="og:image" content="https://minhaoferta.com.br/lp/assets/${fx.files.og}">`);
    expect(text(zip, "upsell/index.html")).toContain('href="https://minhaoferta.com.br/lp/upsell/celular/"');
    expect(zip.has(`assets/${fx.files.og}`)).toBe(true);
    expect(view.warnings.join("\n")).not.toContain("Onde está no ar");
  });

  it("token ilegível vira aviso e o eventos.php atende só o outro pixel", async () => {
    const fx = await createExportFixture();
    await prisma.pixelConfig.updateMany({
      where: { offerId: fx.offerId, vendor: "META" },
      data: { accessTokenEnc: "lixo" },
    });
    const { view, zip } = await exportNow(fx.offerId, { serverEvents: true });
    expect(view.warnings.join("\n")).toContain(
      `O token do pixel ${META_PIXEL} (Meta (API de Conversões)) não pôde ser lido`,
    );
    const config = text(zip, "eventos-dados/config.php");
    expect(config).toContain("'meta' => array(),");
    expect(config).toContain(TIKTOK_PIXEL);
  });

  it("serverEvents sem pixel com token: sem eventos.php, com aviso", async () => {
    const fx = await createExportFixture();
    await prisma.pixelConfig.updateMany({ where: { offerId: fx.offerId }, data: { accessTokenEnc: null } });
    const { view, zip } = await exportNow(fx.offerId, { serverEvents: true });
    expect(zip.has("eventos.php")).toBe(false);
    expect(view.warnings.join("\n")).toContain("O eventos.php não foi incluído");
  });

  it("link para página excluída fica sem destino (com aviso)", async () => {
    const fx = await createExportFixture();
    await prisma.page.delete({ where: { id: fx.legalId } });
    const { view, zip } = await exportNow(fx.offerId);
    expect(text(zip, "oferta-a/index.html")).toContain('id="politica" href="#"');
    expect(view.warnings.join("\n")).toContain("Há links para páginas que não existem mais em “Página principal”");
  });

  it("oferta na lixeira ou sem páginas não gera ZIP; o que estava na fila falha com mensagem clara", async () => {
    const fx = await createExportFixture();
    const { exportId } = await startExport(fx.offerId, {});
    await prisma.offer.update({ where: { id: fx.offerId }, data: { deletedAt: new Date() } });
    await expectUserError(startExport(fx.offerId, {}), OFFER_NOT_FOUND);
    expect(await claimNextExport()).toBe(exportId);
    await runExportJob(exportId);
    // Falhou e, com a oferta na lixeira, a limpeza já tirou o registro.
    expect(await prisma.export.findUnique({ where: { id: exportId } })).toBeNull();
    expect(objectExists(exportFileKey(fx.offerId, exportId))).toBe(false);

    const empty = await prisma.offer.create({ data: { name: "Vazia" } });
    await expectUserError(
      startExport(empty.id, {}),
      "Esta oferta não tem páginas. Crie uma página antes de baixar o ZIP.",
    );
  });

  it("erro inesperado na gravação: falha com mensagem clara (sem detalhes técnicos)", async () => {
    const fx = await createExportFixture();
    const { exportId } = await startExport(fx.offerId, {});
    // Uma pasta no lugar do ZIP: a gravação final falha.
    const target = storagePath(exportFileKey(fx.offerId, exportId));
    await mkdir(path.join(target, "bloqueio"), { recursive: true });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await claimNextExport();
    await runExportJob(exportId);
    spy.mockRestore();
    const row = await prisma.export.findUniqueOrThrow({ where: { id: exportId } });
    expect(row.status).toBe("FAILED");
    expect(row.errorMessage).toBe(GENERIC_FAILURE_MESSAGE);
    expect(row.step).toBeNull();
    await rm(target, { recursive: true, force: true });
    expect(friendlyExportError(Object.assign(new Error("x"), { code: "ENOSPC" }))).toContain("Sem espaço no disco");
    expect(friendlyExportError(Object.assign(new Error("x"), { code: "EACCES" }))).toContain("permissão");
  });

  it("duplo clique devolve o mesmo pedido; no máximo 3 na fila por oferta", async () => {
    const fx = await createExportFixture();
    const one = await startExport(fx.offerId, { splitter: true });
    expect(await startExport(fx.offerId, { splitter: true })).toEqual(one);
    await startExport(fx.offerId, { splitter: false });
    await startExport(fx.offerId, { optimizeHtml: false });
    await expectUserError(
      startExport(fx.offerId, { serverEvents: true }),
      "Já tem ZIPs desta oferta sendo gerados. Espere terminar e tente de novo.",
    );
  });

  it("worker: ZIPs interrompidos viram falha ao iniciar", async () => {
    const fx = await createExportFixture();
    const { exportId } = await startExport(fx.offerId, {});
    await claimNextExport();
    const dir = storagePath(`exports/${fx.offerId}`);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${exportId}.zip.abc.tmp`), "metade");
    expect(await failInterruptedExports()).toBe(1);
    const row = await prisma.export.findUniqueOrThrow({ where: { id: exportId } });
    expect(row.status).toBe("FAILED");
    expect(row.errorMessage).toBe(INTERRUPTED_MESSAGE);
    expect(objectExists(`exports/${fx.offerId}/${exportId}.zip.abc.tmp`)).toBe(false);
  });

  it("worker: o loop pega o pedido da fila e gera o ZIP", async () => {
    const fx = await createExportFixture();
    const { exportId } = await startExport(fx.offerId, {});
    let stop = false;
    const loop = exportLoop(() => stop);
    const deadline = Date.now() + 30_000;
    let status = "QUEUED";
    while (Date.now() < deadline) {
      status = (await prisma.export.findUniqueOrThrow({ where: { id: exportId } })).status;
      if (status === "DONE" || status === "FAILED") break;
      await new Promise((r) => setTimeout(r, 200));
    }
    stop = true;
    await loop;
    expect(status).toBe("DONE");
  }, 40_000);
});

describe("prévia do ZIP (exportPlan)", () => {
  let fx: ExportFixture;
  beforeAll(async () => {
    await removeExportFiles();
    await resetDatabase();
    fx = await createExportFixture();
  });

  it("árvore na ordem do funil, com divisor, versões, celular, Preservar JS e arquivos", async () => {
    const plan = await exportPlan(fx.offerId, { serverEvents: true });
    expect(plan.offerName).toBe("Oferta Teste Exportação");
    expect(plan.hasVariants).toBe(true);
    expect(plan.hasServerEventTokens).toBe(true);
    expect(plan.serverEventVendors).toEqual(["META", "TIKTOK"]);
    expect(plan.preserveJsPages).toEqual(["Quiz"]);
    expect(plan.tree.map((t) => [t.path, t.kind])).toEqual([
      ["index.html", "splitter"],
      ["oferta-a/index.html", "variant"],
      ["oferta-b/index.html", "variant"],
      ["upsell/index.html", "page"],
      ["upsell/celular/index.html", "mobile"],
      ["privacidade/index.html", "legal"],
      ["quiz/index.html", "page"],
      ["css/", "file"],
      ["dados/", "file"],
      ["img/", "file"],
      ["js/", "file"],
      ["assets/", "file"],
      ["404.html", "file"],
      ["eventos.php", "file"],
      ["eventos-dados/config.php", "file"],
      ["eventos-dados/.htaccess", "file"],
      ["LEIA-ME.txt", "file"],
    ]);
    expect(plan.tree[0].label).toBe("Divisor A/B de “Página principal” (A 50% · B 50%)");
    expect(plan.tree[2].label).toBe("Página principal — versão B (Headline nova) · 50%");
    expect(plan.warnings.join("\n")).toContain("Preservar JS");
  });

  it("opções padrão: sem eventos.php; sem divisor a raiz é a versão A", async () => {
    const plan = await exportPlan(fx.offerId, { splitter: false });
    const paths = plan.tree.map((t) => t.path);
    expect(paths).not.toContain("eventos.php");
    expect(plan.tree[0]).toEqual({
      path: "index.html",
      kind: "page",
      label: "Página principal — versão A (principal)",
    });
    await expectUserError(exportPlan("nao-existe"), OFFER_NOT_FOUND);
  });
});

describe("lista, apagar e limpeza", () => {
  beforeEach(async () => {
    await removeExportFiles();
    await resetDatabase();
  });

  async function doneExport(offerId: string, minutesAgo: number) {
    const createdAt = new Date(Date.now() - minutesAgo * 60_000);
    const row = await prisma.export.create({
      data: { offerId, status: "DONE", progress: 100, createdAt, fileName: "x.zip" },
      select: { id: true },
    });
    const key = exportFileKey(offerId, row.id);
    await putObject(key, "zip");
    await prisma.export.update({ where: { id: row.id }, data: { fileKey: key } });
    return { id: row.id, key };
  }

  it("lista do mais novo para o mais antigo; apagar tira o arquivo; gerando não pode apagar", async () => {
    const fx = await createExportFixture();
    const old = await doneExport(fx.offerId, 10);
    const recent = await doneExport(fx.offerId, 1);
    const list = await listExports(fx.offerId);
    expect(list.map((e) => e.id)).toEqual([recent.id, old.id]);
    await deleteExport(old.id);
    expect(objectExists(old.key)).toBe(false);
    expect((await listExports(fx.offerId)).map((e) => e.id)).toEqual([recent.id]);
    await expectUserError(deleteExport(old.id), "ZIP não encontrado. Ele pode ter sido apagado.");
    const { exportId } = await startExport(fx.offerId, {});
    await claimNextExport();
    await expectUserError(deleteExport(exportId), "Este ZIP está sendo gerado agora. Espere terminar para apagar.");
  });

  it(`fica com os ${EXPORTS_KEPT_PER_OFFER} mais recentes; lixeira, ofertas excluídas e sobras saem`, async () => {
    const fx = await createExportFixture();
    const rows = [];
    for (let i = 0; i < 7; i++) rows.push(await doneExport(fx.offerId, 100 - i));
    const queued = await startExport(fx.offerId, {});
    // Sobras: ZIP sem linha, temporário antigo e pasta de oferta que não existe mais.
    await putObject(`exports/${fx.offerId}/sem-linha.zip`, "zip");
    await putObject(`exports/${fx.offerId}/velho.zip.x.tmp`, "tmp");
    const old = new Date(Date.now() - 7 * 3600_000);
    await utimes(storagePath(`exports/${fx.offerId}/velho.zip.x.tmp`), old, old);
    await putObject(`exports/${fx.offerId}/novo.zip.y.tmp`, "tmp");
    await putObject("exports/oferta-que-nao-existe/a.zip", "zip");
    const dayAgo = new Date(Date.now() - 25 * 3600_000);
    await utimes(storagePath("exports/oferta-que-nao-existe/a.zip"), dayAgo, dayAgo);
    await utimes(storagePath("exports/oferta-que-nao-existe"), dayAgo, dayAgo);
    // Pasta nova de uma oferta que não está neste banco (outro banco na mesma pasta de dados): fica.
    await putObject("exports/oferta-de-outro-banco/b.zip", "zip");

    const report = await cleanupExports();
    expect(report.rows).toBe(2);
    const left = await prisma.export.findMany({ where: { offerId: fx.offerId }, select: { id: true } });
    expect(left.map((r) => r.id).sort()).toEqual([...rows.slice(2).map((r) => r.id), queued.exportId].sort());
    expect(objectExists(rows[0].key)).toBe(false);
    expect(objectExists(rows[1].key)).toBe(false);
    expect(objectExists(rows[6].key)).toBe(true);
    expect(objectExists(`exports/${fx.offerId}/sem-linha.zip`)).toBe(false);
    expect(objectExists(`exports/${fx.offerId}/velho.zip.x.tmp`)).toBe(false);
    expect(objectExists(`exports/${fx.offerId}/novo.zip.y.tmp`)).toBe(true);
    expect(objectExists("exports/oferta-que-nao-existe/a.zip")).toBe(false);
    expect(objectExists("exports/oferta-que-nao-existe")).toBe(false);
    expect(objectExists("exports/oferta-de-outro-banco/b.zip")).toBe(true);
    await rm(storagePath("exports/oferta-de-outro-banco"), { recursive: true, force: true });

    // Oferta na lixeira: os ZIPs prontos saem (o da fila fica até o worker falhar ele).
    await prisma.offer.update({ where: { id: fx.offerId }, data: { deletedAt: new Date() } });
    await cleanupExports({ offerId: fx.offerId });
    const trashed = await prisma.export.findMany({ where: { offerId: fx.offerId }, select: { id: true } });
    expect(trashed.map((r) => r.id)).toEqual([queued.exportId]);
    expect(objectExists(rows[6].key)).toBe(false);
  });
});

describe("rotas /api/exports", () => {
  let fx: ExportFixture;
  let exportId: string;

  beforeAll(async () => {
    await removeExportFiles();
    await resetDatabase();
    fx = await createExportFixture();
    exportId = (await exportNow(fx.offerId)).exportId;
  });

  beforeEach(() => {
    getSession.mockReset();
    getSession.mockResolvedValue({ user: { id: "u1" }, session: { id: "s1" } });
  });

  afterAll(() => {
    getSession.mockReset();
  });

  const req = (url: string, host = HOST) => new Request(`http://${host}${url}`, { headers: { host } });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  it("andamento: ExportView; exige login e o endereço do painel", async () => {
    const ok = await statusRoute(req(`/api/exports/${exportId}`), ctx(exportId));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const view = (await ok.json()) as ExportView;
    expect(view).toMatchObject({ id: exportId, offerId: fx.offerId, status: "DONE", progress: 100 });
    expect((await statusRoute(req("/api/exports/nao-existe"), ctx("nao-existe"))).status).toBe(404);
    expect((await statusRoute(req(`/api/exports/${exportId}`, "evil.com"), ctx(exportId))).status).toBe(403);
    getSession.mockResolvedValue(null);
    const denied = await statusRoute(req(`/api/exports/${exportId}`), ctx(exportId));
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ error: "Sua sessão expirou. Entre de novo." });
  });

  it("download em fluxo com o nome do arquivo; 409 enquanto gera; 410 sem o arquivo", async () => {
    const res = await downloadRoute(req(`/api/exports/${exportId}/download`), ctx(exportId));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    const view = (await getExportView(exportId)) as ExportView;
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="${view.fileName}"; filename*=UTF-8''${encodeURIComponent(view.fileName)}`,
    );
    const body = Buffer.from(await res.arrayBuffer());
    const file = await readFile(storagePath(exportFileKey(fx.offerId, exportId)));
    expect(body.equals(file)).toBe(true);
    expect(res.headers.get("content-length")).toBe(String(file.length));

    const pending = await startExport(fx.offerId, { splitter: false });
    const waiting = await downloadRoute(req(`/api/exports/${pending.exportId}/download`), ctx(pending.exportId));
    expect(waiting.status).toBe(409);
    expect(await waiting.json()).toEqual({ error: "O ZIP ainda está sendo gerado. Espere ficar pronto." });

    await deleteObject(exportFileKey(fx.offerId, exportId));
    const gone = await exportDownload(exportId);
    expect(gone).toEqual({ ok: false, status: 410, error: "O arquivo deste ZIP não existe mais. Gere de novo." });
    getSession.mockResolvedValue(null);
    expect((await downloadRoute(req(`/api/exports/${exportId}/download`), ctx(exportId))).status).toBe(401);
  });

  it("nome com acento vai em ASCII e em UTF-8", async () => {
    await prisma.export.update({ where: { id: exportId }, data: { fileName: "promoção-verão.zip" } });
    await putObject(exportFileKey(fx.offerId, exportId), "zip");
    const res = await downloadRoute(req(`/api/exports/${exportId}/download`), ctx(exportId));
    expect(res.headers.get("content-disposition")).toBe(
      "attachment; filename=\"promocao-verao.zip\"; filename*=UTF-8''promo%C3%A7%C3%A3o-ver%C3%A3o.zip",
    );
  });
});
