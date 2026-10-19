/**
 * Processamento de imagens enviadas no editor (src/server/services/assets.ts):
 * conversão para WebP, limites, animações, EXIF e limpeza de SVG — inclusive
 * a limpeza leve dos SVGs baixados na clonagem (cleanClonedSvg).
 */
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  AssetError,
  cleanClonedSvg,
  cleanFileName,
  IMAGE_UPLOAD_LIMITS,
  processImage,
  sanitizeSvg,
  sniffImageFormat,
} from "@/server/services/assets";
import { catchError } from "./helpers";

const solid = (
  width: number,
  height: number,
  background: string | { r: number; g: number; b: number; alpha?: number } = "#c0392b",
  channels: 3 | 4 = 3,
) => sharp({ create: { width, height, channels, background } });

async function metaOf(data: Uint8Array) {
  return sharp(Buffer.from(data)).metadata();
}

/** GIF animado de 3 quadros (cores diferentes, para o codificador não juntar). */
async function animatedGif(width = 30, frame = 20) {
  const stacked = await solid(width, frame * 3, "#0000ff", 4)
    .composite([
      { input: { create: { width, height: frame, channels: 4, background: "#ff0000" } }, top: frame, left: 0 },
      { input: { create: { width, height: frame, channels: 4, background: "#00ff00" } }, top: frame * 2, left: 0 },
    ])
    .raw()
    .toBuffer();
  return sharp(stacked, { raw: { width, height: frame * 3, channels: 4, pageHeight: frame } })
    .gif({ loop: 0, delay: [100, 100, 100] })
    .toBuffer();
}

async function expectAssetError(promise: Promise<unknown>, status: number, message: RegExp) {
  const err = await catchError(promise);
  expect(err).toBeInstanceOf(AssetError);
  expect((err as AssetError).status).toBe(status);
  expect((err as AssetError).message).toMatch(message);
}

