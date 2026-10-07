/**
 * Roleta de desconto (data-os-widget="wheel"): o formato das fatias e as contas
 * usadas pelo editor (lista de fatias e desenho), pelo servidor (prêmios da
 * oferta, avisos) e pelo script das páginas (sorteio e parada na fatia). Sem
 * dependências: entra no script das páginas (src/runtime/widgets/wheel.ts).
 *
 * As fatias ficam no atributo data-os-slices do elemento da roleta, em JSON:
 * [{ "text": "30% OFF", "color": "#7c3aed", "chance": 20, "link": "checkout-30",
 *    "coupon": "ROLETA30" }, { "text": "Não foi dessa vez", "lose": true, … }]
 *
 * - chance: peso da fatia (1 a 100). Toda fatia tem chance real de sair
 *   (mínimo 1): uma fatia que nunca sai pode ser propaganda enganosa. As chances
 *   não precisam somar 100: cada fatia sai na proporção do número dela.
 * - link: chave do link da oferta com o desconto ("" = ainda sem link, o painel
 *   e o ZIP avisam). Fatia "lose" não tem prêmio ("Não foi dessa vez").
 * - coupon: cupom só para mostrar ao visitante (com botão copiar).
 */

export interface WheelSlice {
  text: string;
  color: string;
  /** Peso (1 a 100). */
  chance: number;
  /** Chave do link da oferta do prêmio ("" = sem link ainda). */
  link: string;
  /** Cupom mostrado ao visitante ("" = sem cupom). */
  coupon: string;
  /** Fatia sem prêmio ("Não foi dessa vez"). */
  lose?: boolean;
}

export const WHEEL_MIN_SLICES = 2;
export const WHEEL_MAX_SLICES = 12;
export const WHEEL_MIN_CHANCE = 1;
export const WHEEL_MAX_CHANCE = 100;
/** Dias que o prêmio fica guardado (padrão). */
export const WHEEL_DAYS = 7;
/** Minutos do contador da faixa na página de vendas (padrão). */
export const WHEEL_MINUTES = 10;

/** Cores das fatias novas (em ordem). */
export const WHEEL_COLORS = [
  "#7c3aed",
  "#f59e0b",
  "#ec4899",
  "#10b981",
  "#3b82f6",
  "#ef4444",
  "#14b8a6",
  "#f97316",
  "#8b5cf6",
  "#eab308",
  "#06b6d4",
  "#84cc16",
];

/** Chave de link da oferta (minúsculas, números e hífen). */
const KEY_RE = /^[a-z0-9-]{1,80}$/;
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Chance aceita: inteiro de 1 a 100 (o que vier fora disso é ajustado). */
export function clampChance(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
  if (!Number.isFinite(n)) return WHEEL_MIN_CHANCE;
  return Math.min(WHEEL_MAX_CHANCE, Math.max(WHEEL_MIN_CHANCE, Math.round(n)));
}

/** Fatia arrumada (texto, cor, chance e link válidos). */
export function cleanSlice(raw: unknown, i: number): WheelSlice {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const color = str(o.color, 20);
  const link = str(o.link, 80);
  const lose = o.lose === true;
  const slice: WheelSlice = {
    text: str(o.text, 40) || (lose ? "Não foi dessa vez" : `Prêmio ${i + 1}`),
    color: HEX_RE.test(color) ? color : WHEEL_COLORS[i % WHEEL_COLORS.length],
    chance: clampChance(o.chance),
    link: !lose && KEY_RE.test(link) ? link : "",
    coupon: lose ? "" : str(o.coupon, 40),
  };
  if (lose) slice.lose = true;
  return slice;
}

/** Fatias de data-os-slices (JSON). Texto inválido = nenhuma fatia; no máximo 12. */
export function parseSlices(raw: string | null | undefined): WheelSlice[] {
  let list: unknown;
  try {
    list = JSON.parse(raw || "[]");
  } catch {
    return [];
  }
  return Array.isArray(list) ? list.slice(0, WHEEL_MAX_SLICES).map(cleanSlice) : [];
}

export const serializeSlices = (slices: WheelSlice[]) => JSON.stringify(slices.map(cleanSlice));

/**
 * Sorteio pelo peso: `r` de 0 (inclusive) a 1 (exclusive), como Math.random().
 * Devolve o índice da fatia.
 */
export function pickSlice(chances: number[], r: number): number {
  const total = chances.reduce((s, c) => s + c, 0);
  let at = Math.min(Math.max(r, 0), 0.999999999) * total;
  for (let i = 0; i < chances.length; i++) {
    at -= chances[i];
    if (at < 0) return i;
  }
  return chances.length - 1;
}

