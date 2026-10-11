/**
 * Ligar botão ao checkout (editor):
 * - faixa "Este botão leva para: …" no Estilo, com "Mudar destino" (abre Configurações);
 * - em Configurações de links e botões, "Link da oferta" e "Página do funil" vêm
 *   primeiro e "Dica ao passar o mouse" por último.
 */
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { linkOptionLabel } from "@/editor/grapes/components";
import { linkTargetNoun, linkTargetText } from "@/editor/link-target";
import { appBundle, FakeServer, makePayload, openApp, type Session, waitFor, withEditor } from "./fix3-E1-harness";

const DATA = {
  links: [
    { key: "checkout", label: "Checkout principal" },
    { key: "pix", label: "Curso", payment: "Curso · MX$ 297,00" },
    { key: "proprio", label: "Checkout próprio", checkout: "Curso · R$ 97,00" },
    { key: "proprio-vazio", label: "Upsell", checkout: "" },
  ],
  pages: [{ id: "pagina00000000000000002", name: "Obrigado" }],
};

describe("linkTargetText", () => {
  it("diz para onde o link leva, em palavras simples", () => {
    expect(linkTargetText("a", { "data-os-link": "checkout", href: "#" }, DATA)).toBe("Checkout principal");
    expect(linkTargetText("a", { "data-os-link": "pix" }, DATA)).toBe("Curso (pagamento na página)");
    // Checkout do Offer Studio (com ou sem produto salvo): o selo, nunca o endereço de antes.
    expect(linkTargetText("a", { "data-os-link": "proprio" }, DATA)).toBe(
      "Checkout próprio (checkout do Offer Studio)",
    );
    expect(linkTargetText("a", { "data-os-link": "proprio-vazio" }, DATA)).toBe("Upsell (checkout do Offer Studio)");
    expect(DATA.links.map((l) => linkOptionLabel(l))).toEqual([
      "Checkout principal",
      "Curso · Pagamento na página",
      "Checkout próprio · Checkout do Offer Studio",
      "Upsell · Checkout do Offer Studio",
    ]);
    expect(linkTargetText("a", { "data-os-link": "sumiu" }, DATA)).toBe("um link da oferta que foi excluído");
    expect(linkTargetText("a", { "data-os-link": "", href: "#" }, DATA)).toBe("nenhum lugar ainda");
    expect(linkTargetText("a", {}, DATA)).toBe("nenhum lugar ainda");
    expect(linkTargetText("a", { href: "javascript:void(0)" }, DATA)).toBe("nenhum lugar ainda");
    expect(linkTargetText("a", { href: "os-page:pagina00000000000000002" }, DATA)).toBe("a página “Obrigado”");
    expect(linkTargetText("a", { href: "os-page:outra" }, DATA)).toBe("uma página que foi excluída");
    expect(linkTargetText("a", { href: "https://www.pay.hotmart.com/X123?off=1" }, DATA)).toBe("pay.hotmart.com");
    expect(linkTargetText("a", { href: "//checkout.exemplo.com/a" }, DATA)).toBe("checkout.exemplo.com");
    expect(linkTargetText("a", { href: "https://wa.me/5511999999999" }, DATA)).toBe("WhatsApp");
    expect(linkTargetText("a", { href: "#oferta" }, DATA)).toBe("uma parte desta página");
    expect(linkTargetText("a", { href: "mailto:contato@exemplo.com?subject=Oi" }, DATA)).toBe(
      "o e-mail contato@exemplo.com",
    );
    expect(linkTargetText("a", { href: "tel:+5511999999999" }, DATA)).toBe("uma ligação ou mensagem de celular");
    expect(linkTargetText("a", { href: "/obrigado.html" }, DATA)).toBe("/obrigado.html");
    expect(linkTargetText("a", { href: "#", "data-os-href": "https://x.com/y" }, DATA)).toBe("x.com");
    expect(linkTargetText("div", { "data-os-href": "https://x.com/y" }, DATA)).toBeNull();
  });

  it("“botão” para botões, “link” para o resto", () => {
    expect(linkTargetNoun("os-button", [])).toBe("botão");
    expect(linkTargetNoun("link", ["elementor-button", "elementor-size-md"])).toBe("botão");
    expect(linkTargetNoun("link", ["btn-primary"])).toBe("botão");
    expect(linkTargetNoun("link", ["os-btn"])).toBe("botão");
    expect(linkTargetNoun("link", ["menu-item"])).toBe("link");
    expect(linkTargetNoun("link", [])).toBe("link");
  });
});

