/**
 * Clonar o funil inteiro a partir de um link: quando uma página do funil
 * termina de ser clonada, as páginas do mesmo site a que ela leva
 * (`CloneResult.links`: próxima etapa do quiz, roleta, loja, cada produto…)
 * entram na fila como clonagens filhas da principal — em largura, sem repetir
 * endereço, até FUNNEL_PAGE_LIMIT páginas e FUNNEL_MAX_DEPTH níveis.
 *
 * `CloneJob.options` (JSON):
 * - principal: `funnel: true` (a caixa "Clonar o funil inteiro"), `funnelStopped`
 *   quando a pessoa clica em "Parar de procurar";
 * - filhas: `funnel: true` e `step` (de qual página veio, nível, texto do botão).
 *
 * Chamado pelo worker no fim de cada clonagem (job.ts) e testável sem ele.
 */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { FUNNEL_PAGE_LIMIT, funnelMatchKey, normalizeCloneUrl } from "@/server/services/clone";
import type { CloneResult, PageLinkFound } from "@/worker/clone/types";

/** Níveis a partir da página do link (quiz = 0, roleta = 1, loja = 2, produto = 3…). */
export const FUNNEL_MAX_DEPTH = 6;
/** Páginas novas que uma página pode pôr na fila de uma vez (uma loja com muitos produtos). */
export const FUNNEL_NEW_PER_PAGE = 30;
/** Teto de tentativas (contando as que falharam), para um site enorme nunca prender a fila. */
export const FUNNEL_ATTEMPTS_MAX = FUNNEL_PAGE_LIMIT * 2;
/** Clonagem filha que abriu a mesma página de outra (redirecionamento): some do mapa. */
export const DUPLICATE_CODE = "DUPLICATE";

const StepSchema = z.object({
  /** Clonagem da página que leva a esta. */
  from: z.string(),
  depth: z.number().int().min(1).max(99),
  /** Texto do botão/link ou nome do produto. */
  label: z.string().max(200).default(""),
  via: z.enum(["link", "code", "click", "manual"]).default("manual"),
  product: z.boolean().optional(),
  /**
   * Ordem em que a página foi achada na página de origem. As filhas criadas
   * juntas têm o mesmo `createdAt` (now() da transação): é isto que mantém a
   * ordem dos cartões da loja.
   */
  order: z.number().int().min(0).default(0),
});
export type FunnelStep = z.infer<typeof StepSchema>;

const FunnelOptionsSchema = z.object({
  devices: z
    .array(z.enum(["desktop", "mobile"]))
    .min(1)
    .catch(["desktop", "mobile"])
    .default(["desktop", "mobile"]),
  maxVideoMb: z.number().int().min(0).max(1000).catch(200).default(200),
  funnel: z.boolean().catch(false).default(false),
  funnelStopped: z.boolean().catch(false).default(false),
  step: StepSchema.nullable().catch(null).default(null),
});
export type FunnelJobOptions = z.infer<typeof FunnelOptionsSchema>;

/** Lê as opções do funil de uma clonagem (tolerante: o JSON antigo não tem nada disso). */
export function funnelOptions(options: unknown): FunnelJobOptions {
  return FunnelOptionsSchema.parse(options && typeof options === "object" ? options : {});
}

/** Ordem em que as páginas achadas entram na fila (o robô e os produtos primeiro). */
function linkRank(link: PageLinkFound): number {
  if (link.via === "click") return 0;
  if (link.kind) return 1;
  if (link.product) return 2;
  if (link.via === "code") return 3;
  return link.nav ? 5 : 4;
}

export interface ExpandResult {
  created: string[];
  /** Esta página abriu a mesma de outra clonagem (fica de fora). */
  duplicateOf?: string;
}

const NOTHING: ExpandResult = { created: [] };

/**
 * Fim de uma clonagem do funil: confere se ela repetiu outra página e põe na
 * fila as páginas novas a que ela leva. Numa transação que trava a clonagem
 * principal (várias filhas terminando juntas não criam a mesma página duas vezes).
 */
