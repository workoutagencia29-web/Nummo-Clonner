/**
 * Categoria "Quiz e roleta":
 * - "Quiz": perguntas e respostas, uma etapa por vez na página (sem pedir
 *   contato), com tela "Analisando" e uma etapa final com o botão que leva à
 *   próxima página do funil. Etapas, opções, cores e destino ficam em
 *   "Configurações" (src/editor/widgets/quiz.ts); o comportamento roda só na
 *   página (src/runtime/widgets/quiz.ts).
 * - "Roleta de desconto": a roda com as fatias (4 de exemplo, ainda sem link),
 *   o "Girar" e o resultado com o botão "Resgatar" (src/editor/widgets/wheel.ts;
 *   na página, src/runtime/widgets/wheel.ts).
 */
import { BLOCK_QUIZ, quizDef } from "@/editor/widgets/quiz-content";
import { DEFAULT_WHEEL, wheelDef } from "@/editor/widgets/wheel-content";
import { icon, type OsBlock } from "./shared";

export const quizBlocks: OsBlock[] = [
  {
    id: "quiz",
    label: "Quiz",
    category: "quiz",
    media: icon(
      '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 7.5h10"/><rect x="7" y="10.5" width="10" height="3" rx="1.2"/><rect x="7" y="15.5" width="10" height="3" rx="1.2"/><path d="M9.5 12h.01M9.5 17h.01"/>',
    ),
    content: quizDef(BLOCK_QUIZ),
    select: true,
  },
  {
    id: "roleta",
    label: "Roleta de desconto",
    category: "quiz",
    media: icon(
      '<circle cx="12" cy="13" r="8"/><path d="M12 13V5M12 13l6.9 4M12 13l-6.9 4"/><path d="M10 2.5h4L12 5z"/>',
    ),
    content: wheelDef(DEFAULT_WHEEL),
    select: true,
  },
];
