/**
 * "Próximos passos" da oferta: o que falta para ela sair pronta no ZIP (botões
 * de compra com o seu checkout, dados da empresa nas páginas legais, pixel,
 * ZIP baixado e o endereço onde está no ar). Regras puras, sem banco: o
 * servidor junta os dados (src/server/services/readiness.ts).
 */
import { COMPANY_PLACEHOLDERS, type Company } from "@/lib/offer-settings";
import { displayUrl } from "@/lib/text";

export type ReadinessId = "checkout" | "empresa" | "pixel" | "zip" | "no-ar";

/** Para onde o passo leva: uma aba da oferta ou o diálogo do ZIP. */
export type ReadinessTarget = { tab: "links" | "rastreamento" | "configuracoes" | "detalhes" } | { export: true };

export interface ReadinessItem {
  id: ReadinessId;
  title: string;
  detail: string;
  done: boolean;
  /** Recomendado, mas a oferta funciona sem ele. */
  optional: boolean;
  /** Rótulo do botão do passo. */
  cta: string;
  target: ReadinessTarget;
}

export interface Readiness {
  items: ReadinessItem[];
  /** Passos obrigatórios concluídos / total de passos obrigatórios. */
  done: number;
  total: number;
  /** Todos os obrigatórios prontos (o cartão some). */
  complete: boolean;
}

export interface ReadinessInput {
  /** HTML de todos os documentos das páginas (todas as versões A/B e o celular). */
  htmls: string[];
  /** Links da oferta (checkout, upsell…). */
  links: { key: string; url: string }[];
  /** Endereços de checkout encontrados na página original ao clonar. */
  clonedCheckoutUrls: string[];
  /** Pixels ligados. */
  pixelCount: number;
  company: Company;
  liveUrl: string | null;
  /** Data do último ZIP pronto (null = nunca). */
  lastZipAt: Date | null;
}

const LINK_RE = /\bdata-os-link\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]*))/gi;

/** Botões ligados a links da oferta: quantos existem e quantos levam a algum lugar. */
export function buyButtons(htmls: string[], links: { key: string; url: string }[]) {
  const withUrl = new Set(links.filter((l) => l.url.trim()).map((l) => l.key));
  let total = 0;
  let connected = 0;
  for (const html of htmls) {
    if (!html.includes("data-os-link")) continue;
    for (const m of html.matchAll(LINK_RE)) {
      const key = (m[1] ?? m[2] ?? m[3] ?? "").trim();
      total++;
      if (key && withUrl.has(key)) connected++;
    }
  }
  return { total, connected };
}

const COMPANY_FIELD_LABEL: Record<string, string> = {
  "{{EMPRESA}}": "nome",
  "{{CNPJ}}": "CNPJ/CPF",
  "{{EMAIL}}": "e-mail",
};

/** Marcadores obrigatórios da empresa ({{EMPRESA}}, {{CNPJ}}, {{EMAIL}}) usados nas páginas e ainda sem dado. */
export function missingCompanyFields(htmls: string[], company: Company) {
  const used = Object.keys(COMPANY_FIELD_LABEL).filter((marker) => htmls.some((h) => h.includes(marker)));
  const missing = used.filter((marker) => !COMPANY_PLACEHOLDERS[marker](company).trim());
  return { used: used.length > 0, missing: missing.map((m) => COMPANY_FIELD_LABEL[m]) };
}

