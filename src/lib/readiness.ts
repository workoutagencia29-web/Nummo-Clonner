/**
 * "Próximos passos" da oferta: o que falta para ela sair pronta no ZIP (botões
 * de compra com o seu checkout, prêmios da roleta com o checkout do desconto,
 * dados da empresa nas páginas legais, pixel, ZIP baixado e o endereço onde
 * está no ar). Regras puras, sem banco: o
 * servidor junta os dados (src/server/services/readiness.ts).
 */
import { COMPANY_PLACEHOLDERS, type Company } from "@/lib/offer-settings";
import { type PaymentCheck, paymentIssues } from "@/lib/payments/checks";
import { PROVIDER_LABEL } from "@/lib/payments/rules";
import { displayUrl } from "@/lib/text";
import { prizeGaps, WHEEL_MARK } from "@/lib/wheel-prizes";

export type ReadinessId = "checkout" | "roleta" | "pagamento" | "empresa" | "pixel" | "zip" | "no-ar";

/**
 * Para onde o passo leva: uma aba da oferta, o diálogo do ZIP, uma página no
 * editor, um link da oferta (aba "Links e checkouts", aberto nele) ou
 * Configurações → Pagamentos.
 */
export type ReadinessTarget =
  | { tab: "links" | "rastreamento" | "configuracoes" | "detalhes" }
  | { export: true }
  | { editor: string }
  | { link: string }
  | { settings: "pagamentos" };

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
  /**
   * Documentos com roleta de desconto (id e HTML), para o passo "roleta" abrir
   * a página certa no editor. Sem ele, o passo usa só `htmls` e leva aos links.
   */
  wheelDocs?: { id: string; html: string }[];
  /**
   * Links da oferta (checkout, upsell…). kind (CHECKOUT, UPSELL…): só os
   * botões ligados a um link do tipo checkout levam o prêmio da roleta.
   */
  links: { key: string; url: string; kind?: string | null; pay?: boolean }[];
  /** Endereços de checkout encontrados na página original ao clonar. */
  clonedCheckoutUrls: string[];
  /** Pixels ligados. */
  pixelCount: number;
  company: Company;
  liveUrl: string | null;
  /** Data do último ZIP pronto (null = nunca). */
  lastZipAt: Date | null;
  /** Pagamento na página (offerPaymentCheck; null/ausente = a oferta não tem). */
  payments?: PaymentCheck | null;
}

