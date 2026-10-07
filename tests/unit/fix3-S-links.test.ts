/**
 * Fase 3 — correções do grupo S nos links entre páginas e links da oferta:
 * - #10: excluir um link da oferta grava a URL atual nos botões ligados (antes
 *   eles voltavam ao endereço de antes de ligar — o checkout do concorrente);
 * - #22: excluir uma página tira das outras páginas os links para ela (HTML e
 *   projeto do editor, com versão "antes"), e a tela pode avisar quantas páginas
 *   apontam para ela (pageReferencesAction).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { deleteDescription, usageLabel } from "@/components/offers/offer-links";
import { prisma } from "@/lib/db";
import { internalLink, referencedPageIds } from "@/lib/internal-links";
import { renderPageHtml } from "@/lib/page-render";
import { packProject, unpackProject } from "@/lib/project-data";
import { deleteOfferLinkAction } from "@/server/actions/offer-links";
import { deletePageAction, pageReferencesAction } from "@/server/actions/pages";
import { getEditorPayload, removeVersionFiles, saveEditorDocument } from "@/server/services/documents";
import { createOfferLink, deleteOfferLink, linkUsage, updateOfferLink } from "@/server/services/offer-links";
import { createOffer, trashOffer } from "@/server/services/offers";
import { createPage, deletePage, pageReferences } from "@/server/services/pages";
import { resetDatabase } from "../setup/per-file";
import { expectUserError } from "./helpers";

const docsToClean = new Set<string>();

beforeEach(async () => {
  await resetDatabase();
});

// Arquivos de versão criados pelas operações (não ficam em data/test).
afterAll(async () => {
  await removeVersionFiles(docsToClean);
});

type Comp = { type?: string; tagName?: string; attributes?: Record<string, string>; components?: Comp[] };

function projectWith(components: Comp[]) {
  return { pages: [{ frames: [{ component: { type: "wrapper", components } }] }] };
}

function projectComponents(bytes: Uint8Array | null) {
  const p = unpackProject<{ pages: { frames: { component: { components: Comp[] } }[] }[] }>(bytes as Uint8Array);
  return p.pages[0].frames[0].component.components;
}

async function mainDoc(pageId: string) {
  const doc = await prisma.pageDocument.findFirstOrThrow({ where: { variant: { pageId } } });
  docsToClean.add(doc.id);
  return doc;
}

async function setDoc(pageId: string, html: string, project?: unknown) {
  const doc = await mainDoc(pageId);
  await prisma.pageDocument.update({
    where: { id: doc.id },
    data: { html, project: project === undefined ? null : packProject(project), revision: 3 },
  });
  return doc.id;
}

function page(body: string) {
  return `<!DOCTYPE html><html><head><title>t</title></head><body>${body}</body></html>`;
}

/** HTML que o visitante recebe (prévia/ZIP), com os links atuais da oferta. */
async function rendered(pageId: string, offerId: string) {
  const doc = await mainDoc(pageId);
  const links = await prisma.offerLink.findMany({ where: { offerId }, select: { key: true, url: true } });
  return renderPageHtml(doc.html ?? "", { links, pageHref: (id) => `/p/${id}`, runtimeTag: "" });
}

// ─── #10 ─────────────────────────────────────────────────────────────────────

