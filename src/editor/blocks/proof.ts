/**
 * Blocos de prova social: depoimentos (texto e vídeo), números, logos "visto
 * em" e antes e depois.
 */
import { videoEmbedDef } from "@/editor/widgets/video";
import {
  C,
  type Def,
  el,
  grid,
  icon,
  image,
  type OsBlock,
  onMobile,
  placeholderAvatar,
  placeholderImage,
  placeholderLogo,
  section,
  sectionLead,
  sectionTitle,
  text,
} from "./shared";

const cardStyle = {
  display: "flex",
  "flex-direction": "column",
  gap: "14px",
  padding: "26px",
  "box-sizing": "border-box",
  "border-radius": "18px",
  border: "1px solid #e5e7eb",
  "background-color": "#ffffff",
  "box-shadow": "0 10px 30px rgba(15,23,42,.07)",
  "text-align": "left",
  color: C.text,
};

function author(name: string, city: string, avatar: string): Def {
  return el("div", "Autor", { display: "flex", "align-items": "center", gap: "12px" }, [
    image(avatar, `Foto de ${name}`, {
      display: "block",
      width: "52px",
      height: "52px",
      "border-radius": "50%",
      "object-fit": "cover",
      "flex-shrink": "0",
    }),
    el("div", "Nome e cidade", { "line-height": "1.3", "min-width": "0" }, [
      text("div", name, { "font-size": "16px", "font-weight": "700" }),
      text("div", city, { "font-size": "14px", color: C.soft }),
    ]),
  ]);
}

const stars = () =>
  text(
    "div",
    "★★★★★",
    { color: "#f59e0b", "font-size": "20px", "letter-spacing": "2px", "line-height": "1" },
    { name: "Estrelas" },
  );

function testimonial(quote: string, name: string, city: string, bg: string): Def {
  return el("div", `Depoimento: ${name}`, cardStyle, [
    stars(),
    text("p", `“${quote}”`, { margin: "0", flex: "1", "font-size": "16px", "line-height": "1.65", color: "#374151" }),
    author(name, city, placeholderAvatar(bg)),
  ]);
}

const testimonials = section(
  "Depoimentos",
  [
    sectionTitle("O que dizem os nossos alunos"),
    sectionLead("Resultados de pessoas comuns que decidiram começar."),
    grid("Cartões de depoimento", 280, [
      testimonial(
        "Eu estava desacreditada, mas resolvi tentar. Em três semanas já tinha os primeiros resultados. O passo a passo é muito claro!",
        "Ana Paula",
        "Belo Horizonte, MG",
        "#dbe3f0",
      ),
      testimonial(
        "Conteúdo direto ao ponto, sem enrolação. Assisti tudo pelo celular no intervalo do trabalho e apliquei no mesmo dia.",
        "Ricardo Lima",
        "Curitiba, PR",
        "#e2e8d5",
      ),
      testimonial(
        "O suporte responde rápido e as aulas são fáceis de entender. Valeu cada centavo. Recomendo de olhos fechados.",
        "Juliana Souza",
        "Recife, PE",
        "#f0dde3",
      ),
    ]),
  ],
  { "background-color": C.bgSoft },
);

function videoTestimonial(name: string, city: string): Def {
  return el("div", `Depoimento em vídeo: ${name}`, { ...cardStyle, padding: "14px 14px 20px" }, [
    videoEmbedDef("youtube", "", { "border-radius": "12px", "box-shadow": "none" }),
    el("div", "Legenda", { padding: "0 8px" }, [
      stars(),
      text("div", name, { margin: "10px 0 0", "font-size": "17px", "font-weight": "700" }),
      text("div", city, { "font-size": "14px", color: C.soft }),
    ]),
  ]);
}

const videoTestimonials = section("Depoimentos em vídeo", [
  sectionTitle("Veja quem já está tendo resultados"),
  sectionLead("Aperte o play e ouça de quem já passou pelo método."),
  grid("Vídeos de depoimento", 300, [
    videoTestimonial("Carla Mendes", "São Paulo, SP"),
    videoTestimonial("Marcos Oliveira", "Goiânia, GO"),
  ]),
]);

