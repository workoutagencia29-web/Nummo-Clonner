/**
 * Consulta de CEP (pop-up) numa página clonada no modo "Com scripts": o pop-up
 * pede o CEP, o site consulta uma API pública de endereço (ViaCEP) e preenche o
 * endereço. A cópia clonada tem que continuar fazendo isso — a API de CEP nunca
 * pode ser removida nem bloqueada.
 */
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getObject, mimeFromKey } from "@/lib/storage";
import { runCloneJob } from "@/worker/clone/job";
import type { CloneResult, Device } from "@/worker/clone/types";
import { type FixtureServer, startFixtureServer } from "../fixtures/server";

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

async function clone(url: string) {
  const job = await prisma.cloneJob.create({
    data: { source: "URL", sourceUrl: url, options: { devices: ["desktop"], maxVideoMb: 0 } },
  });
  await runCloneJob(job.id);
  return prisma.cloneJob.findUniqueOrThrow({ where: { id: job.id } });
}

/** Serve a cópia "Com scripts" e intercepta a API de CEP com um endereço de mentira. */
async function openPreserveJs(result: CloneResult, device: Device) {
  const out = result.devices[device]?.outputs.PRESERVE_JS;
  if (!out) throw new Error("sem saída PRESERVE_JS");
  const html = (await getObject(out.htmlKey)).toString("utf8");
  const page = await browser.newPage();
  const blocked: string[] = [];
  let cepCalled = "";
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.protocol === "data:" || u.protocol === "blob:") return route.continue();
    if (u.host === "viacep.com.br") {
      cepCalled = u.href;
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ logradouro: "Praça da Sé", bairro: "Sé", localidade: "São Paulo", uf: "SP" }),
      });
    }
    if (u.host === "brasilapi.com.br") {
      cepCalled = u.href;
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          cep: "01001000",
          street: "Praça da Sé",
          neighborhood: "Sé",
          city: "São Paulo",
          state: "SP",
        }),
      });
    }
    if (u.host === "preview.test") {
      if (u.pathname === "/") return route.fulfill({ body: html, contentType: "text/html; charset=utf-8" });
      const file = u.pathname.replace(/^\/os-assets\//, "");
      const key = `a/${file.slice(0, 2)}/${file}`;
      try {
        return route.fulfill({ body: await getObject(key), contentType: mimeFromKey(key) });
      } catch {
        return route.fulfill({ status: 404, body: "" });
      }
    }
    blocked.push(u.href);
    return route.abort();
  });
  await page.goto("http://preview.test/", { waitUntil: "load" });
  return { page, blocked, cep: () => cepCalled };
}

/** Serve a cópia EDITÁVEL (o que a conversão "para editar" usa) com a API de CEP de mentira. */
async function openEditable(result: CloneResult, device: Device) {
  const out = result.devices[device]?.outputs.EDITABLE;
  if (!out) throw new Error("sem saída EDITABLE");
  const html = (await getObject(out.htmlKey)).toString("utf8");
  const page = await browser.newPage();
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.protocol === "data:" || u.protocol === "blob:") return route.continue();
    if (u.host === "viacep.com.br") {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ logradouro: "Praça da Sé", bairro: "Sé", localidade: "São Paulo", uf: "SP" }),
      });
    }
    if (u.host === "brasilapi.com.br") {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          cep: "01001000",
          street: "Praça da Sé",
          neighborhood: "Sé",
          city: "São Paulo",
          state: "SP",
        }),
      });
    }
    if (u.host === "preview.test") {
      if (u.pathname === "/") return route.fulfill({ body: html, contentType: "text/html; charset=utf-8" });
      const file = u.pathname.replace(/^\/os-assets\//, "");
      const key = `a/${file.slice(0, 2)}/${file}`;
      try {
        return route.fulfill({ body: await getObject(key), contentType: mimeFromKey(key) });
      } catch {
        return route.fulfill({ status: 404, body: "" });
      }
    }
    return route.abort();
  });
  await page.goto("http://preview.test/", { waitUntil: "load" });
  return { page, html };
}

