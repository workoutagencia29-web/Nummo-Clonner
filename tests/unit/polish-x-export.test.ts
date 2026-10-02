/**
 * Fase 6 (polimento) — "Baixar ZIP": páginas que iriam ao ar com {{EMPRESA}},
 * {{CNPJ}}… no lugar dos dados da empresa ganham um aviso (na prévia do ZIP e
 * no ZIP pronto), e a tela reconhece os avisos que sabe resolver ali mesmo.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { companyMarkersWarning, exportWarningFix, OG_IMAGE_WARNING } from "@/lib/export/warnings";
import { exportPlan } from "@/server/services/export";
import { buildExport } from "@/server/services/export/build";
import { saveOfferSettings } from "@/server/services/offer-settings";
import { createOffer } from "@/server/services/offers";
import { createPage } from "@/server/services/pages";
import { resetDatabase } from "../setup/per-file";
import { readZip, removeExportFiles } from "./export-fixture";

let tmp: string | null = null;

beforeEach(async () => {
  await removeExportFiles();
  await resetDatabase();
});

afterAll(async () => {
  await removeExportFiles();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

async function build(offerId: string) {
  tmp ??= await mkdtemp(path.join(os.tmpdir(), "os-export-px-"));
  const target = path.join(tmp, `${offerId}-${Date.now()}.zip`);
  const result = await buildExport({
    offerId,
    options: { splitter: true, serverEvents: false, optimizeHtml: true },
    target,
  });
  const zip = await readZip(target);
  return { ...result, text: (name: string) => zip.get(name)?.data.toString("utf8") ?? "" };
}

describe("textos dos avisos", () => {
  it("uma página, várias páginas e o limite de nomes", () => {
    expect(companyMarkersWarning([])).toBeNull();
    expect(companyMarkersWarning([{ name: "Termos", markers: [] }])).toBeNull();
    expect(companyMarkersWarning([{ name: "Política", markers: ["{{CNPJ}}", "{{EMPRESA}}"] }])).toBe(
      "A página “Política” ainda mostra {{EMPRESA}} e {{CNPJ}} no lugar dos dados da empresa: preencha os dados da empresa e gere o ZIP de novo.",
    );
    const many = companyMarkersWarning(["A", "B", "C", "D", "E"].map((name) => ({ name, markers: ["{{EMAIL}}"] })));
    expect(many).toBe(
      "As páginas “A”, “B”, “C” e mais 2 ainda mostram {{EMAIL}} no lugar dos dados da empresa: preencha os dados da empresa e gere o ZIP de novo.",
    );
  });

  it("a tela sabe o que oferecer para cada aviso", () => {
    expect(exportWarningFix(OG_IMAGE_WARNING)).toEqual({ kind: "liveUrl" });
    const w = companyMarkersWarning([{ name: "Termos", markers: ["{{EMAIL}}", "{{EMPRESA}}", "{{CNPJ}}"] }]);
    expect(exportWarningFix(w as string)).toEqual({ kind: "company", fields: ["name", "document", "email"] });
    expect(exportWarningFix("Outro aviso qualquer.")).toBeNull();
  });
});

describe("dados da empresa vazios no ZIP", () => {
  async function legalOffer() {
    const offer = await createOffer({ name: "Oferta Legal" });
    await createPage({
      offerId: offer.id,
      name: "Política de privacidade",
      type: "LEGAL",
      templateId: "politica-privacidade",
    });
    return offer;
  }

  it("sem os dados: aviso na prévia e no ZIP pronto, com os marcadores que ficaram", async () => {
    const offer = await legalOffer();
    const expected =
      "A página “Política de privacidade” ainda mostra {{EMPRESA}}, {{CNPJ}} e {{EMAIL}} no lugar dos dados da empresa: preencha os dados da empresa e gere o ZIP de novo.";
    expect((await exportPlan(offer.id)).warnings).toContain(expected);
    const { warnings, text } = await build(offer.id);
    expect(text("politica-de-privacidade/index.html")).toContain("{{EMPRESA}}");
    expect(warnings).toContain(expected);
  });

  it("só o e-mail vazio: o aviso fala só do e-mail; tudo preenchido: nenhum aviso", async () => {
    const offer = await legalOffer();
    await saveOfferSettings(offer.id, { company: { name: "Empresa X", document: "12.345.678/0001-90" } });
    const onlyEmail = (await exportPlan(offer.id)).warnings.filter((w) => w.includes("dados da empresa"));
    expect(onlyEmail).toHaveLength(1);
    expect(onlyEmail[0]).toContain("ainda mostra {{EMAIL}} no lugar");
    expect((await build(offer.id)).warnings.filter((w) => w.includes("dados da empresa"))).toEqual(onlyEmail);

    await saveOfferSettings(offer.id, { company: { email: "contato@empresa.com.br" } });
    expect((await exportPlan(offer.id)).warnings.some((w) => w.includes("dados da empresa"))).toBe(false);
    const done = await build(offer.id);
    expect(done.warnings.some((w) => w.includes("dados da empresa"))).toBe(false);
    expect(done.text("politica-de-privacidade/index.html")).not.toMatch(/\{\{[A-Z]+\}\}/);
  });

  it("oferta sem página com marcadores: nenhum aviso", async () => {
    const offer = await createOffer({ name: "Sem legal" });
    await prisma.pageDocument.updateMany({
      where: { variant: { page: { offerId: offer.id } } },
      data: { html: "<!doctype html><html><head><title>x</title></head><body><h1>Oi</h1></body></html>" },
    });
    expect((await exportPlan(offer.id)).warnings.some((w) => w.includes("dados da empresa"))).toBe(false);
  });
});
