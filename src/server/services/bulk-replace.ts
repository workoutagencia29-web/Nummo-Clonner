/**
 * Mudanças em todas as páginas da oferta de uma vez: localizar e substituir e
 * operações de links (ligar ao link da oferta, trocar endereço, desligar).
 *
 * Cada documento (página × versão A/B × dispositivo) que muda ganha antes uma
 * versão "Antes de substituir" (BULK_REPLACE), para poder voltar pela tela de
 * versões. O JSON do projeto do editor e o HTML final mudam juntos, com as
 * mesmas regras (src/lib/find-replace.ts), e a revisão sobe (uma aba aberta com
 * a página avisa do conflito em vez de sobrescrever).
 */
import { WHATSAPP_HOSTS } from "@/detection/checkouts";
import { prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import {
  applyLinkOpToHtml,
  applyLinkOpToProject,
  createMatcher,
  type LinkMatch,
  type LinkOp,
  replaceInHtml,
  replaceInProject,
  type SearchTargets,
} from "@/lib/find-replace";
import { packProject, unpackProject } from "@/lib/project-data";
import { createVersion } from "@/server/services/documents";
import { matchCheckoutPlatform } from "@/worker/clone/checkouts";

/** Tentativas por documento quando outra gravação acontece no meio. */
const MAX_ATTEMPTS = 3;

export interface BulkDocumentResult {
  documentId: string;
  pageId: string;
  pageName: string;
  variantName: string;
  device: "ALL" | "DESKTOP" | "MOBILE";
  /** Quantas trocas (ou elementos alterados, nas operações de link). */
  count: number;
}

export interface BulkResult {
  /** Só os documentos com alguma mudança, na ordem do funil. */
  documents: BulkDocumentResult[];
  total: number;
  /** Documentos gravados (vazio no modo de contagem). */
  changedDocumentIds: string[];
}

interface BulkOptions {
  /** Só conta, não grava nada. */
  dryRun?: boolean;
  /** Documentos que ficam de fora (a página aberta no editor, que muda pelo próprio editor). */
  excludeDocumentIds?: string[];
  /**
   * Documento aberto no editor: ganha a versão "antes" aqui, já que a troca nele
   * é feita pelo editor (e salva em seguida pelo autosave).
   */
  snapshotDocumentId?: string;
}

type Transform = (
  project: unknown | null,
  html: string | null,
) => Promise<{ project: unknown | null; html: string | null; count: number }>;

async function offerOrThrow(offerId: string) {
  const offer = await prisma.offer.findFirst({ where: { id: offerId, deletedAt: null }, select: { id: true } });
  if (!offer) throw new UserError("Oferta não encontrada.");
}

const documentSelect = {
  id: true,
  revision: true,
  project: true,
  html: true,
  device: true,
  variant: { select: { name: true, position: true, page: { select: { id: true, name: true, position: true } } } },
} as const;

async function offerDocuments(offerId: string) {
  const docs = await prisma.pageDocument.findMany({
    where: { variant: { page: { offerId, offer: { deletedAt: null } } } },
    select: documentSelect,
  });
  const deviceOrder = { ALL: 0, DESKTOP: 1, MOBILE: 2 } as const;
  return docs.sort(
    (a, b) =>
      a.variant.page.position - b.variant.page.position ||
      a.variant.position - b.variant.position ||
      deviceOrder[a.device] - deviceOrder[b.device],
  );
}

async function runBulk(offerId: string, label: string, transform: Transform, opts: BulkOptions): Promise<BulkResult> {
  await offerOrThrow(offerId);
  const exclude = new Set(opts.excludeDocumentIds ?? []);
  const docs = await offerDocuments(offerId);
  const results: BulkDocumentResult[] = [];
  const changed: string[] = [];
  const touchedPages = new Set<string>();

  for (const doc of docs) {
    if (exclude.has(doc.id)) continue;
    let current: typeof doc | null = doc;
    for (let attempt = 0; current && attempt < MAX_ATTEMPTS; attempt++) {
      const project = current.project ? unpackProject(current.project) : null;
      const next = await transform(project, current.html);
      if (!next.count) break;
      const result: BulkDocumentResult = {
        documentId: doc.id,
        pageId: doc.variant.page.id,
        pageName: doc.variant.page.name,
        variantName: doc.variant.name,
        device: doc.device,
        count: next.count,
      };
      if (opts.dryRun) {
        results.push(result);
        break;
      }
      await createVersion(doc.id, "BULK_REPLACE", label, { project, html: current.html });
      const { count } = await prisma.pageDocument.updateMany({
        where: { id: doc.id, revision: current.revision },
        data: {
          project: project !== null && next.project !== null ? packProject(next.project) : undefined,
          html: next.html,
          revision: current.revision + 1,
        },
      });
      if (count) {
        results.push(result);
        changed.push(doc.id);
        touchedPages.add(doc.variant.page.id);
        break;
      }
      // Alguém salvou este documento no meio: refaz a partir do estado novo.
      current = await prisma.pageDocument.findUnique({ where: { id: doc.id }, select: documentSelect });
    }
  }

  if (!opts.dryRun && opts.snapshotDocumentId) {
    const owned = docs.some((d) => d.id === opts.snapshotDocumentId);
    if (!owned) throw new UserError("Página não encontrada nesta oferta.");
    await createVersion(opts.snapshotDocumentId, "BULK_REPLACE", label);
  }

  if (changed.length) {
    const now = new Date();
    await prisma.page.updateMany({ where: { id: { in: [...touchedPages] } }, data: { updatedAt: now } });
    await prisma.offer.update({ where: { id: offerId }, data: { updatedAt: now } });
  }
  return { documents: results, total: results.reduce((n, r) => n + r.count, 0), changedDocumentIds: changed };
}

function versionLabel(prefix: string, detail: string) {
  const short = detail.length > 60 ? `${detail.slice(0, 59)}…` : detail;
  return `${prefix} “${short}”`;
}

// ─── Localizar e substituir ──────────────────────────────────────────────────

export interface BulkReplaceInput extends BulkOptions {
  offerId: string;
  query: string;
  replacement: string;
  accentInsensitive?: boolean;
  /** Nos textos, o texto novo segue as maiúsculas do trecho encontrado. */
  preserveCase?: boolean;
  targets: SearchTargets;
}

export async function bulkReplace(input: BulkReplaceInput): Promise<BulkResult> {
  const matcher = createMatcher(input.query, {
    accentInsensitive: input.accentInsensitive,
    preserveCase: input.preserveCase,
  });
  if (!matcher) throw new UserError("Digite o que procurar.", "query");
  if (!input.targets.text && !input.targets.attributes) {
    throw new UserError("Escolha onde procurar: nos textos, nos links e imagens ou nos dois.");
  }
  const transform: Transform = async (project, html) => {
    const p = project !== null ? await replaceInProject(project, matcher, input.replacement, input.targets) : null;
    const h = html ? await replaceInHtml(html, matcher, input.replacement, input.targets) : null;
    return {
      project: p ? p.project : project,
      html: h ? h.html : html,
      count: Math.max(p?.count ?? 0, h?.count ?? 0),
    };
  };
  return runBulk(input.offerId, versionLabel("Antes de substituir", input.query), transform, input);
}

// ─── Links ───────────────────────────────────────────────────────────────────

export interface BulkLinkInput extends BulkOptions {
  offerId: string;
  match: LinkMatch;
  op: LinkOp;
}

export async function bulkLinkChange(input: BulkLinkInput): Promise<BulkResult> {
  if (input.op.type === "bind") {
    const link = await prisma.offerLink.findFirst({
      where: { offerId: input.offerId, key: input.op.key },
      select: { id: true },
    });
    if (!link) throw new UserError("Link da oferta não encontrado. Ele pode ter sido excluído.");
  }
  const { match, op } = input;
  const transform: Transform = async (project, html) => {
    const p = project !== null ? applyLinkOpToProject(project, match, op) : null;
    const h = html ? await applyLinkOpToHtml(html, match, op) : null;
    return {
      project: p ? p.project : project,
      html: h ? h.html : html,
      count: Math.max(p?.count ?? 0, h?.count ?? 0),
    };
  };
  const detail = match.kind === "link" ? match.key : match.url;
  return runBulk(input.offerId, versionLabel("Antes de trocar o link", detail), transform, input);
}

// ─── Tipo de cada endereço ───────────────────────────────────────────────────

export interface LinkClassification {
  kind: "checkout" | "whatsapp" | "other";
  /** Plataforma de checkout ("Hotmart", "Kiwify"… ou "Desconhecida"). */
  platform: string | null;
}

function isWhatsApp(url: string) {
  if (/^whatsapp:/i.test(url.trim())) return true;
  try {
    const host = new URL(url.trim()).hostname.toLowerCase().replace(/^www\./, "");
    return WHATSAPP_HOSTS.some((p) =>
      typeof p === "string" ? (p.startsWith("*.") ? host.endsWith(p.slice(1)) : host === p) : p.test(host),
    );
  } catch {
    return false;
  }
}

/** Reconhece checkouts (Hotmart, Kiwify, Eduzz…) e WhatsApp pelos endereços. */
export function classifyUrls(urls: string[]): Record<string, LinkClassification> {
  const out: Record<string, LinkClassification> = {};
  for (const url of urls) {
    if (url in out) continue;
    if (isWhatsApp(url)) {
      out[url] = { kind: "whatsapp", platform: null };
      continue;
    }
    const absolute = url.trim().startsWith("//") ? `https:${url.trim()}` : url;
    const hit = matchCheckoutPlatform(absolute);
    out[url] = hit ? { kind: "checkout", platform: hit.platform } : { kind: "other", platform: null };
  }
  return out;
}