/** Chance real de cada fatia em % (arredondada), pelos pesos. */
export function realChances(chances: number[]): number[] {
  const total = chances.reduce((s, c) => s + c, 0) || 1;
  return chances.map((c) => Math.round((c / total) * 1000) / 10);
}

/**
 * Giro final (graus, sentido horário) para o ponteiro do topo parar dentro da
 * fatia `index` (de `count`): depois de `turns` voltas a partir de `from`. `r`
 * (0 a 1) escolhe o ponto dentro da fatia, longe das bordas (entre 15% e 85%).
 * A fatia i ocupa, no disco parado, de i·(360/count) a (i+1)·(360/count)
 * graus a partir do topo.
 */
export function stopRotation(index: number, count: number, from: number, turns: number, r: number): number {
  const seg = 360 / count;
  const at = (index + 0.15 + 0.7 * Math.min(Math.max(r, 0), 1)) * seg;
  const base = from - (((from % 360) + 360) % 360);
  return base + turns * 360 + (360 - at);
}

/** Fatia sob o ponteiro do topo com o disco girado `deg` graus. */
export function sliceAt(deg: number, count: number): number {
  const a = (((360 - deg) % 360) + 360) % 360;
  return Math.min(count - 1, Math.floor(a / (360 / count)));
}

/** Texto escuro ou claro sobre a cor (contraste). */
export function inkOn(hex: string): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  // Sem desestruturação: o script das páginas mira o Safari 13.
  const lin = (i: number) => {
    const c = Number.parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
  return lum > 0.42 ? "#1f2937" : "#ffffff";
}

const escXml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Texto da fatia em até duas linhas (quebra no espaço mais perto do meio). */
function lines(text: string): string[] {
  if (text.length <= 11 || !text.includes(" ")) return [text];
  const mid = text.length / 2;
  let cut = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === " " && (cut < 0 || Math.abs(i - mid) < Math.abs(cut - mid))) cut = i;
  }
  return [text.slice(0, cut), text.slice(cut + 1)];
}

/**
 * Desenho da roda (SVG): fatias, divisórias, luzes na borda e o texto de cada
 * fatia do centro para a borda. A borda usa currentColor (cor da borda da
 * roleta, no CSS). O disco parado tem a fatia 0 começando no topo.
 */
export function wheelSvg(slices: WheelSlice[]): string {
  const n = Math.max(slices.length, 1);
  const seg = 360 / n;
  const R = 100;
  const xy = (deg: number, r: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [r2(Math.cos(a) * r), r2(Math.sin(a) * r)];
  };
  const point = (deg: number, r: number) => xy(deg, r).join(" ");
  const fs = n <= 4 ? 15 : n <= 6 ? 13 : n <= 8 ? 11 : 9.5;
  const parts: string[] = ['<circle r="110" fill="currentColor"/>'];
  slices.forEach((s, i) => {
    const a0 = i * seg;
    const a1 = (i + 1) * seg;
    parts.push(
      `<path d="M0 0L${point(a0, R)}A${R} ${R} 0 ${seg > 180 ? 1 : 0} 1 ${point(a1, R)}Z" fill="${s.color}"/>`,
    );
  });
  if (n > 1) {
    for (let i = 0; i < n; i++) {
      parts.push(`<path d="M0 0L${point(i * seg, R)}" stroke="#fff" stroke-opacity=".55" stroke-width="1.2"/>`);
    }
  }
  // Luzes da borda: duas por fatia.
  for (let i = 0; i < n * 2; i++) {
    const at = xy((i * seg) / 2, 105);
    parts.push(`<circle cx="${at[0]}" cy="${at[1]}" r="2.4" fill="#fde68a"/>`);
  }
  slices.forEach((s, i) => {
    const mid = (i + 0.5) * seg - 90;
    const ls = lines(s.text);
    // Cabe entre o centro (r 27) e a borda (r 91): letra menor para texto comprido.
    const longest = Math.max(...ls.map((l) => l.length), 1);
    const size = r2(Math.min(fs, 64 / (longest * 0.64)));
    const dy = ls.length > 1 ? -size * 0.55 : 0;
    // Na metade esquerda o texto vira 180° (lido da borda para o centro, sem ficar de cabeça para baixo).
    const left = Math.cos((mid * Math.PI) / 180) < -0.01;
    const x = left ? -91 : 91;
    const spans = ls.map((l, k) => `<tspan x="${x}" dy="${k ? r2(size * 1.1) : r2(dy)}">${escXml(l)}</tspan>`).join("");
    parts.push(
      `<text transform="rotate(${r2(left ? mid + 180 : mid)})" text-anchor="${left ? "start" : "end"}" dominant-baseline="central" font-size="${size}" font-weight="800" fill="${inkOn(s.color)}">${spans}</text>`,
    );
  });
  const label = `Roleta com ${n} fatias: ${slices.map((s) => s.text).join(", ")}`;
  // Sem xmlns: o SVG vai dentro do HTML (o modelo de página não cita endereço nenhum).
  return `<svg viewBox="-110 -110 220 220" role="img" aria-label="${escXml(label)}">${parts.join("")}</svg>`;
}

