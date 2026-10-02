/**
 * Versões A/B de uma página (PageVariant): criar (cópia de uma versão ou a
 * partir de um modelo), dar nome, escolher o controle, dividir o tráfego e
 * excluir. No ZIP, cada versão sai numa pasta (oferta-a/, oferta-b/…) e o
 * divisor opcional sorteia a versão pelo percentual.
 *
 * Invariantes (garantidos em transação, com a linha da página travada):
 * - de 1 a 5 versões por página, com letras únicas (A–E);
 * - exatamente uma versão de controle (também há um índice parcial no banco);
 * - percentuais inteiros de 0 a 100 que somam 100;
 * - posições 0..n-1 na ordem da lista.
 */

import {
  afterDelete,
  COPY_SOURCE_GONE,
  LAST_VARIANT,
  LIST_CHANGED,
  MAX_VARIANTS,
  nextVariantName,
  PAGE_NOT_FOUND,
  TOO_MANY_VARIANTS,
  VARIANT_LABEL_MAX,
  VARIANT_NOT_FOUND,
  type VariantName,
  WEIGHTS_CHANGED,
  weightsAfterCreate,
  weightsProblem,
} from "@/components/offers/variants/weights";
import type { DeviceTarget } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { variantDirs } from "@/lib/export/layout";
import { removeVersionFiles } from "@/server/services/documents";
import { pageStart } from "@/server/services/page-templates";

type Tx = Prisma.TransactionClient;

// Mensagens em weights.ts: a tela reconhece as de lista desatualizada (isStaleVariantsError) e recarrega.
export { LAST_VARIANT, LIST_CHANGED, TOO_MANY_VARIANTS, WEIGHTS_CHANGED };
/** Copiar documentos grandes (projeto do editor, páginas clonadas) pode passar dos 5 s padrão. */
const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 };

// ─── Leitura ─────────────────────────────────────────────────────────────────

export interface VariantDocumentView {
  id: string;
  device: DeviceTarget;
}

export interface VariantView {
  id: string;
  name: string;
  label: string | null;
  isControl: boolean;
  /** Percentual do tráfego no divisor (0–100). */
  weight: number;
  position: number;
  /**
   * Pasta da versão no ZIP, como o "Baixar ZIP" monta ("oferta-b/",
   * "upsell/oferta-b/", "oferta-b-2/" quando "oferta-b" já é o endereço de
   * outra página; com uma versão só, a pasta da página: "" = raiz).
   */
  zipDir: string;
  /** Documentos (ALL, ou DESKTOP + MOBILE nas páginas com versão celular separada). */
  documents: VariantDocumentView[];
  /** Documento que abre no editor: o único, ou a versão computador. */
  documentId: string | null;
  /** Versão celular separada (quando existe junto com a de computador). */
  mobileDocumentId: string | null;
  /** Última alteração (da versão ou de um documento dela), ISO. */
  updatedAt: string;
}

export interface PageVariantsView {
  page: {
    id: string;
    name: string;
    slug: string;
    offerId: string;
    isHome: boolean;
    cloneMode: "EDITABLE" | "PRESERVE_JS";
  };
  /** Na ordem da lista (posição). */
  variants: VariantView[];
  /** Letra da próxima versão (null quando já há 5). */
  nextName: VariantName | null;
  maxVariants: number;
}

const DEVICE_ORDER: Record<DeviceTarget, number> = { ALL: 0, DESKTOP: 1, MOBILE: 2 };

/** Documento que abre no editor e a versão celular separada (mesma regra da lista de páginas). */
export function mainDocuments(documents: readonly VariantDocumentView[]) {
  const main = documents.find((d) => d.device === "ALL") ?? documents.find((d) => d.device === "DESKTOP");
  const mobile = documents.find((d) => d.device === "MOBILE");
  return {
    documentId: (main ?? mobile)?.id ?? null,
    mobileDocumentId: main && mobile ? mobile.id : null,
  };
}

/** Pasta de cada versão da página no ZIP (a mesma regra do "Baixar ZIP": planLayout). */
async function variantZipDirs(offerId: string, pageId: string): Promise<Record<string, string>> {
  const pages = await prisma.page.findMany({
    where: { offerId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      type: true,
      isHome: true,
      position: true,
      cloneMode: true,
      variants: {
        select: {
          id: true,
          name: true,
          label: true,
          isControl: true,
          weight: true,
          position: true,
          documents: { select: { id: true, device: true } },
        },
      },
    },
  });
  return variantDirs(pages, pageId);
}

