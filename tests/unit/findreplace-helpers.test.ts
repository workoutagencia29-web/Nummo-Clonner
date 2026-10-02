/**
 * Localizar e substituir / links: funções puras (src/lib/find-replace.ts).
 */
import { describe, expect, it } from "vitest";
import {
  adaptCase,
  applyLinkOp,
  applyLinkOpToHtml,
  applyLinkOpToProject,
  completeUrl,
  contextSnippet,
  createMatcher,
  destinationOf,
  foldText,
  isSearchableAttribute,
  linkKindOf,
  linkMatches,
  normalizeUrlKey,
  replaceAllText,
  replaceInHtml,
  replaceInProject,
  replaceRanges,
  walkProject,
} from "@/lib/find-replace";
import { classifyUrls } from "@/server/services/bulk-replace";

function matcher(query: string, accentInsensitive = false) {
  const m = createMatcher(query, { accentInsensitive });
  if (!m) throw new Error("busca vazia");
  return m;
}

describe("createMatcher", () => {
  it("não aceita busca vazia ou só com espaços", () => {
    expect(createMatcher("")).toBeNull();
    expect(createMatcher("   ")).toBeNull();
    expect(createMatcher("\n\t")).toBeNull();
  });

  it("ignora maiúsculas/minúsculas sempre", () => {
    expect(matcher("compre").ranges("COMPRE agora, Compre já")).toEqual([
      { start: 0, end: 6 },
      { start: 14, end: 20 },
    ]);
  });

  it("acentos só são ignorados com a opção ligada", () => {
    const text = "Promoção de AÇÃO: ação!";
    expect(matcher("acao").ranges(text)).toEqual([]);
    expect(matcher("ação").ranges(text)).toEqual([
      { start: 12, end: 16 },
      { start: 18, end: 22 },
    ]);
    const loose = matcher("acao", true);
    expect(loose.ranges(text)).toEqual([
      { start: 12, end: 16 },
      { start: 18, end: 22 },
    ]);
    // Também no sentido contrário: busca acentuada acha texto sem acento.
    expect(matcher("promoção", true).ranges("PROMOCAO")).toEqual([{ start: 0, end: 8 }]);
    expect(foldText("Ação Çé", true)).toBe("acao ce");
  });

  it("devolve posições do texto original com acentos decompostos e emojis", () => {
    const decomposed = "café com leite";
    const [hit] = matcher("café", true).ranges(decomposed);
    // O acento solto fica junto da letra (a troca não deixa acento pendurado).
    expect(hit).toEqual({ start: 0, end: 5 });
    expect(replaceRanges(decomposed, [hit], "chá")).toBe("chá com leite");
    // Sem a opção, "e" não casa com metade de um "é" decomposto.
    expect(matcher("cafe").ranges(decomposed)).toEqual([]);

    const emoji = "🔥 Oferta 🔥 oferta";
    expect(matcher("oferta").ranges(emoji)).toEqual([
      { start: 3, end: 9 },
      { start: 13, end: 19 },
    ]);
  });

  it("não sobrepõe ocorrências", () => {
    expect(matcher("aa").ranges("aaaa a")).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
    expect(replaceAllText("aaa", matcher("aa"), "b")).toEqual({ text: "ba", count: 1 });
  });

  it("troca mantendo o resto do texto (o texto novo é literal)", () => {
    const r = replaceAllText("Compre JÁ! compre já.", matcher("compre já"), "Garanta $1 & \\n");
    expect(r).toEqual({ text: "Garanta $1 & \\n! Garanta $1 & \\n.", count: 2 });
  });
});

