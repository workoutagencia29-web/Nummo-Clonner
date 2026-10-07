/**
 * Quiz no editor (data-os-widget="quiz"): tipos do GrapesJS para o quiz, as
 * etapas (pergunta, informação, analisando, final) e as opções, com as
 * Configurações de cada um. No canvas todas as etapas aparecem empilhadas, com
 * um selo "Etapa 2 de 6 · Pergunta" (só no canvas: atributo do elemento
 * desenhado, nunca do modelo — ver WIDGET_CANVAS_CSS). Na página, o script
 * (src/runtime/widgets/quiz.ts) mostra uma etapa por vez.
 *
 * Remover, duplicar e reordenar etapas e opções usam o que o GrapesJS já tem
 * (barra do elemento e Camadas); etapas só entram no contêiner de etapas e
 * opções só na lista de opções. A etapa final não sai nem se duplica (sem ela
 * o quiz não leva a lugar nenhum) e um quiz não entra dentro de outro.
 *
 * Os campos "Ao terminar o quiz" leem o botão final (outro elemento): eles se
 * redesenham quando o botão muda (outro campo, Desfazer, diálogo de link novo).
 */
import type { Component, Editor } from "grapesjs";
import { esc, placeholderImage } from "@/editor/blocks/shared";
import { headingHint } from "@/editor/grapes/components";
import { editorTimeout } from "@/editor/grapes/lifecycle";
import { destination } from "./destination";
import { attr, baseStyle, descendants, hasAttr, setBaseStyle, setText } from "./dom";
import {
  buttonTextDef,
  NEW_INFO,
  NEW_LOADING,
  NEW_QUESTION,
  OPTION_EMOJIS,
  QUIZ_BAR_TYPE,
  QUIZ_BUTTON_TYPE,
  QUIZ_COLORS,
  QUIZ_CSS,
  QUIZ_OPTION_TYPE,
  QUIZ_OPTIONS_TYPE,
  QUIZ_STEP_LABEL,
  QUIZ_STEP_TYPES,
  QUIZ_STEPS_TYPE,
  QUIZ_TOP_TYPE,
  QUIZ_TYPE,
  type QuizStepKind,
  type QuizStepSpec,
  quizOptionDef,
  quizStepDef,
} from "./quiz-content";
import { checkAttr, heading, numberAttr, selectAttr, type TraitDef } from "./traits";

/** Atributo do selo do canvas (só no elemento desenhado, nunca no HTML salvo). */
export const QUIZ_BADGE_ATTR = "data-os-qz-badge";

const STEP_ATTR = "data-os-qz-step";

export const isQuiz = (c: Component) => attr(c, "data-os-widget") === "quiz";
export const isQuizStep = (c: Component) => !!attr(c, STEP_ATTR);
const isOption = (c: Component) => c.getAttributes()["data-os-qz-option"] !== undefined;
const isGoButton = (c: Component) => c.getAttributes()["data-os-qz-go"] !== undefined;
const stepKind = (c: Component) => attr(c, STEP_ATTR) as QuizStepKind;

/** Quiz a que o componente pertence (ele mesmo, se for o quiz). */
export function quizOf(c: Component | undefined): Component | undefined {
  let at: Component | undefined = c;
  while (at && !isQuiz(at)) at = at.parent();
  return at;
}

function stepsContainer(quiz: Component): Component | undefined {
  return descendants(quiz, hasAttr("data-os-qz-steps"))[0];
}

/** Etapas do quiz, na ordem. */
export function quizSteps(quiz: Component): Component[] {
  const box = stepsContainer(quiz);
  return box ? box.components().filter(isQuizStep) : descendants(quiz, isQuizStep);
}

// ─── Selo do canvas ──────────────────────────────────────────────────────────

/** "Etapa 2 de 6 · Pergunta" (escolha múltipla aparece no selo). */
export function stepBadge(step: Component): string {
  const siblings = step.parent()?.components().filter(isQuizStep) ?? [step];
  const index = siblings.indexOf(step) + 1;
  const kind = stepKind(step);
  const label = QUIZ_STEP_LABEL[kind] ?? "Etapa";
  const multi = kind === "question" && attr(step, "data-os-multi") === "1" ? " (escolha múltipla)" : "";
  return `Etapa ${index} de ${siblings.length} · ${label}${multi}`;
}

function paintBadge(step: Component, el: HTMLElement | undefined = step.getEl()) {
  el?.setAttribute(QUIZ_BADGE_ATTR, stepBadge(step));
}