function stat(value: string, label: string): Def {
  return el("div", `Número: ${label}`, { "text-align": "center", padding: "8px" }, [
    onMobile(
      text("div", value, {
        "font-size": "46px",
        "font-weight": "900",
        "line-height": "1.1",
        "letter-spacing": "-0.02em",
        color: "#4f46e5",
      }),
      { "font-size": "38px" },
    ),
    text("div", label, { "margin-top": "6px", "font-size": "16px", color: C.muted }),
  ]);
}

const numbers = section("Números", [
  sectionTitle("Resultados que falam por si"),
  grid(
    "Números",
    180,
    [
      stat("+12.000", "alunos em todo o Brasil"),
      stat("4,9/5", "de avaliação média"),
      stat("97%", "recomendam para amigos"),
      stat("7 dias", "de garantia incondicional"),
    ],
    { "margin-top": "36px" },
  ),
]);

const logos = section(
  "Visto em",
  [
    text("p", "COMO VISTO EM", {
      margin: "0 0 20px",
      "font-size": "13px",
      "font-weight": "700",
      "letter-spacing": "0.14em",
      color: C.soft,
      "text-align": "center",
    }),
    el(
      "div",
      "Logos",
      { display: "flex", "flex-wrap": "wrap", "align-items": "center", "justify-content": "center", gap: "20px 44px" },
      ["Jornal", "Revista", "Portal", "TV Brasil", "Podcast"].map((name) =>
        image(placeholderLogo(name), `Logo ${name}`, {
          display: "block",
          height: "36px",
          width: "auto",
          "max-width": "150px",
          opacity: "0.7",
          filter: "grayscale(1)",
        }),
      ),
    ),
  ],
  { padding: "36px 20px", "border-top": "1px solid #eef0f4", "border-bottom": "1px solid #eef0f4" },
);

function beforeAfterImage(label: string, color: string): Def {
  return el("figure", label, { position: "relative", margin: "0" }, [
    image(placeholderImage(`Foto do ${label.toLowerCase()}`, 700, 700), label, {
      display: "block",
      width: "100%",
      height: "auto",
      "border-radius": "18px",
      "aspect-ratio": "1 / 1",
      "object-fit": "cover",
    }),
    text("figcaption", label.toUpperCase(), {
      position: "absolute",
      top: "14px",
      left: "14px",
      padding: "6px 14px",
      "border-radius": "999px",
      "background-color": color,
      color: "#ffffff",
      "font-size": "13px",
      "font-weight": "800",
      "letter-spacing": "0.08em",
    }),
  ]);
}

const beforeAfter = section("Antes e depois", [
  sectionTitle("Antes e depois"),
  sectionLead("Resultado real de uma aluna após 30 dias aplicando o método."),
  el("div", "Fotos", { "max-width": "860px", margin: "0 auto" }, [
    grid("Antes e depois", 260, [beforeAfterImage("Antes", "#dc2626"), beforeAfterImage("Depois", "#16a34a")]),
  ]),
  text("p", "*Os resultados podem variar de pessoa para pessoa.", {
    margin: "18px 0 0",
    "font-size": "13px",
    color: C.soft,
    "text-align": "center",
  }),
]);

export const proofBlocks: OsBlock[] = [
  {
    id: "depoimentos",
    label: "Depoimentos",
    category: "prova",
    media: icon(
      '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12Z"/><path d="M9 11h.01M13 11h.01M17 11h.01"/>',
    ),
    content: testimonials,
  },
  {
    id: "depoimento-video",
    label: "Depoimentos em vídeo",
    category: "prova",
    media: icon('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="m10 7.5 4 2.5-4 2.5zM8 20h8"/>'),
    content: videoTestimonials,
  },
  {
    id: "numeros",
    label: "Números",
    category: "prova",
    media: icon('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    content: numbers,
  },
  {
    id: "logos",
    label: "Visto em (logos)",
    category: "prova",
    media: icon(
      '<rect x="2" y="9" width="5" height="6" rx="1"/><rect x="9.5" y="9" width="5" height="6" rx="1"/><rect x="17" y="9" width="5" height="6" rx="1"/>',
    ),
    content: logos,
  },
  {
    id: "antes-depois",
    label: "Antes e depois",
    category: "prova",
    media: icon(
      '<rect x="2" y="5" width="9" height="14" rx="2"/><rect x="13" y="5" width="9" height="14" rx="2"/><path d="M11 12h2"/>',
    ),
    content: beforeAfter,
  },
];
