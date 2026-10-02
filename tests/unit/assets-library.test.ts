/**
 * Biblioteca de imagens da oferta: gravar (storage + linha Asset), listar mais
 * novas primeiro, reenvio da mesma imagem e erros por arquivo.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { deleteObject, getObject, objectExists } from "@/lib/storage";
import {
  AssetError,
  assetSrc,
  IMAGE_UPLOAD_LIMITS,
  type ImageUploadInput,
  importOfferImageFromUrl,
  listOfferImages,
  saveOfferImages,
} from "@/server/services/assets";
import { createOffer, trashOffer } from "@/server/services/offers";
import { createFetcher } from "@/worker/clone/fetcher";
import { resetDatabase } from "../setup/per-file";
import { catchError } from "./helpers";

const written = new Set<string>();

afterAll(async () => {
  for (const key of written) await deleteObject(key);
});

beforeEach(async () => {
  await resetDatabase();
});

function fileOf(name: string, data: Uint8Array): ImageUploadInput {
  return { name, size: data.byteLength, read: async () => data };
}

let seed = 0;
/** Imagem única por teste (cor diferente = hash diferente). */
async function uniqueJpeg(width = 640, height = 480) {
  seed++;
  return sharp({ create: { width, height, channels: 3, background: { r: seed % 256, g: (seed * 7) % 256, b: 90 } } })
    .jpeg()
    .toBuffer();
}

async function remember(offerId: string) {
  const rows = await prisma.asset.findMany({ where: { offerId }, select: { key: true } });
  for (const r of rows) written.add(r.key);
}

async function expectAssetError(promise: Promise<unknown>, status: number, message: string | RegExp) {
  const err = await catchError(promise);
  expect(err).toBeInstanceOf(AssetError);
  expect((err as AssetError).status).toBe(status);
  if (typeof message === "string") expect((err as AssetError).message).toBe(message);
  else expect((err as AssetError).message).toMatch(message);
}

