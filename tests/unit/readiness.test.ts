/**
 * "Próximos passos" da oferta (src/lib/readiness.ts): o que falta para o ZIP
 * sair pronto — botões de compra sem link, checkout da página clonada,
 * marcadores da empresa, pixel, ZIP e "Onde está no ar".
 */
import { describe, expect, it } from "vitest";
import { buyButtons, computeReadiness, missingCompanyFields, type ReadinessInput } from "@/lib/readiness";

const company = { name: "", document: "", email: "", phone: "", address: "" };
const base: ReadinessInput = {
  htmls: [],
  links: [],
  clonedCheckoutUrls: [],
  pixelCount: 0,
  company,
  liveUrl: null,
  lastZipAt: null,
};
const label = () => "01/10/2026 às 10:00";
const item = (input: Partial<ReadinessInput>, id: string) =>
  computeReadiness({ ...base, ...input }, label).items.find((i) => i.id === id);

describe("buyButtons", () => {
  it("conta os botões ligados a links da oferta e os que levam a algum lugar", () => {
    const html = `<a data-os-link="">Comprar</a><a data-os-link="checkout">Sim</a><button data-os-link='upsell'>x</button>`;
    expect(
      buyButtons(
        [html],
        [
          { key: "checkout", url: "https://pay.kiwify.com.br/x" },
          { key: "upsell", url: "" },
        ],
      ),
    ).toEqual({
      total: 3,
      connected: 1,
    });
    expect(buyButtons(["<p>sem botões</p>"], [])).toEqual({ total: 0, connected: 0 });
  });
});

describe("missingCompanyFields", () => {
  it("só cobra os marcadores que as páginas usam", () => {
    expect(missingCompanyFields(["<p>© {{EMPRESA}} — {{CNPJ}}</p>"], company)).toEqual({
      used: true,
      missing: ["nome", "CNPJ/CPF"],
    });
    expect(missingCompanyFields(["<p>{{EMPRESA}}</p>"], { ...company, name: "Loja X" })).toEqual({
      used: true,
      missing: [],
    });
    expect(missingCompanyFields(["<p>nada</p>"], company)).toEqual({ used: false, missing: [] });
  });
});

describe("computeReadiness", () => {
  it("modelo recém-criado: botão sem link e marcadores da empresa pendentes", () => {
    const r = computeReadiness({ ...base, htmls: [`<a data-os-link="">Quero</a><footer>{{EMPRESA}}</footer>`] }, label);
    expect(r.items.map((i) => [i.id, i.done, i.optional])).toEqual([
      ["checkout", false, false],
      ["empresa", false, false],
      ["pixel", false, true],
      ["zip", false, false],
      ["no-ar", false, false],
    ]);
    expect(r.items[0].detail).toContain("1 botão de compra ainda sem link");
    expect(r.items[1].detail).toContain("nome");
    expect(r).toMatchObject({ done: 0, total: 4, complete: false });
  });

  it("clonada: link que ainda leva ao checkout da página original fica pendente", () => {
    const checkout = item(
      {
        htmls: [`<a data-os-link="checkout">Comprar</a>`],
        links: [{ key: "checkout", url: "https://pay.hotmart.com/ABC/" }],
        clonedCheckoutUrls: ["https://pay.hotmart.com/ABC"],
      },
      "checkout",
    );
    expect(checkout).toMatchObject({ done: false, title: "Trocar o checkout da página original" });
    const mine = item(
      {
        htmls: [`<a data-os-link="checkout">Comprar</a>`],
        links: [{ key: "checkout", url: "https://pay.kiwify.com.br/meu" }],
        clonedCheckoutUrls: ["https://pay.hotmart.com/ABC"],
      },
      "checkout",
    );
    expect(mine).toMatchObject({ done: true, title: "Checkout ligado" });
  });

  it("sem botões de compra (captura): o checkout vira opcional", () => {
    expect(item({ htmls: ["<form></form>"] }, "checkout")).toMatchObject({ done: false, optional: true });
  });

  it("tudo pronto: o cartão some (pixel é opcional)", () => {
    const r = computeReadiness(
      {
        ...base,
        htmls: [`<a data-os-link="checkout">Comprar</a><footer>{{EMPRESA}} {{CNPJ}} {{EMAIL}}</footer>`],
        links: [{ key: "checkout", url: "https://pay.kiwify.com.br/meu" }],
        company: { ...company, name: "Loja", document: "12.345.678/0001-90", email: "a@b.com" },
        liveUrl: "https://www.minhaoferta.com.br/",
        lastZipAt: new Date(),
      },
      label,
    );
    expect(r).toMatchObject({ done: 4, total: 4, complete: true });
    expect(r.items.find((i) => i.id === "no-ar")?.detail).toBe("No ar em minhaoferta.com.br.");
    expect(r.items.find((i) => i.id === "zip")?.detail).toContain("01/10/2026 às 10:00");
  });
});
