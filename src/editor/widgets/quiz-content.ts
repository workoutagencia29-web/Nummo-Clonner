/**
 * Quiz (data-os-widget="quiz"): o CSS da página e as definições das etapas,
 * usados pelo bloco "Quiz", pelo modelo de página "Quiz" e pelos botões
 * "＋ Adicionar pergunta"/"＋ Adicionar opção" das Configurações. Sem GrapesJS
 * aqui (o modelo de página é montado no servidor).
 *
 * Estrutura (os ganchos data-os-* são o que o script da página lê,
 * src/runtime/widgets/quiz.ts; as classes os-qz-* são o visual):
 *
 *   div.os-quiz[data-os-widget=quiz][data-os-progress][data-os-back][data-os-track]
 *     div.os-qz-top                     → button[data-os-qz-back] + div[data-os-qz-bar] > div[data-os-qz-fill]
 *     div.os-qz-steps[data-os-qz-steps]
 *       section.os-qz-step[data-os-qz-step=question][data-os-multi=0|1][data-os-layout=list|grid]
 *         (emoji/imagem) h2 (subtítulo) div[data-os-qz-opts] > button[data-os-qz-option]… button[data-os-qz-next]
 *       section[data-os-qz-step=info]      → texto/depoimento + button[data-os-qz-next]
 *       section[data-os-qz-step=loading][data-os-seconds][data-os-messages]
 *                                           → div[data-os-qz-load] > div[data-os-qz-loadfill], [data-os-qz-pct], [data-os-qz-msg]
 *       section[data-os-qz-step=final]     → a.os-btn[data-os-qz-go] (destino: página do funil, link da oferta ou endereço)
 *
 * "Continuar" e "Voltar" levam o texto num <span> dentro do <button>: com o
 * próprio <button> editável, o Chrome e o Firefox tratam o Espaço como clique
 * e o espaço não entra no texto. A etapa final não sai no editor (sem ela o
 * quiz não leva a lugar nenhum).
 *
 * Cores em variáveis no próprio quiz (--os-qz-main, --os-qz-sel, --os-qz-cta):
 * trocar em Configurações vale para todas as etapas, inclusive as novas.
 */
import type { Def } from "@/editor/blocks/shared";

export const QUIZ_TYPE = "os-quiz";
export const QUIZ_STEPS_TYPE = "os-quiz-steps";
export const QUIZ_OPTIONS_TYPE = "os-quiz-options";
export const QUIZ_OPTION_TYPE = "os-quiz-option";
/** Topo (Voltar + barra de progresso): reconhecido pela classe também no HTML do modelo. */
export const QUIZ_TOP_TYPE = "os-quiz-top";
export const QUIZ_BAR_TYPE = "os-quiz-bar";
/** "Continuar" e "Voltar" (texto num <span> dentro do botão). */
export const QUIZ_BUTTON_TYPE = "os-quiz-button";

export type QuizStepKind = "question" | "info" | "loading" | "final";

/** Tipo do GrapesJS de cada etapa. */
export const QUIZ_STEP_TYPES: Record<QuizStepKind, string> = {
  question: "os-quiz-question",
  info: "os-quiz-info",
  loading: "os-quiz-loading",
  final: "os-quiz-final",
};

/** Nome de cada tipo de etapa (selo do canvas e camadas). */
export const QUIZ_STEP_LABEL: Record<QuizStepKind, string> = {
  question: "Pergunta",
  info: "Informação",
  loading: "Analisando",
  final: "Final",
};

/** Cores padrão (as mesmas do CSS abaixo). */
export const QUIZ_COLORS = { main: "#7c3aed", sel: "#f5f3ff", cta: "#16a34a" } as const;

const CHECK_ICON = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
)}")`;

/**
 * O GrapesJS lê o CSS pelo navegador, que não separa um atalho com var()
 * (border, background, outline…) nas propriedades dele: a declaração se
 * perderia. Com var(), só propriedades simples (background-color,
 * border-top-color…).
 */
const borderColor = (v: string) =>
  `border-top-color:${v};border-right-color:${v};border-bottom-color:${v};border-left-color:${v}`;

