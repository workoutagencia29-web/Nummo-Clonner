/**
 * Códigos livres da página (head / início e fim do body): gravação, limite de
 * tamanho, preservação das outras chaves do JSON e injeção no HTML final.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createOffer, trashOffer } from "@/server/services/offers";
import {
  getPageCode,
  injectPageCode,
  PAGE_CODE_MAX_BYTES,
  parsePageCode,
  savePageCode,
} from "@/server/services/page-code";
import { resetDatabase } from "../setup/per-file";
import { expectUserError } from "./helpers";

beforeEach(async () => {
  await resetDatabase();
});

async function newPage() {
  const offer = await createOffer({ name: "Oferta" });
  const page = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id }, select: { id: true } });
  return { offerId: offer.id, pageId: page.id };
}

describe("getPageCode / savePageCode", () => {
  it("página nova começa sem códigos", async () => {
    const { pageId } = await newPage();
    expect(await getPageCode(pageId)).toEqual({ head: "", bodyStart: "", bodyEnd: "" });
  });

  it("salva os três campos (sem espaços sobrando e com quebras de linha normais)", async () => {
    const { pageId } = await newPage();
    const saved = await savePageCode(pageId, {
      head: '  <meta name="a" content="b">\r\n',
      bodyStart: "<noscript>x</noscript>",
      bodyEnd: "<script>\r\n  console.log(1)\r\n</script>",
    });
    expect(saved).toEqual({
      head: '<meta name="a" content="b">',
      bodyStart: "<noscript>x</noscript>",
      bodyEnd: "<script>\n  console.log(1)\n</script>",
    });
    expect(await getPageCode(pageId)).toEqual(saved);
  });

  it("preserva as outras chaves do JSON (ex.: dados dos pixels)", async () => {
    const { pageId } = await newPage();
    await prisma.page.update({ where: { id: pageId }, data: { customCode: { consent: "marketing", head: "velho" } } });
    await savePageCode(pageId, { head: "novo" });
    const page = await prisma.page.findUniqueOrThrow({ where: { id: pageId }, select: { customCode: true } });
    expect(page.customCode).toEqual({ consent: "marketing", head: "novo", bodyStart: "", bodyEnd: "" });
  });

  it("marca a oferta como alterada", async () => {
    const { offerId, pageId } = await newPage();
    const before = await prisma.offer.findUniqueOrThrow({ where: { id: offerId }, select: { updatedAt: true } });
    await new Promise((r) => setTimeout(r, 5));
    await savePageCode(pageId, { bodyEnd: "<!-- ok -->" });
    const after = await prisma.offer.findUniqueOrThrow({ where: { id: offerId }, select: { updatedAt: true } });
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });

  it("recusa mais de 200 KB somando os campos (mensagem em português, campo maior)", async () => {
    const { pageId } = await newPage();
    const half = "a".repeat(PAGE_CODE_MAX_BYTES / 2);
    // Exatamente no limite passa.
    await savePageCode(pageId, { head: half, bodyEnd: half });
    const err = await expectUserError(
      savePageCode(pageId, { head: half, bodyEnd: `${half}bb` }),
      /^Os códigos da página somam 200,1 KB e o limite é 200 KB\./,
      "bodyEnd",
    );
    expect((err as Error).message).toContain("<script src=…>");
    // Acentos contam em bytes (UTF-8), não em letras.
    await expectUserError(
      savePageCode(pageId, { head: "é".repeat(PAGE_CODE_MAX_BYTES / 2 + 1) }),
      /limite é 200 KB/,
      "head",
    );
    // Nada mudou.
    expect((await getPageCode(pageId)).head).toBe(half);
  });

  it("página inexistente ou de oferta na lixeira", async () => {
    await expectUserError(getPageCode("nao-existe"), "Página não encontrada. Ela pode ter sido excluída.");
    const { offerId, pageId } = await newPage();
    await trashOffer(offerId);
    await expectUserError(savePageCode(pageId, { head: "x" }), "Página não encontrada. Ela pode ter sido excluída.");
  });

  it("lê qualquer JSON guardado sem quebrar", () => {
    expect(parsePageCode(null)).toEqual({ head: "", bodyStart: "", bodyEnd: "" });
    expect(parsePageCode([1, 2])).toEqual({ head: "", bodyStart: "", bodyEnd: "" });
    expect(parsePageCode({ head: 42, bodyEnd: "x", outro: true })).toEqual({ head: "", bodyStart: "", bodyEnd: "x" });
  });
});

describe("injectPageCode", () => {
  const page = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>T</title></head><body class="x" data-a="1"><h1>Oi</h1><script data-os-runtime></script></body></html>`;

  it("coloca cada código no lugar certo", () => {
    const out = injectPageCode(page, {
      head: "<meta name=h>",
      bodyStart: "<noscript>s</noscript>",
      bodyEnd: "<script>fim()</script>",
    });
    expect(out).toContain("<title>T</title><meta name=h>\n</head>");
    expect(out).toContain('<body class="x" data-a="1">\n<noscript>s</noscript><h1>Oi</h1>');
    expect(out).toContain("<script data-os-runtime></script><script>fim()</script>\n</body>");
    // Ordem no documento: head < início do body < conteúdo < fim do body.
    const order = ["<meta name=h>", "<noscript>s</noscript>", "<h1>Oi</h1>", "<script>fim()</script>"].map((s) =>
      out.indexOf(s),
    );
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("sem códigos (ou só espaços) devolve o HTML igual", () => {
    expect(injectPageCode(page, null)).toBe(page);
    expect(injectPageCode(page, undefined)).toBe(page);
    expect(injectPageCode(page, { head: "  ", bodyStart: "", bodyEnd: "\n" })).toBe(page);
  });

  it("não interpreta $ do código como padrão de substituição", () => {
    const code = "<script>var p = '$&'; var q = \"$1 $$ $`\";</script>";
    const out = injectPageCode(page, { head: code, bodyStart: code, bodyEnd: code });
    expect(out.split(code)).toHaveLength(4);
  });

  it("usa o último </body> (textos com </body> no meio não confundem)", () => {
    const html = `<html><head></head><body><script>var s = "</body>";</script><p>x</p></body></html>`;
    const out = injectPageCode(html, { bodyEnd: "<i>fim</i>" });
    expect(out).toBe(`<html><head></head><body><script>var s = "</body>";</script><p>x</p><i>fim</i>\n</body></html>`);
  });

  it("HTML sem head/body: cria o head ou coloca nas pontas", () => {
    expect(injectPageCode("<body><p>x</p></body>", { head: "<meta a>" })).toBe(
      "<head><meta a></head>\n<body><p>x</p></body>",
    );
    expect(injectPageCode("<p>x</p>", { head: "<meta a>", bodyStart: "<b>i</b>", bodyEnd: "<b>f</b>" })).toBe(
      "<b>i</b>\n<meta a>\n<p>x</p>\n<b>f</b>",
    );
  });
});
