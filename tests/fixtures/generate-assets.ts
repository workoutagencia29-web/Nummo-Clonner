/**
 * Gera os arquivos binários e gerados dos sites de teste (rode uma vez e
 * guarde o resultado junto com o código):
 *
 *   npx tsx tests/fixtures/generate-assets.ts
 *
 * - imagens PNG/JPG/WebP/GIF feitas com sharp a partir de SVG;
 * - fonte woff2 real copiada de @fontsource-variable/inter;
 * - MP4 mínimo (só precisa ser servido);
 * - site "legado" inteiro em ISO-8859-1 (bytes Latin-1 de verdade) e o hash
 *   sha384 do atributo integrity;
 * - site "grande" (~3000 elementos e ~2000 regras de CSS).
 *
 * É determinístico: rodar de novo produz os mesmos arquivos.
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const FIXTURES_DIR = path.dirname(fileURLToPath(import.meta.url));
const SITES_DIR = path.join(FIXTURES_DIR, "sites");
const REPO_ROOT = path.resolve(FIXTURES_DIR, "../..");
const FONT_SRC = path.join(REPO_ROOT, "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2");

function out(site: string, rel: string): string {
  const file = path.join(SITES_DIR, site, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  return file;
}

function write(site: string, rel: string, data: Buffer | string): void {
  writeFileSync(out(site, rel), data);
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── Imagens ────────────────────────────────────────────────────────────────

interface ImageSpec {
  w: number;
  h: number;
  /** Cores do degradê (de cima para baixo). */
  colors: [string, string];
  label?: string;
  labelColor?: string;
  /** Desenho extra: círculo central, bolinhas repetidas ou "check". */
  shape?: "circle" | "dots" | "check" | "arrow";
}

function svgFor(spec: ImageSpec): string {
  const { w, h, colors, label, labelColor = "#ffffff", shape } = spec;
  const min = Math.min(w, h);
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs>`,
    `<rect width="${w}" height="${h}" fill="url(#g)"/>`,
  ];
  if (shape === "circle") {
    parts.push(
      `<circle cx="${w / 2}" cy="${h / 2}" r="${min * 0.42}" fill="none" stroke="#ffffff" stroke-width="${Math.max(1, min * 0.05)}"/>`,
    );
  } else if (shape === "dots") {
    const r = Math.max(1, min * 0.08);
    parts.push(`<circle cx="${w / 4}" cy="${h / 4}" r="${r}" fill="#ffffff" fill-opacity="0.35"/>`);
    parts.push(`<circle cx="${(3 * w) / 4}" cy="${(3 * h) / 4}" r="${r}" fill="#ffffff" fill-opacity="0.35"/>`);
  } else if (shape === "check") {
    parts.push(
      `<polyline points="${w * 0.25},${h * 0.52} ${w * 0.43},${h * 0.7} ${w * 0.76},${h * 0.32}" fill="none" stroke="#ffffff" stroke-width="${min * 0.1}" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
  } else if (shape === "arrow") {
    parts.push(
      `<polyline points="${w * 0.35},${h * 0.2} ${w * 0.7},${h * 0.5} ${w * 0.35},${h * 0.8}" fill="none" stroke="${labelColor}" stroke-width="${min * 0.14}" stroke-linecap="round"/>`,
    );
  }
  if (label) {
    const size = Math.max(8, Math.min(h * 0.22, (w * 1.6) / Math.max(label.length, 4)));
    parts.push(
      `<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="bold" font-size="${size.toFixed(1)}" fill="${labelColor}">${escapeXml(label)}</text>`,
    );
  }
  parts.push("</svg>");
  return parts.join("");
}

async function image(site: string, rel: string, spec: ImageSpec): Promise<void> {
  const ext = path.extname(rel).toLowerCase();
  let pipeline = sharp(Buffer.from(svgFor(spec)));
  if (ext === ".jpg" || ext === ".jpeg") pipeline = pipeline.jpeg({ quality: 70 });
  else if (ext === ".png") pipeline = pipeline.png({ compressionLevel: 9 });
  else if (ext === ".webp") pipeline = pipeline.webp({ quality: 70 });
  else if (ext === ".gif") pipeline = pipeline.gif();
  else throw new Error(`Extensão de imagem não suportada: ${rel}`);
  write(site, rel, await pipeline.toBuffer());
}