describe("saveOfferImages", () => {
  it("grava o WebP no storage, cria a linha Asset e responde no formato do GrapesJS", async () => {
    const offer = await createOffer({ name: "Oferta imagens" });
    const result = await saveOfferImages(offer.id, [fileOf("Banner Principal.jpg", await uniqueJpeg(3000, 1500))]);
    await remember(offer.id);

    expect(result.errors).toEqual([]);
    expect(result.data).toHaveLength(1);
    const [image] = result.data;
    expect(image).toMatchObject({ type: "image", name: "Banner Principal.jpg", width: 2560, height: 1280 });
    expect(image.src).toMatch(/^\/os-assets\/[0-9a-f]{64}\.webp$/);

    const row = await prisma.asset.findFirstOrThrow({ where: { offerId: offer.id } });
    expect(row).toMatchObject({
      kind: "IMAGE",
      mime: "image/webp",
      width: 2560,
      height: 1280,
      originalName: "Banner Principal.jpg",
      offerId: offer.id,
    });
    expect(assetSrc(row.key)).toBe(image.src);
    expect(row.key).toBe(`a/${row.sha256.slice(0, 2)}/${row.sha256}.webp`);
    expect(objectExists(row.key)).toBe(true);
    const stored = await getObject(row.key);
    expect(stored.byteLength).toBe(row.bytes);
    expect(image.bytes).toBe(row.bytes);
    expect((await sharp(stored).metadata()).format).toBe("webp");
  });

  it("guarda GIF animado e SVG limpo com a extensão certa", async () => {
    const offer = await createOffer({ name: "Oferta formatos" });
    const frame = await sharp({ create: { width: 10, height: 20, channels: 4, background: "#f00" } })
      .composite([{ input: { create: { width: 10, height: 10, channels: 4, background: "#00f" } }, top: 10, left: 0 }])
      .raw()
      .toBuffer();
    const gif = await sharp(frame, { raw: { width: 10, height: 20, channels: 4, pageHeight: 10 } })
      .gif({ loop: 0 })
      .toBuffer();
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20" onload="x()"><rect width="${seed}"/></svg>`,
    );
    const result = await saveOfferImages(offer.id, [fileOf("anim.gif", gif), fileOf("logo.svg", svg)]);
    await remember(offer.id);
    expect(result.errors).toEqual([]);
    expect(result.data.map((d) => d.src.split(".").pop())).toEqual(["gif", "svg"]);
    expect(result.data[1]).toMatchObject({ width: 40, height: 20 });
    const svgRow = await prisma.asset.findFirstOrThrow({ where: { offerId: offer.id, mime: "image/svg+xml" } });
    expect((await getObject(svgRow.key)).toString("utf8")).not.toContain("onload");
    const gifRow = await prisma.asset.findFirstOrThrow({ where: { offerId: offer.id, mime: "image/gif" } });
    expect(Buffer.from(await getObject(gifRow.key)).equals(gif)).toBe(true);
  });

  it("um arquivo ruim não impede os outros; cada erro vem em português", async () => {
    const offer = await createOffer({ name: "Oferta mista" });
    const result = await saveOfferImages(offer.id, [
      fileOf("boa.jpg", await uniqueJpeg()),
      fileOf("contrato.pdf", Buffer.from("%PDF-1.7 documento")),
      fileOf(
        "quebrada.png",
        Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("lixo")]),
      ),
    ]);
    await remember(offer.id);
    expect(result.data.map((d) => d.name)).toEqual(["boa.jpg"]);
    expect(result.errors).toEqual([
      {
        name: "contrato.pdf",
        error: '"contrato.pdf" não é uma imagem aceita. Envie JPG, PNG, WebP, GIF, AVIF ou SVG.',
        status: 415,
      },
      {
        name: "quebrada.png",
        error: 'Não foi possível ler "quebrada.png". O arquivo pode estar corrompido.',
        status: 422,
      },
    ]);
    expect(await prisma.asset.count({ where: { offerId: offer.id } })).toBe(1);
  });

  it("arquivo acima de 15 MB é recusado sem ser lido", async () => {
    const offer = await createOffer({ name: "Oferta grande" });
    const read = vi.fn(async () => new Uint8Array(1));
    const result = await saveOfferImages(offer.id, [
      { name: "video.jpg", size: IMAGE_UPLOAD_LIMITS.maxFileBytes + 5 * 1024 * 1024, read },
    ]);
    expect(read).not.toHaveBeenCalled();
    expect(result.data).toEqual([]);
    expect(result.errors).toEqual([
      { name: "video.jpg", error: '"video.jpg" tem 20,0 MB. O limite é 15 MB por imagem.', status: 413 },
    ]);
  });

  it("reenviar a mesma imagem não duplica e a traz para o topo com o nome novo", async () => {
    const offer = await createOffer({ name: "Oferta repetida" });
    const first = await uniqueJpeg();
    await saveOfferImages(offer.id, [fileOf("primeira.jpg", first)]);
    await saveOfferImages(offer.id, [fileOf("segunda.jpg", await uniqueJpeg())]);
    await prisma.asset.updateMany({ where: { offerId: offer.id }, data: { createdAt: new Date("2026-01-01") } });

    const again = await saveOfferImages(offer.id, [fileOf("de-novo.jpg", first)]);
    await remember(offer.id);
    expect(again.data).toHaveLength(1);
    expect(await prisma.asset.count({ where: { offerId: offer.id } })).toBe(2);
    const list = await listOfferImages(offer.id);
    expect(list.map((i) => i.name)).toEqual(["de-novo.jpg", "segunda.jpg"]);
    expect(list[0].src).toBe(again.data[0].src);
  });

  it("a mesma imagem em duas ofertas vira duas linhas (um arquivo só no disco)", async () => {
    const a = await createOffer({ name: "Oferta A" });
    const b = await createOffer({ name: "Oferta B" });
    const jpeg = await uniqueJpeg();
    const ra = await saveOfferImages(a.id, [fileOf("x.jpg", jpeg)]);
    const rb = await saveOfferImages(b.id, [fileOf("x.jpg", jpeg)]);
    await remember(a.id);
    expect(ra.data[0].src).toBe(rb.data[0].src);
    expect(await prisma.asset.count({ where: { key: { endsWith: ra.data[0].src.split("/").pop() } } })).toBe(2);
  });

  it("valida quantidade de arquivos e a oferta", async () => {
    const offer = await createOffer({ name: "Oferta limites" });
    await expectAssetError(saveOfferImages(offer.id, []), 400, "Escolha pelo menos uma imagem para enviar.");
    const many = Array.from({ length: 21 }, (_, i) => fileOf(`f${i}.png`, new Uint8Array(1)));
    await expectAssetError(saveOfferImages(offer.id, many), 400, "Envie no máximo 20 imagens por vez.");
    await expectAssetError(
      saveOfferImages("oferta-que-nao-existe", [fileOf("a.jpg", await uniqueJpeg())]),
      404,
      "Oferta não encontrada. Ela pode ter sido excluída.",
    );
    await trashOffer(offer.id);
    await expectAssetError(
      saveOfferImages(offer.id, [fileOf("a.jpg", await uniqueJpeg())]),
      404,
      /Oferta não encontrada/,
    );
  });
});