/**
 * CSS da página (vira regras editáveis do projeto, como o dos botões, e vai
 * no <head> do modelo "Quiz"). Sem !important: o que for mexido no painel
 * Estilo vence. Um só :hover por @media (o GrapesJS juntaria dois numa regra
 * só). Sem JavaScript, só a primeira etapa aparece (o script troca
 * de etapa com a classe os-qz-on, src/runtime/widgets/css.ts). Seletores com
 * :not([data-gjs-type]) não valem no canvas do editor, onde todas as etapas
 * aparecem empilhadas.
 */
export const QUIZ_CSS = [
  `.os-quiz{--os-qz-main:${QUIZ_COLORS.main};--os-qz-sel:${QUIZ_COLORS.sel};--os-qz-cta:${QUIZ_COLORS.cta};--os-qz-ink:#1f2937;--os-qz-muted:#6b7280;position:relative;box-sizing:border-box;width:100%;max-width:560px;margin:24px auto;padding:20px 22px 28px;border-radius:24px;background:#fff;color:var(--os-qz-ink);font-family:inherit;line-height:1.5;text-align:center;box-shadow:0 24px 60px -28px rgba(15,23,42,.35),0 0 0 1px rgba(15,23,42,.06)}`,
  ".os-quiz *,.os-quiz *::before,.os-quiz *::after{box-sizing:border-box}",
  ".os-quiz .os-qz-top{display:flex;align-items:center;gap:10px;min-height:36px;margin:0 0 18px}",
  ".os-quiz .os-qz-back{flex:none;display:inline-flex;align-items:center;margin:0;padding:8px 10px 8px 2px;border:0;border-radius:10px;background:none;color:var(--os-qz-muted);font-family:inherit;font-size:15px;font-weight:600;line-height:1;text-transform:none;letter-spacing:normal;cursor:pointer}",
  ".os-quiz .os-qz-bar{flex:1;height:8px;margin:0;border-radius:999px;background:rgba(15,23,42,.08);overflow:hidden}",
  ".os-quiz .os-qz-fill{width:20%;height:100%;border-radius:inherit;background-color:var(--os-qz-main);transition:width .45s ease}",
  '.os-quiz[data-os-progress="0"] .os-qz-bar,.os-quiz[data-os-back="0"] .os-qz-back{display:none}',
  ".os-quiz .os-qz-step{display:block;margin:0;padding:0}",
  ".os-quiz .os-qz-emoji{margin:0 0 8px;font-size:46px;line-height:1.15}",
  ".os-quiz .os-qz-pic{display:block;width:100%;max-width:340px;height:auto;margin:0 auto 18px;border-radius:16px}",
  ".os-quiz .os-qz-title{margin:0 0 8px;color:inherit;font-family:inherit;font-size:24px;font-weight:800;line-height:1.25;letter-spacing:-.01em;text-transform:none}",
  ".os-quiz .os-qz-sub,.os-quiz .os-qz-text{margin:0 0 6px;color:var(--os-qz-muted);font-size:16px;line-height:1.55}",
  ".os-quiz .os-qz-opts{display:grid;gap:10px;margin:20px 0 0;text-align:left}",
  ".os-quiz .os-qz-opt{position:relative;display:flex;align-items:center;gap:12px;width:100%;min-height:58px;margin:0;padding:14px 16px;border:2px solid #e5e7eb;border-radius:16px;background:#fff;color:var(--os-qz-ink);font-family:inherit;font-size:17px;font-weight:600;line-height:1.3;text-align:left;text-transform:none;letter-spacing:normal;cursor:pointer;-webkit-tap-highlight-color:transparent;box-shadow:0 1px 2px rgba(15,23,42,.05);transition:border-color .15s ease,background-color .15s ease,transform .1s ease}",
  // Realce ao passar o mouse só onde há mouse (no celular o toque deixaria a opção "acesa").
  `@media (hover:hover){.os-quiz .os-qz-opt:hover{${borderColor("var(--os-qz-main)")}}}`,
  ".os-quiz .os-qz-opt:active{transform:scale(.985)}",
  ".os-quiz .os-qz-opt:focus-visible,.os-quiz .os-qz-next:focus-visible,.os-quiz .os-qz-back:focus-visible{outline-width:3px;outline-style:solid;outline-color:var(--os-qz-main);outline-offset:2px}",
  '.os-quiz .os-qz-opt::after{content:"";flex:none;width:22px;height:22px;margin-left:auto;border:2px solid #cbd5e1;border-radius:50%;background:#fff center/14px no-repeat}',
  '.os-quiz [data-os-multi="1"] .os-qz-opt::after{border-radius:7px}',
  `.os-quiz .os-qz-opt[aria-pressed=true]{${borderColor("var(--os-qz-main)")};background-color:var(--os-qz-sel)}`,
  `.os-quiz .os-qz-opt[aria-pressed=true]::after{${borderColor("var(--os-qz-main)")};background-color:var(--os-qz-main);background-image:${CHECK_ICON}}`,
  ".os-quiz .os-qz-ico{flex:none;font-size:26px;line-height:1}",
  ".os-quiz .os-qz-img{flex:none;display:block;width:56px;height:56px;margin:0;border-radius:12px;object-fit:cover}",
  ".os-quiz .os-qz-txt{flex:1;min-width:0}",
  ".os-quiz [data-os-layout=grid] .os-qz-opts{grid-template-columns:repeat(2,minmax(0,1fr))}",
  ".os-quiz [data-os-layout=grid] .os-qz-opt{flex-direction:column;justify-content:center;gap:8px;min-height:128px;padding:18px 10px 14px;text-align:center}",
  ".os-quiz [data-os-layout=grid] .os-qz-txt{flex:none}",
  ".os-quiz [data-os-layout=grid] .os-qz-opt::after{position:absolute;top:9px;right:9px;width:20px;height:20px;margin:0}",
  ".os-quiz [data-os-layout=grid] .os-qz-ico{font-size:40px}",
  ".os-quiz [data-os-layout=grid] .os-qz-img{width:100%;height:auto;aspect-ratio:4/3}",
  ".os-quiz .os-qz-next{display:block;width:100%;margin:20px 0 0;padding:17px 20px;border:0;border-radius:16px;background-color:var(--os-qz-main);color:#fff;font-family:inherit;font-size:18px;font-weight:800;line-height:1.2;text-transform:none;letter-spacing:normal;cursor:pointer;box-shadow:0 12px 24px -14px var(--os-qz-main)}",
  ".os-quiz .os-qz-next:disabled{opacity:.45;cursor:not-allowed;box-shadow:none}",
  '.os-quiz [data-os-qz-step=question]:not([data-os-multi="1"]) .os-qz-next{display:none}',
  ".os-quiz .os-qz-quote{margin:18px 0 0;padding:16px 18px;border-radius:16px;background-color:var(--os-qz-sel);color:var(--os-qz-ink);font-size:16px;line-height:1.55;text-align:left}",
  ".os-quiz .os-qz-load{height:12px;margin:22px 0 12px;border-radius:999px;background:rgba(15,23,42,.08);overflow:hidden}",
  ".os-quiz .os-qz-loadfill{width:65%;height:100%;border-radius:inherit;background-color:var(--os-qz-main)}",
  ".os-quiz .os-qz-pct{margin:0;color:var(--os-qz-main);font-size:30px;font-weight:900;line-height:1.1;font-variant-numeric:tabular-nums}",
  ".os-quiz .os-qz-msg{min-height:1.5em;margin:6px 0 0;color:var(--os-qz-muted);font-size:16px}",
  ".os-quiz .os-qz-go{display:block;width:100%;max-width:none;margin:22px 0 0;padding:19px 20px;border:0;border-radius:16px;background-color:var(--os-qz-cta);background-image:none;color:#fff;font-family:inherit;font-size:19px;font-weight:800;line-height:1.25;text-align:center;text-decoration:none;text-transform:none;box-shadow:0 14px 28px -14px var(--os-qz-cta),inset 0 -3px 0 rgba(0,0,0,.15)}",
  ".os-quiz .os-qz-note{margin:12px 0 0;color:var(--os-qz-muted);font-size:13px}",
  // Sem JavaScript (e antes de o script começar): só a primeira etapa, sem "Voltar".
  ".os-quiz:not(.os-qz-on):not([data-gjs-type]) .os-qz-step~.os-qz-step{display:none}",
  ".os-quiz:not(.os-qz-on):not([data-gjs-type]) .os-qz-back{display:none}",
  "@media (max-width:480px){.os-quiz{margin:12px auto;padding:16px 14px 22px;border-radius:20px}.os-quiz .os-qz-title{font-size:22px}.os-quiz .os-qz-opt{font-size:16px}}",
  "@media (prefers-reduced-motion:reduce){.os-quiz .os-qz-fill,.os-quiz .os-qz-opt{transition:none}}",
].join("");

