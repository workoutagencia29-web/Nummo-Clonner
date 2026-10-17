/**
 * Carrossel de banners (data-os-widget="banner"): o CSS da página e as
 * definições do widget e dos slides, usados pelo bloco "Carrossel de banners"
 * da categoria "Loja" e pelo "＋ Adicionar banner" das Configurações. Sem
 * GrapesJS aqui.
 *
 * Cada slide é um `<a class="os-bn-slide">` com uma `<img class="os-bn-img">`.
 * No editor os slides aparecem empilhados (dá para editar e trocar a imagem de
 * cada um); na página publicada a trilha vira carrossel horizontal e o script
 * (src/runtime/widgets/banner.ts) liga a classe os-bn-js, cria as bolinhas e
 * passa os banners sozinho. As setas e as bolinhas só aparecem com o JS; no
 * canvas do editor (os elementos têm data-gjs-type) a trilha fica empilhada e
 * os controles ficam escondidos — nada roda ali.
 *
 * Como no resto da loja, o CSS usa só propriedades simples e é pensado para o
 * Safari 13 (sem gap de flex no carrossel, sem aspect-ratio). O destino de cada
 * banner é o de qualquer `<a>` (registerDynamicTraits): "Link da oferta",
 * "Página do funil" ou endereço — tudo opcional (banner decorativo não leva a
 * lugar nenhum); por isso "os-bn-slide" está em STORE_NAV_CLASSES.
 */
import { type Def, placeholderImage } from "@/editor/blocks/shared";
import { bannerTexts } from "@/lib/banner";
import type { StoreLang } from "@/lib/store";

export const BANNER_TYPE = "os-banner";
/** Trilha dos slides (só slides entram). */
export const BANNER_TRACK_TYPE = "os-banner-track";
/** Um banner (a.os-bn-slide com a imagem). */
export const BANNER_SLIDE_TYPE = "os-banner-slide";
/** Imagem do banner (troca com dois cliques ou pelo "Trocar imagem"). */
export const BANNER_IMG_TYPE = "os-banner-img";
/** Caixas e controles fixos (área da trilha, setas, bolinhas): não se mexem nem se apagam. */
export const BANNER_FIXED_TYPE = "os-banner-fixed";

const B = ".os-bn";

/**
 * CSS da página (vira regra editável do projeto, como o da vitrine e o da
 * roleta). Só propriedades simples; pensado para o Safari 13. A trilha só vira
 * carrossel na página publicada (`:not([data-gjs-type])` — no canvas do editor
 * os slides ficam empilhados para editar); as setas e as bolinhas só aparecem
 * quando o script liga a classe os-bn-js.
 */
export const BANNER_CSS = [
  `${B}{position:relative;box-sizing:border-box;width:100%;max-width:1200px;margin:16px auto;padding:0;font-family:inherit}`,
  `${B} *,${B} *::before,${B} *::after{box-sizing:border-box}`,
  `${B}-wrap{position:relative}`,
  `${B}-track{margin:0;padding:0;border-radius:8px}`,
  `${B}-slide{display:block;width:100%;margin:0 0 10px;overflow:hidden;border-radius:8px;text-decoration:none;line-height:0}`,
  `${B}-slide:last-child{margin-bottom:0}`,
  `${B}-img{display:block;width:100%;height:auto;margin:0;border:0}`,
  // Página publicada (sem data-gjs-type): a trilha vira carrossel horizontal.
  `${B}-track:not([data-gjs-type]){display:flex;gap:0;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none}`,
  `${B}-track:not([data-gjs-type])::-webkit-scrollbar{display:none}`,
  `${B}-track:not([data-gjs-type]) ${B}-slide{flex:0 0 100%;margin:0;border-radius:0;scroll-snap-align:start}`,
  // Setas (só na página, quando o script liga os-bn-js; no meio da trilha).
  `${B}-nav{display:none;position:absolute;top:50%;z-index:2;align-items:center;justify-content:center;width:44px;height:44px;margin-top:-22px;padding:0;border:0;border-radius:50%;background-color:#ffffff;color:#1f2937;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.22)}`,
  `${B}-prev{left:12px}`,
  `${B}-next{right:12px}`,
  `${B}-nav::before{content:"";display:block;width:10px;height:10px;border-top:2px solid currentColor;border-right:2px solid currentColor}`,
  `${B}-prev::before{margin-left:4px;transform:rotate(-135deg)}`,
  `${B}-next::before{margin-right:4px;transform:rotate(45deg)}`,
  // Bolinhas (o script preenche; só na página).
  `${B}-dots{display:none;justify-content:center;gap:8px;margin:12px 0 0;padding:0}`,
  `${B}-dot{width:10px;height:10px;padding:0;border:0;border-radius:50%;background-color:#cbd5e1;cursor:pointer;transition:background-color .15s ease}`,
  `${B}-dot[aria-current="true"]{background-color:#1f2937}`,
  `${B}.os-bn-js ${B}-nav{display:flex}`,
  `${B}.os-bn-js ${B}-dots{display:flex}`,
  `${B}[data-os-arrows="0"] ${B}-nav{display:none}`,
  `${B}[data-os-dots="0"] ${B}-dots{display:none}`,
  `${B}-nav:focus-visible,${B}-slide:focus-visible,${B}-dot:focus-visible{outline:3px solid #111827;outline-offset:2px}`,
  // Celular: margem lateral menor e setas menores.
  `@media (max-width:768px){${B}{margin:12px auto}${B}-nav{width:36px;height:36px;margin-top:-18px}${B}-prev{left:8px}${B}-next{right:8px}}`,
].join("");

