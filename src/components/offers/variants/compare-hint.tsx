import { Notice } from "@/components/offers/export/parts";

/** Título do aviso "como comparar as versões" (também usado nos testes). */
export const COMPARE_HINT_TITLE = "Para saber qual versão vende mais";

/**
 * Aviso do "Teste A/B" com 2+ versões: cada versão manda a letra dela em todos
 * os eventos (os_versao) e marca o checkout — `src` na Hotmart/Kiwify/Eduzz,
 * `utm_content` nas outras só quando o visitante chegou sem ele (o do anúncio
 * é o que a UTMify usa e nunca é trocado). Regras em
 * src/lib/tracking/runtime-config.ts (VERSION_SRC_PLATFORMS) e no LEIA-ME.
 */
export function CompareVersionsHint() {
  const code = (text: string) => <span className="font-mono text-xs">{text}</span>;
  return (
    <Notice title={COMPARE_HINT_TITLE}>
      Cada versão avisa qual ela é em todos os eventos dos pixels ({code("os_versao")} = A, B…) e marca o checkout com{" "}
      {code("versao-b")}: no {code("src")} na Hotmart, Kiwify e Eduzz; nas outras, no {code("utm_content")}, só quando o
      visitante chegou sem um (o do anúncio, que a UTMify usa, nunca é trocado). Nada que o link já tenha é trocado: se
      ele já tiver esse parâmetro, use um <strong>link de checkout diferente em cada versão</strong> (crie outro em
      “Links e checkouts”). Visitas e cliques também aparecem no Meta e no GA4 pelo endereço da pasta (ex.:{" "}
      {code("/oferta-b/")}).
    </Notice>
  );
}