// ─── Definições ──────────────────────────────────────────────────────────────

export interface QuizOptionSpec {
  text: string;
  /** Emoji antes do texto. */
  icon?: string;
  /** Imagem (data: URI ou endereço) no lugar do emoji. */
  image?: string;
}

export interface QuestionSpec {
  kind: "question";
  title: string;
  sub?: string;
  emoji?: string;
  options: QuizOptionSpec[];
  multi?: boolean;
  layout?: "list" | "grid";
}

export interface InfoSpec {
  kind: "info";
  emoji?: string;
  title: string;
  text: string;
  quote?: string;
}

export interface LoadingSpec {
  kind: "loading";
  title: string;
  seconds: number;
  messages: string[];
}

export interface FinalSpec {
  kind: "final";
  emoji?: string;
  title: string;
  text: string;
  button: string;
  note?: string;
}

export type QuizStepSpec = QuestionSpec | InfoSpec | LoadingSpec | FinalSpec;

const textDef = (tagName: string, content: string, cls: string, name: string, attributes?: Def["attributes"]): Def => ({
  type: "text",
  tagName,
  name,
  classes: [cls],
  ...(attributes && { attributes }),
  content,
});

const emojiDef = (emoji: string) => textDef("p", emoji, "os-qz-emoji", "Emoji", { "aria-hidden": "true" });

