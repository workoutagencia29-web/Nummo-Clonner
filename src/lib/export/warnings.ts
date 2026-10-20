/**
 * Avisos do "Baixar ZIP" que a tela sabe resolver ali mesmo (sem servidor nem
 * banco: a prévia, a montagem e o diálogo usam os mesmos textos).
 *
 * Os avisos são gravados como texto no ZIP (ExportJob.warnings), então a tela
 * reconhece pelo texto qual ação oferecer (exportWarningFix).
 */
import { type CheckoutIssue, checkoutProductMissing, shippingIssueText, textsIssueText } from "@/lib/checkout/checks";
import type { PaymentIssue } from "@/lib/payments/checks";
import { LOCALE_LABEL, type PaymentProviderId, PROVIDER_LABEL } from "@/lib/payments/rules";

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

const OWN_CHECKOUT_COUPON_END =
  "ponha o valor já com o desconto no checkout do prêmio (em “Links e checkouts”) e apague o cupom na roleta (Configurações → Fatias), e gere o ZIP de novo.";

/**
 * Prêmios da roleta com cupom que levam a um link "Checkout do Offer Studio":
 * a página de checkout não tem campo de cupom — quem ganha paga o valor do
 * checkout do prêmio → aviso em pt-BR (null = nenhum). Não impede a venda.
 */
