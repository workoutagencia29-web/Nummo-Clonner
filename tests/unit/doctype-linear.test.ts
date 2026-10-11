/**
 * Começo do HTML/SVG lido em tempo linear (src/lib/doctype.ts): antes, regex
 * com repetição aninhada levavam segundos (ou minutos) com algumas dezenas de
 * comentários no início da página ou de "<?…?>" num SVG — o robô, a prévia ou o
 * painel ficavam travados. Aqui: os mesmos resultados das regex antigas nos
 * casos normais (tabela de equivalência) e o tempo com os casos que travavam.
 */
import { describe, expect, it } from "vitest";
import { afterLeadingDoctype, doctypeOf, leadingDoctype, restoreDoctype, xmlProlog } from "@/lib/doctype";
import { insertEarlyHead } from "@/lib/export/head";
import { renderPageHtml } from "@/lib/page-render";
import { applySeo } from "@/lib/seo-render";
import { composeTrackingConfig } from "@/lib/tracking/compose";
import { injectAtHeadStart, injectTracking } from "@/lib/tracking/inject";
import { parseTrackingSettings } from "@/lib/tracking/schema";
import { sanitizeSvg, sniffImageFormat } from "@/server/services/assets";

// ─── Regex antigas (só para comparar nos casos normais, que eram rápidos) ────

const OLD_DOCTYPE_OF = /^﻿?(?:\s|<!--[\s\S]*?-->)*(<!doctype\b[^>]*>)/i;
const OLD_LEADING = /^(﻿?(?:\s|<!--[\s\S]*?-->)*)<!doctype\b[^>]*>[ \t]*\r?\n?/i;
const OLD_DOCTYPE_END = /^\s*(?:<!--[\s\S]*?-->\s*)*<!doctype[^>]*>/i;
const OLD_SVG_START =
  /^\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:(?:<!--[\s\S]*?-->|<!DOCTYPE[^[>]*(?:\[[\s\S]*?\])?\s*>|<\?[\s\S]*?\?>)\s*)*<(?:[a-z_][\w.-]*:)?svg[\s>/]/i;
