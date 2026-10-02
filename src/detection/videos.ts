/**
 * Players de vídeo conhecidos (VSL): domínios e extração do ID a partir da URL.
 *
 * Usado pelo clonador (src/worker/clone/vsl.ts) para dizer qual player a página
 * usa e se o vídeo é de terceiros (e deve ser trocado pelo seu).
 */
import type { VideoEmbed } from "@/worker/clone/types";

export type VideoProvider = VideoEmbed["provider"];

export interface VideoHost {
  provider: VideoProvider;
  /** Nome amigável mostrado na revisão. */
  label: string;
  /** Testa o hostname (sem porta). */
  host: RegExp;
}

/** Hosts de players conhecidos. Ordem importa: o primeiro que casar vence. */
export const VIDEO_HOSTS: readonly VideoHost[] = [
  {
    provider: "VTURB",
    label: "VTurb (ConverteAI)",
    host: /(?:^|\.)(?:converteai\.net|vturb\.com\.br|vturb\.com|vturb\.net)$/i,
  },
  { provider: "PANDA", label: "Panda Video", host: /(?:^|\.)pandavideo\.com(?:\.br)?$/i },
  {
    provider: "YOUTUBE",
    label: "YouTube",
    host: /(?:^|\.)(?:youtube\.com|youtube-nocookie\.com|youtu\.be)$/i,
  },
  { provider: "VIMEO", label: "Vimeo", host: /(?:^|\.)vimeo\.com$/i },
  { provider: "OTHER", label: "Wistia", host: /(?:^|\.)(?:wistia\.com|wistia\.net|wi\.st)$/i },
  { provider: "OTHER", label: "Vidalytics", host: /(?:^|\.)vidalytics\.com$/i },
  { provider: "OTHER", label: "Bunny Stream", host: /(?:^|\.)mediadelivery\.net$/i },
  { provider: "OTHER", label: "JW Player", host: /(?:^|\.)(?:jwplayer\.com|jwplatform\.com|jwpcdn\.com)$/i },
  { provider: "OTHER", label: "Vooplayer", host: /(?:^|\.)vooplayer\.com$/i },
  { provider: "OTHER", label: "Dailymotion", host: /(?:^|\.)dailymotion\.com$/i },
  { provider: "OTHER", label: "Loom", host: /(?:^|\.)loom\.com$/i },
];

const PROVIDER_LABEL: Record<VideoProvider, string> = {
  VTURB: "VTurb (ConverteAI)",
  PANDA: "Panda Video",
  YOUTUBE: "YouTube",
  VIMEO: "Vimeo",
  NATIVE: "Vídeo próprio (arquivo)",
  HLS: "Vídeo em streaming (HLS)",
  OTHER: "Outro player",
};

export interface ParsedVideoUrl {
  provider: VideoProvider;
  label: string;
  videoId?: string;
}

/** Converte em URL absoluta; devolve null se não der. */
function toUrl(raw: string, base?: string): URL | null {
  try {
    return new URL(raw.trim(), base);
  } catch {
    return null;
  }
}

/** Player conhecido para um hostname (ou URL). */
export function matchVideoHost(hostOrUrl: string): VideoHost | null {
  const host = hostOrUrl.includes("/") ? (toUrl(hostOrUrl)?.hostname ?? "") : hostOrUrl;
  if (!host) return null;
  return VIDEO_HOSTS.find((h) => h.host.test(host)) ?? null;
}

