/**
 * "Imagens mais leves" do ZIP (src/lib/export/lighter-images.ts): o que muda
 * em cada <img> e o que nunca muda.
 */
import { type Browser, chromium } from "playwright";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ImageSize, lighterImagesPlan } from "@/lib/export/lighter-images";

const sha = (n: number) => String(n).repeat(64).slice(0, 64);
const file = (n: number, ext = "webp") => `${sha(n)}.${ext}`;
const src = (n: number, ext = "webp") => `/os-assets/${file(n, ext)}`;
const BASE = "img,video,iframe{max-width:100%}\nimg{height:auto;display:block}";

function page(body: string, css = BASE, head = "") {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>@layer os-original{${css}}</style>${head}</head><body>${body}</body></html>`;
}

const sizes: Record<string, ImageSize> = {
  [file(1)]: { width: 1200, height: 675 },
  [file(2)]: { width: 900, height: 700 },
  [file(3)]: { width: 400, height: 400 },
  [file(4)]: { width: 800, height: 800 },
  [file(5, "jpg")]: { width: 640, height: 480 },
  [file(6, "png")]: { width: 300, height: 100 },
};
const sizeOf = (f: string) => sizes[f];

function run(html: string, size: (f: string) => ImageSize | null | undefined = sizeOf) {
  const plan = lighterImagesPlan(html);
  return plan ? plan.apply(size) : html;
}

/** Atributos novos de cada <img>, na ordem. */
function added(before: string, after: string) {
  const tags = (h: string) => [...h.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  const a = tags(before);
  return tags(after).map((t, i) => t.slice(a[i].replace(/\/?>$/, "").length).replace(/\/?>$/, "").trim());
}

describe("lighterImagesPlan", () => {
  it("sem a regra base dos modelos (página clonada), nada muda", () => {
    const html = page(
      [1, 2, 3, 4].map((n) => `<img src="${src(n)}" alt="">`).join(""),
      "img{max-width:100%;height:auto}",
    );
    expect(lighterImagesPlan(html)).toBeNull();
    expect(run(html)).toBe(html);
  });

  it("1ª com prioridade, 2ª igual, da 3ª em diante lazy com as dimensões reais", () => {
    const html = page(
      `<section><img src="${src(1)}" alt="Produto"><img src="${src(2)}" alt=""></section>` +
        `<p>texto</p><img src="${src(3)}" alt="a"><img class="x" src="${src(4)}"/>` +
        `<img src="http://localhost:3000${src(5, "jpg")}" alt="b">`,
    );
    const out = run(html);
    expect(added(html, out)).toEqual([
      'fetchpriority="high"',
      "",
      'loading="lazy" decoding="async" width="400" height="400"',
      'loading="lazy" decoding="async" width="800" height="800"',
      'loading="lazy" decoding="async" width="640" height="480"',
    ]);
    expect(out).toContain(`<img class="x" src="${src(4)}" loading="lazy" decoding="async" width="800" height="800"/>`);
    // Só atributos novos: tirando-os, o HTML é o mesmo, byte a byte.
    expect(out.replace(/ (?:fetchpriority|loading|decoding|width|height)="[^"]*"/g, "")).toBe(html);
    // A mesma página de novo (o ZIP é sempre igual).
    expect(run(html)).toBe(out);
  });

  it("widgets, blocos escondidos, <picture>, srcset, loading já posto e imagens de fora não contam nem mudam", () => {
    const skipped = [
      `<div data-os-widget="gallery"><img src="${src(1)}"></div>`,
      `<div hidden><img src="${src(1)}"></div>`,
      `<div data-os-delay="5"><img src="${src(1)}"></div>`,
      `<div data-os-qz-step="question"><img src="${src(1)}"></div>`,
      `<div data-os-premio="ganhou"><img src="${src(1)}"></div>`,
      `<picture><source srcset="${src(2)}"><img src="${src(1)}"></picture>`,
      `<img src="${src(1)}" srcset="${src(1)} 1x, ${src(2)} 2x">`,
      `<img src="${src(1)}" loading="eager">`,
      `<img src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E">`,
      `<img src="https://cdn.exemplo.com/foto.jpg">`,
      `<img src="/os-assets/${sha(7)}.svg">`,
      `<img src="/os-assets/${sha(8)}.gif">`,
      `<noscript><img src="${src(1)}"></noscript>`,
    ].join("");
    // Atraso "0" não esconde: a imagem conta.
    const html = page(
      `${skipped}<div data-os-delay="0"><img src="${src(2)}"></div><img src="${src(3)}"><img src="${src(4)}">`,
    );
    const out = run(html);
    expect(out.match(/loading="lazy"/g)).toHaveLength(1);
    expect(out).toContain(`<img src="${src(4)}" loading="lazy" decoding="async" width="800" height="800">`);
    expect(out).toContain(`<div data-os-delay="0"><img src="${src(2)}" fetchpriority="high"></div>`);
    expect(out).toContain(`<img src="${src(1)}" loading="eager">`);
    expect(out.match(/fetchpriority/g)).toHaveLength(1);
  });

  it("fetchpriority: só uma vez, só nas duas primeiras com 400 px ou mais, nunca se a página já tem", () => {
    const small = page(`<img src="${src(6, "png")}"><img src="${src(3)}"><img src="${src(1)}">`);
    const out = run(small);
    expect(added(small, out)).toEqual([
      "",
      'fetchpriority="high"',
      'loading="lazy" decoding="async" width="1200" height="675"',
    ]);
    const has = page(`<img src="${src(6, "png")}" fetchpriority="low"><img src="${src(1)}"><img src="${src(2)}">`);
    expect(run(has)).not.toContain('fetchpriority="high"');
  });

  it('CSS que dá altura à imagem (ou style="height…"): a imagem fica como está', () => {
    const css = `${BASE}\n.os-person img{width:48px;height:48px;border-radius:50%}\n@media (max-width:600px){.foto:hover{max-height:200px}}\n.ok img{height:auto;max-height:none}`;
    const html = page(
      `<img src="${src(1)}"><img src="${src(2)}">` +
        `<div class="os-person"><img src="${src(3)}"></div>` +
        `<img class="foto" src="${src(4)}">` +
        `<img src="${src(5, "jpg")}" style="height: 120px">` +
        `<div class="ok"><img src="${src(6, "png")}"></div>`,
      css,
    );
    const out = run(html);
    expect(added(html, out).slice(2)).toEqual(["", "", "", 'loading="lazy" decoding="async" width="300" height="100"']);
  });

  it("com width e height já postos, só o lazy; com só um dos dois ou sem as dimensões, nada", () => {
    const html = page(
      `<img src="${src(1)}"><img src="${src(2)}">` +
        `<img src="${src(3)}" width="200" height="200">` +
        `<img src="${src(4)}" width="300">` +
        `<img src="/os-assets/${sha(9)}.webp">`,
    );
    const out = run(html);
    expect(added(html, out).slice(2)).toEqual(['loading="lazy" decoding="async"', "", ""]);
  });

  it("largura nova só quando não muda o tamanho: contêiner flex/grid sem largura no CSS fica como está", () => {
    const css = [
      BASE,
      // Cartão de depoimento em coluna (bloco do editor: estilo pelo #id).
      "#card{display:flex;flex-direction:column;gap:14px}",
      ".grade{display:grid;grid-template-columns:1fr 1fr}",
      // Largura dada pelo CSS: o atributo não muda nada, mesmo dentro de flex.
      ".os-media{display:flex}.os-media img{width:100%}",
      // Largura só no computador: no celular a imagem estica até o contêiner.
      ".lado{display:flex;flex-direction:column}@media (min-width:768px){.lado img{width:50%}}",
      // Largura só no :hover: não conta.
      ".hov{display:flex;flex-direction:column}.hov img:hover{width:80%}",
      // Flex só numa tela: conta do mesmo jeito.
      "@media (max-width:600px){.cel{display:flex;flex-direction:column}}",
    ].join("\n");
    const html = page(
      `<img src="${src(1)}"><img src="${src(2)}">` +
        `<div id="card"><img src="${src(3)}"></div>` +
        `<div class="grade"><img src="${src(4)}"></div>` +
        `<div class="os-media"><img src="${src(5, "jpg")}"></div>` +
        `<div class="lado"><img src="${src(6, "png")}"></div>` +
        `<div class="hov"><img src="${src(3)}"></div>` +
        `<div class="cel"><img src="${src(4)}"></div>` +
        `<div style="display: flex; flex-direction: column"><img src="${src(4)}"></div>` +
        `<div style="display:flex"><img src="${src(4)}" style="width: 100%"></div>` +
        `<p><a href="#"><img src="${src(4)}"></a></p>`,
      css,
    );
    expect(added(html, run(html)).slice(2)).toEqual([
      "",
      "",
      'loading="lazy" decoding="async" width="640" height="480"',
      "",
      "",
      "",
      "",
      'loading="lazy" decoding="async" width="800" height="800"',
      'loading="lazy" decoding="async" width="800" height="800"',
    ]);
    // display: contents em algum lugar: o contêiner de verdade pode estar mais acima — só com largura no CSS.
    const contents = page(
      `<img src="${src(1)}"><img src="${src(2)}"><div class="c"><img src="${src(3)}"></div>` +
        `<div class="os-media"><img src="${src(4)}"></div>`,
      `${BASE}\n.c{display:contents}\n.os-media img{width:100%}`,
    );
    expect(added(contents, run(contents)).slice(2)).toEqual([
      "",
      'loading="lazy" decoding="async" width="800" height="800"',
    ]);
  });

  it("folha de estilo de fora (que não dá para conferir): nada de lazy", () => {
    const html = page(
      [1, 2, 3, 4].map((n) => `<img src="${src(n)}">`).join(""),
      BASE,
      '<link rel="stylesheet" href="/os-assets/abc.css">',
    );
    expect(run(html)).not.toContain('loading="lazy"');
    const fonts = page(
      [1, 2, 3, 4].map((n) => `<img src="${src(n)}">`).join(""),
      BASE,
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">',
    );
    expect(run(fonts)).toContain('loading="lazy"');
  });
});

