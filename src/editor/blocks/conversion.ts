/**
 * Blocos de conversão: botões (inclusive ligado ao checkout da oferta),
 * contador, escassez, notificação de compra, preços, garantia, WhatsApp,
 * popup de saída e "Acesso ao produto" (página de obrigado do pagamento na página). Os que têm comportamento usam os widgets de
 * src/editor/widgets (opções em "Configurações").
 */
import { PROP_ACCESS_LANG } from "@/editor/widgets/access";
import { accessDef } from "@/editor/widgets/access-content";
import { buttonDef } from "@/editor/widgets/button";
import { countdownDef } from "@/editor/widgets/countdown";
import { exitPopupDef } from "@/editor/widgets/exit-popup";
import { salesNotificationDef } from "@/editor/widgets/sales-notification";
import { scarcityDef } from "@/editor/widgets/scarcity";
import { whatsappButtonDef, whatsappFloatDef } from "@/editor/widgets/whatsapp";
import { checkList } from "./content";
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

const small = (content: string, extra: Record<string, string> = {}): Def =>
  text("p", content, { margin: "12px 0 0", "font-size": "14px", color: C.soft, "text-align": "center", ...extra });

// ─── Botões ──────────────────────────────────────────────────────────────────

const bigCta = el("div", "Botão CTA", { margin: "32px auto", padding: "0 16px", "text-align": "center" }, [
  buttonDef("SIM! QUERO GARANTIR MINHA VAGA", { style: { "font-size": "23px", padding: "22px 48px" } }),
  small("🔒 Compra 100% segura &nbsp;·&nbsp; Acesso imediato"),
]);

const checkoutCta = el("div", "Botão do checkout", { margin: "32px auto", padding: "0 16px", "text-align": "center" }, [
  buttonDef("QUERO COMPRAR AGORA", { checkout: true }),
  small("Pagamento seguro via Pix, cartão de crédito ou boleto"),
]);

// ─── Preços ──────────────────────────────────────────────────────────────────

interface PlanOptions {
  name: string;
  subtitle: string;
  from: string;
  installments: string;
  cash: string;
  benefits: string[];
  cta: string;
  featured?: boolean;
}

const priceParts = (p: Pick<PlanOptions, "from" | "installments" | "cash">, big = "46px"): Def[] => [
  text("p", `de <s>${p.from}</s> por apenas`, { margin: "0", "font-size": "16px", color: C.soft }),
  text("p", "12x de", { margin: "6px 0 0", "font-size": "16px", "font-weight": "600", color: C.muted }),
  onMobile(
    text("p", p.installments, {
      margin: "0",
      "font-size": big,
      "font-weight": "900",
      "line-height": "1.1",
      "letter-spacing": "-0.02em",
      color: C.green,
    }),
    { "font-size": "40px" },
  ),
  text("p", `ou ${p.cash} à vista`, { margin: "4px 0 22px", "font-size": "16px", color: C.muted }),
];

function plan(p: PlanOptions): Def {
  const featured = !!p.featured;
  return el(
    "div",
    `Plano: ${p.name}`,
    {
      position: "relative",
      display: "flex",
      "flex-direction": "column",
      padding: featured ? "44px 28px 28px" : "32px 28px 28px",
      "box-sizing": "border-box",
      "border-radius": "20px",
      border: featured ? "3px solid #16a34a" : "1px solid #e5e7eb",
      "background-color": "#ffffff",
      "box-shadow": featured ? "0 24px 56px rgba(22,163,74,.22)" : "0 10px 30px rgba(15,23,42,.07)",
      "text-align": "center",
      color: C.text,
    },
    [
      ...(featured
        ? [
            text(
              "div",
              "⭐ MAIS ESCOLHIDO",
              {
                position: "absolute",
                top: "-17px",
                left: "50%",
                transform: "translateX(-50%)",
                padding: "7px 16px",
                "border-radius": "999px",
                "background-color": "#16a34a",
                color: "#ffffff",
                "font-size": "13px",
                "font-weight": "800",
                "letter-spacing": "0.06em",
                "white-space": "nowrap",
              },
              { name: "Selo de destaque" },
            ),
          ]
        : []),
      text("h3", p.name, { margin: "0 0 6px", "font-size": "22px", "font-weight": "800" }),
      text("p", p.subtitle, { margin: "0 0 18px", "font-size": "15px", color: C.soft }),
      ...priceParts(p),
      checkList(p.benefits, { margin: "0 0 24px", "max-width": "none", flex: "1" }, "16px"),
      buttonDef(p.cta, {
        checkout: true,
        auto: false,
        style: {
          width: "100%",
          padding: "18px 16px",
          "font-size": "18px",
          ...(featured ? {} : { "background-color": "#111827", "box-shadow": "0 8px 20px rgba(17,24,39,.2)" }),
        },
      }),
      small("🔒 Compra segura"),
    ],
  );
}