let browser: Browser;
beforeAll(async () => {
  await appBundle();
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

const PAGE = `<!doctype html><html><head><title>T</title></head><body>
  <section>
    <a id="buy" class="elementor-button" href="#" data-os-link="checkout">Quero comprar</a>
    <a id="ext" href="https://www.pay.hotmart.com/X123">Comprar na Hotmart</a>
    <a id="thanks" href="os-page:pagina00000000000000002">Ir para o obrigado</a>
    <a id="none" class="btn" href="#">Sem destino</a>
    <p id="p">Texto comum</p>
  </section>
</body></html>`;

async function open(): Promise<Session> {
  const server = new FakeServer();
  const doc = "doclinkalvo000000000001";
  server.add(
    makePayload({
      documentId: doc,
      html: PAGE,
      links: [
        { id: "l1", key: "checkout", label: "Checkout principal", url: "https://pay.exemplo.com/a", kind: "CHECKOUT" },
      ],
    }),
  );
  return openApp(browser, server, doc);
}

async function selectById(page: Page, id: string) {
  await withEditor(page, `(ed, id) => { ed.select(ed.getWrapper().find("#" + id)[0]); }`, id);
  await page.waitForTimeout(150);
}

/** Texto da faixa no Estilo ("" sem faixa). */
function hintText(page: Page) {
  return page.evaluate(
    () => document.querySelector('[data-os-panel="estilo"] [data-os-link-target]')?.textContent?.trim() ?? "",
  );
}

describe("faixa “Este botão leva para” e ordem das Configurações", () => {
  it("mostra o destino do botão selecionado e acompanha a troca de destino", async () => {
    const s = await open();
    try {
      await selectById(s.page, "buy");
      expect(await hintText(s.page)).toContain("Este botão leva para: Checkout principal");
      await selectById(s.page, "ext");
      expect(await hintText(s.page)).toContain("Este link leva para: pay.hotmart.com");
      await selectById(s.page, "thanks");
      expect(await hintText(s.page)).toContain("Este link leva para: a página “Obrigado”");
      await selectById(s.page, "none");
      expect(await hintText(s.page)).toContain("Este botão leva para: nenhum lugar ainda");
      // Mudou o destino (como em Configurações): a faixa acompanha.
      await withEditor(
        s.page,
        `(ed) => { ed.getSelected().addAttributes({ href: "https://checkout.exemplo.com/b" }); }`,
      );
      await waitFor(async () => (await hintText(s.page)).includes("checkout.exemplo.com"), 2000, "faixa atualizada");
      // Texto comum: sem faixa.
      await selectById(s.page, "p");
      expect(await hintText(s.page)).toBe("");
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });

  it("“Mudar destino” abre Configurações com “Link da oferta” e “Página do funil” primeiro e a dica por último", async () => {
    const s = await open();
    try {
      await selectById(s.page, "ext");
      await s.page.getByRole("button", { name: "Mudar destino" }).click();
      await s.page.locator('[data-os-panel="config"]').waitFor({ state: "visible" });
      const names = await withEditor<string[]>(s.page, `(ed) => ed.getSelected().getTraits().map((t) => t.getName())`);
      expect(names.slice(0, 2)).toEqual(["data-os-link", "os-page"]);
      expect(names[names.length - 1]).toBe("title");
      expect(names).toContain("href");
      expect(names).toContain("target");
      // Na tela, na mesma ordem.
      const labels = await s.page.evaluate(() =>
        [...document.querySelectorAll('[data-os-panel="config"] .gjs-trt-trait')]
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .map((el) => el.querySelector(".gjs-label")?.textContent?.trim() ?? ""),
      );
      expect(labels[0]).toBe("Link da oferta");
      expect(labels[1]).toBe("Página do funil");
      expect(labels[labels.length - 1]).toBe("Dica ao passar o mouse");

      // Ligar ao link da oferta: o "Vai para" toma o lugar do endereço, e a ordem continua.
      await withEditor(s.page, `(ed) => { ed.getSelected().getTrait("data-os-link").setValue("checkout"); }`);
      await s.page.waitForTimeout(200);
      const bound = await withEditor<string[]>(s.page, `(ed) => ed.getSelected().getTraits().map((t) => t.getName())`);
      expect(bound.slice(0, 2)).toEqual(["data-os-link", "os-page"]);
      expect(bound).not.toContain("href");
      expect(bound[bound.length - 1]).toBe("title");
      // Desligar: o endereço volta no lugar dele.
      await withEditor(s.page, `(ed) => { ed.getSelected().getTrait("data-os-link").setValue(""); }`);
      await s.page.waitForTimeout(200);
      const unbound = await withEditor<string[]>(
        s.page,
        `(ed) => ed.getSelected().getTraits().map((t) => t.getName())`,
      );
      expect(unbound.slice(0, 3)).toEqual(["data-os-link", "os-page", "href"]);
      expect(unbound[unbound.length - 1]).toBe("title");
      // Selecionar de novo não repete campos.
      await selectById(s.page, "p");
      await selectById(s.page, "ext");
      const again = await withEditor<string[]>(s.page, `(ed) => ed.getSelected().getTraits().map((t) => t.getName())`);
      expect(new Set(again).size).toBe(again.length);
      expect(again).toEqual(unbound);
      expect(s.errors).toEqual([]);
    } finally {
      await s.page.close();
    }
  });
});
