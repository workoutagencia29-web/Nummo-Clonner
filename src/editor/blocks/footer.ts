/**
 * Rodapé com links de Termos de uso e Política de privacidade (ligados às
 * páginas legais do funil quando existem), "Preferências de cookies" (reabre o
 * aviso de cookies da LGPD), copyright com o ano atual e o aviso legal comum
 * em ofertas brasileiras.
 */
import { C, type Def, el, icon, type OsBlock, PROP_LEGAL, type Style, text } from "./shared";

export const DISCLAIMER =
  "Este site não é afiliado ao Facebook, ao Instagram, ao Google nem a qualquer entidade dessas empresas. " +
  "Depois que você sai dessas plataformas, a responsabilidade pelo conteúdo desta página é nossa, e não delas. " +
  "Os resultados apresentados são de pessoas reais, mas podem variar de pessoa para pessoa e não são garantidos. " +
  "Facebook e Instagram são marcas registradas da Meta Platforms, Inc.";

function legalLink(label: string, which: "terms" | "privacy"): Def {
  return text(
    "a",
    label,
    { color: "#e2e8f0", "text-decoration": "underline", "font-size": "14px" },
    {
      type: "link",
      name: label,
      attributes: { href: "#", target: "_blank" },
      [PROP_LEGAL]: which,
    },
  );
}

/**
 * "Preferências de cookies": o script de rastreamento das páginas reabre o
 * aviso de cookies no clique em qualquer elemento com data-os-consent-open.
 */
function consentLink(style: Style): Def {
  return text("a", "Preferências de cookies", style, {
    type: "link",
    name: "Preferências de cookies",
    attributes: { href: "#", "data-os-consent-open": "" },
  });
}

const year = String(new Date().getFullYear());

const footer = el(
  "footer",
  "Rodapé",
  {
    padding: "44px 20px 36px",
    "box-sizing": "border-box",
    "background-color": "#0f172a",
    color: "#cbd5e1",
    "font-size": "14px",
    "line-height": "1.6",
    "text-align": "center",
  },
  [
    el("div", "Conteúdo do rodapé", { "max-width": "960px", margin: "0 auto" }, [
      el(
        "nav",
        "Links do rodapé",
        { display: "flex", "flex-wrap": "wrap", "justify-content": "center", gap: "8px 28px", margin: "0 0 18px" },
        [
          legalLink("Termos de uso", "terms"),
          legalLink("Política de privacidade", "privacy"),
          consentLink({ color: "#e2e8f0", "text-decoration": "underline", "font-size": "14px" }),
        ],
      ),
      text("p", `© <span data-os-year="">${year}</span> Nome da sua empresa. Todos os direitos reservados.`, {
        margin: "0 0 4px",
      }),
      text("p", "CNPJ 00.000.000/0001-00 &nbsp;·&nbsp; contato@seusite.com.br", { margin: "0", color: "#94a3b8" }),
      text("p", DISCLAIMER, {
        margin: "22px auto 0",
        "max-width": "820px",
        "font-size": "12px",
        "line-height": "1.6",
        color: "#94a3b8",
      }),
    ]),
  ],
);

const disclaimer = text(
  "p",
  DISCLAIMER,
  {
    margin: "24px auto",
    padding: "0 20px",
    "max-width": "820px",
    "box-sizing": "border-box",
    "font-size": "12px",
    "line-height": "1.6",
    color: C.soft,
    "text-align": "center",
  },
  { name: "Aviso legal" },
);

export const footerBlocks: OsBlock[] = [
  {
    id: "rodape",
    label: "Rodapé com políticas",
    category: "rodape",
    media: icon('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 15h18M7 17.5h4M13 17.5h4"/>'),
    content: footer,
  },
  {
    id: "aviso-legal",
    label: "Aviso legal",
    category: "rodape",
    media: icon('<path d="M12 3 4 6v6c0 4.4 3.4 8 8 9 4.6-1 8-4.6 8-9V6z"/><path d="M12 8v5M12 16h.01"/>'),
    content: disclaimer,
  },
  {
    // Só o link, para pôr no rodapé que a página já tem (páginas clonadas).
    id: "preferencias-cookies",
    label: "Preferências de cookies",
    category: "rodape",
    media: icon(
      '<path d="M20.5 12.5A8.5 8.5 0 1 1 11.5 3.5a3 3 0 0 0 4 3.5 3 3 0 0 0 3.5 4 3 3 0 0 0 1.5 1.5z"/><path d="M8.5 9.5h.01M8 14h.01M12.5 16.5h.01M13 11.5h.01"/>',
    ),
    content: consentLink({ color: "inherit", "text-decoration": "underline", "font-size": "14px" }),
  },
];
