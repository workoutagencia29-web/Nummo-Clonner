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
 * - Arquivos são guardados pelo hash (src/lib/storage.ts) e ligados à oferta
 *   por uma linha Asset. O editor recebe no formato do GrapesJS:
 *   { type: "image", src: "/os-assets/<sha>.<ext>", name, width, height }.
 */
import { load } from "cheerio";
import type { AnyNode, Element } from "domhandler";
import sharp, { type Metadata } from "sharp";
import { prisma } from "@/lib/db";
import { UserError, uniqueViolationFields } from "@/lib/errors";
import { putContentAddressed } from "@/lib/storage";
import { createFetcher, type Fetcher } from "@/worker/clone/fetcher";

/** Limites do upload (o editor usa os mesmos valores para avisar antes de enviar). */
export const IMAGE_UPLOAD_LIMITS = {
  /** Tamanho máximo de cada arquivo enviado. */
  maxFileBytes: 15 * 1024 * 1024,
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
export type ImageFormat = "jpeg" | "png" | "webp" | "gif" | "avif" | "svg";

const ASSET_PREFIX = "/os-assets/";
const STORAGE_KEY_RE = /^a\/[0-9a-f]{2}\/([0-9a-f]{64}\.[a-z0-9]{1,8})$/;
const ACCEPTED_TEXT = "JPG, PNG, WebP, GIF, AVIF ou SVG";

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
  ext: "webp" | "gif" | "avif" | "svg";
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

/** Início típico de um SVG: declaração XML, comentários e DOCTYPE opcionais e <svg. */
const SVG_START =
  /^\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:(?:<!--[\s\S]*?-->|<!DOCTYPE[^[>]*(?:\[[\s\S]*?\])?\s*>|<\?[\s\S]*?\?>)\s*)*<(?:[a-z_][\w.-]*:)?svg[\s>/]/i;

/** Descobre o formato pelos primeiros bytes. null = não é um formato aceito. */
export function sniffImageFormat(data: Uint8Array): ImageFormat | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpeg";
  if (data.length >= 8 && ascii(data, 0, 8) === "\x89PNG\r\n\x1a\n") return "png";
  if (data.length >= 6 && /^GIF8[79]a$/.test(ascii(data, 0, 6))) return "gif";
  if (data.length >= 12 && ascii(data, 0, 4) === "RIFF" && ascii(data, 8, 12) === "WEBP") return "webp";
  if (ftypBrands(data).some((b) => b === "avif" || b === "avis")) return "avif";
  if (data[0] === 0x3c || data[0] === 0xef || data[0] === 0xff || data[0] === 0xfe || data[0] <= 0x20) {
    if (SVG_START.test(decodeText(data.subarray(0, 8192)))) return "svg";
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
const ANIMATION_ELEMENTS = new Set(["animate", "set", "animatetransform", "animatemotion", "animatecolor"]);
/** Atributos que carregam endereços (href, xlink:href, valores animados…). */
const URL_ATTRIBUTES = new Set(["href", "src", "action", "formaction", "from", "to", "values", "by"]);
/** data: permitido só para imagens comuns embutidas. */
const SAFE_DATA_URL = /^data:image\/(?:png|jpe?g|gif|webp|avif);/;
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
  const doctype = /<!DOCTYPE[^[>]*\[([\s\S]*?)\]\s*>/i.exec(text);
  if (!doctype) return text;
  const entities = new Map<string, string>();
  const re = /<!ENTITY\s+([A-Za-z_][\w.-]*)\s+(?:"([^"%&<]{0,2000})"|'([^'%&<]{0,2000})')\s*>/g;
  for (let m = re.exec(doctype[1]); m && entities.size < 100; m = re.exec(doctype[1])) {
    entities.set(m[1], m[2] ?? m[3] ?? "");
  }
  const body = text.slice(0, doctype.index) + text.slice(doctype.index + doctype[0].length);
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

export interface SanitizedSvg {
  svg: string;
  width: number | null;
  height: number | null;
}

/**
 * Remove tudo o que poderia executar código num SVG. Devolve só o elemento
 * <svg> raiz (declarações, DOCTYPE e instruções de processamento — inclusive
 * <?xml-stylesheet?> — ficam de fora). Lança AssetError se não houver <svg>.
 */
export function sanitizeSvg(text: string, name = "imagem.svg"): SanitizedSvg {
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
    if (BLOCKED_ELEMENTS.has(local) || isHtml || animatesDangerous) {
      $(el).remove();
      return;
    }
    for (const [attr, value] of Object.entries(el.attribs)) {
      const attrLocal = localName(attr);
      const v = compact(value);
      const bad =
        attrLocal.startsWith("on") ||
        /(?:java|vb|live)script:/.test(v) ||
        (URL_ATTRIBUTES.has(attrLocal) && v.startsWith("data:") && !SAFE_DATA_URL.test(v)) ||
        (attrLocal === "style" && DANGEROUS_CSS.test(value));
      if (bad) $(el).removeAttr(attr);
    }
    if (local === "style") {
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
  return { svg: $.xml(root), width: width || null, height: height || null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Processamento
// ─────────────────────────────────────────────────────────────────────────────

const RASTER_FORMATS = new Set<string>(["jpeg", "png", "webp", "gif"]);

function isPixelLimitError(err: unknown) {
  return err instanceof Error && /pixel limit/i.test(err.message);
}

/**
 * Valida e prepara uma imagem enviada. Lança AssetError (mensagem em pt-BR)
 * quando o arquivo é grande demais, de formato não aceito ou ilegível.
 */
export async function processImage(input: { name: string; data: Uint8Array }): Promise<ProcessedImage> {
  const name = cleanFileName(input.name);
  const { data } = input;
  const L = IMAGE_UPLOAD_LIMITS;
  if (data.byteLength === 0) throw new AssetError(`"${name}" está vazio.`, 400);
  if (data.byteLength > L.maxFileBytes) throw tooLarge(name, data.byteLength);

  const format = sniffImageFormat(data);
  if (!format) {
    if (/\.(heic|heif)$/i.test(name) || ftypBrands(data).some((b) => HEIC_BRANDS.has(b))) {
      throw new AssetError(
        `"${name}" está no formato HEIC (fotos do iPhone). Exporte como JPG ou PNG e envie de novo.`,
        415,
      );
    }
    throw unsupported(name);
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

  // Animações que o WebP reprocessado perderia: ficam como vieram.
  if (pages > 1 && (meta.format === "gif" || avif)) {
    return {
      data,
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
          'Esse link não é de uma imagem (JPG, PNG, WebP, GIF, AVIF ou SVG). Abra a imagem no navegador, clique com o botão direito e use "Copiar endereço da imagem".',
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
