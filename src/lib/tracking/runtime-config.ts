/**
 * Configuração que o script de rastreamento das páginas recebe (JSON embutido
 * no <head> como <script type="application/json" id="os-tracking">).
 *
 * É PÚBLICA: vai para o HTML do visitante. Nunca contém tokens de API (esses só
 * vão para o eventos.php do ZIP). Montada no servidor por buildTrackingConfig e
 * lida no navegador por src/runtime/tracking.
 */
import type { PixelVendorId, TrackingEventId, TrackingSettings } from "./schema";

export const TRACKING_CONFIG_ID = "os-tracking";
export const TRACKING_CONFIG_VERSION = 1;
/** Atributo da tag do script de rastreamento (<script src="/os-tracking.js" data-os-tracking>). */
export const TRACKING_SCRIPT_ATTR = "data-os-tracking";

/**
 * Código livre que espera o consentimento (gateCode em ./inject). O bloco
 * inteiro fica inerte — nada carrega (scripts, imagens, iframes, <link
 * rel=preload/stylesheet>, srcdoc, <picture>, poster, on*…) até o script das
 * páginas ativá-lo depois do "Aceitar" (ou direto, sem banner/só aviso):
 * <script type="application/json" data-os-consent="marketing" data-os-block>
 * "…código em JSON…"</script> — texto que nenhum pré-carregamento lê.
 * Na ativação, o conteúdo entra no lugar do bloco (sem <noscript>, que só vale
 * sem JavaScript) e os <script> rodam na ordem, os externos um de cada vez.
 *
 * Formatos antigos (ainda ativados, em HTML exportado antes):
 * <template data-os-consent="marketing">…código original…</template> (o
 * pré-carregamento do Firefox busca as imagens de dentro dele: não sai mais),
 * <script type="text/plain" data-os-consent data-os-type="…type original…"> e
 * <img>/<iframe data-os-consent data-os-src="…" [data-os-srcset="…"]>.
 * O valor de data-os-consent é "analytics" ou "marketing" (CodeCategory em minúsculas).
 */
export const CONSENT_GATE_ATTR = "data-os-consent";
/** Marca o bloco em JSON (<script type="application/json" data-os-consent data-os-block>). */
export const CONSENT_BLOCK_ATTR = "data-os-block";
export const CONSENT_TYPE_ATTR = "data-os-type";
export const CONSENT_SRC_ATTR = "data-os-src";
export const CONSENT_SRCSET_ATTR = "data-os-srcset";
export type ConsentGateCategory = "analytics" | "marketing";

/** Tela "Testar pixels": endereço (na origem da prévia) que recebe cada passo. */
export const PIXEL_TEST_ENDPOINT = "/__os/pixel-test";
/** Parâmetro que liga o modo teste na prévia (?os_teste=<token da sessão>). */
export const PIXEL_TEST_PARAM = "os_teste";
/** Tamanho máximo de um PixelTestReport em JSON (bytes). */
export const PIXEL_TEST_MAX_BODY = 4096;
/**
 * `event` do passo de carregamento do script de um pixel (status LOADED, ou
 * BLOCKED/ERROR quando um bloqueador ou a rede impediu). Nos eventos, `event` é o
 * nome enviado à plataforma (PageView, Lead…) com status FIRED/BLOCKED/ERROR.
 */
export const PIXEL_TEST_LOAD_EVENT = "load";

/**
 * - live: página publicada (ZIP) — carrega pixels e dispara eventos de verdade;
 * - preview: prévia no painel — NÃO carrega pixels (não suja os dados), só registra no console;
 * - test: tela "Testar pixels" — carrega de verdade e informa cada passo ao painel.
 */
export type TrackingMode = "live" | "preview" | "test";

export interface RuntimePixel {
  vendor: PixelVendorId;
  id: string;
  /** Só opções públicas (ex.: rótulos de conversão do Google Ads, opções do script de UTMs). */
  options: Record<string, unknown>;
}

/**
 * Teste A/B: nome do parâmetro com a versão em cada evento (Meta
 * custom_data.os_versao, parâmetro de evento e propriedade de usuário do GA4,
 * properties.os_versao do TikTok e do Kwai, campo do eventos.php).
 */
export const VERSION_PARAM = "os_versao";

