import { describe, expect, it } from "vitest";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { toUserMessage, UserError, uniqueViolationFields, uniqueViolationModel } from "@/lib/errors";
import { authErrorMessage } from "@/lib/errors-client";
import { catchError } from "./helpers";

/** Palavras típicas das mensagens padrão do zod em inglês. */
const ENGLISH = /\b(expected|received|invalid|too small|too big|required|must|string|number)\b/i;
const GENERIC = "Algo deu errado. Tente de novo em alguns segundos.";

describe("toUserMessage — erros do nosso código", () => {
  it("repassa mensagem e campo do UserError", () => {
    expect(toUserMessage(new UserError("A pasta escolhida não existe mais.", "folderId"))).toEqual({
      message: "A pasta escolhida não existe mais.",
      field: "folderId",
    });
    expect(toUserMessage(new UserError("Oferta não encontrada."))).toEqual({
      message: "Oferta não encontrada.",
      field: undefined,
    });
  });

  it("UserError é um Error com nome próprio", () => {
    const err = new UserError("x", "y");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("UserError");
  });
});

describe("toUserMessage — validação (zod)", () => {
  it("mensagens padrão do zod saem em português", () => {
    const tooShort = z.object({ name: z.string().min(3) }).safeParse({ name: "a" });
    expect(tooShort.success).toBe(false);
    const info = toUserMessage(tooShort.error);
    expect(info.field).toBe("name");
    expect(info.message).not.toMatch(ENGLISH);
    expect(info.message).toMatch(/pequeno|caracteres/i);

    const wrongType = z.object({ offer: z.object({ price: z.number() }) }).safeParse({ offer: { price: "10" } });
    const typeInfo = toUserMessage(wrongType.error);
    expect(typeInfo.field).toBe("offer.price");
    expect(typeInfo.message).not.toMatch(ENGLISH);
    expect(typeInfo.message).toMatch(/inválid|esperava/i);

    const email = toUserMessage(z.email().safeParse("nao-e-email").error);
    expect(email.message).not.toMatch(ENGLISH);
    expect(email.field).toBeUndefined();
  });

  it("usa a mensagem personalizada do schema quando existe", () => {
    const result = z.object({ name: z.string().min(1, "Dê um nome para a oferta.") }).safeParse({ name: "" });
    expect(toUserMessage(result.error)).toEqual({ message: "Dê um nome para a oferta.", field: "name" });
  });
});

