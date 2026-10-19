/**
 * Biblioteca de imagens da oferta (upload do editor).
 *
 * - Fotos (JPG, PNG, WebP, AVIF, GIF parado) viram WebP qualidade 82, com no
 *   máximo 2560 px de largura (nunca aumenta), girando pela orientação EXIF e
 *   sem metadados (GPS, câmera…).
 * - GIF e AVIF animados ficam como vieram (a conversão perderia a animação).
 *   WebP animado é reprocessado mantendo os quadros.
 * - SVG passa por uma limpeza: sem <script>, sem atributos on*, sem links
 *   javascript:, sem <foreignObject>.
 * - Ícone .ico (favicon) não passa pelo sharp (ele não lê ICO): é conferido
 *   pelos bytes (src/lib/ico.ts), com limite de 1 MB, e guardado como veio.
 * - Arquivos são guardados pelo hash (src/lib/storage.ts) e ligados à oferta
 *   por uma linha Asset. O editor recebe no formato do GrapesJS:
 *   { type: "image", src: "/os-assets/<sha>.<ext>", name, width, height }.
 */
import { load } from "cheerio";
import type { AnyNode, Element } from "domhandler";
import sharp, { type Metadata } from "sharp";
import { prisma } from "@/lib/db";
import { xmlProlog } from "@/lib/doctype";
import { UserError, uniqueViolationFields } from "@/lib/errors";
import { ICO_MAX_BYTES, looksLikeIco, readIco } from "@/lib/ico";
import { putContentAddressed } from "@/lib/storage";
import { createFetcher, type Fetcher } from "@/worker/clone/fetcher";

/** Limites do upload (o editor usa os mesmos valores para avisar antes de enviar). */
export const IMAGE_UPLOAD_LIMITS = {
  /** Tamanho máximo de cada arquivo enviado. */
  maxFileBytes: 15 * 1024 * 1024,
  /** Tamanho máximo de um ícone .ico (guardado como veio, sem conversão). */
  maxIconBytes: ICO_MAX_BYTES,
  /** Quantidade máxima de arquivos por envio. */
  maxFiles: 20,
  /** Pixels máximos na entrada (protege contra "bombas" de descompressão). */
  maxInputPixels: 50_000_000,
  /** Largura máxima da imagem final. */
  maxWidth: 2560,
  /** Altura máxima (limite do formato WebP). */
  maxHeight: 16_383,
  /** Qualidade do WebP gerado. */
  webpQuality: 82,
} as const;

/** Formatos aceitos (detectados pelo conteúdo, não pelo nome). */
export type ImageFormat = "jpeg" | "png" | "webp" | "gif" | "avif" | "svg" | "ico";

const ASSET_PREFIX = "/os-assets/";
const STORAGE_KEY_RE = /^a\/[0-9a-f]{2}\/([0-9a-f]{64}\.[a-z0-9]{1,8})$/;
const ACCEPTED_TEXT = "JPG, PNG, WebP, GIF, AVIF, SVG ou ICO";

/** Erro com mensagem para o usuário e o status HTTP adequado. */
export class AssetError extends UserError {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "AssetError";
  }
}

/** Arquivo recebido. `read` só é chamado depois de conferir o tamanho. */
export interface ImageUploadInput {
  name: string;
  size: number;
  read: () => Promise<Uint8Array>;
}

export interface ProcessedImage {
  data: Uint8Array;
  ext: "webp" | "gif" | "avif" | "svg" | "ico";
  mime: string;
  width: number | null;
  height: number | null;
}

/** Imagem no formato que o gerenciador de imagens do GrapesJS entende. */
export interface LibraryImage {
  type: "image";
  src: string;
  name: string;
  width?: number;
  height?: number;
  /** Tamanho do arquivo final, em bytes. */
  bytes: number;
}

export interface UploadFailure {
  name: string;
  error: string;
  status: number;
}

