/**
 * Copiar/colar elementos ENTRE páginas (Ctrl+C numa página, Ctrl+V noutra).
 *
 * Cada página abre num editor próprio (rota /editor/<documentId>), recriado a
 * cada troca — então o clipboard em memória do GrapesJS (que faz o copiar/colar
 * DENTRO da mesma página) não passa de uma página para outra. Aqui guardamos o
 * elemento num clipboard próprio no `localStorage` (compartilhado por todas as
 * páginas da origem) com o HTML + TODO o CSS que o estiliza — as edições
 * (`componentCss`) e as regras originais da página clonada (`originalComponentCss`,
 * folha @layer os-original). As imagens (`/os-assets/<hash>`) são globais por
 * hash: vão junto só pela referência.
 *
 * Ao colar, geramos IDS NOVOS (sem colidir com a página de destino) e reescrevemos
 * as regras `#id`/`[data-os-eid]` para os ids novos; inserimos `<style>…</style>` +
 * HTML, e o GrapesJS move o <style> para o CSS da página (mesmo caminho do
 * "Código"). Sobrepomos os comandos `core:copy`/`core:paste` (o "Duplicar" e o
 * colar dentro da mesma página continuam no nativo; só o colar vindo de outra
 * página — clipboard nativo vazio — usa o nosso).
 */
import type { Component, Editor } from "grapesjs";
import { componentCss } from "@/editor/widgets/dom";
import { asSingleUndoStep, keepReferencedMarks, toEditorHtml, toReadableHtml } from "./element-html";
import { originalComponentCss } from "./original-css";

/** Clipboard entre páginas (por origem, como as outras preferências do editor). */
export const CLIPBOARD_KEY = "offerstudio.editor.clipboard";

interface ClipboardPayload {
  v: 1;
  ts: number;
  html: string;
  css: string;
}

let idCounter = 0;
/** Id novo, improvável de colidir com a página de destino. */
function freshId(): string {
  idCounter += 1;
  return `oc${idCounter}${Math.random().toString(36).slice(2, 8)}`;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Troca os ids do HTML e das regras de CSS por ids novos (mesma troca nos dois),
 * para a colagem não colidir com a página de destino e os estilos `#id`/
 * `[data-os-eid]` (inclusive `:hover`/@media) continuarem valendo. Puro.
 */
export function remapIds(html: string, css: string): { html: string; css: string } {
  const ids = new Set<string>();
  for (const m of html.matchAll(/\b(?:id|data-os-eid)\s*=\s*"([^"]+)"/g)) ids.add(m[1]);
  for (const m of html.matchAll(/\b(?:id|data-os-eid)\s*=\s*'([^']+)'/g)) ids.add(m[1]);
  if (!ids.size) return { html, css };
  let h = html;
  let c = css;
  for (const old of ids) {
    const neu = freshId();
    const e = escapeRe(old);
    h = h.replace(new RegExp(`(\\b(?:id|data-os-eid)\\s*=\\s*["'])${e}(["'])`, "g"), `$1${neu}$2`);
    c = c.replace(new RegExp(`#${e}(?![\\w-])`, "g"), `#${neu}`);
    c = c.replace(new RegExp(`(\\[\\s*data-os-eid\\s*[~|^$*]?=\\s*["']?)${e}(["']?\\s*\\])`, "g"), `$1${neu}$2`);
  }
  return { html: h, css: c };
}

/** Serializa a seleção (HTML real + CSS: original primeiro, edições depois). null = nada selecionado. */
function serializeSelection(editor: Editor): ClipboardPayload | null {
  const getAll = (editor as { getSelectedAll?: () => Component[] }).getSelectedAll;
  const all = typeof getAll === "function" ? getAll.call(editor) : [];
  const comps = (all.length ? all : [editor.getSelected()]).filter(Boolean) as Component[];
  const wrapper = editor.getWrapper();
  const doc = editor.Canvas.getDocument();
  const htmls: string[] = [];
  const originalCss: string[] = [];
  const editCss: string[] = [];
  for (const c of comps) {
    if (c === wrapper) continue; // nunca copia o corpo inteiro
    htmls.push(toReadableHtml(c.toHTML()));
    const el = c.getEl();
    if (el && doc) {
      const orig = originalComponentCss(el, doc);
      if (orig) originalCss.push(orig);
    }
    const edit = componentCss(editor, c);
    if (edit) editCss.push(edit);
  }
  if (!htmls.length) return null;
  return { v: 1, ts: Date.now(), html: htmls.join("\n"), css: [...originalCss, ...editCss].join("\n") };
}

/** Ctrl+C: guarda a seleção no clipboard entre páginas (além do nativo). */
export function copySelection(editor: Editor): void {
  try {
    if ((editor as { getEditing?: () => unknown }).getEditing?.()) return; // editando texto: copiar é do texto
    const payload = serializeSelection(editor);
    if (!payload) return;
    localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(payload));
  } catch {
    // localStorage indisponível (janela privada, bloqueado): copiar entre páginas fica desligado.
  }
}

