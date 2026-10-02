/**
 * Tipos compartilhados do clonador (Fase 2).
 *
 * Fluxo: captura (Playwright ou importação ZIP/HTML) → Capture → build gera as
 * saídas EDITABLE e PRESERVE_JS → CloneJob.result (tela de revisão) → salvar.
 *
 * Convenção de arquivos: todo arquivo baixado vira `/os-assets/<sha256>.<ext>`
 * dentro do HTML/CSS guardado (ver ASSET_PREFIX). Na exportação ZIP isso vira
 * `assets/<sha256>.<ext>`.
 */

export const ASSET_PREFIX = "/os-assets/";

export type Device = "desktop" | "mobile";
export type CloneModeValue = "EDITABLE" | "PRESERVE_JS";

// ─── Rastreadores e chats ────────────────────────────────────────────────────

export type TrackerCategory = "PIXEL" | "ANALYTICS" | "TAG_MANAGER" | "CHAT" | "ADS" | "OTHER";

export interface TrackerMatch {
  /** Nome amigável, ex.: "Meta Pixel", "Google Tag Manager", "JivoChat". */
  vendor: string;
  category: TrackerCategory;
}

/** Item removido do clone (mostrado na revisão, restaurável). */
export interface RemovedTracker extends TrackerMatch {
  /** ID extraído quando possível (ex.: pixel 1234567890, GTM-ABC123). */
  pixelId?: string;
  /** Trecho original (HTML) para poder restaurar. */
  snippet: string;
  /** Onde estava: "head" ou "body". */
  location: "head" | "body";
  /** Como foi detectado: script externo, script inline, noscript, img/iframe pixel, meta, link. */
  kind: "script-src" | "script-inline" | "noscript" | "pixel" | "meta" | "link" | "network";
}

// ─── Checkouts ───────────────────────────────────────────────────────────────

export interface CheckoutCandidate {
  /** URL absoluta do checkout. */
  url: string;
  /** Plataforma reconhecida ("Hotmart", "Kiwify"…) ou "Desconhecida". */
  platform: string;
  /** Texto do botão/link (para o usuário reconhecer). */
  label?: string;
  source: "HREF" | "ONCLICK" | "FORM" | "SCRIPT";
  /** 0–100: 100 = domínio de plataforma conhecido. */
  confidence: number;
  /** Quantas vezes aparece na página. */
  occurrences: number;
}

// ─── Vídeos de VSL ───────────────────────────────────────────────────────────

export interface VideoEmbed {
  provider: "VTURB" | "PANDA" | "YOUTUBE" | "VIMEO" | "NATIVE" | "HLS" | "OTHER";
  /** ID do vídeo/player quando reconhecido. */
  videoId?: string;
  src?: string;
  /** true quando o vídeo é de terceiros e deve ser trocado pelo seu. */
  thirdParty: boolean;
  /**
   * Só para vídeos do próprio site (NATIVE): true = o arquivo foi baixado para
   * a cópia; false = continua no endereço original (opção "Não baixar", maior
   * que o limite ou falha no download).
   */
  downloaded?: boolean;
}

export interface VslDelay {
  /** Segundos até mostrar os elementos escondidos (botão de compra etc.). */
  seconds: number;
  /** Quantos elementos foram marcados com data-os-delay. */
  elements: number;
}

// ─── Funil ───────────────────────────────────────────────────────────────────

export interface FunnelSuggestion {
  url: string;
  /** Texto do link ou título. */
  label: string;
  kind: "UPSELL" | "DOWNSELL" | "THANK_YOU" | "OTHER";
  /** Por que foi sugerido (em português). */
  reason: string;
}

// ─── Proteção anti-robô ──────────────────────────────────────────────────────

export interface ProtectionReport {
  kind: "BOT_CHALLENGE" | "CAPTCHA" | "LOGIN_WALL" | "EMPTY_SHELL" | "HTTP_ERROR";
  /** Mensagem clara em português para o usuário. */
  message: string;
  /** Detalhe técnico curto (ex.: "cf-mitigated: challenge"). */
  detail?: string;
}

// ─── Avisos ──────────────────────────────────────────────────────────────────

export interface CloneWarning {
  code: string;
  message: string;
  url?: string;
}

// ─── Captura ─────────────────────────────────────────────────────────────────

/** Uma resposta de rede guardada durante a captura. */
export interface CapturedResponse {
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
}

/** Resultado bruto da captura de um dispositivo. */
export interface Capture {
  device: Device;
  requestedUrl: string;
  finalUrl: string;
  status: number;
  title: string;
  /** HTML original (resposta do documento principal), já em UTF-8. */
  originalHtml: string;
  /** DOM depois do JavaScript (com shadow DOM aberto e CSS-in-JS embutidos). */
  renderedHtml: string;
  /** Respostas capturadas (chave = URL absoluta, sem #hash). */
  responses: Map<string, CapturedResponse>;
  /** Requisições bloqueadas por serem rastreadores/chats. */
  blocked: { url: string; match: TrackerMatch }[];
  /** Print de página inteira (PNG). */
  screenshot?: Buffer;
  protection?: ProtectionReport | null;
}

// ─── Resultado guardado em CloneJob.result ───────────────────────────────────

export interface DeviceOutput {
  /** Print do original (storage key). */
  screenshotKey?: string;
  outputs: {
    EDITABLE: { htmlKey: string };
    PRESERVE_JS: { htmlKey: string; assetMap: Record<string, string> };
  };
}

/** Arquivo baixado na clonagem (vira linha em Asset ao salvar a oferta). */
export interface ClonedAsset {
  key: string;
  sha256: string;
  kind: "IMAGE" | "FONT" | "VIDEO" | "STYLE" | "SCRIPT" | "ICON" | "DOCUMENT" | "OTHER";
  mime: string;
  bytes: number;
  sourceUrl: string;
}

export interface CloneResult {
  title: string;
  finalUrl: string;
  /** true quando desktop e celular recebem o mesmo HTML (página responsiva). */
  responsive: boolean;
  devices: Partial<Record<Device, DeviceOutput>>;
  removed: RemovedTracker[];
  checkouts: CheckoutCandidate[];
  funnel: FunnelSuggestion[];
  videos: VideoEmbed[];
  delay?: VslDelay | null;
  warnings: CloneWarning[];
  /** Modo sugerido para esta página. */
  suggestedMode: CloneModeValue;
  /** Miniatura para o card da oferta (storage key). */
  thumbnailKey?: string;
  /** Arquivos baixados (todas as saídas). */
  assets: ClonedAsset[];
  stats: { assets: number; bytes: number; failed: number; blockedRequests: number; durationMs: number };
}