const MARROM: [string, string] = ["#8d5524", "#3b1f0e"];
const ROSA: [string, string] = ["#f783ac", "#c2255c"];
const VERDE: [string, string] = ["#69db7c", "#2b8a3e"];
const AZUL: [string, string] = ["#74c0fc", "#1864ab"];
const LARANJA: [string, string] = ["#ffc078", "#e8590c"];
const ROXO: [string, string] = ["#b197fc", "#5f3dc4"];
const ESCURO: [string, string] = ["#343a40", "#101113"];
const CAFE: [string, string] = ["#a1887f", "#3e2723"];

async function vendasImages(): Promise<void> {
  const up = "wp-content/uploads/2024/05";
  const s = "vendas";
  await image(s, "wp-content/themes/oferta/assets/img/hero-bg.jpg", {
    w: 1600,
    h: 800,
    colors: MARROM,
    shape: "dots",
  });
  await image(s, "wp-content/themes/oferta/assets/img/pattern.png", { w: 40, h: 40, colors: ["#fffaf5", "#fff4e6"] });
  await image(s, "wp-content/uploads/2024/01/cropped-favicon-32x32.png", {
    w: 32,
    h: 32,
    colors: ROSA,
    shape: "circle",
  });
  await image(s, "wp-content/uploads/2024/01/cropped-favicon-180x180.png", {
    w: 180,
    h: 180,
    colors: ROSA,
    label: "CL",
  });
  await image(s, `${up}/og-oferta.jpg`, { w: 1200, h: 630, colors: ROSA, label: "Confeitaria Lucrativa" });
  await image(s, `${up}/logo-metodo.png`, {
    w: 440,
    h: 120,
    colors: ["#ffffff", "#fff0f6"],
    label: "Confeitaria Lucrativa",
    labelColor: "#c2255c",
  });
  await image(s, `${up}/produto-mockup.webp`, { w: 960, h: 640, colors: ROSA, label: "Mockup WebP 1x" });
  await image(s, `${up}/produto-mockup@2x.webp`, { w: 1920, h: 1280, colors: ROSA, label: "Mockup WebP 2x" });
  await image(s, `${up}/produto-mockup.jpg`, { w: 960, h: 640, colors: ROSA, label: "Mockup JPG" });
  await image(s, `${up}/produto-mockup-480.jpg`, { w: 480, h: 320, colors: ROSA, label: "Mockup 480w" });
  await image(s, `${up}/produto-mockup-960.jpg`, { w: 960, h: 640, colors: ROSA, label: "Mockup 960w" });
  await image(s, `${up}/selo-garantia.png`, {
    w: 240,
    h: 240,
    colors: ["#ffd43b", "#f08c00"],
    label: "7 dias",
    shape: "circle",
  });
  await image(s, `${up}/faixa-bonus.jpg`, { w: 1200, h: 360, colors: LARANJA, label: "data-bg" });
  await image(s, `${up}/bonus-1-480.jpg`, { w: 480, h: 320, colors: VERDE, label: "Bônus 1 480w" });
  await image(s, `${up}/bonus-1-960.jpg`, { w: 960, h: 640, colors: VERDE, label: "Bônus 1 960w" });
  await image(s, `${up}/bonus-2-480.jpg`, { w: 480, h: 320, colors: AZUL, label: "Bônus 2 480w" });
  await image(s, `${up}/bonus-2-960.jpg`, { w: 960, h: 640, colors: AZUL, label: "Bônus 2 960w" });
  await image(s, `${up}/bonus-3.jpg`, { w: 480, h: 320, colors: ROXO, label: "Bônus 3" });
  await image(s, `${up}/fundo-oferta.jpg`, {
    w: 1600,
    h: 700,
    colors: ["#5c940d", "#2b8a3e"],
    label: "Fundo Elementor",
  });
  await image(s, `${up}/fundo-oferta-mobile.jpg`, {
    w: 750,
    h: 1000,
    colors: ["#5c940d", "#2b8a3e"],
    label: "Fundo celular",
  });
  await image(s, `${up}/pagamentos.png`, {
    w: 600,
    h: 80,
    colors: ["#ffffff", "#f1f3f5"],
    label: "Pix | Cartão | Boleto",
    labelColor: "#495057",
  });
  await image(s, `${up}/depoimento-ana.jpg`, { w: 192, h: 192, colors: ROSA, label: "AP" });
  await image(s, `${up}/depoimento-carlos.jpg`, { w: 192, h: 192, colors: AZUL, label: "CE" });
  await image(s, `${up}/depoimento-juliana.jpg`, { w: 192, h: 192, colors: ROXO, label: "JU" });
  await image(s, `${up}/upsell-kit.jpg`, { w: 1280, h: 800, colors: LARANJA, label: "Kit Festas" });
  await image(s, `${up}/obrigado-check.png`, { w: 240, h: 240, colors: VERDE, shape: "check" });
  copyFileSync(FONT_SRC, out(s, "wp-content/themes/oferta/fonts/inter-latin-wght-normal.woff2"));
}

