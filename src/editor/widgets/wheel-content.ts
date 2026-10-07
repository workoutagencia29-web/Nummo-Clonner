/**
 * Roleta de desconto (data-os-widget="wheel"): o CSS da página e a definição
 * do widget, usados pelo bloco "Roleta de desconto" e pelo modelo de página
 * "Roleta". Sem GrapesJS aqui (o modelo de página é montado no servidor).
 *
 * Estrutura (os ganchos data-os-* são o que o script da página lê,
 * src/runtime/widgets/wheel.ts; as classes os-wh-* são o visual):
 *
 *   div.os-wheel[data-os-widget=wheel][data-os-slices=JSON][data-os-days][data-os-minutes][data-os-banner][data-os-track]
 *     h2.os-wh-title, p.os-wh-sub                (textos editáveis)
 *     div.os-wh-stage[data-os-wh-stage]          → div.os-wh-ptr (ponteiro) + div[data-os-wh-disc] (a roda: SVG
 *                                                  desenhado a partir das fatias) + div.os-wh-hub (centro)
 *     button[data-os-wh-spin]                    "GIRAR A ROLETA" (texto num <span>)
 *     p.os-wh-nojs                               aviso sem JavaScript
 *     div[data-os-wh-result][hidden]             resultado: [data-os-wh-win] + [data-os-wh-prize] (texto da fatia)
 *                                                  / [data-os-wh-lose]; [data-os-wh-coupon][hidden] (cupom +
 *                                                  copiar); a.os-btn[data-os-wh-go] (destino: página do funil,
 *                                                  link da oferta ou endereço)
 *
 * O desenho da roda não é guardado como elementos no editor: é refeito a partir
 * de data-os-slices (src/lib/wheel.ts, wheelSvg) ao desenhar e ao salvar o
 * HTML (src/editor/widgets/wheel.ts). Cores em variáveis na própria roleta
 * (--os-wh-cta: botões, --os-wh-rim: borda, --os-wh-ptr: ponteiro).
 */
import type { Def } from "@/editor/blocks/shared";
import { WHEEL_DAYS, WHEEL_MINUTES, type WheelSlice, wheelSvg } from "@/lib/wheel";

export const WHEEL_TYPE = "os-wheel";
export const WHEEL_STAGE_TYPE = "os-wheel-stage";
export const WHEEL_DISC_TYPE = "os-wheel-disc";
/** Texto do prêmio no resultado (vem das fatias). */
export const WHEEL_PRIZE_TYPE = "os-wheel-prize";
/** Cupom no resultado (vem das fatias). */
export const WHEEL_CODE_TYPE = "os-wheel-code";
/** Ponteiro e centro da roda (o clique seleciona a roleta). */
export const WHEEL_PART_TYPE = "os-wheel-part";
/** "Girar" e "Copiar" (texto num <span> dentro do botão). */
export const WHEEL_BUTTON_TYPE = "os-wheel-button";

/** Cores padrão (as mesmas do CSS abaixo). */
export const WHEEL_THEME = { cta: "#16a34a", rim: "#1e1b4b", ptr: "#f43f5e" } as const;

/**
 * CSS da página (vira regras editáveis do projeto, como o do quiz, e vai no
 * <head> do modelo "Roleta"). A roleta corta o que passa dela (overflow): a
 * roda girada ocupa um quadrado maior, com cantos vazios, que daria rolagem
 * lateral no celular. Com var(), só propriedades simples (o GrapesJS
 * perde atalhos como border/background com var()). Sem JavaScript, o "Girar"
 * some e aparece o aviso; seletores com :not([data-gjs-type]) não valem no
 * canvas do editor, onde tudo aparece (o resultado com um rótulo).
 */
