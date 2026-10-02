/**
 * Reparo de páginas abertas no editor ANTES de duas correções da Fase 3:
 *
 * - <style> dentro de <noscript> virava CSS do editor (regra de todo visitante):
 *   o WP Rocket esconde o vídeo e as imagens lazy (`display:none !important`).
 *   O <noscript> ficou vazio no projeto, então a página não se corrige sozinha.
 * - ids repetidos eram renomeados ("comprar" → "comprar-2"): o repetido perdia
 *   o CSS #comprar da página, as âncoras e os scripts.
 *
 * O servidor compara o projeto com a "Versão original" (o HTML de antes da
 * primeira abertura) e manda para o editor o que reparar
 * (src/editor/grapes/legacy-repair.ts faz o reparo e grava).
 *
 * Só projetos gravados pelo editor antigo passam por aqui: toda gravação do
 * editor corrigido marca o projeto (`withProjectFormat`), e um projeto marcado
 * nunca é reparado — um id de verdade como "oferta-2", ou a cópia "comprar-2"
 * feita com Duplicar, não é confundido com uma renomeação antiga. Projetos sem a
 * marca (editor antigo, ou o corrigido antes de a marca existir) só têm um
 * "<id>-N" reparado quando o elemento é o mesmo que o editor antigo renomeou
 * (mesma tag e classes), o id original não tem repetidos marcados e a página
 * original não tinha um "<id>-N" de verdade igual por fora (aí nada separa os
 * dois, nem o "<id>-N-2" que o editor antigo daria a ele: é também o nome da
 * cópia feita com Duplicar). Na dúvida, nada é renomeado.
 *
 * A versão "Antes do reparo automático" é gravada com a marca (createVersion,
 * `openAsIs`): restaurada, ela abre como estava, sem ser reparada de novo.
 */
import * as cheerio from "cheerio";
import { DUP_ID_ATTR } from "@/lib/dup-ids";

export interface LegacyRepair {
  /** Texto de cada <style> que estava dentro de um <noscript> na versão original. */
  noscriptCss: string[];
  /** Id renomeado pelo editor antigo ("comprar-2") → id original ("comprar"). */
  dupIds: Record<string, string>;
}

/**
 * Tag e classes de um elemento: a renomeação antiga só é reparada quando o
 * elemento do projeto é o mesmo que o editor antigo renomeou na página original.
 */
export interface ElementShape {
  /** Tag (minúscula). O projeto do GrapesJS não grava a tag padrão do tipo: aí fica sem. */
  tag?: string;
  /** Classes em ordem alfabética, separadas por espaço. */
  classes: string;
}

/** O que no projeto indica uma página aberta antes das correções. */
export interface LegacySignals {
  /** Há um <noscript> de verdade no projeto (hoje ele entra como os-noscript). */
  noscript: boolean;
  /** Ids "<id>-N" sem a marca de repetido (possíveis renomeações), com a tag e as classes do elemento. */
  suffixIds: Map<string, ElementShape>;
  /**
   * Ids que já têm repetidos marcados (data-os-dup-id): o projeto passou pelo
   * editor corrigido (antes da marca de formato), que nunca renomeia esses ids.
   */
  markedIds: Set<string>;
}

/** Chave do projeto (JSON do GrapesJS) que diz que ele foi gravado pelo editor corrigido. */
export const PROJECT_FORMAT_KEY = "osFormat";
export const PROJECT_FORMAT = 2;

/** Marca o projeto como gravado pelo editor corrigido (o GrapesJS ignora a chave ao abrir). */
export function withProjectFormat<T>(project: T): T {
  if (!project || typeof project !== "object" || Array.isArray(project)) return project;
  return { ...project, [PROJECT_FORMAT_KEY]: PROJECT_FORMAT };
}

function currentFormat(project: unknown) {
  if (!project || typeof project !== "object" || Array.isArray(project)) return false;
  const format = (project as Record<string, unknown>)[PROJECT_FORMAT_KEY];
  return typeof format === "number" && format >= PROJECT_FORMAT;
}

const SUFFIX_ID = /^(.+)-(\d+)$/;

function classList(values: unknown[]): string {
  const names = values.flatMap((value) => {
    if (typeof value === "string") return value.split(/\s+/);
    const name = value && typeof value === "object" ? (value as { name?: unknown }).name : undefined;
    return typeof name === "string" ? [name] : [];
  });
  return [...new Set(names.filter(Boolean))].sort().join(" ");
}

/** Tag e classes de um componente do projeto (classes em `classes` ou no atributo class). */
function componentShape(obj: Record<string, unknown>, attrs: Record<string, unknown>): ElementShape {
  const classes = [...(Array.isArray(obj.classes) ? obj.classes : []), attrs.class];
  const tag = typeof obj.tagName === "string" && obj.tagName ? obj.tagName.toLowerCase() : undefined;
  return { tag, classes: classList(classes) };
}

function sameElement(project: ElementShape, original: Required<ElementShape>) {
  return project.classes === original.classes && (project.tag === undefined || project.tag === original.tag);
}

