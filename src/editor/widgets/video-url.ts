/**
 * Endereços de vídeo colados pelo usuário → endereço de incorporação (embed).
 * Aceita links do navegador, links curtos, Shorts, lives, o código <iframe>
 * inteiro e, no YouTube, só o ID. Funções puras (testadas em
 * tests/unit/blocks-options.test.ts).
 */

export type VideoProvider = "youtube" | "vimeo" | "panda" | "other";

export interface VideoEmbed {
  provider: VideoProvider;
  src: string;
  id?: string;
}

/** Se for um código <iframe ...>, devolve o src; senão, o próprio texto. */
export function srcFromEmbedCode(input: string) {
  const m = /<iframe\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/i.exec(input);
  return (m ? m[1] : input).trim().replace(/&amp;/g, "&");
}

export function youtubeId(url: string): string | null {
  // "videoseries" (código de playlist do YouTube) também tem 11 letras.
  if (/^[\w-]{11}$/.test(url)) return url === "videoseries" ? null : url;
  const m =
    /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/|e\/)|youtu\.be\/)([\w-]{11})(?![\w-])/i.exec(
      url,
    );
  return m && m[1] !== "videoseries" ? m[1] : null;
}

/** "90", "90s", "1m30s", "1h2m3s" → segundos. */
function seconds(t: string): number {
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
}

export function vimeoParts(url: string): { id: string; hash?: string } | null {
  let m = /player\.vimeo\.com\/video\/(\d+)(?:\?(?:[^#]*&)?h=([\da-f]+))?/i.exec(url);
  if (m) return { id: m[1], hash: m[2] };
  m = /vimeo\.com\/(?:[^?#]*?\/)?(\d{5,})(?:\/([\da-f]{6,}))?(?=$|[/?#])/i.exec(url);
  return m ? { id: m[1], hash: m[2] } : null;
}

/**
 * Normaliza o endereço do vídeo. Devolve null se não der para usar — inclusive
 * páginas que não são um vídeo incorporável (canal ou busca do YouTube, painel
 * do Panda, página de canal/grupo do Vimeo): num iframe elas só dariam erro.
 */
export function normalizeVideoUrl(input: string): VideoEmbed | null {
  let url = srcFromEmbedCode(input);
  if (!url) return null;
  if (url.startsWith("//")) url = `https:${url}`;
  const isYoutube = /youtu\.?be|youtube(?:-nocookie)?\.com/i.test(url);

  // Playlist: código de incorporação (embed/videoseries?list=…) ou página da playlist.
  const list = /[?&]list=([\w-]+)/.exec(url)?.[1];
  if (isYoutube && list && /\/(?:embed\/videoseries|playlist)\b/i.test(url)) {
    return { provider: "youtube", src: `https://www.youtube.com/embed/videoseries?list=${list}&rel=0` };
  }

  const yt = isYoutube || /^[\w-]{11}$/.test(url) ? youtubeId(url) : null;
  if (yt) {
    const params = new URLSearchParams({ rel: "0" });
    const start = /[?&#](?:t|start)=([\dhms]+)/.exec(url);
    if (start && seconds(start[1])) params.set("start", String(seconds(start[1])));
    for (const keep of ["autoplay", "mute", "controls", "loop"]) {
      const v = new RegExp(`[?&]${keep}=(\\d)`).exec(url);
      if (v) params.set(keep, v[1]);
    }
    return { provider: "youtube", id: yt, src: `https://www.youtube.com/embed/${yt}?${params}` };
  }
  // Outras páginas do YouTube (canal, @perfil, busca…) não tocam num iframe.
  if (isYoutube) return null;

  const isVimeo = /vimeo\.com/i.test(url);
  // Coleção (showcase) e evento ao vivo têm endereço de incorporação próprio.
  const vimeoPage = /vimeo\.com\/(showcase|event)\/(\d+)(\/embed\b[^?#]*)?/i.exec(url);
  if (vimeoPage) {
    const embed = vimeoPage[3] ?? "/embed";
    return { provider: "vimeo", src: `https://vimeo.com/${vimeoPage[1].toLowerCase()}/${vimeoPage[2]}${embed}` };
  }
  const vimeo = isVimeo ? vimeoParts(url) : null;
  if (vimeo) {
    const params = new URLSearchParams();
    if (vimeo.hash) params.set("h", vimeo.hash);
    for (const keep of ["autoplay", "muted", "loop"]) {
      const v = new RegExp(`[?&]${keep}=(\\d)`).exec(url);
      if (v) params.set(keep, v[1]);
    }
    const qs = params.toString();
    return { provider: "vimeo", id: vimeo.id, src: `https://player.vimeo.com/video/${vimeo.id}${qs ? `?${qs}` : ""}` };
  }

  // Página do Vimeo sem número de vídeo (canal, grupo, perfil).
  if (isVimeo) return null;

  if (!/^https?:\/\//i.test(url)) return null;
  const secure = url.replace(/^http:/i, "https:");
  if (/pandavideo/i.test(url)) {
    // Só o player (player-….pandavideo.com.br/embed/?v=…); o painel do Panda não toca.
    return /^https:\/\/player[\w.-]*pandavideo\.[\w.]+\/embed/i.test(secure)
      ? { provider: "panda", src: secure }
      : null;
  }
  return { provider: "other", src: secure };
}

/** Liga/desliga "tocar sozinho" (sem som, exigência dos navegadores). */
export function withAutoplay(src: string, on: boolean): string {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return src;
  }
  const vimeo = /vimeo\.com/i.test(url.host);
  const panda = /pandavideo/i.test(url.host);
  const keys = vimeo ? ["autoplay", "muted"] : panda ? ["autoplay", "muted"] : ["autoplay", "mute"];
  for (const k of keys) {
    if (on) url.searchParams.set(k, panda ? "true" : "1");
    else url.searchParams.delete(k);
  }
  return url.toString();
}

export function hasAutoplay(src: string) {
  return /[?&]autoplay=(1|true)\b/i.test(src);
}

export function youtubeThumb(src: string) {
  const id = youtubeId(src);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

// ─── VTurb ───────────────────────────────────────────────────────────────────

export interface VturbInfo {
  account?: string;
  player?: string;
  version?: "v4" | "v3";
}

/**
 * Lê o código de incorporação do VTurb (novo ou antigo) ou só o ID do player.
 * Ex.: ...scripts.converteai.net/<conta>/players/<player>/v4/player.js...
 */
export function parseVturbCode(code: string): VturbInfo | null {
  const s = code.trim();
  if (!s) return null;
  const m = /converteai\.net\/([\w-]+)\/players\/([\w-]+)\/(v4\/)?player\.js/i.exec(s);
  if (m) return { account: m[1], player: m[2], version: m[3] ? "v4" : "v3" };
  const id = /\bvid[-_]([\da-f]{16,})\b/i.exec(s);
  if (id) return { player: id[1], version: /vturb-smartplayer/i.test(s) ? "v4" : "v3" };
  if (/^[\da-f]{16,40}$/i.test(s)) return { player: s };
  return null;
}
