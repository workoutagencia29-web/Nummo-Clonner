/**
 * Ícones .ico (favicon). O sharp não lê ICO, então o arquivo é conferido pelos
 * bytes e guardado como veio (image/x-icon):
 *
 * - cabeçalho: reservado 0, tipo 1 (ícone; cursor .cur não vale), de 1 a 64 imagens;
 * - cada entrada do diretório com tamanho e posição dentro do arquivo;
 * - cada imagem é um PNG inteiro (blocos com CRC certo, IHDR coerente, IDAT e
 *   IEND) ou um BMP sem o cabeçalho de arquivo, com cabeçalho DIB coerente
 *   (altura dobrada pela máscara, medidas iguais às do diretório, cores e
 *   pixels cabendo no espaço declarado).
 *
 * Sem dependências de Node: os textos e `isIcoFile` também valem no navegador.
 */

/** Tamanho máximo de um .ico (ícones de aba têm poucos KB; um de 256 px sem compressão, ~270 KB). */
export const ICO_MAX_BYTES = 1024 * 1024;
/** Imagens no máximo por arquivo. */
export const ICO_MAX_IMAGES = 64;
/** Lado máximo de um PNG dentro do .ico (o BMP vai até 256, como no formato). */
const PNG_MAX_SIDE = 1024;
const BMP_MAX_SIDE = 256;

/** Tipos com que o navegador informa um .ico ("image/x-icon", "image/vnd.microsoft.icon"…). */
export const ICO_MIME_RE = /^image\/(?:x-icon|vnd\.microsoft\.icon|ico|icon)$/i;

/** O arquivo escolhido parece um .ico (pelo nome ou pelo tipo)? Só para avisar antes de enviar. */
export function isIcoFile(file: { name?: string | null; type?: string | null }): boolean {
  return /\.ico$/i.test(file.name ?? "") || ICO_MIME_RE.test(file.type ?? "");
}

/** Recusa de .ico onde ele não serve (imagem de compartilhamento). */
export const ICO_NOT_FOR_SHARING =
  "Arquivos .ico servem só para o ícone da aba: o Facebook e o WhatsApp não mostram .ico. Envie a imagem de compartilhamento em JPG, PNG ou WebP.";

export interface IcoImage {
  format: "png" | "bmp";
  width: number;
  height: number;
}

export interface IcoInfo {
  images: IcoImage[];
  /** Medidas da maior imagem do arquivo. */
  width: number;
  height: number;
}

const u16 = (d: Uint8Array, at: number) => d[at] | (d[at + 1] << 8);
const u32 = (d: Uint8Array, at: number) => (d[at] | (d[at + 1] << 8) | (d[at + 2] << 16) | (d[at + 3] << 24)) >>> 0;
const i32 = (d: Uint8Array, at: number) => d[at] | (d[at + 1] << 8) | (d[at + 2] << 16) | (d[at + 3] << 24);
const u32be = (d: Uint8Array, at: number) => ((d[at] << 24) | (d[at + 1] << 16) | (d[at + 2] << 8) | d[at + 3]) >>> 0;

/** Cabeçalho de ícone: reservado 0, tipo 1 e de 1 a 64 imagens (basta para reconhecer o formato). */
export function looksLikeIco(data: Uint8Array): boolean {
  if (data.length < 6 || u16(data, 0) !== 0 || u16(data, 2) !== 1) return false;
  const count = u16(data, 4);
  return count >= 1 && count <= ICO_MAX_IMAGES;
}

/**
 * Confere o .ico inteiro. Devolve as imagens e as medidas da maior, ou null se
 * o arquivo não for um ícone válido (corrompido, cortado, cursor…).
 */
export function readIco(data: Uint8Array): IcoInfo | null {
  if (!looksLikeIco(data)) return null;
  const count = u16(data, 4);
  const dirEnd = 6 + 16 * count;
  if (data.length < dirEnd) return null;
  const images: IcoImage[] = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + 16 * i;
    const size = u32(data, at + 8);
    const offset = u32(data, at + 12);
    if (size === 0 || offset < dirEnd || offset + size > data.length) return null;
    const image = data.subarray(offset, offset + size);
    // 0 no diretório = 256 px (ou "veja na imagem", em PNGs maiores).
    const declared = {
      width: data[at] || 256,
      height: data[at + 1] || 256,
      exact: data[at] !== 0 && data[at + 1] !== 0,
    };
    const read = isPng(image) ? readPng(image) : readBmp(image, declared);
    if (!read) return null;
    images.push(read);
  }
  const largest = images.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
  return { images, width: largest.width, height: largest.height };
}