export const WHEEL_CSS = [
  `.os-wheel{--os-wh-cta:${WHEEL_THEME.cta};--os-wh-rim:${WHEEL_THEME.rim};--os-wh-ptr:${WHEEL_THEME.ptr};position:relative;box-sizing:border-box;width:100%;max-width:520px;margin:24px auto;padding:26px 20px 28px;overflow:hidden;border-radius:24px;background:#fff;color:#1f2937;font-family:inherit;line-height:1.5;text-align:center;box-shadow:0 24px 60px -28px rgba(15,23,42,.35),0 0 0 1px rgba(15,23,42,.06)}`,
  ".os-wheel *,.os-wheel *::before,.os-wheel *::after{box-sizing:border-box}",
  ".os-wheel .os-wh-title{margin:0 0 6px;color:inherit;font-family:inherit;font-size:26px;font-weight:900;line-height:1.2;letter-spacing:-.01em;text-transform:none}",
  ".os-wheel .os-wh-sub{margin:0 0 18px;color:#6b7280;font-size:16px;line-height:1.5}",
  ".os-wheel .os-wh-stage{position:relative;width:100%;max-width:340px;margin:0 auto;padding-top:14px}",
  ".os-wheel .os-wh-disc{position:relative;width:100%;aspect-ratio:1/1;border-radius:50%;color:var(--os-wh-rim);box-shadow:0 22px 40px -18px rgba(15,23,42,.6);transform:rotate(0deg)}",
  ".os-wheel .os-wh-disc svg{display:block;width:100%;height:100%;overflow:visible;font-family:inherit}",
  ".os-wheel .os-wh-ptr{position:absolute;top:0;left:50%;z-index:2;width:0;height:0;margin-left:-17px;border-left:17px solid transparent;border-right:17px solid transparent;border-top-width:34px;border-top-style:solid;border-top-color:var(--os-wh-ptr);filter:drop-shadow(0 3px 3px rgba(0,0,0,.35))}",
  ".os-wheel .os-wh-hub{position:absolute;top:calc(50% + 7px);left:50%;z-index:1;display:flex;align-items:center;justify-content:center;width:19%;aspect-ratio:1/1;border-radius:50%;background:#fff;font-size:26px;line-height:1;transform:translate(-50%,-50%);box-shadow:0 0 0 5px var(--os-wh-rim),0 6px 14px rgba(0,0,0,.3)}",
  ".os-wheel .os-wh-spin{display:block;width:100%;max-width:340px;margin:22px auto 0;padding:18px 20px;border:0;border-radius:16px;background-color:var(--os-wh-cta);color:#fff;font-family:inherit;font-size:20px;font-weight:900;line-height:1.2;letter-spacing:.03em;text-transform:uppercase;cursor:pointer;box-shadow:0 14px 28px -14px var(--os-wh-cta),inset 0 -4px 0 rgba(0,0,0,.18)}",
  ".os-wheel .os-wh-spin:disabled{opacity:.6;cursor:default}",
  ".os-wheel .os-wh-spin:focus-visible,.os-wheel .os-wh-copy:focus-visible,.os-wheel .os-wh-go:focus-visible{outline-width:3px;outline-style:solid;outline-color:var(--os-wh-rim);outline-offset:3px}",
  ".os-wheel .os-wh-nojs{display:none;margin:14px 0 0;color:#6b7280;font-size:13px}",
  ".os-wheel .os-wh-result{margin:22px 0 0;padding:20px 16px 22px;border-radius:18px;background-color:#f0fdf4;box-shadow:inset 0 0 0 2px #bbf7d0}",
  ".os-wheel .os-wh-win{margin:0;color:#166534;font-size:18px;font-weight:800;line-height:1.35}",
  ".os-wheel .os-wh-prize{margin:2px 0 0;color:#15803d;font-size:42px;font-weight:900;line-height:1.1;letter-spacing:-.02em}",
  ".os-wheel .os-wh-lose{margin:0;color:#374151;font-size:18px;font-weight:700;line-height:1.4}",
  ".os-wheel .os-wh-coupon{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px;margin:14px 0 0;padding:10px 12px;border:2px dashed #86efac;border-radius:14px;background:#fff;color:#374151;font-size:15px}",
  ".os-wheel .os-wh-code{padding:5px 10px;border-radius:8px;background:#f1f5f9;color:#0f172a;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:17px;font-weight:800;letter-spacing:.08em}",
  ".os-wheel .os-wh-copy{margin:0;padding:9px 14px;border:0;border-radius:10px;background-color:#0f172a;color:#fff;font-family:inherit;font-size:14px;font-weight:700;line-height:1;text-transform:none;cursor:pointer}",
  ".os-wheel .os-wh-go{display:block;width:100%;max-width:none;margin:16px 0 0;padding:19px 20px;border:0;border-radius:16px;background-color:var(--os-wh-cta);background-image:none;color:#fff;font-family:inherit;font-size:19px;font-weight:900;line-height:1.25;text-align:center;text-decoration:none;text-transform:none;box-shadow:0 14px 28px -14px var(--os-wh-cta),inset 0 -3px 0 rgba(0,0,0,.15)}",
  ".os-wheel .os-wh-note{margin:10px 0 0;color:#6b7280;font-size:13px}",
  ".os-wheel .os-wh-result[hidden],.os-wheel .os-wh-coupon[hidden]{display:none}",
  // Sem JavaScript (e antes de o script começar): o aviso no lugar do "Girar".
  ".os-wheel:not(.os-wh-on):not([data-gjs-type]) .os-wh-nojs{display:block}",
  ".os-wheel:not(.os-wh-on):not([data-gjs-type]) .os-wh-spin{display:none}",
  "@media (max-width:480px){.os-wheel{margin:12px auto;padding:20px 14px 22px;border-radius:20px}.os-wheel .os-wh-title{font-size:23px}.os-wheel .os-wh-prize{font-size:36px}}",
].join("");