function listPt(items: string[]) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} e ${items.at(-1)}`;
}

function normalizeUrl(url: string) {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

function checkoutItem(input: ReadinessInput): ReadinessItem {
  const base = { id: "checkout", cta: "Abrir links", target: { tab: "links" } } as const;
  const { total, connected } = buyButtons(input.htmls, input.links);
  if (total > connected) {
    const missing = total - connected;
    return {
      ...base,
      title: "Ligar os botões de compra",
      detail: `${missing === 1 ? "1 botão" : `${missing} de ${total} botões`} de compra ainda sem link: no ZIP, ${
        missing === 1 ? "ele não leva" : "eles não levam"
      } a lugar nenhum. Cadastre o checkout e ligue os botões no editor.`,
      done: false,
      optional: false,
    };
  }
  const cloned = new Set(input.clonedCheckoutUrls.map(normalizeUrl));
  const original = input.links.filter((l) => l.url.trim() && cloned.has(normalizeUrl(l.url)));
  if (original.length) {
    return {
      ...base,
      title: "Trocar o checkout da página original",
      detail: `${
        original.length === 1 ? "1 link ainda leva" : `${original.length} links ainda levam`
      } ao checkout da página que você clonou. Coloque o endereço do seu checkout.`,
      done: false,
      optional: false,
    };
  }
  if (total > 0) {
    return {
      ...base,
      title: "Checkout ligado",
      detail:
        total === 1
          ? "O botão de compra leva ao seu checkout."
          : `Os ${total} botões de compra levam aos links da oferta.`,
      done: true,
      optional: false,
    };
  }
  const withUrl = input.links.filter((l) => l.url.trim()).length;
  return {
    ...base,
    title: withUrl ? "Links da oferta cadastrados" : "Cadastrar o checkout",
    detail: withUrl
      ? "Para trocar o checkout em todas as páginas de uma vez, ligue os botões de compra a um link no editor."
      : "Nenhum botão de compra está ligado a um link da oferta. Cadastre o checkout e ligue os botões a ele no editor.",
    done: withUrl > 0,
    optional: true,
  };
}

function companyItem(input: ReadinessInput): ReadinessItem {
  const base = { id: "empresa", cta: "Preencher", target: { tab: "configuracoes" } } as const;
  const { used, missing } = missingCompanyFields(input.htmls, input.company);
  if (used && missing.length) {
    return {
      ...base,
      title: "Preencher os dados da empresa",
      detail: `As páginas ainda mostram marcadores como {{EMPRESA}} no lugar de: ${listPt(missing)}.`,
      done: false,
      optional: false,
    };
  }
  if (used) {
    return {
      ...base,
      title: "Dados da empresa preenchidos",
      detail: "A política e os termos saem com os seus dados.",
      done: true,
      optional: false,
    };
  }
  const filled = Boolean(input.company.name.trim());
  return {
    ...base,
    title: filled ? "Dados da empresa preenchidos" : "Dados da empresa",
    detail: filled
      ? "Usados na política de privacidade e nos termos de uso."
      : "Usados na política de privacidade e nos termos de uso, se você adicionar essas páginas.",
    done: filled,
    optional: true,
  };
}

function pixelItem(input: ReadinessInput): ReadinessItem {
  const n = input.pixelCount;
  return {
    id: "pixel",
    title: n ? (n === 1 ? "1 pixel ligado" : `${n} pixels ligados`) : "Adicionar um pixel",
    detail: n
      ? "As visitas e as compras chegam às plataformas de anúncio."
      : "Meta, TikTok, Google… para medir as vendas dos seus anúncios.",
    done: n > 0,
    optional: true,
    cta: n ? "Ver pixels" : "Adicionar",
    target: { tab: "rastreamento" },
  };
}

function zipItem(input: ReadinessInput, dateLabel: (d: Date) => string): ReadinessItem {
  return {
    id: "zip",
    title: input.lastZipAt ? "ZIP baixado" : "Baixar o ZIP",
    detail: input.lastZipAt
      ? `Último ZIP em ${dateLabel(input.lastZipAt)}. Baixe de novo depois de mudar as páginas.`
      : "O ZIP tem as páginas prontas para subir em qualquer hospedagem.",
    done: Boolean(input.lastZipAt),
    optional: false,
    // Não "Baixar ZIP": esse é o nome do botão principal ao lado do título.
    cta: input.lastZipAt ? "Gerar de novo" : "Gerar o ZIP",
    target: { export: true },
  };
}

function liveItem(input: ReadinessInput): ReadinessItem {
  const where = displayUrl(input.liveUrl);
  return {
    id: "no-ar",
    title: where ? "Endereço informado" : "Informar onde está no ar",
    detail: where
      ? `No ar em ${where}.`
      : "Depois de subir o ZIP, informe o endereço: ele completa a imagem de compartilhamento e o seu painel.",
    done: Boolean(where),
    optional: false,
    cta: where ? "Mudar" : "Informar",
    target: { tab: "detalhes" },
  };
}

export function computeReadiness(input: ReadinessInput, dateLabel: (d: Date) => string): Readiness {
  const items = [checkoutItem(input), companyItem(input), pixelItem(input), zipItem(input, dateLabel), liveItem(input)];
  const required = items.filter((i) => !i.optional);
  const done = required.filter((i) => i.done).length;
  return { items, done, total: required.length, complete: done === required.length };
}
