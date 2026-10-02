/**
 * Fase 4 — configurações da oferta (empresa, SEO, idioma) e SEO das páginas
 * (src/server/services/offer-settings.ts) e os marcadores das páginas legais.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { privacyHtml, termsHtml } from "@/editor/templates/legal";
import { prisma } from "@/lib/db";
import { type Company, documentKind, fillCompanyPlaceholders } from "@/lib/offer-settings";
import {
  getOfferSettings,
  getOfferSettingsPanel,
  getPageSeo,
  saveOfferSettings,
  savePageSeo,
} from "@/server/services/offer-settings";
import { createOffer } from "@/server/services/offers";
import { resetDatabase } from "../setup/per-file";
import { expectUserError } from "./helpers";

const SHA = "ab".repeat(32);
const KEY = `a/ab/${SHA}.webp`;
const SRC = `/os-assets/${SHA}.webp`;

async function offerWithImage() {
  const offer = await createOffer({ name: "Oferta" });
  const page = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id } });
  await prisma.asset.create({
    data: { offerId: offer.id, sha256: SHA, key: KEY, kind: "IMAGE", mime: "image/webp", bytes: 10 },
  });
  return { offerId: offer.id, pageId: page.id };
}

beforeEach(async () => {
  await resetDatabase();
});

describe("configurações da oferta", () => {
  it("padrões, salvar parcial e manter outras chaves do JSON", async () => {
    const { offerId } = await offerWithImage();
    await prisma.offer.update({ where: { id: offerId }, data: { settings: { futuro: { x: 1 } } } });
    // Idioma vazio = igual à página (o <html lang> de cada página fica como está).
    expect(await getOfferSettings(offerId)).toMatchObject({ language: "", company: { name: "" } });
    await saveOfferSettings(offerId, { company: { name: "  ACME Ltda ", email: "contato@acme.com.br" } });
    const saved = await saveOfferSettings(offerId, {
      seo: { title: "Curso X", faviconKey: SRC, noindex: true },
      language: "es",
    });
    expect(saved).toEqual({
      company: { name: "ACME Ltda", document: "", email: "contato@acme.com.br", phone: "", address: "" },
      seo: { title: "Curso X", description: "", faviconKey: KEY, ogImageKey: null, noindex: true },
      language: "es",
    });
    const row = await prisma.offer.findUniqueOrThrow({ where: { id: offerId } });
    expect(row.settings).toMatchObject({ futuro: { x: 1 }, language: "es" });

    const panel = await getOfferSettingsPanel(offerId);
    expect(panel?.faviconSrc).toBe(SRC);
    expect(panel?.ogImageSrc).toBeNull();
    expect(panel?.pages).toHaveLength(1);
    expect(panel?.pages[0].effective.title).toBe("Curso X");
    expect(await getOfferSettingsPanel("nao-existe")).toBeNull();
  });

  it("valida e-mail, tamanhos e imagens da biblioteca desta oferta", async () => {
    const { offerId } = await offerWithImage();
    const other = await createOffer({ name: "Outra" });
    await expectUserError(
      saveOfferSettings(offerId, { company: { email: "contato@" } }),
      "Digite um e-mail válido, como contato@suaempresa.com.br.",
      "company.email",
    );
    await expectUserError(
      saveOfferSettings(offerId, { seo: { title: "x".repeat(161) } }),
      "O título pode ter no máximo 160 caracteres.",
      "seo.title",
    );
    await expectUserError(
      saveOfferSettings(offerId, { company: { address: "x".repeat(301) } }),
      "O endereço pode ter no máximo 300 caracteres.",
      "company.address",
    );
    await expectUserError(
      saveOfferSettings(offerId, { seo: { ogImageKey: "../../etc/passwd" } }),
      "Escolha a imagem de novo na biblioteca.",
      "seo.ogImageKey",
    );
    await expectUserError(
      saveOfferSettings(other.id, { seo: { ogImageKey: KEY } }),
      "Essa imagem não está na biblioteca desta oferta. Envie a imagem de novo.",
      "seo.ogImageKey",
    );
    await expectUserError(
      saveOfferSettings(offerId, { language: "fr" as never }),
      "Escolha o idioma da página.",
      "language",
    );
    // Tirar a imagem: null ou vazio.
    await saveOfferSettings(offerId, { seo: { ogImageKey: KEY } });
    expect((await saveOfferSettings(offerId, { seo: { ogImageKey: "" as never } })).seo.ogImageKey).toBeNull();
    await expectUserError(saveOfferSettings("nao-existe", {}), /Oferta não encontrada/);
  });

  it("marcadores das páginas legais usam os dados da empresa (escapados)", async () => {
    const { offerId } = await offerWithImage();
    const s = await saveOfferSettings(offerId, { company: { name: "A & B <Ltda>", document: "12.345.678/0001-90" } });
    expect(fillCompanyPlaceholders("<p>{{EMPRESA}} — {{CNPJ}} — {{EMAIL}}</p>", s.company)).toBe(
      "<p>A &#38; B &#60;Ltda&#62; — 12.345.678/0001-90 — {{EMAIL}}</p>",
    );
  });
});

describe("SEO da página", () => {
  it("vazio herda da oferta; salvar parcial; noindex pode herdar (null)", async () => {
    const { offerId, pageId } = await offerWithImage();
    await saveOfferSettings(offerId, { seo: { title: "Padrão", description: "Desc", ogImageKey: KEY, noindex: true } });
    const initial = await getPageSeo(pageId);
    expect(initial.seo).toEqual({ title: "", description: "", faviconKey: null, ogImageKey: null, noindex: null });
    expect(initial.effective).toEqual({
      title: "Padrão",
      description: "Desc",
      faviconKey: null,
      ogImageKey: KEY,
      noindex: true,
    });
    expect(initial.ogImageSrc).toBe(SRC);

    const saved = await savePageSeo(pageId, { title: "Página de obrigado", noindex: false });
    expect(saved.seo).toMatchObject({ title: "Página de obrigado", noindex: false });
    expect(saved.effective).toMatchObject({ title: "Página de obrigado", description: "Desc", noindex: false });
    const again = await savePageSeo(pageId, { description: "Só aqui", faviconKey: SRC });
    expect(again.seo).toMatchObject({ title: "Página de obrigado", description: "Só aqui", faviconKey: KEY });
    expect(again.faviconSrc).toBe(SRC);

    await expectUserError(
      savePageSeo(pageId, { description: "x".repeat(321) }),
      "A descrição pode ter no máximo 320 caracteres.",
      "description",
    );
    await expectUserError(
      savePageSeo(pageId, { faviconKey: `a/cd/${"cd".repeat(32)}.png` }),
      /não está na biblioteca/,
      "faviconKey",
    );
    await expectUserError(getPageSeo("nao-existe"), /Página não encontrada/);
  });
});

describe("páginas legais: telefone, endereço e CPF/CNPJ", () => {
  const company = (over: Partial<Company> = {}): Company => ({
    name: "Maria Silva",
    document: "123.456.789-09",
    email: "contato@exemplo.com",
    phone: "(11) 99999-0000",
    address: "Rua A, 10 — São Paulo/SP",
    ...over,
  });
  const text = (html: string) => html.replace(/<[^>]+>/g, "");

  it("CPF (11 dígitos) ou CNPJ (14 dígitos) pelo número", () => {
    expect(documentKind("123.456.789-09")).toBe("CPF");
    expect(documentKind("12.345.678/0001-90")).toBe("CNPJ");
    expect(documentKind("")).toBeNull();
    expect(documentKind("123")).toBeNull();
  });

  it("os modelos usam {{TELEFONE}} e {{ENDERECO}}: os campos da empresa aparecem na política e nos termos", () => {
    for (const html of [privacyHtml, termsHtml]) {
      expect(html).toContain("{{TELEFONE}}");
      expect(html).toContain("{{ENDERECO}}");
      const out = text(fillCompanyPlaceholders(html, company()));
      expect(out).toContain("(11) 99999-0000");
      expect(out).toContain("Rua A, 10 — São Paulo/SP");
      expect(out).not.toMatch(/\{\{(TELEFONE|ENDERECO|EMPRESA|CNPJ|EMAIL)\}\}/);
    }
  });

  it("telefone e endereço vazios (são opcionais): o trecho sai da política e dos termos, sem marcador à mostra", () => {
    const partial = company({ phone: "", address: "" });
    for (const html of [privacyHtml, termsHtml]) {
      const out = text(fillCompanyPlaceholders(html, partial));
      expect(out).not.toMatch(/\{\{(TELEFONE|ENDERECO)\}\}/);
      expect(out).not.toMatch(/Telefone:|Endereço:|com endereço em/);
      expect(out).toContain("contato@exemplo.com");
      expect(out).toContain("Maria Silva");
    }
    const terms = text(fillCompanyPlaceholders(termsHtml, partial));
    expect(terms).toContain(
      "Este site é mantido por Maria Silva, CPF nº 123.456.789-09. Contato: contato@exemplo.com.",
    );
    expect(terms).toContain("Dúvidas, sugestões ou solicitações: contato@exemplo.com.");
    expect(terms).toMatch(/Maria Silva — CPF 123\.456\.789-09\s*$/m);
    const privacy = text(fillCompanyPlaceholders(privacyHtml, partial));
    expect(privacy).toContain("Maria Silva — CPF 123.456.789-09E-mail: contato@exemplo.com");
    // Só o telefone vazio: o endereço continua.
    const onlyAddress = text(fillCompanyPlaceholders(termsHtml, company({ phone: "" })));
    expect(onlyAddress).toContain("com endereço em Rua A, 10 — São Paulo/SP. Contato: contato@exemplo.com.");
    // Nome, documento e e-mail vazios continuam à mostra (o usuário precisa preencher).
    expect(text(fillCompanyPlaceholders(termsHtml, company({ email: "" })))).toContain("{{EMAIL}}");
  });

  it("páginas criadas antes (sem o trecho opcional marcado): as frases do modelo com telefone/endereço vazios também saem", () => {
    const old =
      '<p>X — CNPJ/CPF <span class="os-ph">{{CNPJ}}</span><br>E-mail: <span class="os-ph">{{EMAIL}}</span><br>Telefone: <span class="os-ph">{{TELEFONE}}</span><br>Endereço: <span class="os-ph">{{ENDERECO}}</span></p>' +
      '<p>Este site é mantido por X, CNPJ/CPF nº <span class="os-ph">{{CNPJ}}</span>, com endereço em <span class="os-ph">{{ENDERECO}}</span>. Contato: <span class="os-ph">{{EMAIL}}</span> · <span class="os-ph">{{TELEFONE}}</span>.</p>';
    const out = text(fillCompanyPlaceholders(old, company({ phone: "", address: "" })));
    expect(out).toBe(
      "X — CPF 123.456.789-09E-mail: contato@exemplo.comEste site é mantido por X, CPF nº 123.456.789-09. Contato: contato@exemplo.com.",
    );
  });

  it("produtor pessoa física: o documento sai como CPF (nunca 'inscrita no CNPJ' com um CPF)", () => {
    const cpf = text(fillCompanyPlaceholders(privacyHtml, company()));
    expect(cpf).toContain("CPF nº 123.456.789-09");
    expect(cpf).not.toMatch(/CNPJ(\/CPF)?\s*(nº\s*)?123\.456/);
    const cnpj = text(fillCompanyPlaceholders(termsHtml, company({ document: "12.345.678/0001-90" })));
    expect(cnpj).toContain("CNPJ nº 12.345.678/0001-90");
    // Modelo antigo (já salvo em páginas): "inscrita no CNPJ sob o nº {{CNPJ}}".
    const old = '<p>inscrita no CNPJ sob o nº <span class="os-ph">{{CNPJ}}</span></p>';
    expect(text(fillCompanyPlaceholders(old, company()))).toBe("inscrita no CPF sob o nº 123.456.789-09");
    // Número que não dá para saber: o rótulo fica como está.
    expect(text(fillCompanyPlaceholders(old, company({ document: "ABC" })))).toBe("inscrita no CNPJ sob o nº ABC");
  });
});