export function quizOptionDef(o: QuizOptionSpec): Def {
  const parts: Def[] = [];
  if (o.image) {
    parts.push({
      type: "image",
      tagName: "img",
      name: "Imagem da opção",
      classes: ["os-qz-img"],
      attributes: { src: o.image, alt: "" },
    });
  } else if (o.icon) {
    parts.push(textDef("span", o.icon, "os-qz-ico", "Emoji da opção", { "aria-hidden": "true" }));
  }
  parts.push(textDef("span", o.text, "os-qz-txt", "Texto da opção"));
  return {
    type: QUIZ_OPTION_TYPE,
    tagName: "button",
    name: "Opção",
    classes: ["os-qz-opt"],
    attributes: { type: "button", "data-os-qz-option": "" },
    components: parts,
  };
}

/** Texto de "Continuar"/"Voltar" (o <span> editável dentro do botão). */
export const buttonTextDef = (label: string) => textDef("span", label, "os-qz-btxt", "Texto do botão");

const buttonDef = (label: string, cls: string, name: string, attributes: Def["attributes"]): Def => ({
  type: QUIZ_BUTTON_TYPE,
  tagName: "button",
  name,
  classes: [cls],
  attributes,
  droppable: false,
  components: [buttonTextDef(label)],
});

const nextDef = (label = "Continuar") =>
  buttonDef(label, "os-qz-next", "Botão Continuar", { type: "button", "data-os-qz-next": "" });

const stepDef = (kind: QuizStepKind, attributes: Record<string, string>, components: Def[]): Def => ({
  type: QUIZ_STEP_TYPES[kind],
  tagName: "section",
  classes: ["os-qz-step"],
  attributes: { "data-os-qz-step": kind, ...attributes },
  components,
});