describe("sniffImageFormat", () => {
  it("reconhece os formatos aceitos pelo conteúdo", async () => {
    expect(sniffImageFormat(await solid(4, 4).jpeg().toBuffer())).toBe("jpeg");
    expect(sniffImageFormat(await solid(4, 4).png().toBuffer())).toBe("png");
    expect(sniffImageFormat(await solid(4, 4).webp().toBuffer())).toBe("webp");
    expect(sniffImageFormat(await solid(4, 4).gif().toBuffer())).toBe("gif");
    expect(sniffImageFormat(await solid(8, 8).avif().toBuffer())).toBe("avif");
    expect(sniffImageFormat(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe("svg");
    expect(
      sniffImageFormat(
        Buffer.from(
          '\ufeff<?xml version="1.0"?>\n<!-- Generator: Adobe Illustrator -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd" [\n<!ENTITY ns_svg "http://www.w3.org/2000/svg">\n]>\n<svg version="1.1"></svg>',
        ),
      ),
    ).toBe("svg");
  });

  it("recusa o que não é imagem aceita", async () => {
    expect(sniffImageFormat(Buffer.from("<!doctype html><html><body><svg></svg></body></html>"))).toBeNull();
    expect(sniffImageFormat(Buffer.from("PK\x03\x04 arquivo zip"))).toBeNull();
    expect(sniffImageFormat(await solid(4, 4).tiff().toBuffer())).toBeNull();
    expect(sniffImageFormat(Buffer.from([]))).toBeNull();
  });
});

describe("cleanFileName", () => {
  it("tira pastas, caracteres de controle e marcação", () => {
    expect(cleanFileName("C:\\fotos\\banner final.png")).toBe("banner final.png");
    expect(cleanFileName("../../etc/<b>x\u0000.jpg")).toBe("bx.jpg");
    expect(cleanFileName('a"b.png')).toBe("ab.png");
    expect(cleanFileName("   ")).toBe("imagem");
    expect(cleanFileName("x".repeat(400)).length).toBe(180);
  });
});

describe("processImage — fotos viram WebP", () => {
  it("JPEG 4000×3000 vira WebP com 2560 px de largura", async () => {
    const jpeg = await solid(4000, 3000).jpeg({ quality: 90 }).toBuffer();
    const out = await processImage({ name: "foto.jpg", data: jpeg });
    expect(out).toMatchObject({ ext: "webp", mime: "image/webp", width: 2560, height: 1920 });
    const meta = await metaOf(out.data);
    expect(meta).toMatchObject({ format: "webp", width: 2560, height: 1920 });
  });

  it("nunca aumenta imagens pequenas", async () => {
    const out = await processImage({ name: "logo.png", data: await solid(800, 600).png().toBuffer() });
    expect(out).toMatchObject({ ext: "webp", width: 800, height: 600 });
  });

  it("PNG com transparência continua transparente", async () => {
    const png = await solid(120, 80, { r: 0, g: 0, b: 0, alpha: 0 }, 4)
      .composite([
        { input: { create: { width: 40, height: 40, channels: 4, background: "#2980b9" } }, top: 20, left: 40 },
      ])
      .png()
      .toBuffer();
    const out = await processImage({ name: "selo.png", data: png });
    expect(out.ext).toBe("webp");
    expect((await metaOf(out.data)).hasAlpha).toBe(true);
    const { data, info } = await sharp(Buffer.from(out.data)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alphaAt = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
    expect(alphaAt(2, 2)).toBe(0); // canto transparente
    expect(alphaAt(60, 40)).toBe(255); // quadrado opaco no meio
  });

  it("aplica a rotação do EXIF e remove os metadados", async () => {
    // 400×300 com orientação 6 ("girar 90°") e dados de câmera: deve sair em pé, sem EXIF.
    const jpeg = await solid(400, 300)
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExif({ IFD0: { Make: "Camera Teste", Copyright: "Fulano" } })
      .toBuffer();
    const before = await metaOf(jpeg);
    expect(before.orientation).toBe(6);
    expect(before.exif).toBeDefined();

    const out = await processImage({ name: "celular.jpg", data: jpeg });
    expect(out).toMatchObject({ width: 300, height: 400 });
    const after = await metaOf(out.data);
    expect(after).toMatchObject({ width: 300, height: 400 });
    expect(after.orientation).toBeUndefined();
    expect(after.exif).toBeUndefined();
    expect(after.icc).toBeUndefined();
  });

  it("imagem muito alta respeita o limite do WebP (16383 px)", async () => {
    const tall = await solid(1000, 20_000).png({ compressionLevel: 1 }).toBuffer();
    const out = await processImage({ name: "pagina-inteira.png", data: tall });
    expect(out.height).toBeLessThanOrEqual(IMAGE_UPLOAD_LIMITS.maxHeight);
    expect(out.width).toBe(Math.round((1000 * 16_383) / 20_000));
  });

  it("GIF parado, WebP e AVIF também viram WebP", async () => {
    for (const [name, data] of [
      ["parado.gif", await solid(50, 40).gif().toBuffer()],
      ["foto.webp", await solid(3000, 1000).webp().toBuffer()],
      ["foto.avif", await solid(64, 48).avif().toBuffer()],
    ] as const) {
      const out = await processImage({ name, data });
      expect(out.ext, name).toBe("webp");
      expect((await metaOf(out.data)).format, name).toBe("webp");
    }
    const wide = await processImage({ name: "largo.webp", data: await solid(3000, 1000).webp().toBuffer() });
    expect(wide).toMatchObject({ width: 2560, height: 853 });
  });
});

describe("processImage — animações", () => {
  it("GIF animado sem metadados fica exatamente como veio", async () => {
    const gif = await animatedGif();
    expect((await metaOf(gif)).pages).toBe(3);
    const out = await processImage({ name: "animado.gif", data: gif });
    expect(out).toMatchObject({ ext: "gif", mime: "image/gif", width: 30, height: 20 });
    expect(Buffer.from(out.data).equals(gif)).toBe(true);
  });

  it("GIF animado perde o comentário (metadado do dono), mantendo os quadros", async () => {
    const gif = await animatedGif();
    // Injeta uma extensão de comentário com dados do dono antes do trailer (0x3B).
    expect(gif[gif.length - 1]).toBe(0x3b);
    const comment = Buffer.from("Dono: Joao Silva - joao@exemplo.com", "latin1");
    const ext = Buffer.concat([Buffer.from([0x21, 0xfe, comment.length]), comment, Buffer.from([0x00])]);
    const withComment = Buffer.concat([gif.subarray(0, gif.length - 1), ext, Buffer.from([0x3b])]);
    expect(withComment.includes("Joao Silva")).toBe(true);
    expect((await metaOf(withComment)).pages).toBe(3);

    const out = await processImage({ name: "animado.gif", data: withComment });
    expect(out).toMatchObject({ ext: "gif", mime: "image/gif" });
    // O comentário saiu; os 3 quadros ficaram; o arquivo ficou menor.
    expect(Buffer.from(out.data).includes("Joao Silva")).toBe(false);
    expect((await metaOf(out.data)).pages).toBe(3);
    expect(out.data.length).toBeLessThan(withComment.length);
  });

  it("WebP animado continua animado (e respeita a largura máxima)", async () => {
    const width = 3000;
    const frame = 60;
    const stacked = await solid(width, frame * 2, "#0000ff", 4)
      .composite([
        { input: { create: { width, height: frame, channels: 4, background: "#ff0000" } }, top: frame, left: 0 },
      ])
      .raw()
      .toBuffer();
    const webp = await sharp(stacked, { raw: { width, height: frame * 2, channels: 4, pageHeight: frame } })
      .webp({ loop: 0, delay: [120, 240] })
      .toBuffer();
    const out = await processImage({ name: "animado.webp", data: webp });
    expect(out).toMatchObject({ ext: "webp", width: 2560, height: 51 });
    const meta = await metaOf(out.data);
    expect(meta.pages).toBe(2);
    expect(meta.delay).toEqual([120, 240]);
  });
});

describe("processImage — erros em português", () => {
  it("arquivo acima de 15 MB", async () => {
    const big = Buffer.alloc(IMAGE_UPLOAD_LIMITS.maxFileBytes + 1);
    big.set([0xff, 0xd8, 0xff], 0);
    await expectAssetError(
      processImage({ name: "enorme.jpg", data: big }),
      413,
      /^"enorme\.jpg" tem 15,1 MB\. O limite é 15 MB por imagem\.$/,
    );
  });

  it("arquivo que não é imagem", async () => {
    await expectAssetError(
      processImage({ name: "planilha.xlsx", data: Buffer.from("PK\x03\x04 conteúdo") }),
      415,
      /^"planilha\.xlsx" não é uma imagem aceita\. Envie JPG, PNG, WebP, GIF, AVIF, SVG ou ICO\.$/,
    );
    await expectAssetError(
      processImage({ name: "vazio.png", data: Buffer.alloc(0) }),
      400,
      /^"vazio\.png" está vazio\.$/,
    );
    await expectAssetError(
      processImage({ name: "scan.tiff", data: await solid(4, 4).tiff().toBuffer() }),
      415,
      /não é uma imagem aceita/,
    );
  });

  it("foto HEIC do iPhone tem mensagem própria", async () => {
    const heicHeader = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from("ftypheic"),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from("mif1heic"),
      Buffer.alloc(64),
    ]);
    await expectAssetError(processImage({ name: "IMG_0001.HEIC", data: heicHeader }), 415, /formato HEIC/);
    await expectAssetError(processImage({ name: "sem-extensao", data: heicHeader }), 415, /formato HEIC/);
  });

  it("imagem corrompida", async () => {
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("isto não é um JPEG de verdade")]);
    await expectAssetError(
      processImage({ name: "quebrada.jpg", data: broken }),
      422,
      /^Não foi possível ler "quebrada\.jpg"\. O arquivo pode estar corrompido\.$/,
    );
  });

  it("resolução acima de 50 megapixels", async () => {
    const huge = await solid(8000, 8000).png({ compressionLevel: 9 }).toBuffer();
    expect(huge.byteLength).toBeLessThan(IMAGE_UPLOAD_LIMITS.maxFileBytes);
    await expectAssetError(processImage({ name: "gigante.png", data: huge }), 413, /resolução grande demais/);
  });
});

