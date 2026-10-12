/**
 * Mapa do funil da revisão da clonagem (clonar o funil inteiro): as páginas
 * clonadas em etapas (quiz → roleta → loja → produtos → …), sem React.
 * Testado em tests/unit/clone-funnel-map.test.ts.
 */
import type { CloneStatus } from "@/server/services/clone";
import type { CloneModeValue, FunnelPageKind } from "@/worker/clone/types";

export const KIND_LABEL: Record<FunnelPageKind, string> = {
  QUIZ: "Quiz",
  WHEEL: "Roleta",
  STORE: "Loja",
  PRODUCT: "Produto",
  VSL: "VSL",
  SALES: "Página de vendas",
  CAPTURE: "Captura",
  UPSELL: "Upsell",
  DOWNSELL: "Downsell",
  THANK_YOU: "Obrigado",
  OTHER: "Página",
};

type Child = CloneStatus["children"][number];

export interface MapNode {
  id: string;
  root: boolean;
  status: Child["status"];
  progress: number;
  name: string;
  kind: FunnelPageKind | null;
  /** Endereço original (para mostrar o caminho). */
  url: string | null;
  thumbnailKey: string | null;
  suggestedMode: CloneModeValue | null;
  /** Clonagem da página que leva a esta (null na principal). */
  from: string | null;
  depth: number;
  order: number;
  via: string;
  linkLabel: string;
  errorMessage: string | null;
  checkouts: number;
  checkoutPlatform: string | null;
  devices: Child["devices"];
  /** Produto (cartão da loja). */
  product: boolean;
  /** Por que o robô parou de clicar na página (quiz, roleta); null = não clicou. */
  exploreStop: string | null;
  /** Aviso do mapa: o robô não achou para onde a página leva (ver `dead end`). */
  note?: string;
}

export interface MapLevel {
  depth: number;
  /** Páginas da etapa (fora os produtos agrupados). */
  pages: MapNode[];
  /** Produtos da etapa (cartões da loja), mostrados juntos quando são 3 ou mais. */
  products: MapNode[];
  /** Como se chega a esta etapa (texto da seta): botão “…”, N produtos, links da página. */
  arrow: string;
}

/** "/produto/camiseta-azul" (curto). */
export function shortPath(url: string | null): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    let path = u.pathname;
    try {
      path = decodeURIComponent(path);
    } catch {
      // mantém
    }
    path = path.replace(/\/+$/, "") || "/";
    return path.length > 48 ? `…${path.slice(-47)}` : path;
  } catch {
    return url;
  }
}

export function childNode(c: Child): MapNode {
  return {
    id: c.id,
    root: false,
    status: c.status,
    progress: c.progress,
    name: c.name || c.title || c.linkLabel || shortPath(c.sourceUrl) || "Página",
    kind: c.kind,
    url: c.sourceUrl,
    thumbnailKey: c.thumbnailKey,
    suggestedMode: c.suggestedMode,
    from: c.from,
    depth: c.depth,
    order: c.order,
    via: c.via,
    linkLabel: c.linkLabel,
    errorMessage: c.errorMessage,
    checkouts: c.checkouts,
    checkoutPlatform: c.checkoutPlatform,
    devices: c.devices,
    // Ainda clonando, o tipo não existe: o cartão da loja já diz que é produto.
    product: c.kind === "PRODUCT" || (c.kind === null && c.product),
    exploreStop: c.exploreStop,
  };
}

/**
 * Uma página por endereço: a mesma página clonada de novo (depois de falhar ou
 * ser cancelada) vale pela tentativa mais recente; tentativas ativas nunca são
 * escondidas por uma falha. Fora: canceladas e repetidas (abriram outra página).
 */
export function visibleChildren(children: Child[]): Child[] {
  const byKey = new Map<string, Child>();
  const active = (c: Child) => c.status !== "FAILED" && c.status !== "CANCELED";
  for (const c of children) {
    if (c.duplicate) continue;
    const key = c.matchKey ?? c.sourceUrl ?? c.id;
    const prev = byKey.get(key);
    if (!prev || active(c) || !active(prev)) byKey.set(key, c);
  }
  const shown = new Set(byKey.values());
  return children.filter((c) => shown.has(c) && c.status !== "CANCELED");
}

