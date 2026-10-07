/**
 * Avisos do "Baixar ZIP" que a tela sabe resolver ali mesmo (sem servidor nem
 * banco: a prévia, a montagem e o diálogo usam os mesmos textos).
 *
 * Os avisos são gravados como texto no ZIP (ExportJob.warnings), então a tela
 * reconhece pelo texto qual ação oferecer (exportWarningFix).
 */
import type { PaymentIssue } from "@/lib/payments/checks";
import { LOCALE_LABEL } from "@/lib/payments/rules";

/** Aviso da imagem de compartilhamento sem o endereço do site (prévia e montagem usam o mesmo texto). */
export const OG_IMAGE_WARNING =
  "Para a imagem de compartilhamento aparecer no WhatsApp e no Facebook, preencha “Onde está no ar” nos detalhes da oferta (o endereço completo do site) e gere o ZIP de novo.";

/** Marcadores dos dados da empresa, na ordem em que a tela pede os campos. */
export const COMPANY_MARKERS = ["{{EMPRESA}}", "{{CNPJ}}", "{{EMAIL}}", "{{TELEFONE}}", "{{ENDERECO}}"] as const;
export type CompanyMarker = (typeof COMPANY_MARKERS)[number];

/** Campo dos dados da empresa que preenche cada marcador. */
export const COMPANY_MARKER_FIELD = {
  "{{EMPRESA}}": "name",
  "{{CNPJ}}": "document",
  "{{EMAIL}}": "email",
  "{{TELEFONE}}": "phone",
  "{{ENDERECO}}": "address",
} as const satisfies Record<CompanyMarker, string>;
export type CompanyMarkerField = (typeof COMPANY_MARKER_FIELD)[CompanyMarker];

/**
 * Marcadores que continuam na página com o campo vazio (telefone e endereço
 * vazios saem da página junto com o trecho em volta: fillCompanyPlaceholders).
 */
export const REQUIRED_COMPANY_MARKERS = ["{{EMPRESA}}", "{{CNPJ}}", "{{EMAIL}}"] as const satisfies CompanyMarker[];

const COMPANY_WARNING_END = "preencha os dados da empresa e gere o ZIP de novo.";