const pricingTable = section(
  "Tabela de preços",
  [
    sectionTitle("Escolha o seu plano"),
    sectionLead("Comece hoje com o plano ideal para você. Todos têm 7 dias de garantia."),
    el(
      "div",
      "Planos",
      {
        display: "grid",
        "grid-template-columns": "repeat(auto-fit, minmax(min(280px, 100%), 1fr))",
        gap: "28px",
        "align-items": "stretch",
        "padding-top": "12px",
      },
      [
        plan({
          name: "Básico",
          subtitle: "Para começar do jeito certo",
          from: "R$ 197,00",
          installments: "R$ 9,70",
          cash: "R$ 97,00",
          benefits: ["Curso completo", "Acesso por 6 meses", "Suporte por e-mail"],
          cta: "QUERO O BÁSICO",
        }),
        plan({
          name: "Completo",
          subtitle: "O mais vendido: tudo para ter resultado",
          from: "R$ 497,00",
          installments: "R$ 19,70",
          cash: "R$ 197,00",
          benefits: [
            "Curso completo",
            "Acesso por 12 meses",
            "3 bônus exclusivos",
            "Grupo de alunos no WhatsApp",
            "Certificado",
          ],
          cta: "QUERO O COMPLETO",
          featured: true,
        }),
        plan({
          name: "VIP",
          subtitle: "Acompanhamento de perto",
          from: "R$ 997,00",
          installments: "R$ 49,70",
          cash: "R$ 497,00",
          benefits: ["Tudo do plano Completo", "Acesso vitalício", "Mentoria ao vivo mensal", "Suporte prioritário"],
          cta: "QUERO O VIP",
        }),
      ],
    ),
  ],
  { "background-color": C.bgSoft },
);

const singleOffer = section(
  "Oferta (1 plano)",
  [
    onMobile(
      el(
        "div",
        "Caixa da oferta",
        {
          "max-width": "560px",
          margin: "0 auto",
          padding: "40px 32px 32px",
          "box-sizing": "border-box",
          "border-radius": "24px",
          border: "3px solid #16a34a",
          "background-color": "#ffffff",
          "box-shadow": "0 24px 60px rgba(22,163,74,.18)",
          "text-align": "center",
          color: C.text,
        },
        [
          text("p", "OFERTA ESPECIAL POR TEMPO LIMITADO", {
            display: "inline-block",
            margin: "0 0 14px",
            padding: "7px 14px",
            "border-radius": "999px",
            "background-color": "#fef3c7",
            color: "#92400e",
            "font-size": "12px",
            "font-weight": "800",
            "letter-spacing": "0.08em",
          }),
          onMobile(
            text("h2", "Método X Completo", {
              margin: "0 0 20px",
              "font-size": "32px",
              "font-weight": "800",
              "line-height": "1.2",
            }),
            {
              "font-size": "26px",
            },
          ),
          image(placeholderImage("Imagem do produto", 680, 480), "Imagem do produto", {
            display: "block",
            width: "100%",
            "max-width": "340px",
            height: "auto",
            margin: "0 auto 24px",
            "border-radius": "14px",
          }),
          checkList(
            ["Curso completo em vídeo", "3 bônus exclusivos", "Grupo de alunos", "Acesso imediato"],
            { margin: "0 auto 24px", "max-width": "360px" },
            "17px",
          ),
          ...priceParts({ from: "R$ 497,00", installments: "R$ 19,70", cash: "R$ 197,00" }, "52px"),
          buttonDef("QUERO GARANTIR O MEU", { checkout: true, pulse: true, style: { width: "100%" } }),
          small("Pix &nbsp;·&nbsp; Cartão de crédito &nbsp;·&nbsp; Boleto", { "margin-top": "14px" }),
          small("🔒 Compra 100% segura &nbsp;·&nbsp; ✔ 7 dias de garantia", { "margin-top": "4px" }),
        ],
      ),
      { padding: "32px 20px 24px" },
    ),
  ],
  { "background-color": C.bgSoft },
);