/** Insere o HTML colado depois do elemento selecionado (ou no fim da página). */
function insertPaste(editor: Editor, html: string): Component | undefined {
  const sel = editor.getSelected();
  const wrapper = editor.getWrapper();
  let added: Component[] | Component | undefined;
  const parent = sel && sel !== wrapper ? (sel.parent() as Component | undefined) : undefined;
  if (sel && parent) {
    const coll = parent.components();
    const at = coll.indexOf(sel) + 1;
    added = coll.add(html, { at } as never) as Component[] | Component;
  } else if (wrapper) {
    added = wrapper.append(html) as Component[] | Component;
  }
  const list = Array.isArray(added) ? added : added ? [added] : [];
  return list[list.length - 1];
}

/** Ctrl+V vindo de outra página: recria o elemento (ids novos) com o estilo. true = colou. */
export function pasteFromClipboard(editor: Editor): boolean {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(CLIPBOARD_KEY);
  } catch {
    return false;
  }
  if (!raw) return false;
  let payload: ClipboardPayload;
  try {
    payload = JSON.parse(raw) as ClipboardPayload;
  } catch {
    return false;
  }
  if (!payload || payload.v !== 1 || !payload.html) return false;
  const { html, css } = remapIds(payload.html, payload.css || "");
  const blob = (css.trim() ? `<style>${css}</style>` : "") + html;
  const safe = toEditorHtml(blob, document);
  asSingleUndoStep(editor, () => {
    const added = insertPaste(editor, safe);
    // Um <style> colado pode mirar a marca de um repetido: fixa a marca no elemento.
    keepReferencedMarks(editor);
    if (added) {
      editor.select(added);
      try {
        editor.Canvas.scrollTo(added, { behavior: "smooth" } as never);
      } catch {
        // scrollTo pode não existir em todas as versões
      }
    }
  });
  return true;
}

/** Sobrepõe core:copy/core:paste: dentro da página segue o nativo; entre páginas usa o nosso. */
export function installPageClipboard(editor: Editor): void {
  const commands = editor.Commands;
  const prevCopy = commands.get("core:copy");
  const prevPaste = commands.get("core:paste");
  const delegate = (cmd: unknown, sender: unknown, opts: unknown) => {
    const fn = typeof cmd === "function" ? cmd : (cmd as { run?: (...a: unknown[]) => unknown })?.run;
    return typeof fn === "function" ? fn.call(cmd, editor, sender, opts) : undefined;
  };
  commands.add("core:copy", {
    run(ed: Editor, sender: unknown, opts: unknown) {
      const result = delegate(prevCopy, sender, opts);
      copySelection(ed);
      return result;
    },
  });
  commands.add("core:paste", {
    run(ed: Editor, sender: unknown, opts: unknown) {
      const editing = (ed as { getEditing?: () => unknown }).getEditing?.();
      const model = (ed as { getModel?: () => { get?: (k: string) => unknown } }).getModel?.();
      const native = model?.get?.("clipboard") as unknown[] | undefined;
      // Editando texto ou com algo copiado NESTA página: comportamento nativo (inclui o "Duplicar").
      if (editing || native?.length) return delegate(prevPaste, sender, opts);
      pasteFromClipboard(ed);
      return undefined;
    },
  });
}
