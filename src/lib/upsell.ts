/**
 * Funil de upsell pós-compra (puro, sem dependências): a sequência que roda
 * DEPOIS da pessoa comprar o produto principal.
 *
 * Como funciona: o produto principal (`startLinkKey`) tem, como "página de
 * obrigado", a 1ª etapa da sequência. Em cada etapa de UPSELL a pessoa vê a
 * página e, no "SIM", abre um checkout novo (pré-preenchido com os dados do
 * pedido anterior) do produto daquela etapa; pago, segue para a próxima etapa.
 * No "Não", vai para o DOWNSELL atrelado àquele upsell (se houver) ou para a
 * próxima etapa. Downsells também podem ser etapas SOLTAS no caminho (aparecem
 * para todo mundo que chega nelas). No fim de tudo, a página de OBRIGADO.
 *
 * Nenhum gateway cobra "1 clique" (ver src/lib/payments): todo upsell é uma
 * cobrança NOVA (link próprio com target PAYMENT/CHECKOUT). Guardado em
 * Offer.settings.upsell (JSON; os pageId são remapeados ao duplicar a oferta).
 */

export const UPSELL_MAX = 3;
export const DOWNSELL_MAX = 2;

export type UpsellKind = "UPSELL" | "DOWNSELL";

export interface UpsellStep {
  /** Id curto estável da etapa (gerado no painel; não é um id de banco). */
  id: string;
  kind: UpsellKind;
  /** Página mostrada nesta etapa (os-page). null = ainda não escolhida. */
  pageId: string | null;
  /** Link da oferta do produto desta etapa (o "SIM" leva a ele). null = sem produto. */
  linkKey: string | null;
  /** Só DOWNSELL: id do UPSELL a que está atrelado (mostrado ao recusar aquele upsell). null/ausente = etapa solta. */
  attachedTo?: string | null;
}

export interface UpsellFlow {
  /** Produto principal que INICIA a sequência (a 1ª etapa vira o "obrigado" dele). */
  startLinkKey: string | null;
  /** Etapas do caminho principal (upsells e downsells soltos), em ordem; downsells atrelados ficam aqui também, com `attachedTo`. */
  steps: UpsellStep[];
  /** Página de OBRIGADO final. */
  thankYouPageId: string | null;
}

export function emptyUpsellFlow(): UpsellFlow {
  return { startLinkKey: null, steps: [], thankYouPageId: null };
}

/** Lê o JSON guardado de forma tolerante (item estragado some sem derrubar o resto). */
export function parseUpsellFlow(raw: unknown): UpsellFlow {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyUpsellFlow();
  const o = raw as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
  const steps: UpsellStep[] = [];
  if (Array.isArray(o.steps)) {
    for (const item of o.steps) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const s = item as Record<string, unknown>;
      const kind = s.kind === "DOWNSELL" ? "DOWNSELL" : s.kind === "UPSELL" ? "UPSELL" : null;
      const id = str(s.id);
      if (!kind || !id) continue;
      steps.push({
        id,
        kind,
        pageId: str(s.pageId),
        linkKey: str(s.linkKey),
        attachedTo: kind === "DOWNSELL" ? str(s.attachedTo) : null,
      });
    }
  }
  return { startLinkKey: str(o.startLinkKey), steps, thankYouPageId: str(o.thankYouPageId) };
}

/** Caminho principal: etapas sem `attachedTo`, na ordem. */
export function mainPath(flow: UpsellFlow): UpsellStep[] {
  return flow.steps.filter((s) => !s.attachedTo);
}

/** Downsell atrelado a um upsell (mostrado ao recusar), ou undefined. */
export function attachedDownsell(flow: UpsellFlow, upsellId: string): UpsellStep | undefined {
  return flow.steps.find((s) => s.kind === "DOWNSELL" && s.attachedTo === upsellId);
}

export function upsellCount(flow: UpsellFlow): number {
  return flow.steps.filter((s) => s.kind === "UPSELL").length;
}
export function downsellCount(flow: UpsellFlow): number {
  return flow.steps.filter((s) => s.kind === "DOWNSELL").length;
}

/** Tem alguma etapa de verdade? (vazio = sem upsell configurado). */
export function hasUpsell(flow: UpsellFlow): boolean {
  return flow.steps.length > 0;
}