describe("sanitizeSvg / processImage com SVG", () => {
  const evil = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="https://mal.example/x.xsl"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:h="http://www.w3.org/1999/xhtml" viewBox="0 0 200 100" onload="alert(1)">
  <script>alert(2)</script>
  <h:script>alert(3)</h:script>
  <style>@import url(https://mal.example/a.css); .a{fill:red}</style>
  <foreignObject width="100" height="100"><body xmlns="http://www.w3.org/1999/xhtml"><iframe src="javascript:alert(4)"></iframe></body></foreignObject>
  <a xlink:href="javascript:alert(5)"><text x="0" y="20">clique</text></a>
  <a href=" jav&#x09;ascript:alert(6)"><rect class="a" width="10" height="10" onclick="alert(7)" onmouseover="alert(8)"/></a>
  <a href="https://exemplo.com/ok"><circle r="5" cx="50" cy="50"/></a>
  <image href="data:text/html;base64,PHNjcmlwdD5hbGVydCg5KTwvc2NyaXB0Pg==" width="10" height="10"/>
  <image href="data:image/png;base64,iVBORw0KGgo=" width="10" height="10"/>
  <animate attributeName="href" to="javascript:alert(10)"/>
  <set attributeName="onclick" to="alert(11)"/>
  <rect width="20" height="20" style="fill:blue"><animate attributeName="x" from="0" to="10" dur="1s"/></rect>
  <handler type="text/javascript">alert(12)</handler>
</svg>`;

  it("remove scripts, on*, javascript:, foreignObject e instruções XML", () => {
    const { svg } = sanitizeSvg(evil);
    expect(svg).not.toMatch(/<script|h:script|alert\((?:1|2|3|4|5|6|7|8|9|10|11|12)\)/);
    expect(svg).not.toMatch(/onload|onclick|onmouseover/i);
    expect(svg).not.toMatch(/javascript/i);
    expect(svg).not.toMatch(/foreignObject|iframe|handler|xml-stylesheet|@import|data:text\/html/i);
    expect(svg.startsWith("<svg")).toBe(true);
    // O que é legítimo continua.
    expect(svg).toContain('href="https://exemplo.com/ok"');
    expect(svg).toContain(".a{fill:red}");
    expect(svg).toContain('style="fill:blue"');
    expect(svg).toContain('attributeName="x"');
    expect(svg).toContain('href="data:image/png;base64,iVBORw0KGgo="');
    expect(svg).toContain(">clique</text>");
  });

  it("usa width/height ou o viewBox como medidas", () => {
    expect(sanitizeSvg(evil)).toMatchObject({ width: 200, height: 100 });
    expect(sanitizeSvg('<svg width="48px" height="24" viewBox="0 0 10 5"/>')).toMatchObject({ width: 48, height: 24 });
    expect(sanitizeSvg('<svg width="96" viewBox="0 0 10 5"/>')).toMatchObject({ width: 96, height: 48 });
    expect(sanitizeSvg('<svg width="1in" height="72pt"/>')).toMatchObject({ width: 96, height: 96 });
    expect(sanitizeSvg('<svg width="100%" height="100%"/>')).toMatchObject({ width: null, height: null });
  });

  it("completa o namespace que falta e expande as entidades do Illustrator", () => {
    const plain = sanitizeSvg('<svg viewBox="0 0 10 10"><use xlink:href="#a"/></svg>').svg;
    expect(plain).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(plain).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');

    const illustrator = `<?xml version="1.0"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [
  <!ENTITY ns_svg "http://www.w3.org/2000/svg">
  <!ENTITY ns_xlink "http://www.w3.org/1999/xlink">
  <!ENTITY bomba "&bomba;&bomba;">
]>
<svg version="1.1" xmlns="&ns_svg;" xmlns:xlink="&ns_xlink;" width="30" height="30"><text>&bomba;</text></svg>`;
    const out = sanitizeSvg(illustrator).svg;
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(out).not.toContain("DOCTYPE");
    expect(out).not.toMatch(/ENTITY/);
  });

  it("recusa arquivo sem <svg>", () => {
    expect(() => sanitizeSvg("<html><body>oi</body></html>", "falso.svg")).toThrow('"falso.svg" não é um SVG válido.');
  });

  it("processImage guarda o SVG limpo, que o sharp consegue ler", async () => {
    const out = await processImage({ name: "icone.svg", data: Buffer.from(evil) });
    expect(out).toMatchObject({ ext: "svg", mime: "image/svg+xml", width: 200, height: 100 });
    const text = Buffer.from(out.data).toString("utf8");
    expect(text).not.toMatch(/script|onload|javascript/i);
    const meta = await metaOf(out.data);
    expect(meta).toMatchObject({ format: "svg", width: 200, height: 100 });
  });

  it("upload de SVG: tira os metadados que identificam o dono (autor, programa, nome do arquivo)", async () => {
    const svg = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:cc="http://creativecommons.org/ns#" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.0.dtd" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="100" height="100" sodipodi:docname="logo-joao-silva.svg" inkscape:export-filename="/home/joaosilva/Área de Trabalho/logo.png">
  <title>Logo do João Silva</title>
  <desc>Criado por João Silva no Inkscape</desc>
  <metadata><rdf:RDF><cc:Work><dc:creator><cc:Agent><dc:title>João Silva</dc:title></cc:Agent></dc:creator></cc:Work></rdf:RDF></metadata>
  <sodipodi:namedview inkscape:current-layer="layer1"/>
  <rect x="10" y="10" width="80" height="80" fill="#ff0000"/>
</svg>`;
    const out = await processImage({ name: "logo.svg", data: Buffer.from(svg, "utf8") });
    expect(out).toMatchObject({ ext: "svg", mime: "image/svg+xml", width: 100, height: 100 });
    const text = Buffer.from(out.data).toString("utf8");
    // O desenho fica.
    expect(text).toContain("<rect");
    expect(text).toContain('fill="#ff0000"');
    // Nada que identifique o dono.
    for (const leak of [
      "João Silva",
      "joaosilva",
      "logo-joao-silva",
      "<metadata",
      "<title",
      "<desc",
      "sodipodi:docname",
      "inkscape:export-filename",
      "sodipodi:namedview",
      "xmlns:dc",
      "xmlns:cc",
      "xmlns:rdf",
      "xmlns:sodipodi",
      "xmlns:inkscape",
    ]) {
      expect(text, leak).not.toContain(leak);
    }
  });
});

