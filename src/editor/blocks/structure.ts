/**
 * Blocos de estrutura: topo (hero) com imagem ou com vídeo, seção colorida,
 * container centralizado, cartão e perguntas frequentes. (Seção e colunas
 * ficam em basic.ts.)
 */
import { buttonDef } from "@/editor/widgets/button";
import { videoEmbedDef } from "@/editor/widgets/video";
import {
  C,
  type Def,
  el,
  icon,
  image,
  type OsBlock,
  onMobile,
  placeholderImage,
  section,
  sectionLead,
  sectionTitle,
  text,
} from "./shared";

const badge = (content: string, style: Record<string, string> = {}): Def =>
  text(
    "p",
    content,
    {
      display: "inline-block",
      margin: "0 0 18px",
      padding: "7px 14px",
      "border-radius": "999px",
      "background-color": "#dcfce7",
      color: C.greenDark,
      "font-size": "13px",
      "font-weight": "800",
      "letter-spacing": "0.08em",
      ...style,
    },
    { name: "Selo" },
  );

const trustLine = (color: string, align = "left"): Def =>
  onMobile(
    text("p", "✔ Acesso imediato &nbsp;&nbsp; ✔ Garantia de 7 dias &nbsp;&nbsp; ✔ Pagamento seguro", {
      margin: "16px 0 0",
      "font-size": "14px",
      color,
      "text-align": align,
    }),
    { "text-align": "center" },
  );

const hero = section(
  "Topo (hero)",
  [
    el("div", "Colunas do topo", { display: "flex", "flex-wrap": "wrap", "align-items": "center", gap: "48px" }, [
      onMobile(
        el("div", "Texto do topo", { flex: "1 1 420px", "min-width": "0" }, [
          badge("MÉTODO COMPROVADO"),
          onMobile(
            text(
              "h1",
              'Descubra o método simples para <span style="color:#16a34a">conquistar o resultado que você quer</span> em 30 dias',
              {
                margin: "0 0 18px",
                "font-size": "48px",
                "font-weight": "800",
                "line-height": "1.12",
                "letter-spacing": "-0.02em",
                color: C.text,
              },
            ),
            { "font-size": "31px" },
          ),
          onMobile(
            text(
              "p",
              "Um passo a passo prático, testado por milhares de pessoas, para você sair do zero e ver resultado de verdade — mesmo sem experiência.",
              {
                margin: "0 0 28px",
                "font-size": "20px",
                "line-height": "1.6",
                color: C.muted,
              },
            ),
            { "font-size": "18px" },
          ),
          buttonDef("QUERO COMEÇAR AGORA", { style: { margin: "0" } }),
          trustLine(C.soft),
        ]),
        { "text-align": "center" },
      ),
      el("div", "Imagem do topo", { flex: "1 1 360px", "min-width": "0" }, [
        image(placeholderImage("Imagem do produto", 900, 720), "Imagem do produto", {
          display: "block",
          width: "100%",
          height: "auto",
          "border-radius": "20px",
          "box-shadow": "0 24px 60px rgba(15,23,42,.18)",
        }),
      ]),
    ]),
  ],
  { "background-image": "linear-gradient(180deg,#f3f6ff 0%,#ffffff 100%)", "padding-top": "72px" },
);

const heroVsl = section(
  "Topo com vídeo (VSL)",
  [
    badge("ASSISTA ATÉ O FINAL", { "background-color": "rgba(250,204,21,.15)", color: "#facc15" }),
    onMobile(
      text(
        "h1",
        'Assista ao vídeo abaixo e descubra como <span style="color:#facc15">transformar seus resultados</span> ainda este mês',
        {
          margin: "0 auto 16px",
          "max-width": "900px",
          "font-size": "44px",
          "font-weight": "800",
          "line-height": "1.15",
          "letter-spacing": "-0.02em",
          color: "#ffffff",
        },
      ),
      { "font-size": "28px" },
    ),
    text("p", "⚠️ Aumente o volume: o vídeo pode demorar alguns segundos para carregar.", {
      margin: "0 auto 28px",
      "font-size": "17px",
      color: "#cbd5e1",
    }),
    videoEmbedDef("youtube", "", { "max-width": "860px" }),
    el("div", "Área do botão", { margin: "32px auto 0", "max-width": "620px" }, [
      buttonDef("QUERO GARANTIR MINHA VAGA", { checkout: true, pulse: true, style: { width: "100%" } }),
      trustLine("#94a3b8", "center"),
    ]),
  ],
  { "background-color": "#0b1220", "text-align": "center", "padding-top": "56px" },
);

const coloredSection = section(
  "Seção colorida",
  [
    sectionTitle("Chegou a hora de dar o próximo passo", { color: "#ffffff" }),
    sectionLead("Milhares de pessoas já mudaram de vida com este método. Agora é a sua vez.", {
      color: "rgba(255,255,255,.85)",
      "margin-bottom": "32px",
    }),
    buttonDef("QUERO FAZER PARTE", {
      style: { "background-color": "#facc15", color: "#111827", "box-shadow": "0 10px 24px rgba(0,0,0,.25)" },
    }),
  ],
  {
    "background-color": "#4f46e5",
    "background-image": "linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%)",
    color: "#ffffff",
    "text-align": "center",
  },
);

