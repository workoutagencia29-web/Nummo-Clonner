/**
 * "＋ Criar link da oferta…" no editor de verdade (editor-app.tsx num
 * Chromium, tests/unit/fix3-E1-harness.ts) com o destino "Checkout do Offer
 * Studio": o link nasce com esse destino (sem endereço), o botão fica ligado a
 * ele e o aviso leva a montar o checkout na aba "Links e checkouts" (salvando
 * antes). O "Botão de checkout" solto numa oferta sem checkout do Offer Studio
 * abre o diálogo já com esse destino, também depois de salvar e reabrir a
 * página (o botão guarda a preferência), e o "Criar link da oferta" dos
 * "Botões de compra sem link" (diálogo "Links e checkouts" do editor) também.
 * Capturas do diálogo (com o CSS do painel) em OS_PRINTS_DIR, quando definido.
 */
import path from "node:path";
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { finalizeFromEditor, prepareForEditor } from "@/lib/editor-html";
import {
  actionCalls,
  appBundle,
  clickToastAction,
  FakeServer,
  makePayload,
  OFFER_ID,
  openApp,
  type Session,
  saveStatusText,
  setActionResult,
  toasts,
  waitFor,
  withEditor,
} from "./fix3-E1-harness";
import { panelCss } from "./tracking-ui-harness";

const PRINTS = process.env.OS_PRINTS_DIR;

/** Captura do diálogo com o CSS de verdade do painel (só com OS_PRINTS_DIR). */
async function shot(s: Session, name: string) {
  if (!PRINTS) return;
  await s.page.addStyleTag({ content: await panelCss() });
  await s.page.getByRole("dialog").screenshot({ path: path.join(PRINTS, name) });
}

let browser: Browser;
beforeAll(async () => {
  await appBundle();
  browser = await chromium.launch();
}, 180_000);

const sessions: Session[] = [];
afterAll(async () => {
  for (const s of sessions) await s.page.close().catch(() => undefined);
  await browser?.close();
});

const BUY_HTML = `<!doctype html><html><head><title>T</title></head><body><h1 id="t">Oferta</h1><a id="buy1" href="#" data-os-link="">QUERO AGORA</a></body></html>`;
const CREATE_LINK = `(input) => ({ ok: true, data: { id: "link1", key: "checkout-principal", label: input.label, url: input.url, kind: input.kind, target: input.target || "URL" } })`;

async function fresh(id: string, html = BUY_HTML) {
  const server = new FakeServer();
  server.add(makePayload({ documentId: id, html }));
  const s = await openApp(browser, server, id);
  sessions.push(s);
  await waitFor(() => server.okPuts.length === 1, 8000, "primeiro salvamento");
  await waitFor(async () => (await saveStatusText(s.page)).startsWith("Salvo"), 4000, "Salvo");
  await setActionResult(s, "createOfferLinkAction", CREATE_LINK);
  return s;
}

/** Escolhe "＋ Criar link da oferta…" na lista "Link da oferta" do elemento. */
function askNewLink(s: Session, selector: string) {
  return withEditor(
    s.page,
    `(ed, sel) => { const c = ed.getWrapper().find(sel)[0]; ed.select(c); c.addAttributes({ "data-os-link": "__novo-link__" }); return true; }`,
    selector,
  );
}

