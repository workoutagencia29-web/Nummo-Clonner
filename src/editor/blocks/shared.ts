/** Tipos e utilitários comuns dos blocos do editor. */

export interface OsBlock {
  id: string;
  label: string;
  category: BlockCategory;
  /** Ícone SVG (24×24, stroke currentColor). */
  media: string;
  content: unknown;
  /** Seleciona o elemento ao soltar (mostra as Configurações dele na hora). */
  select?: boolean;
  /** Dispara a ação do elemento ao soltar (ex.: imagem abre os arquivos). */
  activate?: boolean;
}

export const BLOCK_CATEGORIES = {
  basicos: "Básicos",
  estrutura: "Estrutura",
  conversao: "Conversão",
  quiz: "Quiz e roleta",
  video: "Vídeo",
  prova: "Prova social",
  formularios: "Formulários",
  rodape: "Rodapé e políticas",
} as const;
export type BlockCategory = keyof typeof BLOCK_CATEGORIES;

/** Ícone SVG simples (usado pelos blocos). */
export function icon(paths: string) {
  return `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

// ─── Definições de componente ────────────────────────────────────────────────

export type Style = Record<string, string>;

/** Definição de componente do GrapesJS (o subconjunto que os blocos usam). */
export interface Def {
  type?: string;
  tagName?: string;
  name?: string;
  content?: string;
  attributes?: Record<string, string | boolean>;
  style?: Style;
  classes?: string[];
  components?: (Def | string)[] | string;
  [prop: string]: unknown;
}

/** Media query do modo "Celular" do editor (mesma largura do DEVICES em grapes/setup.ts). */
export const MOBILE_MEDIA = "(max-width: 480px)";

/**
 * Propriedades auxiliares lidas quando o bloco é solto na página (ver
 * src/editor/widgets/hooks.ts) e apagadas em seguida — não vão para o projeto.
 */
export const PROP_MOBILE = "osMobile";
export const PROP_AUTO_LINK = "osAutoLink";
export const PROP_LEGAL = "osLegal";

/** Elemento com estilo próprio (vira regra editável no painel Estilo). */
export function el(tagName: string, name: string, style: Style, components?: Def["components"], extra: Def = {}): Def {
  return { tagName, name, style, ...(components !== undefined && { components }), ...extra };
}

/** Texto editável com dois cliques. */
export function text(tagName: string, content: string, style: Style, extra: Def = {}): Def {
  return { type: "text", tagName, content, style, ...extra };
}

/** Ajustes só no celular (aparecem no modo "Celular" do editor). */
export function onMobile<T extends Def>(def: T, style: Style): T {
  return { ...def, [PROP_MOBILE]: style };
}

/** Escapa texto para HTML. */
export function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function svgData(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Imagem provisória ("Sua imagem aqui"), trocada com dois cliques. */
export function placeholderImage(label = "Sua imagem aqui", w = 800, h = 600) {
  const cx = w / 2;
  const cy = h / 2;
  return svgData(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#e8ebf2"/><g fill="none" stroke="#a3abbd" stroke-width="6" stroke-linejoin="round"><rect x="${cx - 60}" y="${cy - 70}" width="120" height="90" rx="10"/><path d="M${cx - 60} ${cy + 5}l35-30 25 22 20-16 40 34"/></g><circle cx="${cx + 25}" cy="${cy - 42}" r="10" fill="#a3abbd"/><text x="${cx}" y="${cy + 70}" font-family="system-ui,-apple-system,sans-serif" font-size="${Math.round(Math.min(w, h) / 18)}" font-weight="600" fill="#7b8499" text-anchor="middle">${esc(label)}</text></svg>`,
  );
}

/** Foto de perfil provisória (silhueta em círculo). */
export function placeholderAvatar(bg = "#dbe3f0") {
  return svgData(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><rect width="160" height="160" fill="${bg}"/><circle cx="80" cy="64" r="28" fill="#9aa5ba"/><path d="M28 150c6-32 26-48 52-48s46 16 52 48" fill="#9aa5ba"/></svg>`,
  );
}

/** Logo provisório (texto em cinza). */
export function placeholderLogo(label: string) {
  return svgData(
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80" viewBox="0 0 240 80"><text x="120" y="52" font-family="Georgia,serif" font-size="30" font-weight="700" fill="#8a93a6" text-anchor="middle">${esc(label)}</text></svg>`,
  );
}

/** Imagem editável (dois cliques abrem o gerenciador de arquivos). */
export function image(src: string, alt: string, style: Style, extra: Def = {}): Def {
  return { type: "image", name: "Imagem", attributes: { src, alt }, style, ...extra };
}

// ─── Paleta e medidas comuns ─────────────────────────────────────────────────

export const C = {
  text: "#111827",
  muted: "#4b5563",
  soft: "#6b7280",
  line: "#e5e7eb",
  bgSoft: "#f6f7fb",
  green: "#16a34a",
  greenDark: "#15803d",
  greenSoft: "#dcfce7",
  red: "#dc2626",
  yellow: "#facc15",
  navy: "#0f172a",
  blue: "#2563eb",
  white: "#ffffff",
} as const;

/** Título de seção (h2) com ajuste para celular. */
export function sectionTitle(content: string, extra: Style = {}): Def {
  return onMobile(
    text("h2", content, {
      "font-size": "36px",
      "font-weight": "800",
      "line-height": "1.2",
      "text-align": "center",
      margin: "0 0 12px",
      color: "inherit",
      ...extra,
    }),
    { "font-size": "27px" },
  );
}

/** Subtítulo de seção. */
export function sectionLead(content: string, extra: Style = {}): Def {
  return text("p", content, {
    "font-size": "19px",
    "line-height": "1.6",
    "text-align": "center",
    color: C.muted,
    margin: "0 auto 40px",
    "max-width": "720px",
    ...extra,
  });
}

/** Seção de largura total com conteúdo centralizado (máx. 1080px). */
export function section(name: string, children: Def[], style: Style = {}, innerStyle: Style = {}): Def {
  return onMobile(
    el("section", name, { padding: "80px 20px", "box-sizing": "border-box", ...style }, [
      el("div", "Conteúdo", { "max-width": "1080px", margin: "0 auto", ...innerStyle }, children),
    ]),
    { "padding-top": "48px", "padding-bottom": "48px" },
  );
}

/** Grade que vira uma coluna no celular sozinha (auto-fit). */
export function grid(name: string, minWidth: number, children: Def[], style: Style = {}): Def {
  return el(
    "div",
    name,
    {
      display: "grid",
      "grid-template-columns": `repeat(auto-fit, minmax(min(${minWidth}px, 100%), 1fr))`,
      gap: "24px",
      ...style,
    },
    children,
  );
}
