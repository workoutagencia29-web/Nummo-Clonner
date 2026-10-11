/**
 * Ícones .ico montados à mão para os testes (cabeçalho, diretório e imagens):
 * PNG dentro (gerado pelo sharp, como fazem os geradores de favicon), BMP
 * dentro (cabeçalho DIB + pixels + máscara, como o Windows grava) e versões
 * corrompidas de propósito.
 */
import sharp from "sharp";

export interface IcoPart {
  data: Uint8Array;
  width: number;
  height: number;
  /** Bits por pixel anotados no diretório (0 nos PNGs). */
  bpp?: number;
}

/** PNG quadrado com transparência e um círculo colorido. */
export async function pngPart(size: number, color = "#e11d48"): Promise<IcoPart> {
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2.5}" fill="${color}"/></svg>`,
  );
  const data = await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: svg }])
    .png()
    .toBuffer();
  return { data, width: size, height: size, bpp: 0 };
}

/**
 * BMP de ícone: BITMAPINFOHEADER (40 bytes) com a altura dobrada, paleta
 * (até 8 bits), pixels de baixo para cima e a máscara de 1 bit.
 */
export function bmpPart(size: number, bpp: 32 | 24 | 8 = 32): IcoPart {
  const palette = bpp === 8 ? 256 * 4 : 0;
  const xorStride = Math.floor((size * bpp + 31) / 32) * 4;
  const andStride = Math.floor((size + 31) / 32) * 4;
  const data = Buffer.alloc(40 + palette + xorStride * size + andStride * size);
  data.writeUInt32LE(40, 0);
  data.writeInt32LE(size, 4);
  data.writeInt32LE(size * 2, 8);
  data.writeUInt16LE(1, 12);
  data.writeUInt16LE(bpp, 14);
  data.writeUInt32LE(0, 16);
  data.writeUInt32LE(xorStride * size + andStride * size, 20);
  if (bpp === 8) {
    // Paleta: 0 = transparente (pela máscara), 1 = azul.
    data.writeUInt32LE(0x00000000, 40);
    data.writeUInt32LE(0x00eb6325, 44);
  }
  const pixels = 40 + palette;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inside = (x - size / 2) ** 2 + (y - size / 2) ** 2 < (size / 2.5) ** 2;
      const at = pixels + y * xorStride + (x * bpp) / 8;
      if (bpp === 32) data.writeUInt32LE(inside ? 0xff2563eb : 0, at);
      else if (bpp === 24) data.writeUIntLE(inside ? 0x2563eb : 0xffffff, at, 3);
      else data[at] = inside ? 1 : 0;
      // Máscara: 1 = transparente (fora do círculo).
      if (!inside) data[pixels + xorStride * size + y * andStride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { data, width: size, height: size, bpp };
}

/** Junta as imagens num .ico (cabeçalho de 6 bytes + diretório de 16 bytes por imagem). */
export function icoFile(parts: IcoPart[]): Buffer {
  const header = Buffer.alloc(6 + 16 * parts.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(parts.length, 4);
  let offset = header.length;
  parts.forEach((part, i) => {
    const at = 6 + 16 * i;
    header[at] = part.width >= 256 ? 0 : part.width;
    header[at + 1] = part.height >= 256 ? 0 : part.height;
    header[at + 2] = 0;
    header[at + 3] = 0;
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(part.bpp ?? 32, at + 6);
    header.writeUInt32LE(part.data.byteLength, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += part.data.byteLength;
  });
  return Buffer.concat([header, ...parts.map((p) => Buffer.from(p.data))]);
}

/** Cópia do .ico com bytes trocados ({ posição: valor }). */
export function patched(ico: Uint8Array, changes: Record<number, number>): Buffer {
  const copy = Buffer.from(ico);
  for (const [at, value] of Object.entries(changes)) copy[Number(at)] = value;
  return copy;
}

/** Os três .ico "bons" usados nos testes. */
export async function sampleIcons() {
  const png = icoFile([await pngPart(32)]);
  const bmp = icoFile([bmpPart(16, 32)]);
  const multi = icoFile([bmpPart(16, 8), bmpPart(32, 24), await pngPart(48, "#16a34a"), await pngPart(256, "#7c3aed")]);
  return { png, bmp, multi };
}
