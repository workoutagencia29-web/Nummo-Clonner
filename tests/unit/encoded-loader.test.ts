/**
 * Carregadores codificados (código novo da UTMify: atob + XOR). Antes, o
 * clonador não reconhecia o pixel nesse formato (no modo "Com scripts" a cópia
 * ficava com o pixel do dono original), o campo de ID recusava o código colado
 * e o código livre não avisava do rastreador. IDs daqui são falsos.
 */
import * as cheerio from "cheerio";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  dataUriScript,
  decodeEncodedLoaders,
  decodeLoaderPayload,
  loaderEquivalent,
  withDecodedLoaders,
} from "@/detection/encoded-loader";
import { prisma } from "@/lib/db";
import { getObject } from "@/lib/storage";
import { codeUrls, detectCodeTrackers, resolveCodeCategory, unknownScriptHosts } from "@/lib/tracking/code-trackers";
import { checkPixelId } from "@/lib/tracking/ids";
import { runCloneJob } from "@/worker/clone/job";
import { classifyInlineScript, removeTrackers } from "@/worker/clone/trackers";
import type { CloneResult } from "@/worker/clone/types";
import { type FixtureServer, startFixtureServer } from "../fixtures/server";

/** Codifica como a UTMify: [tamanho da chave, chave…, JSON em UTF-8 com XOR]. */
function encode(payload: unknown, key: number[] = [17, 201, 66, 5, 250, 33, 140, 9, 77, 3, 190]): string {
  const data = Buffer.from(JSON.stringify(payload), "utf8");
  const k = Buffer.from(key);
  return Buffer.concat([Buffer.from([k.length]), k, Buffer.from(data.map((b, i) => b ^ k[i % k.length]))]).toString(
    "base64",
  );
}

/** O código como a UTMify entrega (mesma estrutura, nomes de variável sorteados). */
function snippet(base64: string): string {
  return `<script>(function(){var u_qdsi=atob("${base64}");var j_7vu=[];for(var a_jak=0;a_jak<u_qdsi.length;a_jak++){j_7vu.push(u_qdsi.charCodeAt(a_jak)&255);}var z_2k4=j_7vu[0];var w_0j=j_7vu.slice(1,1+z_2k4);var s_gqmq=j_7vu.slice(1+z_2k4);var g_xd=s_gqmq.map(function(b,b_5k){return b^w_0j[b_5k%z_2k4];});var o_cslj="";for(var l_v5u=0;l_v5u<g_xd.length;l_v5u++){o_cslj+=String.fromCharCode(g_xd[l_v5u]&255);}var y_2=decodeURIComponent(escape(o_cslj));var q_jtko=JSON.parse(y_2);var a_99m=q_jtko.globals||[];a_99m.forEach(function(f_eu2f){window[f_eu2f.name]=f_eu2f.value;});var w_s=document.createElement("script");w_s.src=q_jtko.url;w_s.async=true;w_s.defer=true;(q_jtko.attributes||[]).forEach(function(z_tw78){w_s.setAttribute(z_tw78.name,z_tw78.value);});(document.head||document.documentElement).appendChild(w_s);})();</script>`;
}

const FAKE_ID = "a1b2c3d4e5f60718293a4b5c";
const PIXEL = encode({
  url: "https://cdn.utmify.com.br/scripts/pixel/pixel.js",
  attributes: [],
  globals: [{ name: "pixelId", value: FAKE_ID }],
});
const UTMS = encode(
  {
    url: "https://cdn.utmify.com.br/scripts/utms/latest.js",
    attributes: [{ name: "data-utmify-prevent-subids", value: "" }],
    globals: [],
  },
  [99, 7, 213, 45, 128],
);