const LINK_RE = /\bdata-os-link\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]*))/gi;
/** Uma tag de abertura inteira (atributos com aspas podem ter ">"). */
const TAG_RE = /<[a-z][a-z0-9-]*(?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*\s*\/?>/gi;
const NEXT_PAGE_RE = /\sdata-os-(qz|wh)-go[\s=/>]/i;

/**
 * Valores de data-os-link das páginas. O botão final do quiz (data-os-qz-go) e
 * o "Resgatar" da roleta (data-os-wh-go) não são botões de compra: levam à
 * próxima página do funil (a falta de destino deles é avisada no ZIP e no
 * canvas, com o texto do quiz/roleta).
 */
function linkKeys(html: string): string[] {
  if (!html.includes("data-os-link")) return [];
  const key = (m: RegExpMatchArray) => (m[1] ?? m[2] ?? m[3] ?? "").trim();
  if (!html.includes("data-os-qz-go") && !html.includes("data-os-wh-go"))
    return Array.from(html.matchAll(LINK_RE), key);
  const keys: string[] = [];
  for (const [tag] of html.matchAll(TAG_RE)) {
    if (!tag.includes("data-os-link") || NEXT_PAGE_RE.test(tag)) continue;
    for (const m of tag.matchAll(LINK_RE)) keys.push(key(m));
  }
  return keys;
}

/**
 * Chaves de links da oferta nos botões que recebem o prêmio da roleta: os
 * botões de compra e o "Resgatar" (ligado a um checkout, ele leva ao checkout
 * do prêmio). O botão final do quiz fica de fora.
 */
function prizeButtonKeys(html: string): string[] {
  if (!html.includes("data-os-link")) return [];
  const keys: string[] = [];
  for (const [tag] of html.matchAll(TAG_RE)) {
    if (!tag.includes("data-os-link") || /\sdata-os-qz-go[\s=/>]/i.test(tag)) continue;
    for (const m of tag.matchAll(LINK_RE)) keys.push((m[1] ?? m[2] ?? m[3] ?? "").trim());
  }
  return keys;
}

/** O link leva a algum lugar: endereço preenchido ou pagamento na página (produto salvo). */
const hasDestination = (l: { url: string; pay?: boolean }) => Boolean(l.pay) || Boolean(l.url.trim());

/** Botões ligados a links da oferta: quantos existem e quantos levam a algum lugar. */
export function buyButtons(htmls: string[], links: { key: string; url: string; pay?: boolean }[]) {
  const withUrl = new Set(links.filter(hasDestination).map((l) => l.key));
  let total = 0;
  let connected = 0;
  for (const html of htmls) {
    for (const key of linkKeys(html)) {
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
  const original = input.links.filter((l) => !l.pay && l.url.trim() && cloned.has(normalizeUrl(l.url)));
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
  const withUrl = input.links.filter(hasDestination).length;
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

/** Roleta de desconto: cada prêmio com o seu checkout (null = a oferta não tem roleta). */
function wheelItem(input: ReadinessInput): ReadinessItem | null {
  const docs = input.wheelDocs ?? input.htmls.map((html) => ({ id: "", html }));
  const withWheel = docs.filter((d) => d.html.includes(WHEEL_MARK));
  if (!withWheel.length) return null;
  let target: ReadinessTarget = withWheel[0].id ? { editor: withWheel[0].id } : { tab: "links" };
  const missing: string[] = [];
  // Todos os prêmios que faltam já têm o link da oferta, só sem endereço: o passo leva à aba dos links.
  let onlyUrls = true;
  for (const doc of withWheel) {
    const gaps = prizeGaps(doc.html, input.links);
    if (gaps.length && !missing.length && doc.id) target = { editor: doc.id };
    for (const g of gaps) {
      if (!missing.includes(g.text)) missing.push(g.text);
      onlyUrls &&= g.linked;
    }
  }
  if (missing.length && onlyUrls) target = { tab: "links" };
  const cta = "editor" in target ? "Abrir no editor" : "Abrir links";
  if (missing.length) {
    const names = missing.map((t) => `“${t}”`);
    const which = names.length > 3 ? `${names.slice(0, 3).join(", ")} e mais ${names.length - 3}` : listPt(names);
    const fix = onlyUrls
      ? "Cole o endereço do checkout de cada prêmio em Links e checkouts."
      : "Na roleta, escolha o checkout de cada prêmio em Configurações → Fatias.";
    return {
      id: "roleta",
      title: "Roleta com prêmio sem link de checkout",
      detail: `${missing.length === 1 ? `O prêmio ${which} ainda não leva` : `Os prêmios ${which} ainda não levam`} ao checkout com o desconto: quem ganhar não recebe o desconto. ${fix}`,
      done: false,
      optional: false,
      cta,
      target,
    };
  }
  // A página de vendas só troca os botões ligados a um link do tipo checkout:
  // sem nenhum, quem ganha vê o prêmio e paga o preço cheio.
  if (input.links.some((l) => l.kind !== undefined)) {
    const checkouts = new Set(input.links.filter((l) => l.kind === "CHECKOUT" && hasDestination(l)).map((l) => l.key));
    const swaps = input.htmls.some((h) => prizeButtonKeys(h).some((k) => checkouts.has(k)));
    if (!swaps) {
      // Botões ainda sem link: o passo "Ligar os botões de compra" já pede; aqui só o porquê.
      const { total, connected } = buyButtons(input.htmls, input.links);
      const fix =
        total > connected
          ? "Ligue os botões de compra (passo acima) a um link do tipo Checkout: só esses levam ao checkout do prêmio."
          : "No editor da página de vendas, ligue os botões de compra a um link do tipo Checkout (ou mude o tipo do link para Checkout em Links e checkouts).";
      return {
        id: "roleta",
        title: "Levar o prêmio da roleta aos botões de compra",
        detail: `Nenhum botão de compra está ligado a um link de checkout da oferta: quem ganhar vê o prêmio, mas paga o preço cheio. ${fix}`,
        done: false,
        optional: false,
        cta: "Abrir links",
        target: { tab: "links" },
      };
    }
  }
  return {
    id: "roleta",
    title: "Prêmios da roleta ligados",
    detail:
      "Cada prêmio leva ao checkout com o desconto, e a página de vendas troca os botões de compra para quem ganhou.",
    done: true,
    optional: false,
    cta,
    target,
  };
}

/** Pagamento na página: chave, página de obrigado com o acesso, link de acesso (null = a oferta não tem). */
function paymentItem(input: ReadinessInput): ReadinessItem | null {
  const check = input.payments;
  if (!check?.products.length) return null;
  const provider = PROVIDER_LABEL[check.provider];
  const base = { id: "pagamento", optional: false } as const;
  // A regra de Purchase repetida é aviso do ZIP (não impede a venda).
  const issues = paymentIssues(check).filter((i) => i.kind !== "doublePurchase");
  const more = issues.length - 1;
  const withMore = (item: ReadinessItem): ReadinessItem =>
    more > 0
      ? {
          ...item,
          detail: `${item.detail} Depois, ${more === 1 ? "falta mais 1 ajuste" : `faltam mais ${more} ajustes`} no pagamento.`,
        }
      : item;
  for (const issue of issues.slice(0, 1)) {
    if (issue.kind === "key") {
      const replace = issue.state === "rejected" || issue.state === "no_scope";
      return withMore({
        ...base,
        title: replace
          ? `Trocar a chave da ${provider}`
          : issue.state === "unreadable"
            ? `Colar de novo a chave da ${provider}`
            : `Cadastrar a chave da ${provider}`,
        detail:
          issue.state === "rejected"
            ? `A ${provider} recusou a chave salva no último “Testar conexão”: no site publicado, os botões de pagamento não cobram.`
            : issue.state === "no_scope"
              ? `A chave da ${provider} salva não tem a permissão transactions:read: o comprador pode pagar sem o pagamento ser confirmado, e aí não recebe o acesso.`
              : issue.state === "unreadable"
                ? `A chave da ${provider} salva não pôde ser lida neste Mac. Sem ela, o pagamento na página não cobra no site publicado.`
                : `O pagamento na página precisa da chave da API da ${provider} para cobrar no site publicado.`,
        done: false,
        cta: "Abrir Configurações",
        target: { settings: "pagamentos" },
      });
    }
    if (issue.kind === "product") {
      const missing = [issue.thankYou && "a página de obrigado", issue.access && "o link de acesso"].filter(
        (x): x is string => Boolean(x),
      );
      const detail = missing.length
        ? `Falta ${listPt(missing)}: sem ${missing.length > 1 ? "eles" : issue.access ? "ele" : "ela"}, quem pagar não recebe o acesso ao produto.`
        : (issue.methods ?? "");
      return withMore({
        ...base,
        title: `Completar o pagamento de “${issue.label}”`,
        detail: missing.length && issue.methods ? `${detail} ${issue.methods}` : detail,
        done: false,
        cta: "Abrir o link",
        target: { link: issue.linkId },
      });
    }
    if (issue.kind === "accessLang") {
      const who = listPt(issue.products.map((p) => `“${p.label}”`));
      return withMore({
        ...base,
        title: "Ajustar o idioma do acesso",
        detail: `O bloco “Acesso ao produto” de “${issue.pageName}” está em outro idioma que o de ${who}: troque o “Idioma dos textos” no bloco ou use uma página de obrigado para cada idioma.`,
        done: false,
        cta: "Abrir no editor",
        target: { editor: issue.documentId },
      });
    }
    if (issue.kind === "accessBlock") {
      return withMore({
        ...base,
        title: "Pôr o acesso na página de obrigado",
        detail: `A página “${issue.pageName}” ainda não tem o bloco “Acesso ao produto” (categoria Conversão): quem pagar chega lá sem o botão de acesso.`,
        done: false,
        cta: "Abrir no editor",
        target: { editor: issue.documentId },
      });
    }
  }
  return {
    ...base,
    title: "Pagamento na página pronto",
    detail:
      "Teste na prévia (“Ver página”). Depois de subir o ZIP, faça uma compra com valor baixo no site publicado (o LEIA-ME.txt explica).",
    done: true,
    cta: "Ver links",
    target: { tab: "links" },
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
  const wheel = wheelItem(input);
  const payment = paymentItem(input);
  const items = [
    checkoutItem(input),
    ...(wheel ? [wheel] : []),
    ...(payment ? [payment] : []),
    companyItem(input),
    pixelItem(input),
    zipItem(input, dateLabel),
    liveItem(input),
  ];
  const required = items.filter((i) => !i.optional);
  const done = required.filter((i) => i.done).length;
  return { items, done, total: required.length, complete: done === required.length };
}