/**
 * Marca da versão no checkout ("versao-b"), em um parâmetro que a plataforma
 * mostra no relatório de vendas — só quando o link ainda não tem esse
 * parâmetro (nem do próprio link, nem repassado da chegada do visitante):
 * - Hotmart, Kiwify e Eduzz: `src` (a "origem" da venda no relatório; `sck` e
 *   `xcod` nunca são tocados: são da UTMify e dos rastreadores);
 * - as outras: `utm_content` — só quando o visitante não trouxe um
 *   (o utm_content do anúncio, "nome|ID", é o que a UTMify e as plataformas
 *   usam para saber qual anúncio vendeu: nunca é alterado).
 */
export const VERSION_SRC_PLATFORMS = ["Hotmart", "Kiwify", "Eduzz"] as const;
export const VERSION_MARK_PREFIX = "versao-";

/** Versão A/B da página (só quando a página tem mais de uma versão). */
export interface RuntimeVariant {
  /** Letra da versão ("B"): vai em os_versao. */
  name: string;
  /** Pasta da versão no ZIP, relativa à da página ("oferta-b/"). */
  folder: string;
  /**
   * Checkouts que recebem a marca em `src` (Hotmart, Kiwify, Eduzz), no mesmo
   * formato de checkoutHosts; os outros recebem em `utm_content`.
   */
  srcHosts: string[];
}

export interface RuntimeRule {
  event: TrackingEventId;
  trigger: "PAGE_LOAD" | "TIME_ON_PAGE" | "SCROLL_DEPTH" | "CHECKOUT_CLICK" | "ELEMENT_CLICK" | "FORM_SUBMIT";
  value: number | null;
  selector: string | null;
}

export interface TrackingRuntimeConfig {
  v: typeof TRACKING_CONFIG_VERSION;
  mode: TrackingMode;
  consent: Pick<
    TrackingSettings["consent"],
    "mode" | "text" | "acceptLabel" | "rejectLabel" | "noticeLabel" | "policyLabel" | "position" | "theme"
  > & {
    /** Endereço da política de privacidade (página LEGAL da oferta), já resolvido. */
    policyUrl: string | null;
  };
  pixels: RuntimePixel[];
  /** Regras desta página (as da oferta inteira + as só desta página). */
  rules: RuntimeRule[];
  /** Nome final de cada evento por plataforma (já com as personalizações). null = não dispara. */
  names: Partial<Record<PixelVendorId, Partial<Record<TrackingEventId, string | null>>>>;
  forwarding: TrackingSettings["forwarding"];
  value: TrackingSettings["value"];
  /** Chaves dos links da oferta que são checkout (CHECKOUT/UPSELL/DOWNSELL): cliques = InitiateCheckout. */
  checkoutLinkKeys: string[];
  /**
   * Domínios de checkout (Hotmart, Kiwify… e os dos links de checkout da oferta)
   * para reconhecer botões sem link da oferta. Em minúsculas e sem "www.";
   * ".dominio.com" vale para qualquer subdomínio (não o domínio puro). Com
   * caminho ("app.monetizze.com.br/checkout/", ".mycartpanda.com/checkout"),
   * vale só para endereços cujo caminho começa assim.
   */
  checkoutHosts: string[];
  /**
   * A página tem código livre de Estatística/Marketing (da oferta ou da
   * página): o aviso de cookies aparece mesmo sem pixels cadastrados.
   * Preenchido por renderPageHtml.
   */
  marketingCode: boolean;
  /** API de Conversões/Events API pelo eventos.php (só no ZIP, quando ligado). */
  server: { endpoint: string; vendors: PixelVendorId[] } | null;
  /** Tela de teste: para onde mandar cada passo. */
  test: { endpoint: string; token: string } | null;
  /**
   * Versão A/B mostrada (página com mais de uma versão): vai em todo evento
   * (VERSION_PARAM) e marca os links de checkout (ver VERSION_SRC_PLATFORMS).
   * Ausente/null = página com uma versão só.
   */
  variant?: RuntimeVariant | null;
}

/**
 * Evento que o script manda ao painel na tela de teste (POST JSON, ou texto via
 * sendBeacon, para PIXEL_TEST_ENDPOINT na mesma origem; até PIXEL_TEST_MAX_BODY).
 * Limites validados no servidor (src/lib/tracking/test-report.ts): event até 80
 * caracteres, detail com até 20 chaves (nomes até 40) e textos até 300.
 */
export interface PixelTestReport {
  token: string;
  vendor: PixelVendorId | "CONSENT" | "RUNTIME";
  event: string;
  status: "LOADED" | "FIRED" | "BLOCKED" | "ERROR";
  detail?: Record<string, string | number | boolean | null>;
}