/** Assinatura curta das fatias (a roleta "é a mesma" para quem volta à página). */
export function sliceSignature(slices: WheelSlice[]): string {
  return shortHash(slices.map((s) => `${s.text}|${s.chance}|${s.link}|${s.lose ? 1 : 0}`).join("§"));
}

// ─── Prêmio levado à página de vendas ────────────────────────────────────────

/** Parâmetro da URL com o prêmio: os_premio=<identificador do prêmio>.<validade em base 36>. */
export const PRIZE_PARAM = "os_premio";
/** Atributo da visibilidade condicional ("ganhou" | "nao"). */
export const PRIZE_SHOW_ATTR = "data-os-premio";
/** JSON com os prêmios da oferta, embutido pelo render (identificador do prêmio → prêmio). */
export const PRIZE_MAP_ID = "os-premios";
/** Botões de checkout (links da oferta do tipo checkout), marcados pelo render. */
export const LINK_KIND_ATTR = "data-os-link-kind";
/**
 * Código da oferta (no mapa de prêmios e em cada roleta, posto pelo render): a
 * memória da roleta e o prêmio guardado ficam separados por oferta — duas
 * ofertas no mesmo domínio (ou ZIPs abertos do computador) não dividem o giro.
 */
export const SCOPE_ATTR = "data-os-oferta";

/** Prêmio no mapa embutido na página (nomes curtos: vai em todas as páginas). */
export interface PrizeInfo {
  /** Endereço do link do prêmio (checkout com desconto). Ausente quando o prêmio é pagamento na página (`p`). */
  u?: string;
  /**
   * Link do prêmio do tipo "Pagamento na página": chave do produto (com o
   * preço com desconto) que os botões de compra passam a abrir (data-os-pay).
   */
  p?: string;
  /** Texto da fatia ("30% OFF"). */
  t: string;
  /** Cupom ("" = sem). */
  c: string;
  /** Dias que o prêmio fica guardado. */
  d: number;
  /** Minutos do contador da faixa (0 = sem contador). */
  m: number;
  /** Mostrar a faixa na página de vendas (1/0). */
  b: number;
}

export type PrizeMap = Record<string, PrizeInfo>;

/** Hash curto (djb2, base 36). */
function shortHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Código curto da oferta para separar a memória da roleta (SCOPE_ATTR). */
export const offerScope = (offerId: string) => shortHash(`oferta:${offerId}`);

/** Chave do armazenamento separada por oferta ("" = página sem o código: a chave de sempre). */
export const scopedKey = (base: string, scope: string) => (scope ? `${base}:${scope}` : base);

/**
 * Identificador do prêmio de uma fatia: a chave do link + um código do texto e
 * do cupom ("checkout-30-k2x9a"). O mesmo link em duas fatias com textos
 * diferentes ("10% OFF" e "Frete grátis") vira dois prêmios: a faixa da página
 * de vendas mostra o texto certo.
 */
export const prizeId = (s: Pick<WheelSlice, "link" | "text" | "coupon">) =>
  `${s.link}-${shortHash(`${s.text}|${s.coupon}`).slice(0, 6)}`;

/** Valor do parâmetro os_premio (identificador do prêmio + validade). */
export const prizeParam = (id: string, until: number) => `${id}.${Math.floor(until).toString(36)}`;

/** Lê o parâmetro os_premio (null = formato inválido). */
export function parsePrizeParam(v: string | null): { key: string; until: number } | null {
  const m = /^([a-z0-9-]{1,90})\.([0-9a-z]{1,12})$/.exec(v || "");
  if (!m) return null;
  const until = Number.parseInt(m[2], 36);
  return Number.isFinite(until) ? { key: m[1], until } : null;
}

/** Número de um atributo da roleta, limitado (vírgula decimal aceita). */
export function wheelNumber(raw: string | null | undefined, def: number, min: number, max: number): number {
  const n = raw ? Number(String(raw).trim().replace(",", ".")) : Number.NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
}
