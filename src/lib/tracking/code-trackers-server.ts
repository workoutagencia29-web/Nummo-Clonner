/**
 * Detecção de rastreadores no código livre com a base third-party-web (só no
 * servidor: prévia, ZIP e painel — a base é grande demais para o navegador).
 *
 * Completa detectCodeTrackers (./code-trackers.ts): um endereço que as regras
 * próprias não reconhecem (nem como rastreador, nem como chat/player/CDN) é
 * rastreamento quando a third-party-web diz que é de anúncio, análise ou tag
 * manager (classifyUrl de src/worker/clone/trackers.ts, com as mesmas exceções
 * do clonador). Assim um Mouseflow, Criteo ou Hotjar fora da lista própria
 * também espera o "Aceitar" quando a página não escolheu categoria.
 */
import tpw from "third-party-web/nostats-subset";
import { classifyUrl } from "@/worker/clone/trackers";
import {
  type CodeParts,
  codeUrls,
  detectCodeTrackers,
  ownVerdict,
  type ResolvedCodeCategory,
  resolveCodeCategory,
  unknownScriptHosts,
} from "./code-trackers";
import type { CodeCategoryId } from "./schema";

const TRACKING: ReadonlySet<string> = new Set(["PIXEL", "ANALYTICS", "TAG_MANAGER", "ADS"]);

const absolute = (url: string) => (url.startsWith("//") ? `https:${url}` : url);

/** detectCodeTrackers + os rastreadores que só a third-party-web conhece. */
export function detectAllCodeTrackers(...codes: (string | null | undefined)[]): string[] {
  const found = detectCodeTrackers(...codes);
  for (const url of codeUrls(...codes)) {
    if (ownVerdict(url) !== null) continue; // as regras próprias já decidiram
    const match = classifyUrl(absolute(url));
    if (match && TRACKING.has(match.category) && !found.includes(match.vendor)) found.push(match.vendor);
  }
  return found;
}

/** resolveCodeCategory com a detecção completa (vale na prévia, no ZIP e no painel). */
export function resolveCodeCategoryFull(
  code: CodeParts | null | undefined,
  explicit: CodeCategoryId | null | undefined,
): ResolvedCodeCategory {
  return resolveCodeCategory(code, explicit, detectAllCodeTrackers);
}

/** <script src> de fora que nenhuma base reconhece (o painel sugere "Marketing" se rastrear). */
export function unknownCodeScripts(...codes: (string | null | undefined)[]): string[] {
  return unknownScriptHosts(codes, (url) => Boolean(tpw.getEntity(url)));
}