export function ownCheckoutCouponWarning(pages: { name: string; prizes: readonly string[] }[]): string | null {
  const used = pages.filter((p) => p.prizes.length > 0);
  if (!used.length) return null;
  const names = used.map((p) => `“${p.name}”`);
  const shown = names.length > 3 ? [...names.slice(0, 3), `mais ${names.length - 3}`] : names;
  const prizes = [...new Set(used.flatMap((p) => p.prizes))];
  const where = used.length > 1 ? `nas páginas ${joinPt(shown)}` : `na página ${shown[0]}`;
  const which = prizes.length === 1 ? `O prêmio ${shortList(prizes)}` : `Os prêmios ${shortList(prizes)}`;
  return `${which} da roleta ${where} ${prizes.length === 1 ? "tem cupom e leva" : "têm cupom e levam"} a um link “Checkout do Offer Studio”, que não tem campo de cupom: quem ganhar paga o valor do checkout, sem o desconto do cupom. Para resolver, ${OWN_CHECKOUT_COUPON_END}`;
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

const DEAD_PRODUCTS_WARNING_END =
  "abra a página no editor e use “Criar as páginas que faltam”, nas Configurações da vitrine (ou clique no produto e escolha a página dele).";

/**
 * Cartões da vitrine de produtos sem destino (sem página do produto, link da
 * oferta ou endereço): o clique não leva a lugar nenhum → aviso em pt-BR
 * (null = nenhum). `showcases`: título de cada vitrine e quantos cartões dela.
 */
export function deadProductsWarning(
  pages: { name: string; showcases: readonly { showcase: string; count: number }[] }[],
): string | null {
  const withGaps = pages
    .map((p) => ({ name: p.name, showcases: p.showcases.filter((s) => s.count > 0) }))
    .filter((p) => p.showcases.length > 0);
  if (!withGaps.length) return null;
  const total = withGaps.reduce((n, p) => n + p.showcases.reduce((m, s) => m + s.count, 0), 0);
  const products = total === 1 ? "1 produto" : `${total} produtos`;
  const verb = total === 1 ? "ainda não leva" : "ainda não levam";
  const names = withGaps.map((p) => `“${p.name}”`);
  const shown = names.length > 3 ? [...names.slice(0, 3), `mais ${names.length - 3}`] : names;
  if (withGaps.length === 1 && withGaps[0].showcases.length === 1) {
    const title = buttonName(withGaps[0].showcases[0].showcase);
    const which = title ? `da vitrine “${title}”` : "da vitrine";
    return `${products} ${which} na página ${shown[0]} ${verb} a lugar nenhum: ${DEAD_PRODUCTS_WARNING_END}`;
  }
  const where = withGaps.length > 1 ? `nas páginas ${joinPt(shown)}` : `na página ${shown[0]}`;
  return `${products} das vitrines ${where} ${verb} a lugar nenhum: ${DEAD_PRODUCTS_WARNING_END}`;
}

const DEAD_MORE_WARNING_END =
  "abra a página no editor, clique no “Ver todas” e escolha para onde ele leva em Configurações (ou desligue o “Ver todas” na vitrine).";

/**
 * "Ver todas" ligado na vitrine e sem destino (href "#"): o clique só pula
 * para o topo → aviso em pt-BR (null = nenhum).
 */
export function deadMoreWarning(
  pages: { name: string; showcases: readonly { showcase: string; more?: boolean }[] }[],
): string | null {
  const withMore = pages
    .map((p) => ({ name: p.name, titles: p.showcases.filter((s) => s.more).map((s) => s.showcase) }))
    .filter((p) => p.titles.length > 0);
  if (!withMore.length) return null;
  const names = withMore.map((p) => `“${p.name}”`);
  const shown = names.length > 3 ? [...names.slice(0, 3), `mais ${names.length - 3}`] : names;
  const total = withMore.reduce((n, p) => n + p.titles.length, 0);
  if (total === 1) {
    const title = buttonName(withMore[0].titles[0]);
    const which = title ? `da vitrine “${title}”` : "de uma vitrine";
    return `O “Ver todas” ${which} na página ${shown[0]} ainda não leva a lugar nenhum: ${DEAD_MORE_WARNING_END}`;
  }
  const where = withMore.length > 1 ? `nas páginas ${joinPt(shown)}` : `na página ${shown[0]}`;
  return `${total} links “Ver todas” das vitrines ${where} ainda não levam a lugar nenhum: ${DEAD_MORE_WARNING_END}`;
}

const DEAD_CATEGORIES_WARNING_END =
  "abra a página no editor, clique na categoria e escolha para onde ela leva em Configurações (ou troque o texto por uma palavra do nome dos produtos).";

/**
 * Categorias do cabeçalho de loja sem destino que não mostram nenhum produto
 * (o clique busca o texto delas e esvazia a vitrine; numa página sem vitrine,
 * não leva a lugar nenhum) → aviso em pt-BR (null = nenhuma).
 */
export function deadCategoriesWarning(pages: { name: string; categories: readonly string[] }[]): string | null {
  const withCats = pages.filter((p) => p.categories.length > 0);
  if (!withCats.length) return null;
  const names = withCats.map((p) => `“${p.name}”`);
  const shown = names.length > 3 ? [...names.slice(0, 3), `mais ${names.length - 3}`] : names;
  const cats = [...new Set(withCats.flatMap((p) => p.categories))];
  const where = withCats.length > 1 ? `das páginas ${joinPt(shown)}` : `da página ${shown[0]}`;
  if (cats.length === 1) {
    return `A categoria ${shortList(cats)} do cabeçalho ${where} não mostra nenhum produto: ${DEAD_CATEGORIES_WARNING_END}`;
  }
  return `As categorias ${shortList(cats)} do cabeçalho ${where} não mostram nenhum produto: ${DEAD_CATEGORIES_WARNING_END}`;
}

const DEAD_BACK_WARNING_END =
  "abra a página no editor e escolha a página da loja nas Configurações do cabeçalho de loja (ou clique no “Voltar” e escolha para onde ele leva).";

/**
 * "‹ Voltar para a loja" sem destino em páginas sem a página da loja no logo:
 * para quem chega de fora do site, o clique não leva a lugar nenhum → aviso em
 * pt-BR (null = nenhuma página assim).
 */
export function deadBackWarning(pages: readonly string[]): string | null {
  if (!pages.length) return null;
  const names = pages.map((p) => `“${p}”`);
  const shown = names.length > 3 ? [...names.slice(0, 3), `mais ${names.length - 3}`] : names;
  const where = pages.length > 1 ? `das páginas ${joinPt(shown)}` : `da página ${shown[0]}`;
  return `O “‹ Voltar para a loja” ${where} não leva a lugar nenhum para quem chega de fora do site (anúncio, link direto): ${DEAD_BACK_WARNING_END}`;
}

const DEAD_LEGAL_END =
  "abra a página no editor, clique em cada link e, em Configurações, escolha a página dele em “Página do funil” (crie antes as páginas de Política e Termos em “Nova página”) ou digite o “Endereço do link” (e-mail, WhatsApp…).";

/**
 * Links de páginas legais e de contato sem destino ("Política de
 * privacidade", "Termos de uso", "Contato"… com href="#": src/lib/export/legal-links.ts)
 * → aviso em pt-BR (null = nenhum).
 */
export function deadLegalLinksWarning(pages: { name: string; links: readonly string[] }[]): string | null {
  const withLinks = pages.filter((p) => p.links.length > 0);
  if (!withLinks.length) return null;
  const total = withLinks.reduce((n, p) => n + p.links.length, 0);
  const names = withLinks.map((p) => `“${p.name}”`);
  const shown = names.length > 3 ? [...names.slice(0, 3), `mais ${names.length - 3}`] : names;
  if (total === 1) {
    return `O link “${buttonName(withLinks[0].links[0])}” da página ${shown[0]} não leva a lugar nenhum: ${DEAD_LEGAL_END}`;
  }
  const where = withLinks.length > 1 ? `nas páginas ${joinPt(shown)}` : `na página ${shown[0]}`;
  const links = [...new Set(withLinks.flatMap((p) => p.links))];
  return `${total} links de páginas legais e de contato ${where} não levam a lugar nenhum (${shortList(links)}): ${DEAD_LEGAL_END}`;
}

const CLONED_CHECKOUT_END = "Troque pelo endereço do seu checkout em “Links e checkouts” e gere o ZIP de novo.";

/**
 * Links da oferta que ainda levam ao checkout da página clonada (o dono dela
 * recebe a venda) → aviso em pt-BR (null = nenhum). `labels`: nome de cada link.
 */
export function clonedCheckoutWarning(labels: readonly string[]): string | null {
  if (!labels.length) return null;
  const who = "quem clicar compra do dono da página original";
  if (labels.length === 1) {
    return `O link “${buttonName(labels[0])}” ainda leva ao checkout da página que você clonou: ${who}. ${CLONED_CHECKOUT_END}`;
  }
  return `${labels.length} links ainda levam ao checkout da página que você clonou (${shortList([...labels])}): ${who}. ${CLONED_CHECKOUT_END}`;
}

// ─── Moeda das vitrines e caixas de compra ──────────────────────────────────

const STORE_CURRENCY_END =
  "passe tudo para a moeda da oferta no cartão “Moeda da oferta” (aba “Moeda, empresa e SEO”) e gere o ZIP de novo.";

/**
 * Vitrines e caixas de compra numa moeda diferente da moeda da oferta (a
 * página voltou pelo Histórico a um ponto de antes da troca, ou foi gravada
 * por um editor aberto antes dela) → aviso em pt-BR (null = nenhuma).
 * `currencies`: nome das moedas em que elas estão ("real"); `offer`: nome da
 * moeda da oferta ("peso mexicano").
 */
export function storeCurrencyWarning(
  pages: readonly { name: string; hosts: number }[],
  currencies: readonly string[],
  offer: string,
): string | null {
  const withHosts = pages.filter((p) => p.hosts > 0);
  if (!withHosts.length) return null;
  const names = withHosts.map((p) => `“${p.name}”`);
  const shown = names.length > 3 ? [...names.slice(0, 3), `mais ${names.length - 3}`] : names;
  const where = withHosts.length > 1 ? `das páginas ${joinPt(shown)}` : `da página ${shown[0]}`;
  const total = withHosts.reduce((n, p) => n + p.hosts, 0);
  const what = total === 1 ? "A vitrine (ou caixa de compra)" : "As vitrines e caixas de compra";
  const verb = total === 1 ? "mostra" : "mostram";
  return `${what} ${where} ainda ${verb} os preços em ${joinPt([...currencies])}, mas a oferta roda em ${offer}. Para resolver, ${STORE_CURRENCY_END}`;
}

// ─── Pagamento na página (pagamento.php) ────────────────────────────────────

const PAYMENT_KEY_END =
  "cadastre a chave da oferta em “Links e checkouts” (cartão “Pagamento na página — conta da Kyvo desta oferta”) e gere o ZIP de novo.";
const PAYMENT_KEY_REPLACE_END =
  "troque a chave da oferta em “Links e checkouts” (“Trocar chave” e “Testar conexão”) e gere o ZIP de novo.";
const PAYMENT_LINK_END = "abra o link em “Links e checkouts”, complete o pagamento na página e gere o ZIP de novo.";
/** Só o valor não serve (nada falta completar): baixar o valor ou mudar as formas de pagamento. */
const PAYMENT_AMOUNT_END =
  "abra o link em “Links e checkouts”, ajuste o valor ou as formas de pagamento e gere o ZIP de novo.";
const ACCESS_BLOCK_END =
  "abra a página de obrigado no editor, adicione o bloco “Acesso ao produto” (categoria Conversão) e gere o ZIP de novo.";
const ACCESS_LANG_END =
  "troque o “Idioma dos textos” do bloco no editor ou use uma página de obrigado para cada idioma (duplique a página e escolha a cópia no produto), e gere o ZIP de novo.";
const BLOCK_LANG_LABEL = { es: "Español", en: "English", pt: "Português" } as const;
const PURCHASE_RULE_END =
  "desligue essa regra em Pixels e rastreamento → Eventos (a Kyvo também manda o Purchase pelo servidor, com o mesmo ID do pedido) e gere o ZIP de novo.";

/**
 * O ZIP leva o checkout do Offer Studio (pagamento.php e as páginas de
 * checkout): hospedagem com PHP e HTTPS. Gateways: "FlevoPay", "BlackCat", "Kyvo".
 */
export function checkoutHostingWarning(gateways: readonly string[]): string {
  const keys = gateways.length
    ? `as chaves (${joinPt([...gateways])}) ficariam visíveis`
    : "as chaves ficariam visíveis";
  return `O checkout do Offer Studio precisa de hospedagem com PHP 7.4 ou mais novo (com cURL) e do site em HTTPS (o cadeado no endereço): Hostinger, HostGator e cPanel têm. Em Netlify, Vercel, Cloudflare Pages ou outra hospedagem só de arquivos o checkout não cobra e ${keys}: não suba lá o pagamento.php nem a pasta pagamento-dados.`;
}

/** Sempre que o ZIP leva o pagamento.php (o LEIA-ME.txt explica como conferir). */
export const PAYMENT_HOSTING_WARNING =
  "O pagamento na página precisa de hospedagem com PHP 7.4 ou mais novo (com cURL) e do site em HTTPS (o cadeado no endereço): Hostinger, HostGator e cPanel têm. Em Netlify, Vercel, Cloudflare Pages ou outra hospedagem só de arquivos o pagamento não funciona e a chave da Kyvo ficaria visível: não suba lá o pagamento.php nem a pasta pagamento-dados.";

/**
 * ZIP para hospedagem SEM PHP (Vercel/Netlify): o pagamento roda numa função
 * Node e a chave fica nas variáveis de ambiente (nunca em arquivo). O aviso diz
 * o que configurar no painel depois de subir.
 */
export function serverlessHostingWarning(target: "vercel" | "netlify", gateways: readonly string[]): string {
  const nome = target === "vercel" ? "Vercel" : "Netlify";
  const chaves = gateways.length ? `a chave de ${joinPt([...gateways])}` : "a chave do gateway";
  return `O pagamento vai rodar numa função da ${nome} (não precisa de PHP). Depois de subir, no painel da ${nome}, em “Environment variables / Variáveis de ambiente”, cole o OS_PAY_SECRET (o valor que o Offer Studio mostrou ao exportar) e ${chaves} (OS_…_KEY) — veja o .env.example e o LEIA-ME.txt. Sem essas variáveis a função responde “configuração” e não cobra. A ${nome} já serve o site em HTTPS.`;
}

/** Item da função serverless em "O que vai no ZIP". */
export function serverlessTreeLabel(target: "vercel" | "netlify", gateways: readonly string[]): string {
  const nome = target === "vercel" ? "Vercel" : "Netlify";
  const names = gateways.length ? joinPt([...gateways]) : "do gateway";
  return `Função de pagamento da ${nome} · cria as cobranças (${names}), confere o pagamento e entrega o acesso só a quem pagou (a chave vai nas variáveis de ambiente)`;
}

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
    if (issue.amount) {
      const intro = parts.length ? "Além disso, o valor não serve:" : "tem um valor que a Kyvo recusa:";
      parts.push(`${intro} ${issue.amount} No site publicado, o comprador vê “pagamento indisponível”.`);
    }
    const onlyAmount = !missing.length && !issue.methods;
    return `O link “${issue.label}” (pagamento na página) ${parts.join(" ")} Para resolver, ${onlyAmount ? PAYMENT_AMOUNT_END : PAYMENT_LINK_END}`;
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

// ─── Checkout do Offer Studio ────────────────────────────────────────────────

/** Fim do aviso da chave de um gateway do checkout (o conserto abre o cartão da conta dele). */
const checkoutKeyEnd = (provider: PaymentProviderId) =>
  `abra a conta da ${PROVIDER_LABEL[provider]} em “Links e checkouts”, cadastre ou troque a chave, clique em “Testar conexão” e gere o ZIP de novo.`;
/** Conta da BlackCat ainda não liberada (a chave é válida): esperar e testar de novo, não trocar a chave. */
const checkoutAccountEnd = (provider: PaymentProviderId) =>
  `abra a conta da ${PROVIDER_LABEL[provider]} em “Links e checkouts” e, quando a ${PROVIDER_LABEL[provider]} liberar a conta, clique em “Testar conexão” de novo e gere o ZIP.`;
const CHECKOUT_LINK_END = "abra o link em “Links e checkouts”, complete o checkout e gere o ZIP de novo.";
const CHECKOUT_SHIPPING_END =
  "abra o link em “Links e checkouts” e ligue o endereço (ou deixe só o frete grátis), e gere o ZIP de novo.";
const CHECKOUT_PURCHASE_RULE_END = "desligue essa regra em Pixels e rastreamento → Eventos e gere o ZIP de novo.";
const CHECKOUT_TEXTS_END =
  "abra o link em “Links e checkouts”, revise os textos em “Aparência → Textos” (ou apague-os para usar os padrões), salve e gere o ZIP de novo.";

/** Problema do checkout do Offer Studio (src/lib/checkout/checks.ts) → aviso do ZIP em pt-BR. */
export function checkoutIssueWarning(issue: CheckoutIssue): string {
  if (issue.kind === "key") {
    const label = PROVIDER_LABEL[issue.provider];
    const who = joinPt(issue.labels.map((l) => `“${l}”`));
    const why =
      issue.state === "rejected"
        ? `a ${label} recusou a chave salva no último “Testar conexão”`
        : issue.state === "no_scope"
          ? `a ${label} não liberou a conta da chave salva para vender`
          : issue.state === "unreadable"
            ? `a chave da ${label} salva neste Mac não pôde ser lida`
            : `falta a chave da ${label} desta oferta`;
    const end =
      issue.state === "no_scope" && issue.provider !== "KYVO"
        ? checkoutAccountEnd(issue.provider)
        : checkoutKeyEnd(issue.provider);
    return `O checkout ${who} não cobra no site publicado: ${why}. Para resolver, ${end}`;
  }
  if (issue.kind === "product") {
    const parts: string[] = [];
    if (issue.currency) parts.push(issue.currency);
    const missing = checkoutProductMissing(issue);
    if (missing.length) parts.push(`Falta ${joinPt(missing)}: quem pagar não recebe tudo o que comprou.`);
    if (issue.amount) parts.push(`${issue.amount} No site publicado, o comprador vê “pagamento indisponível”.`);
    return `O checkout “${issue.label}” precisa de ajustes. ${parts.join(" ")} Para resolver, ${CHECKOUT_LINK_END}`;
  }
  if (issue.kind === "shipping") return `${shippingIssueText(issue)} Para resolver, ${CHECKOUT_SHIPPING_END}`;
  if (issue.kind === "texts") return `${textsIssueText(issue)} Para resolver, ${CHECKOUT_TEXTS_END}`;
  if (issue.kind === "accessLang") {
    const who = joinPt(issue.products.map((p) => `“${p.label}” (${LOCALE_LABEL[p.locale]})`));
    return `O bloco “Acesso ao produto” da página “${issue.pageName}” está em ${BLOCK_LANG_LABEL[issue.blockLang]}, mas quem compra no checkout ${who} vai para essa página: o comprador vê o checkout num idioma e a página de obrigado em outro. Para resolver, ${ACCESS_LANG_END}`;
  }
  if (issue.kind === "doublePurchase") {
    const named = issue.pageNames.filter((n): n is string => Boolean(n));
    const where = issue.pageNames.some((n) => n === null)
      ? "em todas as páginas"
      : named.length > 1
        ? `nas páginas ${joinPt([...new Set(named)].map((n) => `“${n}”`))}`
        : `na página “${named[0]}”`;
    return `Há uma regra de evento Purchase que dispara sozinha ${where}: com o checkout do Offer Studio, ela conta cada venda duas vezes (a página de checkout já manda o Purchase com o valor certo quando o pagamento é aprovado). Para resolver, ${CHECKOUT_PURCHASE_RULE_END}`;
  }
  return `A página de obrigado “${issue.pageName}” não tem o bloco “Acesso ao produto” (em todas as versões dela): quem pagar no checkout chega lá sem o botão de acesso. Para resolver, ${ACCESS_BLOCK_END}`;
}

/** Gateway do aviso da chave do checkout (o conserto abre o cartão dele), ou null. */
function checkoutKeyProvider(warning: string): PaymentProviderId | null {
  for (const provider of Object.keys(PROVIDER_LABEL) as PaymentProviderId[]) {
    if (warning.endsWith(checkoutKeyEnd(provider)) || warning.endsWith(checkoutAccountEnd(provider))) return provider;
  }
  return null;
}

/** O que a tela oferece ao lado de um aviso do ZIP (null = só o texto). */
export type ExportWarningFix =
  | { kind: "liveUrl" }
  /** Link que ainda leva ao checkout da página clonada (abre o link na aba "Links e checkouts"). */
  | { kind: "clonedCheckout" }
  /** Links de Política, Termos, Contato… sem destino (abre a página no editor). */
  | { kind: "legalLinks" }
  | { kind: "company"; fields: CompanyMarkerField[] }
  /**
   * quiz: o aviso é do botão final do quiz (abre só as páginas com quiz sem
   * destino); wheel: da roleta (prêmio sem link ou "Resgatar" sem destino);
   * products: da loja (cartões da vitrine sem a página do produto, "Ver
   * todas" sem destino, categorias do cabeçalho que não mostram produtos,
   * "‹ Voltar para a loja" sem destino).
   */
  | { kind: "deadButtons"; quiz?: boolean; wheel?: boolean; products?: boolean }
  /** Pagamento na página: chave do gateway da oferta (cartão na aba "Links e checkouts"). */
  | { kind: "paymentKey" }
  /** Pagamento na página: link com algo faltando (abre o link na aba "Links e checkouts"). */
  | { kind: "paymentLink" }
  /** Checkout do Offer Studio: chave de um gateway (cartão da conta dele na aba "Links e checkouts"). */
  | { kind: "checkoutKey"; provider: PaymentProviderId }
  /** Checkout do Offer Studio: link com algo faltando (abre o link na aba "Links e checkouts"). */
  | { kind: "checkoutLink" }
  /** Página de obrigado sem o bloco "Acesso ao produto" (abre no editor). */
  | { kind: "accessBlock" }
  /** Regra de Purchase que contaria a venda duas vezes (aba "Pixels e rastreamento"). */
  | { kind: "purchaseRule" }
  /** Vitrines e caixas de compra fora da moeda da oferta (cartão "Moeda da oferta"). */
  | { kind: "currency" };

export function exportWarningFix(warning: string): ExportWarningFix | null {
  if (warning === OG_IMAGE_WARNING) return { kind: "liveUrl" };
  if (warning.endsWith(CLONED_CHECKOUT_END)) return { kind: "clonedCheckout" };
  if (warning.endsWith(DEAD_LEGAL_END)) return { kind: "legalLinks" };
  if (warning.endsWith(DEAD_BUTTONS_WARNING_END)) return { kind: "deadButtons" };
  if (warning.endsWith(DEAD_QUIZ_WARNING_END)) return { kind: "deadButtons", quiz: true };
  if (
    warning.endsWith(WHEEL_PRIZE_WARNING_END) ||
    warning.endsWith(DEAD_WHEEL_WARNING_END) ||
    warning.endsWith(OWN_CHECKOUT_COUPON_END)
  ) {
    return { kind: "deadButtons", wheel: true };
  }
  if (
    warning.endsWith(DEAD_PRODUCTS_WARNING_END) ||
    warning.endsWith(DEAD_MORE_WARNING_END) ||
    warning.endsWith(DEAD_CATEGORIES_WARNING_END) ||
    warning.endsWith(DEAD_BACK_WARNING_END)
  )
    return { kind: "deadButtons", products: true };
  if (warning.endsWith(PAYMENT_KEY_END) || warning.endsWith(PAYMENT_KEY_REPLACE_END)) return { kind: "paymentKey" };
  if (warning.endsWith(PAYMENT_LINK_END) || warning.endsWith(PAYMENT_AMOUNT_END)) return { kind: "paymentLink" };
  const checkoutKey = checkoutKeyProvider(warning);
  if (checkoutKey) return { kind: "checkoutKey", provider: checkoutKey };
  if (
    warning.endsWith(CHECKOUT_LINK_END) ||
    warning.endsWith(CHECKOUT_SHIPPING_END) ||
    warning.endsWith(CHECKOUT_TEXTS_END)
  ) {
    return { kind: "checkoutLink" };
  }
  if (warning.endsWith(STORE_CURRENCY_END)) return { kind: "currency" };
  if (warning.endsWith(ACCESS_BLOCK_END) || warning.endsWith(ACCESS_LANG_END)) return { kind: "accessBlock" };
  if (warning.endsWith(PURCHASE_RULE_END) || warning.endsWith(CHECKOUT_PURCHASE_RULE_END)) {
    return { kind: "purchaseRule" };
  }
  if (warning.endsWith(COMPANY_WARNING_END)) {
    const fields = companyMarkersIn(warning).map((m) => COMPANY_MARKER_FIELD[m]);
    return fields.length ? { kind: "company", fields } : null;
  }
  return null;
}