describe("＋ Criar link da oferta… com destino “Checkout do Offer Studio”", () => {
  it("cria o link sem endereço, liga o botão e o aviso leva a montar o checkout (salvando antes)", async () => {
    const s = await fresh("docnovolink0000000000001");
    await askNewLink(s, "#buy1");
    const dialog = s.page.getByRole("dialog", { name: "Novo link da oferta" });
    await dialog.waitFor();
    // Padrão: endereço (o campo aparece).
    expect(await dialog.getByLabel("Endereço", { exact: true }).count()).toBe(1);
    await dialog.getByRole("combobox", { name: "Destino" }).click();
    await s.page.getByRole("option", { name: "Checkout do Offer Studio" }).click();
    // Checkout do Offer Studio: sem campo de endereço, com a explicação.
    expect(await dialog.getByLabel("Endereço", { exact: true }).count()).toBe(0);
    expect(await dialog.textContent()).toContain("monte o checkout em “Links e checkouts”");
    await shot(s, "editor-novo-link-checkout.png");
    await dialog.getByRole("button", { name: "Criar e ligar" }).click();
    await dialog.waitFor({ state: "hidden" });

    const calls = await actionCalls(s, "createOfferLinkAction");
    expect(calls[0]?.input).toMatchObject({
      offerId: OFFER_ID,
      label: "Checkout principal",
      url: "",
      kind: "CHECKOUT",
      target: "CHECKOUT",
    });
    const toast = (await toasts(s)).find((t) => t.message.startsWith("Link criado e ligado ao elemento"));
    expect(toast).toMatchObject({
      type: "success",
      message: "Link criado e ligado ao elemento. Agora monte o checkout dele em “Links e checkouts”.",
      action: "Montar o checkout",
    });
    // As Configurações do botão mostram o destino novo (não "sem endereço").
    const dest = await withEditor<string>(
      s.page,
      `(ed) => { const c = ed.getWrapper().find("#buy1")[0]; const t = c.getTrait("os-destino"); return t ? t.get("text") : ""; }`,
    );
    expect(dest).toBe("Checkout do Offer Studio (produto ainda não salvo)");

    await clickToastAction(
      s,
      (await toasts(s)).findIndex((t) => t.action === "Montar o checkout"),
    );
    await waitFor(() => s.server.navs.length === 1, 6000, "navegação");
    expect(s.server.navs).toEqual([`/ofertas/${OFFER_ID}?aba=links&link=link1`]);
    expect(s.server.okPuts.at(-1)?.html).toMatch(
      /id="buy1"[^>]*data-os-link="checkout-principal"|data-os-link="checkout-principal"[^>]*id="buy1"/,
    );
    expect(s.errors).toEqual([]);
  }, 60_000);

  it("“Botão de checkout” solto sem checkout do Offer Studio na oferta: o diálogo já vem com esse destino", async () => {
    const s = await fresh("docnovolink0000000000002");
    await withEditor(
      s.page,
      `(ed) => { const [box] = ed.getWrapper().append(ed.Blocks.get("cta-checkout-proprio").get("content")); box.find("a")[0].addAttributes({ id: "own" }); return true; }`,
    );
    expect(
      await withEditor<string>(s.page, `(ed) => ed.getWrapper().find("#own")[0].getAttributes()["data-os-link"]`),
    ).toBe("");
    await askNewLink(s, "#own");
    const dialog = s.page.getByRole("dialog", { name: "Novo link da oferta" });
    await dialog.waitFor();
    expect(await dialog.getByRole("combobox", { name: "Destino" }).textContent()).toBe("Checkout do Offer Studio");
    expect(await dialog.getByLabel("Endereço", { exact: true }).count()).toBe(0);
    await shot(s, "editor-botao-de-checkout-novo-link.png");
    // Tipo que não é de compra: sem a escolha de destino (só endereço).
    await dialog.getByRole("combobox", { name: "Tipo" }).click();
    await s.page.getByRole("option", { name: "WhatsApp" }).click();
    // (com o CSS de verdade, a lista ainda fecha animada: espera a tela assentar)
    await expect.poll(() => dialog.getByLabel("Endereço", { exact: true }).count()).toBe(1);
    expect(await dialog.getByRole("combobox", { name: "Destino" }).count()).toBe(0);
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    expect(s.errors).toEqual([]);
  }, 60_000);

  it("reaberta a página salva, o “Botão de checkout” ainda abre o diálogo com esse destino (o botão guarda a preferência)", async () => {
    const s = await fresh("docnovolink0000000000003");
    await withEditor(
      s.page,
      `(ed) => { const [box] = ed.getWrapper().append(ed.Blocks.get("cta-checkout-proprio").get("content")); box.find("a")[0].addAttributes({ id: "own" }); return true; }`,
    );
    await waitFor(
      () => /data-os-new-link="checkout"/.test(s.server.okPuts.at(-1)?.html ?? ""),
      8000,
      "salvamento com o botão",
    );
    const put = s.server.okPuts.at(-1);
    // Como o servidor guarda (finalizeFromEditor) e devolve ao abrir de novo (prepareForEditor).
    const stored = finalizeFromEditor(put?.html ?? "", put?.css ?? "");
    expect(stored).toMatch(/<a[^>]*data-os-new-link="checkout"[^>]*>COMPRAR AGORA<\/a>/);
    const again = await fresh("docnovolink0000000000004", prepareForEditor(stored).html);
    expect(
      await withEditor<string>(again.page, `(ed) => ed.getWrapper().find("#own")[0].getAttributes()["data-os-link"]`),
    ).toBe("");
    await askNewLink(again, "#own");
    const dialog = again.page.getByRole("dialog", { name: "Novo link da oferta" });
    await dialog.waitFor();
    expect(await dialog.getByRole("combobox", { name: "Destino" }).textContent()).toBe("Checkout do Offer Studio");
    expect(await dialog.getByLabel("Endereço", { exact: true }).count()).toBe(0);
    // Criado e ligado: a preferência sai do botão (o link já existe).
    await dialog.getByRole("button", { name: "Criar e ligar" }).click();
    await dialog.waitFor({ state: "hidden" });
    expect((await actionCalls(again, "createOfferLinkAction"))[0]?.input).toMatchObject({ target: "CHECKOUT" });
    const attrs = await withEditor<Record<string, string>>(
      again.page,
      `(ed) => ed.getWrapper().find("#own")[0].getAttributes()`,
    );
    expect(attrs["data-os-link"]).toBe("checkout-principal");
    expect(attrs["data-os-new-link"]).toBeUndefined();
    expect(s.errors).toEqual([]);
    expect(again.errors).toEqual([]);
  }, 60_000);
});

