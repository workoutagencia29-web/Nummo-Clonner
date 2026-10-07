/**
 * Funil em 1 clique "Quiz → Roleta" (tela da oferta, "Páginas do funil"):
 * numa transação só, cria um link da oferta para o checkout de cada prêmio, a
 * página "Roleta" (modelo, com as fatias ligadas a esses links e o "Resgatar"
 * levando à página de vendas escolhida) e a página "Quiz" (modelo, com o botão
 * final levando à roleta). O quiz vira a página inicial (o link do anúncio cai
 * nele) e as duas entram na ordem do funil logo antes da página de vendas.
 *
 * Usa os serviços de sempre (createPage, createOfferLink, reorderPages,
 * setHomePage) dentro da transação: se algo falha, nada fica pela metade.
 * As páginas novas começam sem histórico, como qualquer página criada de um
 * modelo; nenhuma página que já existia é alterada (só a ordem e a inicial).
 */
import * as cheerio from "cheerio";
import { examplePrize } from "@/editor/widgets/wheel-content";
import { type Db, prisma } from "@/lib/db";
import { restoreDoctype } from "@/lib/doctype";
import { UserError } from "@/lib/errors";
import {
  cleanPrize,
  FUNNEL_MAX_PRIZES,
  FUNNEL_MIN_PRIZES,
  type FunnelPrize,
  prizeLinkLabel,
  prizeProblems,
} from "@/lib/funnel";
import { internalLink } from "@/lib/internal-links";
import { LINK_ATTR } from "@/lib/offer-links";
import { serializeSlices, WHEEL_COLORS, type WheelSlice, wheelSvg } from "@/lib/wheel";
import { WHEEL_MARK } from "@/lib/wheel-prizes";
import { createOfferLink } from "@/server/services/offer-links";
import { createPage, reorderPages, setHomePage } from "@/server/services/pages";

/** Marca de um quiz no HTML salvo. */
export const QUIZ_MARK = 'data-os-widget="quiz"';

// ─── HTML das páginas novas ──────────────────────────────────────────────────

/** Botão de saída leva à página do funil (como o campo "…leva para a página do funil" do editor). */
function pointToPage($: cheerio.CheerioAPI, selector: string, pageId: string) {
  const buttons = $(selector);
  buttons.attr("href", internalLink(pageId));
  buttons.removeAttr(LINK_ATTR);
  return buttons.length;
}

/** Quiz do modelo com o botão final levando à página `pageId` (a roleta). */
export function quizToPage(html: string, pageId: string): string {
  const $ = cheerio.load(html);
  if (!pointToPage($, "[data-os-qz-go]", pageId)) throw new Error("Modelo do quiz sem o botão final.");
  return restoreDoctype($.html(), html);
}

/**
 * Roleta do modelo com estas fatias (a roda, o prêmio e o cupom de exemplo
 * desenhados de novo a partir delas, como faz o editor ao salvar) e o
 * "Resgatar" levando à página `pageId` (a página de vendas).
 */
export function wheelForFunnel(html: string, slices: WheelSlice[], pageId: string): string {
  const $ = cheerio.load(html);
  const wheel = $('[data-os-widget="wheel"]').first();
  if (!wheel.length) throw new Error("Modelo da roleta sem a roleta.");
  wheel.attr("data-os-slices", serializeSlices(slices));
  wheel.find("[data-os-wh-disc]").html(wheelSvg(slices));
  const example = examplePrize(slices);
  wheel.find("[data-os-wh-prize]").text(example?.text ?? "");
  wheel.find("[data-os-wh-code]").text(slices.find((s) => !s.lose && s.coupon)?.coupon || "SEUCUPOM");
  if (!pointToPage($, "[data-os-wh-go]", pageId)) throw new Error("Modelo da roleta sem o botão Resgatar.");
  return restoreDoctype($.html(), html);
}

// ─── Consultas ───────────────────────────────────────────────────────────────

export interface ExistingFunnel {
  /** Páginas da oferta com quiz (na ordem do funil). */
  quiz: { id: string; name: string }[];
  /** Páginas da oferta com roleta de desconto. */
  wheel: { id: string; name: string }[];
}