describe("toUserMessage — erros reais do banco", () => {
  it("nome repetido (nameKey) diz o que já existe: pasta ou tag", async () => {
    await prisma.folder.create({ data: { name: "Nutra", nameKey: "nutra" } });
    const err = await catchError(prisma.folder.create({ data: { name: "NUTRA", nameKey: "nutra" } }));

    expect(err).toMatchObject({ code: "P2002" });
    expect(uniqueViolationFields(err)).toEqual(["nameKey"]);
    expect(uniqueViolationModel(err)).toBe("Folder");
    expect(toUserMessage(err)).toEqual({ message: "Já existe uma pasta com esse nome.", field: "nameKey" });

    await prisma.tag.create({ data: { name: "Saúde", nameKey: "saude" } });
    const tagErr = await catchError(prisma.tag.create({ data: { name: "SAUDE", nameKey: "saude" } }));
    expect(toUserMessage(tagErr)).toEqual({ message: "Já existe uma tag com esse nome.", field: "nameKey" });
  });

  it("nome repetido sem a tabela informada cai na mensagem geral", () => {
    const err = Object.assign(new Error("unique"), { code: "P2002", meta: { target: ["nameKey"] } });
    expect(toUserMessage(err)).toEqual({ message: "Já existe um item com esse nome.", field: "nameKey" });
  });

  it("slug repetido na mesma oferta vira mensagem sobre o endereço", async () => {
    const offer = await prisma.offer.create({
      data: { name: "Oferta", pages: { create: { name: "Vendas", slug: "vendas" } } },
    });
    const err = await catchError(prisma.page.create({ data: { offerId: offer.id, name: "Outra", slug: "vendas" } }));

    expect(err).toMatchObject({ code: "P2002" });
    expect(toUserMessage(err)).toEqual({
      message: "Já existe uma página com esse endereço (slug) nesta oferta.",
      field: "slug",
    });
  });

  it("variação repetida na mesma página vira mensagem sobre a variação", async () => {
    const offer = await prisma.offer.create({
      data: {
        name: "Oferta 2",
        pages: { create: { name: "Vendas", slug: "vendas", variants: { create: { name: "A", isControl: true } } } },
      },
      include: { pages: true },
    });
    const err = await catchError(prisma.pageVariant.create({ data: { pageId: offer.pages[0].id, name: "A" } }));

    expect(toUserMessage(err)).toEqual({
      message: "Já existe uma variação com esse nome nesta página.",
      field: "name",
    });
  });

  it("unicidade sem mensagem específica usa um texto genérico em português", async () => {
    const offer = await prisma.offer.create({
      data: { name: "Oferta 3", pages: { create: { name: "Home", slug: "home", isHome: true } } },
    });
    // Índice parcial "uma página inicial por oferta".
    const err = await catchError(
      prisma.page.create({ data: { offerId: offer.id, name: "Outra", slug: "outra", isHome: true } }),
    );

    expect(err).toMatchObject({ code: "P2002" });
    expect(toUserMessage(err).message).toBe("Esse item já existe.");
  });

  it("registro inexistente (P2025) vira “Não encontramos…”", async () => {
    const err = await catchError(prisma.folder.update({ where: { id: "nao-existe" }, data: { name: "x" } }));

    expect(err).toMatchObject({ code: "P2025" });
    expect(toUserMessage(err)).toEqual({ message: "Não encontramos esse item. Ele pode ter sido excluído." });
  });

  it("chave estrangeira inválida (P2003) tem mensagem em português", async () => {
    const err = await catchError(prisma.page.create({ data: { offerId: "nao-existe", name: "x", slug: "x" } }));

    expect(err).toMatchObject({ code: "P2003" });
    expect(toUserMessage(err).message).toBe("Não foi possível concluir: há itens ligados a este registro.");
  });

  it("uniqueViolationFields ignora erros que não são de unicidade", () => {
    expect(uniqueViolationFields(new Error("x"))).toEqual([]);
    expect(uniqueViolationFields(Object.assign(new Error("x"), { code: "P2025" }))).toEqual([]);
  });

  it("aceita os formatos antigos de meta.target (lista ou texto)", () => {
    const asList = Object.assign(new Error("x"), { code: "P2002", meta: { target: ["offerId", "slug"] } });
    const asText = Object.assign(new Error("x"), { code: "P2002", meta: { target: "email" } });
    expect(toUserMessage(asList).field).toBe("slug");
    expect(toUserMessage(asText).message).toBe("Já existe uma conta com esse e-mail.");
  });
});

describe("toUserMessage — erros inesperados", () => {
  it("nunca mostra detalhes técnicos", () => {
    expect(toUserMessage(new Error("ECONNRESET: socket hang up"))).toEqual({ message: GENERIC });
    expect(toUserMessage(new TypeError("Cannot read properties of undefined"))).toEqual({ message: GENERIC });
    expect(toUserMessage("texto solto")).toEqual({ message: GENERIC });
    expect(toUserMessage(null)).toEqual({ message: GENERIC });
    expect(toUserMessage(Object.assign(new Error("x"), { code: "P9999" }))).toEqual({ message: GENERIC });
  });

  it("banco fora do ar tem mensagem própria", () => {
    const err = Object.assign(new Error("Can't reach database server"), { code: "P1001" });
    expect(toUserMessage(err).message).toBe(
      "O banco de dados não está respondendo. Feche e abra o Offer Studio de novo.",
    );
  });
});

describe("authErrorMessage", () => {
  it("muitas tentativas (429)", () => {
    expect(authErrorMessage({ status: 429 })).toBe("Muitas tentativas. Aguarde um minuto e tente de novo.");
    expect(authErrorMessage({ status: 429, code: "INVALID_EMAIL_OR_PASSWORD" })).toBe(
      "Muitas tentativas. Aguarde um minuto e tente de novo.",
    );
  });

  it("códigos conhecidos do Better Auth", () => {
    expect(authErrorMessage({ code: "INVALID_EMAIL_OR_PASSWORD", status: 401 })).toBe("E-mail ou senha incorretos.");
    expect(authErrorMessage({ code: "SINGLE_USER_ONLY", status: 403 })).toBe(
      "Já existe uma conta neste Offer Studio. Entre com ela.",
    );
  });

  it("código desconhecido não repassa a mensagem em inglês", () => {
    const message = authErrorMessage({ code: "SOMETHING_NEW", status: 400, message: "Something went wrong" });
    expect(message).toBe("Não foi possível concluir. Confira os dados e tente de novo.");
    expect(authErrorMessage({})).toBe("Não foi possível concluir. Confira os dados e tente de novo.");
  });

  it("sem erro", () => {
    expect(authErrorMessage(null)).toBe("Algo deu errado. Tente de novo.");
    expect(authErrorMessage(undefined)).toBe("Algo deu errado. Tente de novo.");
  });
});
