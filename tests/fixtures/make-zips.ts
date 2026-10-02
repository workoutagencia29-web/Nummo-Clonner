/**
 * Gera os ZIPs de teste da importação (rode uma vez e guarde o resultado):
 *
 *   npx tsx tests/fixtures/make-zips.ts
 *
 * - good.zip: página salva pelo navegador ("Salvar como → Página completa"):
 *   "Página.html" + pasta "Página_files/" (acentos nos nomes, flag UTF-8).
 * - slip.zip: ZIP malicioso com entradas "../evil.txt" e
 *   "Página_files/../../evil2.txt" (zip slip), além de um index.html normal.
 *
 * O ZIP é montado aqui mesmo (sem depender do `zip` do sistema), com datas
 * fixas: rodar de novo gera bytes idênticos.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";
import sharp from "sharp";

const FIXTURES_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ZIPS_OUT_DIR = path.join(FIXTURES_DIR, "zips");

export interface ZipEntry {
  /** Caminho dentro do ZIP (use "/" no fim para pastas). */
  name: string;
  data?: Buffer | string;
}

/** Data fixa (20/05/2024 12:00) no formato DOS. */
const DOS_TIME = (12 << 11) | (0 << 5) | 0;
const DOS_DATE = ((2024 - 1980) << 9) | (5 << 5) | 20;
const FLAG_UTF8 = 0x0800;

/** Monta um ZIP (deflate, nomes em UTF-8) a partir das entradas, na ordem dada. */
export function buildZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const isDir = entry.name.endsWith("/");
    const raw = isDir
      ? Buffer.alloc(0)
      : Buffer.isBuffer(entry.data)
        ? entry.data
        : Buffer.from(entry.data ?? "", "utf8");
    const method = isDir ? 0 : 8;
    const data = isDir ? raw : deflateRawSync(raw, { level: 9 });
    const crc = isDir ? 0 : crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versão necessária
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // feito por: Unix, versão 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comentário
    central.writeUInt16LE(0, 34); // disco
    central.writeUInt16LE(0, 36); // atributos internos
    central.writeUInt32LE(isDir ? ((0o40755 << 16) | 0x10) >>> 0 : (0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, end]);
}

async function img(w: number, h: number, colors: [string, string], label: string, format: "jpeg" | "png") {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="bold" font-size="${Math.round(h / 6)}" fill="#fff">${label}</text></svg>`;
  const s = sharp(Buffer.from(svg));
  return format === "jpeg" ? s.jpeg({ quality: 70 }).toBuffer() : s.png({ compressionLevel: 9 }).toBuffer();
}

const ORIGINAL_URL = "https://www.ofertaexemplo.com.br/promocao/";

const PAGINA_HTML = `<!DOCTYPE html>
<!-- saved from url=(${String(ORIGINAL_URL.length).padStart(4, "0")})${ORIGINAL_URL} -->
<html lang="pt-BR"><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Promoção de Inverno – Cobertores Açaí Home</title>
<link rel="stylesheet" href="./Página_files/estilo.css">
<link rel="icon" href="./Página_files/logotipo-açaí.png">
<script async="" src="./Página_files/fbevents.js"></script><script>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '9876543210987654');
fbq('track', 'PageView');
</script>
</head>
<body>
<header class="topo"><img src="./Página_files/logotipo-açaí.png" alt="Açaí Home" width="200" height="60"></header>
<main>
<h1>Cobertores de microfibra com 50% de desconto</h1>
<p>Últimas unidades da coleção de inverno. Frete grátis para todo o Brasil.</p>
<img src="./P%C3%A1gina_files/foto-produto.jpg" alt="Cobertor dobrado" width="480" height="320">
<p class="preco">De R$ 259,90 por <strong>R$ 129,90</strong></p>
<a class="botao" href="https://pay.kiwify.com.br/InvernoZip1">Comprar com desconto</a>
<iframe src="./Página_files/saved_resource.html" width="320" height="120" title="Avaliações"></iframe>
<p><a href="https://www.ofertaexemplo.com.br/politica-de-privacidade/">Política de Privacidade</a></p>
</main>
<script src="./Página_files/main.js"></script>
</body></html>
`;

const ESTILO_CSS = `body{margin:0;font-family:system-ui,sans-serif;background:#f8f9fa url(fundo.jpg) center top/cover no-repeat;color:#212529}
.topo{background:#1864ab;padding:12px;text-align:center}
main{max-width:720px;margin:0 auto;padding:24px 16px;background:#fff}
.preco strong{color:#2b8a3e;font-size:2rem}
.botao{display:inline-block;background:#2b8a3e;color:#fff;padding:16px 28px;border-radius:8px;text-decoration:none}
`;

const MAIN_JS = `document.querySelectorAll(".botao").forEach(function (b) {
  b.addEventListener("click", function () { b.textContent = "Carregando…"; });
});
`;

const FBEVENTS_JS = `/*! fbevents.js (cópia salva pelo navegador — rastreador que deve ser removido) */
(function(){window.fbq&&window.fbq.queue&&(window.fbq.loaded=true);})();
`;

const SAVED_RESOURCE_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Avaliações</title></head>
<body><p>★★★★★ 4,9 de 5 — 1.284 avaliações</p></body></html>
`;

/** Entradas do good.zip (página salva pelo navegador). */
export async function goodEntries(): Promise<ZipEntry[]> {
  return [
    { name: "Página.html", data: PAGINA_HTML },
    { name: "Página_files/" },
    { name: "Página_files/estilo.css", data: ESTILO_CSS },
    { name: "Página_files/fundo.jpg", data: await img(1200, 600, ["#a5d8ff", "#1864ab"], "Fundo", "jpeg") },
    { name: "Página_files/foto-produto.jpg", data: await img(480, 320, ["#ffc078", "#e8590c"], "Cobertor", "jpeg") },
    { name: "Página_files/logotipo-açaí.png", data: await img(200, 60, ["#5f3dc4", "#3b1f0e"], "Acai Home", "png") },
    { name: "Página_files/main.js", data: MAIN_JS },
    { name: "Página_files/fbevents.js", data: FBEVENTS_JS },
    { name: "Página_files/saved_resource.html", data: SAVED_RESOURCE_HTML },
  ];
}

/** Entradas do slip.zip (zip slip). */
export const SLIP_ENTRIES: ZipEntry[] = [
  {
    name: "index.html",
    data: '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>ZIP malicioso</title></head><body><h1>Oferta</h1></body></html>\n',
  },
  { name: "../evil.txt", data: "Este arquivo tentou sair da pasta de destino (zip slip).\n" },
  { name: "Página_files/../../evil2.txt", data: "Outra tentativa de zip slip, escondida numa subpasta.\n" },
];

async function main(): Promise<void> {
  mkdirSync(ZIPS_OUT_DIR, { recursive: true });
  const good = buildZip(await goodEntries());
  writeFileSync(path.join(ZIPS_OUT_DIR, "good.zip"), good);
  const slip = buildZip(SLIP_ENTRIES);
  writeFileSync(path.join(ZIPS_OUT_DIR, "slip.zip"), slip);
  console.log(`ZIPs gerados em ${ZIPS_OUT_DIR}: good.zip (${good.length} bytes), slip.zip (${slip.length} bytes)`);
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
