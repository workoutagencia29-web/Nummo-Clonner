/**
 * Correções da Fase 3 (grupo H) no construtor da cópia (buildClone):
 * - #0/#3: o modo Editável tira as marcas do editor que a página já trouxesse
 *   (data-gjs-*, <os-script>, data-os-on-*, data-os-js-*…), que virariam código
 *   no painel ou scripts de verdade no primeiro salvar;
 * - #45: a saída "Preservar JS" leva <meta name="os-preserve-js" content="1"> no
 *   <head> (o script do Offer Studio não refaz menus/FAQ que o JS original já faz),
 *   e essa marca atravessa o editor.
 */
import { randomUUID } from "node:crypto";
import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import { finalizeFromEditor, PRESERVE_JS_META, prepareForEditor } from "@/lib/editor-html";
import { getObject } from "@/lib/storage";
import { buildClone } from "@/worker/clone/build";
import type { Fetcher } from "@/worker/clone/fetcher";
import type { Capture, CloneModeValue, CloneResult } from "@/worker/clone/types";

const URL_ = "https://marcas.test/";

function capture(html: string): Capture {
  return {
    device: "desktop",
    requestedUrl: URL_,
    finalUrl: URL_,
    status: 200,
    title: "Marcas",
    originalHtml: html,
    renderedHtml: html,
    responses: new Map(),
    blocked: [],
  };
}

/** Sem rede: todo download falha (a página do teste não precisa de nenhum). */
const noNetwork: Fetcher = {
  async fetchResource(url) {
    return { ok: false, status: 404, finalUrl: url, contentType: "", body: Buffer.alloc(0), error: "404" };
  },
  async downloadToFile() {
    throw new Error("sem rede no teste");
  },
  async close() {},
};

async function build(html: string) {
  return buildClone({
    jobId: `fix3h-${randomUUID()}`,
    captures: [capture(html)],
    fetcher: noNetwork,
    log: () => {},
    maxVideoBytes: 1024,
    startedAt: Date.now(),
  });
}

async function output(result: CloneResult, mode: CloneModeValue) {
  const out = result.devices.desktop?.outputs[mode];
  if (!out) throw new Error(`sem saída ${mode}`);
  return (await getObject(out.htmlKey)).toString("utf8");
}

const HOSTILE = `<!doctype html><html><head><meta charset="utf-8"><title>Marcas</title>
<meta name="${PRESERVE_JS_META}" content="1"></head><body>
<div data-gjs-type="script" data-gjs-script="top.x = 1">a</div>
<p data-gjs-attributes='{"onclick":"x()"}'>p</p>
<os-script data-os-attrs='{"src":"https://tracker.evil.example/t.js"}' hidden></os-script>
<os-noscript data-os-attrs="{}" hidden>&lt;img src=x&gt;</os-noscript>
<button data-os-on-click="location.href='https://evil.example'" data-os-attrs="{}">Comprar</button>
<a data-os-js-href="alert(1)" data-os-dup-id="y" href="https://marcas.test/checkout">Link</a>
</body></html>`;

describe("#0/#3 — modo Editável sem marcas do editor vindas da página", () => {
  it("a saída Editável não tem data-gjs-*, <os-script>, data-os-on-*, data-os-js-* nem a marca do Preservar JS", async () => {
    const result = await build(HOSTILE);
    const html = await output(result, "EDITABLE");
    expect(html).not.toMatch(/data-gjs-|os-script|os-noscript|data-os-on-|data-os-js-|data-os-attrs|data-os-dup-id/i);
    expect(html).not.toContain(PRESERVE_JS_META);
    expect(html).not.toContain("tracker.evil.example");
    const $ = cheerio.load(html);
    expect($("button").text()).toBe("Comprar");
    expect($("a").text()).toBe("Link");

    // Abrir no editor e salvar não cria script, on* nem javascript:.
    const final = finalizeFromEditor(prepareForEditor(html).html, "", html);
    expect(cheerio.load(final)("script")).toHaveLength(0);
    expect(final).not.toMatch(/onclick|javascript:|tracker\.evil|location\.href/i);
  });
});

describe("#45 — marca do Preservar JS", () => {
  it("a saída Preservar JS tem uma única <meta name=os-preserve-js> no <head>, e ela passa pelo editor", async () => {
    const result = await build(
      `<!doctype html><html><head><title>App</title></head><body><button onclick="abrir()">Menu</button><script>function abrir(){}</script></body></html>`,
    );
    const html = await output(result, "PRESERVE_JS");
    const $ = cheerio.load(html);
    expect($(`meta[name="${PRESERVE_JS_META}"]`)).toHaveLength(1);
    expect($(`head > meta[name="${PRESERVE_JS_META}"]`).attr("content")).toBe("1");
    expect(cheerio.load(await output(result, "EDITABLE"))(`meta[name="${PRESERVE_JS_META}"]`)).toHaveLength(0);

    // Uma página que já trazia a marca não fica com duas.
    const again = await build(HOSTILE);
    expect(cheerio.load(await output(again, "PRESERVE_JS"))(`meta[name="${PRESERVE_JS_META}"]`)).toHaveLength(1);

    // Abrir no editor e salvar mantém a marca no <head>.
    const final = finalizeFromEditor(prepareForEditor(html).html, "", html);
    expect(cheerio.load(final)(`head > meta[name="${PRESERVE_JS_META}"]`)).toHaveLength(1);
    // Sem o HTML anterior (página nova), o <head> do editor também a mantém.
    expect(
      cheerio.load(finalizeFromEditor(prepareForEditor(html).html, ""))(`meta[name="${PRESERVE_JS_META}"]`),
    ).toHaveLength(1);
  });
});