describe("manter maiúsculas", () => {
  it("adaptCase segue o trecho encontrado", () => {
    expect(adaptCase("COMPRE", "garanta já")).toBe("GARANTA JÁ");
    expect(adaptCase("Compre", "garanta já")).toBe("Garanta já");
    expect(adaptCase("compre", "Garanta")).toBe("Garanta");
    expect(adaptCase("cOMPRE", "garanta")).toBe("garanta");
    expect(adaptCase("A", "garanta")).toBe("Garanta");
    expect(adaptCase("Ação", "ótimo")).toBe("Ótimo");
    expect(adaptCase("R$ 97", "r$ 47")).toBe("R$ 47");
    expect(adaptCase("123", "abc")).toBe("abc");
    expect(adaptCase("COMPRE", "")).toBe("");
    expect(adaptCase("Compre", "  garanta")).toBe("  Garanta");
    expect(adaptCase("Compre", "3x sem juros")).toBe("3x sem juros");
  });

  it("vale para textos, nunca para endereços", async () => {
    const m = createMatcher("compre", { preserveCase: true });
    if (!m) throw new Error("busca vazia");
    const html =
      '<p>COMPRE já. Compre hoje. compre</p><a href="https://x.com/?c=Compre" title="Compre agora">x</a><img src="/Compre.png" alt="COMPRE">';
    const r = await replaceInHtml(html, m, "garanta", undefined, { fragment: true });
    expect(r.html).toBe(
      '<p>GARANTA já. Garanta hoje. garanta</p><a href="https://x.com/?c=garanta" title="Garanta agora">x</a><img src="/garanta.png" alt="GARANTA">',
    );
    // Sem a opção, o texto novo entra como foi digitado.
    expect(replaceAllText("COMPRE", matcher("compre"), "garanta").text).toBe("garanta");
  });
});

describe("contextSnippet", () => {
  it("mostra o trecho em volta, cortando em palavras inteiras", () => {
    const text = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.";
    const [range] = matcher("adipiscing").ranges(text);
    const s = contextSnippet(text, range, 20);
    expect(s.match).toBe("adipiscing");
    expect(s.before.startsWith("…")).toBe(true);
    expect(s.after.endsWith("…")).toBe(true);
    expect(`${s.before}${s.match}${s.after}`).toBe("…amet, consectetur adipiscing elit, sed do…");
  });

  it("junta espaços e quebras de linha", () => {
    const s = contextSnippet("a\n\n   b", { start: 6, end: 7 });
    expect(s).toEqual({ before: "a ", match: "b", after: "" });
  });
});

describe("isSearchableAttribute", () => {
  it("só os atributos de conteúdo (e value em botões)", () => {
    for (const name of ["href", "data-os-href", "src", "alt", "title", "action", "placeholder", "HREF"]) {
      expect(isSearchableAttribute("a", name, {})).toBe(true);
    }
    for (const name of [
      "class",
      "id",
      "style",
      "data-os-link",
      "data-os-attrs",
      "onclick",
      "data-os-on-click",
      "type",
    ]) {
      expect(isSearchableAttribute("a", name, {})).toBe(false);
    }
    expect(isSearchableAttribute("input", "value", { type: "submit" })).toBe(true);
    expect(isSearchableAttribute("input", "value", { type: "hidden" })).toBe(false);
    expect(isSearchableAttribute("input", "value", {})).toBe(false);
  });
});

const PAGE = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Compre o Método</title>
<link rel="stylesheet" href="/os-assets/compre.css" data-os-base>
<style data-os-edits>.compre{color:red}</style></head>
<body class="compre">
<div class="compre" id="compre" data-compre="compre" style="--x: compre">
  <h1>Compre o Método &amp; ganhe bônus</h1>
  <a href="https://pay.hotmart.com/X?off=compre" title="Compre agora" data-os-link="compre">Compre</a>
  <img src="/os-assets/compre.png" alt="Compre hoje">
  <form action="https://x.com/compre"><input placeholder="Compre seu nome"><input type="submit" value="Compre">
  <input type="hidden" name="compre" value="compre"></form>
  <button data-os-href="https://pay.kiwify.com.br/compre" onclick="compre()">Quero</button>
  <!-- compre -->
  <script>var compre = "Compre";</script>
  <noscript><img src="compre.gif"></noscript>
