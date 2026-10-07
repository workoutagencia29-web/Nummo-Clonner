/**
 * Modelo: página de quiz para receber o tráfego do anúncio. Página limpa, com
 * o quiz no centro (4 perguntas, 1 informação, "Analisando" e a etapa final
 * com o botão para a próxima página do funil — destino escolhido no editor).
 * O quiz é o mesmo do bloco "Quiz" (src/editor/widgets/quiz-content.ts).
 */
import { defToHtml, QUIZ_CSS, quizDef, TEMPLATE_QUIZ } from "@/editor/widgets/quiz-content";
import { pageDocument } from "./document";
import { buildCss, theme } from "./styles";
import { footer } from "./widgets";

const t = theme({
  primary: "#7c3aed",
  primarySoft: "#ede9fe",
  primaryShadow: "rgba(124,58,237,.5)",
  soft: "#f5f3ff",
  heading: "#1e1b4b",
});

const extra = `
.os-qhead{padding:14px 20px;text-align:center;background:#fff;border-bottom:1px solid var(--os-line)}
.os-qbrand{margin:0;font-size:15px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:var(--os-heading)}
.os-qmain{padding:28px 0 56px;background:linear-gradient(180deg,var(--os-soft),#fff 75%)}
.os-qwrap{max-width:640px;text-align:center}
.os-qpill{display:inline-block;margin:0 0 12px;padding:6px 14px;border-radius:999px;background:var(--os-primary-soft);color:var(--os-primary);font-size:13px;font-weight:800;letter-spacing:.04em}
.os-qh1{max-width:560px;margin:0 auto 4px;font-size:clamp(26px,5vw,36px);line-height:1.2}
.os-qtrust{max-width:520px;margin:6px auto 0;font-size:13px;line-height:1.5;color:var(--os-muted)}
@media (max-width:480px){.os-qmain{padding:18px 0 40px}.os-qwrap{padding-left:14px;padding-right:14px}}
${QUIZ_CSS}`;

const body = `
<header class="os-qhead"><p class="os-qbrand"><span class="os-ph">{{EMPRESA}}</span></p></header>
<main class="os-qmain">
<div class="os-container os-qwrap">
<p class="os-qpill">⏱️ Leva menos de 1 minuto</p>
<h1 class="os-h1 os-qh1">Responda 4 perguntas rápidas e ganhe um giro na roleta de descontos</h1>
${defToHtml(quizDef(TEMPLATE_QUIZ))}
<p class="os-qtrust">🔒 Suas respostas são anônimas e servem só para mostrar a melhor condição para você.</p>
</div>
</main>

${footer({ links: true })}
`;

export const quizHtml = pageDocument({
  title: "Quiz",
  css: buildCss(t, ["button", "footer"], extra),
  body,
});
