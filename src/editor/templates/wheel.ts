/**
 * Modelo: página da roleta de desconto (a etapa entre o quiz e a página de
 * vendas). Página limpa, com a roleta no centro: 4 fatias de exemplo (10%,
 * 20%, 30% e 50% OFF, chances 40/30/20/10) ainda sem o link de cada prêmio —
 * o canvas, o "Próximos passos" e o ZIP avisam. A roleta é a mesma do bloco
 * "Roleta de desconto" (src/editor/widgets/wheel-content.ts).
 */
import { defToHtml } from "@/editor/widgets/quiz-content";
import { DEFAULT_WHEEL, WHEEL_CSS, wheelDef } from "@/editor/widgets/wheel-content";
import { pageDocument } from "./document";
import { buildCss, theme } from "./styles";
import { footer } from "./widgets";

/** A página já tem o título (h1): a roleta só diz o que fazer. */
const TEMPLATE_WHEEL = {
  ...DEFAULT_WHEEL,
  title: "Toque em girar e descubra o seu desconto",
  sub: "Um giro por pessoa. Boa sorte! 🍀",
};

const t = theme({
  primary: "#16a34a",
  primarySoft: "#dcfce7",
  primaryShadow: "rgba(22,163,74,.45)",
  soft: "#f5f3ff",
  heading: "#1e1b4b",
});

const extra = `
.os-whead{padding:14px 20px;text-align:center;background:#fff;border-bottom:1px solid var(--os-line)}
.os-wbrand{margin:0;font-size:15px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:var(--os-heading)}
.os-wmain{padding:26px 0 56px;background:radial-gradient(120% 70% at 50% 0,#ede9fe 0,#f5f3ff 45%,#fff 80%)}
.os-wwrap{max-width:640px;text-align:center}
.os-wh1{max-width:560px;margin:0 auto;font-size:clamp(26px,5vw,34px);line-height:1.2}
.os-wpill{display:inline-block;margin:0 0 10px;padding:6px 14px;border-radius:999px;background:#fef3c7;color:#92400e;font-size:13px;font-weight:800;letter-spacing:.04em}
.os-wtrust{max-width:520px;margin:6px auto 0;font-size:13px;line-height:1.5;color:var(--os-muted)}
@media (max-width:480px){.os-wmain{padding:16px 0 40px}.os-wwrap{padding-left:12px;padding-right:12px}}
${WHEEL_CSS}`;

const body = `
<header class="os-whead"><p class="os-wbrand"><span class="os-ph">{{EMPRESA}}</span></p></header>
<main class="os-wmain">
<div class="os-container os-wwrap">
<p class="os-wpill">🎁 Presente por ter respondido o quiz</p>
<h1 class="os-h1 os-wh1">Você ganhou 1 giro na roleta de descontos!</h1>
${defToHtml(wheelDef(TEMPLATE_WHEEL, { html: true }))}
<p class="os-wtrust">🔒 Um giro por pessoa. O desconto fica reservado para você e vale direto no checkout.</p>
</div>
</main>

${footer({ links: true })}
`;

export const wheelHtml = pageDocument({
  title: "Roleta de desconto",
  css: buildCss(t, ["button", "footer"], extra),
  body,
});