/** Quiz e roletas que a oferta já tem (para avisar antes de criar outro funil). */
export async function existingFunnel(offerId: string, db: Db = prisma): Promise<ExistingFunnel> {
  const pages = await db.page.findMany({
    where: {
      offerId,
      variants: {
        some: { documents: { some: { OR: [{ html: { contains: QUIZ_MARK } }, { html: { contains: WHEEL_MARK } }] } } },
      },
    },
    orderBy: { position: "asc" },
    select: { id: true, name: true, variants: { select: { documents: { select: { html: true } } } } },
  });
  const has = (p: (typeof pages)[number], mark: string) =>
    p.variants.some((v) => v.documents.some((d) => d.html?.includes(mark)));
  return {
    quiz: pages.filter((p) => has(p, QUIZ_MARK)).map(({ id, name }) => ({ id, name })),
    wheel: pages.filter((p) => has(p, WHEEL_MARK)).map(({ id, name }) => ({ id, name })),
  };
}

/** A página tem algum botão ligado a um link de checkout da oferta? (são eles que levam ao checkout do prêmio) */
async function hasCheckoutButtons(pageId: string, offerId: string, db: Db) {
  const [docs, links] = await Promise.all([
    db.pageDocument.findMany({ where: { variant: { pageId } }, select: { html: true } }),
    db.offerLink.findMany({ where: { offerId, kind: "CHECKOUT" }, select: { key: true } }),
  ]);
  const keys = new Set(links.map((l) => l.key));
  const re = new RegExp(`${LINK_ATTR}\\s*=\\s*["']?([a-z0-9-]+)`, "g");
  return docs.some((d) => [...(d.html ?? "").matchAll(re)].some((m) => keys.has(m[1])));
}

// ─── Criar ───────────────────────────────────────────────────────────────────

export interface CreateFunnelInput {
  offerId: string;
  /** Página de vendas (destino do "Resgatar" da roleta). */
  salesPageId: string;
  prizes: FunnelPrize[];
  /** A oferta já tem quiz ou roleta e a pessoa confirmou que quer outro funil. */
  allowExisting?: boolean;
}

export interface CreatedFunnelPage {
  id: string;
  name: string;
  slug: string;
  /** Documento que abre no editor. */
  documentId: string;
}

export interface CreatedFunnel {
  quiz: CreatedFunnelPage;
  wheel: CreatedFunnelPage;
  sales: { id: string; name: string; slug: string };
  /** Prêmios que ficaram sem o endereço do checkout (o link da oferta foi criado vazio). */
  missingUrls: string[];
  /** A página de vendas tem botões ligados a um checkout da oferta (trocados pelo checkout do prêmio). */
  salesHasCheckoutButtons: boolean;
}

