/**
 * Links da oferta: checkout principal, upsell, downsell, WhatsApp… Os botões das
 * páginas ficam ligados pela chave; trocar a URL aqui vale para todas as páginas.
 */
import { gunzipSync } from "node:zlib";
import type { OfferLinkKind } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { LINK_ATTR, linkKey } from "@/lib/offer-links";
import { bulkLinkChange } from "@/server/services/bulk-replace";
import { relabelLatestVersions } from "@/server/services/documents";

export const OFFER_LINK_KINDS = [
  "CHECKOUT",
  "UPSELL",
  "DOWNSELL",
  "WHATSAPP",
  "OTHER",
] as const satisfies readonly OfferLinkKind[];

async function offerOrThrow(offerId: string) {
  const offer = await prisma.offer.findFirst({ where: { id: offerId, deletedAt: null }, select: { id: true } });
  if (!offer) throw new UserError("Oferta não encontrada.");
}

async function touch(offerId: string) {
  await prisma.offer.update({ where: { id: offerId }, data: { updatedAt: new Date() } });
}

export function listOfferLinks(offerId: string) {
  return prisma.offerLink.findMany({
    where: { offerId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, key: true, label: true, url: true, kind: true },
  });
}

/** Quantos elementos das páginas usam cada link (para avisar antes de excluir). */
export async function linkUsage(offerId: string) {
  const docs = await prisma.pageDocument.findMany({
    where: { variant: { page: { offerId } } },
    select: { html: true },
  });
  const usage = new Map<string, number>();
  const re = new RegExp(`${LINK_ATTR}="([a-z0-9-]+)"`, "g");
  for (const doc of docs) {
    for (const m of (doc.html ?? "").matchAll(re)) usage.set(m[1], (usage.get(m[1]) ?? 0) + 1);
  }
  return usage;
}

export interface LinkInput {
  label: string;
  url: string;
  kind: OfferLinkKind;
}

export async function createOfferLink(offerId: string, input: LinkInput) {
  await offerOrThrow(offerId);
  const existing = await prisma.offerLink.findMany({ where: { offerId }, select: { key: true, position: true } });
  const key = linkKey(
    input.label,
    existing.map((l) => l.key),
  );
  const link = await prisma.offerLink.create({
    data: {
      offerId,
      key,
      label: input.label,
      url: input.url,
      kind: input.kind,
      position: Math.max(-1, ...existing.map((l) => l.position)) + 1,
    },
    select: { id: true, key: true, label: true, url: true, kind: true },
  });
  await touch(offerId);
  return link;
}

export async function updateOfferLink(id: string, input: Partial<LinkInput>) {
  const link = await prisma.offerLink.findFirst({
    where: { id, offer: { deletedAt: null } },
    select: { offerId: true },
  });
  if (!link) throw new UserError("Link não encontrado.");
  await prisma.offerLink.update({ where: { id }, data: input });
  await touch(link.offerId);
}

function shortLabel(label: string) {
  return label.length > 60 ? `${label.slice(0, 59)}…` : label;
}

/**
 * Exclui um link da oferta. Os botões ligados a ele guardam só a chave (a URL
 * entra na hora de montar a página), então antes de excluir a URL atual é
 * gravada em cada um deles, em todas as páginas (HTML e projeto do editor, com
 * versão "antes" e revisão nova): eles continuam levando para o mesmo lugar.
 * Link sem URL: os botões só deixam de estar ligados e voltam ao endereço que
 * tinham antes de serem ligados.
 */
export async function deleteOfferLink(id: string) {
  const link = await prisma.offerLink.findFirst({
    where: { id, offer: { deletedAt: null } },
    select: { offerId: true, key: true, label: true, url: true },
  });
  if (!link) throw new UserError("Link não encontrado.");
  // Atalho: nenhuma página cita a chave (nada a gravar, nem a conferir).
  if (await mentionsKey(link.offerId, link.key)) {
    const input = {
      offerId: link.offerId,
      match: { kind: "link", key: link.key },
      op: { type: "unbind", url: link.url.trim() || undefined },
    } as const;
    const result = await bulkLinkChange(input);
    await relabelLatestVersions(
      result.changedDocumentIds,
      "BULK_REPLACE",
      `Antes de excluir o link “${shortLabel(link.label)}”`,
    );
    // Alguma página foi salva no meio de novo e de novo: não exclui com botões ainda ligados.
    if ((await bulkLinkChange({ ...input, dryRun: true })).total) {
      throw new UserError("Uma página desta oferta foi salva durante a exclusão. Tente excluir o link de novo.");
    }
  }
  await prisma.offerLink.delete({ where: { id } });
  await touch(link.offerId);
}

/** Algum documento da oferta (HTML ou projeto do editor) cita esta chave de link? */
async function mentionsKey(offerId: string, key: string) {
  const docs = await prisma.pageDocument.findMany({
    where: { variant: { page: { offerId } } },
    select: { html: true, project: true },
  });
  // HTML (data-os-link="k", com ou sem aspas), atributo no JSON ("data-os-link":"k")
  // e HTML guardado como texto dentro do JSON (data-os-link=\"k\").
  const bound = new RegExp(`${LINK_ATTR}(?:"\\s*:\\s*"|\\s*=\\s*\\\\?["']?)${key}(?=\\\\?["'\\s>/]|$)`);
  return docs.some((d) => bound.test(d.html ?? "") || (d.project !== null && bound.test(projectJson(d.project))));
}

function projectJson(project: Uint8Array) {
  try {
    return gunzipSync(project).toString("utf8");
  } catch {
    return "";
  }
}