/** Texto da seta que leva a uma etapa. */
function arrowText(nodes: MapNode[], products: MapNode[]): string {
  if (products.length && !nodes.length) return `${products.length} ${products.length === 1 ? "produto" : "produtos"}`;
  const labels = [...new Set(nodes.map((n) => n.linkLabel.trim()).filter(Boolean))];
  if (nodes.length === 1 && labels.length === 1) {
    const how = nodes[0].via === "code" ? "No código da página" : "Botão";
    return nodes[0].via === "code" ? how : `${how} “${labels[0]}”`;
  }
  return nodes.every((n) => n.via === "manual") ? "Páginas que você colou" : "Botões e links da página";
}

/**
 * Etapas do funil: a principal, depois cada nível (na ordem em que as páginas
 * foram achadas, seguindo a ordem das páginas de origem). Produtos de uma
 * etapa ficam juntos quando são 3 ou mais.
 */
export function funnelLevels(root: MapNode, children: Child[]): MapLevel[] {
  const nodes = visibleChildren(children).map(childNode);
  // Quiz/roleta sem próxima página (pronta): o robô parou num formulário ou não achou o botão.
  const leadsSomewhere = new Set(nodes.map((n) => n.from));
  for (const n of [root, ...nodes]) {
    if (n.status !== "REVIEW" || leadsSomewhere.has(n.id)) continue;
    if (n.exploreStop === "contact") {
      n.note =
        "O robô parou numa etapa que pede e-mail ou telefone (ele não preenche contato). Se faltou a próxima página, cole o link dela em “Adicionar páginas ao funil”.";
    } else if ((n.kind === "QUIZ" || n.kind === "WHEEL") && n.exploreStop && n.exploreStop !== "navigated") {
      n.note =
        "O robô não achou para onde esta página leva. Se faltou a próxima página, cole o link dela em “Adicionar páginas ao funil”.";
    }
  }
  const position = new Map<string, number>([[root.id, 0]]);
  const levels: MapLevel[] = [{ depth: 0, pages: [root], products: [], arrow: "" }];
  const depths = [...new Set(nodes.map((n) => n.depth))].sort((a, b) => a - b);
  for (const depth of depths) {
    const here = nodes
      .filter((n) => n.depth === depth)
      .map((n, i) => ({ n, i }))
      .sort(
        (a, b) =>
          (position.get(a.n.from ?? "") ?? 9999) - (position.get(b.n.from ?? "") ?? 9999) ||
          a.n.order - b.n.order ||
          a.i - b.i,
      )
      .map((x) => x.n);
    for (const n of here) position.set(n.id, position.size);
    const products = here.filter((n) => n.product);
    const grouped = products.length >= 3 ? products : [];
    const pages = here.filter((n) => !grouped.includes(n));
    levels.push({ depth, pages, products: grouped, arrow: arrowText(pages, grouped) });
  }
  return levels;
}

export interface FunnelProgress {
  /** Páginas prontas (contando a principal). */
  ready: number;
  /** Páginas no mapa (contando a principal). */
  total: number;
  /** Na fila ou clonando. */
  running: number;
  failed: number;
}

export function funnelProgress(children: Child[]): FunnelProgress {
  const shown = visibleChildren(children);
  return {
    ready: 1 + shown.filter((c) => c.status === "REVIEW").length,
    total: 1 + shown.length,
    running: shown.filter((c) => c.status === "QUEUED" || c.status === "RUNNING").length,
    failed: shown.filter((c) => c.status === "FAILED").length,
  };
}

/** Resumo do caminho: "Quiz → Roleta → Loja → 4 produtos". */
export function funnelSummary(levels: MapLevel[]): string {
  return levels
    .map((l) => {
      const parts = l.pages.map((p) => (p.kind ? KIND_LABEL[p.kind] : p.name));
      const unique = [...new Set(parts)];
      const pages =
        unique.length === 1 && parts.length > 1 ? `${parts.length} × ${unique[0]}` : unique.slice(0, 3).join(" + ");
      const products = l.products.length ? `${l.products.length} produtos` : "";
      return [pages, products].filter(Boolean).join(" + ");
    })
    .filter(Boolean)
    .join(" → ");
}