function paintAll(container: Component) {
  for (const step of container.components().filter(isQuizStep)) paintBadge(step);
}

// ─── Ações das Configurações ─────────────────────────────────────────────────

function scrollToComponent(editor: Editor, c: Component) {
  try {
    editor.Canvas.scrollTo(c, { behavior: "smooth", block: "center" } as never);
  } catch {
    // canvas ainda não desenhou o elemento: tudo bem
  }
}

/**
 * Acrescenta uma etapa pronta: perguntas e informações entram antes da tela
 * "Analisando"/final; a tela "Analisando", antes da final.
 */
export function addQuizStep(editor: Editor, quiz: Component, spec: QuizStepSpec): Component | undefined {
  const box = stepsContainer(quiz);
  if (!box) return;
  const children = box.components().models;
  const stop: QuizStepKind[] = spec.kind === "loading" ? ["final"] : ["loading", "final"];
  let at = children.findIndex((c) => stop.includes(stepKind(c)));
  if (at < 0) at = children.length;
  const [added] = box.append(quizStepDef(spec) as never, { at });
  if (!added) return;
  editor.select(added);
  editorTimeout(editor, () => scrollToComponent(editor, added), 50);
  return added;
}

/** Acrescenta uma opção à pergunta: cópia da última (mesmo visual), com texto novo. */
export function addQuizOption(question: Component): Component | undefined {
  const box = descendants(question, hasAttr("data-os-qz-opts"))[0];
  if (!box) return;
  const options = box.components().filter(isOption);
  const last = options[options.length - 1];
  if (!last) return box.append(quizOptionDef({ icon: OPTION_EMOJIS[0], text: "Nova opção" }) as never)[0];
  const copy = last.clone();
  box.append(copy);
  const label = descendants(copy, (c) => c.getClasses().includes("os-qz-txt"))[0];
  if (label) setText(label, "Nova opção");
  return copy;
}

type IconKind = "none" | "emoji" | "image";

function optionIcon(option: Component): IconKind {
  const classes = option.components().models.map((c: Component) => c.getClasses() as string[]);
  if (classes.some((list) => list.includes("os-qz-img"))) return "image";
  if (classes.some((list) => list.includes("os-qz-ico"))) return "emoji";
  return "none";
}

/** Troca o ícone de todas as opções da pergunta (nenhum, emoji ou imagem). */
export function setOptionIcons(question: Component, kind: IconKind) {
  const options = descendants(question, isOption);
  options.forEach((option, i) => {
    if (optionIcon(option) === kind) return;
    const icons = option.components().models.filter((c: Component) => /os-qz-(ico|img)/.test(c.getClasses().join(" ")));
    for (const part of icons) {
      part.remove();
    }
    if (kind === "emoji") {
      option.append(
        {
          type: "text",
          tagName: "span",
          name: "Emoji da opção",
          classes: ["os-qz-ico"],
          attributes: { "aria-hidden": "true" },
          content: OPTION_EMOJIS[i % OPTION_EMOJIS.length],
        } as never,
        { at: 0 },
      );
    } else if (kind === "image") {
      option.append(
        {
          type: "image",
          tagName: "img",
          name: "Imagem da opção",
          classes: ["os-qz-img"],
          attributes: { src: placeholderImage("Imagem", 400, 300), alt: "" },
        } as never,
        { at: 0 },
      );
    }
  });
}

/** Texto da mensagem da tela "Analisando" no canvas acompanha a primeira mensagem. */
function refreshLoadingMessage(step: Component) {
  const first = attr(step, "data-os-messages")
    .split(/\r?\n|\|/)
    .map((m) => m.trim())
    .find(Boolean);
  const msg = descendants(step, hasAttr("data-os-qz-msg"))[0];
  if (first && msg && msg.getInnerHTML() !== esc(first)) setText(msg, first);
}

// ─── Destino ao terminar (no quiz e na etapa final) ──────────────────────────

const quizDestination = destination({
  title: "Ao terminar o quiz",
  prefix: "os-qz",
  pageLabel: "Botão final leva para a página do funil",
  isButton: isGoButton,
  widgetOf: quizOf,
});

/** O destino escolhido por último vale: página do funil, link da oferta ou endereço. */
const destinationTraits = quizDestination.traits;

/**
 * Liga os botões finais do quiz ao link da oferta criado no diálogo "＋ Criar
 * link da oferta…": como ao escolher um link que já existe, o destino de antes
 * (página do funil ou endereço) sai. false = não é um botão final de quiz.
 */
