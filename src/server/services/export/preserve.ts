/**
 * Arquivos do "Preservar JS" que vão no ZIP (função pura: a prévia e a
 * montagem usam a mesma regra, então a árvore mostrada é o que sai).
 *
 * - Cada arquivo do assetMap vai para o caminho original do site ("/js/app.js"
 *   → "js/app.js").
 * - Página que no ZIP não fica na mesma pasta em que estava no site original
 *   (versões A/B em oferta-a/, página do funil em quiz/, celular/): os arquivos
 *   de dentro da pasta original também são copiados para a pasta da página,
 *   porque os scripts originais montam endereços relativos ("img/etapa-1.png").
 *   Só os que um script pode pedir assim: fica sem cópia o que o HTML da página
 *   já pede a partir da raiz ("/css/orig.css", "/js/app.js": carrega do
 *   caminho original), vídeo, áudio e fonte (preserveCopyWanted) e, na
 *   montagem, arquivo com mais de PRESERVE_COPY_MAX_BYTES — senão um vídeo de
 *   80 MB sairia 5 vezes no ZIP (versões A/B e as pastas celular/ delas).
 * - Nunca entra: arquivo que a hospedagem executaria (.php, .htaccess…:
 *   isServerSidePath) nem caminho que colide com outro arquivo do ZIP — igual,
 *   igual em outra caixa ("Img/" × "img/"), arquivo com o nome de uma pasta
 *   ("obrigado" × "obrigado/index.html") ou pasta com o nome de um arquivo.
 */
import type { Layout } from "@/lib/export/layout";
import {
  ASSET_FILE_RE,
  ASSETS_DIR,
  assetFileOfKey,
  blockedPreservePath,
  preserveJsZipPath,
  preserveOriginalDir,
  preserveRelativePath,
  ZipPathSet,
} from "@/lib/export/paths";
import type { ExportSource, SourceDocument } from "./source";

export interface PreserveEntry {
  /** Caminho no ZIP. */
  zipPath: string;
  /** Arquivo no storage. */
  key: string;
  /** Caminho original do site (false = cópia na pasta de uma versão/página). */
  primary: boolean;
  pageId: string;
}

export interface PreservePlan {
  entries: PreserveEntry[];
  /** Caminhos originais que ficaram de fora por colidir com outro arquivo do ZIP. */
  collisions: string[];
  /** Caminhos que ficaram de fora por segurança (a hospedagem executaria). */
  blocked: string[];
}

const byKey = ([a]: [string, string], [b]: [string, string]) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Cópia (na pasta de uma versão/página) de arquivo maior que isto não entra:
 * scripts montam endereços relativos para JSON, imagens pequenas, CSS e JS,
 * não para arquivos grandes (o caminho original continua no ZIP).
 */
export const PRESERVE_COPY_MAX_BYTES = 2 * 1024 * 1024;

/** Vídeo, áudio, fontes e arquivos para baixar: carregam pelo caminho original (nunca ganham cópia). */
const NO_COPY_EXT_RE =
  /\.(?:mp4|m4v|webm|mov|ogv|avi|mkv|m3u8|ts|m4s|mp3|m4a|aac|oga|ogg|wav|flac|opus|woff2?|ttf|otf|eot|zip|rar|pdf)$/i;

