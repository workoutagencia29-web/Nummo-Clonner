/**
 * Pedaços de HTML com os ganchos do Offer Studio usados pelos modelos. Ficam
 * todos aqui para que o formato dos widgets possa ser ajustado num só lugar.
 * Os atributos seguem o script das páginas (src/runtime/widgets).
 *
 * - data-os-link=""        botão de compra; a chave vazia significa "escolha no
 *                           editor qual link da oferta usar" (checkout, upsell…).
 * - href="#" sem data-os-link: link para outra página do funil, escolhido no
 *                           editor ("Página do funil").
 * - data-os-delay="0"      bloco que aparece depois de N segundos (VSL).
 * - data-os-widget="countdown"           contador por visitante (data-os-mode,
 *                           data-os-minutes, data-os-expired); números em
 *                           [data-os-cd=h|m|s] dentro de [data-os-cd-units].
 * - iframe[data-os-video]                vídeo (YouTube/Vimeo/Panda) colado no editor.
 * - [data-os-field=name|email|phone]     campos do formulário (ligam/desligam no editor).
 * - form[data-os-widget="lead-form"]     captura; data-os-webhook, data-os-success
 *                           e o destino no atributo action (URL, página do funil
 *                           ou link da oferta, escolhido no editor).
 * - data-os-widget="exit-popup"          popup de saída; começa com `hidden`, a
 *                           caixa é o primeiro filho e [data-os-close] fecha.
 * - data-os-widget="sales-notification"  aviso flutuante de prova social; começa
 *                           com `hidden`; textos em [data-os-sn=title|text|time].
 *
 * Nada disso executa no editor: lá os widgets aparecem no estado final (contador
 * com um horário de exemplo, popup como caixa editável com rótulo).
 */
import { avatarImage } from "./assets";

/** Marcadores trocados na criação da página (ver templateHtml). */
export const TODAY_MARKER = "__OS_HOJE__";
export const YEAR_MARKER = "__OS_ANO__";

interface ButtonOptions {
  size?: "xl";
  block?: boolean;
  pulse?: boolean;
}

/** Botão de compra ligado a um link da oferta (escolhido no editor). */
export function buyButton(label: string, opts: ButtonOptions = {}) {
  const cls = ["os-btn", opts.size === "xl" && "os-btn--xl", opts.block && "os-btn--block", opts.pulse && "os-pulse"]
    .filter(Boolean)
    .join(" ");
  return `<a href="#" class="${cls}" data-os-link="">${label}</a>`;
}

