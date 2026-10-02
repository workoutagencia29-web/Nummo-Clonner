/**
 * Correções G1 — execução da clonagem (job.ts) de ponta a ponta:
 * - data#1 / ux#14: cancelar no fim não é sobrescrito por REVIEW/FAILED.
 * - data#6: cancelar interrompe na hora os downloads em andamento.
 * - data#12: banco fora do ar por um instante não deixa a clonagem "rodando" para sempre.
 * - fidelity#3: site Latin-1 sem acentos quebrados no Preservar JS e no CSS.
 * - fidelity#4: ZIP de página Latin-1 salva pelo navegador.
 * - fidelity#12: página sem doctype continua sem doctype na cópia.
 * - ux#5 / ux#9: avisos da captura e da importação chegam à revisão.
 * - ZIP com só a pasta "_files" e o layout do Chrome (Página.html + Página_files/).
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import iconv from "iconv-lite";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getObject, putObject } from "@/lib/storage";
import { createFetcher } from "@/worker/clone/fetcher";
import {
  failInterruptedJobs,
  pendingJobIds,
  runCloneJob,
  settlePendingJobs,
  zipFileResponse,
} from "@/worker/clone/job";
import type { CloneResult } from "@/worker/clone/types";
import { readZipSite } from "@/worker/clone/zip-import";
import { type FixtureServer, SITES_DIR, startFixtureServer, ZIPS_DIR } from "../fixtures/server";

const TMP = path.join(env.dataDir, `tmp-clone-g1-${randomBytes(4).toString("hex")}`);
const TEXT = `<p>${"Texto da oferta com bastante conteúdo para não parecer vazia. ".repeat(8)}</p>`;

let fixtures: FixtureServer;
let pub: http.Server;
let pp = 0;
/** Requisições do vídeo lento feitas pelo downloader (sem Range) → callback. */
let onSlowVideo: (() => void) | null = null;
const slowSockets = new Set<http.ServerResponse>();

beforeAll(async () => {
  fixtures = await startFixtureServer();
  pub = http.createServer((req, res) => {
    const url = req.url ?? "/";
    const html = (body: string) => {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(body);
    };
    if (url === "/erro") return req.socket.destroy();
    if (url === "/spa-vazio") {
      return html(`<!doctype html><html><head><meta charset="utf-8"><title>App</title>
<script src="/static/js/main.123abc.js"></script><script src="/static/js/chunk-1.js"></script><script src="/static/js/chunk-2.js"></script>
</head><body><div id="root"></div></body></html>`);
    }
    if (url.startsWith("/static/")) {
      res.statusCode = 404;
      return res.end();
    }
    if (url === "/quirks") {
      return html(`<html><head><meta charset="utf-8"><title>Fatias</title></head><body>${TEXT}</body></html>`);
    }
    if (url === "/lenta") {
      // O iframe nunca termina de carregar: o evento "load" da página não chega.
      return html(
        `<!doctype html><html><head><meta charset="utf-8"><title>Lenta</title></head><body>${TEXT}<iframe src="/nunca.html"></iframe></body></html>`,
      );
    }
    if (url === "/nunca.html") {
      slowSockets.add(res);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.write("<p>carregando");
      return;
    }
    if (url === "/vsl") {
      return html(
        `<!doctype html><html><head><meta charset="utf-8"><title>VSL</title></head><body>${TEXT}<video src="/lento.mp4" muted></video></body></html>`,
      );
    }
    if (url === "/lento.mp4") {
      // O downloader do clonador não pede Range; o Chromium pede. Um byte a cada 200 ms, para sempre.
      if (!req.headers.range) onSlowVideo?.();
      slowSockets.add(res);
      res.writeHead(200, { "content-type": "video/mp4", "content-length": String(200 * 1024 * 1024) });
      const timer = setInterval(() => res.write(Buffer.alloc(1)), 200);
      res.on("close", () => clearInterval(timer));
      return;
    }
    html(
      `<!doctype html><html><head><meta charset="utf-8"><title>Oferta G1</title></head><body><h1>Oferta</h1>${TEXT}</body></html>`,
    );
  });
  await new Promise<void>((r) => pub.listen(0, "127.0.0.1", r));
  pp = (pub.address() as AddressInfo).port;
  process.env.OS_CLONE_HOST_MAP = "*.fixture.test=127.0.0.1,pub.g1.test=127.0.0.1";
  await mkdir(TMP, { recursive: true });
}, 60_000);