const container = el(
  "div",
  "Container",
  { "max-width": "1080px", margin: "0 auto", padding: "24px 20px", "box-sizing": "border-box", "min-height": "80px" },
  [
    text("p", "Arraste blocos para dentro deste container (largura máxima de 1080px, centralizado).", {
      margin: "0",
      color: C.soft,
      "text-align": "center",
    }),
  ],
);

const card = el(
  "div",
  "Cartão",
  {
    "max-width": "420px",
    margin: "0 auto",
    padding: "28px",
    "box-sizing": "border-box",
    "border-radius": "18px",
    border: "1px solid #e5e7eb",
    "background-color": "#ffffff",
    "box-shadow": "0 10px 30px rgba(15,23,42,.07)",
    "text-align": "left",
  },
  [
    text(
      "div",
      "💡",
      {
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        width: "52px",
        height: "52px",
        margin: "0 0 16px",
        "border-radius": "14px",
        "background-color": "#eef2ff",
        "font-size": "26px",
        "line-height": "1",
      },
      { name: "Ícone" },
    ),
    text("h3", "Título do cartão", { margin: "0 0 8px", "font-size": "22px", "font-weight": "800", color: C.text }),
    text("p", "Descreva aqui um benefício, um módulo do curso ou um bônus. Textos curtos e diretos funcionam melhor.", {
      margin: "0",
      "font-size": "17px",
      "line-height": "1.6",
      color: C.muted,
    }),
  ],
);

const FAQ: [string, string][] = [
  [
    "Como vou receber o acesso?",
    "Logo depois da confirmação do pagamento você recebe os dados de acesso no seu e-mail. No Pix e no cartão, a liberação é imediata.",
  ],
  [
    "Por quanto tempo terei acesso?",
    "Você terá acesso por 12 meses e pode assistir às aulas quantas vezes quiser, no computador ou no celular.",
  ],
  [
    "E se eu não gostar?",
    "Você tem 7 dias de garantia. Se não gostar por qualquer motivo, é só pedir e devolvemos 100% do seu dinheiro.",
  ],
  ["Quais são as formas de pagamento?", "Cartão de crédito em até 12x, Pix e boleto bancário."],
];

const faq = section(
  "Perguntas frequentes",
  [
    sectionTitle("Perguntas frequentes"),
    el(
      "div",
      "Lista de perguntas",
      { "max-width": "780px", margin: "32px auto 0" },
      FAQ.map(([q, a], i) =>
        el(
          "details",
          "Pergunta",
          {
            margin: "0 0 12px",
            "border-radius": "14px",
            border: "1px solid #e5e7eb",
            "background-color": "#ffffff",
            overflow: "hidden",
          },
          [
            text("summary", q, {
              padding: "18px 20px",
              "font-size": "18px",
              "font-weight": "700",
              cursor: "pointer",
              color: C.text,
            }),
            text("p", a, {
              margin: "0",
              padding: "0 20px 18px",
              "font-size": "17px",
              "line-height": "1.6",
              color: C.muted,
            }),
          ],
          i === 0 ? { attributes: { open: true } } : {},
        ),
      ),
    ),
  ],
  { "background-color": C.bgSoft },
);

export const structureBlocks: OsBlock[] = [
  {
    id: "hero",
    label: "Topo (hero)",
    category: "estrutura",
    media: icon(
      '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M6 9h6M6 12h5M6 15h3"/><rect x="14" y="8" width="5" height="8" rx="1"/>',
    ),
    content: hero,
  },
  {
    id: "hero-vsl",
    label: "Topo com vídeo (VSL)",
    category: "estrutura",
    media: icon(
      '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 7.5h10"/><rect x="6" y="10" width="12" height="7" rx="1"/><path d="m11 12 2.5 1.5L11 15z"/>',
    ),
    content: heroVsl,
  },
  {
    id: "secao-colorida",
    label: "Seção colorida",
    category: "estrutura",
    media: icon(
      '<rect x="3" y="4" width="18" height="16" rx="2" fill="currentColor" fill-opacity=".15"/><path d="M8 10h8M9 14h6"/>',
    ),
    content: coloredSection,
  },
  {
    id: "container",
    label: "Container centralizado",
    category: "estrutura",
    media: icon(
      '<rect x="2" y="4" width="20" height="16" rx="2" stroke-dasharray="2 2"/><rect x="6" y="7" width="12" height="10" rx="1"/>',
    ),
    content: container,
  },
  {
    id: "cartao",
    label: "Cartão",
    category: "estrutura",
    media: icon(
      '<rect x="4" y="4" width="16" height="16" rx="3"/><rect x="7" y="7" width="4" height="4" rx="1"/><path d="M7 14h10M7 17h6"/>',
    ),
    content: card,
  },
  {
    id: "perguntas",
    label: "Perguntas frequentes",
    category: "estrutura",
    media: icon(
      '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M12 17h.01"/>',
    ),
    content: faq,
  },
];