describe("cleanClonedSvg — SVGs baixados na clonagem", () => {
  const svg = (inner: string, attrs = "") =>
    Buffer.from(
      `<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="10" height="10"${attrs}>${inner}</svg>`,
      "utf8",
    );

  it("SVG sem nada que rode código fica byte a byte igual (mesmo com foreignObject, estilo e comentário)", () => {
    const icons = [
      svg('<rect width="10" height="10" fill="red"/>'),
      svg(
        '<!-- logo --><style>@import url("https://fonts.example/x.css"); .a{fill:#000}</style><text class="a">Oi</text>',
      ),
      svg(
        '<foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">texto</div></foreignObject>',
      ),
      svg('<image href="data:image/svg+xml;base64,PHN2Zy8+" width="10" height="10"/>'),
      svg('<a xlink:href="https://site.com/"><circle r="4"/></a>'),
    ];
    for (const icon of icons) expect(cleanClonedSvg(icon)).toBe(icon);
  });

  it("tira script, on*, javascript:, data: que não é imagem, iframes e animações de href — e mantém o desenho", () => {
    const dirty = svg(
      [
        "<script>alert(1)</script>",
        '<style>.a{fill:#0a7}</style><rect class="a" width="10" height="10" onclick="x()"/>',
        '<a xlink:href="javascript:alert(2)"><text>Oi</text></a>',
        '<a href="data:text/html,<script>alert(3)</script>"><circle r="2"/></a>',
        '<foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml" onmouseover="y()">texto<iframe srcdoc="&lt;script&gt;alert(4)&lt;/script&gt;"></iframe></div></foreignObject>',
        '<a href="#"><set attributeName="href" to="javascript:alert(5)"/><animate attributeName="onclick" values="z()"/></a>',
        "<handler>alert(6)</handler>",
      ].join(""),
      ' onload="alert(0)"',
    );
    const out = cleanClonedSvg(dirty)?.toString("utf8") ?? "";
    expect(out).not.toMatch(/<script|<handler|<iframe|<set|<animate|\son[a-z]+=|javascript:|data:text/i);
    expect(out).toContain("<style>.a{fill:#0a7}</style>");
    expect(out).toContain('<rect class="a" width="10" height="10"/>');
    expect(out).toContain("<foreignObject");
    expect(out).toContain(">texto</div>");
    expect(out).toContain("<text>Oi</text>");
    // Continua um SVG que o Offer Studio reconhece e abre.
    expect(sniffImageFormat(Buffer.from(out))).toBe("svg");
    expect(sanitizeSvg(out).width).toBe(10);
  });

  it("<?xml-stylesheet?> (pode trazer XSLT) sai; o que não é SVG volta null (não pode ir como .svg)", () => {
    const xsl = Buffer.from('<?xml-stylesheet type="text/xsl" href="x.xsl"?><svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(cleanClonedSvg(xsl)?.toString("utf8")).not.toContain("xml-stylesheet");
    const notSvg = Buffer.from("<html><body><script>alert(1)</script></body></html>");
    expect(cleanClonedSvg(notSvg)).toBeNull();
    const gzip = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00]);
    expect(cleanClonedSvg(gzip)).toBeNull();
  });

  it("script escondido em entidade do DOCTYPE ou numa raiz que não é <svg>: nunca fica como veio", () => {
    const ns = 'xmlns="http://www.w3.org/2000/svg"';
    // O navegador expande &x; em marcação: o <script> só existe depois da expansão.
    const entity = Buffer.from(
      `<!DOCTYPE svg [<!ENTITY x "&#60;script&#62;window.name='X'&#60;/script&#62;">]><svg ${ns}>&x;<rect width="1" height="1"/></svg>`,
    );
    const parameter = Buffer.from(
      `<!DOCTYPE svg [<!ENTITY % p "<!ENTITY y '&#60;script&#62;window.name=1&#60;/script&#62;'>"> %p;]><svg ${ns}>&y;</svg>`,
    );
    for (const dirty of [entity, parameter]) {
      const out = cleanClonedSvg(dirty)?.toString("utf8") ?? "";
      expect(out).not.toBe(dirty.toString("utf8"));
      // Sem DOCTYPE, nada é expandido: o &x; vira texto (escapado), nunca marcação.
      expect(out).not.toMatch(/<!DOCTYPE|<!ENTITY|<script|&#60;script/i);
      expect(out).not.toMatch(/&[xy];/);
      expect(sniffImageFormat(Buffer.from(out))).toBe("svg");
    }
    // Raiz XHTML ou <g>: o navegador roda o <script> se o arquivo for servido como SVG.
    const xhtml = Buffer.from(`<html xmlns="http://www.w3.org/1999/xhtml"><script>window.name='X'</script></html>`);
    const group = Buffer.from(`<g ${ns}><script>window.name='X'</script></g>`);
    expect(cleanClonedSvg(xhtml)).toBeNull();
    expect(cleanClonedSvg(group)).toBeNull();
  });

  it("SVG do Illustrator (entidades simples no DOCTYPE): sai limpo e com o mesmo desenho", () => {
    const ai = Buffer.from(
      `<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [<!ENTITY ns_svg "http://www.w3.org/2000/svg"><!ENTITY ns_xlink "http://www.w3.org/1999/xlink">]><svg xmlns="&ns_svg;" xmlns:xlink="&ns_xlink;" width="10" height="10"><rect width="10" height="10" fill="#0a7"/></svg>`,
    );
    const out = cleanClonedSvg(ai)?.toString("utf8") ?? "";
    expect(out).not.toMatch(/<!DOCTYPE|&ns_/);
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out).toContain('<rect width="10" height="10" fill="#0a7"/>');
    expect(sanitizeSvg(out).width).toBe(10);
  });
});
