/**
 * Substituir / trocar links em todas as páginas da oferta (serviço + banco).
 */
import { gunzipSync } from "node:zlib";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { packProject, unpackProject } from "@/lib/project-data";
import { getObject } from "@/lib/storage";
import { bulkLinkChange, bulkReplace } from "@/server/services/bulk-replace";
import { createOfferLink } from "@/server/services/offer-links";
import { createOffer, trashOffer } from "@/server/services/offers";
import { createPage } from "@/server/services/pages";
import { resetDatabase } from "../setup/per-file";
import { expectUserError } from "./helpers";

beforeEach(async () => {
  await resetDatabase();
});

const TARGETS = { text: true, attributes: true };

function projectWith(components: unknown[]) {
  return {
    assets: [],
    styles: [],
    pages: [{ id: "p", frames: [{ id: "f", component: { type: "wrapper", components } }] }],
    symbols: [],
    dataSources: [],
  };
}

function htmlWith(body: string) {
  return `<!DOCTYPE html>\n<html lang="pt-BR"><head><meta charset="utf-8"><title>Compre já</title></head><body>${body}</body></html>`;
}

/** Oferta com: página principal (projeto + HTML), obrigado (só HTML) e upsell (sem ocorrências). */
async function setup() {
  const offer = await createOffer({ name: "Funil" });
  const home = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id, isHome: true } });
  const obrigado = await createPage({ offerId: offer.id, name: "Obrigado" });
  const upsell = await createPage({ offerId: offer.id, name: "Upsell" });
  const docOf = async (pageId: string) =>
    prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId } }, select: { id: true } });

  const homeDoc = await docOf(home.id);
  await prisma.pageDocument.update({
    where: { id: homeDoc.id },
    data: {
      revision: 4,
      project: packProject(
        projectWith([
          {
            type: "link",
            attributes: { href: "https://pay.hotmart.com/ABC?off=1" },
            components: [{ type: "textnode", content: "Compre já" }],
          },
          { tagName: "p", type: "text", components: [{ type: "textnode", content: "Última chance: COMPRE" }] },
        ]),
      ),
      html: htmlWith('<a href="https://pay.hotmart.com/ABC?off=1">Compre já</a><p>Última chance: COMPRE</p>'),
    },
  });
  const obrigadoDoc = await docOf(obrigado.id);
  await prisma.pageDocument.update({
    where: { id: obrigadoDoc.id },
    data: {
      html: htmlWith(
        '<h1>Obrigado!</h1><a href="//pay.hotmart.com/ABC?off=1">Compre o upsell</a><script>var compre=1</script>',
      ),
    },
  });
  const upsellDoc = await docOf(upsell.id);
  await prisma.pageDocument.update({ where: { id: upsellDoc.id }, data: { html: htmlWith("<h1>Oferta única</h1>") } });
  return { offer, home, obrigado, upsell, homeDoc, obrigadoDoc, upsellDoc };
}

async function readDoc(id: string) {
  const doc = await prisma.pageDocument.findUniqueOrThrow({ where: { id } });
  return { ...doc, projectJson: doc.project ? unpackProject(doc.project) : null };
}

async function versionsOf(documentId: string) {
  return prisma.pageVersion.findMany({ where: { documentId }, orderBy: { createdAt: "asc" } });
}

async function snapshot(storageKey: string) {
  return JSON.parse(gunzipSync(await getObject(storageKey)).toString("utf8")) as {
    project: unknown;
    html: string | null;
  };
}

