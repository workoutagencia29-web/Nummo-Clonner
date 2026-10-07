/**
 * Roleta de desconto no editor de verdade (GrapesJS no Chromium): o bloco entra
 * com a roda desenhada a partir das fatias (e redesenhada ao mudar), o resultado
 * aparece no canvas com rótulo, o aviso de prêmio sem link fica só no canvas e
 * nada gira. O campo "Fatias" (lista própria) muda texto, cor, chance (mínimo
 * 1%, com o aviso de propaganda enganosa), prêmio (link da oferta, "Sem prêmio"
 * e "＋ Criar link da oferta…"), cupom, ordem, remove (mínimo 2) e adiciona
 * (máximo 12), com Desfazer. O destino do "Resgatar", a visibilidade
 * "Roleta de desconto: mostrar" nos outros elementos, clicar na roda seleciona
 * a roleta e o projeto/HTML salvo volta igual (a roda não vira elementos).
 */
import * as cheerio from "cheerio";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PAGE_TEMPLATES } from "@/editor/templates";
import { prepareForEditor } from "@/lib/editor-html";
import { parseSlices } from "@/lib/wheel";
import { addBlock, attrs, type EditorWindow, editorOutput, openEditor, pageErrors, setTrait } from "./blocks-harness";
import { fakeId } from "./helpers";

const WHEEL = '[data-os-widget="wheel"]';
const SALES = fakeId("vendas");
const LINKS = [
  { key: "checkout", label: "Checkout principal", kind: "CHECKOUT" },
  { key: "c30", label: "Checkout 30% OFF", kind: "CHECKOUT" },
];

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

const slices = async (page: Page) => parseSlices((await attrs(page, WHEEL))["data-os-slices"]);

/** Estado do canvas: textos da roda, selo de aviso, resultado visível, nada rodando. */
const canvas = (page: Page) =>
  page.evaluate(() => {
    const ed = (window as unknown as EditorWindow).ed;
    const doc = ed.Canvas.getDocument() as Document;
    const view = doc.defaultView as Window;
    const wheel = doc.querySelector('[data-os-widget="wheel"]') as HTMLElement;
    const result = doc.querySelector("[data-os-wh-result]") as HTMLElement;
    return {
      texts: Array.from(doc.querySelectorAll("[data-os-wh-disc] text")).map((t) => t.textContent),
      colors: Array.from(doc.querySelectorAll("[data-os-wh-disc] path[fill]")).map((p) => p.getAttribute("fill")),
      badge: wheel.getAttribute("data-os-wh-badge"),
      badgeShown: view.getComputedStyle(wheel, "::before").content,
      resultShown: view.getComputedStyle(result).display !== "none",
      resultLabel: view.getComputedStyle(result, "::before").content,
      prize: doc.querySelector("[data-os-wh-prize]")?.textContent,
      spinShown: view.getComputedStyle(doc.querySelector("[data-os-wh-spin]") as Element).display !== "none",
      running: !!doc.querySelector(".os-wh-on, .os-wh-done") || !!doc.getElementById("os-widgets-css"),
    };
  });

/** Campo "Fatias" desenhado (o mesmo do painel). */
async function sliceField<T>(page: Page, fn: string, arg?: unknown): Promise<T> {
  return page.evaluate(
    ([body, a]) => {
      const ed = (window as unknown as EditorWindow).ed;
      const comp = ed.getWrapper()?.find('[data-os-widget="wheel"]')[0];
      if (!comp) throw new Error("sem roleta");
      if (ed.getSelected() !== comp) ed.select(comp);
      const view = (comp.getTrait("data-os-slices") as unknown as { view?: { getInputElem(): HTMLElement } }).view;
      if (!view) throw new Error("campo Fatias não desenhado");
      const box = view.getInputElem();
      const set = (sel: string, value: string, i = 0) => {
        const el = box.querySelectorAll<HTMLInputElement | HTMLSelectElement>(sel)[i];
        el.value = value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      };
      const click = (sel: string, i = 0) => box.querySelectorAll<HTMLButtonElement>(sel)[i].click();
      return new Function("box", "set", "click", "arg", body)(box, set, click, a);
    },
    [fn, arg] as const,
  );
}

const undo = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as EditorWindow).ed.UndoManager.undo();
  });