afterAll(async () => {
  for (const res of slowSockets) res.destroy();
  await new Promise((r) => pub?.close(r));
  await fixtures?.close();
  await rm(TMP, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  onSlowVideo = null;
});

const pubUrl = (p: string) => `http://pub.g1.test:${pp}${p}`;

async function createJob(data: { source: "URL" | "ZIP" | "HTML"; sourceUrl?: string; uploadKey?: string }) {
  return prisma.cloneJob.create({ data: { ...data, options: { devices: ["desktop"], maxVideoMb: 300 } } });
}

async function runAndGet(jobId: string) {
  await runCloneJob(jobId);
  return prisma.cloneJob.findUniqueOrThrow({ where: { id: jobId } });
}

/** O mesmo que cancelClone (painel), sem passar pelos espiões do Prisma. */
async function cancelFromPanel(jobId: string) {
  await prisma.$executeRaw`update "CloneJob" set status = 'CANCELED', "finishedAt" = now()
    where id = ${jobId} and status in ('QUEUED', 'RUNNING')`;
}

/**
 * Antes da gravação de `status` (update ou updateMany), roda `before`. Simula o
 * usuário cancelando depois da última checagem do worker.
 */
function beforeStatusWrite(status: string, before: (jobId: string) => Promise<void>) {
  const delegate = prisma.cloneJob;
  let fired = false;
  const hook = async (args: { where?: { id?: string }; data?: { status?: unknown } }) => {
    if (!fired && args?.data?.status === status && args.where?.id) {
      fired = true;
      await before(args.where.id);
    }
  };
  for (const method of ["update", "updateMany"] as const) {
    const original = delegate[method] as (args: unknown) => Promise<unknown>;
    vi.spyOn(delegate, method).mockImplementation((async (args: never) => {
      await hook(args);
      return original.call(delegate, args);
    }) as never);
  }
  return () => fired;
}

function resultOf(job: { result: unknown }) {
  return job.result as unknown as CloneResult;
}

async function editableHtml(r: CloneResult) {
  const key = r.devices.desktop?.outputs.EDITABLE.htmlKey;
  if (!key) throw new Error("sem saída");
  return (await getObject(key)).toString("utf8");
}

async function zipDir(dir: string, entries: string[]) {
  const file = path.join(TMP, `${randomBytes(4).toString("hex")}.zip`);
  execFileSync("zip", ["-r", "-q", "-X", file, ...entries], { cwd: dir });
  const key = `uploads/g1-${path.basename(file)}`;
  await putObject(key, await readFile(file));
  return key;
}

// ─── Cancelamento ────────────────────────────────────────────────────────────

describe("cancelar no fim da clonagem (data#1, ux#14)", () => {
  it("cancelamento logo antes de gravar REVIEW: a clonagem fica cancelada", async () => {
    const fired = beforeStatusWrite("REVIEW", cancelFromPanel);
    const job = await createJob({ source: "URL", sourceUrl: pubUrl("/") });
    const done = await runAndGet(job.id);
    expect(fired()).toBe(true);
    expect(done.status).toBe("CANCELED");
    expect(done.result).toBeNull();
    const logs = await prisma.cloneLog.findMany({ where: { jobId: job.id } });
    expect(logs.some((l) => l.message === "Clonagem cancelada.")).toBe(true);
    expect(logs.some((l) => l.message.startsWith("Cópia pronta"))).toBe(false);
  }, 120_000);

  it("cancelamento logo antes de gravar a falha por proteção: continua cancelada", async () => {
    const fired = beforeStatusWrite("FAILED", cancelFromPanel);
    const job = await createJob({ source: "URL", sourceUrl: fixtures.url("protegido") });
    const done = await runAndGet(job.id);
    expect(fired()).toBe(true);
    expect(done.status).toBe("CANCELED");
    expect(done.errorCode).toBeNull();
  }, 120_000);

  it("cancelamento logo antes de gravar um erro: continua cancelada", async () => {
    const fired = beforeStatusWrite("FAILED", cancelFromPanel);
    const job = await createJob({ source: "URL", sourceUrl: pubUrl("/erro") });
    const done = await runAndGet(job.id);
    expect(fired()).toBe(true);
    expect(done.status).toBe("CANCELED");
    expect(done.errorMessage).toBeNull();
  }, 120_000);

  it("clonagem cancelada ainda na fila não é executada", async () => {
    const job = await createJob({ source: "URL", sourceUrl: pubUrl("/") });
    await cancelFromPanel(job.id);
    const done = await runAndGet(job.id);
    expect(done.status).toBe("CANCELED");
    expect(done.startedAt).toBeNull();
  }, 60_000);
});

describe("cancelar durante os downloads (data#6)", () => {
  it("o download em andamento de um vídeo é interrompido e o worker fica livre na hora", async () => {
    const job = await createJob({ source: "URL", sourceUrl: pubUrl("/vsl") });
    let canceledAt = 0;
    onSlowVideo = () => {
      if (canceledAt) return;
      canceledAt = Date.now();
      void cancelFromPanel(job.id);
    };
    const done = await runAndGet(job.id);
    expect(canceledAt).toBeGreaterThan(0);
    // Antes: esperava o vídeo inteiro (até ~200 s). Agora: a próxima checagem (≤ 1,5 s) + encerramento.
    expect(Date.now() - canceledAt).toBeLessThan(10_000);
    expect(done.status).toBe("CANCELED");
  }, 120_000);

  it("createFetcher({ signal }): abortar interrompe o download e apaga o arquivo parcial", async () => {
    const controller = new AbortController();
    const fetcher = createFetcher({ hostMap: { "pub.g1.test": "127.0.0.1" }, signal: controller.signal });
    const dest = path.join(TMP, "parcial.mp4");
    try {
      const started = Date.now();
      setTimeout(() => controller.abort(), 500);
      await expect(fetcher.downloadToFile(pubUrl("/lento.mp4"), dest, 300 * 1024 * 1024)).rejects.toThrow(
        "O download foi cancelado.",
      );
      expect(Date.now() - started).toBeLessThan(5000);
      expect(existsSync(dest)).toBe(false);
      // Depois de cancelado, nada mais é baixado.
      const again = await fetcher.fetchResource(pubUrl("/"));
      expect(again.ok).toBe(false);
      expect(again.error).toBe("O download foi cancelado.");
    } finally {
      await fetcher.close();
    }
  }, 30_000);
});

// ─── Banco fora do ar ────────────────────────────────────────────────────────

describe("banco fora do ar por um instante (data#12)", () => {
  it("falha ao ler a clonagem no início: termina FAILED, não fica rodando", async () => {
    const job = await createJob({ source: "URL", sourceUrl: pubUrl("/") });
    vi.spyOn(prisma.cloneJob, "findUnique").mockRejectedValueOnce(new Error("Can't reach database server"));
    const done = await runAndGet(job.id);
    expect(done.status).toBe("FAILED");
    expect(done.finishedAt).not.toBeNull();
  }, 60_000);

  it("falha passageira ao gravar REVIEW: tenta de novo e o resultado é salvo", async () => {
    const job = await createJob({ source: "URL", sourceUrl: pubUrl("/") });
    const delegate = prisma.cloneJob;
    const original = delegate.updateMany;
    let failures = 0;
    vi.spyOn(delegate, "updateMany").mockImplementation((async (args: { data?: { status?: unknown } }) => {
      if (args?.data?.status === "REVIEW" && failures < 2) {
        failures++;
        throw new Error("Can't reach database server");
      }
      return original.call(delegate, args as never);
    }) as never);
    const done = await runAndGet(job.id);
    expect(failures).toBe(2);
    expect(done.status).toBe("REVIEW");
    expect(resultOf(done).title).toBe("Oferta G1");
  }, 60_000);

  it("banco fora do ar no fim: o resultado fica pendente e é gravado quando o banco volta", async () => {
    const job = await createJob({ source: "URL", sourceUrl: pubUrl("/") });
    const delegate = prisma.cloneJob;
    const original = delegate.updateMany;
    vi.spyOn(delegate, "updateMany").mockImplementation((async (args: { data?: { status?: unknown } }) => {
      if (args?.data?.status === "REVIEW") throw new Error("Can't reach database server");
      return original.call(delegate, args as never);
    }) as never);
    const stuck = await runAndGet(job.id);
    expect(stuck.status).toBe("RUNNING");
    expect(pendingJobIds()).toContain(job.id);

    vi.restoreAllMocks(); // o banco voltou
    await settlePendingJobs();
    const done = await prisma.cloneJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe("REVIEW");
    expect(resultOf(done).title).toBe("Oferta G1");
    expect(pendingJobIds()).not.toContain(job.id);
  }, 60_000);

  it("ao iniciar, clonagens interrompidas viram falha e seus downloads pela metade são apagados", async () => {
    const job = await prisma.cloneJob.create({
      data: { source: "URL", sourceUrl: pubUrl("/"), status: "RUNNING", startedAt: new Date() },
    });
    const tmpDir = path.join(env.dataDir, "tmp", "clone", job.id);
    await mkdir(tmpDir, { recursive: true });
    await writeFile(path.join(tmpDir, "video.part"), Buffer.alloc(1024));
    await failInterruptedJobs();
    const done = await prisma.cloneJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe("FAILED");
    expect(done.errorCode).toBe("INTERRUPTED");
    expect(existsSync(tmpDir)).toBe(false);
  });
});

// ─── Charset ─────────────────────────────────────────────────────────────────

describe("sites e ZIPs em ISO-8859-1 (fidelity#3, fidelity#4)", () => {
  it("link de site Latin-1: título do Preservar JS e CSS guardado com os acentos certos", async () => {
    const job = await createJob({ source: "URL", sourceUrl: fixtures.url("legado") });
    const done = await runAndGet(job.id);
    expect(done.status, done.errorMessage ?? "").toBe("REVIEW");
    const r = resultOf(done);
    const preserveKey = r.devices.desktop?.outputs.PRESERVE_JS.htmlKey ?? "";
    const preserve = (await getObject(preserveKey)).toString("utf8");
    expect(preserve).toContain("<title>Promoção Relâmpago | Loja São João - Açaí e Cia</title>");
    expect(preserve).not.toContain("Ã");
    const css = r.assets.find((a) => a.sourceUrl.endsWith("/sub/css/estilo.css"));
    expect(css).toBeDefined();
    const cssText = (await getObject(css?.key ?? "")).toString("utf8");
    expect(cssText).toContain("Promoção válida até domingo - não perca!");
    expect(cssText).not.toContain("Ã");
  }, 180_000);

  it("ZIP de página Latin-1 salva pelo navegador: acentos corretos (HTML, CSS e texto do JS)", async () => {
    const key = await zipDir(path.join(SITES_DIR, "legado"), ["index.html", "sub"]);
    const job = await createJob({ source: "ZIP", uploadKey: key });
    const done = await runAndGet(job.id);
    expect(done.status, done.errorMessage ?? "").toBe("REVIEW");
    const r = resultOf(done);
    expect(r.title).toBe("Promoção Relâmpago | Loja São João - Açaí e Cia");
    const html = await editableHtml(r);
    expect(html).toContain("Promoção de Verão: Açaí na Tigela com 40% de desconto!");
    expect(html).toContain("Frete grátis para São João del-Rei e região!");
    expect(html).not.toContain("�");
    const css = r.assets.find((a) => a.sourceUrl.endsWith("/sub/css/estilo.css"));
    const cssText = (await getObject(css?.key ?? "")).toString("utf8");
    expect(cssText).toContain("Promoção válida até domingo - não perca!");
  }, 180_000);

  it("zipFileResponse: texto vira UTF-8 com cabeçalho coerente; binários e .htm", () => {
    const latin = iconv.encode(
      '<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1"><p>Ação</p>',
      "latin1",
    );
    const page = zipFileResponse("/pagina.htm", latin);
    expect(page.contentType).toBe("text/html; charset=utf-8");
    expect(page.body.toString("utf8")).toContain("<p>Ação</p>");
    const css = zipFileResponse("/css/a.css", iconv.encode(".a:before{content:'promoção'}", "latin1"));
    expect(css.body.toString("utf8")).toContain("promoção");
    const utf8 = Buffer.from("<p>Já em UTF-8</p>", "utf8");
    expect(zipFileResponse("/index.html", utf8).body.equals(utf8)).toBe(true);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    expect(zipFileResponse("/img/a.png", png)).toEqual({ body: png, contentType: "image/png" });
  });
});

// ─── ZIP salvo pelo navegador ────────────────────────────────────────────────

describe("ZIP do navegador: pasta “_files” (ux#9)", () => {
  it("Página.html + Página_files/saved_resource.html: a página certa, sem aviso de 'escolhemos'", async () => {
    const site = await readZipSite(path.join(ZIPS_DIR, "good.zip"));
    expect(site.indexPath).toBe("Página.html");
    expect(site.warnings).toEqual([]);
  });

  it("ZIP só com a pasta “_files”: falha dizendo o que fazer", async () => {
    const dir = path.join(TMP, "so-files");
    await mkdir(path.join(dir, "Oferta_files"), { recursive: true });
    await writeFile(path.join(dir, "Oferta_files", "saved_resource.html"), "<html><body>chat</body></html>");
    await writeFile(path.join(dir, "Oferta_files", "estilo.css"), "body{}");
    const key = await zipDir(dir, ["Oferta_files"]);
    const job = await createJob({ source: "ZIP", uploadKey: key });
    const done = await runAndGet(job.id);
    expect(done.status).toBe("FAILED");
    expect(done.errorMessage).toMatch(/compactou só a pasta “_files”/);
  }, 60_000);

  it("ZIP sem index.html com várias páginas: o aviso de qual foi escolhida chega à revisão", async () => {
    const dir = path.join(TMP, "varias");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "curta.html"), "<html><body><p>curta</p></body></html>");
    await writeFile(
      path.join(dir, "vendas.html"),
      `<!doctype html><html><head><title>Vendas</title></head><body>${TEXT}</body></html>`,
    );
    const key = await zipDir(dir, ["curta.html", "vendas.html"]);
    const job = await createJob({ source: "ZIP", uploadKey: key });
    const done = await runAndGet(job.id);
    expect(done.status, done.errorMessage ?? "").toBe("REVIEW");
    const warning = resultOf(done).warnings.find((w) => w.code === "IMPORT");
    expect(warning?.message).toMatch(/usamos "vendas\.html" como página principal/);
  }, 120_000);
});