describe("bulkReplace", () => {
  it("no modo de contagem só conta, sem gravar nada", async () => {
    const s = await setup();
    const r = await bulkReplace({
      offerId: s.offer.id,
      query: "compre",
      replacement: "Garanta",
      targets: TARGETS,
      dryRun: true,
    });
    expect(r.documents.map((d) => [d.pageName, d.count])).toEqual([
      ["Página principal", 2],
      ["Obrigado", 1],
    ]);
    expect(r.total).toBe(3);
    expect(r.changedDocumentIds).toEqual([]);
    expect((await readDoc(s.homeDoc.id)).revision).toBe(4);
    expect(await prisma.pageVersion.count()).toBe(0);
  });

  it("troca no projeto e no HTML, guarda a versão anterior e sobe a revisão", async () => {
    const s = await setup();
    const before = await readDoc(s.homeDoc.id);
    const r = await bulkReplace({ offerId: s.offer.id, query: "compre", replacement: "Garanta", targets: TARGETS });
    expect(r.total).toBe(3);
    expect(new Set(r.changedDocumentIds)).toEqual(new Set([s.homeDoc.id, s.obrigadoDoc.id]));

    const home = await readDoc(s.homeDoc.id);
    expect(home.revision).toBe(5);
    expect(JSON.stringify(home.projectJson)).toContain('"content":"Garanta já"');
    expect(JSON.stringify(home.projectJson)).toContain('"content":"Última chance: Garanta"');
    expect(home.html).toContain(">Garanta já</a><p>Última chance: Garanta</p>");
    // <head> intacto.
    expect(home.html).toContain("<title>Compre já</title>");

    const obrigado = await readDoc(s.obrigadoDoc.id);
    expect(obrigado.revision).toBe(1);
    expect(obrigado.project).toBeNull();
    expect(obrigado.html).toContain(">Garanta o upsell</a>");
    expect(obrigado.html).toContain("<script>var compre=1</script>");

    // Upsell não mudou: sem versão e sem revisão nova.
    expect((await readDoc(s.upsellDoc.id)).revision).toBe(0);
    expect(await versionsOf(s.upsellDoc.id)).toHaveLength(0);

    const [version] = await versionsOf(s.homeDoc.id);
    expect(version).toMatchObject({ kind: "BULK_REPLACE", label: "Antes de substituir “compre”" });
    const saved = await snapshot(version.storageKey);
    expect(saved.html).toBe(before.html);
    expect(saved.project).toEqual(before.projectJson);
    expect(await versionsOf(s.obrigadoDoc.id)).toHaveLength(1);
  });

  it("deixa de fora a página aberta no editor, mas guarda a versão 'antes' dela", async () => {
    const s = await setup();
    const r = await bulkReplace({
      offerId: s.offer.id,
      query: "compre",
      replacement: "Garanta",
      targets: TARGETS,
      excludeDocumentIds: [s.homeDoc.id],
      snapshotDocumentId: s.homeDoc.id,
    });
    expect(r.changedDocumentIds).toEqual([s.obrigadoDoc.id]);
    const home = await readDoc(s.homeDoc.id);
    expect(home.revision).toBe(4);
    expect(home.html).toContain("Compre já");
    const versions = await versionsOf(s.homeDoc.id);
    expect(versions.map((v) => v.kind)).toEqual(["BULK_REPLACE"]);
  });

  it("respeita acentos e os alvos escolhidos", async () => {
    const s = await setup();
    const strict = await bulkReplace({
      offerId: s.offer.id,
      query: "ultima",
      replacement: "x",
      targets: TARGETS,
      dryRun: true,
    });
    expect(strict.total).toBe(0);
    const loose = await bulkReplace({
      offerId: s.offer.id,
      query: "ultima",
      replacement: "Derradeira",
      accentInsensitive: true,
      targets: TARGETS,
    });
    expect(loose.total).toBe(1);
    expect((await readDoc(s.homeDoc.id)).html).toContain("<p>Derradeira chance: COMPRE</p>");

    const onlyLinks = await bulkReplace({
      offerId: s.offer.id,
      query: "pay.hotmart.com/ABC",
      replacement: "pay.kiwify.com.br/XYZ",
      targets: { text: false, attributes: true },
    });
    expect(onlyLinks.total).toBe(2);
    expect((await readDoc(s.homeDoc.id)).html).toContain('href="https://pay.kiwify.com.br/XYZ?off=1"');
    expect((await readDoc(s.obrigadoDoc.id)).html).toContain('href="//pay.kiwify.com.br/XYZ?off=1"');
  });

  it("mantém as maiúsculas quando pedido", async () => {
    const s = await setup();
    await bulkReplace({
      offerId: s.offer.id,
      query: "compre",
      replacement: "garanta",
      preserveCase: true,
      targets: TARGETS,
    });
    const home = await readDoc(s.homeDoc.id);
    expect(home.html).toContain(">Garanta já</a><p>Última chance: GARANTA</p>");
    expect(JSON.stringify(home.projectJson)).toContain('"content":"Última chance: GARANTA"');
    expect((await readDoc(s.obrigadoDoc.id)).html).toContain(">Garanta o upsell</a>");
  });

  it("valida a busca e a oferta", async () => {
    const s = await setup();
    await expectUserError(
      bulkReplace({ offerId: s.offer.id, query: "  ", replacement: "x", targets: TARGETS }),
      "Digite o que procurar.",
      "query",
    );
    await expectUserError(
      bulkReplace({ offerId: s.offer.id, query: "a", replacement: "x", targets: { text: false, attributes: false } }),
      /Escolha onde procurar/,
    );
    await expectUserError(
      bulkReplace({ offerId: s.offer.id, query: "a", replacement: "x", targets: TARGETS, snapshotDocumentId: "outro" }),
      "Página não encontrada nesta oferta.",
    );
    await trashOffer(s.offer.id);
    await expectUserError(
      bulkReplace({ offerId: s.offer.id, query: "a", replacement: "x", targets: TARGETS }),
      "Oferta não encontrada.",
    );
  });
});

