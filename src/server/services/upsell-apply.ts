/**
 * "Usar este upsell em outras ofertas" (aba Upsell): monta o upsell UMA vez numa
 * oferta e aplica nas ofertas que o usuário escolher. Cada aplicação COPIA para a
 * oferta de destino as páginas das etapas (upsell/downsell) e a de obrigado, os
 * produtos (links de pagamento/checkout) e liga tudo — o "produto principal" de
 * cada oferta de destino é o dela mesma (o primeiro produto de compra que não é
 * uma etapa copiada). A chave do gateway NÃO é copiada (cada oferta tem a sua: o
 * "Próximos passos" pede). Reaplicar substitui o upsell copiado antes (mantendo o
 * produto principal). Só entre ofertas da MESMA moeda (os preços e as formas de
 * pagamento são da moeda). Regras puras do funil em src/lib/upsell.ts.
 */
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { remapInternalLinks } from "@/lib/internal-links";
import { offerCurrencyOf } from "@/lib/offer-currency";
import { transformPackedProject } from "@/lib/project-data";
import { uniqueSlug } from "@/lib/text";
import { parseUpsellFlow, type UpsellFlow } from "@/lib/upsell";
import { saveUpsellFlow } from "./upsell";

/** Uma oferta que pode receber o upsell (mesma moeda que a de origem). */
export interface UpsellTargetOffer {
  id: string;
  name: string;
  /** Já tem um upsell configurado (aplicar substitui). */
  hasUpsell: boolean;
}

/** Ofertas da MESMA moeda (fora a própria) para a lista de "usar em outras ofertas". */
export async function offersForUpsellApply(sourceOfferId: string): Promise<UpsellTargetOffer[]> {
  const source = await prisma.offer.findFirst({
    where: { id: sourceOfferId, deletedAt: null },
    select: { settings: true },
  });
  if (!source) throw new UserError("Oferta não encontrada.");
  const currency = offerCurrencyOf(source.settings);
  const others = await prisma.offer.findMany({
    where: { deletedAt: null, id: { not: sourceOfferId } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, settings: true, upsell: true },
  });
  return others
    .filter((o) => offerCurrencyOf(o.settings) === currency)
    .map((o) => ({ id: o.id, name: o.name, hasUpsell: parseUpsellFlow(o.upsell).steps.length > 0 }));
}

export interface ApplyUpsellResult {
  applied: { id: string; name: string }[];
  skipped: { id: string; name: string; reason: string }[];
}

type SourcePage = Prisma.PageGetPayload<{
  include: { variants: { include: { documents: true } } };
}>;
type SourceLink = Prisma.OfferLinkGetPayload<{ include: { payment: true; checkout: true } }>;
type SourceAsset = Prisma.AssetGetPayload<Record<string, never>>;