// ─── Garantia ────────────────────────────────────────────────────────────────

function rosette(cx: number, cy: number, rOut: number, rIn: number, n: number) {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? rIn : rOut;
    const a = (Math.PI * i) / n - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}

const SEAL_SVG = `<svg viewBox="0 0 200 200" width="100%" height="100%" aria-hidden="true" focusable="false"><polygon points="${rosette(100, 100, 99, 89, 28)}" fill="#f59e0b"/><circle cx="100" cy="100" r="80" fill="#fde68a"/><circle cx="100" cy="100" r="71" fill="none" stroke="#d97706" stroke-width="2.5" stroke-dasharray="5 4"/></svg>`;

export function guaranteeSeal(days = "7"): Def {
  return el(
    "div",
    "Selo de garantia",
    {
      position: "relative",
      display: "flex",
      "flex-direction": "column",
      "align-items": "center",
      "justify-content": "center",
      width: "170px",
      height: "170px",
      "flex-shrink": "0",
      margin: "0 auto",
      color: "#78350f",
      "text-align": "center",
    },
    [
      el(
        "div",
        "Desenho do selo",
        { position: "absolute", top: "0", left: "0", width: "100%", height: "100%" },
        SEAL_SVG,
        {
          selectable: false,
          hoverable: false,
          layerable: false,
        },
      ),
      text(
        "div",
        days,
        { position: "relative", "font-size": "58px", "font-weight": "900", "line-height": "0.9" },
        { name: "Dias" },
      ),
      text("div", "DIAS DE<br>GARANTIA", {
        position: "relative",
        "margin-top": "4px",
        "font-size": "13px",
        "font-weight": "800",
        "letter-spacing": "0.06em",
        "line-height": "1.2",
      }),
    ],
    { droppable: false },
  );
}

const guarantee = onMobile(
  el(
    "div",
    "Garantia",
    {
      display: "flex",
      "flex-wrap": "wrap",
      "align-items": "center",
      "justify-content": "center",
      gap: "32px",
      "max-width": "900px",
      margin: "40px auto",
      padding: "36px",
      "box-sizing": "border-box",
      "border-radius": "22px",
      border: "2px solid #fde68a",
      "background-color": "#fffbeb",
      color: C.text,
    },
    [
      guaranteeSeal("7"),
      el("div", "Texto da garantia", { flex: "1 1 340px", "min-width": "0" }, [
        onMobile(
          text("h3", "Garantia incondicional de 7 dias", {
            margin: "0 0 10px",
            "font-size": "28px",
            "font-weight": "800",
            "line-height": "1.2",
          }),
          {
            "font-size": "23px",
          },
        ),
        text(
          "p",
          "Você pode entrar, assistir às aulas e testar tudo por 7 dias. Se por qualquer motivo não gostar, é só pedir o reembolso e devolvemos 100% do seu dinheiro — sem perguntas e sem burocracia.",
          {
            margin: "0 0 10px",
            "font-size": "17px",
            "line-height": "1.65",
            color: "#374151",
          },
        ),
        text("p", "<strong>O risco é todo nosso.</strong>", { margin: "0", "font-size": "17px", color: "#92400e" }),
      ]),
    ],
  ),
  { margin: "24px 12px", padding: "28px 18px", "text-align": "center" },
);