export function quizStepDef(s: QuizStepSpec): Def {
  switch (s.kind) {
    case "question":
      return stepDef("question", { "data-os-multi": s.multi ? "1" : "0", "data-os-layout": s.layout ?? "list" }, [
        ...(s.emoji ? [emojiDef(s.emoji)] : []),
        textDef("h2", s.title, "os-qz-title", "Pergunta"),
        ...(s.sub ? [textDef("p", s.sub, "os-qz-sub", "Subtítulo")] : []),
        {
          type: QUIZ_OPTIONS_TYPE,
          tagName: "div",
          name: "Opções",
          classes: ["os-qz-opts"],
          attributes: { "data-os-qz-opts": "", role: "group" },
          components: s.options.map(quizOptionDef),
        },
        nextDef(),
      ]);
    case "info":
      return stepDef("info", {}, [
        ...(s.emoji ? [emojiDef(s.emoji)] : []),
        textDef("h2", s.title, "os-qz-title", "Título"),
        textDef("p", s.text, "os-qz-text", "Texto"),
        ...(s.quote ? [textDef("p", s.quote, "os-qz-quote", "Depoimento")] : []),
        nextDef(),
      ]);
    case "loading":
      return stepDef("loading", { "data-os-seconds": String(s.seconds), "data-os-messages": s.messages.join("\n") }, [
        emojiDef("🔍"),
        textDef("h2", s.title, "os-qz-title", "Título"),
        {
          tagName: "div",
          name: "Barra",
          classes: ["os-qz-load"],
          attributes: { "data-os-qz-load": "", "aria-hidden": "true" },
          components: [
            {
              tagName: "div",
              name: "Preenchimento",
              classes: ["os-qz-loadfill"],
              attributes: { "data-os-qz-loadfill": "" },
            },
          ],
        },
        {
          tagName: "p",
          name: "Porcentagem",
          classes: ["os-qz-pct"],
          attributes: { "data-os-qz-pct": "" },
          content: "65%",
          editable: false,
        },
        textDef("p", s.messages[0] ?? "", "os-qz-msg", "Mensagem", { "data-os-qz-msg": "" }),
      ]);
    case "final":
      return stepDef("final", {}, [
        ...(s.emoji ? [emojiDef(s.emoji)] : []),
        textDef("h2", s.title, "os-qz-title", "Título"),
        textDef("p", s.text, "os-qz-text", "Texto"),
        {
          type: "os-button",
          tagName: "a",
          name: "Botão final",
          classes: ["os-btn", "os-qz-go", "os-pulse"],
          // data-os-link="": o canvas pede para escolher o destino (página do funil, link da oferta ou endereço).
          attributes: { href: "#", "data-os-link": "", "data-os-qz-go": "" },
          content: s.button,
        },
        ...(s.note ? [textDef("p", s.note, "os-qz-note", "Observação")] : []),
      ]);
  }
}

/** O quiz inteiro (topo com "Voltar" e barra de progresso + etapas). */
export function quizDef(steps: QuizStepSpec[]): Def {
  return {
    type: QUIZ_TYPE,
    tagName: "div",
    name: "Quiz",
    classes: ["os-quiz"],
    attributes: { "data-os-widget": "quiz", "data-os-progress": "1", "data-os-back": "1", "data-os-track": "1" },
    components: [
      {
        type: QUIZ_TOP_TYPE,
        tagName: "div",
        name: "Topo do quiz",
        classes: ["os-qz-top"],
        droppable: false,
        components: [
          buttonDef("← Voltar", "os-qz-back", "Botão Voltar", { type: "button", "data-os-qz-back": "" }),
          {
            type: QUIZ_BAR_TYPE,
            tagName: "div",
            name: "Barra de progresso",
            classes: ["os-qz-bar"],
            attributes: {
              "data-os-qz-bar": "",
              role: "progressbar",
              "aria-label": "Progresso do quiz",
              "aria-valuemin": "0",
              "aria-valuemax": "100",
            },
            components: [
              { tagName: "div", name: "Preenchimento", classes: ["os-qz-fill"], attributes: { "data-os-qz-fill": "" } },
            ],
          },
        ],
      },
      {
        type: QUIZ_STEPS_TYPE,
        tagName: "div",
        name: "Etapas",
        classes: ["os-qz-steps"],
        attributes: { "data-os-qz-steps": "" },
        components: steps.map(quizStepDef),
      },
    ],
  };
}

// ─── Etapas prontas (Configurações → "＋ Adicionar…") ─────────────────────────

export const NEW_QUESTION: QuestionSpec = {
  kind: "question",
  title: "Escreva aqui a sua pergunta",
  options: [
    { icon: "👍", text: "Primeira resposta" },
    { icon: "🤔", text: "Segunda resposta" },
    { icon: "🙌", text: "Terceira resposta" },
  ],
};

export const NEW_INFO: InfoSpec = {
  kind: "info",
  emoji: "💡",
  title: "Você sabia?",
  text: "Use esta etapa para um dado, uma explicação curta ou um depoimento entre as perguntas.",
};

export const NEW_LOADING: LoadingSpec = {
  kind: "loading",
  title: "Analisando suas respostas…",
  seconds: 4,
  messages: ["Analisando suas respostas…", "Comparando com outros perfis…", "Preparando o seu resultado…"],
};