// ─── Definições ──────────────────────────────────────────────────────────────

export interface BannerSlideSpec {
  /** Endereço da imagem (padrão: imagem provisória). */
  image?: string;
  /** Descrição da imagem (alt). */
  alt?: string;
  /** Destino (sem href = banner decorativo). */
  href?: string;
}

export interface BannerSpec {
  /** Nome nas camadas (padrão "Carrossel de banners"). */
  name?: string;
  slides: BannerSlideSpec[];
  /** Passar sozinho (padrão true). */
  autoplay?: boolean;
  /** Trocar a cada N segundos. */
  interval?: number;
  /** Mostrar as setas (padrão true). */
  arrows?: boolean;
  /** Mostrar as bolinhas (padrão true). */
  dots?: boolean;
  /** Idioma dos textos dos leitores de tela (padrão pt). */
  lang?: StoreLang;
}

/** Imagem provisória de um banner (larga). */
export const bannerPlaceholder = (label: string) => placeholderImage(label, 1200, 420);

/** Um banner (a.os-bn-slide com a imagem dentro). */
export function bannerSlideDef(spec: BannerSlideSpec = {}): Def {
  return {
    type: BANNER_SLIDE_TYPE,
    tagName: "a",
    name: "Banner",
    classes: ["os-bn-slide"],
    // Sem href = banner decorativo (clicar não leva a lugar nenhum). O destino
    // é escolhido nas Configurações (Link da oferta / Página do funil / endereço).
    ...(spec.href ? { attributes: { href: spec.href } } : {}),
    components: [
      {
        type: BANNER_IMG_TYPE,
        tagName: "img",
        name: "Imagem do banner",
        classes: ["os-bn-img"],
        attributes: { src: spec.image ?? bannerPlaceholder("Banner"), alt: spec.alt ?? "", loading: "lazy" },
      },
    ],
  };
}

/** O carrossel inteiro. */
export function bannerDef(spec: BannerSpec): Def {
  const t = bannerTexts(spec.lang ?? "pt");
  const nav = (dir: "prev" | "next"): Def => ({
    type: BANNER_FIXED_TYPE,
    tagName: "button",
    name: dir === "prev" ? "Seta anterior" : "Seta seguinte",
    classes: ["os-bn-nav", `os-bn-${dir}`],
    attributes: { type: "button", "aria-label": dir === "prev" ? t.prev : t.next },
  });
  return {
    type: BANNER_TYPE,
    tagName: "section",
    name: spec.name ?? "Carrossel de banners",
    classes: ["os-bn"],
    attributes: {
      "data-os-widget": "banner",
      "data-os-autoplay": spec.autoplay === false ? "0" : "1",
      "data-os-interval": String(spec.interval ?? 5),
      "data-os-arrows": spec.arrows === false ? "0" : "1",
      "data-os-dots": spec.dots === false ? "0" : "1",
    },
    components: [
      {
        type: BANNER_FIXED_TYPE,
        tagName: "div",
        name: "Banners",
        classes: ["os-bn-wrap"],
        components: [
          {
            type: BANNER_TRACK_TYPE,
            tagName: "div",
            name: "Banners",
            classes: ["os-bn-track"],
            attributes: { "data-os-bn-track": "" },
            components: spec.slides.map((s) => bannerSlideDef(s)),
          },
          nav("prev"),
          nav("next"),
        ],
      },
      {
        type: BANNER_FIXED_TYPE,
        tagName: "div",
        name: "Bolinhas",
        classes: ["os-bn-dots"],
        // O runtime cria as bolinhas e usa este texto no aria-label de cada uma.
        attributes: { "data-os-bn-dots": "", "data-os-bn-goto": t.goto },
      },
    ],
  };
}

// ─── Exemplos ────────────────────────────────────────────────────────────────

/** Carrossel novo do bloco: dois banners provisórios. */
export const DEFAULT_BANNER: BannerSpec = {
  slides: [{ image: bannerPlaceholder("Banner 1") }, { image: bannerPlaceholder("Banner 2") }],
};

/** Banner novo do "＋ Adicionar banner". */
export const NEW_BANNER: BannerSlideSpec = { image: bannerPlaceholder("Novo banner") };