/**
 * MP4 mínimo (caixas ftyp + free + mdat vazias): não toca, mas é um
 * ISO-BMFF válido o bastante para ser servido como video/mp4.
 */
function tinyMp4(): Buffer {
  const box = (type: string, payload: Buffer) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(8 + payload.length, 0);
    header.write(type, 4, "latin1");
    return Buffer.concat([header, payload]);
  };
  const ftyp = box(
    "ftyp",
    Buffer.concat([
      Buffer.from("isom", "latin1"),
      Buffer.from([0, 0, 2, 0]),
      Buffer.from("isomiso2avc1mp41", "latin1"),
    ]),
  );
  const free = box("free", Buffer.from("fixture offer studio", "latin1"));
  const mdat = box("mdat", Buffer.alloc(16));
  return Buffer.concat([ftyp, free, mdat]);
}

async function vslImages(): Promise<void> {
  const s = "vsl";
  await image(s, "img/logo.png", { w: 360, h: 96, colors: ESCURO, label: "Protocolo Articular" });
  await image(s, "img/kit-3-potes.jpg", { w: 960, h: 640, colors: VERDE, label: "Kit 3 potes" });
  await image(s, "img/selos.png", {
    w: 720,
    h: 120,
    colors: ["#ffffff", "#e9ecef"],
    label: "Compra segura | Garantia 30 dias",
    labelColor: "#2b8a3e",
  });
  await image(s, "img/poster.jpg", { w: 960, h: 540, colors: ESCURO, label: "Poster do vídeo" });
  await image(s, "img/fundo-escuro.jpg", { w: 1280, h: 720, colors: ["#212529", "#000000"] });
  write(s, "midia/depoimento.mp4", tinyMp4());
}

async function rastreadoresImages(): Promise<void> {
  const s = "rastreadores";
  await image(s, "assets/img/favicon.png", { w: 32, h: 32, colors: AZUL, shape: "circle" });
  await image(s, "assets/img/logo.png", { w: 400, h: 100, colors: ESCURO, label: "Escola Tráfego Pago" });
  await image(s, "assets/img/painel-anuncios.jpg", { w: 1280, h: 720, colors: AZUL, label: "Painel de anúncios" });
  await image(s, "assets/img/mentor.jpg", { w: 480, h: 480, colors: ROXO, label: "Mentor" });
  await image(s, "assets/img/fundo-hero.jpg", { w: 1600, h: 700, colors: ESCURO, shape: "dots" });
}

async function checkoutsImages(): Promise<void> {
  const s = "checkouts";
  await image(s, "img/logo.png", { w: 360, h: 96, colors: AZUL, label: "Inglês Fluente" });
  await image(s, "img/banner-planos.jpg", { w: 1920, h: 640, colors: AZUL, label: "Escolha seu plano" });
  await image(s, "img/selo-plano.png", { w: 64, h: 64, colors: ["#ffd43b", "#f08c00"], shape: "circle" });
}