describe("listOfferImages", () => {
  it("lista só as imagens da oferta, mais novas primeiro, incluindo as da clonagem", async () => {
    const offer = await createOffer({ name: "Oferta lista" });
    const other = await createOffer({ name: "Outra" });
    const hash = (c: string) => c.repeat(64);
    await prisma.asset.createMany({
      data: [
        {
          offerId: offer.id,
          sha256: hash("a"),
          key: `a/aa/${hash("a")}.webp`,
          kind: "IMAGE",
          mime: "image/webp",
          bytes: 1000,
          width: 800,
          height: 600,
          originalName: "antiga.jpg",
          createdAt: new Date("2026-01-01T10:00:00Z"),
        },
        {
          offerId: offer.id,
          sha256: hash("b"),
          key: `a/bb/${hash("b")}.png`,
          kind: "IMAGE",
          mime: "image/png",
          bytes: 2000,
          sourceUrl: "https://site.com/img/Selo%20Garantia.png?v=2",
          createdAt: new Date("2026-03-01T10:00:00Z"),
        },
        {
          offerId: offer.id,
          sha256: hash("c"),
          key: `a/cc/${hash("c")}.svg`,
          kind: "IMAGE",
          mime: "image/svg+xml",
          bytes: 300,
          createdAt: new Date("2026-02-01T10:00:00Z"),
        },
        {
          offerId: offer.id,
          sha256: hash("d"),
          key: `a/dd/${hash("d")}.woff2`,
          kind: "FONT",
          mime: "font/woff2",
          bytes: 10,
        },
        {
          offerId: offer.id,
          sha256: hash("e"),
          key: "thumbs/nao-e-por-hash.png",
          kind: "IMAGE",
          mime: "image/png",
          bytes: 10,
        },
        {
          offerId: other.id,
          sha256: hash("f"),
          key: `a/ff/${hash("f")}.webp`,
          kind: "IMAGE",
          mime: "image/webp",
          bytes: 10,
        },
      ],
    });

    const list = await listOfferImages(offer.id);
    expect(list).toEqual([
      { type: "image", src: `/os-assets/${hash("b")}.png`, name: "Selo Garantia.png", bytes: 2000 },
      { type: "image", src: `/os-assets/${hash("c")}.svg`, name: "imagem.svg", bytes: 300 },
      { type: "image", src: `/os-assets/${hash("a")}.webp`, name: "antiga.jpg", width: 800, height: 600, bytes: 1000 },
    ]);
  });

  it("oferta inexistente ou na lixeira dá 404", async () => {
    await expectAssetError(listOfferImages("nao-existe"), 404, "Oferta não encontrada. Ela pode ter sido excluída.");
    const offer = await createOffer({ name: "Na lixeira" });
    await trashOffer(offer.id);
    await expectAssetError(listOfferImages(offer.id), 404, /Oferta não encontrada/);
  });
});

describe('importOfferImageFromUrl (botão "Usar link")', () => {
  let server: Server;
  let base: string;
  let photo: Buffer;

  beforeAll(async () => {
    photo = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#8e44ad" } })
      .jpeg()
      .toBuffer();
    server = createServer((req, res) => {
      if (req.url === "/img/Foto%20Produto.jpg") {
        res.writeHead(200, { "content-type": "image/jpeg" });
        res.end(photo);
      } else if (req.url === "/redireciona") {
        res.writeHead(302, { location: "/img/Foto%20Produto.jpg" });
        res.end();
      } else if (req.url === "/pagina") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<!doctype html><html><body>não é imagem</body></html>");
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** O servidor de teste é local: libera endereços internos só aqui. */
  async function importLocal(offerId: string, url: string) {
    const fetcher = createFetcher({ allowPrivate: true, maxBytes: IMAGE_UPLOAD_LIMITS.maxFileBytes });
    try {
      return await importOfferImageFromUrl(offerId, url, { fetcher });
    } finally {
      await fetcher.close();
    }
  }

  it("baixa, converte para WebP e guarda com o link de origem", async () => {
    const offer = await createOffer({ name: "Oferta link" });
    const image = await importLocal(offer.id, `${base}/redireciona`);
    await remember(offer.id);
    expect(image).toMatchObject({ type: "image", name: "Foto Produto.jpg", width: 2560, height: 1707 });
    expect(image.src).toMatch(/^\/os-assets\/[0-9a-f]{64}\.webp$/);
    const row = await prisma.asset.findFirstOrThrow({ where: { offerId: offer.id } });
    expect(row).toMatchObject({ kind: "IMAGE", mime: "image/webp", sourceUrl: `${base}/redireciona` });
    expect((await listOfferImages(offer.id))[0].src).toBe(image.src);
  });

  it("explica quando o link não é de uma imagem ou não abre", async () => {
    const offer = await createOffer({ name: "Oferta link ruim" });
    await expectAssetError(importLocal(offer.id, `${base}/pagina`), 415, /^Esse link não é de uma imagem/);
    await expectAssetError(
      importLocal(offer.id, `${base}/sumiu.png`),
      422,
      /^Não foi possível baixar a imagem desse link\. .*404/,
    );
    await expectAssetError(
      importLocal(offer.id, "ftp://site.com/a.png"),
      400,
      "Cole um link de imagem válido, começando com https://",
    );
    await expectAssetError(importLocal(offer.id, "não é link"), 400, /Cole um link de imagem válido/);
    expect(await prisma.asset.count({ where: { offerId: offer.id } })).toBe(0);
  });

  it("sem fetcher de teste, endereços da rede interna são bloqueados (SSRF)", async () => {
    const offer = await createOffer({ name: "Oferta ssrf" });
    await expectAssetError(
      importOfferImageFromUrl(offer.id, `${base}/img/Foto%20Produto.jpg`),
      422,
      /^Não foi possível baixar a imagem desse link\./,
    );
    expect(await prisma.asset.count({ where: { offerId: offer.id } })).toBe(0);
  });
});