describe("pop-up de CEP numa página clonada (Com scripts)", () => {
  it("o pop-up pede o CEP, a API é consultada e o endereço aparece", async () => {
    const job = await clone(srv.url("popcep"));
    expect(job.status).toBe("REVIEW");
    const result = job.result as unknown as CloneResult;
    // A API de CEP não entra na lista de rastreadores removidos.
    expect(result.removed.some((r) => /viacep|cep/i.test(r.vendor))).toBe(false);

    const { page, cep } = await openPreserveJs(result, "desktop");
    // O pop-up está na tela.
    expect(await page.locator("#overlay").isVisible()).toBe(true);
    expect(await page.getByText("Informe seu CEP").count()).toBe(1);
    await page.locator("#cep").fill("01001000");
    await page.locator("#confirmar").click();
    // A consulta foi feita e o endereço apareceu; o pop-up fechou.
    await page.waitForFunction(() => document.getElementById("endereco")?.textContent !== "\u2014", undefined, {
      timeout: 10_000,
    });
    expect(await page.locator("#endereco").textContent()).toBe("Praça da Sé, Sé — São Paulo/SP");
    expect(cep()).toContain("viacep.com.br/ws/01001000");
    expect(await page.locator("#overlay").isVisible()).toBe(false);
    await page.close();
  }, 120_000);

  it("CEP que consulta o PRÓPRIO backend do site: o atalho atende pela API pública e o endereço aparece", async () => {
    const job = await clone(srv.url("popcep-own"));
    const result = job.result as unknown as CloneResult;
    const { page, cep, blocked } = await openPreserveJs(result, "desktop");
    await page.locator("#cep").fill("01001000");
    await page.locator("#ok").click();
    await page.waitForFunction(() => document.getElementById("endereco")?.textContent !== "\u2014", undefined, {
      timeout: 10_000,
    });
    // O endereço (vindo da BrasilAPI pelo atalho) apareceu com os campos que o site lê (rua/cidade/uf).
    expect(await page.locator("#endereco").textContent()).toBe("Praça da Sé — São Paulo/SP");
    // A consulta ao backend do próprio site não saiu (foi atendida pelo atalho); a pública, sim.
    expect(cep()).toMatch(/brasilapi\.com\.br|viacep\.com\.br/);
    expect(blocked.some((u) => /\/api\/cep\//.test(u))).toBe(false);
    await page.close();
  }, 120_000);

  it("padrão real do usuário (BrasilAPI v1, lê data.city/data.state): o endereço aparece na cópia", async () => {
    const job = await clone(srv.url("popcep-brasil"));
    const result = job.result as unknown as CloneResult;
    const { page, cep } = await openPreserveJs(result, "desktop");
    await page.locator("#cepInput").fill("01001000");
    await page.locator("#verificarBtn").click();
    await page.waitForSelector("#localInfo", { state: "visible", timeout: 10_000 });
    expect(await page.locator("#localInfo").textContent()).toContain("São Paulo/SP");
    expect(cep()).toContain("brasilapi.com.br/api/cep/v1/01001000");
    await page.close();
  }, 120_000);

  it("CEP continua funcionando no modo EDITÁVEL (ao editar a página): o script do pop-up é mantido", async () => {
    const job = await clone(srv.url("popcep-brasil"));
    const result = job.result as unknown as CloneResult;
    const { page, html } = await openEditable(result, "desktop");
    // O script do pop-up de CEP foi mantido no Editável (os outros scripts saem).
    expect(html).toContain("verificarBtn");
    expect(html).toContain("brasilapi.com.br/api/cep/v1/");
    await page.locator("#cepInput").fill("01001000");
    await page.locator("#verificarBtn").click();
    await page.waitForSelector("#localInfo", { state: "visible", timeout: 10_000 });
    expect(await page.locator("#localInfo").textContent()).toContain("São Paulo/SP");
    await page.close();
  }, 120_000);

  it("tira a meta CSP do site original (senão bloquearia a consulta de CEP na cópia)", async () => {
    const job = await clone(srv.url("popcep-csp"));
    const result = job.result as unknown as CloneResult;
    const out = result.devices.desktop?.outputs.PRESERVE_JS;
    const html = out ? (await getObject(out.htmlKey)).toString("utf8") : "";
    expect(html.toLowerCase()).not.toContain("content-security-policy");
    const { page } = await openPreserveJs(result, "desktop");
    await page.locator("#cep").fill("01001000");
    await page.locator("#ok").click();
    await page.waitForFunction(() => document.getElementById("endereco")?.textContent !== "\u2014", undefined, {
      timeout: 10_000,
    });
    expect(await page.locator("#endereco").textContent()).toContain("São Paulo");
    await page.close();
  }, 120_000);
});
