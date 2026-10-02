/**
 * Clonagem de ponta a ponta nos sites de teste (offline): cria o pedido, roda o
 * worker (Chromium de verdade), confere o resultado com o gabarito de cada site
 * e abre a cópia SEM acesso a nenhum servidor — a prova de que a página não
 * depende do site original.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { injectRuntime } from "@/lib/runtime-bundle";
import { getObject, mimeFromKey } from "@/lib/storage";
import { saveClone } from "@/server/services/clone";
import { runCloneJob } from "@/worker/clone/job";
import type { CloneModeValue, CloneResult, Device } from "@/worker/clone/types";
import { type FixtureServer, SITES_DIR, startFixtureServer, ZIPS_DIR } from "../fixtures/server";

let srv: FixtureServer;
let browser: Browser;

beforeAll(async () => {
  srv = await startFixtureServer();
  process.env.OS_CLONE_HOST_MAP = "*.fixture.test=127.0.0.1";
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await srv?.close();
});

async function expected<T = Record<string, unknown>>(site: string): Promise<T> {
  return JSON.parse(await readFile(path.join(SITES_DIR, site, "_expected.json"), "utf8")) as T;
}

async function cloneUrl(url: string, devices: Device[] = ["desktop", "mobile"]) {
  const job = await prisma.cloneJob.create({
    data: { source: "URL", sourceUrl: url, options: { devices, maxVideoMb: 20 } },
  });
  await runCloneJob(job.id);
  return prisma.cloneJob.findUniqueOrThrow({ where: { id: job.id } });
}

function resultOf(job: { result: unknown }) {
  return job.result as unknown as CloneResult;
}

async function outputHtml(result: CloneResult, device: Device, mode: CloneModeValue) {
  const out = result.devices[device]?.outputs[mode];
  if (!out) throw new Error(`sem saída ${device}/${mode}`);
  return (await getObject(out.htmlKey)).toString("utf8");
}

/**
 * Abre o HTML num navegador que só consegue falar com "preview.test" (servido a
 * partir do storage). Qualquer outra requisição é bloqueada e anotada.
 */
async function renderOffline(html: string) {
  const page = await browser.newPage();
  const external: string[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === "data:" || url.protocol === "blob:") return route.continue();
    if (url.host === "preview.test") {
      if (url.pathname === "/") {
        return route.fulfill({
          body: injectRuntime(html, "<script data-os-runtime></script>"),
          contentType: "text/html; charset=utf-8",
        });
      }
      if (url.pathname.startsWith("/os-assets/")) {
        const file = url.pathname.slice("/os-assets/".length);
        const key = `a/${file.slice(0, 2)}/${file}`;
        try {
          return route.fulfill({ body: await getObject(key), contentType: mimeFromKey(key) });
        } catch {
          return route.fulfill({ status: 404, body: "" });
        }
      }
      return route.fulfill({ status: 404, body: "" });
    }
    external.push(url.href);
    return route.abort();
  });
  await page.goto("http://preview.test/", { waitUntil: "load" });
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 30));
    }
  });
  await page.waitForTimeout(300);
  const broken = await page.evaluate(() =>
    Array.from(document.images)
      .filter((i) => i.complete && i.naturalWidth === 0 && !i.src.startsWith("data:"))
      .map((i) => i.currentSrc || i.src),
  );
  // Espera as fontes terminarem de carregar antes de contar (evita resultado instável).
  const fontsLoaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return Array.from(document.fonts).filter((f) => f.status === "loaded").length;
  });
  // innerText não enxerga shadow DOM: juntamos o texto das shadow roots também.
  const text = await page.evaluate(() => {
    const parts = [document.body.innerText];
    for (const el of Array.from(document.querySelectorAll("*"))) {
      if (el.shadowRoot) parts.push(el.shadowRoot.textContent ?? "");
    }
    return parts.join("\n");
  });
  const hiddenRoots = await page.evaluate(
    () =>
      Array.from(document.querySelectorAll(".sc-raiz")).filter((el) => getComputedStyle(el).display === "none").length,
  );
  await page.close();
  return { external, broken, fontsLoaded, text, hiddenRoots };
}