/** HTML com os atributos em ordem alfabética (o GrapesJS pode trocar id/class de lugar). */
function sortedAttrs(html: string) {
  const $ = cheerio.load(html);
  $("*").each((_, el) => {
    if (!("attribs" in el)) return;
    el.attribs = Object.fromEntries(Object.entries(el.attribs).sort(([a], [b]) => a.localeCompare(b)));
  });
  return $.html();
}

describe("bloco Roleta de desconto", () => {
  let page: Page;
  beforeAll(async () => {
    page = await openEditor(browser, {
      pages: [
        { id: fakeId("roleta"), name: "Roleta" },
        { id: SALES, name: "Página de vendas", type: "SALES" },
      ],
      links: LINKS,
    });
    await addBlock(page, "roleta");
    await page.waitForTimeout(100);
  }, 60_000);
  afterAll(() => page?.close());

  it("entra com a roda desenhada pelas 4 fatias de exemplo, o resultado com rótulo e o aviso de prêmio sem link (só no canvas)", async () => {
    expect(pageErrors(page)).toEqual([]);
    expect(await slices(page)).toEqual([
      { text: "10% OFF", color: "#7c3aed", chance: 40, link: "", coupon: "" },
      { text: "20% OFF", color: "#f59e0b", chance: 30, link: "", coupon: "" },
      { text: "30% OFF", color: "#ec4899", chance: 20, link: "", coupon: "" },
      { text: "50% OFF", color: "#10b981", chance: 10, link: "", coupon: "" },
    ]);
    const c = await canvas(page);
    expect(c.texts).toEqual(["10% OFF", "20% OFF", "30% OFF", "50% OFF"]);
    expect(c.colors).toEqual(["#7c3aed", "#f59e0b", "#ec4899", "#10b981"]);
    expect(c.badge).toBe(
      "4 prêmios (“10% OFF”, “20% OFF”, “30% OFF”, “50% OFF”) ainda não têm o link de checkout com o desconto: escolha em Configurações → Fatias",
    );
    expect(c.badgeShown).toContain("ainda não têm o link");
    expect(c.resultShown).toBe(true);
    expect(c.resultLabel).toBe('"Resultado (aparece depois do giro)"');
    expect(c.prize).toBe("10% OFF");
    expect(c.spinShown).toBe(true);
    expect(c.running).toBe(false);

    // HTML salvo: a roda desenhada (SVG), sem o aviso do canvas, resultado escondido.
    const { html } = await editorOutput(page);
    const $ = cheerio.load(html);
    expect($("[data-os-wh-disc] svg path[fill]").length).toBe(4);
    expect($("[data-os-wh-disc] svg").attr("aria-label")).toBe(
      "Roleta com 4 fatias: 10% OFF, 20% OFF, 30% OFF, 50% OFF",
    );
    expect(html).not.toContain("data-os-wh-badge");
    expect($("[data-os-wh-result]").attr("hidden")).toBeDefined();
    expect($("[data-os-wh-prize]").text()).toBe("10% OFF");
    expect($("[data-os-wh-go]").attr("data-os-link")).toBe("");
    expect($("[data-os-wh-go]").attr("data-os-lose-label")).toBe("CONTINUAR PARA A OFERTA");
    expect($("[data-os-wh-spin] .os-wh-btxt").text()).toBe("GIRAR A ROLETA");
  });

  it("clicar na roda, no ponteiro ou no centro seleciona a roleta", async () => {
    const selected = await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      return [".os-wh-disc", ".os-wh-ptr", ".os-wh-hub", ".os-wh-stage"].map((sel) => {
        ed.select(ed.getWrapper()?.find(sel)[0]);
        return ed.getSelected()?.getAttributes()["data-os-widget"] ?? null;
      });
    });
    expect(selected).toEqual(["wheel", "wheel", "wheel", "wheel"]);
  });

  it("campo Fatias: texto, cor e cupom mudam a roda; chance 0 volta para 1% com aviso; Desfazer volta", async () => {
    expect(await sliceField<number>(page, "return box.querySelectorAll('.os-sl-item').length")).toBe(4);
    expect(
      await sliceField<string[]>(page, "return [...box.querySelectorAll('.os-sl-real')].map(e => e.textContent)"),
    ).toEqual(["sai em 40% dos giros", "sai em 30% dos giros", "sai em 20% dos giros", "sai em 10% dos giros"]);
    await sliceField(page, "set('.os-sl-text', 'R$ 50 de desconto', 1)");
    await sliceField(page, "set('.os-sl-color', '#0ea5e9', 1)");
    expect((await slices(page))[1]).toMatchObject({ text: "R$ 50 de desconto", color: "#0ea5e9" });
    expect((await canvas(page)).texts[1]).toBe("R$ 50 dedesconto");
    expect((await canvas(page)).colors[1]).toBe("#0ea5e9");

    await sliceField(page, "set('.os-sl-chance', '0', 3)");
    expect((await slices(page))[3].chance).toBe(1);
    expect(await sliceField<string>(page, "return box.querySelector('.os-sl-alert')?.textContent")).toBe(
      "Toda fatia precisa ter chance de sair (mínimo 1%). Uma fatia que aparece na roleta mas nunca sai pode ser considerada propaganda enganosa — a chance voltou para 1%.",
    );
    expect(await sliceField<string>(page, "return box.querySelector('.os-sl-sum').textContent")).toBe(
      "As chances somam 91%: cada fatia sai na proporção do número dela (a chance real aparece ao lado).",
    );
    // De novo 0 (já estava em 1): o aviso aparece outra vez, sem mudar nada.
    await sliceField(page, "set('.os-sl-chance', '-3', 3)");
    expect(await sliceField<string | null>(page, "return box.querySelector('.os-sl-alert') && 'sim'")).toBe("sim");

    await undo(page);
    expect((await slices(page))[3].chance).toBe(10);
    expect(await sliceField<string>(page, "return box.querySelectorAll('.os-sl-chance')[3].value")).toBe("10");
    // (o GrapesJS pode juntar as duas mudanças seguidas da mesma fatia num passo só)
    for (let i = 0; i < 2 && (await slices(page))[1]?.text !== "20% OFF"; i++) await undo(page);
    expect((await slices(page))[1]).toMatchObject({ text: "20% OFF", color: "#f59e0b" });
    expect((await canvas(page)).texts[1]).toBe("20% OFF");
  });

  it("prêmio: link da oferta, “Sem prêmio” e “＋ Criar link da oferta…” (liga a fatia ao link novo); o aviso do canvas acompanha", async () => {
    const options = await sliceField<string[]>(
      page,
      "return [...box.querySelector('.os-sl-prize').options].map(o => o.textContent)",
    );
    expect(options).toEqual([
      "— escolha o link do desconto —",
      "🎁 Checkout principal",
      "🎁 Checkout 30% OFF",
      "Sem prêmio (“Não foi dessa vez”)",
      "＋ Criar link da oferta…",
    ]);
    await sliceField(page, "set('.os-sl-prize', 'c30', 2)");
    await sliceField(page, "set('.os-sl-coupon', 'ROLETA30', 2)");
    expect((await slices(page))[2]).toMatchObject({ link: "c30", coupon: "ROLETA30" });
    expect((await canvas(page)).badge).toMatch(/^3 prêmios \(“10% OFF”, “20% OFF”, “50% OFF”\)/);

    await sliceField(page, "set('.os-sl-prize', '__sem-premio__', 0)");
    expect((await slices(page))[0]).toMatchObject({ lose: true, link: "", coupon: "" });
    // Sem prêmio: sem campo de cupom nem aviso de link.
    expect(
      await sliceField<number>(
        page,
        "return box.querySelectorAll('.os-sl-item')[0].querySelectorAll('.os-sl-coupon, .os-sl-warn').length",
      ),
    ).toBe(0);
    expect((await canvas(page)).prize).toBe("20% OFF");

    // "＋ Criar link da oferta…": o diálogo (aqui simulado) cria e liga a fatia.
    const requested = await page.evaluate(() => {
      const w = window as unknown as EditorWindow & { __req?: unknown[] };
      w.__req = [];
      w.OS.installNewLinkOption(w.ed, (req) => {
        (w.__req as unknown[]).push({ kind: req.kind, name: req.name });
        req.bind?.("checkout-20");
      });
      return true;
    });
    expect(requested).toBe(true);
    await sliceField(page, "set('.os-sl-prize', '__novo-link__', 1)");
    expect(await page.evaluate(() => (window as unknown as { __req: unknown[] }).__req)).toEqual([
      { kind: "CHECKOUT", name: "Checkout 20% OFF" },
    ]);
    expect((await slices(page))[1]).toMatchObject({ link: "checkout-20" });
    // O link novo ainda não está na lista do editor: aparece como "(removido)" até recarregar a lista.
    expect(await sliceField<string>(page, "return box.querySelectorAll('.os-sl-prize')[1].value")).toBe("checkout-20");
  });

  it("ordem, remover (mínimo 2) e adicionar (máximo 12)", async () => {
    const before = await slices(page);
    await sliceField(page, "click('.os-sl-icon[aria-label=\"Descer a fatia 1\"]')");
    expect((await slices(page)).map((s) => s.text)).toEqual([
      before[1].text,
      before[0].text,
      before[2].text,
      before[3].text,
    ]);
    expect(
      await sliceField<boolean>(page, "return box.querySelector('[aria-label=\"Subir a fatia 1\"]').disabled"),
    ).toBe(true);
    for (let i = 0; i < 2; i++) await sliceField(page, "click('[aria-label=\"Remover a fatia 1\"]')");
    expect(await slices(page)).toHaveLength(2);
    expect(
      await sliceField<boolean>(page, "return box.querySelector('[aria-label=\"Remover a fatia 1\"]').disabled"),
    ).toBe(true);
    for (let i = 0; i < 10; i++) await sliceField(page, "click('.os-sl-add')");
    expect(await slices(page)).toHaveLength(12);
    expect(
      await sliceField<string[]>(page, "const b = box.querySelector('.os-sl-add'); return [b.disabled, b.textContent]"),
    ).toEqual([true, "Máximo de 12 fatias"]);
    expect((await canvas(page)).texts).toHaveLength(12);
    expect(pageErrors(page)).toEqual([]);
  });

  it("destino do “Resgatar”: página do funil, link da oferta ou endereço (o último vale)", async () => {
    await setTrait(page, WHEEL, "os-wh-page", SALES);
    expect(await attrs(page, "[data-os-wh-go]")).toMatchObject({ href: `os-page:${SALES}` });
    expect((await attrs(page, "[data-os-wh-go]"))["data-os-link"]).toBeUndefined();
    await setTrait(page, WHEEL, "os-wh-link", "checkout");
    expect(await attrs(page, "[data-os-wh-go]")).toMatchObject({ href: "#", "data-os-link": "checkout" });
    await setTrait(page, WHEEL, "os-wh-url", "meusite.com/vendas");
    expect(await attrs(page, "[data-os-wh-go]")).toMatchObject({ href: "https://meusite.com/vendas" });
    await setTrait(page, WHEEL, "os-wh-page", SALES);
    await setTrait(page, WHEEL, "os-wh-lose-label", "VER A OFERTA");
    expect(await attrs(page, "[data-os-wh-go]")).toMatchObject({ "data-os-lose-label": "VER A OFERTA" });
    const bound = await page.evaluate(() => {
      const w = window as unknown as EditorWindow;
      const go = w.ed.getWrapper()?.find("[data-os-wh-go]")[0];
      return go ? w.OS.bindWheelLink(go, "c30") : null;
    });
    expect(bound).toBe(true);
    expect(await attrs(page, "[data-os-wh-go]")).toMatchObject({ href: "#", "data-os-link": "c30" });
  });

  it("“Roleta de desconto: mostrar” nos outros elementos (não dentro da roleta)", async () => {
    await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      ed.getWrapper()?.append('<p id="preco">Preço com desconto</p>');
    });
    const traitOf = (sel: string) =>
      page.evaluate((s) => {
        const ed = (window as unknown as EditorWindow).ed;
        const c = ed.getWrapper()?.find(s)[0];
        if (c) ed.select(c);
        const t = c?.getTrait("data-os-premio");
        return t ? (t.get("options") as { id: string; label: string }[]).map((o) => o.label) : null;
      }, sel);
    expect(await traitOf("#preco")).toEqual(["Sempre", "Só para quem ganhou prêmio", "Só para quem não ganhou prêmio"]);
    expect(await traitOf(".os-wh-title")).toBeNull();
    await setTrait(page, "#preco", "data-os-premio", "ganhou");
    expect((await attrs(page, "#preco"))["data-os-premio"]).toBe("ganhou");
    const label = await page.evaluate(() => {
      const doc = (window as unknown as EditorWindow).ed.Canvas.getDocument() as Document;
      return (doc.defaultView as Window).getComputedStyle(doc.querySelector("#preco") as Element, "::before").content;
    });
    expect(label).toBe('"Roleta: só para quem ganhou prêmio"');
    await setTrait(page, "#preco", "data-os-premio", "");
    expect((await attrs(page, "#preco"))["data-os-premio"]).toBeUndefined();
  });

  it("projeto salvo e o HTML reaberto voltam iguais (a roda é refeita, sem elementos repetidos)", async () => {
    const first = await editorOutput(page);
    const project = await page.evaluate(() => (window as unknown as EditorWindow).ed.getProjectData());
    const again = await openEditor(browser, { project, links: LINKS });
    expect(sortedAttrs((await editorOutput(again)).html)).toBe(sortedAttrs(first.html));
    // HTML salvo aberto de novo (primeira abertura de uma página): a roda não vira elementos.
    const reopened = await page.evaluate((h) => {
      const ed = (window as unknown as EditorWindow).ed;
      ed.setComponents(h, { asDocument: true } as never);
      const disc = ed.getWrapper()?.find("[data-os-wh-disc]")[0];
      return { children: disc?.components().length, html: ed.getHtml() };
    }, prepareForEditor(first.html).html);
    expect(reopened.children).toBe(0);
    expect(cheerio.load(reopened.html)("[data-os-wh-disc] svg").length).toBe(1);
    await again.close();
  });
});