/** "a", "a e b", "a, b e c". */
function joinPt(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

/** Marcadores da empresa que aparecem no texto, na ordem de COMPANY_MARKERS. */
export function companyMarkersIn(text: string): CompanyMarker[] {
  return COMPANY_MARKERS.filter((m) => text.includes(m));
}

/**
 * Páginas que vão ao ar com {{EMPRESA}}, {{CNPJ}}… no lugar dos dados da
 * empresa → aviso em pt-BR (null = nenhuma).
 */
export function companyMarkersWarning(pages: { name: string; markers: readonly string[] }[]): string | null {
  const withMarkers = pages.filter((p) => p.markers.length > 0);
  if (!withMarkers.length) return null;
  const markers = COMPANY_MARKERS.filter((m) => withMarkers.some((p) => p.markers.includes(m)));
  const names = withMarkers.map((p) => `“${p.name}”`);
  const shown = names.length > 3 ? [...names.slice(0, 3), `mais ${names.length - 3}`] : names;
  const many = withMarkers.length > 1;
  return `${many ? "As páginas" : "A página"} ${joinPt(shown)} ${many ? "ainda mostram" : "ainda mostra"} ${joinPt(markers)} no lugar dos dados da empresa: ${COMPANY_WARNING_END}`;
}

const DEAD_BUTTONS_WARNING_END =
  "abra a página no editor, clique no botão e escolha o checkout em “Link da oferta” (ou digite o endereço).";

/** Texto do botão no aviso: curto, numa linha. */
function buttonName(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 40 ? `${clean.slice(0, 39).trimEnd()}…` : clean;
}

/**
 * Botões de compra que iriam ao ar sem destino (href="#"): ligados a "nenhum"
 * link da oferta, ou a um link ainda sem endereço → aviso em pt-BR (null = nenhum).
 */
export function deadButtonsWarning(pages: { name: string; buttons: readonly string[] }[]): string | null {
  const withButtons = pages.filter((p) => p.buttons.length > 0);
  if (!withButtons.length) return null;
  const total = withButtons.reduce((n, p) => n + p.buttons.length, 0);
  const names = withButtons.map((p) => `“${p.name}”`);
  const shown = names.length > 3 ? [...names.slice(0, 3), `mais ${names.length - 3}`] : names;
  if (total === 1) {
    const label = buttonName(withButtons[0].buttons[0]);
    const button = label ? `O botão “${label}”` : "Um botão";
    return `${button} da página ${shown[0]} ainda não leva a lugar nenhum (está sem link de checkout): ${DEAD_BUTTONS_WARNING_END}`;
  }
  const where = withButtons.length > 1 ? `nas páginas ${joinPt(shown)}` : `na página ${shown[0]}`;
  return `${total} botões ${where} ainda não levam a lugar nenhum (estão sem link de checkout): ${DEAD_BUTTONS_WARNING_END}`;
}

const DEAD_QUIZ_WARNING_END =
  "abra a página no editor, clique no quiz e escolha a próxima página do funil em “Ao terminar o quiz”, nas Configurações.";

/**
 * Botão final do quiz (data-os-qz-go) sem destino: ele leva à próxima página
 * do funil (ex.: a roleta), não ao checkout → aviso em pt-BR (null = nenhum).
 */
export function deadQuizButtonsWarning(pages: { name: string; buttons: readonly string[] }[]): string | null {
  const withButtons = pages.filter((p) => p.buttons.length > 0);
  if (!withButtons.length) return null;
  const total = withButtons.reduce((n, p) => n + p.buttons.length, 0);
  const names = withButtons.map((p) => `“${p.name}”`);
  const shown = names.length > 3 ? [...names.slice(0, 3), `mais ${names.length - 3}`] : names;
  if (total === 1) {
    const label = buttonName(withButtons[0].buttons[0]);
    const button = label ? `O botão final do quiz “${label}”` : "O botão final do quiz";
    return `${button} da página ${shown[0]} ainda não leva a lugar nenhum: ${DEAD_QUIZ_WARNING_END}`;
  }
  const where = withButtons.length > 1 ? `nas páginas ${joinPt(shown)}` : `na página ${shown[0]}`;
  return `${total} botões finais de quiz ${where} ainda não levam a lugar nenhum: ${DEAD_QUIZ_WARNING_END}`;
}

const WHEEL_PRIZE_WARNING_END =
  "abra a página no editor, clique na roleta e escolha o checkout com o desconto de cada prêmio em Configurações → Fatias.";

/** "“10% OFF”, “20% OFF” e mais 2" (no máximo 3 nomes). */
function shortList(items: string[]) {
  const quoted = items.map((t) => `“${buttonName(t)}”`);
  return joinPt(quoted.length > 3 ? [...quoted.slice(0, 3), `mais ${quoted.length - 3}`] : quoted);
}

/**
 * Roleta com prêmio sem link de checkout (ou com um link ainda sem endereço):
 * quem ganhar não recebe o desconto → aviso em pt-BR (null = nenhum).
 */
export function wheelPrizesWarning(pages: { name: string; prizes: readonly string[] }[]): string | null {
  const withPrizes = pages.filter((p) => p.prizes.length > 0);
  if (!withPrizes.length) return null;
  const names = withPrizes.map((p) => `“${p.name}”`);
  const shown = names.length > 3 ? [...names.slice(0, 3), `mais ${names.length - 3}`] : names;
  const prizes = [...new Set(withPrizes.flatMap((p) => p.prizes))];
  const where = withPrizes.length > 1 ? `nas páginas ${joinPt(shown)}` : `na página ${shown[0]}`;
  const which = prizes.length === 1 ? `o prêmio ${shortList(prizes)}` : `os prêmios ${shortList(prizes)}`;
  return `Roleta com prêmio sem link de checkout ${where} (${which}): quem ganhar não recebe o desconto. Para resolver, ${WHEEL_PRIZE_WARNING_END}`;
}

const DEAD_WHEEL_WARNING_END =
  "abra a página no editor, clique na roleta e escolha a página de vendas em “Ao resgatar o prêmio”, nas Configurações.";

/** Botão "Resgatar" da roleta (data-os-wh-go) sem destino → aviso em pt-BR (null = nenhum). */
export function deadWheelButtonsWarning(pages: { name: string; buttons: readonly string[] }[]): string | null {
  const withButtons = pages.filter((p) => p.buttons.length > 0);
  if (!withButtons.length) return null;
  const names = withButtons.map((p) => `“${p.name}”`);
  const shown = names.length > 3 ? [...names.slice(0, 3), `mais ${names.length - 3}`] : names;
  if (withButtons.length === 1 && withButtons[0].buttons.length === 1) {
    const label = buttonName(withButtons[0].buttons[0]);
    const button = label ? `O botão “${label}” da roleta` : "O botão de resgatar da roleta";
    return `${button} da página ${shown[0]} ainda não leva a lugar nenhum: ${DEAD_WHEEL_WARNING_END}`;
  }
  const where = withButtons.length > 1 ? `nas páginas ${joinPt(shown)}` : `na página ${shown[0]}`;
  return `Os botões de resgatar da roleta ${where} ainda não levam a lugar nenhum: ${DEAD_WHEEL_WARNING_END}`;
}

// ─── Pagamento na página (pagamento.php) ────────────────────────────────────

const PAYMENT_KEY_END = "cadastre a chave em Configurações → Pagamentos e gere o ZIP de novo.";
const PAYMENT_KEY_REPLACE_END =
  "troque a chave em Configurações → Pagamentos (“Trocar chave” e “Testar conexão”) e gere o ZIP de novo.";
const PAYMENT_LINK_END = "abra o link em “Links e checkouts”, complete o pagamento na página e gere o ZIP de novo.";
const ACCESS_BLOCK_END =
  "abra a página de obrigado no editor, adicione o bloco “Acesso ao produto” (categoria Conversão) e gere o ZIP de novo.";
const ACCESS_LANG_END =
  "troque o “Idioma dos textos” do bloco no editor ou use uma página de obrigado para cada idioma (duplique a página e escolha a cópia no produto), e gere o ZIP de novo.";
const BLOCK_LANG_LABEL = { es: "Español", en: "English", pt: "Português" } as const;
const PURCHASE_RULE_END =
  "desligue essa regra em Pixels e rastreamento → Eventos (a Kyvo também manda o Purchase pelo servidor, com o mesmo ID do pedido) e gere o ZIP de novo.";

/** Sempre que o ZIP leva o pagamento.php (o LEIA-ME.txt explica como conferir). */
export const PAYMENT_HOSTING_WARNING =
  "O pagamento na página precisa de hospedagem com PHP 7.4 ou mais novo (com cURL) e do site em HTTPS (o cadeado no endereço): Hostinger, HostGator e cPanel têm. Em Netlify, Vercel, Cloudflare Pages ou outra hospedagem só de arquivos o pagamento não funciona e a chave da Kyvo ficaria visível: não suba lá o pagamento.php nem a pasta pagamento-dados.";

/** Problema do pagamento na página (src/lib/payments/checks.ts) → aviso do ZIP em pt-BR. */
export function paymentIssueWarning(issue: PaymentIssue, provider = "Kyvo"): string {
  if (issue.kind === "key") {
    if (issue.state === "rejected") {
      return `A ${provider} recusou a chave salva no último “Testar conexão”: no site publicado, os botões de pagamento mostram “pagamento indisponível” ao comprador. Para resolver, ${PAYMENT_KEY_REPLACE_END}`;
    }
    if (issue.state === "no_scope") {
      return `A chave da ${provider} salva não tem a permissão de consultar transações (transactions:read): no site publicado, o comprador pode pagar sem o pagamento ser confirmado, e aí não recebe o acesso. Para resolver, ${PAYMENT_KEY_REPLACE_END}`;
    }
    return issue.state === "unreadable"
      ? `A chave da ${provider} salva neste Mac não pôde ser lida (o Offer Studio veio de outro computador?): no site publicado, os botões de pagamento mostram “pagamento indisponível”. Para resolver, ${PAYMENT_KEY_END}`
      : `O pagamento na página ainda não tem a chave da ${provider}: no site publicado, os botões de pagamento mostram “pagamento indisponível” ao comprador. Para resolver, ${PAYMENT_KEY_END}`;
  }
  if (issue.kind === "product") {
    const parts: string[] = [];
    const missing = [issue.thankYou && "sem página de obrigado", issue.access && "sem link de acesso"].filter(
      (x): x is string => Boolean(x),
    );
    if (missing.length) {
      const why = issue.access
        ? "quem pagasse não receberia o produto, então o pagamento.php não cobra esse produto enquanto faltar o link de acesso"
        : "depois de pagar, o comprador não vai para a página com o acesso";
      parts.push(`está ${joinPt(missing)}: ${why}.`);
    }
    if (issue.methods)
      parts.push(`${missing.length ? "Além disso: " : "tem uma forma de pagamento que não serve: "}${issue.methods}`);
    return `O link “${issue.label}” (pagamento na página) ${parts.join(" ")} Para resolver, ${PAYMENT_LINK_END}`;
  }
  if (issue.kind === "accessLang") {
    const who = joinPt(issue.products.map((p) => `“${p.label}” (${LOCALE_LABEL[p.locale]})`));
    return `O bloco “Acesso ao produto” da página “${issue.pageName}” está em ${BLOCK_LANG_LABEL[issue.blockLang]}, mas quem compra ${who} vai para essa página: o comprador vê a janela de pagamento num idioma e a página de obrigado em outro. Para resolver, ${ACCESS_LANG_END}`;
  }
  if (issue.kind === "accessBlock") {
    return `A página de obrigado “${issue.pageName}” não tem o bloco “Acesso ao produto” (em todas as versões dela): quem pagar chega lá sem o botão de acesso. Para resolver, ${ACCESS_BLOCK_END}`;
  }
  const named = issue.pageNames.filter((n): n is string => Boolean(n));
  const where = issue.pageNames.some((n) => n === null)
    ? "em todas as páginas"
    : named.length > 1
      ? `nas páginas ${joinPt([...new Set(named)].map((n) => `“${n}”`))}`
      : `na página “${named[0]}”`;
  return `Há uma regra de evento Purchase que dispara sozinha ${where}: com o pagamento na página, ela conta cada venda duas vezes (a janela de pagamento já manda o Purchase com o valor certo). Para resolver, ${PURCHASE_RULE_END}`;
}

/** O que a tela oferece ao lado de um aviso do ZIP (null = só o texto). */
export type ExportWarningFix =
  | { kind: "liveUrl" }
  | { kind: "company"; fields: CompanyMarkerField[] }
  /**
   * quiz: o aviso é do botão final do quiz (abre só as páginas com quiz sem
   * destino); wheel: da roleta (prêmio sem link ou "Resgatar" sem destino).
   */
  | { kind: "deadButtons"; quiz?: boolean; wheel?: boolean }
  /** Pagamento na página: chave do gateway (Configurações → Pagamentos). */
  | { kind: "paymentKey" }
  /** Pagamento na página: link com algo faltando (abre o link na aba "Links e checkouts"). */
  | { kind: "paymentLink" }
  /** Página de obrigado sem o bloco "Acesso ao produto" (abre no editor). */
  | { kind: "accessBlock" }
  /** Regra de Purchase que contaria a venda duas vezes (aba "Pixels e rastreamento"). */
  | { kind: "purchaseRule" };

export function exportWarningFix(warning: string): ExportWarningFix | null {
  if (warning === OG_IMAGE_WARNING) return { kind: "liveUrl" };
  if (warning.endsWith(DEAD_BUTTONS_WARNING_END)) return { kind: "deadButtons" };
  if (warning.endsWith(DEAD_QUIZ_WARNING_END)) return { kind: "deadButtons", quiz: true };
  if (warning.endsWith(WHEEL_PRIZE_WARNING_END) || warning.endsWith(DEAD_WHEEL_WARNING_END)) {
    return { kind: "deadButtons", wheel: true };
  }
  if (warning.endsWith(PAYMENT_KEY_END) || warning.endsWith(PAYMENT_KEY_REPLACE_END)) return { kind: "paymentKey" };
  if (warning.endsWith(PAYMENT_LINK_END)) return { kind: "paymentLink" };
  if (warning.endsWith(ACCESS_BLOCK_END) || warning.endsWith(ACCESS_LANG_END)) return { kind: "accessBlock" };
  if (warning.endsWith(PURCHASE_RULE_END)) return { kind: "purchaseRule" };
  if (warning.endsWith(COMPANY_WARNING_END)) {
    const fields = companyMarkersIn(warning).map((m) => COMPANY_MARKER_FIELD[m]);
    return fields.length ? { kind: "company", fields } : null;
  }
  return null;
}