export const bindQuizLink = (c: Component, key: string): boolean => quizDestination.bind(c, key);

// ─── Cores (variáveis do quiz) ───────────────────────────────────────────────

function colorTrait(name: string, label: string, prop: string, def: string): TraitDef {
  return {
    type: "os-color",
    name,
    label,
    getValue: ({ editor, component }) => {
      const quiz = quizOf(component);
      return (quiz && baseStyle(editor, quiz)[prop]) || def;
    },
    setValue: ({ editor, component, value }) => {
      const quiz = quizOf(component);
      if (quiz) setBaseStyle(editor, quiz, { [prop]: String(value ?? "") });
    },
  };
}

const addStepButton = (name: string, text: string, spec: QuizStepSpec): TraitDef => ({
  type: "button",
  name,
  text,
  full: true,
  command: (editor, trait) => {
    const quiz = quizOf(trait.target as Component);
    if (quiz) addQuizStep(editor, quiz, spec);
  },
});

const QUIZ_TRAITS: TraitDef[] = [
  heading("Etapas", "qz-etapas"),
  addStepButton("os-qz-add-question", "＋ Adicionar pergunta", NEW_QUESTION),
  addStepButton("os-qz-add-info", "＋ Adicionar informação", NEW_INFO),
  addStepButton("os-qz-add-loading", "＋ Adicionar tela “Analisando”", NEW_LOADING),
  heading("Como funciona", "qz-como"),
  checkAttr("data-os-progress", "Mostrar barra de progresso", true),
  checkAttr("data-os-back", "Mostrar botão “Voltar”", true),
  checkAttr("data-os-track", "Mandar cada resposta para os pixels (ver onde as pessoas desistem)", true),
  ...destinationTraits,
  heading("Cores", "qz-cores"),
  colorTrait("os-qz-main", "Cor principal", "--os-qz-main", QUIZ_COLORS.main),
  colorTrait("os-qz-sel", "Fundo da opção marcada", "--os-qz-sel", QUIZ_COLORS.sel),
  colorTrait("os-qz-cta", "Cor do botão final", "--os-qz-cta", QUIZ_COLORS.cta),
];

const QUESTION_TRAITS: TraitDef[] = [
  heading("Pergunta", "qz-pergunta"),
  {
    type: "button",
    name: "os-qz-add-option",
    text: "＋ Adicionar opção",
    full: true,
    command: (_editor, trait) => {
      addQuizOption(trait.target as Component);
    },
  },
  checkAttr("data-os-multi", "Escolha múltipla (aparece o botão “Continuar”)", false),
  selectAttr("data-os-layout", "Formato das opções", [
    ["list", "Lista (uma embaixo da outra)"],
    ["grid", "Cartões (2 por linha)"],
  ]),
  {
    type: "select",
    name: "os-qz-icons",
    label: "Nas opções",
    options: [
      { id: "emoji", label: "Emoji + texto" },
      { id: "image", label: "Imagem + texto" },
      { id: "none", label: "Só texto" },
    ],
    getValue: ({ component }) => {
      const first = descendants(component, isOption)[0];
      return first ? optionIcon(first) : "emoji";
    },
    setValue: ({ component, value }) => setOptionIcons(component, (String(value) || "emoji") as IconKind),
  },
];

const LOADING_TRAITS: TraitDef[] = [
  heading("Analisando", "qz-analisando"),
  numberAttr("data-os-seconds", "Duração (segundos)", 1, 60),
  {
    type: "os-textarea",
    name: "data-os-messages",
    label: "Mensagens (uma por linha, se alternam)",
    rows: 4,
  },
];