</div>
</body></html>`;

describe("replaceInHtml", () => {
  it("troca textos e atributos de conteúdo, nunca tags, nomes de atributos, código ou <head>", async () => {
    const r = await replaceInHtml(PAGE, matcher("compre"), "LEVE");
    // h1, href, title, a (texto), src, alt, action, placeholder, value do botão, data-os-href
    expect(r.count).toBe(10);
    expect(r.html).toContain("<h1>LEVE o Método &amp; ganhe bônus</h1>");
    expect(r.html).toContain(
      'href="https://pay.hotmart.com/X?off=LEVE" title="LEVE agora" data-os-link="compre">LEVE</a>',
    );
    expect(r.html).toContain('<img src="/os-assets/LEVE.png" alt="LEVE hoje">');
    expect(r.html).toContain('action="https://x.com/LEVE"');
    expect(r.html).toContain('placeholder="LEVE seu nome"');
    expect(r.html).toContain('<input type="submit" value="LEVE">');
    expect(r.html).toContain('<input type="hidden" name="compre" value="compre">');
    expect(r.html).toContain('data-os-href="https://pay.kiwify.com.br/LEVE" onclick="compre()"');
    // Intactos: head, classes, ids, estilos, data-*, comentários, scripts, noscript.
    expect(r.html).toContain("<title>Compre o Método</title>");
    expect(r.html).toContain('href="/os-assets/compre.css"');
    expect(r.html).toContain(".compre{color:red}");
    expect(r.html).toContain('<body class="compre">');
    expect(r.html).toContain('<div class="compre" id="compre" data-compre="compre" style="--x: compre">');
    expect(r.html).toContain("<!-- compre -->");
    expect(r.html).toContain('<script>var compre = "Compre";</script>');
    expect(r.html).toContain('<noscript><img src="compre.gif"></noscript>');
  });

  it("não troca dentro de nomes de tags nem de atributos", async () => {
    const html =
      '<!doctype html><html><head></head><body><div title="div">div <span>span</span></div><a href="href">href</a></body></html>';
    const tags = await replaceInHtml(html, matcher("div"), "section");
    expect(tags.html).toContain('<div title="section">section <span>span</span></div>');
    const attrs = await replaceInHtml(html, matcher("href"), "x");
    expect(attrs.html).toContain('<a href="x">x</a>');
    expect(attrs.count).toBe(2);
  });

  it("procura no texto já decodificado e escapa o texto novo", async () => {
    const html = "<p>Arroz &amp; feij&atilde;o</p>";
    const r = await replaceInHtml(html, matcher("arroz & feijao", true), "<b>Pão</b> & café", undefined, {
      fragment: true,
    });
    expect(r.count).toBe(1);
    expect(r.html).toBe("<p>&lt;b&gt;Pão&lt;/b&gt; &amp; café</p>");
  });

  it("respeita os alvos (só textos / só atributos)", async () => {
    const html = '<a href="https://a.com/oferta" title="oferta">oferta</a>';
    const onlyText = await replaceInHtml(
      html,
      matcher("oferta"),
      "x",
      { text: true, attributes: false },
      { fragment: true },
    );
    expect(onlyText.html).toBe('<a href="https://a.com/oferta" title="oferta">x</a>');
    const onlyAttrs = await replaceInHtml(
      html,
      matcher("oferta"),
      "x",
      { text: false, attributes: true },
      { fragment: true },
    );
    expect(onlyAttrs.html).toBe('<a href="https://a.com/x" title="x">oferta</a>');
  });

  it("sem ocorrências devolve o HTML original intacto", async () => {
    const html = "<P CLASS=a>Olá&nbsp;mundo</P>";
    const r = await replaceInHtml(html, matcher("inexistente"), "x", undefined, { fragment: true });
    expect(r).toEqual({ html, count: 0 });
  });
});

/** Projeto no formato salvo pelo GrapesJS 0.23 (getProjectData). */
function sampleProject() {
  return {
    dataSources: [],
    assets: [{ type: "image", src: "/os-assets/compre.png" }],
    styles: [{ selectors: ["compre"], style: { color: "red" } }],
    pages: [
      {
        id: "p1",
        type: "main",
        frames: [
          {
            id: "f1",
            component: {
              type: "wrapper",
              attributes: { title: "compre" },
              components: [
                {
                  tagName: "header",
                  classes: ["compre"],
                  attributes: { id: "compre", "data-compre": "compre" },
                  components: [
                    {
                      type: "link",
                      attributes: {
                        href: "https://pay.hotmart.com/X?off=1",
                        title: "Compre agora",
                        "data-os-link": "compre",
                      },
                      components: [
                        { type: "textnode", content: "Compre " },
                        { tagName: "b", type: "text", components: [{ type: "textnode", content: "já" }] },
                        { type: "textnode", content: ' & "economize"' },
                      ],
                    },
                  ],
                },
                { type: "image", attributes: { src: "/os-assets/compre.png", alt: "Compre hoje" } },
                {
                  type: "image",
                  src: "/os-assets/novo-compre.png",
                  attributes: { src: "/os-assets/velho-compre.png" },
                },
                {
                  type: "os-script",
                  attributes: { hidden: true, "data-os-attrs": '{"src":"compre.js"}' },
                  components: [{ type: "textnode", content: 'var compre = "Compre";' }],
                },
                { type: "comment", content: " compre " },
                { tagName: "p", type: "text", content: 'Compre <i title="compre">agora</i> &amp; já' },
                { tagName: "section", components: '<p class="compre">Compre</p>' },
                { tagName: "input", void: true, attributes: { type: "submit", value: "Compre" } },
                { type: "text", tagName: "components", components: [{ type: "textnode", content: "components" }] },
              ],
              head: {
                type: "head",
                components: [{ tagName: "title", components: [{ type: "textnode", content: "Compre" }] }],
              },
              docEl: { tagName: "html" },
            },
          },
        ],
      },
    ],
    symbols: [],
  };
}

describe("replaceInProject", () => {
  it("troca só valores de texto conhecidos e o JSON continua válido", async () => {
    const original = sampleProject();
    const snapshot = JSON.stringify(original);
    const r = await replaceInProject(original, matcher("compre"), 'Le"ve\\ </script>');

    // O objeto recebido não muda.
    expect(JSON.stringify(original)).toBe(snapshot);
    // Continua serializável e igual depois de ida e volta.
    const json = JSON.stringify(r.project);
    expect(JSON.parse(json)).toEqual(r.project);

    const project = r.project as ReturnType<typeof sampleProject>;
    const wrapper = project.pages[0].frames[0].component;
    const [header, img1, img2, script, comment, p, section, input] = wrapper.components as never as Record<
      string,
      never
    >[];
    const link = (header.components as Record<string, unknown>[])[0] as {
      attributes: Record<string, string>;
      components: { content?: string }[];
    };
    expect(link.attributes).toEqual({
      href: "https://pay.hotmart.com/X?off=1",
      title: 'Le"ve\\ </script> agora',
      "data-os-link": "compre",
    });
    expect(link.components[0].content).toBe('Le"ve\\ </script> ');
    expect(link.components[2].content).toBe(' & "economize"');
    // Classes, ids e data-* intactos.
    expect(header).toMatchObject({ classes: ["compre"], attributes: { id: "compre", "data-compre": "compre" } });
    expect(img1).toMatchObject({
      attributes: { src: '/os-assets/Le"ve\\ </script>.png', alt: 'Le"ve\\ </script> hoje' },
    });
    expect(img2).toMatchObject({
      src: '/os-assets/novo-Le"ve\\ </script>.png',
      attributes: { src: '/os-assets/velho-Le"ve\\ </script>.png' },
    });
    // Código, comentários, <head>, estilos e o próprio wrapper ficam como estavam.
    expect(script).toEqual(sampleProject().pages[0].frames[0].component.components[3]);
    expect(comment).toEqual({ type: "comment", content: " compre " });
    expect(wrapper.head).toEqual(sampleProject().pages[0].frames[0].component.head);
    expect(wrapper.attributes).toEqual({ title: "compre" });
    expect(project.styles).toEqual(sampleProject().styles);
    expect(project.assets).toEqual(sampleProject().assets);
    // HTML guardado como texto: troca dentro dos textos e atributos, escapando.
    expect(p).toMatchObject({
      content: 'Le"ve\\ &lt;/script&gt; <i title="Le&quot;ve\\ </script>">agora</i> &amp; já',
    });
    expect(section).toMatchObject({ components: '<p class="compre">Le"ve\\ &lt;/script&gt;</p>' });
    expect(input).toMatchObject({ attributes: { type: "submit", value: 'Le"ve\\ </script>' } });

    // link title + link texto + img src + img alt + img2 src (conta uma vez) + p (2) + section + input
    expect(r.count).toBe(9);
  });

  it("nunca mexe em chaves nem em tipos/tagName", async () => {
    const r = await replaceInProject(sampleProject(), matcher("components"), "x");
    const wrapper = (r.project as ReturnType<typeof sampleProject>).pages[0].frames[0].component;
    const last = wrapper.components[8] as { tagName: string; components: { content: string }[] };
    expect(last.tagName).toBe("components");
    expect(last.components[0].content).toBe("x");
    expect(r.count).toBe(1);
    expect(Object.keys(wrapper)).toEqual(["type", "attributes", "components", "head", "docEl"]);
  });

  it("aceita projeto vazio ou estranho sem quebrar", async () => {
    expect((await replaceInProject(null, matcher("a"), "b")).count).toBe(0);
    expect((await replaceInProject({ pages: "x" }, matcher("a"), "b")).count).toBe(0);
    const r = await replaceInProject({ pages: [{ frames: [{ component: "<p>abc</p>" }] }] }, matcher("b"), "X");
    expect(r).toEqual({ project: { pages: [{ frames: [{ component: "<p>aXc</p>" }] }] }, count: 1 });
  });

  it("walkProject percorre páginas e símbolos, pulando scripts e o <head>", () => {
    const seen: string[] = [];
    walkProject(
      { ...sampleProject(), symbols: [{ tagName: "footer", components: [{ type: "textnode", content: "s" }] }] },
      {
        component(_node, tag, type) {
          seen.push(type || tag);
        },
      },
    );
    expect(seen).toContain("footer");
    expect(seen).not.toContain("os-script");
    expect(seen).not.toContain("wrapper");
    expect(seen).not.toContain("title");
    expect(seen).not.toContain("comment");
  });
});

describe("normalizeUrlKey", () => {
  it("agrupa variações do mesmo endereço", () => {
    const same = [
      "https://Pay.Hotmart.com/X?off=1",
      "  https://pay.hotmart.com/X?off=1 ",
      "https://pay.hotmart.com:443/X?off=1",
      "//pay.hotmart.com/X?off=1",
      "HTTPS://PAY.HOTMART.COM/X?off=1",
    ];
    expect(new Set(same.map(normalizeUrlKey))).toEqual(new Set(["https://pay.hotmart.com/X?off=1"]));
    expect(normalizeUrlKey("https://x.com")).toBe(normalizeUrlKey("https://x.com/"));
    // Caminho e query diferenciam maiúsculas (são endereços diferentes).
    expect(normalizeUrlKey("https://x.com/A")).not.toBe(normalizeUrlKey("https://x.com/a"));
    expect(normalizeUrlKey("https://x.com/a?b=1")).not.toBe(normalizeUrlKey("https://x.com/a?b=2"));
    expect(normalizeUrlKey("http://x.com/")).not.toBe(normalizeUrlKey("https://x.com/"));
  });

  it("mantém âncoras, páginas do funil, relativos e esquemas especiais", () => {
    expect(normalizeUrlKey(" #oferta ")).toBe("#oferta");
    expect(normalizeUrlKey("OS-PAGE:clx123")).toBe("os-page:clx123");
    expect(normalizeUrlKey("/obrigado")).toBe("/obrigado");
    expect(normalizeUrlKey("MAILTO:Contato@X.com")).toBe("mailto:Contato@X.com");
    expect(normalizeUrlKey("tel:+5511999999999")).toBe("tel:+5511999999999");
    expect(normalizeUrlKey("")).toBe("");
  });
});

describe("destinos de clique", () => {
  it("destinationOf segue a mesma prioridade do runtime", () => {
    expect(destinationOf("a", { href: "https://a.com" })).toEqual({ attr: "href", url: "https://a.com" });
    expect(destinationOf("a", { href: "#", "data-os-href": "https://b.com" })).toEqual({
      attr: "data-os-href",
      url: "https://b.com",
    });
    expect(destinationOf("a", { href: "javascript:void(0)" })).toBeNull();
    expect(destinationOf("a", { href: "#" })).toBeNull();
    expect(destinationOf("a", { href: "#oferta" })).toEqual({ attr: "href", url: "#oferta" });
    expect(destinationOf("form", { action: "https://f.com" })).toEqual({ attr: "action", url: "https://f.com" });
    expect(destinationOf("button", { "data-os-href": " https://c.com " })).toEqual({
      attr: "data-os-href",
      url: "https://c.com",
    });
    expect(destinationOf("div", { href: "https://ignored.com" })).toBeNull();
    expect(destinationOf("a", { href: true })).toBeNull();
  });

  it("linkKindOf reconhece o tipo pelo endereço", () => {
    expect(linkKindOf("os-page:clx1")).toBe("funnel-page");
    expect(linkKindOf("#topo")).toBe("anchor");
    expect(linkKindOf("mailto:a@b.com")).toBe("email");
    expect(linkKindOf("tel:1")).toBe("phone");
    expect(linkKindOf("https://wa.me/55")).toBe("url");
  });

  it("linkMatches: por endereço só pega elementos sem link da oferta", () => {
    const match = { kind: "url", url: "https://PAY.hotmart.com/X" } as const;
    expect(linkMatches("a", { href: "https://pay.hotmart.com/X" }, match)).toBe(true);
    expect(linkMatches("a", { href: "https://pay.hotmart.com/X", "data-os-link": "checkout" }, match)).toBe(false);
    expect(
      linkMatches(
        "a",
        { href: "https://pay.hotmart.com/X", "data-os-link": "checkout" },
        { kind: "link", key: "checkout" },
      ),
    ).toBe(true);
    expect(linkMatches("a", { href: "https://pay.hotmart.com/Y" }, match)).toBe(false);
  });

  it("applyLinkOp liga, troca e desliga", () => {
    const attrs: Record<string, unknown> = { href: "https://a.com" };
    expect(applyLinkOp("a", attrs, { type: "bind", key: "checkout" })).toBe(true);
    expect(applyLinkOp("a", attrs, { type: "bind", key: "checkout" })).toBe(false);
    expect(attrs).toEqual({ href: "https://a.com", "data-os-link": "checkout" });
    expect(applyLinkOp("a", attrs, { type: "unbind", url: "https://b.com" })).toBe(true);
    expect(attrs).toEqual({ href: "https://b.com" });
    expect(applyLinkOp("a", attrs, { type: "set-url", url: "https://c.com" })).toBe(true);
    expect(attrs).toEqual({ href: "https://c.com" });

    const button: Record<string, unknown> = {};
    applyLinkOp("button", button, { type: "set-url", url: "https://d.com" });
    expect(button).toEqual({ "data-os-href": "https://d.com" });
    const form: Record<string, unknown> = { "data-os-link": "x" };
    applyLinkOp("form", form, { type: "unbind", url: "https://e.com" });
    expect(form).toEqual({ action: "https://e.com" });
  });

  it("applyLinkOpToHtml liga todos os elementos do mesmo endereço (normalizado)", async () => {
    const html = `<!doctype html><html><head><link rel="canonical" href="https://pay.hotmart.com/X"></head><body>
      <a href="https://Pay.Hotmart.com/X">Comprar</a>
      <a href="//pay.hotmart.com/X" data-os-link="outro">Já ligado</a>
      <button data-os-href="https://pay.hotmart.com:443/X">Quero</button>
      <a href="https://pay.hotmart.com/Y">Outro</a></body></html>`;
    const r = await applyLinkOpToHtml(
      html,
      { kind: "url", url: "https://pay.hotmart.com/X" },
      { type: "bind", key: "checkout" },
    );
    expect(r.count).toBe(2);
    expect(r.html).toContain('<a href="https://Pay.Hotmart.com/X" data-os-link="checkout">Comprar</a>');
    expect(r.html).toContain('<a href="//pay.hotmart.com/X" data-os-link="outro">Já ligado</a>');
    expect(r.html).toContain(
      '<button data-os-href="https://pay.hotmart.com:443/X" data-os-link="checkout">Quero</button>',
    );
    expect(r.html).toContain('<a href="https://pay.hotmart.com/Y">Outro</a>');
    expect(r.html).toContain('<link rel="canonical" href="https://pay.hotmart.com/X">');

    const none = await applyLinkOpToHtml(html, { kind: "url", url: "https://nada.com" }, { type: "bind", key: "k" });
    expect(none).toEqual({ html, count: 0 });
  });

  it("applyLinkOpToProject muda só os atributos dos componentes certos", () => {
    const project = {
      pages: [
        {
          frames: [
            {
              component: {
                type: "wrapper",
                components: [
                  { type: "link", attributes: { href: "https://pay.kiwify.com.br/abc" } },
                  { tagName: "button", attributes: { "data-os-href": "https://PAY.kiwify.com.br/abc" } },
                  { tagName: "div", attributes: { href: "https://pay.kiwify.com.br/abc" } },
                  { tagName: "form", attributes: { action: "https://pay.kiwify.com.br/abc", "data-os-link": "velho" } },
                ],
              },
            },
          ],
        },
      ],
    };
    const bound = applyLinkOpToProject(
      project,
      { kind: "url", url: "https://pay.kiwify.com.br/abc" },
      { type: "bind", key: "checkout" },
    );
    expect(bound.count).toBe(2);
    const comps = (bound.project as typeof project).pages[0].frames[0].component.components;
    expect(comps.map((c) => c.attributes["data-os-link" as never])).toEqual([
      "checkout",
      "checkout",
      undefined,
      "velho",
    ]);
    // O original não muda.
    expect(project.pages[0].frames[0].component.components[0].attributes).toEqual({
      href: "https://pay.kiwify.com.br/abc",
    });

    const unbound = applyLinkOpToProject(
      project,
      { kind: "link", key: "velho" },
      { type: "unbind", url: "https://novo.com" },
    );
    expect(unbound.count).toBe(1);
    expect((unbound.project as typeof project).pages[0].frames[0].component.components[3].attributes).toEqual({
      action: "https://novo.com",
    });
  });
});

describe("completeUrl", () => {
  it("completa endereços digitados sem https://", () => {
    expect(completeUrl(" pay.hotmart.com/X ")).toBe("https://pay.hotmart.com/X");
    expect(completeUrl("//x.com/a")).toBe("https://x.com/a");
    expect(completeUrl("https://x.com")).toBe("https://x.com");
    expect(completeUrl("wa.me/5511999999999")).toBe("https://wa.me/5511999999999");
    expect(completeUrl("#oferta")).toBe("#oferta");
    expect(completeUrl("/obrigado")).toBe("/obrigado");
    expect(completeUrl("mailto:a@b.com")).toBe("mailto:a@b.com");
    expect(completeUrl("os-page:clx1")).toBe("os-page:clx1");
    expect(completeUrl("obrigado")).toBe("obrigado");
    expect(completeUrl("")).toBe("");
  });
});

describe("classifyUrls", () => {
  it("reconhece checkouts e WhatsApp", () => {
    const r = classifyUrls([
      "https://pay.hotmart.com/X?off=1",
      "https://pay.kiwify.com.br/abc",
      "https://wa.me/5511999999999",
      "https://api.whatsapp.com/send?phone=55",
      "https://google.com",
      "/obrigado",
      "os-page:clx1",
      "//pay.hotmart.com/Y",
    ]);
    expect(r["https://pay.hotmart.com/X?off=1"]).toEqual({ kind: "checkout", platform: "Hotmart" });
    expect(r["https://pay.kiwify.com.br/abc"]).toEqual({ kind: "checkout", platform: "Kiwify" });
    expect(r["https://wa.me/5511999999999"]).toEqual({ kind: "whatsapp", platform: null });
    expect(r["https://api.whatsapp.com/send?phone=55"]).toEqual({ kind: "whatsapp", platform: null });
    expect(r["https://google.com"]).toEqual({ kind: "other", platform: null });
    expect(r["/obrigado"]).toEqual({ kind: "other", platform: null });
    expect(r["os-page:clx1"]).toEqual({ kind: "other", platform: null });
    expect(r["//pay.hotmart.com/Y"]).toEqual({ kind: "checkout", platform: "Hotmart" });
  });
});