export interface StepRouting {
  stepId: string;
  /** Página para onde vai ao ACEITAR (pagar); null = página de obrigado/fim. */
  acceptPageId: string | null;
  /** Página para onde vai ao RECUSAR ("Não"); null = obrigado/fim. */
  declinePageId: string | null;
}

/**
 * Para onde cada etapa leva ao aceitar/recusar, e a 1ª página da sequência (o
 * "obrigado" do produto principal). Página null = a de OBRIGADO final (ou nada).
 */
export function upsellRouting(flow: UpsellFlow): { startPageId: string | null; steps: StepRouting[] } {
  const main = mainPath(flow);
  const pageAt = (i: number): string | null => (i < main.length ? main[i].pageId : flow.thankYouPageId);
  const routing: StepRouting[] = [];
  main.forEach((step, i) => {
    const next = pageAt(i + 1);
    if (step.kind === "UPSELL") {
      const down = attachedDownsell(flow, step.id);
      routing.push({ stepId: step.id, acceptPageId: next, declinePageId: down?.pageId ?? next });
      // Downsell atrelado: aceitar ou recusar segue para a próxima etapa do upsell.
      if (down) routing.push({ stepId: down.id, acceptPageId: next, declinePageId: next });
    } else {
      // Downsell solto no caminho: aceitar ou recusar segue para a próxima etapa.
      routing.push({ stepId: step.id, acceptPageId: next, declinePageId: next });
    }
  });
  return { startPageId: main[0]?.pageId ?? flow.thankYouPageId, steps: routing };
}

/** Remapeia os pageId (ao duplicar a oferta). Página sem equivalente vira null. */
export function remapUpsellPages(flow: UpsellFlow, map: Map<string, string>): UpsellFlow {
  const page = (id: string | null) => (id ? (map.get(id) ?? null) : null);
  return {
    startLinkKey: flow.startLinkKey,
    thankYouPageId: page(flow.thankYouPageId),
    steps: flow.steps.map((s) => ({ ...s, pageId: page(s.pageId) })),
  };
}

export interface UpsellProblem {
  /** Etapa (ou "flow" para problemas gerais). */
  stepId: string | "flow";
  message: string;
}

/**
 * O que falta para o funil de upsell funcionar (mensagens pt-BR). Vazio = pronto.
 * Usado no painel, no "Próximos passos" e no aviso do ZIP.
 */
export function upsellProblems(flow: UpsellFlow): UpsellProblem[] {
  const out: UpsellProblem[] = [];
  if (!flow.steps.length) return out; // sem upsell: nada a cobrar
  if (!flow.startLinkKey) out.push({ stepId: "flow", message: "Escolha o produto principal que começa a sequência." });
  if (upsellCount(flow) > UPSELL_MAX) out.push({ stepId: "flow", message: `No máximo ${UPSELL_MAX} upsells.` });
  if (downsellCount(flow) > DOWNSELL_MAX) out.push({ stepId: "flow", message: `No máximo ${DOWNSELL_MAX} downsells.` });
  const ids = new Set(flow.steps.map((s) => s.id));
  const upsellIds = new Set(flow.steps.filter((s) => s.kind === "UPSELL").map((s) => s.id));
  const attachedSeen = new Set<string>();
  for (const s of flow.steps) {
    const label = s.kind === "UPSELL" ? "upsell" : "downsell";
    if (!s.pageId) out.push({ stepId: s.id, message: `Escolha a página do ${label}.` });
    if (!s.linkKey) out.push({ stepId: s.id, message: `Escolha o produto (checkout) do ${label}.` });
    if (s.kind === "DOWNSELL" && s.attachedTo) {
      if (!upsellIds.has(s.attachedTo)) out.push({ stepId: s.id, message: "O upsell deste downsell não existe mais." });
      else if (attachedSeen.has(s.attachedTo))
        out.push({ stepId: s.id, message: "Esse upsell já tem um downsell atrelado." });
      else attachedSeen.add(s.attachedTo);
    }
  }
  if (!flow.thankYouPageId) out.push({ stepId: "flow", message: "Escolha a página de obrigado do fim." });
  // Páginas repetidas entre etapas confundem a sequência.
  const pages = flow.steps.map((s) => s.pageId).filter(Boolean) as string[];
  if (new Set(pages).size !== pages.length) out.push({ stepId: "flow", message: "Duas etapas usam a mesma página." });
  void ids;
  return out;
}