export function registerQuizTypes(editor: Editor) {
  const dc = editor.DomComponents;

  dc.addType(QUIZ_TYPE, {
    isComponent: (node) => node.getAttribute?.("data-os-widget") === "quiz",
    model: {
      defaults: {
        name: "Quiz",
        droppable: false,
        // Um quiz dentro da etapa de outro: um clique responderia os dois.
        draggable: (_quiz: Component, target: Component) => !quizOf(target),
        traits: QUIZ_TRAITS,
        styles: QUIZ_CSS,
      },
    },
  });

  dc.addType(QUIZ_TOP_TYPE, {
    isComponent: (node) => node.classList?.contains("os-qz-top") ?? false,
    model: { defaults: { name: "Topo do quiz", droppable: false } },
  });

  dc.addType(QUIZ_BAR_TYPE, {
    isComponent: (node) => node.hasAttribute?.("data-os-qz-bar") ?? false,
    model: { defaults: { name: "Barra de progresso", droppable: false } },
  });

  dc.addType(QUIZ_BUTTON_TYPE, {
    isComponent: (node) => {
      if (node.tagName !== "BUTTON") return false;
      if (!(node.hasAttribute?.("data-os-qz-next") || node.hasAttribute?.("data-os-qz-back"))) return false;
      // Texto direto no <button> (HTML de antes): vai para um <span>, senão o
      // Espaço não entra no texto (Chrome e Firefox tratam como clique).
      const wrapped = Array.from(node.children as HTMLCollection).some((c) => c.classList.contains("os-qz-btxt"));
      return !wrapped && node.innerHTML.trim()
        ? { type: QUIZ_BUTTON_TYPE, components: [buttonTextDef(node.innerHTML.trim())] }
        : { type: QUIZ_BUTTON_TYPE };
    },
    model: {
      defaults: { tagName: "button", droppable: false },
      getName(this: Component) {
        const custom = this.get("custom-name");
        if (custom) return String(custom);
        return this.getAttributes()["data-os-qz-back"] !== undefined ? "Botão Voltar" : "Botão Continuar";
      },
    },
  });

  // Campos "Ao terminar o quiz": o valor mora no botão final. Quando ele muda
  // (outro campo, Desfazer/Refazer, diálogo de link novo), os campos do quiz ou
  // da etapa final selecionados mostram o destino que vale.
  quizDestination.watch(editor);

  dc.addType(QUIZ_STEPS_TYPE, {
    isComponent: (node) => node.hasAttribute?.("data-os-qz-steps") ?? false,
    model: {
      // Só etapas entram aqui (arrastar nas Camadas ou pela barra do elemento).
      defaults: { name: "Etapas", droppable: `[${STEP_ATTR}]` },
      init(this: Component) {
        // Etapa nova, removida ou movida: os selos de todas mudam ("Etapa 3 de 7").
        this.listenTo(this.components(), "add remove reset", () => editorTimeout(editor, () => paintAll(this)));
      },
    },
  });

  dc.addType(QUIZ_OPTIONS_TYPE, {
    isComponent: (node) => node.hasAttribute?.("data-os-qz-opts") ?? false,
    model: { defaults: { name: "Opções", droppable: "[data-os-qz-option]" } },
  });

  dc.addType(QUIZ_OPTION_TYPE, {
    isComponent: (node) => node.tagName === "BUTTON" && (node.hasAttribute?.("data-os-qz-option") ?? false),
    model: { defaults: { tagName: "button", name: "Opção", draggable: "[data-os-qz-opts]", droppable: false } },
  });

  const stepTraits: Record<QuizStepKind, TraitDef[]> = {
    question: QUESTION_TRAITS,
    info: [],
    loading: LOADING_TRAITS,
    final: destinationTraits,
  };
  for (const kind of Object.keys(QUIZ_STEP_TYPES) as QuizStepKind[]) {
    const label = QUIZ_STEP_LABEL[kind];
    dc.addType(QUIZ_STEP_TYPES[kind], {
      isComponent: (node) => node.getAttribute?.(STEP_ATTR) === kind,
      model: {
        defaults: {
          tagName: "section",
          draggable: "[data-os-qz-steps]",
          traits: stepTraits[kind],
          // Sem a etapa final o quiz não leva a lugar nenhum: ela não sai nem se
          // duplica (o quiz inteiro continua podendo ser excluído).
          ...(kind === "final" && { removable: false, copyable: false }),
        },
        init(this: Component) {
          if (kind === "question") this.on("change:attributes:data-os-multi", () => paintBadge(this));
          if (kind === "loading") this.on("change:attributes:data-os-messages", () => refreshLoadingMessage(this));
        },
        // Nas camadas: "Pergunta · O que você mais quer…".
        getName(this: Component) {
          const custom = this.get("custom-name");
          if (custom) return String(custom);
          const hint = headingHint(this);
          return hint ? `${label} · ${hint}` : label;
        },
      },
      view: {
        init(this: { model: Component; el: HTMLElement; listenTo: (o: unknown, e: string, f: () => void) => void }) {
          // O GrapesJS refaz os atributos do elemento a cada mudança: o selo volta.
          this.listenTo(this.model, "change:attributes", () => paintBadge(this.model, this.el));
        },
        onRender({ el, model }: { el: HTMLElement; model: Component }) {
          paintBadge(model, el);
        },
      },
    });
  }
}
