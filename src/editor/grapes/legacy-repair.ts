/**
 * Reparo, ao abrir, de páginas gravadas antes das correções de <noscript> e de
 * ids repetidos (o servidor diz o que reparar: src/lib/legacy-repair.ts).
 *
 * - Regras que vieram de um <style> dentro de <noscript> saem do CSS do editor
 *   (só as que continuam exatamente como vieram; uma regra que a pessoa editou
 *   fica).
 * - Ids renomeados ("comprar-2") voltam a ser repetidos de "comprar": o elemento
 *   ganha a marca data-os-dup-id e o salvar põe o id original de volta. O id do
 *   editor ("comprar-2") continua sendo o dele (as edições feitas nele valem).
 */
import type { Component, Editor } from "grapesjs";
import { DUP_ID_ATTR } from "@/lib/dup-ids";
import type { LegacyRepair } from "@/lib/legacy-repair";

interface ParsedRule {
  selectors?: string[];
  selectorsAdd?: string;
  state?: string;
  mediaText?: string;
  atRuleType?: string;
  style?: Record<string, unknown>;
}

interface RuleModel {
  get(key: string): unknown;
  getSelectors(): { map<T>(fn: (s: { getFullName(): string }) => T): T[] };
  getStyle(): Record<string, unknown>;
}

function sameStyle(a: Record<string, unknown>, b: Record<string, unknown>) {
  const keys = Object.keys(a).filter((k) => a[k] !== "" && a[k] !== undefined);
  const other = Object.keys(b).filter((k) => b[k] !== "" && b[k] !== undefined);
  return keys.length === other.length && keys.every((k) => String(a[k]) === String(b[k]));
}

function matches(rule: RuleModel, parsed: ParsedRule) {
  const selectors = rule
    .getSelectors()
    .map((s) => s.getFullName())
    .sort();
  const wanted = (parsed.selectors ?? []).map((s) => (s.startsWith("#") ? s : `.${s}`)).sort();
  if (selectors.length !== wanted.length || selectors.some((s, i) => s !== wanted[i])) return false;
  const text = (key: string) => String(rule.get(key) ?? "");
  const atRule = parsed.atRuleType || (parsed.mediaText ? "media" : "");
  return (
    text("selectorsAdd") === (parsed.selectorsAdd ?? "") &&
    text("state") === (parsed.state ?? "") &&
    text("mediaText") === (parsed.mediaText ?? "") &&
    text("atRuleType") === atRule &&
    sameStyle(rule.getStyle(), parsed.style ?? {})
  );
}

/** Aplica o reparo. Devolve true se algo mudou (a página precisa ser gravada). */
export function applyLegacyRepair(editor: Editor, repair: LegacyRepair | null | undefined): boolean {
  if (!repair) return false;
  let changed = false;

  const renamed = repair.dupIds ?? {};
  if (Object.keys(renamed).length) {
    // Pelo modelo (não pelo canvas): vale antes de a página ser desenhada.
    const visit = (component: Component) => {
      const attrs = (component.get("attributes") ?? {}) as Record<string, unknown>;
      const id = typeof attrs.id === "string" ? attrs.id : "";
      const original = id ? renamed[id] : undefined;
      if (original && attrs[DUP_ID_ATTR] === undefined) {
        component.addAttributes({ [DUP_ID_ATTR]: original });
        changed = true;
      }
      for (const child of component.components().models) visit(child);
    };
    const wrapper = editor.getWrapper();
    if (wrapper) visit(wrapper);
  }

  for (const css of repair.noscriptCss ?? []) {
    let parsed: ParsedRule[] = [];
    try {
      parsed = editor.Parser.parseCss(css) as unknown as ParsedRule[];
    } catch {
      parsed = [];
    }
    for (const node of parsed) {
      const rules = editor.Css.getAll().models as unknown as RuleModel[];
      const rule = rules.find((r) => matches(r, node));
      if (!rule) continue;
      editor.Css.remove(rule as never);
      changed = true;
    }
  }
  return changed;
}
