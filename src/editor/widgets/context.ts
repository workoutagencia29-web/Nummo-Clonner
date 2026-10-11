/**
 * Dados da oferta que os widgets usam dentro do editor: links da oferta
 * (checkout, WhatsApp…), páginas do funil e a moeda da oferta. O editor
 * informa com setWidgetContext logo depois de criar o GrapesJS; sem isso, as
 * listas ficam vazias, a moeda é o real e nada quebra.
 */
import type { Editor } from "grapesjs";
import type { StoreCurrency } from "@/lib/store";

export interface WidgetLink {
  key: string;
  label: string;
  /** CHECKOUT | UPSELL | DOWNSELL | WHATSAPP | OTHER */
  kind?: string;
  /** Endereço atual (vazio = link ainda sem endereço). */
  url?: string;
  /** "Pagamento na página" com produto (resumo): o link tem destino mesmo sem endereço. */
  payment?: string | null;
  /** "Checkout do Offer Studio" (resumo do produto; "" = sem produto salvo). Na fase 1 ainda não leva a lugar nenhum. */
  checkout?: string | null;
  /** Idioma do produto (pagamento na página ou checkout do Offer Studio: es/en/pt): o bloco "Acesso ao produto" nasce nele. */
  paymentLocale?: string | null;
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
  /**
   * Moeda da oferta (src/lib/offer-currency.ts): blocos com preço soltos na
   * página (vitrines, caixa de compra) nascem nela. Sem ela: real.
   */
  currency?: StoreCurrency;
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