// ─────────────────────────────────────────────────────────────────────────────
// PNG dentro do ícone
// ─────────────────────────────────────────────────────────────────────────────

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(data: Uint8Array) {
  return data.length >= 8 && PNG_SIGNATURE.every((b, i) => data[i] === b);
}

let crcTable: Uint32Array | null = null;

/** CRC-32 dos blocos do PNG (o mesmo do zlib). */
function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Profundidades de cor válidas para cada tipo de cor do PNG. */
const PNG_DEPTHS: Record<number, number[]> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};

function readPng(data: Uint8Array): IcoImage | null {
  let at = 8;
  let header: IcoImage | null = null;
  let colorType = -1;
  let palette = false;
  let idat = false;
  while (at + 12 <= data.length) {
    const length = u32be(data, at);
    const type = String.fromCharCode(data[at + 4], data[at + 5], data[at + 6], data[at + 7]);
    const end = at + 12 + length;
    if (!/^[A-Za-z]{4}$/.test(type) || length > 0x7fffffff || end > data.length) return null;
    if (crc32(data.subarray(at + 4, at + 8 + length)) !== u32be(data, at + 8 + length)) return null;
    if (!header) {
      // O primeiro bloco é sempre o IHDR.
      if (type !== "IHDR" || length !== 13) return null;
      const width = u32be(data, at + 8);
      const height = u32be(data, at + 12);
      const depth = data[at + 16];
      colorType = data[at + 17];
      const sideOk = (n: number) => n >= 1 && n <= PNG_MAX_SIDE;
      if (!sideOk(width) || !sideOk(height) || !PNG_DEPTHS[colorType]?.includes(depth)) return null;
      if (data[at + 18] !== 0 || data[at + 19] !== 0 || data[at + 20] > 1) return null;
      header = { format: "png", width, height };
    } else if (type === "IHDR") {
      return null;
    } else if (type === "PLTE") {
      palette = true;
    } else if (type === "IDAT") {
      if (colorType === 3 && !palette) return null;
      idat = true;
    } else if (type === "IEND") {
      return idat && length === 0 ? header : null;
    }
    at = end;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// BMP dentro do ícone (só o cabeçalho DIB + pixels + máscara)
// ─────────────────────────────────────────────────────────────────────────────

const DIB_HEADER_SIZES = new Set([40, 52, 56, 108, 124]);
const BMP_DEPTHS = new Set([1, 4, 8, 16, 24, 32]);
const BI_RGB = 0;
const BI_BITFIELDS = 3;

function readBmp(data: Uint8Array, declared: { width: number; height: number; exact: boolean }): IcoImage | null {
  if (data.length < 40) return null;
  const headerSize = u32(data, 0);
  if (!DIB_HEADER_SIZES.has(headerSize) || headerSize > data.length) return null;
  const width = i32(data, 4);
  const doubled = i32(data, 8);
  const planes = u16(data, 12);
  const bpp = u16(data, 14);
  const compression = u32(data, 16);
  const colorsUsed = u32(data, 32);
  // No ícone, a altura do DIB conta a imagem e a máscara (o dobro da altura real).
  if (width < 1 || width > BMP_MAX_SIDE || doubled < 2 || doubled % 2 !== 0) return null;
  const height = doubled / 2;
  if (height > BMP_MAX_SIDE || planes !== 1 || !BMP_DEPTHS.has(bpp)) return null;
  if (compression !== BI_RGB && !(compression === BI_BITFIELDS && (bpp === 16 || bpp === 32))) return null;
  // Medidas do diretório (quando não são 0) batem com as do DIB.
  if (declared.exact && (declared.width !== width || declared.height !== height)) return null;
  const maxColors = bpp <= 8 ? 2 ** bpp : 0;
  if (colorsUsed > (maxColors || 2 ** 24)) return null;
  const paletteBytes = bpp <= 8 ? (colorsUsed || maxColors) * 4 : 0;
  const masksBytes = compression === BI_BITFIELDS && headerSize === 40 ? 12 : 0;
  const xorBytes = Math.floor((width * bpp + 31) / 32) * 4 * height;
  const andBytes = Math.floor((width + 31) / 32) * 4 * height;
  const pixels = headerSize + masksBytes + paletteBytes + xorBytes;
  // A máscara (1 bit por pixel) é obrigatória até 24 bits; com 32 bits (transparência própria) pode faltar.
  const needed = bpp === 32 ? pixels : pixels + andBytes;
  if (needed > data.length) return null;
  return { format: "bmp", width, height };
}
