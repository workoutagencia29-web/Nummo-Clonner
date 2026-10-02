/**
 * Correções do localizar/substituir e dos links (Fase 3, grupo E1):
 * - trocas no HTML guardado mantêm o doctype original (páginas antigas em
 *   modo quirks / quase-padrão não mudam de modo);
 * - "Links e checkouts" mostra os botões de compra ainda sem link (modelos e
 *   blocos de checkout: data-os-link="" e href="#") e liga todos de uma vez.
 */
import path from "node:path";
import { build } from "esbuild";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PAGE_TEMPLATES } from "@/editor/templates";
import {
  applyLinkOp,
  applyLinkOpToHtml,
  applyLinkOpToProject,
  createMatcher,
  isUnlinkedButton,
  linkMatches,
  replaceInHtml,
} from "@/lib/find-replace";

const LEGACY = '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">';
const QUIRKS = '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN">';

function page(doctype: string) {
  return `${doctype}\n<html><head><title>Oferta</title></head><body><table><tr><td><a href="https://pay.hotmart.com/X">Compre agora</a></td></tr></table></body></html>`;
}

describe("doctype nas trocas em todas as páginas", () => {
  it("replaceInHtml mantém doctypes antigos (e não inventa um quando não havia)", async () => {
    const matcher = createMatcher("Compre");
    if (!matcher) throw new Error("matcher");
    for (const doctype of [LEGACY, QUIRKS, "<!doctype html>"]) {
      const r = await replaceInHtml(page(doctype), matcher, "Garanta");
      expect(r.count).toBe(1);
      expect(r.html.startsWith(doctype)).toBe(true);
      expect(r.html).toContain("Garanta agora");
    }
    const none = await replaceInHtml(page("").trim(), matcher, "Garanta");
    expect(none.html.toLowerCase()).not.toContain("<!doctype");
    expect(none.html).toContain("Garanta agora");
  });

  it("applyLinkOpToHtml (ligar, trocar endereço, desligar) mantém o doctype", async () => {
    const html = page(LEGACY);
    const set = await applyLinkOpToHtml(
      html,
      { kind: "url", url: "https://pay.hotmart.com/X" },
      { type: "set-url", url: "https://pay.kiwify.com.br/Y" },
    );
    expect(set.count).toBe(1);
    expect(set.html.startsWith(LEGACY)).toBe(true);
    const bind = await applyLinkOpToHtml(
      html,
      { kind: "url", url: "https://pay.hotmart.com/X" },
      { type: "bind", key: "checkout" },
    );
    expect(bind.html.startsWith(LEGACY)).toBe(true);
    expect(bind.html).toContain('data-os-link="checkout"');
    // Sem mudança: o HTML volta intacto.
    const same = await applyLinkOpToHtml(html, { kind: "url", url: "https://outro.com" }, { type: "bind", key: "x" });
    expect(same).toEqual({ html, count: 0 });
  });
});

describe("botões de compra sem link (regras)", () => {
  it("isUnlinkedButton: atributo presente e vazio, sem destino, e nunca formulários", () => {
    expect(isUnlinkedButton("a", { href: "#", "data-os-link": "" })).toBe(true);
    expect(isUnlinkedButton("a", { "data-os-link": "" })).toBe(true);
    expect(isUnlinkedButton("button", { "data-os-link": " " })).toBe(true);
    expect(isUnlinkedButton("a", { href: "#" })).toBe(false);
    expect(isUnlinkedButton("a", { href: "https://x.com", "data-os-link": "" })).toBe(false);
    expect(isUnlinkedButton("a", { href: "#", "data-os-link": "checkout" })).toBe(false);
    expect(isUnlinkedButton("form", { "data-os-link": "" })).toBe(false);
  });

  it("linkMatches com a chave vazia pega só os botões sem link (antes pegava todo elemento sem link)", () => {
    const unlinked = { kind: "link", key: "" } as const;
    expect(linkMatches("a", { href: "#", "data-os-link": "" }, unlinked)).toBe(true);
    expect(linkMatches("a", { href: "#" }, unlinked)).toBe(false);
    expect(linkMatches("p", {}, unlinked)).toBe(false);
    expect(linkMatches("a", { href: "https://x.com" }, unlinked)).toBe(false);
    expect(linkMatches("a", { href: "#", "data-os-link": "checkout" }, unlinked)).toBe(false);
    // As outras buscas continuam iguais.
    expect(linkMatches("a", { href: "#", "data-os-link": "checkout" }, { kind: "link", key: "checkout" })).toBe(true);
    expect(linkMatches("a", { href: "https://x.com" }, { kind: "url", url: "https://x.com/" })).toBe(true);
  });

  it("ligar os botões sem link no HTML e no projeto", async () => {
    const html = `<!doctype html><html><body><a href="#" data-os-link="">A</a><a href="#">âncora</a><a href="#" data-os-link="">B</a><div>x</div></body></html>`;
    const r = await applyLinkOpToHtml(html, { kind: "link", key: "" }, { type: "bind", key: "checkout" });
    expect(r.count).toBe(2);
    expect(r.html.match(/data-os-link="checkout"/g)).toHaveLength(2);
    expect(r.html).toContain('<a href="#">âncora</a>');
    const attrs: Record<string, unknown> = { href: "#", "data-os-link": "" };
    expect(applyLinkOp("a", attrs, { type: "bind", key: "checkout" })).toBe(true);
    expect(attrs["data-os-link"]).toBe("checkout");
    const project = {
      pages: [
        {
          frames: [
            {
              component: {
                type: "wrapper",
                components: [
                  {
                    type: "link",
                    attributes: { href: "#", "data-os-link": "" },
                    components: [{ type: "textnode", content: "A" }],
                  },
                  { type: "link", attributes: { href: "#" }, components: [{ type: "textnode", content: "B" }] },
                ],
              },
            },
          ],
        },
      ],
    };
    const p = applyLinkOpToProject(project, { kind: "link", key: "" }, { type: "bind", key: "checkout" });
    expect(p.count).toBe(1);
  });
});