describe("clonagem de ponta a ponta (sites de teste offline)", () => {
  it("vendas: baixa tudo, acha os checkouts e o funil, e a cópia abre sem o site original", async () => {
    const exp = await expected<{ checkouts: { url: string; ocorrencias: number }[] }>("vendas");
    const job = await cloneUrl(srv.url("vendas"));
    expect(job.status, job.errorMessage ?? "").toBe("REVIEW");
    const r = resultOf(job);

    expect(r.responsive).toBe(true);
    for (const c of exp.checkouts) {
      const found = r.checkouts.find((x) => x.url === c.url);
      expect(found, c.url).toBeDefined();
      expect(found?.platform).toBe("Hotmart");
      expect(found?.occurrences).toBe(c.ocorrencias);
    }
    expect(r.checkouts.some((c) => c.url.includes("wa.me"))).toBe(false);
    const kinds = r.funnel.map((f) => `${f.kind}:${new URL(f.url).pathname}`);
    expect(kinds).toEqual(expect.arrayContaining(["UPSELL:/upsell", "THANK_YOU:/obrigado"]));
    expect(r.stats.failed).toBe(0);
    expect(r.thumbnailKey).toBeTruthy();

    const html = await outputHtml(r, "desktop", "EDITABLE");
    // Nenhum arquivo aponta para a origem (links de navegação para outras
    // páginas do site são esperados; viram links do funil ao salvar).
    const withoutLinks = html.replace(/<a\b[^>]*>/gi, "");
    expect(withoutLinks).not.toContain(".fixture.test:");
    expect(html).not.toMatch(/rel="canonical"|og:url/);
    expect(html).toContain("data-os-checkout");

    srv.requests.length = 0;
    const view = await renderOffline(html);
    expect(view.external.filter((u) => u.includes("fixture.test"))).toEqual([]);
    expect(view.broken).toEqual([]);
    expect(view.fontsLoaded).toBeGreaterThan(0);
    expect(srv.requests).toEqual([]);
  }, 180_000);

  it("rastreadores: remove pixels, tags e chats e mantém os scripts legítimos", async () => {
    const exp = await expected<{ remover: { vendor: string; id?: string }[] }>("rastreadores");
    const job = await cloneUrl(srv.url("rastreadores"), ["desktop"]);
    expect(job.status, job.errorMessage ?? "").toBe("REVIEW");
    const r = resultOf(job);
    const vendors = r.removed.map((x) => `${x.vendor} ${x.pixelId ?? ""}`).join(" | ");
    for (const id of exp.remover.map((x) => x.id).filter(Boolean)) {
      expect(vendors, `pixel ${id}`).toContain(id as string);
    }
    for (const mode of ["EDITABLE", "PRESERVE_JS"] as const) {
      const html = await outputHtml(r, "desktop", mode);
      for (const needle of [
        "fbq(",
        "ttq.",
        "kwaiq",
        "googletagmanager.com",
        "gtag(",
        "hotjar",
        "clarity.ms",
        "jivosite",
        "tawk.to",
        "utmify",
        "facebook-domain-verification",
      ]) {
        expect(html.toLowerCase(), `${mode}: ${needle}`).not.toContain(needle.toLowerCase());
      }
      expect(html).toContain("application/ld+json");
      expect(html).toContain("vturb-smartplayer");
    }
    expect(await outputHtml(r, "desktop", "PRESERVE_JS")).toContain("/os-assets/");
  }, 180_000);

  it("VSL: acha o VTurb, o YouTube e o vídeo do site, e o delay de 332 s", async () => {
    const job = await cloneUrl(srv.url("vsl"), ["desktop"]);
    expect(job.status, job.errorMessage ?? "").toBe("REVIEW");
    const r = resultOf(job);
    expect(r.videos.map((v) => v.provider)).toEqual(expect.arrayContaining(["VTURB", "YOUTUBE", "NATIVE"]));
    expect(r.delay?.seconds).toBe(332);
    expect(r.checkouts.some((c) => c.url.startsWith("https://pay.kiwify.com.br/Pr0t0c0l0"))).toBe(true);
    const html = await outputHtml(r, "desktop", "EDITABLE");
    expect(html).toContain('data-os-delay="332"');
    expect(html).not.toContain("SECONDS_TO_DISPLAY");
    expect(r.assets.some((a) => a.kind === "VIDEO")).toBe(true);
    expect(html).toMatch(/<video[^>]*muted/);
  }, 180_000);

  it("celular: o site entrega HTML diferente no celular → duas versões", async () => {
    const job = await cloneUrl(srv.url("celular"));
    expect(job.status, job.errorMessage ?? "").toBe("REVIEW");
    const r = resultOf(job);
    expect(r.responsive).toBe(false);
    expect(await outputHtml(r, "desktop", "EDITABLE")).toContain("Versão desktop");
    expect(await outputHtml(r, "mobile", "EDITABLE")).toContain("Versão celular");
  }, 180_000);

  it("legado (ISO-8859-1): acentos corretos, <base> resolvido, integrity removido", async () => {
    const exp = await expected<{ titulo: string; textosComAcento: string[] }>("legado");
    const job = await cloneUrl(srv.url("legado"), ["desktop"]);
    expect(job.status, job.errorMessage ?? "").toBe("REVIEW");
    const r = resultOf(job);
    expect(r.title).toBe(exp.titulo);
    const html = await outputHtml(r, "desktop", "EDITABLE");
    for (const t of exp.textosComAcento) expect(html).toContain(t);
    expect(html).not.toMatch(/<base\b/i);
    expect(html).not.toContain("integrity=");
    expect(html.toLowerCase()).toContain('<meta charset="utf-8">');
    const view = await renderOffline(html);
    expect(view.broken).toEqual([]);
    expect(view.external.filter((u) => u.includes("fixture.test"))).toEqual([]);
  }, 180_000);

  it("shadow DOM e CSS-in-JS: o conteúdo aparece na cópia", async () => {
    const exp = await expected<{ textoNoShadow: string }>("shadow");
    const job = await cloneUrl(srv.url("shadow"), ["desktop"]);
    expect(job.status, job.errorMessage ?? "").toBe("REVIEW");
    const html = await outputHtml(resultOf(job), "desktop", "EDITABLE");
    const view = await renderOffline(html);
    expect(view.text).toContain(exp.textoNoShadow);
    // CSS-in-JS serializado: sem ele, .sc-raiz ficaria escondido.
    expect(view.hiddenRoots).toBe(0);
  }, 180_000);

  it("página protegida: falha com mensagem clara (sem tentar contornar)", async () => {
    const job = await cloneUrl(srv.url("protegido"), ["desktop"]);
    expect(job.status).toBe("FAILED");
    expect(job.errorCode).toBe("BOT_CHALLENGE");
    expect(job.errorMessage).toMatch(/proteção contra robôs/i);
  }, 180_000);

  it("endereço interno é bloqueado (proteção SSRF)", async () => {
    delete process.env.OS_CLONE_HOST_MAP;
    try {
      const job = await cloneUrl("http://127.0.0.1:9/", ["desktop"]);
      expect(job.status).toBe("FAILED");
      expect(job.errorMessage).toMatch(/rede interna/);
    } finally {
      process.env.OS_CLONE_HOST_MAP = "*.fixture.test=127.0.0.1";
    }
  }, 60_000);

  it("ZIP salvo pelo navegador: importa e monta a cópia", async () => {
    const { putObject } = await import("@/lib/storage");
    const key = "uploads/teste-good.zip";
    await putObject(key, await readFile(path.join(ZIPS_DIR, "good.zip")));
    const job = await prisma.cloneJob.create({
      data: { source: "ZIP", uploadKey: key, options: { devices: ["desktop"], maxVideoMb: 20, fileName: "good.zip" } },
    });
    await runCloneJob(job.id);
    const done = await prisma.cloneJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status, done.errorMessage ?? "").toBe("REVIEW");
    const r = resultOf(done);
    expect(r.stats.assets).toBeGreaterThan(0);
    const view = await renderOffline(await outputHtml(r, "desktop", "EDITABLE"));
    expect(view.broken).toEqual([]);
  }, 180_000);

  it("ZIP malicioso (../) é recusado com mensagem clara", async () => {
    const { putObject } = await import("@/lib/storage");
    const key = "uploads/teste-slip.zip";
    await putObject(key, await readFile(path.join(ZIPS_DIR, "slip.zip")));
    const job = await prisma.cloneJob.create({
      data: { source: "ZIP", uploadKey: key, options: { devices: ["desktop"], maxVideoMb: 20 } },
    });
    await runCloneJob(job.id);
    const done = await prisma.cloneJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe("FAILED");
    expect(done.errorMessage).toMatch(/ZIP/);
  }, 60_000);

  it("salvar: vendas + upsell viram uma oferta com o funil ligado", async () => {
    const main = await cloneUrl(srv.url("vendas"), ["desktop"]);
    const upsell = await prisma.cloneJob.create({
      data: {
        source: "URL",
        sourceUrl: srv.url("vendas", "/upsell"),
        options: { devices: ["desktop"], maxVideoMb: 20 },
        parentJobId: main.id,
      },
    });
    await runCloneJob(upsell.id);
    const offer = await saveClone({
      jobId: main.id,
      name: "Oferta clonada",
      folderId: null,
      mode: "EDITABLE",
      keepRemoved: [],
      childJobIds: [upsell.id],
    });
    const pages = await prisma.page.findMany({
      where: { offerId: offer.id },
      orderBy: { position: "asc" },
      include: { variants: { include: { documents: true } } },
    });
    expect(pages).toHaveLength(2);
    expect(pages[0].isHome).toBe(true);
    expect(pages[1].type).toBe("UPSELL");
    const homeHtml = pages[0].variants[0].documents[0].html ?? "";
    expect(homeHtml).toContain(`os-page:${pages[1].id}`);
    const checkouts = await prisma.checkoutLink.count({ where: { pageId: pages[0].id } });
    expect(checkouts).toBeGreaterThan(0);
    // Cada checkout detectado virou um link da oferta, e os botões estão ligados a ele.
    const links = await prisma.offerLink.findMany({ where: { offerId: offer.id }, orderBy: { position: "asc" } });
    expect(links.map((l) => l.url)).toEqual(
      expect.arrayContaining([
        "https://pay.hotmart.com/A12345678B?off=abc123&checkoutMode=10",
        "https://pay.hotmart.com/A12345678B?off=def456&checkoutMode=10",
      ]),
    );
    expect(links[0].label).toBe("Checkout Hotmart");
    expect(homeHtml).toContain(`data-os-link="${links[0].key}"`);
    const saved = await prisma.cloneJob.findUniqueOrThrow({ where: { id: main.id } });
    expect(saved.status).toBe("SAVED");
    expect(saved.offerId).toBe(offer.id);
  }, 240_000);
});