async function quizImages(): Promise<void> {
  const s = "quiz";
  await image(s, "img/logo.png", { w: 320, h: 80, colors: ROXO, label: "Metabolismo Ativo" });
  const cores = [ROSA, AZUL, VERDE, LARANJA, ROXO];
  for (let i = 1; i <= 5; i++) {
    await image(s, `img/etapa-${i}.png`, { w: 240, h: 240, colors: cores[i - 1], label: `Etapa ${i}` });
  }
  await image(s, "img/resultado.jpg", { w: 960, h: 540, colors: VERDE, label: "Seu resultado" });
  await image(s, "img/seta.png", {
    w: 32,
    h: 32,
    colors: ["#ffffff", "#ffffff"],
    shape: "arrow",
    labelColor: "#7048e8",
  });
}

async function celularImages(): Promise<void> {
  const s = "celular";
  await image(s, "img/hero-desktop.jpg", { w: 1200, h: 500, colors: AZUL, label: "Versão desktop" });
  await image(s, "img/hero-celular.jpg", { w: 600, h: 800, colors: LARANJA, label: "Versão celular" });
  await image(s, "img/textura-celular.png", { w: 24, h: 24, colors: ["#fff4e6", "#ffe8cc"] });
}

async function shadowImages(): Promise<void> {
  const s = "shadow";
  await image(s, "img/logo-cafe.png", { w: 320, h: 96, colors: CAFE, label: "Clube do Café" });
  await image(s, "img/grao-fundo.png", { w: 48, h: 48, colors: ["#f8f1e9", "#efe3d3"], shape: "dots" });
  await image(s, "img/selo-frete.png", { w: 192, h: 96, colors: VERDE, label: "Frete grátis" });
  await image(s, "img/cafe-mensal.jpg", { w: 480, h: 320, colors: CAFE, label: "Plano mensal" });
  await image(s, "img/cafe-trimestral.jpg", { w: 480, h: 320, colors: CAFE, label: "Plano trimestral" });
}

// ─── Site "legado" (ISO-8859-1) ─────────────────────────────────────────────

/** Converte para Latin-1, recusando caracteres que não existem nele. */
function latin1(text: string): Buffer {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code > 0xff) throw new Error(`Caractere fora do ISO-8859-1: ${ch} (U+${code.toString(16)})`);
  }
  return Buffer.from(text, "latin1");
}

const LEGADO_RESET_CSS = `/* reset.css - Loja Sao Joao (2009) */
html, body, div, span, h1, h2, h3, p, a, img, ul, li, table, tr, td {
  margin: 0;
  padding: 0;
  border: 0;
  vertical-align: baseline;
}
ul { list-style: square inside; }
table { border-collapse: collapse; border-spacing: 0; }
`;

const LEGADO_ESTILO_CSS = `/* Folha de estilo da Loja São João (arquivo em ISO-8859-1, sem @charset) */
body {
  background: #ffffff url(../img/fundo.png) repeat-x;
  font-family: Verdana, Arial, sans-serif;
  font-size: 12px;
  color: #333333;
}
.principal { background: #ffffff; margin-top: 10px; }
.conteudo { padding: 15px; }
h1 { color: #990000; font-size: 20px; margin-bottom: 10px; }
.selo:before {
  content: "Promoção válida até domingo - não perca!";
  display: block;
  background: #cc0000;
  color: #ffffff;
  font-weight: bold;
  padding: 4px;
}
.preco:after { content: " (à vista, no depósito)"; }
.botao {
  display: inline-block;
  background: #009900 url(../img/botao-fundo.png) repeat-x;
  color: #ffffff;
  font-weight: bold;
  padding: 8px 16px;
  text-decoration: none;
}
.rodape { background: #eeeeee; color: #666666; font-size: 10px; padding: 8px; text-align: center; }
`;

const LEGADO_FONTES_CSS = `/* Carregada com o truque media="print" + onload */
@font-face {
  font-family: "Inter Legado";
  src: url(../fontes/inter.woff2) format("woff2");
  font-weight: 100 900;
  font-display: swap;
}
h1, .preco { font-family: "Inter Legado", Verdana, sans-serif; }
`;