/** Versões da página, com os documentos de cada uma (tela "Teste A/B"). */
export async function listVariants(pageId: string): Promise<PageVariantsView> {
  const page = await prisma.page.findFirst({
    where: { id: pageId, offer: { deletedAt: null } },
    select: {
      id: true,
      name: true,
      slug: true,
      offerId: true,
      isHome: true,
      cloneMode: true,
      variants: {
        orderBy: [{ position: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          label: true,
          isControl: true,
          weight: true,
          position: true,
          updatedAt: true,
          documents: { select: { id: true, device: true, updatedAt: true } },
        },
      },
    },
  });
  if (!page) throw new UserError(PAGE_NOT_FOUND);
  const { variants, ...info } = page;
  const zipDirs = await variantZipDirs(page.offerId, page.id);
  return {
    page: info,
    variants: variants.map((v) => {
      const documents = [...v.documents]
        .sort((a, b) => DEVICE_ORDER[a.device] - DEVICE_ORDER[b.device])
        .map(({ id, device }) => ({ id, device }));
      const updatedAt = Math.max(v.updatedAt.getTime(), ...v.documents.map((d) => d.updatedAt.getTime()));
      return {
        id: v.id,
        name: v.name,
        label: v.label,
        isControl: v.isControl,
        weight: v.weight,
        position: v.position,
        zipDir: zipDirs[v.id] ?? "",
        documents,
        ...mainDocuments(documents),
        updatedAt: new Date(updatedAt).toISOString(),
      };
    }),
    nextName: nextVariantName(variants.map((v) => v.name)),
    maxVariants: MAX_VARIANTS,
  };
}

/** Oferta e página de uma versão (para o link de prévia). */
export async function variantPreviewTarget(variantId: string) {
  const variant = await prisma.pageVariant.findFirst({
    where: { id: variantId, page: { offer: { deletedAt: null } } },
    select: { id: true, pageId: true, page: { select: { offerId: true } } },
  });
  if (!variant) throw new UserError(VARIANT_NOT_FOUND);
  return { offerId: variant.page.offerId, pageId: variant.pageId, variantId: variant.id };
}

/** Uma versão para escolher numa lista (tela "Testar pixels"). */
export interface VariantChoice {
  id: string;
  name: string;
  label: string | null;
  isControl: boolean;
}

/**
 * Versões de cada página da oferta, na ordem do "Teste A/B" (pageId → versões).
 * Oferta inexistente ou na lixeira → {}.
 */
export async function offerVariantChoices(offerId: string): Promise<Record<string, VariantChoice[]>> {
  const rows = await prisma.pageVariant.findMany({
    where: { page: { offerId, offer: { deletedAt: null } } },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: { id: true, name: true, label: true, isControl: true, pageId: true },
  });
  const byPage: Record<string, VariantChoice[]> = {};
  for (const { pageId, ...choice } of rows) {
    byPage[pageId] = [...(byPage[pageId] ?? []), choice];
  }
  return byPage;
}

// ─── Ajudantes das transações ────────────────────────────────────────────────

/**
 * Trava a página até o fim da transação: duas mudanças nas versões da mesma
 * página (duas abas, dois cliques) nunca se cruzam.
 */
async function lockPage(tx: Tx, pageId: string) {
  const rows = await tx.$queryRaw<{ id: string; offerId: string }[]>`
    select p.id, p."offerId" from "Page" p join "Offer" o on o.id = p."offerId"
    where p.id = ${pageId} and o."deletedAt" is null
    for update of p`;
  if (!rows.length) throw new UserError(PAGE_NOT_FOUND);
  return rows[0];
}

function variantsOf(tx: Tx, pageId: string) {
  return tx.pageVariant.findMany({
    where: { pageId },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: { id: true, name: true, isControl: true, weight: true, position: true },
  });
}

/** Página da versão (fora da transação; a transação confere de novo depois de travar). */
async function pageOfVariant(variantId: string) {
  const variant = await prisma.pageVariant.findFirst({
    where: { id: variantId, page: { offer: { deletedAt: null } } },
    select: { pageId: true },
  });
  if (!variant) throw new UserError(VARIANT_NOT_FOUND);
  return variant.pageId;
}

async function touch(tx: Tx, page: { id: string; offerId: string }) {
  const now = new Date();
  await tx.page.update({ where: { id: page.id }, data: { updatedAt: now } });
  await tx.offer.update({ where: { id: page.offerId }, data: { updatedAt: now } });
}

/** Nome opcional da versão: sem espaços sobrando; vazio = sem nome. */
export function cleanVariantLabel(label: string | null | undefined): string | null {
  const clean = (label ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (clean.length > VARIANT_LABEL_MAX) {
    throw new UserError(`O nome da versão pode ter no máximo ${VARIANT_LABEL_MAX} caracteres.`, "label");
  }
  return clean;
}

// ─── Criar ───────────────────────────────────────────────────────────────────

/** De onde vem o conteúdo da versão nova. */
export type VariantSource =
  /** Cópia de uma versão da página (padrão: a de controle), com todos os documentos. */
  | { kind: "copy"; variantId?: string | null }
  /** Modelo de página inteira (src/editor/templates); sem modelo, página em branco. */
  | { kind: "template"; templateId?: string | null };

export interface CreateVariantInput {
  pageId: string;
  source?: VariantSource;
  label?: string | null;
}

export interface CreatedVariant {
  id: string;
  name: string;
  /** Documento que abre no editor. */
  documentId: string | null;
}

/**
 * Cria a próxima versão (B, C…). A nova entra na divisão por igual com as
 * versões ativas; as pausadas (0%) continuam pausadas (weightsAfterCreate). A
 * tela mostra os percentuais para ajustar na hora.
 */
export async function createVariant(input: CreateVariantInput): Promise<CreatedVariant> {
  const label = cleanVariantLabel(input.label);
  const source: VariantSource = input.source ?? { kind: "copy" };
  const info = await prisma.page.findFirst({
    where: { id: input.pageId, offer: { deletedAt: null } },
    select: { name: true },
  });
  if (!info) throw new UserError(PAGE_NOT_FOUND);
  // Modelo validado e montado antes de travar a página.
  const fromTemplate = source.kind === "template" ? pageStart(source.templateId ?? null, info.name) : null;

  const created = await prisma.$transaction(async (tx) => {
    const page = await lockPage(tx, input.pageId);
    const variants = await variantsOf(tx, page.id);
    if (variants.length >= MAX_VARIANTS) throw new UserError(TOO_MANY_VARIANTS);
    const name = nextVariantName(variants.map((v) => v.name));
    if (!name) throw new UserError(TOO_MANY_VARIANTS);

    let documents: Prisma.PageDocumentCreateWithoutVariantInput[];
    if (fromTemplate) {
      documents = [{ device: "ALL", html: fromTemplate.html }];
    } else {
      const wanted = source.kind === "copy" ? source.variantId : null;
      const from = wanted ? variants.find((v) => v.id === wanted) : (variants.find((v) => v.isControl) ?? variants[0]);
      if (wanted && !from) {
        throw new UserError(COPY_SOURCE_GONE, "source");
      }
      const docs = from
        ? await tx.pageDocument.findMany({
            where: { variantId: from.id },
            select: { device: true, html: true, project: true, assetMap: true, editableHtml: true },
          })
        : [];
      documents = docs.map((d) => ({
        device: d.device,
        html: d.html,
        project: d.project,
        // "Preservar JS": arquivos nos caminhos originais (sem isso, 404 na cópia).
        assetMap: d.assetMap ?? Prisma.JsonNull,
        editableHtml: d.editableHtml,
        revision: 0,
      }));
      if (!documents.length) documents = [{ device: "ALL", html: pageStart(null, info.name).html }];
    }

    const split = weightsAfterCreate(variants.map((v) => v.weight));
    for (const [i, v] of variants.entries()) {
      if (v.weight !== split.weights[i] || v.position !== i) {
        await tx.pageVariant.update({ where: { id: v.id }, data: { weight: split.weights[i], position: i } });
      }
    }
    const variant = await tx.pageVariant.create({
      data: {
        pageId: page.id,
        name,
        label,
        // Página sem versões (não deveria acontecer): a nova é o controle.
        isControl: !variants.some((v) => v.isControl),
        weight: split.created,
        position: variants.length,
        documents: { create: documents },
      },
      select: { id: true, name: true, documents: { select: { id: true, device: true } } },
    });
    await touch(tx, page);
    return variant;
  }, TX_OPTIONS);

  return { id: created.id, name: created.name, documentId: mainDocuments(created.documents).documentId };
}

// ─── Alterar ─────────────────────────────────────────────────────────────────

/** Dá (ou tira) o nome opcional da versão, ex.: "Headline nova". */
export async function renameVariant(input: { variantId: string; label: string | null }) {
  const label = cleanVariantLabel(input.label);
  const pageId = await pageOfVariant(input.variantId);
  await prisma.$transaction(async (tx) => {
    const page = await lockPage(tx, pageId);
    const { count } = await tx.pageVariant.updateMany({ where: { id: input.variantId, pageId }, data: { label } });
    if (!count) throw new UserError(VARIANT_NOT_FOUND);
    await touch(tx, page);
  });
  return { pageId };
}

/**
 * Escolhe a versão de controle (a original do teste: é ela que fica no
 * index.html da página quando o ZIP sai sem o divisor).
 */
export async function setControlVariant(variantId: string) {
  const pageId = await pageOfVariant(variantId);
  await prisma.$transaction(async (tx) => {
    const page = await lockPage(tx, pageId);
    const variants = await variantsOf(tx, pageId);
    const target = variants.find((v) => v.id === variantId);
    if (!target) throw new UserError(VARIANT_NOT_FOUND);
    if (target.isControl && variants.filter((v) => v.isControl).length === 1) return;
    await tx.pageVariant.updateMany({ where: { pageId, isControl: true }, data: { isControl: false } });
    await tx.pageVariant.update({ where: { id: variantId }, data: { isControl: true } });
    await touch(tx, page);
  });
  return { pageId };
}

export interface VariantWeightInput {
  variantId: string;
  weight: number;
  /**
   * Percentual salvo que a tela mostrava quando a pessoa começou a mexer.
   * Diferente do banco = outra aba ou janela mudou a divisão nesse meio-tempo:
   * recusa (WEIGHTS_CHANGED) em vez de sobrescrever sem avisar. Omitido = não confere.
   */
  saved?: number | null;
}

/** Percentuais do divisor: todas as versões da página, inteiros de 0 a 100, somando 100. */
export async function setVariantWeights(input: { pageId: string; weights: VariantWeightInput[] }) {
  await prisma.$transaction(async (tx) => {
    const page = await lockPage(tx, input.pageId);
    const variants = await variantsOf(tx, page.id);
    const byId = new Map(input.weights.map((w) => [w.variantId, w]));
    if (byId.size !== input.weights.length || byId.size !== variants.length || variants.some((v) => !byId.has(v.id))) {
      throw new UserError(LIST_CHANGED);
    }
    if (
      variants.some((v) => {
        const saved = byId.get(v.id)?.saved;
        return saved !== undefined && saved !== null && saved !== v.weight;
      })
    ) {
      throw new UserError(WEIGHTS_CHANGED);
    }
    const weights = variants.map((v) => byId.get(v.id)?.weight as number);
    const problem = weightsProblem(weights);
    if (problem) throw new UserError(problem, "weights");
    for (const [i, v] of variants.entries()) {
      if (v.weight !== weights[i]) {
        await tx.pageVariant.update({ where: { id: v.id }, data: { weight: weights[i] } });
      }
    }
    await touch(tx, page);
  });
}

// ─── Excluir ─────────────────────────────────────────────────────────────────

export interface DeletedVariant {
  pageId: string;
  name: string;
  /** Letra da versão que virou o controle (quando a excluída era o controle). */
  promoted: string | null;
}

/**
 * Exclui uma versão (nunca a última). O percentual dela vai para as outras, na
 * proporção de cada uma; se era o controle, passa a ser a que ficar com o maior
 * percentual (afterDelete). O histórico de versões dos documentos dela sai do disco.
 */
export async function deleteVariant(variantId: string): Promise<DeletedVariant> {
  const pageId = await pageOfVariant(variantId);
  const result = await prisma.$transaction(async (tx) => {
    const page = await lockPage(tx, pageId);
    const variants = await variantsOf(tx, pageId);
    const target = variants.find((v) => v.id === variantId);
    if (!target) throw new UserError(VARIANT_NOT_FOUND);
    if (variants.length <= 1) throw new UserError(LAST_VARIANT);
    const documentIds = (await tx.pageDocument.findMany({ where: { variantId }, select: { id: true } })).map(
      (d) => d.id,
    );
    await tx.pageVariant.delete({ where: { id: variantId } });

    const { rest, weights, control: chosen } = afterDelete(variants, variantId);
    const control = chosen ?? rest[0];
    for (const [i, v] of rest.entries()) {
      const isControl = v.id === control.id;
      if (v.weight !== weights[i] || v.position !== i || v.isControl !== isControl) {
        await tx.pageVariant.update({ where: { id: v.id }, data: { weight: weights[i], position: i, isControl } });
      }
    }
    await touch(tx, page);
    return { name: target.name, promoted: control.isControl ? null : control.name, documentIds };
  });
  await removeVersionFiles(result.documentIds);
  return { pageId, name: result.name, promoted: result.promoted };
}
