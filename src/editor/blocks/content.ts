/**
 * Blocos básicos extras: lista com ícones, ícone/emoji e citação em destaque.
 */
import { C, type Def, el, icon, type OsBlock, onMobile, text } from "./shared";

/** Item de lista com um "✓" em círculo. */
export function checkItem(content: string, opts: { size?: string; color?: string } = {}): Def {
  return el(
    "li",
    "Item",
    {
      display: "flex",
      "align-items": "flex-start",
      gap: "12px",
      margin: "0 0 14px",
      "font-size": opts.size ?? "18px",
      "line-height": "1.5",
    },
    [
      text(
        "span",
        "✓",
        {
          display: "inline-flex",
          "align-items": "center",
          "justify-content": "center",
          "flex-shrink": "0",
          width: "1.45em",
          height: "1.45em",
          "margin-top": "0.02em",
          "border-radius": "50%",
          "background-color": opts.color ?? C.green,
          color: "#ffffff",
          "font-size": "0.8em",
          "font-weight": "800",
          "line-height": "1",
        },
        { name: "Ícone" },
      ),
      text("span", content, { flex: "1", "min-width": "0" }, { name: "Texto" }),
    ],
    { droppable: false },
  );
}

/** Lista (ul) sem marcadores, com itens de ícone. */
export function checkList(items: string[], style: Record<string, string> = {}, size?: string): Def {
  return el(
    "ul",
    "Lista com ícones",
    { "list-style": "none", padding: "0", margin: "0 auto 24px", "max-width": "680px", "text-align": "left", ...style },
    items.map((item) => checkItem(item, { size })),
  );
}

export const contentBlocks: OsBlock[] = [
  {
    id: "lista-icones",
    label: "Lista com ícones",
    category: "basicos",
    media: icon('<path d="m4 7 1.5 1.5L8 6M4 13l1.5 1.5L8 12M4 19l1.5 1.5L8 18M11 7h9M11 13h9M11 19h9"/>'),
    content: checkList([
      "Acesso imediato a todo o conteúdo, logo após a compra",
      "Aulas curtas e diretas, para assistir até pelo celular",
      "Suporte exclusivo para tirar suas dúvidas",
      "Certificado de conclusão",
    ]),
  },
  {
    id: "icone",
    label: "Ícone / emoji",
    category: "basicos",
    media: icon('<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>'),
    content: text(
      "div",
      "🚀",
      {
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        width: "76px",
        height: "76px",
        margin: "0 auto 16px",
        "border-radius": "22px",
        "background-color": "#eef2ff",
        "font-size": "38px",
        "line-height": "1",
      },
      { name: "Ícone" },
    ),
  },
  {
    id: "citacao",
    label: "Citação / destaque",
    category: "basicos",
    media: icon('<path d="M7 7h4v4c0 3-1.5 5-4 6M14 7h4v4c0 3-1.5 5-4 6"/>'),
    content: onMobile(
      el(
        "blockquote",
        "Citação",
        {
          margin: "32px auto",
          "max-width": "720px",
          padding: "24px 28px",
          "box-sizing": "border-box",
          "border-left": "5px solid #facc15",
          "border-radius": "0 16px 16px 0",
          "background-color": "#fefce8",
          color: C.text,
        },
        [
          onMobile(
            text(
              "p",
              "“Eu já tinha tentado de tudo. Em poucas semanas aplicando o método, vi resultados que não tinha visto em anos.”",
              {
                margin: "0 0 12px",
                "font-size": "21px",
                "line-height": "1.5",
                "font-style": "italic",
              },
            ),
            { "font-size": "18px" },
          ),
          text("cite", "— Mariana S., aluna", {
            display: "block",
            "font-size": "15px",
            "font-style": "normal",
            "font-weight": "700",
            color: C.muted,
          }),
        ],
      ),
      { padding: "20px" },
    ),
  },
];