describe("no navegador (celular, 390 px)", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
  });

  it("cartão em coluna, grade, bloco comum e imagem com largura no CSS: cada imagem fica do mesmo tamanho", async () => {
    // Fotos pequenas (cartão) e grandes (bloco comum, maior que a tela): os dois lados do esticar.
    const real: Record<string, ImageSize> = {
      [file(1)]: { width: 700, height: 400 },
      [file(2)]: { width: 700, height: 400 },
      [file(3)]: { width: 700, height: 400 },
      [file(4)]: { width: 200, height: 120 },
      [file(5)]: { width: 1200, height: 600 },
    };
    const css = [
      BASE,
      "body{margin:0;padding:0 16px}",
      // Como o cartão de depoimento do editor (src/editor/blocks/proof.ts).
      ".card{display:flex;flex-direction:column;gap:14px;padding:26px;box-sizing:border-box}",
      ".grade{display:grid;grid-template-columns:1fr 1fr;justify-items:stretch}",
      ".os-media{display:flex}.os-media img{width:100%}",
    ].join("\n");
    const html = page(
      `<img src="${src(1)}" alt=""><img src="${src(2)}" alt="">` +
        `<div class="card"><img src="${src(3)}" alt=""><p>Depoimento</p></div>` +
        `<div class="card"><img src="${src(4)}" alt=""></div>` +
        `<div class="grade"><img src="${src(4)}" alt=""><img src="${src(3)}" alt=""></div>` +
        `<div class="os-media"><img src="${src(3)}" alt=""></div>` +
        `<section><img src="${src(5)}" alt=""><img src="${src(4)}" alt=""></section>`,
      css,
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
    );
    const after = run(html, (f) => real[f]);
    // Só o bloco comum e o .os-media ganham as dimensões (os outros ficam como estão).
    expect(after.match(/ width="/g)).toHaveLength(3);

    const bytes = new Map<string, Buffer>();
    for (const [name, size] of Object.entries(real)) {
      bytes.set(
        name,
        await sharp({ create: { ...size, channels: 3, background: { r: 30, g: 140, b: 90 } } })
          .webp()
          .toBuffer(),
      );
    }
    const measure = async (content: string) => {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
      const pg = await context.newPage();
      await pg.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        const name = url.pathname.split("/").pop() ?? "";
        if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: content });
        const body = bytes.get(name);
        return body ? route.fulfill({ contentType: "image/webp", body }) : route.abort();
      });
      await pg.goto("http://pagina.test/");
      // Rola até o fim: as preguiçosas carregam.
      await pg.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 300) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 30));
        }
      });
      await pg.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
      const rects = await pg.evaluate(() =>
        [...document.images].map((i) => {
          const r = i.getBoundingClientRect();
          return [Math.round(r.width), Math.round(r.height), Math.round(r.top + window.scrollY)];
        }),
      );
      const scrollWidth = await pg.evaluate(() => document.documentElement.scrollWidth);
      await context.close();
      return { rects, scrollWidth };
    };
    const before = await measure(html);
    const lighter = await measure(after);
    expect(lighter.rects).toEqual(before.rects);
    expect(lighter.scrollWidth).toBe(before.scrollWidth);
    expect(before.scrollWidth).toBeLessThanOrEqual(390);
  }, 60_000);
});