// ─── Lista ───────────────────────────────────────────────────────────────────

export const conversionBlocks: OsBlock[] = [
  {
    id: "cta-grande",
    label: "Botão CTA grande",
    category: "conversao",
    media: icon('<rect x="2" y="7" width="20" height="10" rx="3"/><path d="M8 12h6M12 10l2 2-2 2"/>'),
    content: bigCta,
  },
  {
    id: "cta-checkout",
    label: "Botão do checkout",
    category: "conversao",
    media: icon(
      '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3h3l2.6 12.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L21.5 8H6.3"/>',
    ),
    content: checkoutCta,
  },
  {
    id: "contador",
    label: "Contador regressivo",
    category: "conversao",
    media: icon('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>'),
    content: countdownDef(),
  },
  {
    id: "escassez",
    label: "Barra de escassez",
    category: "conversao",
    media: icon('<rect x="2.5" y="9" width="19" height="6" rx="3"/><path d="M6 12h5"/>'),
    content: scarcityDef(),
  },
  {
    id: "notificacao-compra",
    label: "Notificação de compra",
    category: "conversao",
    media: icon(
      '<rect x="3" y="12" width="14" height="8" rx="2"/><circle cx="7" cy="16" r="1.5"/><path d="M10.5 15h4M10.5 17.5h2.5M16 4a4 4 0 0 1 4 4"/>',
    ),
    content: salesNotificationDef(),
  },
  {
    id: "oferta-1-plano",
    label: "Oferta (1 plano)",
    category: "conversao",
    media: icon(
      '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M8.5 11h7M10 14.5h4"/><rect x="8" y="17" width="8" height="2" rx="1"/>',
    ),
    content: singleOffer,
  },
  {
    id: "tabela-precos",
    label: "Tabela de preços",
    category: "conversao",
    media: icon(
      '<rect x="2" y="6" width="6" height="13" rx="1.5"/><rect x="9" y="3" width="6" height="16" rx="1.5"/><rect x="16" y="6" width="6" height="13" rx="1.5"/>',
    ),
    content: pricingTable,
  },
  {
    id: "garantia",
    label: "Garantia",
    category: "conversao",
    media: icon('<path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/>'),
    content: guarantee,
  },
  {
    id: "whatsapp-flutuante",
    label: "WhatsApp flutuante",
    category: "conversao",
    media: icon(
      '<path d="M20 11.5A8.5 8.5 0 0 1 7.4 19L3 20l1.1-4.2A8.5 8.5 0 1 1 20 11.5Z"/><path d="M9 8.5c0 3.5 2.5 6.5 6.5 6.5"/>',
    ),
    content: whatsappFloatDef(),
  },
  {
    id: "whatsapp-botao",
    label: "Botão de WhatsApp",
    category: "conversao",
    media: icon(
      '<rect x="2" y="7" width="20" height="10" rx="5"/><path d="M8.5 12.5a2.5 2.5 0 1 1 1 2L7 15l.5-1.5"/><path d="M13 12h5"/>',
    ),
    content: whatsappButtonDef(),
  },
  {
    id: "popup-saida",
    label: "Popup de saída",
    category: "conversao",
    media: icon(
      '<rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="2 2"/><rect x="6.5" y="7" width="11" height="10" rx="1.5"/><path d="m14.5 9-1.5 1.5"/>',
    ),
    content: exitPopupDef(),
  },
  {
    id: "acesso-produto",
    label: "Acesso ao produto",
    category: "conversao",
    media: icon(
      '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2"/><circle cx="12" cy="15.5" r="1.5"/>',
    ),
    // Nasce no idioma do produto de pagamento da oferta (ver src/editor/widgets/access.ts).
    content: { ...accessDef(), [PROP_ACCESS_LANG]: true },
    select: true,
  },
];
