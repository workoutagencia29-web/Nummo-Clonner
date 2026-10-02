/**
 * Caminhos do ZIP (funções puras): pastas, endereços RELATIVOS entre pastas e a
 * troca de /os-assets/<arquivo> por assets/<arquivo> com a profundidade certa.
 *
 * Convenção: uma pasta é "" (raiz do ZIP) ou termina com "/" ("upsell/",
 * "upsell/oferta-b/celular/"). Os links do funil apontam para a PASTA da página
 * ("../upsell/"), então o visitante também passa pelo divisor A/B dela.
 */

/** Pasta dos arquivos (imagens, CSS, fontes, vídeos, scripts do Offer Studio). */
export const ASSETS_DIR = "assets/";

/** Nome de um arquivo do storage endereçado por hash ("<sha256>.<ext>"). */
export const ASSET_FILE_RE = /^[0-9a-f]{64}\.[a-z0-9]{1,8}$/;

/** Chave do storage de um arquivo por hash: "<sha>.webp" → "a/<2 primeiros>/<sha>.webp". */
export function storageKeyOf(file: string): string {
  return `a/${file.slice(0, 2)}/${file}`;
}

/** Arquivo por hash de uma chave do storage ("a/3f/<sha>.webp" → "<sha>.webp"), ou null. */
export function assetFileOfKey(key: string): string | null {
  const m = /^a\/([0-9a-f]{2})\/([0-9a-f]{64}\.[a-z0-9]{1,8})$/.exec(key);
  if (!m) return null;
  return m[2].startsWith(m[1]) ? m[2] : null;
}

/** Quantas pastas abaixo da raiz: "" → 0, "upsell/" → 1, "upsell/oferta-b/" → 2. */
export function dirDepth(dir: string): number {
  return dir.split("/").filter(Boolean).length;
}

/** "../" por nível: da pasta até a raiz do ZIP ("" na raiz). */
export function upPrefix(dir: string): string {
  return "../".repeat(dirDepth(dir));
}

/** Pasta de um arquivo: "upsell/index.html" → "upsell/", "index.html" → "". */
export function fileDir(filePath: string): string {
  const i = filePath.lastIndexOf("/");
  return i < 0 ? "" : filePath.slice(0, i + 1);
}

/**
 * Endereço relativo de uma pasta a outra, sempre terminando com "/":
 * "" → "upsell/" = "upsell/"; "oferta-b/" → "" = "../"; "a/" → "a/" = "./".
 */
export function relativeDir(fromDir: string, toDir: string): string {
  const from = fromDir.split("/").filter(Boolean);
  const to = toDir.split("/").filter(Boolean);
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) i++;
  const rel =
    "../".repeat(from.length - i) +
    to
      .slice(i)
      .map((s) => `${s}/`)
      .join("");
  return rel || "./";
}

/** Endereço relativo de um arquivo a partir de uma pasta ("upsell/" → "assets/x.css" = "../assets/x.css"). */
export function relativeFile(fromDir: string, filePath: string): string {
  const dir = fileDir(filePath);
  const rel = relativeDir(fromDir, dir);
  return `${rel === "./" ? "" : rel}${filePath.slice(dir.length)}`;
}

/**
 * Endereço relativo escrito numa pasta do ZIP → o mesmo arquivo visto de
 * outra pasta ("../assets/x.png" de "oferta-a/" para "" = "assets/x.png").
 * Endereços completos ("https://", "data:", "//cdn…"), a partir da raiz
 * ("/…") e âncoras ("#…") ficam como estão.
 */