const YT_ID = /^[\w-]{11}$/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** ID do vídeo/player VTurb a partir de `…/players/<id>/…`. */
export function vturbIdFromUrl(url: string): string | undefined {
  return /\/players\/([a-f0-9]{12,})(?:[/?#]|$)/i.exec(url)?.[1];
}

/** ID do YouTube a partir de embed, watch, youtu.be, shorts ou live. */
export function youtubeIdFromUrl(url: string): string | undefined {
  const u = toUrl(url, "https://www.youtube.com/");
  if (!u) return undefined;
  const v = u.searchParams.get("v");
  if (v && YT_ID.test(v)) return v;
  if (/(?:^|\.)youtu\.be$/i.test(u.hostname)) {
    const id = u.pathname.split("/")[1];
    return id && YT_ID.test(id) ? id : undefined;
  }
  const m = /\/(?:embed|shorts|live|v|e)\/([\w-]{11})(?:[/?#]|$)/.exec(u.pathname);
  return m?.[1];
}

/** ID numérico do Vimeo. */
export function vimeoIdFromUrl(url: string): string | undefined {
  return /vimeo\.com\/(?:video\/|(?:channels\/[\w-]+\/)|(?:groups\/[\w-]+\/videos\/))?(\d{5,})/i.exec(url)?.[1];
}

/** ID do Panda Video (parâmetro `v` do embed ou UUID no caminho). */
export function pandaIdFromUrl(url: string): string | undefined {
  const u = toUrl(url);
  const v = u?.searchParams.get("v");
  if (v) return v;
  return UUID.exec(u?.pathname ?? url)?.[0];
}

function otherIdFromUrl(label: string, url: string): string | undefined {
  switch (label) {
    case "Wistia":
      return /\/(?:embed\/iframe|embed\/medias|medias)\/([a-z0-9]{6,})/i.exec(url)?.[1];
    case "Vidalytics":
      return /\/embeds\/[\w-]+\/([\w-]+)/i.exec(url)?.[1];
    case "Bunny Stream":
      return /\/(?:embed|play)\/\d+\/([0-9a-f-]{36})/i.exec(url)?.[1];
    case "JW Player":
      return /\/players\/([a-z0-9]{8})(?:-[a-z0-9]{8})?\.(?:js|html)/i.exec(url)?.[1];
    case "Dailymotion":
      return /\/(?:embed\/)?video\/([a-z0-9]+)/i.exec(url)?.[1];
    case "Loom":
      return /\/(?:embed|share)\/([0-9a-f]{32})/i.exec(url)?.[1];
    default:
      return undefined;
  }
}

/**
 * Identifica o player e o ID a partir de uma URL de embed/script.
 * Devolve null quando a URL não é de um player conhecido.
 */
export function parseVideoUrl(url: string): ParsedVideoUrl | null {
  const u = toUrl(url);
  if (!u || !/^https?:$/.test(u.protocol)) return null;
  const host = VIDEO_HOSTS.find((h) => h.host.test(u.hostname));
  if (!host) return null;
  const href = u.href;
  let videoId: string | undefined;
  switch (host.provider) {
    case "VTURB":
      videoId = vturbIdFromUrl(href);
      break;
    case "PANDA":
      videoId = pandaIdFromUrl(href);
      break;
    case "YOUTUBE":
      videoId = youtubeIdFromUrl(href);
      break;
    case "VIMEO":
      videoId = vimeoIdFromUrl(href);
      break;
    default:
      videoId = otherIdFromUrl(host.label, href);
  }
  return { provider: host.provider, label: host.label, ...(videoId ? { videoId } : {}) };
}

/** Parece um manifesto HLS (.m3u8)? */
export function isHlsUrl(url: string): boolean {
  return /\.m3u8(?:$|[?#])/i.test(url);
}

/** Tipos MIME de HLS usados em `<source type>`. */
export function isHlsMime(type: string | undefined): boolean {
  return !!type && /mpegurl/i.test(type);
}

/** Nome amigável do player de um vídeo detectado (ex.: "Panda Video", "Wistia"). */
export function videoProviderLabel(video: Pick<VideoEmbed, "provider" | "src">): string {
  if (video.provider === "OTHER" && video.src) {
    const host = matchVideoHost(video.src);
    if (host) return host.label;
  }
  return PROVIDER_LABEL[video.provider];
}
