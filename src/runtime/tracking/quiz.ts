/**
 * Eventos do quiz para os pixels (sem regra para configurar): cada pergunta
 * respondida e a chegada ao fim viram eventos personalizados, com um nome por
 * pergunta — assim o painel da Meta e o relatório de eventos do GA4 mostram,
 * pergunta a pergunta, quantas pessoas seguiram (e onde desistiram):
 *
 * - Meta e TikTok: QuizPergunta1, QuizPergunta2… e QuizConcluido;
 * - GA4: quiz_pergunta_1, quiz_pergunta_2… e quiz_concluido.
 *
 * Parâmetros: quiz_pergunta (número), quiz_total (perguntas do quiz) e, com
 * mais de um quiz na mesma página, quiz_numero (2, 3…: o primeiro não leva,
 * para não mudar o caso comum de um quiz só) — nunca
 * o texto das respostas (pode ser dado sensível, como saúde, que as
 * plataformas proíbem receber) — e, no teste A/B, os_versao.
 *
 * O quiz (src/runtime/widgets/quiz.ts) avisa com o evento "os:quiz"; com
 * data-os-track="0" ele não vai para os pixels. Passa pelo mesmo
 * consentimento dos outros eventos (espera o "Aceitar"; "Recusar" bloqueia).
 * Kwai, Google Ads e UTMify não recebem (eventos só padrão/conversões).
 */
export interface QuizEvent {
  /** Nome na Meta/TikTok (QuizPergunta2). */
  name: string;
  /** Nome no GA4 (quiz_pergunta_2). */
  ga: string;
  /** Números do quiz; o texto do prêmio na roleta (./wheel.ts). */
  params: Record<string, number | string>;
}

/** Evento dos pixels para um aviso "os:quiz" (null = não manda nada). */
export function quizEvent(detail: unknown): QuizEvent | null {
  const d = (detail || {}) as Record<string, unknown>;
  const n = d.question as number;
  const total = d.total;
  if (d.track === false || typeof total !== "number") return null;
  const params: Record<string, number> = { quiz_total: total };
  // Segundo quiz da página em diante: os eventos não se somam sem distinção.
  if (typeof d.quiz === "number" && d.quiz > 1) params.quiz_numero = d.quiz;
  if (d.kind === "complete") return { name: "QuizConcluido", ga: "quiz_concluido", params };
  if (d.kind !== "answer" || typeof n !== "number" || !(n > 0 && n < 100 && n % 1 === 0)) return null;
  params.quiz_pergunta = n;
  return { name: `QuizPergunta${n}`, ga: `quiz_pergunta_${n}`, params };
}

/** Sem depender de ./util: quizEvent é testado fora do navegador. */
export function startQuizEvents(fire: (ev: QuizEvent) => void) {
  document.addEventListener("os:quiz", (e) => {
    const ev = quizEvent((e as CustomEvent).detail);
    if (ev) fire(ev);
  });
}
