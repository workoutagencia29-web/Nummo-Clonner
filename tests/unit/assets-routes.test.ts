/**
 * Rotas de imagens do editor chamadas direto (sem servidor), com a sessão simulada:
 * POST /api/assets/upload e GET /api/offers/[id]/assets.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));

import { POST } from "@/app/api/assets/upload/route";
import { GET } from "@/app/api/offers/[id]/assets/route";
import { prisma } from "@/lib/db";
import { deleteObject } from "@/lib/storage";
import { createOffer } from "@/server/services/offers";
import { resetDatabase } from "../setup/per-file";

const HOST = `localhost:${process.env.PORT || "3000"}`;
const written = new Set<string>();

beforeEach(async () => {
  await resetDatabase();
  getSession.mockReset();
  getSession.mockResolvedValue({ user: { id: "u1" }, session: { id: "s1" } });
});

afterAll(async () => {
  for (const key of written) await deleteObject(key);
});

async function remember() {
  for (const r of await prisma.asset.findMany({ select: { key: true } })) written.add(r.key);
}

let seed = 0;
async function jpegFile(name: string, width = 300, height = 200) {
  seed++;
  const data = await sharp({
    create: { width, height, channels: 3, background: { r: (seed * 37) % 256, g: 120, b: (seed * 11) % 256 } },
  })
    .jpeg()
    .toBuffer();
  return new File([new Uint8Array(data)], name, { type: "image/jpeg" });
}

function uploadRequest(form: FormData, { query = "", host = HOST }: { query?: string; host?: string } = {}) {
  return new Request(`http://${host}/api/assets/upload${query}`, { method: "POST", headers: { host }, body: form });
}

function listRequest(offerId: string, host = HOST) {
  return [
    new Request(`http://${host}/api/offers/${offerId}/assets`, { headers: { host } }),
    { params: Promise.resolve({ id: offerId }) },
  ] as const;
}

describe("POST /api/assets/upload", () => {
  it("exige login e o endereço do painel", async () => {
    const offer = await createOffer({ name: "Oferta" });
    const form = new FormData();
    form.append("offerId", offer.id);
    form.append("files", await jpegFile("a.jpg"));

    const wrongHost = await POST(uploadRequest(form, { host: "mal.example:3000" }));
    expect(wrongHost.status).toBe(403);
    expect(await wrongHost.json()).toEqual({ error: "Endereço não permitido." });

    getSession.mockResolvedValue(null);
    const noSession = await POST(uploadRequest(form));
    expect(noSession.status).toBe(401);
    expect(await noSession.json()).toEqual({ error: "Sua sessão expirou. Entre de novo." });
    expect(await prisma.asset.count()).toBe(0);
  });

  it("aceita o formato do GrapesJS (files[] + offerId) e responde { data }", async () => {
    const offer = await createOffer({ name: "Oferta" });
    const form = new FormData();
    form.append("offerId", offer.id);
    form.append("files[]", await jpegFile("capa.jpg", 3200, 1600));
    form.append("files[]", await jpegFile("depoimento.jpg"));

    const res = await POST(uploadRequest(form));
    await remember();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { data: { src: string }[]; errors?: unknown };
    expect(body.errors).toBeUndefined();
    expect(body.data).toEqual([
      expect.objectContaining({ type: "image", name: "capa.jpg", width: 2560, height: 1280 }),
      expect.objectContaining({ type: "image", name: "depoimento.jpg", width: 300, height: 200 }),
    ]);
    for (const item of body.data) expect(item.src).toMatch(/^\/os-assets\/[0-9a-f]{64}\.webp$/);
    expect(await prisma.asset.count({ where: { offerId: offer.id, kind: "IMAGE" } })).toBe(2);
  });

  it("aceita offerId na URL e o campo files", async () => {
    const offer = await createOffer({ name: "Oferta" });
    const form = new FormData();
    form.append("files", await jpegFile("x.jpg"));
    const res = await POST(uploadRequest(form, { query: `?offerId=${offer.id}` }));
    await remember();
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown[] }).data).toHaveLength(1);
  });

  it("envio parcial: devolve as que deram certo e os erros", async () => {
    const offer = await createOffer({ name: "Oferta" });
    const form = new FormData();
    form.append("offerId", offer.id);
    form.append("files", await jpegFile("ok.jpg"));
    form.append("files", new File(["texto"], "notas.txt", { type: "text/plain" }));
    const res = await POST(uploadRequest(form));
    await remember();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[]; errors: unknown[] };
    expect(body.data).toHaveLength(1);
    expect(body.errors).toEqual([
      {
        name: "notas.txt",
        error: '"notas.txt" não é uma imagem aceita. Envie JPG, PNG, WebP, GIF, AVIF ou SVG.',
        status: 415,
      },
    ]);
  });

  it("nenhuma imagem válida: status do problema e mensagem em português", async () => {
    const offer = await createOffer({ name: "Oferta" });
    const one = new FormData();
    one.append("offerId", offer.id);
    one.append("files", new File(["texto"], "notas.txt", { type: "text/plain" }));
    const res = await POST(uploadRequest(one));
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({
      error: '"notas.txt" não é uma imagem aceita. Envie JPG, PNG, WebP, GIF, AVIF ou SVG.',
    });

    const two = new FormData();
    two.append("offerId", offer.id);
    two.append("files", new File(["texto"], "notas.txt", { type: "text/plain" }));
    two.append("files", new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01])], "ruim.jpg", { type: "image/jpeg" }));
    const res2 = await POST(uploadRequest(two));
    expect(res2.status).toBe(400);
    const body2 = (await res2.json()) as { error: string; errors: unknown[] };
    expect(body2.error).toBe(
      'Nenhuma das 2 imagens foi enviada. "notas.txt" não é uma imagem aceita. Envie JPG, PNG, WebP, GIF, AVIF ou SVG.',
    );
    expect(body2.errors).toHaveLength(2);
  });

  it("valida oferta, arquivos e formato do envio", async () => {
    const offer = await createOffer({ name: "Oferta" });

    const noOffer = new FormData();
    noOffer.append("files", await jpegFile("a.jpg"));
    const r1 = await POST(uploadRequest(noOffer));
    expect(r1.status).toBe(400);
    expect(((await r1.json()) as { error: string }).error).toMatch(/identificar a oferta/);

    const noFiles = new FormData();
    noFiles.append("offerId", offer.id);
    const r2 = await POST(uploadRequest(noFiles));
    expect(r2.status).toBe(400);
    expect(await r2.json()).toEqual({ error: "Escolha pelo menos uma imagem para enviar." });

    const ghost = new FormData();
    ghost.append("offerId", "nao-existe");
    ghost.append("files", await jpegFile("a.jpg"));
    const r3 = await POST(uploadRequest(ghost));
    expect(r3.status).toBe(404);
    expect(await r3.json()).toEqual({ error: "Oferta não encontrada. Ela pode ter sido excluída." });

    const json = await POST(
      new Request(`http://${HOST}/api/assets/upload`, {
        method: "POST",
        headers: { host: HOST, "content-type": "application/json" },
        body: JSON.stringify({ offerId: offer.id }),
      }),
    );
    expect(json.status).toBe(415);

    const huge = await POST(
      new Request(`http://${HOST}/api/assets/upload`, {
        method: "POST",
        headers: {
          host: HOST,
          "content-type": "multipart/form-data; boundary=x",
          "content-length": String(400 * 1024 * 1024),
        },
        body: "--x--",
      }),
    );
    expect(huge.status).toBe(413);
    expect(await huge.json()).toEqual({ error: "Envio grande demais: mande no máximo 20 imagens de até 15 MB cada." });

    const broken = await POST(
      new Request(`http://${HOST}/api/assets/upload`, {
        method: "POST",
        headers: { host: HOST, "content-type": "multipart/form-data; boundary=abc" },
        body: "isto não é multipart",
      }),
    );
    expect(broken.status).toBe(400);
    expect(await broken.json()).toEqual({ error: "Não foi possível ler o envio. Tente de novo." });
    expect(await prisma.asset.count()).toBe(0);
  });
});

describe('POST /api/assets/upload com link ("Usar link")', () => {
  it("baixa a imagem do link e responde no mesmo formato", async () => {
    const png = await sharp({ create: { width: 40, height: 30, channels: 4, background: "#16a085" } })
      .png()
      .toBuffer();
    const server = createServer((req, res) => {
      if (req.url === "/selo.png") {
        res.writeHead(200, { "content-type": "image/png" });
        res.end(png);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const previous = process.env.OS_CLONE_HOST_MAP;
    process.env.OS_CLONE_HOST_MAP = `imagens.fixture.test=127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const offer = await createOffer({ name: "Oferta" });
      const form = new FormData();
      form.append("offerId", offer.id);
      form.append("url", "http://imagens.fixture.test/selo.png");
      const res = await POST(uploadRequest(form));
      await remember();
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { src: string }[] };
      expect(body.data).toEqual([expect.objectContaining({ type: "image", name: "selo.png", width: 40, height: 30 })]);
      expect(body.data[0].src).toMatch(/^\/os-assets\/[0-9a-f]{64}\.webp$/);

      const missing = new FormData();
      missing.append("offerId", offer.id);
      missing.append("url", "http://imagens.fixture.test/nao-existe.png");
      const res404 = await POST(uploadRequest(missing));
      expect(res404.status).toBe(422);
      expect(((await res404.json()) as { error: string }).error).toMatch(
        /^Não foi possível baixar a imagem desse link\./,
      );

      const bad = new FormData();
      bad.append("offerId", offer.id);
      bad.append("url", "javascript:alert(1)");
      const res400 = await POST(uploadRequest(bad));
      expect(res400.status).toBe(400);
      expect(await res400.json()).toEqual({ error: "Cole um link de imagem válido, começando com https://" });
    } finally {
      if (previous === undefined) delete process.env.OS_CLONE_HOST_MAP;
      else process.env.OS_CLONE_HOST_MAP = previous;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("GET /api/offers/[id]/assets", () => {
  it("lista as imagens da oferta, mais novas primeiro", async () => {
    const offer = await createOffer({ name: "Oferta" });
    const first = new FormData();
    first.append("offerId", offer.id);
    first.append("files", await jpegFile("primeira.jpg"));
    await POST(uploadRequest(first));
    const second = new FormData();
    second.append("offerId", offer.id);
    second.append("files", await jpegFile("segunda.jpg"));
    await POST(uploadRequest(second));
    await remember();

    const res = await GET(...listRequest(offer.id));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { data: { name: string; type: string }[] };
    expect(body.data.map((d) => d.name)).toEqual(["segunda.jpg", "primeira.jpg"]);
    expect(body.data.every((d) => d.type === "image")).toBe(true);
  });

  it("404 para oferta que não existe; 401 sem login", async () => {
    const res = await GET(...listRequest("nao-existe"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Oferta não encontrada. Ela pode ter sido excluída." });

    getSession.mockResolvedValue(null);
    const offer = await createOffer({ name: "Oferta" });
    const denied = await GET(...listRequest(offer.id));
    expect(denied.status).toBe(401);
  });
});