const LEGADO_JS = `// Script antigo do site (arquivo em ISO-8859-1)
window.onload = function () {
  var el = document.getElementById("aviso");
  if (el) el.innerHTML = "Frete grátis para São João del-Rei e região!";
};
`;

function legadoIndexHtml(integrity: string): string {
  return `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">
<html>
<head>
<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">
<title>Promoção Relâmpago | Loja São João - Açaí e Cia</title>
<base href="/sub/">
<link rel="stylesheet" type="text/css" href="css/reset.css" integrity="${integrity}" crossorigin="anonymous">
<link rel="stylesheet" type="text/css" href="css/estilo.css">
<link rel="stylesheet" href="css/fontes.css" media="print" onload="this.media='all'; this.onload=null;">
<noscript><link rel="stylesheet" href="css/fontes.css"></noscript>
<link rel="shortcut icon" href="img/selo.gif" type="image/gif">
<script type="text/javascript" src="js/antigo.js"></script>
</head>
<body bgcolor="#FFFFFF">
<a name="topo"></a>
<center>
<table width="760" border="0" cellpadding="0" cellspacing="0" class="principal">
<tr><td><img src="img/banner.jpg" width="760" height="200" alt="Promoção de Verão - Açaí na tigela"></td></tr>
<tr><td class="conteudo">
<h1>Promoção de Verão: Açaí na Tigela com 40% de desconto!</h1>
<p class="selo">&nbsp;</p>
<p>Atenção: são as últimas unidades da estação. Não perca a chance de provar o açaí mais cremoso de São João del-Rei.</p>
<p id="aviso"></p>
<table width="100%"><tr>
<td width="300"><img src="img/produto.jpg" width="300" height="300" alt="Tigela de açaí com granola e paçoca"></td>
<td valign="top">
<ul>
<li>Açaí orgânico da Amazônia</li>
<li>Coberturas: granola, paçoca, leite condensado e maçã</li>
<li>Entrega em até 40 minutos na região</li>
</ul>
<p class="preco">De R$ 39,90 por apenas <b>R$ 23,94</b></p>
<p><a href="https://pay.hotmart.com/L4T1N0123?off=verao" class="botao">Comprar já com desconto</a></p>
<p><img src="img/selo.gif" width="120" height="120" alt="Selo"> Satisfação garantida ou seu dinheiro de volta.</p>
</td>
</tr></table>
<p><a href="pedido.html">Como fazer o pedido</a> | <a href="#topo">Voltar ao topo</a></p>
</td></tr>
<tr><td class="rodape">© 2009-2024 Loja São João - Todos os direitos reservados. Informações: (32) 3371-0000</td></tr>
</table>
</center>
</body>
</html>
`;
}

const LEGADO_PEDIDO_HTML = `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">
<html>
<head>
<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">
<title>Como fazer o pedido | Loja São João</title>
<link rel="stylesheet" type="text/css" href="css/estilo.css">
</head>
<body>
<center>
<table width="760" class="principal"><tr><td class="conteudo">
<h1>Como fazer o pedido</h1>
<p>1. Clique em "Comprar já" e escolha a forma de pagamento.</p>
<p>2. Você receberá a confirmação por e-mail em até 2 horas.</p>
<p><a href="/">Voltar à promoção</a></p>
</td></tr></table>
</center>
</body>
</html>
`;