export function rebaseRelativeUrl(url: string, fromDir: string, toDir: string): string {
  if (!url || /^(?:[a-z][a-z0-9+.-]*:|[/\\#])/i.test(url)) return url;
  let resolved: URL;
  try {
    resolved = new URL(url, `http://zip.invalid/${fromDir}`);
  } catch {
    return url;
  }
  const zipPath = resolved.pathname.slice(1);
  const dir = fileDir(zipPath);
  const rel = relativeDir(toDir, dir);
  return `${rel === "./" && zipPath.length > dir.length ? "" : rel}${zipPath.slice(dir.length)}${resolved.search}${resolved.hash}`;
}

/** Letra/nome da versão → pasta: "A" → "oferta-a", "Versão 2" → "oferta-versao-2" (sem nome: posição). */
export function variantFolderName(name: string, index: number): string {
  const slug = name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return `oferta-${slug || String(index + 1)}`;
}

/** Primeiro nome livre: "oferta-b", "oferta-b-2", "oferta-b-3"… */
export function uniqueName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Endereços de arquivos do Offer Studio: "/os-assets/<sha>.<ext>" (e o mesmo com
 * a origem do painel/prévia na frente, que o editor às vezes grava). O grupo 1 é
 * o arquivo. A forma escapada de JSON ("\/os-assets\/…") tem a sua expressão.
 */
const LOCAL_ORIGIN = String.raw`(?:(?:https?:)?//(?:localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.localhost)(?::\d{1,5})?)?`;
const ASSET_REF_RE = new RegExp(`${LOCAL_ORIGIN}/os-assets/([0-9a-f]{64}\\.[a-z0-9]{1,8})(?![a-z0-9])`, "g");
const ESCAPED_ORIGIN = LOCAL_ORIGIN.replace(/\/\//, String.raw`\\/\\/`);
const ESCAPED_ASSET_REF_RE = new RegExp(
  `${ESCAPED_ORIGIN}\\\\/os-assets\\\\/([0-9a-f]{64}\\.[a-z0-9]{1,8})(?![a-z0-9])`,
  "g",
);

/**
 * Troca toda referência a /os-assets/<arquivo> (atributos, srcset, style="",
 * <style>, CSS com url() e @import, JSON em atributos data-*, scripts) por
 * `<prefix>assets/<arquivo>` e anota os arquivos em `found`. `prefix` é o
 * caminho da pasta do texto até a raiz do ZIP ("", "../", "../../"). Para um
 * CSS dentro de assets/, use `inAssets` (os arquivos ficam lado a lado).
 */
export function rewriteAssetRefs(
  text: string,
  prefix: string,
  found?: Set<string>,
  { inAssets = false }: { inAssets?: boolean } = {},
): string {
  const base = inAssets ? "" : `${prefix}${ASSETS_DIR}`;
  const escapedBase = base.replace(/\//g, "\\/");
  return text
    .replace(ASSET_REF_RE, (_, file: string) => {
      found?.add(file);
      return `${base}${file}`;
    })
    .replace(ESCAPED_ASSET_REF_RE, (_, file: string) => {
      found?.add(file);
      return `${escapedBase}${file}`;
    });
}

/** Arquivos /os-assets/ citados num texto (sem trocar nada). */
export function assetRefsIn(text: string): Set<string> {
  const found = new Set<string>();
  rewriteAssetRefs(text, "", found);
  return found;
}

/** Caracteres que não podem ir num nome de arquivo do ZIP (Windows, caminhos). */
// biome-ignore lint/suspicious/noControlCharactersInRegex: caracteres de controle são justamente o que se recusa
const BAD_SEGMENT_RE = /[\0-\x1f\\:*?"<>|]/;

/**
 * Nome como o Windows grava: sem espaços e pontos no fim ("x.php " → "x.php",
 * "web.config." → "web.config"). O Explorer, o WinRAR e o FTP para servidor
 * Windows fazem essa troca ao criar o arquivo.
 */
export function windowsName(segment: string): string {
  return segment.replace(/[ .]+$/, "");
}

/** Caminho original (chave do assetMap) → caminho no ZIP, sem olhar se é seguro gravar. */
function decodePreservePath(mapKey: string): string | null {
  const pathOnly = mapKey.split("#")[0].split("?")[0];
  if (!pathOnly.startsWith("/") || pathOnly.endsWith("/")) return null;
  let decoded = pathOnly;
  try {
    decoded = decodeURIComponent(pathOnly);
  } catch {
    // "%" solto no nome: usa como veio
  }
  const segments = decoded.slice(1).split("/");
  if (!segments.length || segments.some((s) => !windowsName(s) || s.length > 200 || BAD_SEGMENT_RE.test(s))) {
    return null;
  }
  return segments.join("/");
}

/** Algum nome do caminho termina com espaço ou ponto (o Windows grava outro nome: não vai no ZIP). */
function hasWindowsRename(zipPath: string): boolean {
  return zipPath.split("/").some((s) => windowsName(s) !== s);
}

/**
 * Extensões que a hospedagem executa (PHP, CGI, ASP…). Vale qualquer extensão
 * do nome, não só a última: o Apache (AddHandler) também roda "foto.php.png".
 */
const SERVER_EXT_RE =
  /^(?:php\d*|phtml|pht|phar|phps|inc|cgi|fcgi|pl|py|rb|sh|asp|aspx|ashx|asmx|axd|cfm|jsp|jspx|shtml|shtm|stm)$/i;
/** Arquivos de configuração do servidor (mudam como a hospedagem roda a pasta). */
const SERVER_CONFIG_NAMES = new Set([
  ".htaccess",
  ".htpasswd",
  ".htgroup",
  ".user.ini",
  "php.ini",
  "php5.ini",
  "web.config",
]);

/**
 * Arquivo que a hospedagem executaria ou usaria como configuração: .php (e
 * parecidos, em qualquer extensão do nome), .htaccess, .user.ini, web.config,
 * tudo dentro de cgi-bin/ e arquivos/pastas ocultos (menos .well-known/).
 * Um site clonado nunca pode pôr um desses no ZIP: ao subir na hospedagem,
 * ele rodaria como programa. Cada nome é conferido como o Windows o gravaria
 * ("x.php " e "web.config." viram "x.php" e "web.config" ao descompactar).
 */
export function isServerSidePath(zipPath: string): boolean {
  const segments = zipPath.split("/").map(windowsName);
  const base = segments[segments.length - 1] ?? "";
  if (SERVER_CONFIG_NAMES.has(base.toLowerCase())) return true;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i].toLowerCase();
    if (s === "cgi-bin") return true;
    if (s.startsWith(".") && !(s === ".well-known" && i < segments.length - 1)) return true;
  }
  return base
    .split(".")
    .slice(1)
    .some((ext) => SERVER_EXT_RE.test(ext));
}

/**
 * "Preservar JS": caminho original do site (chave do assetMap, como o navegador
 * pediu: "/js/app.js?v=2", "/img/foto%20grande.png") → caminho no ZIP
 * ("js/app.js", "img/foto grande.png"). A query string não vai para o nome do
 * arquivo (o servidor ignora a query ao procurar o arquivo). null = não dá para
 * gravar como arquivo (pasta, "..", caracteres inválidos, nome terminado em
 * espaço ou ponto — o Windows grava com outro nome) ou não pode ir no ZIP por
 * segurança (isServerSidePath: .php, .htaccess…; ver blockedPreservePath).
 */
export function preserveJsZipPath(mapKey: string): string | null {
  const path = decodePreservePath(mapKey);
  return path && !isServerSidePath(path) && !hasWindowsRename(path) ? path : null;
}

/** Caminho no ZIP de um arquivo do "Preservar JS" que ficou de fora por segurança (ou null). */
export function blockedPreservePath(mapKey: string): string | null {
  const path = decodePreservePath(mapKey);
  return path && isServerSidePath(path) ? path : null;
}

/**
 * Pasta original da página clonada ("/", "/quiz/"), a partir do endereço de
 * onde ela veio (Page.sourceUrl): os scripts originais montam endereços
 * relativos a ela ("img/etapa-1.png"). Sem endereço: a raiz.
 */
export function preserveOriginalDir(sourceUrl: string | null | undefined): string {
  if (!sourceUrl) return "/";
  try {
    const pathname = new URL(sourceUrl).pathname;
    return pathname.replace(/[^/]*$/, "") || "/";
  } catch {
    return "/";
  }
}

/**
 * Caminho de um arquivo do "Preservar JS" relativo à pasta original da página
 * ("img/x.png" com a pasta "/" → "img/x.png"; "quiz/img/x.png" com "/quiz/" →
 * "img/x.png"). null = o arquivo não fica dentro da pasta original.
 */
export function preserveRelativePath(zipPath: string, originalDir: string): string | null {
  const full = `/${zipPath}`;
  if (!full.startsWith(originalDir)) return null;
  const rel = full.slice(originalDir.length);
  return rel ? rel : null;
}

/** Por que um caminho não pode entrar no ZIP ao lado dos que já estão (ver ZipPathSet). */
export type ZipPathConflict =
  /** Já existe exatamente este arquivo. */
  | "same"
  /** Já existe um arquivo com o mesmo nome em outra caixa ("Img/Logo.png" × "img/logo.png"). */
  | "case-file"
  /** Uma pasta do caminho existe com outra caixa ("Img/" × "img/"): no Mac/Windows elas se juntam. */
  | "case-folder"
  /** Já existe uma PASTA com esse nome ("obrigado" × "obrigado/index.html"). */
  | "folder"
  /** Uma pasta do caminho já existe como ARQUIVO ("x/y" com o arquivo "x"). */
  | "file-parent";

/**
 * Caminhos do ZIP já usados (arquivos e as pastas deles), sem diferenciar
 * maiúsculas: no Mac e no Windows "Img/" e "img/" são a mesma pasta, e um
 * arquivo "obrigado" ao lado da pasta "obrigado/" faz o ZIP não abrir.
 */
export class ZipPathSet {
  /** Arquivos: minúsculas → como foi gravado. */
  private readonly files = new Map<string, string>();
  /** Pastas ("a/b/"): minúsculas → como foi gravada. */
  private readonly dirs = new Map<string, string>();

  add(path: string) {
    this.files.set(path.toLowerCase(), path);
    const parts = path.split("/");
    let acc = "";
    for (let i = 0; i < parts.length - 1; i++) {
      acc += `${parts[i]}/`;
      const lower = acc.toLowerCase();
      if (!this.dirs.has(lower)) this.dirs.set(lower, acc);
    }
  }

  /** O que impede `path` de entrar (ou null se pode). */
  conflict(path: string): ZipPathConflict | null {
    const lower = path.toLowerCase();
    const same = this.files.get(lower);
    if (same !== undefined) return same === path ? "same" : "case-file";
    if (this.dirs.has(`${lower}/`)) return "folder";
    const parts = path.split("/");
    let acc = "";
    for (let i = 0; i < parts.length - 1; i++) {
      acc += parts[i];
      if (this.files.has(acc.toLowerCase())) return "file-parent";
      acc += "/";
      const dir = this.dirs.get(acc.toLowerCase());
      if (dir !== undefined && dir !== acc) return "case-folder";
    }
    return null;
  }
}

/**
 * Primeiro caminho que deixaria o ZIP impossível de descompactar (repetido,
 * repetido em outra caixa, arquivo com o nome de uma pasta), ou null.
 */
export function brokenZipPath(paths: readonly string[]): string | null {
  const set = new ZipPathSet();
  for (const path of [...paths].sort()) {
    const conflict = set.conflict(path);
    if (conflict && conflict !== "case-folder") return path;
    set.add(path);
  }
  return null;
}

/** Extensões que já vêm comprimidas (vão para o ZIP sem compactar de novo). */
const STORED_EXT_RE = /\.(?:jpe?g|png|gif|webp|avif|mp4|m4v|webm|mov|mp3|m4a|ogg|woff2?|zip|gz|br|pdf)$/i;

export function isPrecompressed(filePath: string): boolean {
  return STORED_EXT_RE.test(filePath);
}

/** Arquivos de texto cujas referências a /os-assets/ são reescritas (CSS e SVG em assets/). */
export function isRewritableAsset(file: string): boolean {
  return /\.(?:css|svg|html?)$/i.test(file);
}
