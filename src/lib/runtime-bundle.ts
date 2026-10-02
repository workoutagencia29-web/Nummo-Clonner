/**
 * Compila os scripts das páginas para IIFEs minificados, uma vez por processo:
 * - src/runtime/os-runtime.ts (widgets, delay, botões) — antes do </body>;
 * - src/runtime/tracking/index.ts (consentimento, pixels, eventos, UTMs) — no
 *   começo do <head> (ver src/lib/tracking/inject.ts).
 * Usado pelo servidor de prévia e pela exportação. Só roda em Node
 * (worker/prévia), nunca no bundle do Next.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { buildSync } from "esbuild";
import { TRACKING_SCRIPT_ATTR } from "@/lib/tracking/runtime-config";

let cached: string | null = null;
let trackingCached: string | null = null;

/** Caminho do script de rastreamento na prévia (e no ZIP, se sair como arquivo). */
export const TRACKING_SCRIPT_PATH = "/os-tracking.js";
/** Tag do script de rastreamento servido pela prévia (síncrono: roda antes do código da página). */
export const TRACKING_SCRIPT_TAG = `<script src="${TRACKING_SCRIPT_PATH}" ${TRACKING_SCRIPT_ATTR}></script>`;

function bundle(entry: string) {
  const result = buildSync({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    format: "iife",
    target: ["es2018", "safari13"],
    platform: "browser",
    // Aliases "@/…" do projeto (o script de rastreamento usa as constantes de src/lib/tracking).
    tsconfig: path.join(process.cwd(), "tsconfig.json"),
    write: false,
    legalComments: "none",
  });
  return result.outputFiles[0].text;
}

/** CSS que esconde elementos com delay até o script revelá-los. */
export const DELAY_STYLE = `<style id="os-delay-style">[data-os-delay]:not([data-os-delay="0"]):not(.os-revealed){display:none!important}</style>`;

export function runtimeScript(): string {
  cached ??= bundle(path.join(process.cwd(), "src/runtime/os-runtime.ts"));
  return cached;
}

/**
 * Script de rastreamento (src/runtime/tracking/index.ts). Enquanto ele não
 * existir (desenvolvimento em paralelo), devolve um script vazio.
 */
export function trackingScript(): string {
  if (trackingCached) return trackingCached;
  const entry = path.join(process.cwd(), "src/runtime/tracking/index.ts");
  if (!existsSync(entry)) return "/* os-tracking: script ainda não disponível */";
  trackingCached = bundle(entry);
  return trackingCached;
}

/** Tag com o script de rastreamento embutido (ZIP), à prova de "</script>" no código. */
export function inlineTrackingScriptTag(): string {
  return `<script ${TRACKING_SCRIPT_ATTR}>${trackingScript().replace(/<\/(script)/gi, "<\\/$1")}</script>`;
}

/**
 * Coloca o estilo de delay no <head> e o script antes do </body>.
 * Idempotente: não duplica se já existir.
 */
export function injectRuntime(html: string, scriptTag: string): string {
  let out = html;
  // Substituições por função: o script embutido (ZIP) pode ter "$&", "$1"… que o
  // replace com texto interpretaria.
  if (!out.includes('id="os-delay-style"')) {
    out = /<\/head>/i.test(out) ? out.replace(/<\/head>/i, (m) => `${DELAY_STYLE}${m}`) : `${DELAY_STYLE}${out}`;
  }
  if (!out.includes("data-os-runtime")) {
    out = /<\/body>/i.test(out)
      ? out.replace(/<\/body>(?![\s\S]*<\/body>)/i, (m) => `${scriptTag}${m}`)
      : `${out}${scriptTag}`;
  }
  return out;
}
