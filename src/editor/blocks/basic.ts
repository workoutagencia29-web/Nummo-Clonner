/**
 * Blocos básicos e de estrutura: título, texto, botão, imagem, seções e colunas.
 */
import { icon, type OsBlock } from "./shared";

const section = (children: unknown[], style: Record<string, string> = {}) => ({
  tagName: "section",
  name: "Seção",
  style: { padding: "64px 20px", ...style },
  components: [
    {
      name: "Conteúdo",
      style: { "max-width": "1080px", margin: "0 auto" },
      components: children,
    },
  ],
});

export const basicBlocks: OsBlock[] = [
  {
    id: "titulo",
    label: "Título",
    category: "basicos",
    media: icon('<path d="M5 5v14M13 5v14M5 12h8M17 9l2-1v11"/>'),
    content: {
      type: "text",
      tagName: "h2",
      content: "Escreva aqui uma headline forte",
      style: {
        "font-size": "40px",
        "font-weight": "800",
        "line-height": "1.15",
        margin: "0 0 16px",
        "text-align": "center",
      },
    },
  },
  {
    id: "texto",
    label: "Texto",
    category: "basicos",
    media: icon('<path d="M4 6h16M4 10h16M4 14h10M4 18h13"/>'),
    content: {
      type: "text",
      tagName: "p",
      content: "Escreva aqui o seu texto. Clique duas vezes para editar, use a barra para negrito, links e cores.",
      style: { "font-size": "18px", "line-height": "1.6", margin: "0 0 16px" },
    },
  },
  {
    id: "botao",
    label: "Botão",
    category: "basicos",
    media: icon('<rect x="3" y="8" width="18" height="8" rx="3"/><path d="M8 12h8"/>'),
    content: {
      type: "link",
      tagName: "a",
      attributes: { href: "#" },
      content: "QUERO COMEÇAR AGORA",
      style: {
        display: "inline-block",
        padding: "18px 36px",
        "border-radius": "10px",
        background: "#16a34a",
        color: "#ffffff",
        "font-weight": "800",
        "font-size": "20px",
        "text-decoration": "none",
        "text-align": "center",
        "box-shadow": "0 8px 20px rgba(22,163,74,.35)",
      },
    },
  },
  {
    id: "imagem",
    label: "Imagem",
    category: "basicos",
    media: icon(
      '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-8 8"/>',
    ),
    content: {
      type: "image",
      activate: true,
      style: { "max-width": "100%", height: "auto", display: "block", margin: "0 auto" },
    },
  },
  {
    id: "espacador",
    label: "Espaço",
    category: "basicos",
    media: icon('<path d="M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4"/>'),
    content: { name: "Espaço", style: { height: "48px" } },
  },
  {
    id: "divisor",
    label: "Divisor",
    category: "basicos",
    media: icon('<path d="M3 12h18"/>'),
    content: {
      tagName: "hr",
      name: "Divisor",
      style: { border: "0", "border-top": "1px solid #e3e6ee", margin: "32px 0" },
    },
  },
  {
    id: "secao",
    label: "Seção",
    category: "estrutura",
    media: icon('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>'),
    content: section([
      {
        type: "text",
        tagName: "h2",
        content: "Título da seção",
        style: { "font-size": "34px", "font-weight": "800", "text-align": "center", margin: "0 0 16px" },
      },
      {
        type: "text",
        tagName: "p",
        content: "Arraste blocos para dentro desta seção.",
        style: { "text-align": "center", "font-size": "18px", color: "#4b5163" },
      },
    ]),
  },
  ...[2, 3].map(
    (n): OsBlock => ({
      id: `colunas-${n}`,
      label: `${n} colunas`,
      category: "estrutura",
      media: icon(
        n === 2
          ? '<rect x="3" y="5" width="8" height="14" rx="1.5"/><rect x="13" y="5" width="8" height="14" rx="1.5"/>'
          : '<rect x="2" y="5" width="6" height="14" rx="1.5"/><rect x="9" y="5" width="6" height="14" rx="1.5"/><rect x="16" y="5" width="6" height="14" rx="1.5"/>',
      ),
      content: {
        name: `${n} colunas`,
        style: {
          display: "grid",
          "grid-template-columns": `repeat(auto-fit, minmax(${n === 2 ? 280 : 220}px, 1fr))`,
          gap: "24px",
          padding: "16px 0",
        },
        components: Array.from({ length: n }, (_, i) => ({
          name: `Coluna ${i + 1}`,
          style: { "min-height": "80px", padding: "12px" },
          components: [{ type: "text", tagName: "p", content: `Conteúdo da coluna ${i + 1}` }],
        })),
      },
    }),
  ),
];