/** Selos de confiança logo abaixo do botão. */
export function safeList(items: string[] = ["Compra 100% segura", "Acesso imediato", "Garantia de 7 dias"]) {
  return `<ul class="os-safe">${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
}

/**
 * Espaço do vídeo: iframe de vídeo ainda sem endereço. No editor vira o marcador
 * "Cole o link do vídeo em Configurações" (YouTube, Vimeo ou Panda).
 */
export function videoSlot(title = "Vídeo de vendas") {
  return `<div class="os-video"><iframe data-os-video="" title="${title}" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen></iframe></div>`;
}

/**
 * Contador regressivo por visitante (mostra um horário de exemplo no editor).
 * Classes os-cd-* são as que as cores do contador (Configurações) ajustam.
 */
export function countdown(minutes: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const unit = (key: string, value: string, label: string) =>
    `<div class="os-cd-unit" data-os-cd-unit="${key}"><span class="os-cd-num" data-os-cd="${key}">${value}</span><span class="os-cd-lbl">${label}</span></div>`;
  return (
    `<div class="os-countdown" data-os-widget="countdown" data-os-mode="evergreen" data-os-minutes="${minutes}" data-os-expired="zero" data-os-expired-text="Oferta encerrada." data-os-cd-days="0">` +
    `<div class="os-cd-units" data-os-cd-units>` +
    unit("h", pad(Math.floor(minutes / 60)), "horas") +
    unit("m", pad(minutes % 60), "min") +
    unit("s", "00", "seg") +
    `</div></div>`
  );
}

interface LeadFormOptions {
  id?: string;
  button: string;
  whatsapp?: boolean;
  /**
   * Mensagem mostrada quando não há página de destino — só depois que o webhook
   * recebeu os dados (sem webhook nem destino, a página mostra "Obrigado!").
   * Neutra de propósito: não promete e-mail nem material.
   */
  success?: string;
}

/**
 * Formulário de captura (nome, e-mail e, opcionalmente, WhatsApp). Os nomes dos
 * campos (name, email, phone) são os que os checkouts entendem no repasse.
 */
export function leadForm(opts: LeadFormOptions) {
  const phone = opts.whatsapp
    ? `<label class="os-field" data-os-field="phone"><span>Seu WhatsApp</span><input class="os-input" type="tel" name="phone" placeholder="(00) 00000-0000" autocomplete="tel" inputmode="tel" required></label>`
    : "";
  const success = opts.success ?? "Pronto! Recebemos seus dados.";
  return (
    `<form${opts.id ? ` id="${opts.id}"` : ""} class="os-form" data-os-widget="lead-form" data-os-webhook="" data-os-success="${success}">` +
    `<label class="os-field" data-os-field="name"><span>Seu nome</span><input class="os-input" type="text" name="name" placeholder="Digite seu primeiro nome" autocomplete="given-name" required></label>` +
    `<label class="os-field" data-os-field="email"><span>Seu melhor e-mail</span><input class="os-input" type="email" name="email" placeholder="voce@email.com" autocomplete="email" inputmode="email" required></label>` +
    phone +
    `<button type="submit" class="os-btn os-pulse">${opts.button}</button>` +
    `<p class="os-consent">🔒 Seus dados estão seguros. Ao se inscrever, você concorda com a nossa <a href="#">Política de privacidade</a>.</p>` +
    `</form>`
  );
}

interface PopupOptions {
  title: string;
  text: string;
  button: string;
  decline: string;
}

/** Popup de saída: no editor aparece como caixa editável com rótulo. */
export function exitPopup(opts: PopupOptions) {
  return (
    `<div class="os-popup" data-os-widget="exit-popup" data-os-exit="1" data-os-mobile-seconds="25" data-os-scrollup="1" data-os-seconds="0" data-os-back="0" data-os-frequency="session" role="dialog" aria-modal="true" aria-label="Oferta especial" hidden>` +
    `<div class="os-popup__box">` +
    `<button type="button" class="os-popup__close" data-os-close aria-label="Fechar">×</button>` +
    `<h2>${opts.title}</h2>` +
    `<p>${opts.text}</p>` +
    buyButton(opts.button, { block: true }) +
    `<button type="button" class="os-popup__decline" data-os-close>${opts.decline}</button>` +
    `</div></div>`
  );
}

/**
 * Lista de exemplo da notificação (uma pessoa por linha, "Nome - Cidade"); o
 * usuário troca em Configurações › "Nomes e cidades".
 */
const SAMPLE_PEOPLE = [
  "Maria - São Paulo",
  "João - Rio de Janeiro",
  "Ana - Belo Horizonte",
  "Pedro - Curitiba",
  "Juliana - Salvador",
  "Lucas - Fortaleza",
  "Fernanda - Recife",
  "Rafael - Porto Alegre",
].join("&#10;");

/**
 * Aviso flutuante de prova social ("Nome, de Cidade — acabou de…"). O script
 * troca os textos a cada aviso; no editor aparece como cartão de exemplo.
 */
export function salesNotification(opts: { action: string; product?: string }) {
  const product = opts.product ? ` data-os-product="${opts.product}"` : "";
  return (
    `<div class="os-notify" data-os-widget="sales-notification" data-os-people="${SAMPLE_PEOPLE}" data-os-action="${opts.action}"${product} data-os-start="8" data-os-interval="18" data-os-duration="5" data-os-max="10" data-os-position="left" data-os-time="1" data-os-mobile="1" role="status" hidden>` +
    `<div class="os-notify__card"><img src="${avatarImage(3)}" alt="">` +
    `<p><strong data-os-sn="title">Maria, de São Paulo</strong><span data-os-sn="text">${opts.action}${opts.product ? ` ${opts.product}` : ""}</span><span data-os-sn="time">há 7 minutos</span></p>` +
    `</div></div>`
  );
}

/**
 * Rodapé com links para as páginas legais (escolhidas no editor), o link
 * "Preferências de cookies" (reabre o aviso de cookies; ver src/runtime/tracking) e aviso.
 */
export function footer(opts: { disclaimer?: string; links?: boolean } = {}) {
  const links =
    opts.links === false
      ? ""
      : `<ul class="os-footer-links"><li><a href="#">Política de privacidade</a></li><li><a href="#">Termos de uso</a></li><li><a href="#">Contato</a></li><li><a href="#" data-os-consent-open>Preferências de cookies</a></li></ul>`;
  const disclaimer = opts.disclaimer ? `<p class="os-disclaimer">${opts.disclaimer}</p>` : "";
  return (
    `<footer class="os-footer"><div class="os-container">` +
    links +
    `<p>© ${YEAR_MARKER} <span class="os-ph">{{EMPRESA}}</span> · CNPJ <span class="os-ph">{{CNPJ}}</span> · Todos os direitos reservados.</p>` +
    disclaimer +
    `</div></footer>`
  );
}

/** Aviso padrão de resultados (rodapé de páginas de venda). */
export const RESULTS_DISCLAIMER =
  "Os resultados podem variar de pessoa para pessoa. Este produto não garante a obtenção de resultados específicos; o desempenho depende da dedicação e da aplicação de cada um.";