/** Chave de link única no destino: mantém a de origem se estiver livre; senão, "-2", "-3"… (≤ 80). */
function uniqueKey(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const suffix = `-${i}`;
    const candidate = `${base.slice(0, 80 - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Nome do arquivo em /os-assets/<arquivo> a partir da chave do storage. */
function assetFileName(key: string): string {
  const parts = key.split("/");
  return parts[parts.length - 1] ?? key;
}

/**
 * Aplica o upsell da oferta de origem nas de destino. Devolve o que foi aplicado
 * e o que foi pulado (com o motivo). Cada oferta é uma transação à parte: um erro
 * numa não derruba as outras.
 */
export async function applyUpsellToOffers(sourceOfferId: string, targetOfferIds: string[]): Promise<ApplyUpsellResult> {
  const source = await prisma.offer.findFirst({
    where: { id: sourceOfferId, deletedAt: null },
    select: { settings: true, upsell: true },
  });
  if (!source) throw new UserError("Oferta não encontrada.");
  const sourceFlow = parseUpsellFlow(source.upsell);
  if (!sourceFlow.steps.length) throw new UserError("Monte o upsell nesta oferta antes de aplicar em outras.");
  const sourceCurrency = offerCurrencyOf(source.settings);

  // Páginas das etapas + obrigado; produtos das etapas. O "produto principal" NÃO é copiado
  // (cada oferta usa o seu).
  const stepPageIds = [
    ...new Set([...sourceFlow.steps.map((s) => s.pageId), sourceFlow.thankYouPageId].filter(Boolean) as string[]),
  ];
  const stepLinkKeys = [...new Set(sourceFlow.steps.map((s) => s.linkKey).filter(Boolean) as string[])];

  const [srcPages, srcLinks, srcAssets] = await Promise.all([
    prisma.page.findMany({
      where: { offerId: sourceOfferId, id: { in: stepPageIds } },
      include: { variants: { orderBy: { position: "asc" }, include: { documents: true } } },
    }),
    prisma.offerLink.findMany({
      where: { offerId: sourceOfferId, key: { in: stepLinkKeys } },
      include: { payment: true, checkout: true },
    }),
    prisma.asset.findMany({ where: { offerId: sourceOfferId } }),
  ]);

  const result: ApplyUpsellResult = { applied: [], skipped: [] };
  const seen = new Set<string>();
  for (const targetId of targetOfferIds) {
    if (seen.has(targetId)) continue;
    seen.add(targetId);
    if (targetId === sourceOfferId) continue; // aplicar na própria não faz sentido
    try {
      const name = await applyToOne(targetId, sourceCurrency, sourceFlow, srcPages, srcLinks, srcAssets);
      result.applied.push({ id: targetId, name });
    } catch (e) {
      const offer = await prisma.offer.findUnique({ where: { id: targetId }, select: { name: true } });
      result.skipped.push({
        id: targetId,
        name: offer?.name ?? targetId,
        reason: e instanceof UserError ? e.message : "não foi possível aplicar",
      });
    }
  }
  return result;
}

async function applyToOne(
  targetId: string,
  sourceCurrency: string,
  sourceFlow: UpsellFlow,
  srcPages: SourcePage[],
  srcLinks: SourceLink[],
  srcAssets: SourceAsset[],
): Promise<string> {
  return prisma.$transaction(
    async (tx) => {
      const target = await tx.offer.findFirst({
        where: { id: targetId, deletedAt: null },
        select: { name: true, settings: true, upsell: true },
      });
      if (!target) throw new UserError("Oferta não encontrada.");
      if (offerCurrencyOf(target.settings) !== sourceCurrency) throw new UserError("A moeda é diferente.");

      // Reaplicar: tira o upsell copiado antes (páginas das etapas + obrigado + produtos das etapas),
      // mantendo os produtos que iniciam (startLinkKeys) e a página inicial.
      const current = parseUpsellFlow(target.upsell);
      if (current.steps.length) {
        const oldPageIds = [
          ...new Set([...current.steps.map((s) => s.pageId), current.thankYouPageId].filter(Boolean) as string[]),
        ];
        const startSet = new Set(current.startLinkKeys);
        const oldLinkKeys = [
          ...new Set(
            current.steps.map((s) => s.linkKey).filter((k): k is string => Boolean(k) && !startSet.has(k as string)),
          ),
        ];
        if (oldPageIds.length)
          await tx.page.deleteMany({ where: { offerId: targetId, id: { in: oldPageIds }, isHome: false } });
        if (oldLinkKeys.length)
          await tx.offerLink.deleteMany({ where: { offerId: targetId, key: { in: oldLinkKeys } } });
      }

      const [existingPages, existingLinks] = await Promise.all([
        tx.page.findMany({ where: { offerId: targetId }, select: { slug: true, position: true } }),
        tx.offerLink.findMany({ where: { offerId: targetId }, select: { key: true } }),
      ]);
      const takenSlugs = new Set(existingPages.map((p) => p.slug));
      const takenKeys = new Set(existingLinks.map((l) => l.key));
      let pos = Math.max(-1, ...existingPages.map((p) => p.position)) + 1;

      // ── Copia as páginas (1ª passada: cria; 2ª: variações/documentos com os links internos remapeados).
      const pageIdMap = new Map<string, string>();
      for (const page of srcPages) {
        const slug = uniqueSlug(page.slug, takenSlugs);
        takenSlugs.add(slug);
        const created = await tx.page.create({
          data: {
            offerId: targetId,
            name: page.name,
            slug,
            type: page.type,
            position: pos++,
            isHome: false,
            cloneMode: page.cloneMode,
            sourceUrl: page.sourceUrl,
            seo: page.seo ?? {},
            customCode: page.customCode ?? {},
          },
          select: { id: true },
        });
        pageIdMap.set(page.id, created.id);
      }
      for (const page of srcPages) {
        const newPageId = pageIdMap.get(page.id) as string;
        for (const variant of page.variants) {
          await tx.pageVariant.create({
            data: {
              pageId: newPageId,
              name: variant.name,
              label: variant.label,
              isControl: variant.isControl,
              weight: variant.weight,
              position: variant.position,
              documents: {
                create: variant.documents.map((doc) => ({
                  device: doc.device,
                  html: doc.html ? remapInternalLinks(doc.html, pageIdMap) : doc.html,
                  project: doc.project
                    ? transformPackedProject(doc.project, (json) => remapInternalLinks(json, pageIdMap))
                    : null,
                  assetMap: doc.assetMap ?? Prisma.JsonNull,
                  editableHtml: doc.editableHtml ? remapInternalLinks(doc.editableHtml, pageIdMap) : doc.editableHtml,
                  revision: 0,
                })),
              },
            },
          });
        }
      }

      // ── Copia os produtos das etapas (a chave do gateway NÃO vem junto).
      const linkKeyMap = new Map<string, string>();
      for (const link of srcLinks) {
        const key = uniqueKey(link.key, takenKeys);
        takenKeys.add(key);
        const { id: _i, offerId: _o, createdAt: _c, updatedAt: _u, payment, checkout, key: _k, ...rest } = link;
        const created = await tx.offerLink.create({
          data: { ...rest, key, offerId: targetId },
          select: { id: true, key: true },
        });
        linkKeyMap.set(link.key, created.key);
        if (payment) {
          const { id: _pi, linkId: _pl, createdAt: _pc, updatedAt: _pu, thankYouPageId, ...prest } = payment;
          await tx.paymentProduct.create({
            data: {
              ...prest,
              linkId: created.id,
              thankYouPageId: thankYouPageId ? (pageIdMap.get(thankYouPageId) ?? null) : null,
            },
          });
        }
        if (checkout) {
          const { id: _ci, linkId: _cl, createdAt: _cc, updatedAt: _cu, thankYouPageId, config, ...crest } = checkout;
          await tx.checkoutProduct.create({
            data: {
              ...crest,
              config: config ?? {},
              linkId: created.id,
              thankYouPageId: thankYouPageId ? (pageIdMap.get(thankYouPageId) ?? null) : null,
            },
          });
        }
      }

      // ── Copia só os arquivos (assets) citados no que foi copiado (por hash; os arquivos já existem).
      const content = [
        ...srcPages.flatMap((p) =>
          p.variants.flatMap((v) => v.documents.map((d) => `${d.html ?? ""}\n${d.editableHtml ?? ""}`)),
        ),
        JSON.stringify(srcLinks.map((l) => l.checkout?.config ?? l.payment ?? {})),
      ].join("\n");
      const referenced = srcAssets.filter((a) => content.includes(a.key) || content.includes(assetFileName(a.key)));
      if (referenced.length) {
        await tx.asset.createMany({
          data: referenced.map(({ id: _i, offerId: _o, createdAt: _c, ...rest }) => ({ ...rest, offerId: targetId })),
          skipDuplicates: true,
        });
      }

      // ── Produto principal do destino: o 1º link de compra (com produto salvo) que NÃO é etapa copiada.
      const copiedKeys = new Set(linkKeyMap.values());
      const candidates = await tx.offerLink.findMany({
        where: { offerId: targetId, target: { in: ["PAYMENT", "CHECKOUT"] }, key: { notIn: [...copiedKeys] } },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: { key: true, payment: { select: { linkId: true } }, checkout: { select: { linkId: true } } },
      });
      const mainProduct = candidates.find((c) => c.payment || c.checkout)?.key ?? null;

      // ── Monta e liga o funil no destino (na mesma transação). O produto principal
      // do destino vira o único que inicia; depois o usuário pode marcar outros.
      const targetFlow: UpsellFlow = {
        startLinkKeys: mainProduct ? [mainProduct] : [],
        thankYouPageId: sourceFlow.thankYouPageId ? (pageIdMap.get(sourceFlow.thankYouPageId) ?? null) : null,
        steps: sourceFlow.steps.map((s) => ({
          ...s,
          pageId: s.pageId ? (pageIdMap.get(s.pageId) ?? null) : null,
          linkKey: s.linkKey ? (linkKeyMap.get(s.linkKey) ?? null) : null,
        })),
      };
      await saveUpsellFlow(targetId, targetFlow, tx);
      await tx.offer.update({ where: { id: targetId }, data: { updatedAt: new Date() } });
      return target.name;
    },
    { timeout: 60_000 },
  );
}