describe("“Links e checkouts” do editor: “Criar link da oferta” dos botões de compra sem link", () => {
  /** Abre o diálogo e o formulário de link novo do grupo "Botões de compra sem link". */
  async function openCreate(s: Session) {
    await s.page.getByRole("button", { name: "Links e checkouts" }).click();
    const dialog = s.page.getByRole("dialog", { name: "Links e checkouts" });
    const group = dialog.getByRole("listitem").filter({ hasText: "Botões de compra sem link" });
    await group.waitFor();
    await group.getByRole("button", { name: "Criar link da oferta" }).click();
    return { dialog, group };
  }

  it("com um “Botão de checkout” no grupo, já vem com “Checkout do Offer Studio”, liga todos e a marca sai", async () => {
    const s = await fresh("docnovolink0000000000005");
    await withEditor(
      s.page,
      `(ed) => { const [box] = ed.getWrapper().append(ed.Blocks.get("cta-checkout-proprio").get("content")); box.find("a")[0].addAttributes({ id: "own" }); return true; }`,
    );
    const { dialog, group } = await openCreate(s);
    expect(await group.textContent()).toContain("2 elementos");
    expect(await group.getByRole("combobox", { name: "Destino" }).textContent()).toBe("Checkout do Offer Studio");
    expect(await group.getByRole("textbox", { name: "Endereço do link" }).count()).toBe(0);
    expect(await group.textContent()).toContain("monte o checkout dele em “Links e checkouts” da oferta");
    await shot(s, "editor-links-botoes-sem-link-checkout.png");
    await group.getByRole("button", { name: "Criar e ligar" }).click();
    await waitFor(
      () =>
        (s.server.okPuts.at(-1)?.html.match(/data-os-link="checkout-principal"/g) ?? []).length === 2 &&
        !/data-os-new-link/.test(s.server.okPuts.at(-1)?.html ?? ""),
      8000,
      "ligação gravada",
    );

    expect((await actionCalls(s, "createOfferLinkAction"))[0]?.input).toMatchObject({
      offerId: OFFER_ID,
      label: "Checkout principal",
      url: "",
      kind: "CHECKOUT",
      target: "CHECKOUT",
    });
    // Os dois botões do grupo ficam ligados ao link novo; a preferência sai do “Botão de checkout”.
    const attrs = await withEditor<Record<string, string>[]>(
      s.page,
      `(ed) => ["#buy1", "#own"].map((sel) => ed.getWrapper().find(sel)[0].getAttributes())`,
    );
    expect(attrs.map((a) => a["data-os-link"])).toEqual(["checkout-principal", "checkout-principal"]);
    expect(attrs[1]["data-os-new-link"]).toBeUndefined();
    // O grupo vira o do link novo, ainda sem o checkout montado.
    const linked = dialog.getByRole("listitem").filter({ hasText: "Checkout principal" });
    await linked.waitFor();
    expect(await linked.textContent()).toContain("Checkout do Offer Studio");
    expect(await dialog.getByText("Botões de compra sem link").count()).toBe(0);

    const toast = (await toasts(s)).find((t) => t.message.startsWith("2 elementos ligados"));
    expect(toast).toMatchObject({
      type: "success",
      message: "2 elementos ligados a “Checkout principal”. Agora monte o checkout dele em “Links e checkouts”.",
      action: "Montar o checkout",
    });
    await clickToastAction(
      s,
      (await toasts(s)).findIndex((t) => t.action === "Montar o checkout"),
    );
    await waitFor(() => s.server.navs.length === 1, 6000, "navegação");
    expect(s.server.navs).toEqual([`/ofertas/${OFFER_ID}?aba=links&link=link1`]);
    expect(s.errors).toEqual([]);
  }, 60_000);

  it("sem a marca, começa em “Endereço (link)”; dá para escolher o checkout, e tipos que não são de compra só têm endereço", async () => {
    const s = await fresh("docnovolink0000000000006");
    const { group } = await openCreate(s);
    const target = group.getByRole("combobox", { name: "Destino" });
    expect(await target.textContent()).toBe("Endereço (link)");
    expect(await group.getByRole("textbox", { name: "Endereço do link" }).count()).toBe(1);
    await target.click();
    await s.page.getByRole("option", { name: "Checkout do Offer Studio" }).click();
    await expect.poll(() => group.getByRole("textbox", { name: "Endereço do link" }).count()).toBe(0);
    // WhatsApp: sem a escolha de destino (só endereço).
    await group.getByRole("combobox", { name: "Tipo do link" }).click();
    await s.page.getByRole("option", { name: "WhatsApp" }).click();
    await expect.poll(() => group.getByRole("textbox", { name: "Endereço do link" }).count()).toBe(1);
    expect(await group.getByRole("combobox", { name: "Destino" }).count()).toBe(0);
    await group.getByRole("textbox", { name: "Endereço do link" }).fill("wa.me/5511999999999");
    await group.getByRole("button", { name: "Criar e ligar" }).click();
    await waitFor(async () => (await actionCalls(s, "createOfferLinkAction")).length === 1, 6000, "link criado");
    const input = (await actionCalls(s, "createOfferLinkAction"))[0]?.input as Record<string, unknown>;
    expect(input).toMatchObject({ url: "https://wa.me/5511999999999", kind: "WHATSAPP" });
    expect(input.target).toBeUndefined();
    expect(s.errors).toEqual([]);
  }, 60_000);
});