describe("excluir link da oferta (#10)", () => {
  async function boundOffer(url: string) {
    const offer = await createOffer({ name: "Clone" });
    const home = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id } });
    const upsell = await createPage({ offerId: offer.id, name: "Upsell" });
    const link = await createOfferLink(offer.id, { label: "Checkout principal", url, kind: "CHECKOUT" });
    // Clone: o botão continua com o checkout de origem e só ganha a chave.
    const homeDoc = await setDoc(
      home.id,
      page(
        `<a id="c1" href="https://pay.hotmart.com/CONCORRENTE" data-os-link="${link.key}">Comprar</a>` +
          `<form id="f1" action="https://pay.hotmart.com/CONCORRENTE" data-os-link="${link.key}"></form>` +
          `<div id="d1" data-os-href="https://pay.hotmart.com/CONCORRENTE" data-os-link="${link.key}">Quero</div>` +
          `<a id="outro" href="https://pay.hotmart.com/OUTRO">Outro</a>`,
      ),
      projectWith([
        {
          type: "link",
          tagName: "a",
          attributes: { id: "c1", href: "https://pay.hotmart.com/CONCORRENTE", "data-os-link": link.key },
        },
      ]),
    );
    const upsellDoc = await setDoc(upsell.id, page(`<a id="c2" href="#" data-os-link="${link.key}">Sim</a>`));
    return { offerId: offer.id, homeId: home.id, upsellId: upsell.id, link, homeDoc, upsellDoc };
  }

  it("os botões ligados continuam levando para a URL atual do link (HTML e projeto do editor)", async () => {
    const o = await boundOffer("https://pay.hotmart.com/INICIAL");
    await updateOfferLink(o.link.id, { url: "https://pay.kiwify.com.br/MEU" });
    expect(await rendered(o.homeId, o.offerId)).toContain('href="https://pay.kiwify.com.br/MEU"');

    await deleteOfferLink(o.link.id);

    expect(await prisma.offerLink.count({ where: { offerId: o.offerId } })).toBe(0);
    const home = await rendered(o.homeId, o.offerId);
    expect(home).not.toContain("CONCORRENTE");
    expect(home).not.toContain("data-os-link");
    expect(home).toMatch(/<a id="c1" href="https:\/\/pay\.kiwify\.com\.br\/MEU">/);
    expect(home).toMatch(/<form id="f1" action="https:\/\/pay\.kiwify\.com\.br\/MEU">/);
    expect(home).toMatch(/<div id="d1" data-os-href="https:\/\/pay\.kiwify\.com\.br\/MEU">/);
    // Botão que não estava ligado fica como estava.
    expect(home).toContain('<a id="outro" href="https://pay.hotmart.com/OUTRO">');
    expect(await rendered(o.upsellId, o.offerId)).toContain('<a id="c2" href="https://pay.kiwify.com.br/MEU">');

    // Projeto do editor: mesma troca (a página abre no editor já com o endereço).
    const doc = await prisma.pageDocument.findUniqueOrThrow({ where: { id: o.homeDoc } });
    expect(projectComponents(doc.project)[0].attributes).toEqual({ id: "c1", href: "https://pay.kiwify.com.br/MEU" });
    // Revisão nova (aba aberta avisa do conflito) e versão "antes", com nome claro.
    expect(doc.revision).toBe(4);
    const versions = await prisma.pageVersion.findMany({ where: { documentId: { in: [o.homeDoc, o.upsellDoc] } } });
    expect(versions.map((v) => [v.kind, v.label])).toEqual([
      ["BULK_REPLACE", "Antes de excluir o link “Checkout principal”"],
      ["BULK_REPLACE", "Antes de excluir o link “Checkout principal”"],
    ]);
    expect((await linkUsage(o.offerId)).size).toBe(0);
  });

  it("link sem URL: os botões só deixam de estar ligados (voltam ao endereço que tinham)", async () => {
    const o = await boundOffer("");
    await deleteOfferLink(o.link.id);
    const home = await rendered(o.homeId, o.offerId);
    expect(home).not.toContain("data-os-link");
    expect(home).toContain('<a id="c1" href="https://pay.hotmart.com/CONCORRENTE">');
    expect(await rendered(o.upsellId, o.offerId)).toContain('<a id="c2" href="#">');
  });

  it("pela action (tela Links da oferta) e em oferta na lixeira", async () => {
    const o = await boundOffer("https://pay.kiwify.com.br/MEU");
    const res = await deleteOfferLinkAction({ id: o.link.id });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(await rendered(o.upsellId, o.offerId)).toContain('href="https://pay.kiwify.com.br/MEU"');

    const other = await boundOffer("https://pay.kiwify.com.br/X");
    await trashOffer(other.offerId);
    await expectUserError(deleteOfferLink(other.link.id), "Link não encontrado.");
    expect(await linkUsage(other.offerId)).toEqual(new Map([[other.link.key, 4]]));
  });

  it("link sem nenhum botão ligado: nada nas páginas muda (sem versão, mesma revisão)", async () => {
    const o = await boundOffer("https://pay.kiwify.com.br/MEU");
    // Chave parecida (checkout-principal-2) não conta como ligada a checkout-principal.
    const twin = await createOfferLink(o.offerId, {
      label: "Checkout principal",
      url: "https://x.com/2",
      kind: "CHECKOUT",
    });
    expect(twin.key).toBe(`${o.link.key}-2`);
    await deleteOfferLink(twin.id);
    expect(await prisma.pageVersion.count()).toBe(0);
    const docs = await prisma.pageDocument.findMany({ where: { id: { in: [o.homeDoc, o.upsellDoc] } } });
    expect(docs.map((d) => d.revision)).toEqual([3, 3]);
    expect(await linkUsage(o.offerId)).toEqual(new Map([[o.link.key, 4]]));
  });

  it("texto da confirmação diz o que acontece com os botões", () => {
    expect(deleteDescription({ usage: 0, url: "https://x.com" })).toBe("Nenhum botão usa este link.");
    expect(deleteDescription({ usage: 1, url: "https://pay.kiwify.com.br/MEU" })).toBe(
      "1 botão continua levando para https://pay.kiwify.com.br/MEU, mas deixa de acompanhar as mudanças deste link.",
    );
    expect(deleteDescription({ usage: 3, url: "https://pay.kiwify.com.br/MEU" })).toBe(
      "3 botões continuam levando para https://pay.kiwify.com.br/MEU, mas deixam de acompanhar as mudanças deste link.",
    );
    expect(deleteDescription({ usage: 2, url: "" })).toBe(
      "Este link está sem URL: 2 botões ligados a ele voltam para o endereço que tinham antes de serem ligados.",
    );
    expect(deleteDescription({ usage: 1, url: "" })).toBe(
      "Este link está sem URL: 1 botão ligado a ele volta para o endereço que tinha antes de ser ligado.",
    );
  });

  it("link usado como prêmio da roleta: a aba diz “Prêmio da roleta” e a exclusão diz que a fatia fica sem desconto", () => {
    expect(usageLabel({ usage: 0, prizes: 1 })).toBe("Prêmio da roleta");
    expect(usageLabel({ usage: 0, prizes: 2 })).toBe("Prêmio de 2 fatias da roleta");
    expect(usageLabel({ usage: 2, prizes: 1 })).toBe("2 botões · prêmio da roleta");
    expect(usageLabel({ usage: 1 })).toBe("1 botão ligado");
    expect(usageLabel({ usage: 0, prizes: 0 })).toBe("Nenhum botão ligado");
    // Sem URL (o funil em 1 clique cria assim): nada de "botão" que não existe.
    expect(deleteDescription({ usage: 0, prizes: 1, url: "" })).toBe(
      "É o prêmio de 1 fatia da roleta: ela continua na roda, mas quem ganhar não vai para nenhum checkout com desconto até você ligar outro link a ela no editor.",
    );
    // Com URL: a fatia não "continua levando" para o endereço.
    expect(deleteDescription({ usage: 1, prizes: 2, url: "https://pay.kiwify.com.br/abc" })).toBe(
      "1 botão continua levando para https://pay.kiwify.com.br/abc, mas deixa de acompanhar as mudanças deste link. É o prêmio de 2 fatias da roleta: elas continuam na roda, mas quem ganhar não vai para nenhum checkout com desconto até você ligar outro link a elas no editor.",
    );
  });
});