// ─── Avisos da captura na revisão ────────────────────────────────────────────

describe("avisos da captura chegam à revisão (ux#5, ux#9)", () => {
  it("app que abriu quase vazia: aviso EMPTY_PAGE na revisão e WARN no log", async () => {
    const job = await createJob({ source: "URL", sourceUrl: pubUrl("/spa-vazio") });
    const done = await runAndGet(job.id);
    expect(done.status, done.errorMessage ?? "").toBe("REVIEW");
    const warning = resultOf(done).warnings.find((w) => w.code === "EMPTY_PAGE");
    expect(warning?.message).toMatch(/praticamente vazia/);
    const logs = await prisma.cloneLog.findMany({ where: { jobId: job.id } });
    expect(logs.some((l) => l.level === "WARN" && /praticamente vazia/.test(l.message))).toBe(true);
    expect(logs.some((l) => l.level === "SUCCESS" && l.message.startsWith("Página aberta"))).toBe(false);
  }, 120_000);

  it("página que não terminou de carregar: aviso PAGE_STALLED na revisão", async () => {
    const job = await createJob({ source: "URL", sourceUrl: pubUrl("/lenta") });
    const done = await runAndGet(job.id);
    expect(done.status, done.errorMessage ?? "").toBe("REVIEW");
    const warning = resultOf(done).warnings.find((w) => w.code === "PAGE_STALLED");
    expect(warning?.message).toMatch(/continuou carregando/);
  }, 180_000);
});

describe("doctype na cópia (fidelity#12)", () => {
  it("página sem doctype: a cópia Editável também fica sem (modo quirks preservado)", async () => {
    const job = await createJob({ source: "URL", sourceUrl: pubUrl("/quirks") });
    const done = await runAndGet(job.id);
    expect(done.status, done.errorMessage ?? "").toBe("REVIEW");
    const html = await editableHtml(resultOf(done));
    expect(html.trimStart().toLowerCase().startsWith("<!doctype")).toBe(false);
  }, 120_000);
});