export function legacySignals(project: unknown): LegacySignals {
  const signals: LegacySignals = { noscript: false, suffixIds: new Map(), markedIds: new Set() };
  if (currentFormat(project)) return signals;
  const seen = new Set<unknown>();
  const visit = (node: unknown, depth: number) => {
    if (!node || typeof node !== "object" || depth > 400 || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (typeof obj.tagName === "string" && obj.tagName.toLowerCase() === "noscript") signals.noscript = true;
    const attrs = obj.attributes;
    if (attrs && typeof attrs === "object" && !Array.isArray(attrs)) {
      const a = attrs as Record<string, unknown>;
      const dup = a[DUP_ID_ATTR];
      if (typeof dup === "string" && dup) signals.markedIds.add(dup);
      else if (dup === undefined && typeof a.id === "string" && SUFFIX_ID.test(a.id)) {
        signals.suffixIds.set(a.id, componentShape(obj, a));
      }
    }
    for (const [key, value] of Object.entries(obj)) {
      // As regras de CSS (styles) não têm componentes.
      if (key !== "styles" || depth > 0) visit(value, depth + 1);
    }
  };
  visit(project, 0);
  return signals;
}

export function hasLegacySignals(signals: LegacySignals) {
  return signals.noscript || signals.suffixIds.size > 0;
}

/** CSS de cada <style> dentro de <noscript> (o conteúdo de <noscript> é texto para o cheerio). */
function noscriptStyles(html: string): string[] {
  const $ = cheerio.load(html);
  const out: string[] = [];
  $("noscript").each((_, el) => {
    const inner = cheerio.load($(el).html() ?? "");
    inner("style").each((_i, style) => {
      const text = inner(style).text();
      if (text.trim()) out.push(text);
    });
  });
  return out;
}

/**
 * Renomeações que o editor antigo fez nos ids repetidos da página original,
 * na ordem do documento (o 2º "comprar" virou "comprar-2", pulando nomes que já
 * existiam), com a tag e as classes do elemento renomeado.
 */
function renamedIds(html: string): Map<string, { original: string; shape: Required<ElementShape> }> {
  const $ = cheerio.load(html);
  const taken = new Set<string>();
  const renamed = new Map<string, { original: string; shape: Required<ElementShape> }>();
  $("body [id]").each((_, el) => {
    const id = $(el).attr("id");
    if (!id) return;
    if (!taken.has(id)) {
      taken.add(id);
      return;
    }
    let n = 2;
    while (taken.has(`${id}-${n}`)) n++;
    const next = `${id}-${n}`;
    taken.add(next);
    renamed.set(next, {
      original: id,
      shape: { tag: el.tagName.toLowerCase(), classes: classList([$(el).attr("class")]) },
    });
  });
  return renamed;
}

/** O que reparar, comparando os sinais do projeto com o HTML da versão original. null = nada. */
export function computeLegacyRepair(originalHtml: string, signals: LegacySignals): LegacyRepair | null {
  const repair: LegacyRepair = { noscriptCss: [], dupIds: {} };
  if (signals.noscript) repair.noscriptCss = noscriptStyles(originalHtml);
  if (signals.suffixIds.size) {
    const renames = renamedIds(originalHtml);
    for (const [renamed, { original, shape }] of renames) {
      const found = signals.suffixIds.get(renamed);
      // Repetidos de `original` já marcados: o editor corrigido abriu a página e
      // não renomeou esse id — "<id>-N" é um id de verdade (ou uma cópia).
      if (!found || signals.markedIds.has(original)) continue;
      // Outro elemento com esse id (ex.: o "oferta-2" de verdade da página, num
      // projeto do editor corrigido de antes da marca de formato, depois de o
      // repetido marcado ser excluído): não é a renomeação antiga.
      if (!sameElement(found, shape)) continue;
      // A página original também tem um "<id>-N" de verdade, que o editor antigo
      // renomeou (para "<id>-N-2") quando o repetido pegou o nome. Se ele é igual
      // por fora (tag e classes), nada no projeto separa os dois: o "<id>-N" pode
      // ser o elemento de verdade (projeto do editor corrigido de antes da marca,
      // com o repetido excluído), e um "<id>-N-2" pode ser a cópia dele feita com
      // Duplicar. Na dúvida, nada é renomeado: um reparo que falta só deixa a
      // página como estava; um errado tira o id do elemento de verdade.
      const displaced = [...renames].find(([, r]) => r.original === renamed);
      if (displaced && sameElement(found, displaced[1].shape)) continue;
      // Este é o "<id>-N" de verdade que perdeu o nome para um repetido: o nome
      // só volta para ele se a renomeação que o tomou for reparada (senão o
      // "<id>-N" do projeto continua sendo outro elemento).
      if (renames.has(original) && repair.dupIds[original] === undefined) continue;
      repair.dupIds[renamed] = original;
    }
  }
  return repair.noscriptCss.length || Object.keys(repair.dupIds).length ? repair : null;
}