// ─── Definições ──────────────────────────────────────────────────────────────

export interface WheelSpec {
  title: string;
  sub: string;
  slices: WheelSlice[];
  spin: string;
  win: string;
  lose: string;
  go: string;
  /** Texto do botão para quem caiu numa fatia sem prêmio. */
  loseLabel: string;
  note: string;
}

const textDef = (tagName: string, content: string, cls: string, name: string, attributes?: Def["attributes"]): Def => ({
  type: "text",
  tagName,
  name,
  classes: [cls],
  ...(attributes && { attributes }),
  content,
});

/** Botão com o texto num <span> (o Espaço entra no texto ao editar). */
const buttonDef = (label: string, cls: string, name: string, attributes: Def["attributes"]): Def => ({
  type: WHEEL_BUTTON_TYPE,
  tagName: "button",
  name,
  classes: [cls],
  attributes: { type: "button", ...attributes },
  droppable: false,
  components: [textDef("span", label, "os-wh-btxt", "Texto do botão")],
});

const escText = (s: string) => s.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Primeiro prêmio (o resultado de exemplo no canvas e no modelo). */
export const examplePrize = (slices: WheelSlice[]) => slices.find((s) => !s.lose) ?? slices[0];

/**
 * A roleta inteira. `html`: para o HTML do modelo de página (a roda já
 * desenhada, o texto e o cupom do prêmio de exemplo); no editor esses três
 * são refeitos a partir das fatias.
 */
