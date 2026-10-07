/**
 * Quiz (data-os-widget="quiz"): mostra uma etapa por vez (classe os-qz-cur;
 * o resto fica escondido pelo CSS dos widgets com a classe os-qz-on no quiz).
 *
 * - Pergunta de escolha única: marcar uma opção avança sozinho depois de uma
 *   pequena pausa (dá para ver a marcação). Escolha múltipla
 *   (data-os-multi="1"): marca/desmarca e o "Continuar" só vale com pelo
 *   menos uma marcada. As opções são <button> com aria-pressed.
 * - Informação: "Continuar" ([data-os-qz-next]).
 * - Analisando: barra, porcentagem e mensagens (data-os-messages, uma por
 *   linha) que se alternam; avança sozinha depois de data-os-seconds (padrão 4).
 * - Final: o botão [data-os-qz-go] é um link comum (página do funil, link da
 *   oferta ou endereço), com o repasse de UTMs do rastreamento.
 * - "Voltar" ([data-os-qz-back], data-os-back="0" esconde): volta à etapa
 *   anterior pulando a tela "Analisando"; some na primeira etapa e no fim.
 * - Barra de progresso ([data-os-qz-fill], data-os-progress="0" esconde).
 *
 * Ao trocar de etapa: transição suave, o foco vai para o título da etapa nova
 * (sem rolar), a página rola até o topo do quiz se ele saiu da tela (celular)
 * e um aviso só para leitores de tela diz em que pergunta a pessoa está.
 *
 * Eventos "os:quiz" (no elemento do quiz, sobem até o document) para o
 * rastreamento (src/runtime/tracking/quiz.ts): { kind: "answer", question: n }
 * uma vez por pergunta respondida e { kind: "complete" } ao chegar na etapa
 * final; os dois com total (perguntas do quiz), track (data-os-track, padrão
 * ligado: mandar para os pixels) e quiz (posição do quiz na página: 1, 2…).
 *
 * Sem a etapa final (HTML antigo ou colado: no editor ela não sai), a última
 * pergunta ainda conta e o quiz é dado como concluído; a tela "Analisando" no
 * fim devolve o "Voltar" em vez de prender a pessoa.
 */
import { flag, markAutoScroll, num, opt, widgets } from "./util";

const STEP = "[data-os-qz-step]";
/** Pausa depois de marcar a opção (escolha única), para ver a marcação (ms). */
const PICK_DELAY_MS = 450;

export interface QuizEventDetail {
  kind: "answer" | "complete";
  /** Número da pergunta respondida (1, 2…), só em "answer". */
  question?: number;
  /** Quantas perguntas o quiz tem. */
  total: number;
  /** data-os-track: mandar para os pixels. */
  track: boolean;
  /** Posição do quiz na página (1, 2…): separa os eventos de dois quizzes. */
  quiz: number;
}

let count = 0;

export function initQuizzes(root?: ParentNode) {
  for (const quiz of widgets("quiz", root)) {
    try {
      setup(quiz, ++count);
    } catch {
      // um quiz com problema não derruba os outros
    }
  }
}