/** Tenta decodificar "%20" e afins (lixo fica como veio). */
function decoded(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * Caminhos que o HTML pede a partir da raiz do site ("/css/orig.css",
 * "/js/app.js?v=2" → "/js/app.js"), em atributos, estilos e scripts (também na
 * forma escapada de JSON, "\/js\/app.js"). Endereços completos e relativos
 * não entram.
 */
export function rootPathsIn(html: string): Set<string> {
  const out = new Set<string>();
  const text = html.replace(/\\\//g, "/");
  for (const m of text.matchAll(/(?<![\w.~%/:@$-])\/(?!\/)[^\s"'`<>()\\?#,;{}|^[\]]+/g)) {
    out.add(decoded(m[0].replace(/&amp;/g, "&")));
  }
  return out;
}

/**
 * Um arquivo do "Preservar JS" precisa de cópia na pasta da página? Não quando
 * o HTML do documento já o pede a partir da raiz (`rootPaths`), nem vídeo,
 * áudio e fonte.
 */
export function preserveCopyWanted(mapKey: string, rootPaths: ReadonlySet<string> | null): boolean {
  const pathOnly = mapKey.split("#")[0].split("?")[0];
  if (NO_COPY_EXT_RE.test(pathOnly)) return false;
  return !rootPaths?.has(decoded(pathOnly));
}

/** Pastas de um caminho, como estão escritas ("A/b/c.png" → ["A/", "A/b/"]). */
function folderPrefixes(zipPath: string): string[] {
  const parts = zipPath.split("/");
  const out: string[] = [];
  let acc = "";
  for (let i = 0; i < parts.length - 1; i++) {
    acc += `${parts[i]}/`;
    out.push(acc);
  }
  return out;
}

/**
 * Grafia que vale para cada pasta (chave em minúsculas): a que tem mais
 * arquivos; empate, a que já é toda em minúsculas (a mais comum na web), senão
 * a primeira em ordem alfabética.
 */
export function canonicalFolders(paths: readonly string[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const p of new Set(paths)) {
    for (const dir of folderPrefixes(p)) {
      const lower = dir.toLowerCase();
      const variants = counts.get(lower) ?? new Map<string, number>();
      variants.set(dir, (variants.get(dir) ?? 0) + 1);
      counts.set(lower, variants);
    }
  }
  const out = new Map<string, string>();
  for (const [lower, variants] of counts) {
    const best = [...variants].sort(
      ([a, na], [b, nb]) => nb - na || Number(b === lower) - Number(a === lower) || (a < b ? -1 : a > b ? 1 : 0),
    )[0][0];
    out.set(lower, best);
  }
  return out;
}

/**
 * `reserved`: caminhos do ZIP que não são do "Preservar JS" (páginas geradas,
 * scripts do Offer Studio, eventos.php, LEIA-ME.txt…); os arquivos por hash
 * em assets/ são conferidos pelo formato do nome.
 */
export function planPreserveFiles(source: ExportSource, layout: Layout, reserved: Iterable<string>): PreservePlan {
  const paths = new ZipPathSet();
  for (const p of reserved) paths.add(p);
  const entries: PreserveEntry[] = [];
  const collisions = new Set<string>();
  const blocked = new Set<string>();
  const chosen = new Map<string, string>();

  const assetsLower = ASSETS_DIR.toLowerCase();
  const isOurAsset = (zipPath: string) => {
    const lower = zipPath.toLowerCase();
    return lower.startsWith(assetsLower) && ASSET_FILE_RE.test(lower.slice(assetsLower.length));
  };

  /** Tenta pôr `zipPath`; devolve se entrou (ou se já estava com o mesmo arquivo). */
  const accept = (zipPath: string, key: string, primary: boolean, pageId: string): "ok" | "same" | "conflict" => {
    const already = chosen.get(zipPath);
    if (already !== undefined) return already === key ? "same" : "conflict";
    if (isOurAsset(zipPath) || paths.conflict(zipPath)) return "conflict";
    paths.add(zipPath);
    chosen.set(zipPath, key);
    entries.push({ zipPath, key, primary, pageId });
    return "ok";
  };

  const preservePages = source.pages.filter((p) => p.cloneMode === "PRESERVE_JS");
  const docs = new Map<string, SourceDocument>();
  for (const page of preservePages) for (const v of page.variants) for (const d of v.documents) docs.set(d.id, d);

  // 1. Caminhos originais (páginas na ordem do funil; desktop e celular costumam repetir).
  const originals: { zipPath: string; key: string; pageId: string }[] = [];
  for (const page of preservePages) {
    for (const v of page.variants) {
      for (const doc of v.documents) {
        for (const [mapKey, key] of Object.entries(doc.assetMap ?? {}).sort(byKey)) {
          if (!assetFileOfKey(key)) continue;
          const unsafe = blockedPreservePath(mapKey);
          if (unsafe) {
            blocked.add(unsafe);
            continue;
          }
          const zipPath = preserveJsZipPath(mapKey);
          if (zipPath) originals.push({ zipPath, key, pageId: page.id });
        }
      }
    }
  }
  // Pastas que só diferem na caixa ("Img/" × "img/") não cabem juntas (no Mac/Windows
  // viram uma só): fica a grafia com mais arquivos (empate: a em minúsculas), e os
  // arquivos da outra entram depois — e ficam de fora com aviso.
  const canonical = canonicalFolders(originals.map((o) => o.zipPath));
  const rank = (zipPath: string) =>
    folderPrefixes(zipPath).every((d) => canonical.get(d.toLowerCase()) === d) ? 0 : 1;
  const ordered = originals.map((o, i) => ({ ...o, i, rank: rank(o.zipPath) }));
  ordered.sort((a, b) => a.rank - b.rank || a.i - b.i);
  for (const o of ordered) {
    if (accept(o.zipPath, o.key, true, o.pageId) === "conflict") collisions.add(o.zipPath);
  }

  // 2. Cópias nas pastas em que a página ficou (quando não é a pasta original).
  const pageById = new Map(preservePages.map((p) => [p.id, p]));
  const rootPathsByDoc = new Map<string, Set<string> | null>();
  for (const file of layout.files) {
    const page = pageById.get(file.pageId);
    const doc = file.documentId ? docs.get(file.documentId) : undefined;
    if (!page || !doc?.assetMap) continue;
    const originalDir = preserveOriginalDir(page.sourceUrl);
    if (`/${file.dir}` === originalDir) continue;
    // Sem o HTML (prévia do ZIP), não dá para saber o que ele pede pela raiz: a
    // prévia só mostra os caminhos originais, então a diferença não aparece.
    let rootPaths = rootPathsByDoc.get(doc.id);
    if (rootPaths === undefined) {
      rootPaths = doc.html ? rootPathsIn(doc.html) : null;
      rootPathsByDoc.set(doc.id, rootPaths);
    }
    const copies: { rel: string; key: string; rank: number }[] = [];
    for (const [mapKey, key] of Object.entries(doc.assetMap).sort(byKey)) {
      if (!assetFileOfKey(key) || !preserveCopyWanted(mapKey, rootPaths)) continue;
      const zipPath = preserveJsZipPath(mapKey);
      const rel = zipPath ? preserveRelativePath(zipPath, originalDir) : null;
      if (zipPath && rel) copies.push({ rel, key, rank: rank(zipPath) });
    }
    // Mesma preferência de grafia das pastas dos caminhos originais ("img/" antes de "Img/").
    copies.sort((a, b) => a.rank - b.rank);
    // Cópia que não cabe (colide) fica de fora sem aviso: o caminho original continua lá.
    for (const c of copies) accept(`${file.dir}${c.rel}`, c.key, false, page.id);
  }

  return { entries, collisions: [...collisions], blocked: [...blocked].sort() };
}