/** "Quiz", ou "Quiz 2" se a oferta já tem uma página com esse nome. */
function freeName(base: string, taken: string[]) {
  const used = new Set(taken.map((n) => n.trim().toLowerCase()));
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} ${i}`;
  return name;
}

function checkPrizes(prizes: FunnelPrize[]) {
  if (prizes.length < FUNNEL_MIN_PRIZES) {
    throw new UserError(`A roleta precisa de pelo menos ${FUNNEL_MIN_PRIZES} prêmios.`, "prizes");
  }
  if (prizes.length > FUNNEL_MAX_PRIZES) {
    throw new UserError(`A roleta pode ter no máximo ${FUNNEL_MAX_PRIZES} prêmios.`, "prizes");
  }
  prizes.forEach((prize, i) => {
    const problems = prizeProblems(prize);
    if (problems.text) throw new UserError(`Prêmio ${i + 1}: ${problems.text}`, `prizes.${i}.text`);
    if (problems.url) throw new UserError(`Prêmio ${i + 1}: ${problems.url}`, `prizes.${i}.url`);
  });
}

export async function createQuizWheelFunnel(input: CreateFunnelInput): Promise<CreatedFunnel> {
  const offer = await prisma.offer.findFirst({ where: { id: input.offerId, deletedAt: null }, select: { id: true } });
  if (!offer) throw new UserError("Oferta não encontrada.");
  checkPrizes(input.prizes);
  const prizes = input.prizes.map(cleanPrize);

  return prisma.$transaction(
    async (tx) => {
      const sales = await tx.page.findFirst({
        where: { id: input.salesPageId, offerId: offer.id },
        select: { id: true, name: true },
      });
      if (!sales) {
        throw new UserError(
          "A página de vendas escolhida não existe mais nesta oferta. Recarregue a tela.",
          "salesPageId",
        );
      }
      if (!input.allowExisting) {
        const existing = await existingFunnel(offer.id, tx);
        const first = existing.quiz[0] ?? existing.wheel[0];
        if (first) {
          throw new UserError(
            `Esta oferta já tem ${existing.quiz.length ? "um quiz" : "uma roleta"} (página “${first.name}”). Confirme para criar outro funil.`,
          );
        }
      }

      // Um link da oferta (checkout) por prêmio, com o nome do prêmio.
      const labels = (await tx.offerLink.findMany({ where: { offerId: offer.id }, select: { label: true } })).map(
        (l) => l.label,
      );
      const slices: WheelSlice[] = [];
      for (const [i, prize] of prizes.entries()) {
        const label = freeName(prizeLinkLabel(prize.text), labels).slice(0, 60);
        labels.push(label);
        const link = await createOfferLink(offer.id, { label, url: prize.url, kind: "CHECKOUT" }, tx);
        slices.push({
          text: prize.text,
          color: WHEEL_COLORS[i % WHEEL_COLORS.length],
          chance: prize.chance,
          link: link.key,
          coupon: prize.coupon,
        });
      }

      const names = (await tx.page.findMany({ where: { offerId: offer.id }, select: { name: true } })).map(
        (p) => p.name,
      );
      const wheelName = freeName("Roleta", names);
      const wheel = await createPage(
        {
          offerId: offer.id,
          name: wheelName,
          templateId: "roleta",
          adjustHtml: (html) => wheelForFunnel(html, slices, sales.id),
        },
        tx,
      );
      const quizName = freeName("Quiz", names);
      const quiz = await createPage(
        { offerId: offer.id, name: quizName, templateId: "quiz", adjustHtml: (html) => quizToPage(html, wheel.id) },
        tx,
      );

      // Ordem do funil: … → Quiz → Roleta → página de vendas → …
      const order = (
        await tx.page.findMany({ where: { offerId: offer.id }, orderBy: { position: "asc" }, select: { id: true } })
      )
        .map((p) => p.id)
        .filter((id) => id !== quiz.id && id !== wheel.id);
      order.splice(order.indexOf(sales.id), 0, quiz.id, wheel.id);
      await reorderPages(offer.id, order, tx);
      await setHomePage(quiz.id, tx);

      const created = await tx.page.findMany({
        where: { id: { in: [quiz.id, wheel.id, sales.id] } },
        select: {
          id: true,
          name: true,
          slug: true,
          variants: {
            where: { isControl: true },
            select: { documents: { select: { id: true, device: true } } },
          },
        },
      });
      const page = (id: string) => {
        const p = created.find((c) => c.id === id);
        if (!p) throw new Error("Página do funil sumiu no meio da criação.");
        return p;
      };
      const withDocument = (id: string): CreatedFunnelPage => {
        const p = page(id);
        const docs = p.variants[0]?.documents ?? [];
        const doc = docs.find((d) => d.device === "ALL") ?? docs[0];
        if (!doc) throw new Error("Página do funil sem documento.");
        return { id: p.id, name: p.name, slug: p.slug, documentId: doc.id };
      };
      const salesPage = page(sales.id);
      return {
        quiz: withDocument(quiz.id),
        wheel: withDocument(wheel.id),
        sales: { id: salesPage.id, name: salesPage.name, slug: salesPage.slug },
        missingUrls: prizes.filter((p) => !p.url).map((p) => p.text),
        salesHasCheckoutButtons: await hasCheckoutButtons(sales.id, offer.id, tx),
      };
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
}
