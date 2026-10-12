/**
 * Funil clonado "Com scripts" no ZIP (funções puras; regras do script em
 * src/lib/clone-routes.ts):
 *
 * - `zipPageRoutes`: o script de rotas de uma página "Com scripts" com o
 *   endereço de cada página no ZIP (a pasta dela). O script troca o endereço
 *   da barra pelo caminho original ("/produto/camiseta") antes de qualquer
 *   script da página, e o navegador pede imagens, CSS e scripts adiantado
 *   (pré-carregamento) pelo endereço de ANTES da troca (a pasta do arquivo,
 *   "camiseta/"): os endereços relativos do HTML (imagens, links do funil,
 *   scripts do Offer Studio) sobem até a raiz e descem
 *   ("../../assets/x.png"), tantos níveis quanto o mais fundo dos dois
 *   endereços — na raiz do domínio (onde as páginas "Com scripts" têm de
 *   ficar), subir além dela não sai dela, e os dois dão no mesmo arquivo. A
 *   raiz do site é calculada na página, antes da troca (`up`);
 * - `planRouteRedirects`: no caminho original de cada página que no ZIP fica
 *   em outra pasta, um index.html que leva à pasta dela (o JavaScript do site
 *   navega para "/roleta"; recarregar depois da troca também cai lá) — só
 *   quando o caminho está livre: nunca no lugar de página, arquivo do "Com
 *   scripts", página de checkout ou arquivo que a hospedagem executaria.
 */
import { type OfferRoutes, pageRoutes, type RoutesScriptConfig, routeKey } from "@/lib/clone-routes";
import { scriptString } from "./head";
import { ASSETS_DIR, dirDepth, fileDir, preserveJsZipPath, relativeDir, ZipPathSet } from "./paths";

export interface ZipPageRoutes {
  config: RoutesScriptConfig;
  /**
   * Pasta a partir da qual os endereços relativos do HTML são calculados
   * (relativeDir, upPrefix, rebaseCheckoutLinks…). Quando o script troca o
   * endereço: uma pasta "neutra" (nomes que nenhuma pasta do ZIP tem) com a
   * profundidade do mais fundo dos dois endereços — todo endereço sobe até a
   * raiz e desce. Sem a troca: a pasta do arquivo, como antes. Nunca vai
   * para o HTML (só a conta de quantos "../").
   */
  refDir: string;
}

/** Nome de pasta que nenhum caminho do ZIP tem (só para contar níveis). */
const NEUTRAL_DIR = "\u0000/";

/**
 * Script de rotas de um arquivo de página "Com scripts" do ZIP (`fileDir`: a
 * pasta do arquivo, "roleta/oferta-b/"), ou null quando não há nada a fazer.
 */
export function zipPageRoutes(
  routes: OfferRoutes,
  pageId: string,
  fileDir: string,
  pageDirs: Record<string, string>,
): ZipPageRoutes | null {
  const own = routes.pages.find((p) => p.pageId === pageId && p.owner);
  // "/produto/camiseta" → "produto/"; "/quiz/" → "quiz/"; "/roleta" → "".
  const selfDir = own ? own.path.slice(1).replace(/[^/]*$/, "") : "";
  const deeper = dirDepth(selfDir) > dirDepth(fileDir);
  const config = pageRoutes(routes, pageId, (id) => pageDirs[id], {
    up: dirDepth(fileDir),
    // Sem poder trocar o endereço (arquivo aberto do computador): os endereços partem
    // da pasta do caminho original, quando ela é a mais funda (senão, da do arquivo).
    baseDir: own && deeper ? selfDir : null,
  });
  if (!config) return null;
  if (!config.self) return { config, refDir: fileDir };
  return { config, refDir: NEUTRAL_DIR.repeat(Math.max(dirDepth(selfDir), dirDepth(fileDir))) };
}