describe("decodificador", () => {
  it("lê o endereço, as globais e os atributos (com chave XOR)", () => {
    expect(decodeLoaderPayload(PIXEL)).toEqual({
      url: "https://cdn.utmify.com.br/scripts/pixel/pixel.js",
      globals: [{ name: "pixelId", value: FAKE_ID }],
      attributes: [],
    });
    const loaders = decodeEncodedLoaders(`${snippet(PIXEL)}\n${snippet(UTMS)}`);
    expect(loaders.map((l) => l.url)).toEqual([
      "https://cdn.utmify.com.br/scripts/pixel/pixel.js",
      "https://cdn.utmify.com.br/scripts/utms/latest.js",
    ]);
    expect(loaders[1].attributes).toEqual([{ name: "data-utmify-prevent-subids", value: "" }]);
  });

  it("aceita aspas simples, crase, window.atob, 'atob (' com espaço e endereço relativo", () => {
    const relative = encode({ url: "js/widget.js" }, [3, 4]);
    expect(decodeEncodedLoaders(`var c = window.atob('${PIXEL}');`)[0]?.url).toBe(
      "https://cdn.utmify.com.br/scripts/pixel/pixel.js",
    );
    expect(decodeEncodedLoaders(`atob (\`${PIXEL}\`)`)).toHaveLength(1);
    expect(decodeEncodedLoaders(`atob("${relative}")`)[0]?.url).toBe("js/widget.js");
  });

  it("lê o texto como o navegador: \\/, \\n, \\x2F e continuação de linha (LF e CRLF)", () => {
    const half = Math.floor(PIXEL.length / 2);
    const variants = [
      PIXEL.replace(/\//g, "\\/"),
      PIXEL.replace(/\//g, "\\x2F"),
      `${PIXEL.slice(0, half)}\\\n${PIXEL.slice(half)}`,
      `${PIXEL.slice(0, half)}\\\r\n${PIXEL.slice(half)}`,
      `${PIXEL.slice(0, half)}\\n${PIXEL.slice(half)}`,
    ];
    expect(PIXEL).toContain("/");
    for (const v of variants) {
      expect(decodeEncodedLoaders(`atob("${v}")`)[0]?.globals, v.slice(0, 40)).toEqual([
        { name: "pixelId", value: FAKE_ID },
      ]);
    }
  });

  it("JSON em base64 sem a chave XOR não é carregador (configuração comum)", () => {
    const plain = Buffer.from(
      JSON.stringify({ url: "https://exemplo.us21.list-manage.com/subscribe/post-json?u=abc", campos: ["EMAIL"] }),
    ).toString("base64");
    expect(decodeEncodedLoaders(`var form = JSON.parse(atob("${plain}"));`)).toEqual([]);
  });

  it("ignora atob comum, base64 quebrado, JSON sem endereço e endereços que não são http", () => {
    expect(decodeEncodedLoaders('el.textContent = atob("R2FyYW50aWEgZGUgNyBkaWFz");')).toEqual([]);
    expect(decodeEncodedLoaders('atob("@@@@ isso não é base64 @@@@")')).toEqual([]);
    expect(decodeEncodedLoaders(`atob("${encode({ nome: "sem url" })}")`)).toEqual([]);
    expect(decodeEncodedLoaders(`atob("${encode({ url: "javascript:alert(1)" })}")`)).toEqual([]);
    expect(decodeEncodedLoaders(`atob("${encode({ url: "data:text/javascript,alert(1)" })}")`)).toEqual([]);
    expect(decodeEncodedLoaders("")).toEqual([]);
    expect(decodeEncodedLoaders(`${" ".repeat(400_001)}atob("${PIXEL}")`)).toEqual([]);
  });

  it("descarta globais e atributos com nome estranho (e eventos on*)", () => {
    const [loader] = decodeEncodedLoaders(
      `atob("${encode({
        url: "https://cdn.utmify.com.br/scripts/pixel/pixel.js",
        globals: [
          { name: "pixelId", value: FAKE_ID },
          { name: "a b", value: "x" },
          { name: "objeto", value: { x: 1 } },
        ],
        attributes: [
          { name: "onload", value: "alert(1)" },
          { name: "data-ok", value: 1 },
        ],
      })}")`,
    );
    expect(loader.globals).toEqual([{ name: "pixelId", value: FAKE_ID }]);
    expect(loader.attributes).toEqual([{ name: "data-ok", value: "1" }]);
  });

  it("o equivalente legível escapa aspas e </script>", () => {
    const text = loaderEquivalent({
      url: 'https://cdn.utmify.com.br/x.js?a="b"',
      globals: [{ name: "pixelId", value: "</script><b>" }],
      attributes: [{ name: "data-x", value: '"><img src=x>' }],
    });
    expect(text).toBe(
      '<script>window.pixelId = "\\u003c/script>\\u003cb>";</script><script src="https://cdn.utmify.com.br/x.js?a=&quot;b&quot;" data-x="&quot;&gt;&lt;img src=x&gt;"></script>',
    );
    // Sem carregador, o código volta igual (mesmo objeto de texto).
    const code = "console.log(1)";
    expect(withDecodedLoaders(code)).toBe(code);
  });
});

describe("campo de ID e código livre", () => {
  it("o código da UTMify colado inteiro no campo de ID vira o ID", () => {
    expect(checkPixelId("UTMIFY", snippet(PIXEL))).toEqual({ ok: true, id: FAKE_ID });
    expect(checkPixelId("UTMIFY", FAKE_ID)).toEqual({ ok: true, id: FAKE_ID });
    // Só o script de UTMs (sem pixelId): continua pedindo o ID.
    expect(checkPixelId("UTMIFY", snippet(UTMS)).ok).toBe(false);
  });

  it("código livre: endereços e hosts de fora que só aparecem decodificados", () => {
    expect(codeUrls(snippet(PIXEL))).toContain("https://cdn.utmify.com.br/scripts/pixel/pixel.js");
    const unknown = encode({ url: "https://rastreio-desconhecido.com.br/t.js" });
    expect(unknownScriptHosts([snippet(unknown)])).toEqual(["rastreio-desconhecido.com.br"]);
  });

  it("código livre: script em data: (rastreador mantido na revisão da clonagem) e campo grande também contam", () => {
    const inner = snippet(PIXEL).replace(/^<script>|<\/script>$/g, "");
    const kept = `<script src="data:text/javascript;base64,${Buffer.from(inner).toString("base64")}" defer></script>`;
    expect(detectCodeTrackers(kept)).toEqual(["UTMify"]);
    expect(resolveCodeCategory({ head: kept }, undefined).category).toBe("MARKETING");
    // Perto do limite do código da página (200 KiB).
    const big = `<script>${"var x = 1;\n".repeat(19_000)}</script>${snippet(PIXEL)}`;
    expect(big.length).toBeGreaterThan(200_000);
    expect(detectCodeTrackers(big)).toEqual(["UTMify"]);
  });

  it("código livre com o pixel codificado é rastreador (espera o 'Aceitar' quando não há categoria)", () => {
    expect(detectCodeTrackers(snippet(PIXEL))).toEqual(["UTMify"]);
    const resolved = resolveCodeCategory({ bodyEnd: snippet(UTMS) }, undefined);
    expect(resolved.trackers).toEqual(["UTMify"]);
    expect(resolved.category).toBe("MARKETING");
  });
});

describe("clonagem", () => {
  it("remove o pixel e o script de UTMs codificados, com o ID; o resto fica", () => {
    const site = encode({ url: "https://exemplo.com.br/js/widget.js", globals: [{ name: "cor", value: "#f60" }] });
    const $ = cheerio.load(
      `<html><head>${snippet(PIXEL)}${snippet(UTMS)}${snippet(site)}</head><body><p id="s"></p><script>s.textContent=atob("R2FyYW50aWE=")</script></body></html>`,
    );
    const removed = removeTrackers($, "https://exemplo.com.br/");
    expect(removed.map((r) => [r.vendor, r.pixelId ?? null, r.kind])).toEqual([
      ["UTMify", FAKE_ID, "script-inline"],
      ["UTMify", null, "script-inline"],
    ]);
    const left = $("script")
      .toArray()
      .map((el) => $(el).html() ?? "");
    expect(left).toHaveLength(2);
    expect(left[0]).toContain(site);
    expect(left[1]).toContain('atob("R2FyYW50aWE=")');
  });

  it("script em data: (JS adiado por plugin de cache) com o pixel codificado ou no formato antigo também sai", () => {
    const inner = snippet(PIXEL).replace(/^<script>|<\/script>$/g, "");
    const encoded = `data:text/javascript;base64,${Buffer.from(inner).toString("base64")}`;
    const old = `data:text/javascript,${encodeURIComponent('window.pixelId = "0123456789abcdef01234567"; var a = document.createElement("script"); a.src = "https://cdn.utmify.com.br/scripts/pixel/pixel.js"; document.head.appendChild(a);')}`;
    expect(dataUriScript(encoded)).toBe(inner);
    expect(dataUriScript("data:image/png;base64,iVBORw0KGgo=")).toBeNull();
    expect(dataUriScript("https://exemplo.com.br/app.js")).toBeNull();
    const $ = cheerio.load(
      `<html><head><script src="${encoded}" defer></script><script data-rocket-src="${old}"></script><script src="data:text/javascript;base64,${Buffer.from("console.log(1)").toString("base64")}"></script></head><body></body></html>`,
    );
    const removed = removeTrackers($, "https://exemplo.com.br/");
    expect(removed.map((r) => [r.vendor, r.pixelId ?? null])).toEqual([
      ["UTMify", FAKE_ID],
      ["UTMify", "0123456789abcdef01234567"],
    ]);
    expect($("script")).toHaveLength(1);
  });

  it("no DOM renderizado, o <script src> que o carregador injetou sai junto, sem virar outro item", () => {
    const $ = cheerio.load(
      `<html><head>${snippet(PIXEL)}${snippet(UTMS)}<script src="https://cdn.utmify.com.br/scripts/pixel/pixel.js" async></script><script src="https://cdn.utmify.com.br/scripts/utms/latest.js" data-utmify-prevent-subids=""></script></head><body></body></html>`,
    );
    const removed = removeTrackers($, "https://exemplo.com.br/");
    expect(removed.map((r) => [r.vendor, r.pixelId ?? null, r.kind])).toEqual([
      ["UTMify", FAKE_ID, "script-inline"],
      ["UTMify", null, "script-inline"],
    ]);
    expect($("script")).toHaveLength(0);
    // Sem carregador codificado, o <script src> do rastreador continua sendo um item da lista.
    const $plain = cheerio.load(
      `<html><head><script src="https://cdn.utmify.com.br/scripts/pixel/pixel.js"></script></head><body></body></html>`,
    );
    expect(removeTrackers($plain, "https://exemplo.com.br/").map((r) => r.kind)).toEqual(["script-src"]);
  });

  it("o <script src> injetado só sai calado quando o carregador dele foi listado como o mesmo rastreador", () => {
    const page = "https://exemplo.com.br/";
    // Carregador com endereço relativo (resolvido pela página): é o GTM; o script injetado sai junto.
    const gtm = encode({ url: "/gtm.js?id=GTM-ABC1234" });
    const $rel = cheerio.load(
      `<html><head><script>(function(){var u=atob("${gtm}")})();</script><script src="/gtm.js?id=GTM-ABC1234" async></script></head><body></body></html>`,
    );
    expect(removeTrackers($rel, page).map((r) => [r.vendor, r.kind])).toEqual([
      ["Google Tag Manager", "script-inline"],
    ]);
    expect($rel("script")).toHaveLength(0);
    // O mesmo <script> tem o código da Meta antes do carregador da UTMify: ele vira "Meta Pixel",
    // e o pixel.js injetado continua sendo um item da UTMify (nada some calado).
    const meta = `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','111122223333444');`;
    const $mix = cheerio.load(
      `<html><head><script>${meta}\n(function(){var u=atob("${PIXEL}")})();</script><script src="https://cdn.utmify.com.br/scripts/pixel/pixel.js" async></script></head><body></body></html>`,
    );
    expect(removeTrackers($mix, page).map((r) => [r.vendor, r.pixelId ?? null, r.kind])).toEqual([
      ["Meta Pixel", "111122223333444", "script-inline"],
      ["UTMify", null, "script-src"],
    ]);
  });

  it("script grande em data: com o carregador codificado sai com o ID", () => {
    const code = `${"var x=1;\n".repeat(9500)}${snippet(PIXEL).replace(/^<script>|<\/script>$/g, "")}`;
    const $ = cheerio.load(
      `<html><head><script src="data:text/javascript;base64,${Buffer.from(code).toString("base64")}"></script></head><body></body></html>`,
    );
    expect(removeTrackers($, "https://exemplo.com.br/").map((r) => [r.vendor, r.pixelId ?? null])).toEqual([
      ["UTMify", FAKE_ID],
    ]);
  });

  it("o carregador codificado no meio de um script grande também é reconhecido", () => {
    const big = `${"var x = 1;\n".repeat(600)}${snippet(PIXEL).replace(/^<script>|<\/script>$/g, "")}`;
    expect(classifyInlineScript(big)?.vendor).toBe("UTMify");
  });
});

describe("clonagem de ponta a ponta (site 'codificado', Chromium)", () => {
  let srv: FixtureServer;

  beforeAll(async () => {
    srv = await startFixtureServer();
    process.env.OS_CLONE_HOST_MAP = "*.fixture.test=127.0.0.1";
  }, 60_000);

  afterAll(async () => {
    await srv?.close();
  });

  it("'Com scripts' e Editável saem sem o pixel do dono, que aparece na lista de removidos com o ID", async () => {
    const job = await prisma.cloneJob.create({
      data: { source: "URL", sourceUrl: srv.url("codificado"), options: { devices: ["desktop"], maxVideoMb: 5 } },
    });
    await runCloneJob(job.id);
    const done = await prisma.cloneJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status, done.errorMessage ?? "").toBe("REVIEW");
    const result = done.result as unknown as CloneResult;

    const utmify = result.removed.filter((r) => r.vendor === "UTMify");
    expect(utmify.map((r) => r.pixelId).filter(Boolean)).toEqual(
      expect.arrayContaining([FAKE_ID, "f0e1d2c3b4a5968778695a4b"]),
    );
    // Os <script src> que os carregadores injetaram não viram itens repetidos.
    expect(utmify.every((r) => r.kind === "script-inline")).toBe(true);

    const preserve = (await getObject(result.devices.desktop?.outputs.PRESERVE_JS.htmlKey ?? "")).toString("utf8");
    expect(decodeEncodedLoaders(preserve).map((l) => l.url)).toEqual(["js/widget.js"]);
    expect(preserve).not.toContain("cdn.utmify.com.br");
    expect(preserve).not.toContain("data:text/javascript");
    expect(preserve).toContain('atob("R2FyYW50aWEgZGUgNyBkaWFz")');

    const editable = (await getObject(result.devices.desktop?.outputs.EDITABLE.htmlKey ?? "")).toString("utf8");
    expect(editable).not.toContain("cdn.utmify.com.br");
    expect(decodeEncodedLoaders(editable)).toEqual([]);
    // O que os scripts do site fizeram ficou no retrato (modo Editável): o texto do selo e o
    // widget que o carregador codificado do próprio site carregou de verdade.
    expect(editable).toContain("Garantia de 7 dias");
    expect(editable).toMatch(/<html[^>]*\sdata-widget="#ff6600"/);
  }, 240_000);
});
