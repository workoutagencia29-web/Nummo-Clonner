/**
 * Links da oferta: checkout principal, upsell, downsell, WhatsApp… Os botões das
 * páginas ficam ligados pela chave; trocar a URL aqui vale para todas as páginas.
 */
import { gunzipSync } from "node:zlib";
import type { OfferLinkKind, OfferLinkTarget } from "@/generated/prisma/client";
import { type Db, prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { LINK_ATTR, linkKey } from "@/lib/offer-links";
import { wheelPrizeKeys } from "@/lib/wheel-prizes";
import { bulkLinkChange } from "@/server/services/bulk-replace";
import { relabelLatestVersions } from "@/server/services/documents";
import {
  NOT_PAYMENT_KIND_MESSAGE,
  PAYMENT_LINK_KINDS,
  PAYMENT_PRODUCT_SELECT,
  type PaymentProductView,
  paymentProductView,
} from "@/server/services/payments/products";

export const OFFER_LINK_KINDS = [
  "CHECKOUT",
  "UPSELL",
  "DOWNSELL",
  "WHATSAPP",
  "OTHER",
] as const satisfies readonly OfferLinkKind[];

async function offerOrThrow(offerId: string, db: Db = prisma) {
  const offer = await db.offer.findFirst({ where: { id: offerId, deletedAt: null }, select: { id: true } });
  if (!offer) throw new UserError("Oferta não encontrada.");
}

async function touch(offerId: string, db: Db = prisma) {
  await db.offer.update({ where: { id: offerId }, data: { updatedAt: new Date() } });
}

export interface OfferLinkView {
  id: string;
  key: string;
  label: string;
  url: string;
  kind: OfferLinkKind;
  /** URL = leva ao endereço; PAYMENT = "Pagamento na página". */
  target: OfferLinkTarget;
  /** Pagamento na página com o produto salvo (o botão abre a janela de pagamento). */
  pay: boolean;
  /** Produto de pagamento salvo (fica guardado mesmo voltando para endereço). */
  payment: PaymentProductView | null;
}

export async function listOfferLinks(offerId: string): Promise<OfferLinkView[]> {
  const rows = await prisma.offerLink.findMany({
    where: { offerId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      key: true,
      label: true,
      url: true,
      kind: true,
      target: true,
      payment: { select: PAYMENT_PRODUCT_SELECT },
    },
  });
  return rows.map((r) => {
    const payment = r.payment ? paymentProductView(r.payment) : null;
    return { ...r, payment, pay: r.target === "PAYMENT" && payment !== null };
  });
}

function isPaymentKind(kind: string) {
  return (PAYMENT_LINK_KINDS as readonly string[]).includes(kind);
}

/**
 * Quem usa cada link nas páginas (para mostrar na aba e avisar antes de
 * excluir): botões (data-os-link) e prêmios das fatias da roleta de desconto,
 * contados à parte — excluir o link não muda a fatia, ela fica sem prêmio.
 */
export async function linkUsageDetail(offerId: string) {
  const docs = await prisma.pageDocument.findMany({
    where: { variant: { page: { offerId } } },
    select: { html: true },
  });
  const buttons = new Map<string, number>();
  const prizes = new Map<string, number>();
  const re = new RegExp(`${LINK_ATTR}="([a-z0-9-]+)"`, "g");
  for (const doc of docs) {
    for (const m of (doc.html ?? "").matchAll(re)) buttons.set(m[1], (buttons.get(m[1]) ?? 0) + 1);
    for (const key of wheelPrizeKeys(doc.html)) prizes.set(key, (prizes.get(key) ?? 0) + 1);
  }
  return { buttons, prizes };
}

/** Quantos botões das páginas usam cada link. */
export async function linkUsage(offerId: string) {
  return (await linkUsageDetail(offerId)).buttons;
}

export interface LinkInput {
  label: string;
  url: string;
  kind: OfferLinkKind;
  /** Padrão: URL (endereço). PAYMENT: o produto é preenchido depois (savePaymentProduct). */
  target?: OfferLinkTarget;
}

export async function createOfferLink(offerId: string, input: LinkInput, db: Db = prisma) {
  await offerOrThrow(offerId, db);
  if (input.target === "PAYMENT" && !isPaymentKind(input.kind)) throw new UserError(NOT_PAYMENT_KIND_MESSAGE, "kind");
  const existing = await db.offerLink.findMany({ where: { offerId }, select: { key: true, position: true } });
  const key = linkKey(
    input.label,
    existing.map((l) => l.key),
  );
  const link = await db.offerLink.create({
    data: {
      offerId,
      key,
      label: input.label,
      url: input.url,
      kind: input.kind,
      target: input.target ?? "URL",
      position: Math.max(-1, ...existing.map((l) => l.position)) + 1,
    },
    select: { id: true, key: true, label: true, url: true, kind: true, target: true },
  });
  await touch(offerId, db);
  return link;
}

export async function updateOfferLink(id: string, input: Partial<Omit<LinkInput, "target">>) {
  const link = await prisma.offerLink.findFirst({
    where: { id, offer: { deletedAt: null } },
    select: { offerId: true, target: true },
  });
  if (!link) throw new UserError("Link não encontrado.");
  if (input.kind && link.target === "PAYMENT" && !isPaymentKind(input.kind)) {
    throw new UserError(
      "Um link de pagamento na página só pode ser do tipo checkout, upsell ou downsell. Para usar outro tipo, mude o destino para “Endereço” antes.",
      "kind",
    );
  }
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
    select: { offerId: true, key: true, label: true, url: true, target: true },
  });
  if (!link) throw new UserError("Link não encontrado.");
  // Atalho: nenhuma página cita a chave (nada a gravar, nem a conferir).
  if (await mentionsKey(link.offerId, link.key)) {
    // Pagamento na página: o endereço guardado não é para onde os botões levam hoje;
    // eles voltam ao endereço que tinham antes de serem ligados.
    const url = link.target === "PAYMENT" ? "" : link.url.trim();
    const input = {
      offerId: link.offerId,
      match: { kind: "link", key: link.key },
      op: { type: "unbind", url: url || undefined },
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
