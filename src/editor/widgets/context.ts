/**
 * Dados da oferta que os widgets usam dentro do editor: links da oferta
 * (checkout, WhatsApp…) e páginas do funil. O editor informa com
 * setWidgetContext logo depois de criar o GrapesJS; sem isso, as listas ficam
 * vazias e nada quebra.
 */
import type { Editor } from "grapesjs";

export interface WidgetLink {
  key: string;
  label: string;
  /** CHECKOUT | UPSELL | DOWNSELL | WHATSAPP | OTHER */
  kind?: string;
}

export interface WidgetPage {
  id: string;
  name: string;
  slug?: string;
  /** Tipo da página (LEGAL, THANK_YOU…), quando conhecido. */
  type?: string;
}

export interface WidgetContext {
  links: WidgetLink[];
  pages: WidgetPage[];
}

const contexts = new WeakMap<Editor, () => WidgetContext>();

export function setWidgetContext(editor: Editor, getter: () => WidgetContext) {
  contexts.set(editor, getter);
}

export function widgetContext(editor: Editor | undefined): WidgetContext {
  const getter = editor && contexts.get(editor);
  return getter ? getter() : { links: [], pages: [] };
}

/** Página do funil para "Termos de uso" / "Política de privacidade". */
export function findLegalPage(pages: WidgetPage[], which: "terms" | "privacy"): WidgetPage | undefined {
  const re = which === "terms" ? /termo|terms|uso/i : /privacidade|privacy|lgpd|dados/i;
  const named = pages.filter((p) => re.test(`${p.name} ${p.slug ?? ""}`));
  return named.find((p) => p.type === "LEGAL") ?? named[0];
}