// ─── No editor de verdade ────────────────────────────────────────────────────

const ROOT = path.resolve(import.meta.dirname, "../..");
const ENTRY = `
import { createEditor } from "@/editor/grapes/setup";
import * as fr from "@/lib/find-replace";

window.scenarios = {
  groups(html) {
    return new Promise((resolve) => {
      document.body.innerHTML = '<div id="c" style="height:700px"></div><div id="b"></div><div id="l"></div><div id="s"></div><div id="t"></div>';
      const ids = ["c", "b", "l", "s", "t"].map((id) => document.getElementById(id));
      const ed = createEditor({ canvas: ids[0], blocks: ids[1], layers: ids[2], styles: ids[3], traits: ids[4] }, null);
      ed.on("load", async () => {
        ed.setComponents(html, { asDocument: true });
        ed.UndoManager.clear();
        // O GrapesJS limpa o desfazer logo depois do "load": espera.
        await new Promise((r) => setTimeout(r, 50));
        const summary = () => fr.collectLinkGroups(ed).map((g) => ({ id: g.id, kind: g.kind, count: g.items.length, labels: g.items.map((i) => i.label) }));
        const before = summary();
        const unlinked = fr.collectLinkGroups(ed).find((g) => g.kind === "unlinked");
        let changed = 0;
        let after = before;
        let undone = before;
        if (unlinked) {
          changed = fr.applyLinkOpInEditor(ed, unlinked.match, { type: "bind", key: "checkout" });
          after = summary();
          await new Promise((r) => setTimeout(r, 50));
          ed.UndoManager.undo();
          await new Promise((r) => setTimeout(r, 50));
          undone = summary();
        }
        ed.destroy();
        resolve({ before, changed, after, undone });
      });
    });
  },
};
`;

let browser: Browser;
let pageB: Page;

beforeAll(async () => {
  const out = await build({
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: "ts", sourcefile: "fr-e1-entry.ts" },
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    write: false,
    logLevel: "silent",
    tsconfig: path.join(ROOT, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"' },
    external: ["cheerio"],
  });
  browser = await chromium.launch();
  pageB = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await pageB.route("**/*", (route) =>
    route.request().url() === "http://fr.test/"
      ? route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" })
      : route.fulfill({ status: 204, body: "" }),
  );
  await pageB.goto("http://fr.test/");
  await pageB.addScriptTag({ content: out.outputFiles[0].text });
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

interface GroupsResult {
  before: { id: string; kind: string; count: number; labels: string[] }[];
  changed: number;
  after: { id: string; kind: string; count: number }[];
  undone: { id: string; kind: string; count: number }[];
}

function groups(html: string) {
  return pageB.evaluate(`window.scenarios.groups(${JSON.stringify(html)})`) as Promise<GroupsResult>;
}

describe("'Links e checkouts' no editor", () => {
  it("mostra os botões de compra sem link de cada modelo (antes: 'a página não tem links')", async () => {
    const expected: Record<string, number> = {
      "vendas-longa": 4,
      advertorial: 2,
      vsl: 1,
      upsell: 1,
      downsell: 1,
      obrigado: 1,
    };
    for (const [id, count] of Object.entries(expected)) {
      const template = PAGE_TEMPLATES.find((t) => t.id === id);
      if (!template) throw new Error(`modelo ${id}`);
      const r = await groups(template.html);
      const unlinked = r.before.find((g) => g.kind === "unlinked");
      expect(unlinked?.count, id).toBe(count);
      expect(r.before[0]?.kind === "unlinked" || r.before.some((g) => g.id === "unlinked"), id).toBe(true);
      // Um clique liga todos (e um Desfazer volta todos).
      expect(r.changed, id).toBe(count);
      expect(
        r.after.some((g) => g.kind === "unlinked"),
        id,
      ).toBe(false);
      expect(r.after.find((g) => g.id === "link:checkout")?.count, id).toBe(count);
      expect(r.undone.find((g) => g.kind === "unlinked")?.count, id).toBe(count);
    }
  });

  it("âncoras '#', links comuns e formulários sem destino não entram no grupo", async () => {
    const r = await groups(
      `<!doctype html><html><body>
        <a href="#" data-os-link="">Quero agora</a>
        <a href="#">Topo</a>
        <a href="https://site.com/x">Site</a>
        <a href="#" data-os-link="checkout">Ligado</a>
        <form data-os-link=""><input name="e"></form>
      </body></html>`,
    );
    const unlinked = r.before.find((g) => g.kind === "unlinked");
    expect(unlinked).toMatchObject({ count: 1, labels: ["Quero agora"] });
    expect(r.before.map((g) => g.id).sort()).toEqual(["link:checkout", "unlinked", "url:https://site.com/x"].sort());
  });
});