export interface RouteRedirect {
  /** Caminho no ZIP ("produto/camiseta/index.html"). */
  zipPath: string;
  /** Pasta da página, relativa ao redirecionamento ("../../camiseta/"). */
  target: string;
  pageId: string;
  /** Nome da página (texto do link de reserva). */
  name: string;
}

/** Arquivo do redirecionamento para um caminho original, ou null (nome que não dá para gravar). */
function redirectZipPath(path: string): string | null {
  const last = path.slice(path.lastIndexOf("/") + 1);
  const ext = /\.([A-Za-z][A-Za-z0-9]{0,7})$/.exec(last)?.[1]?.toLowerCase();
  // "/roleta", "/loja/" → pasta com index.html; "/oferta.html" → o próprio arquivo; ".php"… não.
  const file = !ext ? `${path.replace(/\/+$/, "")}/index.html` : ext === "html" || ext === "htm" ? path : null;
  return file ? preserveJsZipPath(file) : null;
}

/**
 * Redirecionamentos nos caminhos originais das páginas (na ordem do mapa: a
 * página inicial primeiro). `taken`: caminhos que já estão no ZIP (páginas,
 * arquivos do "Com scripts", checkout, PHP, LEIA-ME…) — a mesma proteção de
 * colisão do resto do ZIP (ZipPathSet). `reservedDirs`: pastas do Offer
 * Studio em que nada entra (assets/ sempre; a das páginas de checkout).
 */
export function planRouteRedirects(
  routes: OfferRoutes,
  pages: readonly { id: string; name: string }[],
  pageDirs: Record<string, string>,
  taken: Iterable<string>,
  reservedDirs: readonly string[] = [],
): RouteRedirect[] {
  const paths = new ZipPathSet();
  for (const p of taken) paths.add(p);
  const names = new Map(pages.map((p) => [p.id, p.name]));
  const blocked = [ASSETS_DIR, ...reservedDirs].map((d) => d.toLowerCase());
  const out: RouteRedirect[] = [];
  for (const entry of routes.pages) {
    if (!entry.owner) continue;
    const dir = pageDirs[entry.pageId];
    if (dir === undefined || entry.key === routeKey(`/${dir}`)) continue;
    const zipPath = redirectZipPath(entry.path);
    if (!zipPath || paths.conflict(zipPath)) continue;
    const lower = zipPath.toLowerCase();
    if (blocked.some((d) => lower.startsWith(d))) continue;
    paths.add(zipPath);
    out.push({
      zipPath,
      target: relativeDir(fileDir(zipPath), dir),
      pageId: entry.pageId,
      name: names.get(entry.pageId) ?? "",
    });
  }
  return out;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * index.html do redirecionamento (sem nada de fora, fora do Google): vai para
 * a pasta da página mantendo a query e o #; sem JavaScript, o
 * <meta http-equiv="refresh"> e o link. O endereço é relativo à PASTA do
 * redirecionamento: sem a barra no fim ("/roleta", hospedagem que não
 * redireciona), ela entra antes da conta.
 */
export function routeRedirectHtml(redirect: RouteRedirect): string {
  const target = escapeHtml(redirect.target);
  const name = escapeHtml(redirect.name || redirect.target);
  const script = String.raw`(function(){try{var l=location,f=l.protocol==="file:",p=l.pathname;if(!f&&!/\/$|\.[A-Za-z0-9]{1,8}$/.test(p))p+="/";var u=new URL(${scriptString(redirect.target)},l.protocol+"//"+l.host+p);l.replace(u.pathname+(f&&/\/$/.test(u.pathname)?"index.html":"")+l.search+l.hash)}catch(e){}})();`;
  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="robots" content="noindex">',
    `<title>${name}</title>`,
    `<script>${script}</script>`,
    `<meta http-equiv="refresh" content="0;url=${target}">`,
    "</head>",
    `<body><a href="${target}">${name}</a></body>`,
    "</html>",
    "",
  ].join("\n");
}