describe("modelo “Roleta” aberto no editor", () => {
  it("a roda do HTML do modelo é refeita (uma só) e as fatias de exemplo continuam", async () => {
    const page = await openEditor(browser, {});
    const template = PAGE_TEMPLATES.find((t) => t.id === "roleta");
    const html = prepareForEditor((template?.html ?? "").replaceAll("__OS_ANO__", "2026")).html;
    await page.evaluate((h) => {
      (window as unknown as EditorWindow).ed.setComponents(h, { asDocument: true } as never);
    }, html);
    await page.waitForTimeout(100);
    const c = await canvas(page);
    expect(c.texts).toEqual(["10% OFF", "20% OFF", "30% OFF", "50% OFF"]);
    expect((await slices(page)).map((s) => s.chance)).toEqual([40, 30, 20, 10]);
    expect(c.badge).toMatch(/^4 prêmios/);
    const { html: out } = await editorOutput(page);
    expect(cheerio.load(out)("[data-os-wh-disc] svg").length).toBe(1);
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });
});

describe("campo Fatias com cliques e teclas de verdade (o foco nunca cai fora do painel)", () => {
  /** Editor novo com a roleta selecionada e o campo Fatias desenhado no painel. */
  async function fresh() {
    const page = await openEditor(browser, { links: LINKS });
    await addBlock(page, "roleta");
    await page.evaluate(() => {
      const ed = (window as unknown as EditorWindow).ed;
      const comp = ed.getWrapper()?.find('[data-os-widget="wheel"]')[0];
      if (!comp) throw new Error("sem roleta");
      ed.select(comp);
    });
    await page.waitForSelector('#traits [aria-label="Texto da fatia 1"]');
    return page;
  }
  const field = (label: string) => `#traits [aria-label="${label}"]`;
  /** Onde está o foco: aria-label do campo do painel ou a tag (BODY = fora do painel). */
  const focus = (page: Page) =>
    page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      if (!a) return null;
      return a.closest("#traits") ? a.getAttribute("aria-label") || a.className : a.tagName;
    });
  const wheels = (page: Page) =>
    page.evaluate(
      () => (window as unknown as EditorWindow).ed.getWrapper()?.find('[data-os-widget="wheel"]').length ?? 0,
    );

  it("mudar o texto e clicar na chance de outra fatia: o clique vale, o número digitado grava e o campo é o mesmo", async () => {
    const page = await fresh();
    const chance2 = await page.$(field("Chance da fatia 2 (%)"));
    await page.click(field("Texto da fatia 1"));
    await page.keyboard.press("End");
    await page.keyboard.type("!");
    await page.click(field("Chance da fatia 2 (%)"));
    expect(await focus(page)).toBe("Chance da fatia 2 (%)");
    // Mudança só de valor: a lista é atualizada no lugar (o mesmo campo continua na página).
    expect(await chance2?.evaluate((e) => e.isConnected)).toBe(true);
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("55");
    await page.keyboard.press("Tab");
    expect((await slices(page)).map((s) => [s.text, s.chance])).toEqual([
      ["10% OFF!", 40],
      ["20% OFF", 55],
      ["30% OFF", 20],
      ["50% OFF", 10],
    ]);
    // O Tab continua no painel (e a chance real ao lado acompanha).
    expect(await focus(page)).toBe("Prêmio da fatia 2");
    expect(await page.textContent("#traits [data-os-slice='1'] .os-sl-real")).toBe("sai em 44% dos giros");
    await page.close();
  }, 60_000);

  it("mudar o texto da última fatia e clicar em “＋ Adicionar fatia”: um clique adiciona", async () => {
    const page = await fresh();
    await page.click(field("Texto da fatia 4"));
    await page.keyboard.press("End");
    await page.keyboard.type("!");
    await page.click("#traits .os-sl-add");
    expect((await slices(page)).map((s) => s.text)).toEqual([
      "10% OFF",
      "20% OFF",
      "30% OFF",
      "50% OFF!",
      "Novo prêmio",
    ]);
    // A lista foi refeita (fatia nova): o foco volta ao botão.
    expect(await focus(page)).toBe("os-sl-add");
    await page.close();
  }, 60_000);

  it("Enter no texto e Backspace/Delete depois de trocar chance ou prêmio não apagam a roleta", async () => {
    const page = await fresh();
    await page.click(field("Texto da fatia 1"));
    await page.keyboard.press("End");
    await page.keyboard.type("!");
    await page.keyboard.press("Enter");
    expect((await slices(page))[0].text).toBe("10% OFF!");
    expect(await focus(page)).toBe("Texto da fatia 1");
    await page.keyboard.press("Backspace");
    expect(await wheels(page)).toBe(1);
    expect(await page.inputValue(field("Texto da fatia 1"))).toBe("10% OFF");

    // Prêmio: muda a forma da lista (o aviso de link some), o foco volta ao mesmo campo.
    await page.selectOption(field("Prêmio da fatia 1"), "c30");
    expect((await slices(page))[0].link).toBe("c30");
    // A lista foi refeita; o foco continua no campo em que estava (o painel não perde o foco).
    expect(await focus(page)).toBe("Texto da fatia 1");
    await page.keyboard.press("Delete");
    expect(await wheels(page)).toBe(1);

    // Chance com Enter, depois Backspace.
    await page.click(field("Chance da fatia 3 (%)"));
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("25");
    await page.keyboard.press("Enter");
    expect((await slices(page))[2].chance).toBe(25);
    expect(await focus(page)).toBe("Chance da fatia 3 (%)");
    await page.keyboard.press("Backspace");
    expect(await wheels(page)).toBe(1);

    // Remover a última fatia: o foco vai para o "＋ Adicionar fatia" (não para a página).
    await page.click(field("Remover a fatia 4"));
    expect(await slices(page)).toHaveLength(3);
    expect(await focus(page)).toBe("os-sl-add");
    await page.keyboard.press("Delete");
    expect(await wheels(page)).toBe(1);
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  }, 60_000);

  it("“Sem prêmio” troca o texto do desconto por “Não foi dessa vez”; texto de prêmio numa fatia sem prêmio é avisado", async () => {
    const page = await fresh();
    await page.selectOption(field("Prêmio da fatia 2"), "__sem-premio__");
    expect((await slices(page))[1]).toMatchObject({ text: "Não foi dessa vez", lose: true, link: "" });
    expect(await page.inputValue(field("Texto da fatia 2"))).toBe("Não foi dessa vez");
    expect(await page.locator("#traits [data-os-slice='1'] .os-sl-warn").count()).toBe(0);
    expect((await canvas(page)).texts[1]).toBe("Não foidessa vez"); // (duas linhas na roda)

    await page.fill(field("Texto da fatia 2"), "20% OFF");
    await page.keyboard.press("Enter");
    expect(await page.textContent("#traits [data-os-slice='1'] .os-sl-warn")).toBe(
      "Quem cair aqui não ganha nada: use um texto como “Não foi dessa vez”, para não parecer que ganhou um desconto.",
    );
    expect(await focus(page)).toBe("Texto da fatia 2");
    await page.close();
  }, 60_000);
});
