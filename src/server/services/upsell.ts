/**
 * Funil de upsell pós-compra (aba "Upsell" da oferta): lê/grava a sequência em
 * Offer.upsell e LIGA tudo — o "obrigado" de cada produto aponta para a próxima
 * etapa (o redirect pós-pagamento já existe por thankYouPageId), e nas páginas
 * de upsell/downsell o botão "SIM" recebe o link do checkout da etapa e o "Não"
 * recebe o os-page da próxima. Regras puras em src/lib/upsell.ts.
 */
import * as cheerio from "cheerio";
import { atomically, type Db, prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { internalLink } from "@/lib/internal-links";
import {
  emptyUpsellFlow,
  parseUpsellFlow,
  type UpsellFlow,
  type UpsellProblem,
  upsellProblems,
  upsellRouting,
} from "@/lib/upsell";
import { createPage } from "./pages";

/** Produto que pode ser de uma etapa (link com pagamento na página ou checkout salvo). */
export interface UpsellProductOption {
  key: string;
  label: string;
  target: "PAYMENT" | "CHECKOUT";
  /** Nome do produto salvo e o valor (para mostrar na lista). */
  productName: string;
  amountCents: number;
  currency: string;
}

export interface UpsellPageOption {
  id: string;
  name: string;
  type: string;
  /**
   * A página é do MODELO de upsell/downsell (tem o botão "Não" `os-decline`): o
   * "Salvar upsell" liga os botões SIM/Não sozinho. Página clonada (sem ele)
   * precisa que o usuário ligue os botões à mão no editor.
   */
  autoWire: boolean;
}

export interface UpsellPanel {
  flow: UpsellFlow;
  products: UpsellProductOption[];
  pages: UpsellPageOption[];
  problems: UpsellProblem[];
}

export async function getUpsellFlow(offerId: string): Promise<UpsellFlow> {
  const offer = await prisma.offer.findUnique({ where: { id: offerId }, select: { upsell: true } });
  return offer ? parseUpsellFlow(offer.upsell) : emptyUpsellFlow();
}

/** Tudo o que a aba "Upsell" precisa: o funil, os produtos (links) e as páginas da oferta. */
export async function upsellPanel(offerId: string): Promise<UpsellPanel> {
  const [offer, links, pages, wireableDocs] = await Promise.all([
    prisma.offer.findUnique({ where: { id: offerId }, select: { upsell: true } }),
    prisma.offerLink.findMany({
      where: { offerId, target: { in: ["PAYMENT", "CHECKOUT"] } },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: {
        key: true,
        label: true,
        target: true,
        payment: { select: { name: true, amountCents: true, currency: true } },
        checkout: { select: { name: true, amountCents: true, currency: true } },
      },
    }),
    prisma.page.findMany({
      where: { offerId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, type: true },
    }),
    // Páginas com o botão "Não" do modelo (os-decline): o banco filtra, só volta o pageId.
    prisma.pageDocument.findMany({
      where: { variant: { page: { offerId } }, html: { contains: "os-decline" } },
      select: { variant: { select: { pageId: true } } },
    }),
  ]);
  const autoWire = new Set(wireableDocs.map((d) => d.variant.pageId));
  const products: UpsellProductOption[] = [];
  for (const l of links) {
    const p = l.target === "PAYMENT" ? l.payment : l.checkout;
    if (!p) continue; // link sem produto salvo não pode ser etapa
    products.push({
      key: l.key,
      label: l.label,
      target: l.target as "PAYMENT" | "CHECKOUT",
      productName: p.name,
      amountCents: p.amountCents,
      currency: p.currency,
    });
  }
  const flow = parseUpsellFlow(offer?.upsell);
  return {
    flow,
    products,
    pages: pages.map((p) => ({ id: p.id, name: p.name, type: p.type, autoWire: autoWire.has(p.id) })),
    problems: upsellProblems(flow),
  };
}

/** Modelo de página e nome padrão de cada etapa (a página já nasce com os botões SIM/Não prontos). */
const UPSELL_PAGE_SPEC: Record<
  "UPSELL" | "DOWNSELL" | "THANK_YOU",
  { templateId: string; name: string; type: string; autoWire: boolean }
> = {
  // Modelos de upsell/downsell já têm o botão "Não" (os-decline) → o funil liga sozinho.
  UPSELL: { templateId: "upsell", name: "Upsell", type: "UPSELL", autoWire: true },
  DOWNSELL: { templateId: "downsell", name: "Downsell", type: "DOWNSELL", autoWire: true },
  THANK_YOU: { templateId: "obrigado", name: "Obrigado", type: "THANK_YOU", autoWire: false },
};

/** Nome único entre as páginas da oferta ("Upsell", "Upsell 2"…). */
function uniquePageName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Cria uma página da sequência (upsell/downsell/obrigado) a partir do modelo —
 * já com os botões "SIM" (data-os-link="") e "Não" (os-decline) prontos. O
 * vínculo com o produto e a próxima etapa é feito depois, no `saveUpsellFlow`.
 */
export async function createUpsellPage(
  offerId: string,
  kind: "UPSELL" | "DOWNSELL" | "THANK_YOU",
): Promise<UpsellPageOption> {
  const spec = UPSELL_PAGE_SPEC[kind];
  const existing = await prisma.page.findMany({ where: { offerId }, select: { name: true } });
  const name = uniquePageName(spec.name, new Set(existing.map((p) => p.name)));
  const page = await createPage({ offerId, name, templateId: spec.templateId });
  return { id: page.id, name, type: spec.type, autoWire: spec.autoWire };
}

/** Liga o botão "SIM" (data-os-link) e o "Não" (os-page) nas páginas-modelo de upsell/downsell. */
export function wireUpsellButtons(html: string, simLinkKey: string | null, declinePageId: string | null): string {
  const $ = cheerio.load(html, null, false);
  const buy = $("a.os-btn[data-os-link]").first();
  if (buy.length) buy.attr("data-os-link", simLinkKey ?? "");
  const decline = $("a.os-decline").first();
  if (decline.length) decline.attr("href", declinePageId ? internalLink(declinePageId) : "#");
  return $.html();
}

/**
 * Grava o funil e LIGA tudo numa transação:
 * - produto principal e de cada etapa: thankYouPageId = para onde vai ao pagar;
 * - páginas de upsell/downsell: botão SIM = checkout da etapa, "Não" = próxima.
 * Salva mesmo incompleto (os pendentes aparecem no painel/Próximos passos).
 */
export async function saveUpsellFlow(offerId: string, flow: UpsellFlow, db: Db = prisma): Promise<void> {
  const offer = await db.offer.findUnique({ where: { id: offerId }, select: { id: true } });
  if (!offer) throw new UserError("Oferta não encontrada.");

  // Páginas e links da oferta (para conferir que o que o funil cita é desta oferta).
  const [pages, links] = await Promise.all([
    db.page.findMany({ where: { offerId }, select: { id: true } }),
    db.offerLink.findMany({
      where: { offerId },
      select: { id: true, key: true, payment: { select: { linkId: true } }, checkout: { select: { linkId: true } } },
    }),
  ]);
  const pageIds = new Set(pages.map((p) => p.id));
  const linkByKey = new Map(links.map((l) => [l.key, l]));

  // Limpa referências a páginas/links que não são mais desta oferta.
  const clean: UpsellFlow = {
    startLinkKeys: flow.startLinkKeys.filter((k) => linkByKey.has(k)),
    thankYouPageId: flow.thankYouPageId && pageIds.has(flow.thankYouPageId) ? flow.thankYouPageId : null,
    steps: flow.steps.map((s) => ({
      ...s,
      pageId: s.pageId && pageIds.has(s.pageId) ? s.pageId : null,
      linkKey: s.linkKey && linkByKey.has(s.linkKey) ? s.linkKey : null,
    })),
  };

  const routing = upsellRouting(clean);
  // linkKey → página de "obrigado" (para onde vai ao pagar aquele produto).
  // Cada produto que inicia cai na 1ª etapa; os produtos das etapas sobrescrevem
  // abaixo (um produto que inicia E é etapa usa o destino da etapa).
  const thankYouOf = new Map<string, string | null>();
  for (const key of clean.startLinkKeys) thankYouOf.set(key, routing.startPageId);
  const stepById = new Map(clean.steps.map((s) => [s.id, s]));
  for (const r of routing.steps) {
    const step = stepById.get(r.stepId);
    if (step?.linkKey) thankYouOf.set(step.linkKey, r.acceptPageId);
  }
  const declineOf = new Map(routing.steps.map((r) => [r.stepId, r.declinePageId]));

  await atomically(
    db,
    async (tx) => {
      await tx.offer.update({ where: { id: offerId }, data: { upsell: clean as object } });

      // 1) Encadeia o thankYouPageId dos produtos (o redirect pós-pagamento).
      for (const [key, pageId] of thankYouOf) {
        const link = linkByKey.get(key);
        if (!link) continue;
        if (link.payment)
          await tx.paymentProduct.update({ where: { linkId: link.id }, data: { thankYouPageId: pageId } });
        if (link.checkout)
          await tx.checkoutProduct.update({ where: { linkId: link.id }, data: { thankYouPageId: pageId } });
      }

      // 2) Liga os botões SIM/Não nas páginas de upsell/downsell (todas as variações/dispositivos).
      for (const step of clean.steps) {
        if (!step.pageId) continue;
        const decline = declineOf.get(step.id) ?? clean.thankYouPageId;
        const docs = await tx.pageDocument.findMany({
          where: { variant: { pageId: step.pageId } },
          select: { id: true, html: true, editableHtml: true },
        });
        for (const doc of docs) {
          const data: { html?: string; editableHtml?: string } = {};
          if (doc.html) data.html = wireUpsellButtons(doc.html, step.linkKey, decline);
          if (doc.editableHtml) data.editableHtml = wireUpsellButtons(doc.editableHtml, step.linkKey, decline);
          if (data.html || data.editableHtml) await tx.pageDocument.update({ where: { id: doc.id }, data });
        }
      }
    },
    { timeout: 60_000 },
  );
}
