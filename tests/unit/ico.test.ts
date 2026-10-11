/**
 * Ícones .ico: leitura pelos bytes (src/lib/ico.ts) e o caminho deles no
 * serviço de imagens (processImage guarda como veio, sem passar pelo sharp).
 * Os arquivos são montados à mão em tests/unit/ico-fixtures.ts.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { ICO_MAX_BYTES, isIcoFile, looksLikeIco, readIco } from "@/lib/ico";
import { AssetError, IMAGE_UPLOAD_LIMITS, processImage, sniffImageFormat } from "@/server/services/assets";
import { catchError } from "./helpers";
import { bmpPart, type IcoPart, icoFile, patched, pngPart, sampleIcons } from "./ico-fixtures";

let icons: Awaited<ReturnType<typeof sampleIcons>>;
let png32: IcoPart;

beforeAll(async () => {
  icons = await sampleIcons();
  png32 = await pngPart(32);
});

async function expectAssetError(promise: Promise<unknown>, status: number, message: RegExp) {
  const err = await catchError(promise);
  expect(err).toBeInstanceOf(AssetError);
  expect((err as AssetError).status).toBe(status);
  expect((err as AssetError).message).toMatch(message);
}

describe("readIco — ícones bons", () => {
  it("PNG dentro: medidas do PNG", () => {
    expect(looksLikeIco(icons.png)).toBe(true);
    expect(readIco(icons.png)).toEqual({ images: [{ format: "png", width: 32, height: 32 }], width: 32, height: 32 });
  });

  it("BMP dentro (32 bits): altura dobrada pela máscara, medidas do diretório", () => {
    expect(readIco(icons.bmp)).toEqual({ images: [{ format: "bmp", width: 16, height: 16 }], width: 16, height: 16 });
  });

  it("vários tamanhos (BMP 8 e 24 bits, PNG 48 e 256): medidas da maior", () => {
    const info = readIco(icons.multi);
    expect(info?.images.map((i) => `${i.format}:${i.width}`)).toEqual(["bmp:16", "bmp:32", "png:48", "png:256"]);
    expect(info).toMatchObject({ width: 256, height: 256 });
  });

  it("BMP de 256 px (0 no diretório) e BMP de 32 bits sem a máscara", () => {
    expect(readIco(icoFile([bmpPart(256)]))).toMatchObject({ width: 256, height: 256 });
    const part = bmpPart(16, 32);
    const noMask = { ...part, data: part.data.subarray(0, 40 + 16 * 16 * 4) };
    expect(readIco(icoFile([noMask]))).toMatchObject({ width: 16 });
  });
});

describe("readIco — ícones estragados", () => {
  it("cabeçalho: reservado, tipo (cursor .cur), quantidade de imagens", () => {
    expect(readIco(patched(icons.png, { 0: 1 }))).toBeNull();
    expect(readIco(patched(icons.png, { 2: 2 }))).toBeNull();
    expect(readIco(patched(icons.png, { 4: 0 }))).toBeNull();
    expect(readIco(patched(icons.png, { 4: 65 }))).toBeNull();
    expect(looksLikeIco(Buffer.from([0, 0, 1, 0]))).toBe(false);
    // 64 imagens ainda vale; o diretório tem de caber no arquivo.
    expect(looksLikeIco(patched(icons.png, { 4: 64 }))).toBe(true);
    expect(readIco(patched(icons.png, { 4: 64 }))).toBeNull();
  });

  it("entrada fora do arquivo: tamanho 0, além do fim, posição dentro do diretório", () => {
    expect(readIco(patched(icons.png, { 14: 0, 15: 0, 16: 0, 17: 0 }))).toBeNull();
    expect(readIco(icons.png.subarray(0, icons.png.length - 1))).toBeNull();
    expect(readIco(patched(icons.png, { 18: 6, 19: 0, 20: 0, 21: 0 }))).toBeNull();
    expect(readIco(patched(icons.png, { 21: 0x7f }))).toBeNull();
  });

  it("PNG: CRC errado, sem IEND, IHDR incoerente, lixo no lugar", () => {
    const pngStart = 22;
    // Um byte trocado no meio dos dados (o CRC do bloco não bate).
    expect(readIco(patched(icons.png, { [pngStart + 60]: icons.png[pngStart + 60] ^ 0xff }))).toBeNull();
    const cut = { ...png32, data: png32.data.subarray(0, png32.data.length - 12) };
    expect(readIco(icoFile([cut]))).toBeNull();
    // Profundidade 3 não existe para cor RGBA (e o CRC do IHDR também deixa de bater).
    expect(readIco(patched(icons.png, { [pngStart + 24]: 3 }))).toBeNull();
    const junk = { data: Buffer.concat([png32.data.subarray(0, 8), Buffer.alloc(200, 7)]), width: 32, height: 32 };
    expect(readIco(icoFile([junk]))).toBeNull();
  });

  it("BMP: cabeçalho DIB incoerente ou pixels faltando", () => {
    const bmp = bmpPart(16, 24);
    const variant = (fn: (b: Buffer) => void, size = 16) => {
      const data = Buffer.from(bmp.data);
      fn(data);
      return icoFile([{ ...bmp, data, width: size, height: size }]);
    };
    expect(readIco(variant(() => undefined))).not.toBeNull();
    expect(readIco(variant((b) => b.writeUInt32LE(41, 0)))).toBeNull(); // tamanho do cabeçalho
    expect(readIco(variant((b) => b.writeInt32LE(16, 8)))).toBeNull(); // altura sem a máscara
    expect(readIco(variant((b) => b.writeInt32LE(-32, 8)))).toBeNull(); // de cima para baixo
    expect(readIco(variant((b) => b.writeUInt16LE(2, 12)))).toBeNull(); // planos
    expect(readIco(variant((b) => b.writeUInt16LE(7, 14)))).toBeNull(); // bits por pixel
    expect(readIco(variant((b) => b.writeUInt32LE(1, 16)))).toBeNull(); // compressão RLE
    expect(readIco(variant(() => undefined, 32))).toBeNull(); // diretório diz 32, DIB diz 16
    const short = { ...bmp, data: bmp.data.subarray(0, bmp.data.length - 1) };
    expect(readIco(icoFile([short]))).toBeNull(); // máscara cortada (24 bits precisa dela)
    expect(readIco(icoFile([{ ...bmp, data: bmp.data.subarray(0, 30) }]))).toBeNull();
  });

  it("um ícone bom e um estragado no mesmo arquivo: recusa o arquivo", async () => {
    const broken = { ...bmpPart(16, 24), data: bmpPart(16, 24).data.subarray(0, 100) };
    expect(readIco(icoFile([png32, broken]))).toBeNull();
  });
});

describe("isIcoFile (aviso antes de enviar)", () => {
  it("pelo nome ou pelo tipo informado pelo navegador", () => {
    expect(isIcoFile({ name: "favicon.ICO", type: "" })).toBe(true);
    expect(isIcoFile({ name: "favicon", type: "image/vnd.microsoft.icon" })).toBe(true);
    expect(isIcoFile({ name: "x", type: "image/x-icon" })).toBe(true);
    expect(isIcoFile({ name: "logo.png", type: "image/png" })).toBe(false);
  });
});

describe("processImage com .ico", () => {
  it("reconhece pelo conteúdo e guarda como veio (image/x-icon), com as medidas da maior imagem", async () => {
    expect(sniffImageFormat(icons.png)).toBe("ico");
    for (const [name, data, size] of [
      ["favicon.ico", icons.png, 32],
      ["icone-bmp.ico", icons.bmp, 16],
      ["varios.ico", icons.multi, 256],
      // O nome não importa: vale o conteúdo.
      ["sem-extensao", icons.png, 32],
    ] as const) {
      const out = await processImage({ name, data });
      expect(out).toMatchObject({ ext: "ico", mime: "image/x-icon", width: size, height: size });
      expect(Buffer.from(out.data).equals(Buffer.from(data))).toBe(true);
    }
  });

  it("estragado: mensagem de ícone inválido, inclusive com o cabeçalho quebrado", async () => {
    await expectAssetError(
      processImage({ name: "favicon.ico", data: icons.png.subarray(0, icons.png.length - 5) }),
      422,
      /^"favicon\.ico" não é um ícone \.ico válido: o arquivo pode estar corrompido\. Exporte o ícone de novo ou envie um PNG\.$/,
    );
    await expectAssetError(
      processImage({ name: "cursor.ico", data: patched(icons.png, { 2: 2 }) }),
      422,
      /não é um ícone \.ico válido/,
    );
    // Sem o nome .ico, um cabeçalho que não é de ícone é só "formato não aceito".
    await expectAssetError(
      processImage({ name: "arquivo.bin", data: patched(icons.png, { 2: 2 }) }),
      415,
      /^"arquivo\.bin" não é uma imagem aceita\. Envie JPG, PNG, WebP, GIF, AVIF, SVG ou ICO\.$/,
    );
  });

  it("acima de 1 MB: recusado com o limite próprio dos ícones", async () => {
    expect(IMAGE_UPLOAD_LIMITS.maxIconBytes).toBe(ICO_MAX_BYTES);
    const big = icoFile([{ data: Buffer.alloc(ICO_MAX_BYTES), width: 32, height: 32 }]);
    await expectAssetError(
      processImage({ name: "enorme.ico", data: big }),
      413,
      /^"enorme\.ico" tem 1,1 MB\. Um ícone \.ico pode ter no máximo 1 MB \(ícones de aba costumam ter poucos KB\)\.$/,
    );
  });
});
