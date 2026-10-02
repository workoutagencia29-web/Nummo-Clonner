/**
 * Blocos de formulário: captura de leads (nome, e‑mail e WhatsApp), com envio
 * para webhook e redirecionamento (ver src/editor/widgets/lead-form.ts).
 */
import { leadFormDef } from "@/editor/widgets/lead-form";
import { C, el, icon, type OsBlock, onMobile, section, sectionLead, sectionTitle, text } from "./shared";

const captureCard = onMobile(
  el(
    "div",
    "Captura",
    {
      "max-width": "480px",
      margin: "40px auto",
      padding: "34px 30px",
      "box-sizing": "border-box",
      "border-radius": "22px",
      border: "1px solid #e5e7eb",
      "background-color": "#ffffff",
      "box-shadow": "0 24px 56px rgba(15,23,42,.14)",
      "text-align": "center",
      color: C.text,
    },
    [
      onMobile(
        text("h3", "Receba a aula gratuita agora", {
          margin: "0 0 8px",
          "font-size": "26px",
          "font-weight": "800",
          "line-height": "1.2",
        }),
        {
          "font-size": "23px",
        },
      ),
      text("p", "Preencha abaixo e receba o acesso direto no seu e-mail.", {
        margin: "0 0 22px",
        "font-size": "16px",
        "line-height": "1.55",
        color: C.muted,
      }),
      leadFormDef({ fields: ["name", "email", "phone"] }),
    ],
  ),
  { padding: "26px 20px", margin: "24px auto" },
);

const captureSection = section(
  "Seção de captura",
  [
    sectionTitle("Entre para a lista VIP", { color: "#ffffff" }),
    sectionLead("Seja avisado(a) em primeira mão quando as vagas abrirem — com condição especial.", {
      color: "rgba(255,255,255,.85)",
      "margin-bottom": "28px",
    }),
    el("div", "Formulário", { "max-width": "440px", margin: "0 auto" }, [
      leadFormDef({ fields: ["name", "email"], button: "QUERO ENTRAR NA LISTA", noteColor: "rgba(255,255,255,.7)" }),
    ]),
  ],
  {
    "background-color": "#0f172a",
    "background-image": "linear-gradient(160deg,#0f172a 0%,#1e3a8a 100%)",
    "text-align": "center",
  },
);

export const formBlocks: OsBlock[] = [
  {
    id: "form-captura",
    label: "Formulário de captura",
    category: "formularios",
    media: icon(
      '<rect x="4" y="3" width="16" height="18" rx="2"/><rect x="7" y="7" width="10" height="3" rx="1"/><rect x="7" y="12" width="10" height="3" rx="1"/><path d="M9 18h6"/>',
    ),
    content: captureCard,
  },
  {
    id: "secao-captura",
    label: "Seção de captura",
    category: "formularios",
    media: icon(
      '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 8h10"/><rect x="7" y="11" width="10" height="2.5" rx="1"/><rect x="9" y="15.5" width="6" height="2" rx="1"/>',
    ),
    content: captureSection,
  },
];