async function legado(): Promise<void> {
  const s = "legado";
  const reset = latin1(LEGADO_RESET_CSS);
  const integrity = `sha384-${createHash("sha384").update(reset).digest("base64")}`;
  write(s, "sub/css/reset.css", reset);
  write(s, "sub/css/estilo.css", latin1(LEGADO_ESTILO_CSS));
  write(s, "sub/css/fontes.css", latin1(LEGADO_FONTES_CSS));
  write(s, "sub/js/antigo.js", latin1(LEGADO_JS));
  write(s, "index.html", latin1(legadoIndexHtml(integrity)));
  write(s, "sub/pedido.html", latin1(LEGADO_PEDIDO_HTML));
  await image(s, "sub/img/banner.jpg", { w: 760, h: 200, colors: ROXO, label: "Promoção de Verão" });
  await image(s, "sub/img/fundo.png", { w: 8, h: 200, colors: ["#5f3dc4", "#ffffff"] });
  await image(s, "sub/img/botao-fundo.png", { w: 4, h: 32, colors: ["#40c057", "#2b8a3e"] });
  await image(s, "sub/img/produto.jpg", { w: 300, h: 300, colors: ROXO, label: "Açaí" });
  await image(s, "sub/img/selo.gif", {
    w: 120,
    h: 120,
    colors: ["#ffd43b", "#f08c00"],
    label: "100%",
    shape: "circle",
  });
  copyFileSync(FONT_SRC, out(s, "sub/fontes/inter.woff2"));
}

// ─── Site "grande" (~3000 elementos, ~2000 regras) ──────────────────────────

/** Gerador pseudoaleatório determinístico (LCG). */
function rng(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 0x100000000;
  };
}

const GRANDE_CARTOES = 230;
const GRANDE_IMAGENS = 10;
const GRANDE_CHECKOUT = "https://pay.hotmart.com/G9999999Z?off=grande";

function hex(r: () => number): string {
  return `#${Math.floor(r() * 0xffffff)
    .toString(16)
    .padStart(6, "0")}`;
}

function grandeCss(): { css: string; rules: number } {
  const r = rng(42);
  const rules: string[] = [];
  rules.push("*,*::before,*::after{box-sizing:border-box}");
  rules.push("body{margin:0;font-family:system-ui,sans-serif;background:#f1f3f5;color:#212529}");
  rules.push(".catalogo{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;padding:16px}");
  rules.push(".cartao{background:#fff;border-radius:12px;overflow:hidden;display:flex;flex-direction:column}");
  rules.push(".cartao__midia img{width:100%;height:auto;display:block}");
  rules.push(".cartao__corpo{padding:12px}");
  rules.push(".cartao__de{text-decoration:line-through;color:#868e96}");
  rules.push(
    ".cartao__botao{display:block;text-align:center;background:#2f9e44;color:#fff;padding:10px;border-radius:8px}",
  );
  for (let i = 1; i <= GRANDE_IMAGENS; i++) {
    const n = String(i).padStart(2, "0");
    rules.push(
      `.tema-${n} .cartao__corpo{background-image:url(../img/produto-${n}.webp);background-size:24px;background-repeat:no-repeat;background-position:right 8px top 8px}`,
    );
  }
  for (let i = 1; i <= GRANDE_CARTOES; i++) {
    const n = String(i).padStart(3, "0");
    rules.push(`.cartao-${n}{border-top:4px solid ${hex(r)}}`);
    rules.push(`.cartao-${n} .cartao__titulo{color:${hex(r)};font-size:${(14 + r() * 6).toFixed(1)}px}`);
    rules.push(`.cartao-${n} .cartao__por{color:${hex(r)}}`);
    rules.push(`.cartao-${n}:hover{transform:translateY(-${(1 + r() * 3).toFixed(1)}px)}`);
    rules.push(`.cartao-${n} .cartao__lista li{margin-left:${Math.floor(r() * 16)}px}`);
    rules.push(`.cartao-${n} .cartao__botao:hover{background:${hex(r)}}`);
  }
  for (let i = 0; i < 100; i++) {
    rules.push(`.ut-margem-${i}{margin:${i * 2}px}`);
    rules.push(`.ut-recuo-${i}{padding:${i * 2}px}`);
    rules.push(`.ut-fonte-${i}{font-size:${10 + i * 0.5}px}`);
    rules.push(`.ut-altura-${i}{min-height:${i * 4}px}`);
    rules.push(`.ut-opaco-${i}{opacity:${(i / 100).toFixed(2)}}`);
  }
  const media: string[] = [];
  for (let i = 1; i <= 60; i++) {
    media.push(`.cartao-${String(i).padStart(3, "0")} .cartao__titulo{font-size:14px}`);
  }
  rules.push(`@media (max-width:600px){${media.join("")}}`);
  rules.push("@keyframes destaque{0%{opacity:.6}100%{opacity:1}}");
  // Conta só as regras de estilo (as de dentro do @media uma a uma; sem @media/@keyframes).
  const count = rules.length - 2 + media.length;
  return { css: `${rules.join("\n")}\n`, rules: count };
}