describe("bulkLinkChange", () => {
  it("liga o endereço ao link da oferta em todas as páginas", async () => {
    const s = await setup();
    const link = await createOfferLink(s.offer.id, {
      label: "Checkout principal",
      url: "https://pay.hotmart.com/ABC?off=1",
      kind: "CHECKOUT",
    });
    const r = await bulkLinkChange({
      offerId: s.offer.id,
      match: { kind: "url", url: "https://pay.hotmart.com/ABC?off=1" },
      op: { type: "bind", key: link.key },
    });
    expect(r.documents.map((d) => [d.pageName, d.count])).toEqual([
      ["Página principal", 1],
      ["Obrigado", 1],
    ]);
    const home = await readDoc(s.homeDoc.id);
    expect(home.html).toContain('<a href="https://pay.hotmart.com/ABC?off=1" data-os-link="checkout-principal">');
    expect(JSON.stringify(home.projectJson)).toContain('"data-os-link":"checkout-principal"');
    expect((await readDoc(s.obrigadoDoc.id)).html).toContain('data-os-link="checkout-principal"');
    expect((await versionsOf(s.homeDoc.id))[0]).toMatchObject({ kind: "BULK_REPLACE" });

    // Trocar o link ligado por outro endereço fixo (desligar).
    const unbound = await bulkLinkChange({
      offerId: s.offer.id,
      match: { kind: "link", key: link.key },
      op: { type: "unbind", url: "https://novo.com/x" },
      excludeDocumentIds: [s.obrigadoDoc.id],
    });
    expect(unbound.changedDocumentIds).toEqual([s.homeDoc.id]);
    const after = await readDoc(s.homeDoc.id);
    expect(after.html).toContain('<a href="https://novo.com/x">Compre já</a>');
    expect(JSON.stringify(after.projectJson)).not.toContain("data-os-link");
  });

  it("não liga a um link que não existe", async () => {
    const s = await setup();
    await expectUserError(
      bulkLinkChange({
        offerId: s.offer.id,
        match: { kind: "url", url: "https://x.com" },
        op: { type: "bind", key: "nada" },
      }),
      "Link da oferta não encontrado. Ele pode ter sido excluído.",
    );
  });

  it("troca o endereço de um grupo sem mexer em endereços parecidos", async () => {
    const s = await setup();
    const r = await bulkLinkChange({
      offerId: s.offer.id,
      match: { kind: "url", url: "https://PAY.hotmart.com/ABC?off=1" },
      op: { type: "set-url", url: "https://pay.kiwify.com.br/novo" },
    });
    expect(r.total).toBe(2);
    expect((await readDoc(s.homeDoc.id)).html).toContain('<a href="https://pay.kiwify.com.br/novo">Compre já</a>');
    expect((await readDoc(s.obrigadoDoc.id)).html).toContain(
      '<a href="https://pay.kiwify.com.br/novo">Compre o upsell</a>',
    );
    const project = JSON.stringify((await readDoc(s.homeDoc.id)).projectJson);
    expect(project).toContain('"href":"https://pay.kiwify.com.br/novo"');
  });
});