function setup(quiz: HTMLElement, position: number) {
  /** Elementos deste quiz (não de um quiz dentro dele). */
  const own = (sel: string, from: ParentNode = quiz) =>
    Array.from(from.querySelectorAll<HTMLElement>(sel)).filter((el) => el.closest('[data-os-widget="quiz"]') === quiz);
  const steps = own(STEP);
  if (!steps.length) return;
  const kindOf = (step: HTMLElement) => step.getAttribute("data-os-qz-step") || "info";
  const questions = steps.filter((s) => kindOf(s) === "question");
  const fill = own("[data-os-qz-fill]")[0];
  const bar = own("[data-os-qz-bar]")[0];
  const doc = document;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const live = doc.createElement("p");
  live.className = "os-qz-sr";
  live.setAttribute("aria-live", "polite");
  quiz.appendChild(live);

  for (const option of own("[data-os-qz-option]")) option.setAttribute("aria-pressed", "false");

  let cur = -1;
  /** Etapas por onde a pessoa passou (para o "Voltar"). */
  const trail: number[] = [];
  const answered: Record<number, boolean> = {};
  let finished = false;
  let busy = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ticker: ReturnType<typeof setInterval> | undefined;

  const emit = (detail: Omit<QuizEventDetail, "total" | "track" | "quiz">) => {
    const full: QuizEventDetail = {
      ...detail,
      total: questions.length,
      track: flag(quiz, "track", true),
      quiz: position,
    };
    quiz.dispatchEvent(new CustomEvent("os:quiz", { bubbles: true, detail: full }));
  };

  const pressed = (step: HTMLElement) => own('[data-os-qz-option][aria-pressed="true"]', step);

  /** "Continuar" da escolha múltipla: só com alguma opção marcada. */
  function syncNext(step: HTMLElement) {
    if (kindOf(step) !== "question") return;
    const off = flag(step, "multi", false) && !pressed(step).length;
    for (const btn of own("[data-os-qz-next]", step)) {
      (btn as HTMLButtonElement).disabled = off;
      if (off) btn.setAttribute("aria-disabled", "true");
      else btn.removeAttribute("aria-disabled");
    }
  }

  function stop() {
    clearTimeout(timer);
    clearInterval(ticker);
    busy = false;
  }

  /** Tela "Analisando": barra, porcentagem e mensagens; depois avança sozinha. */
  function analyze(step: HTMLElement) {
    const ms = num(step, "seconds", 4, 1, 60) * 1000;
    const messages = opt(step, "messages")
      .split(/\r?\n|\|/)
      .map((m) => m.trim())
      .filter(Boolean);
    const loadFill = own("[data-os-qz-loadfill]", step)[0];
    const pct = own("[data-os-qz-pct]", step)[0];
    const msg = own("[data-os-qz-msg]", step)[0];
    if (loadFill) {
      loadFill.style.transition = "none";
      loadFill.style.width = "0%";
      void loadFill.offsetWidth;
      loadFill.style.transition = `width ${ms}ms linear`;
      loadFill.style.width = "100%";
    }
    const t0 = Date.now();
    const tick = () => {
      const p = Math.min(1, (Date.now() - t0) / ms);
      if (pct) pct.textContent = `${Math.round(p * 100)}%`;
      if (msg && messages.length)
        msg.textContent = messages[Math.min(messages.length - 1, Math.floor(p * messages.length))];
      if (p >= 1) {
        clearInterval(ticker);
        go(cur + 1, false);
      }
    };
    tick();
    ticker = setInterval(tick, 100);
  }

  /** Mostra a etapa `i`. `moved`: a pessoa trocou de etapa (foco e rolagem). */
  function show(i: number, moved: boolean) {
    stop();
    const before = steps[cur];
    if (before) before.classList.remove("os-qz-cur", "os-qz-in");
    cur = i;
    const step = steps[i];
    const kind = kindOf(step);
    step.classList.add("os-qz-cur");
    if (moved && !reduced) {
      void step.offsetWidth;
      step.classList.add("os-qz-in");
    }
    const progress = Math.round(((i + 1) / steps.length) * 100);
    if (fill) fill.style.width = `${progress}%`;
    if (bar) bar.setAttribute("aria-valuenow", String(progress));
    quiz.classList.toggle("os-qz-noback", !trail.length || kind === "loading" || kind === "final");
    const n = questions.indexOf(step) + 1;
    live.textContent = n ? `Pergunta ${n} de ${questions.length}` : "";
    syncNext(step);
    if (kind === "loading") analyze(step);
    if (kind === "final" && !finished) {
      finished = true;
      emit({ kind: "complete" });
    }
    if (!moved) return;
    const title = step.querySelector<HTMLElement>("h1,h2,h3,h4,.os-qz-title") || step;
    if (!title.hasAttribute("tabindex")) title.setAttribute("tabindex", "-1");
    try {
      title.focus({ preventScroll: true });
    } catch {
      title.focus();
    }
    // O topo do quiz saiu da tela (celular, pergunta comprida): volta para ele.
    const top = quiz.getBoundingClientRect().top;
    if (top < 0) {
      // O popup de saída não confunde essa subida com a pessoa saindo da página.
      markAutoScroll();
      scrollTo({ top: scrollY + top - 12, behavior: reduced ? "auto" : "smooth" });
    }
  }

  /** Vai para a etapa `i` (pergunta respondida conta para o rastreamento). */
  function go(i: number, remember = true) {
    const step = steps[cur];
    const n = questions.indexOf(step) + 1;
    if (n && !answered[n]) {
      answered[n] = true;
      emit({ kind: "answer", question: n });
    }
    if (i >= steps.length) {
      // Quiz sem etapa final: conta como concluído e não prende ninguém na
      // tela "Analisando" (o "Voltar" reaparece).
      if (!finished) {
        finished = true;
        emit({ kind: "complete" });
      }
      if (kindOf(step) === "loading" && trail.length) quiz.classList.remove("os-qz-noback");
      return;
    }
    // A tela "Analisando" não entra no "Voltar" (ela avançaria sozinha de novo).
    if (remember && kindOf(step) !== "loading") trail.push(cur);
    show(i, true);
  }

  quiz.addEventListener("click", (e) => {
    const target = e.target as Element;
    // Clique num quiz dentro de uma etapa deste: é do outro quiz.
    if (target.closest('[data-os-widget="quiz"]') !== quiz) return;
    const step = steps[cur];
    const option = target.closest<HTMLElement>("[data-os-qz-option]");
    if (option && step.contains(option)) {
      e.preventDefault();
      if (busy) return;
      if (flag(step, "multi", false)) {
        option.setAttribute("aria-pressed", String(option.getAttribute("aria-pressed") !== "true"));
        syncNext(step);
        return;
      }
      for (const other of own("[data-os-qz-option]", step))
        other.setAttribute("aria-pressed", String(other === option));
      busy = true;
      timer = setTimeout(() => {
        busy = false;
        go(cur + 1);
      }, PICK_DELAY_MS);
      return;
    }
    const next = target.closest("[data-os-qz-next]");
    if (next && step.contains(next)) {
      e.preventDefault();
      if (busy || (next as HTMLButtonElement).disabled) return;
      if (kindOf(step) === "question" && flag(step, "multi", false) && !pressed(step).length) return;
      go(cur + 1);
      return;
    }
    if (target.closest("[data-os-qz-back]")) {
      e.preventDefault();
      const prev = trail.pop();
      if (prev !== undefined) show(prev, true);
    }
  });

  quiz.classList.add("os-qz-on");
  show(0, false);
}