// ─── #22 ─────────────────────────────────────────────────────────────────────

describe("excluir página com links de outras páginas para ela (#22)", () => {
  async function funnel() {
    const offer = await createOffer({ name: "Funil" });
    const home = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id } });
    const upsell = await createPage({ offerId: offer.id, name: "Upsell 1" });
    const thanks = await createPage({ offerId: offer.id, name: "Obrigado" });
    const lone = await createPage({ offerId: offer.id, name: "Sem links" });
    const to = internalLink(upsell.id);
    const homeDoc = await setDoc(
      home.id,
      page(
        `<a id="cta" href="${to}">Quero o upsell</a>` +
          // Clone do funil: o link vira os-page nos dois atributos.
          `<a id="dup" href="${to}" data-os-href="${to}">Sim</a>` +
          `<button id="btn" data-os-href="${to}">Botão</button>` +
          `<form id="lf" data-os-widget="lead-form" action="${to}"></form>` +
          // Ligado a um link da oferta, com a página como endereço de reserva.
          `<a id="bound" href="${to}" data-os-link="checkout">Comprar</a>` +
          `<a id="thx" href="${internalLink(thanks.id)}">Obrigado</a>`,
      ),
      projectWith([
        { type: "link", tagName: "a", attributes: { id: "cta", href: to } },
        { type: "link", tagName: "a", attributes: { id: "thx", href: internalLink(thanks.id) } },
      ]),
    );
    // A própria página excluída pode apontar para si mesma: não conta.
    await setDoc(upsell.id, page(`<a href="${to}">topo</a>`));
    // Obrigado só tem o link no projeto do editor (HTML ainda não regravado).
    const thanksDoc = await setDoc(
      thanks.id,
      page("<p>Obrigado</p>"),
      projectWith([{ type: "link", tagName: "a", attributes: { id: "back", href: to } }]),
    );
    await setDoc(lone.id, page("<p>Nada</p>"));
    return { offerId: offer.id, home, upsell, thanks, lone, homeDoc, thanksDoc };
  }

  it("pageReferences / pageReferencesAction: outras páginas que levam a esta (HTML ou projeto)", async () => {
    const f = await funnel();
    expect(await pageReferences(f.upsell.id)).toEqual({
      count: 2,
      pages: [
        { id: f.home.id, name: "Página principal" },
        { id: f.thanks.id, name: "Obrigado" },
      ],
    });
    expect(await pageReferences(f.lone.id)).toEqual({ count: 0, pages: [] });
    const res = await pageReferencesAction({ pageId: f.thanks.id });
    expect(res).toEqual({ ok: true, data: { count: 1, pages: [{ id: f.home.id, name: "Página principal" }] } });
    const missing = await pageReferencesAction({ pageId: "nao-existe" });
    expect(missing).toEqual({ ok: false, error: "Página não encontrada." });
  });

  it("ao excluir, os links para ela viram '#' no HTML e no projeto, com versão 'antes' e revisão nova", async () => {
    const f = await funnel();
    await deletePage(f.upsell.id);

    const home = await prisma.pageDocument.findUniqueOrThrow({ where: { id: f.homeDoc } });
    expect(referencedPageIds(home.html ?? "")).toEqual(new Set([f.thanks.id]));
    expect(home.html).toContain('<a id="cta" href="#">');
    expect(home.html).toContain('<a id="dup" href="#" data-os-href="#">');
    expect(home.html).toContain('<button id="btn" data-os-href="#">');
    expect(home.html).toContain('<form id="lf" data-os-widget="lead-form" action="#">');
    expect(home.html).toContain('<a id="bound" href="#" data-os-link="checkout">');
    expect(home.html).toContain(`<a id="thx" href="${internalLink(f.thanks.id)}">`);
    expect(projectComponents(home.project).map((c) => c.attributes?.href)).toEqual(["#", internalLink(f.thanks.id)]);
    expect(home.revision).toBe(4);

    const thanks = await prisma.pageDocument.findUniqueOrThrow({ where: { id: f.thanksDoc } });
    expect(projectComponents(thanks.project)[0].attributes?.href).toBe("#");
    expect(thanks.revision).toBe(4);

    const versions = await prisma.pageVersion.findMany({ where: { documentId: { in: [f.homeDoc, f.thanksDoc] } } });
    expect(versions.map((v) => [v.kind, v.label])).toEqual([
      ["BULK_REPLACE", "Antes de excluir a página “Upsell 1”"],
      ["BULK_REPLACE", "Antes de excluir a página “Upsell 1”"],
    ]);
    // Página sem links para ela não é tocada.
    const lone = await mainDoc(f.lone.id);
    expect(lone.revision).toBe(3);

    // Na prévia, nenhum link leva mais para a página excluída (antes: 404).
    const html = await rendered(f.home.id, f.offerId);
    expect(html).not.toContain(`/p/${f.upsell.id}`);
  });

  it("com redirectToPageId, os links passam a levar para a página escolhida", async () => {
    const f = await funnel();
    const res = await deletePageAction({ id: f.upsell.id, redirectToPageId: f.lone.id });
    expect(res).toEqual({ ok: true, data: undefined });
    const home = await prisma.pageDocument.findUniqueOrThrow({ where: { id: f.homeDoc } });
    expect(referencedPageIds(home.html ?? "")).toEqual(new Set([f.lone.id, f.thanks.id]));
    expect(home.html).toContain(`<a id="cta" href="${internalLink(f.lone.id)}">`);
    expect(projectComponents(home.project)[0].attributes?.href).toBe(internalLink(f.lone.id));
  });

  it("redirectToPageId inválido (a própria página ou de outra oferta): nada muda", async () => {
    const f = await funnel();
    const other = await createOffer({ name: "Outra" });
    const foreign = await prisma.page.findFirstOrThrow({ where: { offerId: other.id } });
    for (const target of [f.upsell.id, foreign.id]) {
      await expectUserError(
        deletePage(f.upsell.id, { redirectToPageId: target }),
        "A página escolhida para os links não existe mais nesta oferta.",
      );
    }
    expect(await prisma.page.count({ where: { id: f.upsell.id } })).toBe(1);
    expect((await prisma.pageDocument.findUniqueOrThrow({ where: { id: f.homeDoc } })).revision).toBe(3);
  });

  it("uma aba aberta com a página que tinha o link recebe conflito ao salvar (não desfaz a limpeza)", async () => {
    const f = await funnel();
    const payload = await getEditorPayload(f.homeDoc);
    await deletePage(f.upsell.id);
    await expect(
      saveEditorDocument({
        documentId: f.homeDoc,
        revision: payload.revision,
        project: projectWith([]),
        html: page(`<a href="${internalLink(f.upsell.id)}">x</a>`),
        css: "",
      }),
    ).rejects.toMatchObject({ current: 4 });
  });

  it("sem nenhuma referência, excluir não mexe nas outras páginas", async () => {
    const f = await funnel();
    await deletePage(f.lone.id);
    const docs = await prisma.pageDocument.findMany({ where: { variant: { page: { offerId: f.offerId } } } });
    expect(docs.every((d) => d.revision === 3)).toBe(true);
    expect(await prisma.pageVersion.count()).toBe(0);
  });
});