const OLD_SUBSET = /<!DOCTYPE[^[>]*\[([\s\S]*?)\]\s*>/i;

function oldRestore(html: string, source: string) {
  const original = OLD_DOCTYPE_OF.exec(source)?.[1] ?? "";
  if (OLD_LEADING.test(html)) {
    return html.replace(OLD_LEADING, (_m, prolog: string) => (original ? `${prolog}${original}\n` : prolog));
  }
  return original ? `${original}\n${html}` : html;
}

const HTML_CASES: Record<string, string> = {
  padrão: "<!DOCTYPE html>\n<html><head></head><body>oi</body></html>",
  minúsculo: "<!doctype html><html><body>oi</body></html>",
  "antigo (quase-padrão)":
    '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">\r\n<html><body><table></table></body></html>',
  "comentários antes": "<!-- gerado pelo WordPress -->\n<!-- cache -->\n<!DOCTYPE html>\n<html><body>oi</body></html>",
  "comentário com -- dentro": "<!-- a -- b --><!doctype html><p>x</p>",
  BOM: "﻿<!DOCTYPE html>\n<html><body>oi</body></html>",
  "BOM e comentário": "﻿  <!-- x -->  <!DOCTYPE html>  \n<html></html>",
  "quirks (sem doctype)": '<html><head><meta charset="utf-8"></head><body><table></table></body></html>',
  "só comentário, sem doctype": "<!-- a --><html><body>oi</body></html>",
  "comentário que não fecha": "<!-- a <!DOCTYPE html><html></html>",
  "doctype que não fecha": "<!DOCTYPE html",
  "doctype depois de texto": "oi<!DOCTYPE html><html></html>",
  "doctypes (outra palavra)": "<!doctypes html><p>x</p>",
  vazio: "",
  "só espaços": "  \n\t ",
  "doctype com espaços e tab depois": "<!DOCTYPE html> \t\r\n\n<html></html>",
};

describe("HTML: mesmos resultados das regex antigas", () => {
  for (const [name, html] of Object.entries(HTML_CASES)) {
    it(name, () => {
      expect(doctypeOf(html)).toBe(OLD_DOCTYPE_OF.exec(html)?.[1] ?? "");
      // "<!doctypes" já não era doctype para o doctypeOf; agora também não é para o lugar do <head>.
      if (!html.startsWith("<!doctypes")) {
        expect(afterLeadingDoctype(html)).toBe(OLD_DOCTYPE_END.exec(html)?.[0].length ?? 0);
      }
      for (const source of Object.values(HTML_CASES)) {
        expect(restoreDoctype(html, source)).toBe(oldRestore(html, source));
      }
    });
  }

  it("leadingDoctype devolve início, fim e o texto", () => {
    const html = "<!-- x --> <!DOCTYPE html><html></html>";
    expect(leadingDoctype(html)).toEqual({ start: 11, end: 26, text: "<!DOCTYPE html>" });
    expect(leadingDoctype("<html></html>")).toBeNull();
  });

  it("o comentário termina no primeiro “-->”, como no navegador", () => {
    // A regex antiga esticava o comentário até achar um doctype mais adiante.
    const html = "<!-- a --> texto --> <!DOCTYPE html><html></html>";
    expect(doctypeOf(html)).toBe("");
    expect(afterLeadingDoctype(html)).toBe(0);
  });
});

// ─── SVG ─────────────────────────────────────────────────────────────────────

const ILLUSTRATOR = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generator: Adobe Illustrator 24.0.0, SVG Export Plug-In  -->
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [
	<!ENTITY ns_svg "http://www.w3.org/2000/svg">
	<!ENTITY ns_xlink "http://www.w3.org/1999/xlink">
]>
<svg version="1.1" xmlns="&ns_svg;" xmlns:xlink="&ns_xlink;" width="10" height="10"><rect width="10" height="10"/></svg>`;

const SVG_CASES: Record<string, string> = {
  simples: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
  "com <?xml?>": '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>',
  "comentários e estilo": '<?xml version="1.0"?><!-- a --><?xml-stylesheet href="a.css"?>\n<svg>',
  "DOCTYPE sem colchetes": '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd"><svg>',
  "DOCTYPE com entidades (Illustrator)": ILLUSTRATOR,
  "colchete com espaço antes do >": "<!DOCTYPE svg [ <!ENTITY a 'b'> ]  ><svg>",
  "colchete sem > logo depois": "<!DOCTYPE svg [ ] x ]><svg>",
  prefixo: '<svg:svg xmlns:svg="http://www.w3.org/2000/svg"></svg:svg>',
  "BOM e espaços": "﻿  \n<svg/>",
  HTML: "<!DOCTYPE html><html><body><svg></svg></body></html>",
  "<?…?> que não fecha": "<?xml version='1.0' <svg>",
  "DOCTYPE que não fecha": "<!DOCTYPE svg [ <svg>",
  "outra tag": "<svgx>",
  vazio: "",
};

describe("SVG: mesmos resultados da regex antiga", () => {
  for (const [name, text] of Object.entries(SVG_CASES)) {
    it(name, () => {
      expect(sniffImageFormat(Buffer.from(text, "utf8")) === "svg").toBe(OLD_SVG_START.test(text.replace(/^﻿/, "")));
    });
  }

  it("as entidades do Illustrator continuam expandidas (namespace certo)", () => {
    const { subset } = xmlProlog(ILLUSTRATOR).doctypes[0];
    expect(subset).toBe(OLD_SUBSET.exec(ILLUSTRATOR)?.[1]);
    const clean = sanitizeSvg(ILLUSTRATOR);
    expect(clean.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(clean.svg).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(clean.svg).not.toContain("&ns_svg;");
    expect(clean.width).toBe(10);
  });
});

// ─── Tempo ───────────────────────────────────────────────────────────────────

function timed(fn: () => unknown): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

/** 40 comentários no começo e nenhum doctype: antes, horas (dobrava a cada comentário). */
const MANY_COMMENTS = `${"<!-- c -->".repeat(40)}<p>oi</p>`;

describe("começo com muitos comentários não trava mais", () => {
  it("doctypeOf, restoreDoctype e o lugar do <head> em < 50 ms", () => {
    expect(timed(() => doctypeOf(MANY_COMMENTS))).toBeLessThan(50);
    expect(timed(() => restoreDoctype(MANY_COMMENTS, MANY_COMMENTS))).toBeLessThan(50);
    expect(timed(() => injectAtHeadStart(MANY_COMMENTS, "<x-a></x-a>"))).toBeLessThan(50);
    expect(timed(() => insertEarlyHead(MANY_COMMENTS, "<x-a></x-a>"))).toBeLessThan(50);
    expect(timed(() => applySeo(MANY_COMMENTS, { title: "Oferta", lang: "pt-BR" }))).toBeLessThan(50);
    // E o resultado continua certo: o <head> entra no começo (não há doctype).
    expect(injectAtHeadStart(MANY_COMMENTS, "<x-a></x-a>").startsWith("<head><x-a></x-a></head>")).toBe(true);
  });

  it("com doctype depois dos comentários: o <head> entra logo depois do doctype", () => {
    const html = `${"<!-- c -->".repeat(40)}<!DOCTYPE html><p>oi</p>`;
    const out = insertEarlyHead(html, "<x-a></x-a>");
    expect(out).toBe(`${"<!-- c -->".repeat(40)}<!DOCTYPE html><head><x-a></x-a></head><p>oi</p>`);
    expect(restoreDoctype(`<!DOCTYPE html>\n${html}`, html)).toBe(`<!DOCTYPE html>\n${html}`);
  });

  it("renderPageHtml (prévia com rastreamento e SEO) em < 50 ms", () => {
    const config = composeTrackingConfig({
      mode: "preview",
      settings: parseTrackingSettings({}),
      pixels: [{ vendor: "META", pixelId: "123456789012345", enabled: true, options: {} }],
      rules: [],
      links: [],
      pageId: null,
      policyUrl: null,
    });
    const render = () =>
      renderPageHtml(MANY_COMMENTS, {
        links: [],
        pageHref: () => "#",
        runtimeTag: '<script src="/os-runtime.js"></script>',
        seo: { title: "Oferta", lang: "pt-BR" },
        tracking: { config, scriptTag: '<script src="/os-tracking.js" data-os-tracking></script>' },
      });
    render(); // primeira chamada: carrega o que for preguiçoso
    expect(timed(render)).toBeLessThan(50);
    expect(timed(() => injectTracking(MANY_COMMENTS, config, "<script></script>"))).toBeLessThan(50);
  });

  it("SVG com '<?a?>' repetido: sniffImageFormat em < 50 ms", () => {
    const data = Buffer.from("<?a?>".repeat(40), "utf8");
    expect(timed(() => sniffImageFormat(data))).toBeLessThan(50);
    expect(sniffImageFormat(data)).toBeNull();
    // Com o <svg> no fim, continua reconhecido.
    expect(sniffImageFormat(Buffer.from(`${"<?a?>".repeat(40)}<svg/>`, "utf8"))).toBe("svg");
  });

  it("SVG de 1 MB com '<!DOCTYPE a[' repetido: a limpeza termina em < 200 ms", () => {
    const text = `${"<!DOCTYPE a[".repeat(Math.ceil((1024 * 1024) / 12))}<svg/>`;
    expect(text.length).toBeGreaterThan(1024 * 1024);
    let error: unknown;
    const ms = timed(() => {
      try {
        sanitizeSvg(text);
      } catch (err) {
        error = err;
      }
    });
    expect(ms).toBeLessThan(200);
    // Não é um SVG que o Offer Studio aceita (o DOCTYPE nunca fecha).
    expect(error).toBeInstanceOf(Error);
    expect(timed(() => xmlProlog(text))).toBeLessThan(50);
  });
});