export async function expandFunnel(jobId: string): Promise<ExpandResult> {
  return prisma.$transaction(async (tx) => {
    const job = await tx.cloneJob.findUnique({
      where: { id: jobId },
      select: { id: true, parentJobId: true, status: true, options: true, result: true, sourceUrl: true },
    });
    if (!job || job.status !== "REVIEW") return NOTHING;
    const rootId = job.parentJobId ?? job.id;
    await tx.$queryRaw`select id from "CloneJob" where id = ${rootId} for update`;
    const root = await tx.cloneJob.findUnique({
      where: { id: rootId },
      select: { id: true, status: true, offerId: true, options: true, sourceUrl: true, result: true },
    });
    // Salva (ou cancelada/falhou): o funil não cresce mais.
    if (!root || root.status !== "REVIEW") return NOTHING;
    const rootOptions = funnelOptions(root.options);
    if (!rootOptions.funnel) return NOTHING;

    const children = await tx.cloneJob.findMany({
      where: { parentJobId: rootId },
      orderBy: { createdAt: "asc" },
      select: { id: true, status: true, errorCode: true, sourceUrl: true, result: true },
    });
    const known = new Map<string, string>();
    const remember = (url: string | null | undefined, id: string) => {
      const key = funnelMatchKey(url);
      if (key && !known.has(key)) known.set(key, id);
    };
    remember(root.sourceUrl, root.id);
    remember((root.result as CloneResult | null)?.finalUrl, root.id);
    for (const c of children) {
      if (c.id === job.id) continue;
      remember(c.sourceUrl, c.id);
      if (c.errorCode !== DUPLICATE_CODE) remember((c.result as CloneResult | null)?.finalUrl, c.id);
    }

    const result = job.result as CloneResult | null;
    // Página que, aberta, virou outra já conhecida (redirecionamento, mesma rota): fica de fora.
    if (job.id !== root.id) {
      const sameAs = known.get(funnelMatchKey(result?.finalUrl) ?? "");
      if (sameAs && sameAs !== job.id) {
        const other =
          sameAs === root.id
            ? (root.result as CloneResult | null)
            : (children.find((c) => c.id === sameAs)?.result as CloneResult | null);
        const name = other?.page?.name || other?.title || "outra página do funil";
        await tx.cloneJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            errorCode: DUPLICATE_CODE,
            errorMessage: `Abre a mesma página que “${name}”.`.slice(0, 500),
          },
        });
        return { created: [], duplicateOf: sameAs };
      }
    }
    remember(job.sourceUrl, job.id);
    remember(result?.finalUrl, job.id);

    if (rootOptions.funnelStopped) return NOTHING;
    const depth = job.id === root.id ? 0 : (funnelOptions(job.options).step?.depth ?? 1);
    if (depth + 1 > FUNNEL_MAX_DEPTH) return NOTHING;
    const active = children.filter((c) => c.status !== "CANCELED" && c.status !== "FAILED").length;
    const budget = Math.min(
      FUNNEL_NEW_PER_PAGE,
      FUNNEL_PAGE_LIMIT - active,
      FUNNEL_ATTEMPTS_MAX - children.filter((c) => c.errorCode !== DUPLICATE_CODE).length,
    );
    if (budget <= 0) return NOTHING;

    const links = (result?.links ?? [])
      // Menu, cabeçalho e rodapé só da página do link (senão cada página da loja levaria o site inteiro).
      .filter((l) => depth === 0 || !l.nav)
      .map((l, i) => ({ l, i }))
      .sort((a, b) => linkRank(a.l) - linkRank(b.l) || a.i - b.i)
      .map((x) => x.l);
    const created: string[] = [];
    for (const link of links) {
      if (created.length >= budget) break;
      let url: string;
      try {
        url = normalizeCloneUrl(link.url);
      } catch {
        continue;
      }
      const key = funnelMatchKey(url);
      if (!key || known.has(key)) continue;
      const step: FunnelStep = {
        from: job.id,
        depth: depth + 1,
        label: link.label.slice(0, 200),
        via: link.via,
        ...(link.product ? { product: true } : {}),
        order: created.length,
      };
      const child = await tx.cloneJob.create({
        data: {
          source: "URL",
          sourceUrl: url,
          options: {
            devices: rootOptions.devices,
            maxVideoMb: rootOptions.maxVideoMb,
            funnel: true,
            step,
          },
          parentJobId: root.id,
        },
        select: { id: true },
      });
      known.set(key, child.id);
      created.push(child.id);
    }
    return { created };
  });
}

/**
 * "Parar de procurar": o funil não cresce mais e as páginas que ainda estão na
 * fila ou clonando são canceladas (as prontas ficam para salvar).
 */
export async function stopFunnel(rootId: string): Promise<{ canceled: number }> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`select id from "CloneJob" where id = ${rootId} for update`;
    const root = await tx.cloneJob.findUnique({ where: { id: rootId }, select: { options: true, parentJobId: true } });
    if (!root || root.parentJobId) throw new UserError("Clonagem não encontrada.");
    const options = (root.options && typeof root.options === "object" ? root.options : {}) as Record<string, unknown>;
    await tx.cloneJob.update({ where: { id: rootId }, data: { options: { ...options, funnelStopped: true } } });
    const { count } = await tx.cloneJob.updateMany({
      where: { parentJobId: rootId, status: { in: ["QUEUED", "RUNNING"] } },
      data: { status: "CANCELED", finishedAt: new Date() },
    });
    return { canceled: count };
  });
}