function grandeHtml(): { html: string; elements: number } {
  const r = rng(7);
  const cards: string[] = [];
  let elements = 0;
  const adjetivos = ["Premium", "Econômico", "Completo", "Essencial", "Deluxe", "Prático", "Clássico", "Moderno"];
  const produtos = [
    "Kit de Panelas",
    "Jogo de Toalhas",
    "Luminária",
    "Mochila",
    "Garrafa Térmica",
    "Tapete",
    "Organizador",
    "Relógio",
  ];
  for (let i = 1; i <= GRANDE_CARTOES; i++) {
    const n = String(i).padStart(3, "0");
    const img = String(((i - 1) % GRANDE_IMAGENS) + 1).padStart(2, "0");
    const nome = `${produtos[Math.floor(r() * produtos.length)]} ${adjetivos[Math.floor(r() * adjetivos.length)]}`;
    const de = (80 + r() * 200).toFixed(2).replace(".", ",");
    const por = (30 + r() * 60).toFixed(2).replace(".", ",");
    cards.push(
      `<article class="cartao cartao-${n} tema-${img}" data-sku="SKU-${n}">` +
        `<div class="cartao__midia"><img src="img/produto-${img}.webp" alt="${nome}" width="200" height="200" loading="lazy"></div>` +
        `<div class="cartao__corpo">` +
        `<h3 class="cartao__titulo">${nome} nº ${i}</h3>` +
        `<p class="cartao__descricao">Produto ${n} com envio imediato e garantia de 90 dias.</p>` +
        `<ul class="cartao__lista"><li>Frete grátis</li><li>12x sem juros</li></ul>` +
        `<p class="cartao__preco"><span class="cartao__de">R$ ${de}</span> <strong class="cartao__por">R$ ${por}</strong></p>` +
        `<a class="cartao__botao" href="${GRANDE_CHECKOUT}">Comprar</a>` +
        `</div></article>`,
    );
    elements += 13;
  }
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mega Queima de Estoque – ${GRANDE_CARTOES} ofertas</title>
<link rel="stylesheet" href="css/grande.css">
</head>
<body>
<header class="ut-recuo-8"><h1>Mega Queima de Estoque</h1><p>${GRANDE_CARTOES} produtos com até 70% de desconto. Página gerada por tests/fixtures/generate-assets.ts.</p></header>
<main class="catalogo">
${cards.join("\n")}
</main>
<footer class="ut-recuo-8"><p>© 2024 Loja Grande</p></footer>
</body>
</html>
`;
  // html, head, meta×2, title, link, body, header, h1, p, main, footer, p
  return { html, elements: elements + 13 };
}

async function grande(): Promise<{ elements: number; rules: number }> {
  const s = "grande";
  const cores = [
    ROSA,
    AZUL,
    VERDE,
    LARANJA,
    ROXO,
    MARROM,
    CAFE,
    ESCURO,
    ["#ffe066", "#f59f00"],
    ["#63e6be", "#0ca678"],
  ] as [string, string][];
  for (let i = 1; i <= GRANDE_IMAGENS; i++) {
    const n = String(i).padStart(2, "0");
    await image(s, `img/produto-${n}.webp`, { w: 200, h: 200, colors: cores[i - 1], label: `Produto ${n}` });
  }
  const { css, rules } = grandeCss();
  const { html, elements } = grandeHtml();
  write(s, "css/grande.css", css);
  write(s, "index.html", html);
  return { elements, rules };
}

// ─── Execução ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await vendasImages();
  await vslImages();
  await rastreadoresImages();
  await checkoutsImages();
  await legado();
  await quizImages();
  await celularImages();
  await shadowImages();
  const g = await grande();
  console.log(`Arquivos gerados em ${SITES_DIR}`);
  console.log(`Site "grande": ${g.elements} elementos, ${g.rules} regras de CSS.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