export const DEFAULT_FINAL: FinalSpec = {
  kind: "final",
  emoji: "🎉",
  title: "Parabéns! Você ganhou um giro na roleta de descontos",
  text: "Suas respostas mostram que você tem o perfil ideal. Toque no botão abaixo para girar a roleta e descobrir o seu desconto.",
  button: "GIRAR A ROLETA AGORA",
  note: "Leva só alguns segundos ⏱️",
};

/** Emojis usados quando as opções de uma pergunta passam a ter emoji. */
export const OPTION_EMOJIS = ["✅", "⭐", "🔥", "💡", "🎯", "🚀", "💎", "🌟"];

// ─── Exemplos ────────────────────────────────────────────────────────────────

/** Quiz de exemplo do bloco: 3 perguntas, 1 informação, "Analisando" e final. */
export const BLOCK_QUIZ: QuizStepSpec[] = [
  {
    kind: "question",
    title: "O que você mais quer conquistar agora?",
    sub: "Escolha uma opção.",
    layout: "grid",
    options: [
      { icon: "🚀", text: "Resultados mais rápidos" },
      { icon: "💰", text: "Economizar dinheiro" },
      { icon: "⏰", text: "Ter mais tempo livre" },
      { icon: "💪", text: "Mais confiança" },
    ],
  },
  {
    kind: "question",
    title: "Você já tentou resolver isso antes?",
    options: [
      { icon: "🔁", text: "Sim, várias vezes" },
      { icon: "☝️", text: "Sim, uma vez" },
      { icon: "🆕", text: "Ainda não" },
    ],
  },
  {
    kind: "info",
    emoji: "🙌",
    title: "Você não está sozinho(a)!",
    text: "Mais de <strong>12 mil pessoas</strong> já passaram por aqui e encontraram o caminho certo.",
  },
  {
    kind: "question",
    title: "O que mais atrapalha você hoje?",
    sub: "Pode marcar mais de uma.",
    multi: true,
    options: [
      { icon: "⏳", text: "Falta de tempo" },
      { icon: "🧭", text: "Não sei por onde começar" },
      { icon: "💸", text: "Já gastei com o que não funcionou" },
    ],
  },
  NEW_LOADING,
  DEFAULT_FINAL,
];

/** Quiz do modelo de página: 4 perguntas, 1 informação, "Analisando" e final. */
export const TEMPLATE_QUIZ: QuizStepSpec[] = [
  BLOCK_QUIZ[0],
  BLOCK_QUIZ[1],
  {
    kind: "info",
    emoji: "🙌",
    title: "Você não está sozinho(a)!",
    text: "Mais de <strong>12 mil pessoas</strong> já responderam este quiz e encontraram o caminho certo.",
    quote:
      "“Eu achava que não era para mim. Em poucas semanas já vi a diferença.” <strong>— Nome da pessoa, Cidade/UF</strong>",
  },
  BLOCK_QUIZ[3],
  {
    kind: "question",
    title: "Quanto tempo por dia você pode dedicar?",
    options: [
      { icon: "⚡", text: "Até 15 minutos" },
      { icon: "🕐", text: "De 15 a 30 minutos" },
      { icon: "🔥", text: "Mais de 30 minutos" },
    ],
  },
  NEW_LOADING,
  DEFAULT_FINAL,
];

// ─── HTML (modelo de página) ─────────────────────────────────────────────────

const VOID_TAGS = new Set(["img", "input", "br", "hr"]);

const escAttr = (v: string) => v.replace(/[&<>"\n]/g, (c) => (c === "\n" ? "&#10;" : `&#${c.charCodeAt(0)};`));

/** HTML de uma definição (só o que os quizzes usam: tag, atributos, classes e conteúdo). */
export function defToHtml(def: Def | string): string {
  if (typeof def === "string") return def;
  const tag = def.tagName ?? (def.type === "image" ? "img" : "div");
  const attrs: Record<string, string | boolean> = { ...def.attributes };
  if (def.classes?.length) attrs.class = def.classes.join(" ");
  const attrHtml = Object.entries(attrs)
    .filter(([, v]) => v !== false)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${escAttr(String(v))}"`))
    .join("");
  if (VOID_TAGS.has(tag)) return `<${tag}${attrHtml}>`;
  const inner = Array.isArray(def.components)
    ? def.components.map(defToHtml).join("")
    : typeof def.components === "string"
      ? def.components
      : (def.content ?? "");
  return `<${tag}${attrHtml}>${inner}</${tag}>`;
}