export function wheelDef(spec: WheelSpec, { html = false } = {}): Def {
  const example = examplePrize(spec.slices);
  const generated = (content: string) => (html ? { content } : {});
  return {
    type: WHEEL_TYPE,
    tagName: "div",
    name: "Roleta de desconto",
    classes: ["os-wheel"],
    attributes: {
      "data-os-widget": "wheel",
      "data-os-slices": JSON.stringify(spec.slices),
      "data-os-days": String(WHEEL_DAYS),
      "data-os-minutes": String(WHEEL_MINUTES),
      "data-os-banner": "1",
      "data-os-track": "1",
    },
    components: [
      textDef("h2", spec.title, "os-wh-title", "Título"),
      textDef("p", spec.sub, "os-wh-sub", "Subtítulo"),
      {
        type: WHEEL_STAGE_TYPE,
        tagName: "div",
        name: "Roda",
        classes: ["os-wh-stage"],
        attributes: { "data-os-wh-stage": "" },
        components: [
          {
            type: WHEEL_PART_TYPE,
            tagName: "div",
            name: "Ponteiro",
            classes: ["os-wh-ptr"],
            attributes: { "aria-hidden": "true" },
          },
          {
            type: WHEEL_DISC_TYPE,
            tagName: "div",
            name: "Roda",
            classes: ["os-wh-disc"],
            attributes: { "data-os-wh-disc": "" },
            ...generated(wheelSvg(spec.slices)),
          },
          {
            type: WHEEL_PART_TYPE,
            tagName: "div",
            name: "Centro",
            classes: ["os-wh-hub"],
            attributes: { "aria-hidden": "true" },
            content: "🎁",
          },
        ],
      },
      buttonDef(spec.spin, "os-wh-spin", "Botão Girar", { "data-os-wh-spin": "" }),
      textDef("p", "Para girar a roleta, ative o JavaScript do seu navegador.", "os-wh-nojs", "Aviso sem JavaScript"),
      {
        tagName: "div",
        name: "Resultado",
        classes: ["os-wh-result"],
        attributes: { "data-os-wh-result": "", hidden: true },
        components: [
          textDef("p", spec.win, "os-wh-win", "Texto de quem ganhou", { "data-os-wh-win": "" }),
          {
            type: WHEEL_PRIZE_TYPE,
            tagName: "p",
            name: "Prêmio sorteado",
            classes: ["os-wh-prize"],
            attributes: { "data-os-wh-prize": "" },
            ...generated(escText(example?.text ?? "")),
          },
          textDef("p", spec.lose, "os-wh-lose", "Texto de quem não ganhou", { "data-os-wh-lose": "" }),
          {
            tagName: "div",
            name: "Cupom",
            classes: ["os-wh-coupon"],
            attributes: { "data-os-wh-coupon": "", hidden: true },
            components: [
              textDef("span", "Seu cupom:", "os-wh-clabel", "Texto do cupom"),
              {
                type: WHEEL_CODE_TYPE,
                tagName: "code",
                name: "Código do cupom",
                classes: ["os-wh-code"],
                attributes: { "data-os-wh-code": "" },
                ...generated(escText(example?.coupon || "SEUCUPOM")),
              },
              buttonDef("Copiar", "os-wh-copy", "Botão Copiar", { "data-os-wh-copy": "" }),
            ],
          },
          {
            type: "os-button",
            tagName: "a",
            name: "Botão Resgatar",
            classes: ["os-btn", "os-wh-go", "os-pulse"],
            // data-os-link="": o canvas pede para escolher o destino (página de vendas, link da oferta ou endereço).
            attributes: { href: "#", "data-os-link": "", "data-os-wh-go": "", "data-os-lose-label": spec.loseLabel },
            content: spec.go,
          },
          textDef("p", spec.note, "os-wh-note", "Observação", { "data-os-wh-note": "" }),
        ],
      },
    ],
  };
}

// ─── Exemplos ────────────────────────────────────────────────────────────────

/** 4 fatias de exemplo, ainda sem link (o canvas e o ZIP avisam). */
export const EXAMPLE_SLICES: WheelSlice[] = [
  { text: "10% OFF", color: "#7c3aed", chance: 40, link: "", coupon: "" },
  { text: "20% OFF", color: "#f59e0b", chance: 30, link: "", coupon: "" },
  { text: "30% OFF", color: "#ec4899", chance: 20, link: "", coupon: "" },
  { text: "50% OFF", color: "#10b981", chance: 10, link: "", coupon: "" },
];

export const DEFAULT_WHEEL: WheelSpec = {
  title: "Gire a roleta e descubra o seu desconto",
  sub: "Você ganhou 1 giro. Toque no botão e boa sorte! 🍀",
  slices: EXAMPLE_SLICES,
  spin: "GIRAR A ROLETA",
  win: "🎉 Parabéns! Você ganhou",
  lose: "Não foi dessa vez 😕 Mas a oferta continua esperando por você.",
  go: "RESGATAR MEU DESCONTO",
  loseLabel: "CONTINUAR PARA A OFERTA",
  note: "Seu desconto fica reservado para você neste aparelho.",
};