export interface UploadResult {
  data: LibraryImage[];
  errors: UploadFailure[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Nomes e mensagens
// ─────────────────────────────────────────────────────────────────────────────

/** Nome de arquivo seguro para mostrar (sem pastas, sem caracteres de controle). */
export function cleanFileName(raw: string | null | undefined, fallback = "imagem"): string {
  const base = (raw ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFC")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: remove caracteres de controle do nome
    .replace(/[\u0000-\u001f\u007f<>"]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return cleaned || fallback;
}

/** Tamanho em MB com uma casa, arredondado para cima (15 MB + 1 byte = "15,1 MB"). */
function formatMb(bytes: number) {
  const mb = Math.ceil((bytes / (1024 * 1024)) * 10) / 10;
  return `${mb.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}

const tooLarge = (name: string, bytes: number) =>
  new AssetError(`"${name}" tem ${formatMb(bytes)}. O limite é 15 MB por imagem.`, 413);
const unsupported = (name: string) => new AssetError(`"${name}" não é uma imagem aceita. Envie ${ACCEPTED_TEXT}.`, 415);
const unreadable = (name: string) =>
  new AssetError(`Não foi possível ler "${name}". O arquivo pode estar corrompido.`, 422);
const iconTooLarge = (name: string, bytes: number) =>
  new AssetError(
    `"${name}" tem ${formatMb(bytes)}. Um ícone .ico pode ter no máximo 1 MB (ícones de aba costumam ter poucos KB).`,
    413,
  );
const badIcon = (name: string) =>
  new AssetError(
    `"${name}" não é um ícone .ico válido: o arquivo pode estar corrompido. Exporte o ícone de novo ou envie um PNG.`,
    422,
  );
const tooManyPixels = (name: string) =>
  new AssetError(
    `"${name}" tem resolução grande demais (acima de 50 megapixels). Reduza a imagem e envie de novo.`,
    413,
  );

// ─────────────────────────────────────────────────────────────────────────────
// Detecção do formato
// ─────────────────────────────────────────────────────────────────────────────

function ascii(data: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...data.subarray(start, end));
}

function decodeText(data: Uint8Array): string {
  if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder("utf-16le").decode(data.subarray(2));
  if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder("utf-16be").decode(data.subarray(2));
  const text = new TextDecoder("utf-8").decode(data);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Elemento raiz de um SVG (com ou sem prefixo), logo depois do prólogo. */
const SVG_ROOT_RE = /<(?:[a-z_][\w.-]*:)?svg[\s>/]/iy;

/**
 * Início típico de um SVG: declaração XML, comentários, instruções e DOCTYPE
 * opcionais (lidos por `xmlProlog`, em tempo linear) e <svg.
 */
function startsLikeSvg(text: string): boolean {
  SVG_ROOT_RE.lastIndex = xmlProlog(text).end;
  return SVG_ROOT_RE.test(text);
}

/** Descobre o formato pelos primeiros bytes. null = não é um formato aceito. */
export function sniffImageFormat(data: Uint8Array): ImageFormat | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpeg";
  if (data.length >= 8 && ascii(data, 0, 8) === "\x89PNG\r\n\x1a\n") return "png";
  if (data.length >= 6 && /^GIF8[79]a$/.test(ascii(data, 0, 6))) return "gif";
  if (data.length >= 12 && ascii(data, 0, 4) === "RIFF" && ascii(data, 8, 12) === "WEBP") return "webp";
  if (ftypBrands(data).some((b) => b === "avif" || b === "avis")) return "avif";
  if (looksLikeIco(data)) return "ico";
  if (data[0] === 0x3c || data[0] === 0xef || data[0] === 0xff || data[0] === 0xfe || data[0] <= 0x20) {
    if (startsLikeSvg(decodeText(data.subarray(0, 8192)))) return "svg";
  }
  return null;
}

/** Marcas do cabeçalho "ftyp" (AVIF, HEIC…). Vazio se não for um arquivo ISO-BMFF. */
function ftypBrands(data: Uint8Array): string[] {
  if (data.length < 16 || ascii(data, 4, 8) !== "ftyp") return [];
  const declared = ((data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]) >>> 0;
  const boxSize = Math.min(data.length, Math.max(16, declared), 256);
  const brands = [ascii(data, 8, 12)];
  for (let i = 16; i + 4 <= boxSize; i += 4) brands.push(ascii(data, i, i + 4));
  return brands;
}

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"]);

// ─────────────────────────────────────────────────────────────────────────────
// Limpeza de SVG
// ─────────────────────────────────────────────────────────────────────────────

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const XHTML_NS = "http://www.w3.org/1999/xhtml";

/** Elementos removidos por inteiro (comparação pelo nome local, sem prefixo). */
const BLOCKED_ELEMENTS = new Set([
  "script",
  "foreignobject",
  "iframe",
  "frame",
  "frameset",
  "embed",
  "object",
  "applet",
  "handler",
  "listener",
  "base",
  "link",
  "meta",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "audio",
  "video",
]);
/**
 * Limpeza leve (SVGs baixados na clonagem): só sai o que roda código ou abre
 * outro documento na origem do site — o desenho (foreignObject, <style>,
 * @import de fontes) fica como veio.
 */
const ACTIVE_ELEMENTS = new Set([
  "script",
  "handler",
  "listener",
  "iframe",
  "frame",
  "frameset",
  "embed",
  "object",
  "applet",
  "base",
  "meta",
]);
const ANIMATION_ELEMENTS = new Set(["animate", "set", "animatetransform", "animatemotion", "animatecolor"]);
/** Atributos que carregam endereços (href, xlink:href, valores animados…). */
const URL_ATTRIBUTES = new Set(["href", "src", "action", "formaction", "from", "to", "values", "by"]);
/** data: permitido só para imagens comuns embutidas. */
const SAFE_DATA_URL = /^data:image\/(?:png|jpe?g|gif|webp|avif);/;
/** Na limpeza leve: qualquer imagem embutida (dentro de uma imagem, um SVG não roda scripts). */
const IMAGE_DATA_URL = /^data:image\//;
const DANGEROUS_CSS = /expression\s*\(|javascript:|vbscript:|-moz-binding|behavior\s*:/i;

const localName = (name: string) => (name.split(":").pop() ?? name).toLowerCase();
const prefixOf = (name: string) => (name.includes(":") ? name.split(":")[0] : null);
/** Valor sem espaços/controles e em minúsculas ("jav&#9;ascript:" já vem decodificado). */
// biome-ignore lint/suspicious/noControlCharactersInRegex: normalização contra ofuscação
const compact = (value: string) => value.replace(/[\x00-\x20\x7f-\xa0\u200b-\u200f\ufeff]/g, "").toLowerCase();

/**
 * Entidades simples do DOCTYPE (o Illustrator declara os namespaces assim:
 * <!ENTITY ns_svg "http://www.w3.org/2000/svg">). Só valores literais, sem
 * entidades aninhadas — nada de expansão exponencial.
 */
function expandSimpleEntities(text: string): string {
  // Só o DOCTYPE do prólogo (antes do <svg>), lido em tempo linear.
  const doctype = xmlProlog(text).doctypes.find((d) => d.subset !== null);
  if (!doctype?.subset) return text;
  const subset = doctype.subset;
  const entities = new Map<string, string>();
  const re = /<!ENTITY\s+([A-Za-z_][\w.-]*)\s+(?:"([^"%&<]{0,2000})"|'([^'%&<]{0,2000})')\s*>/g;
  for (let m = re.exec(subset); m && entities.size < 100; m = re.exec(subset)) {
    entities.set(m[1], m[2] ?? m[3] ?? "");
  }
  const body = text.slice(0, doctype.start) + text.slice(doctype.end);
  if (!entities.size) return body;
  return body.replace(/&([A-Za-z_][\w.-]*);/g, (all, name: string) => {
    const value = entities.get(name);
    return value === undefined ? all : value.replace(/[<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  });
}

function parseLength(value: string | undefined): number | null {
  const m = /^\s*([0-9]*\.?[0-9]+(?:e[+-]?\d+)?)\s*(px|pt|pc|mm|cm|in)?\s*$/i.exec(value ?? "");
  if (!m) return null;
  const factor: Record<string, number> = { px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 };
  const n = Number(m[1]) * factor[(m[2] ?? "px").toLowerCase()];
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/**
 * Metadados de SVG tirados dos UPLOADS (modo estrito): quem é o dono, com qual
 * programa foi feito, o nome do arquivo e o caminho dele. `<metadata>` carrega
 * autor/licença (RDF/dc/cc); `<title>`/`<desc>` podem ter nome ou "feito por…";
 * os atributos/elementos de editor (Inkscape/Sodipodi) trazem `docname` (o nome
 * do arquivo) e `export-filename` (um caminho que pode ter o nome de usuário).
 * Em páginas CLONADAS (keepContent) nada disso é mexido — lá os metadados são do
 * site copiado, não do dono da oferta, e o SVG limpo fica byte a byte igual.
 */
const META_SVG_ELEMENTS = new Set(["metadata", "title", "desc"]);
const META_SVG_PREFIXES = new Set(["sodipodi", "inkscape", "dc", "cc", "rdf"]);

export interface SanitizedSvg {
  svg: string;
  width: number | null;
  height: number | null;
  /** Quantos elementos/atributos/instruções que rodam código saíram. */
  removed: number;
}

export interface SanitizeSvgOptions {
  /**
   * Limpeza leve (SVGs baixados na clonagem): tira só o que executa código —
   * scripts, handler/listener, atributos on*, endereços javascript:, data: que
   * não seja imagem, iframes/objetos e animações que trocam href/on* — e mantém
   * foreignObject, HTML dentro dele e <style> como vieram.
   */
  keepContent?: boolean;
}

/**
 * Remove tudo o que poderia executar código num SVG. Devolve só o elemento
 * <svg> raiz (declarações, DOCTYPE e instruções de processamento — inclusive
 * <?xml-stylesheet?> — ficam de fora). Lança AssetError se não houver <svg>.
 */
export function sanitizeSvg(text: string, name = "imagem.svg", options: SanitizeSvgOptions = {}): SanitizedSvg {
  const keep = options.keepContent === true;
  // <?xml-stylesheet?> pode trazer XSLT (que monta scripts): fica de fora da saída.
  let removed = /<\?xml-stylesheet\b/i.test(text) ? 1 : 0;
  const $ = load(expandSimpleEntities(text), { xml: true });
  const root = $.root()
    .children()
    .toArray()
    .find((el) => localName(el.tagName) === "svg");
  if (!root) throw new AssetError(`"${name}" não é um SVG válido.`, 415);

  const elements = () =>
    $("*")
      .toArray()
      .filter((n): n is Element => "attribs" in n);

  // Prefixos ligados ao HTML (ex.: xmlns:h="http://www.w3.org/1999/xhtml").
  const xhtmlPrefixes = new Set<string>();
  for (const el of elements()) {
    for (const [attr, value] of Object.entries(el.attribs)) {
      if (attr.toLowerCase().startsWith("xmlns:") && value.trim() === XHTML_NS) xhtmlPrefixes.add(attr.slice(6));
    }
  }

  const clean = (node: AnyNode) => {
    if (node.type === "directive" || node.type === "comment") {
      $(node).remove();
      return;
    }
    if (node.type !== "tag" && node.type !== "script" && node.type !== "style") return;
    const el = node as Element;
    const tag = el.tagName;
    const local = localName(tag);
    const prefix = prefixOf(tag);
    const isHtml = (prefix !== null && xhtmlPrefixes.has(prefix)) || el.attribs.xmlns?.trim() === XHTML_NS;
    const animatesDangerous =
      ANIMATION_ELEMENTS.has(local) &&
      /^(?:on|href$)/.test(localName(el.attribs.attributeName ?? el.attribs.attributename ?? ""));
    const blocked = keep ? ACTIVE_ELEMENTS.has(local) : BLOCKED_ELEMENTS.has(local) || isHtml;
    // Uploads (modo estrito): tira os metadados que identificam o dono — <metadata>,
    // <title>, <desc> e qualquer elemento de editor (inkscape:, sodipodi:, rdf:…).
    const metaElement = !keep && (META_SVG_ELEMENTS.has(local) || META_SVG_PREFIXES.has(prefix ?? ""));
    if (blocked || animatesDangerous || metaElement) {
      $(el).remove();
      removed++;
      return;
    }
    for (const [attr, value] of Object.entries(el.attribs)) {
      const attrLocal = localName(attr);
      const v = compact(value);
      // Atributos de editor (sodipodi:docname, inkscape:export-filename…) e as
      // declarações xmlns deles: só nos uploads (modo estrito).
      const metaAttr =
        !keep &&
        (META_SVG_PREFIXES.has(prefixOf(attr) ?? "") ||
          (attr.toLowerCase().startsWith("xmlns:") && META_SVG_PREFIXES.has(attr.slice(6).toLowerCase())));
      const bad =
        attrLocal.startsWith("on") ||
        /(?:java|vb|live)script:/.test(v) ||
        (URL_ATTRIBUTES.has(attrLocal) && v.startsWith("data:") && !(keep ? IMAGE_DATA_URL : SAFE_DATA_URL).test(v)) ||
        (!keep && attrLocal === "style" && DANGEROUS_CSS.test(value));
      if (bad || metaAttr) {
        $(el).removeAttr(attr);
        removed++;
      }
    }
    if (local === "style" && !keep) {
      const css = $(el).text();
      if (DANGEROUS_CSS.test(css)) {
        $(el).remove();
        return;
      }
      const withoutImports = css.replace(/@import\s+[^;]*;?/gi, "");
      if (withoutImports !== css) $(el).text(withoutImports);
    }
    for (const child of [...el.children]) clean(child);
  };
  clean(root);

  const $root = $(root);
  if (!root.attribs.xmlns) $root.attr("xmlns", SVG_NS);
  const usesXlink = elements().some((el) => Object.keys(el.attribs).some((a) => a.startsWith("xlink:")));
  if (usesXlink && !root.attribs["xmlns:xlink"]) $root.attr("xmlns:xlink", XLINK_NS);

  let width = parseLength(root.attribs.width);
  let height = parseLength(root.attribs.height);
  const viewBox = (root.attribs.viewBox ?? root.attribs.viewbox ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
    if (width && !height) height = Math.round((width * viewBox[3]) / viewBox[2]);
    else if (height && !width) width = Math.round((height * viewBox[2]) / viewBox[3]);
    else if (!width && !height) {
      width = Math.round(viewBox[2]);
      height = Math.round(viewBox[3]);
    }
  }
  return { svg: $.xml(root), width: width || null, height: height || null, removed };
}

/**
 * SVG baixado na clonagem: no ZIP ele vai para o domínio do usuário, e abrir o
 * endereço do arquivo direto rodaria os scripts do dono da página copiada.
 * Passa pela limpeza leve (`keepContent`) — como imagem ou fundo os scripts
 * nunca rodam, então o desenho não muda. SVG sem nada que rode código fica
 * byte a byte igual.
 *
 * Só fica como veio o que a limpeza leu do mesmo jeito que o navegador lê:
 * - DOCTYPE com declarações entre colchetes (entidades): o navegador expande
 *   `&x;` em marcação — um <script> escondido numa entidade não aparece para a
 *   limpeza. Sai sempre a versão limpa (sem o DOCTYPE, com as entidades simples
 *   já trocadas pelo valor);
 * - o que não é um SVG (outra raiz, como <html> ou <g>, ou um arquivo que não dá
 *   para ler): null — não pode ir como .svg (quem chama guarda com outra extensão;
 *   como imagem ele já não aparecia).
 */
export function cleanClonedSvg(data: Buffer): Buffer | null {
  try {
    const text = decodeText(data);
    if (!startsLikeSvg(text)) return null;
    const clean = sanitizeSvg(text, "imagem.svg", { keepContent: true });
    const entities = xmlProlog(text).doctypes.some((d) => d.subset !== null);
    if (!clean.removed && !entities) return data;
    return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n${clean.svg}`, "utf8");
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Processamento
// ─────────────────────────────────────────────────────────────────────────────

const RASTER_FORMATS = new Set<string>(["jpeg", "png", "webp", "gif"]);

function isPixelLimitError(err: unknown) {
  return err instanceof Error && /pixel limit/i.test(err.message);
}

/**
 * Tira os metadados de um GIF animado (as extensões de COMENTÁRIO, de texto e de
 * aplicação que NÃO sejam o laço NETSCAPE/ANIMEXTS), mantendo os quadros byte a
 * byte — GIF não tem EXIF, essas extensões são o único lugar de metadado. Sem
 * nada a tirar, devolve os MESMOS bytes. Qualquer coisa inesperada na estrutura
 * do arquivo: devolve o original sem mexer (nunca corrompe). O GIF parado já
 * vira WebP pelo sharp (que remove os metadados).
 */
export function stripGifMetadata(data: Uint8Array): Uint8Array {
  const n = data.length;
  // "GIF" + descritor de tela mínimo.
  if (n < 13 || data[0] !== 0x47 || data[1] !== 0x49 || data[2] !== 0x46) return data;
  const keep: Array<[number, number]> = [[0, 13]];
  let p = 13;
  const packed = data[10];
  if (packed & 0x80) {
    const gct = 3 * (1 << ((packed & 0x07) + 1));
    if (p + gct > n) return data;
    keep.push([p, p + gct]);
    p += gct;
  }
  // Fim dos sub-blocos (tamanho-prefixados) a partir de `pos`; -1 se estourar o arquivo.
  const subEnd = (pos: number): number => {
    while (pos < n) {
      const len = data[pos++];
      if (len === 0) return pos;
      pos += len;
    }
    return -1;
  };
  while (p < n) {
    const marker = data[p];
    if (marker === 0x3b) {
      keep.push([p, p + 1]); // trailer
      p = n;
      break;
    }
    if (marker === 0x2c) {
      // Descritor de imagem (10) + tabela local + 1 byte (LZW) + sub-blocos: mantém tudo.
      if (p + 10 > n) return data;
      let q = p + 10;
      const imgPacked = data[p + 9];
      if (imgPacked & 0x80) q += 3 * (1 << ((imgPacked & 0x07) + 1));
      if (q >= n) return data;
      const end = subEnd(q + 1);
      if (end < 0) return data;
      keep.push([p, end]);
      p = end;
      continue;
    }
    if (marker === 0x21) {
      const label = data[p + 1];
      if (label === 0xf9) {
        // Controle gráfico (timing/transparência): mantém.
        const end = subEnd(p + 2);
        if (end < 0) return data;
        keep.push([p, end]);
        p = end;
        continue;
      }
      if (label === 0xff) {
        // Aplicação: 1 byte (0x0b) + 11 (id+auth) + sub-blocos. Mantém só o laço.
        if (p + 14 > n || data[p + 2] !== 0x0b) return data;
        const id = String.fromCharCode(...data.subarray(p + 3, p + 14));
        const end = subEnd(p + 14);
        if (end < 0) return data;
        if (id === "NETSCAPE2.0" || id === "ANIMEXTS1.0") keep.push([p, end]);
        p = end;
        continue;
      }
      if (label === 0xfe || label === 0x01) {
        // Comentário (0xFE) ou texto (0x01, com 1 byte 0x0c + 12 antes): tira.
        let after = p + 2;
        if (label === 0x01) {
          if (p + 15 > n || data[p + 2] !== 0x0c) return data;
          after = p + 15;
        }
        const end = subEnd(after);
        if (end < 0) return data;
        p = end;
        continue;
      }
      return data; // extensão desconhecida: não arrisca
    }
    return data; // marcador inesperado
  }
  const total = keep.reduce((s, [a, b]) => s + (b - a), 0);
  // Nada tirado (nem lixo depois do trailer) → os mesmos bytes.
  return total === n ? data : Buffer.concat(keep.map(([a, b]) => data.subarray(a, b)));
}

/**
 * Valida e prepara uma imagem enviada. Lança AssetError (mensagem em pt-BR)
 * quando o arquivo é grande demais, de formato não aceito ou ilegível. As fotos
 * (JPG/PNG/WebP/AVIF parado) viram WebP pelo sharp, que JÁ remove os metadados
 * (EXIF com GPS/câmera/autor, XMP, IPTC): a imagem guardada fica anônima. O SVG
 * passa pela limpeza (tira os metadados de autor/editor) e o GIF animado perde
 * as extensões de metadado — sem deixar nada que identifique o dono da oferta.
 */
export async function processImage(input: { name: string; data: Uint8Array }): Promise<ProcessedImage> {
  const name = cleanFileName(input.name);
  const { data } = input;
  const L = IMAGE_UPLOAD_LIMITS;
  if (data.byteLength === 0) throw new AssetError(`"${name}" está vazio.`, 400);
  if (data.byteLength > L.maxFileBytes) throw tooLarge(name, data.byteLength);

  const format = sniffImageFormat(data);
  if (!format) {
    // ".ico" que não passa nem pelo cabeçalho: ícone estragado (não "formato errado").
    if (/\.ico$/i.test(name) && data[0] === 0 && data[1] === 0) throw badIcon(name);
    if (/\.(heic|heif)$/i.test(name) || ftypBrands(data).some((b) => HEIC_BRANDS.has(b))) {
      throw new AssetError(
        `"${name}" está no formato HEIC (fotos do iPhone). Exporte como JPG ou PNG e envie de novo.`,
        415,
      );
    }
    throw unsupported(name);
  }

  if (format === "ico") {
    if (data.byteLength > L.maxIconBytes) throw iconTooLarge(name, data.byteLength);
    const icon = readIco(data);
    if (!icon) throw badIcon(name);
    return { data, ext: "ico", mime: "image/x-icon", width: icon.width, height: icon.height };
  }

  if (format === "svg") {
    const clean = sanitizeSvg(decodeText(data), name);
    return {
      data: Buffer.from(clean.svg, "utf8"),
      ext: "svg",
      mime: "image/svg+xml",
      width: clean.width,
      height: clean.height,
    };
  }

  const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  let meta: Metadata;
  try {
    meta = await sharp(buffer, { limitInputPixels: L.maxInputPixels, failOn: "error" }).metadata();
  } catch (err) {
    throw isPixelLimitError(err) ? tooManyPixels(name) : unreadable(name);
  }
  const avif = meta.format === "heif" && meta.compression === "av1";
  if (!RASTER_FORMATS.has(meta.format) && !avif) throw unsupported(name);
  const pages = meta.pages ?? 1;
  const frameHeight = meta.pageHeight ?? meta.height;

  // Animações que o WebP reprocessado perderia: ficam como vieram — mas sem os
  // metadados. GIF: tira as extensões de comentário/texto/aplicação (menos o laço),
  // mantendo os quadros byte a byte. AVIF animado: o sharp não reprocessa sem perder
  // a animação e EXIF nele é raríssimo — fica como veio.
  if (pages > 1 && (meta.format === "gif" || avif)) {
    return {
      data: avif ? data : stripGifMetadata(data),
      ext: avif ? "avif" : "gif",
      mime: avif ? "image/avif" : "image/gif",
      width: meta.width || null,
      height: frameHeight || null,
    };
  }

  try {
    const out = await sharp(buffer, { limitInputPixels: L.maxInputPixels, failOn: "error", animated: pages > 1 })
      .rotate()
      .resize({ width: L.maxWidth, height: L.maxHeight, fit: "inside", withoutEnlargement: true })
      .webp({ quality: L.webpQuality })
      .toBuffer({ resolveWithObject: true });
    return {
      data: out.data,
      ext: "webp",
      mime: "image/webp",
      width: out.info.width,
      height: out.info.pageHeight ?? out.info.height,
    };
  } catch (err) {
    throw isPixelLimitError(err) ? tooManyPixels(name) : unreadable(name);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Banco (biblioteca da oferta)
// ─────────────────────────────────────────────────────────────────────────────

async function assertOffer(offerId: string) {
  const offer = await prisma.offer.findFirst({ where: { id: offerId, deletedAt: null }, select: { id: true } });
  if (!offer) throw new AssetError("Oferta não encontrada. Ela pode ter sido excluída.", 404);
}

/** "/os-assets/<sha>.<ext>" a partir da chave do storage (null se não for endereçada por hash). */
export function assetSrc(key: string): string | null {
  const m = STORAGE_KEY_RE.exec(key);
  return m ? `${ASSET_PREFIX}${m[1]}` : null;
}

function nameFromSourceUrl(url: string | null) {
  if (!url) return null;
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : null;
  } catch {
    return null;
  }
}

interface AssetRow {
  key: string;
  bytes: number;
  width: number | null;
  height: number | null;
  originalName: string | null;
  sourceUrl: string | null;
}

function toLibraryImage(row: AssetRow): LibraryImage | null {
  const src = assetSrc(row.key);
  if (!src) return null;
  const ext = src.split(".").pop() ?? "";
  const name = cleanFileName(row.originalName ?? nameFromSourceUrl(row.sourceUrl), `imagem.${ext}`);
  const image: LibraryImage = { type: "image", src, name, bytes: row.bytes };
  if (row.width && row.height) {
    image.width = row.width;
    image.height = row.height;
  }
  return image;
}

const ROW_SELECT = { key: true, bytes: true, width: true, height: true, originalName: true, sourceUrl: true } as const;

/** Imagens da oferta (enviadas e as que vieram na clonagem), mais novas primeiro. */
export async function listOfferImages(offerId: string, limit = 1000): Promise<LibraryImage[]> {
  await assertOffer(offerId);
  const rows = await prisma.asset.findMany({
    where: { offerId, kind: "IMAGE" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: ROW_SELECT,
  });
  return rows.map(toLibraryImage).filter((i): i is LibraryImage => i !== null);
}

/** Grava a imagem já processada e liga à oferta (reenviar a mesma imagem só a traz para o topo). */
async function storeImage(
  offerId: string,
  name: string,
  image: ProcessedImage,
  sourceUrl: string | null = null,
): Promise<LibraryImage> {
  const stored = await putContentAddressed(image.data, image.ext);
  const fields = {
    mime: image.mime,
    bytes: stored.bytes,
    width: image.width,
    height: image.height,
    originalName: name,
    ...(sourceUrl ? { sourceUrl: sourceUrl.slice(0, 2000) } : {}),
  };
  const upsert = () =>
    prisma.asset.upsert({
      where: { offerId_key: { offerId, key: stored.key } },
      create: { offerId, key: stored.key, sha256: stored.sha256, kind: "IMAGE", ...fields },
      update: { ...fields, kind: "IMAGE", createdAt: new Date() },
      select: ROW_SELECT,
    });
  let row: AssetRow;
  try {
    row = await upsert();
  } catch (err) {
    // Dois envios iguais ao mesmo tempo: o segundo vira atualização.
    if (!uniqueViolationFields(err).length) throw err;
    row = await upsert();
  }
  const library = toLibraryImage(row);
  if (!library) throw new Error(`Chave de storage inesperada: ${stored.key}`);
  return library;
}

/**
 * Processa e guarda as imagens enviadas para a oferta. Cada arquivo é tratado
 * sozinho: os que falham vão para `errors` (mensagem pt-BR) sem impedir os outros.
 */
export async function saveOfferImages(offerId: string, files: ImageUploadInput[]): Promise<UploadResult> {
  if (!files.length) throw new AssetError("Escolha pelo menos uma imagem para enviar.", 400);
  if (files.length > IMAGE_UPLOAD_LIMITS.maxFiles) {
    throw new AssetError(`Envie no máximo ${IMAGE_UPLOAD_LIMITS.maxFiles} imagens por vez.`, 400);
  }
  await assertOffer(offerId);

  const result: UploadResult = { data: [], errors: [] };
  for (const file of files) {
    const name = cleanFileName(file.name);
    try {
      if (file.size > IMAGE_UPLOAD_LIMITS.maxFileBytes) throw tooLarge(name, file.size);
      const image = await processImage({ name, data: await file.read() });
      result.data.push(await storeImage(offerId, name, image));
    } catch (err) {
      if (err instanceof AssetError) {
        result.errors.push({ name, error: err.message, status: err.status });
      } else {
        console.error("[imagens] falha ao salvar", name, err);
        result.errors.push({ name, error: `Não foi possível salvar "${name}". Tente de novo.`, status: 500 });
      }
    }
  }
  return result;
}

const LINK_ACCEPT = "image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5";

/**
 * "Usar link" no editor: baixa a imagem do endereço (com as proteções do
 * clonador: só http/https, nada de rede interna, limite de 15 MB e de tempo),
 * processa como um upload e guarda na biblioteca da oferta. Assim a página não
 * depende do site de origem e a imagem aparece no editor.
 */
export async function importOfferImageFromUrl(
  offerId: string,
  rawUrl: string,
  options: { fetcher?: Fetcher } = {},
): Promise<LibraryImage> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new AssetError("Cole um link de imagem válido, começando com https://", 400);
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) {
    throw new AssetError("Cole um link de imagem válido, começando com https://", 400);
  }
  await assertOffer(offerId);

  const fetcher = options.fetcher ?? createFetcher({ maxBytes: IMAGE_UPLOAD_LIMITS.maxFileBytes, timeoutMs: 20_000 });
  try {
    const res = await fetcher.fetchResource(url.href, { accept: LINK_ACCEPT });
    if (!res.ok) {
      throw new AssetError(`Não foi possível baixar a imagem desse link. ${res.error ?? ""}`.trim(), 422);
    }
    const name = cleanFileName(nameFromSourceUrl(res.finalUrl) ?? nameFromSourceUrl(url.href), "imagem-do-link");
    let image: ProcessedImage;
    try {
      image = await processImage({ name, data: res.body });
    } catch (err) {
      if (err instanceof AssetError && err.status === 415) {
        throw new AssetError(
          `Esse link não é de uma imagem (${ACCEPTED_TEXT}). Abra a imagem no navegador, clique com o botão direito e use "Copiar endereço da imagem".`,
          415,
        );
      }
      throw err;
    }
    return await storeImage(offerId, name, image, url.href);
  } finally {
    if (!options.fetcher) await fetcher.close();
  }
}
