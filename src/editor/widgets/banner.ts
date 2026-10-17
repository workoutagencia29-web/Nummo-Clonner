/**
 * Carrossel de banners no editor (data-os-widget="banner"): os tipos do
 * GrapesJS e o painel "Configurações". TUDO é feito no painel do carrossel
 * (clicar em qualquer banner seleciona o carrossel; os slides e a imagem não
 * são selecionáveis à parte):
 *
 * - "Quantas imagens você quer?" (1 a BANNER_MAX_SLIDES): muda a quantidade de
 *   banners (adiciona/remove slides);
 * - uma caixinha por banner ("Banner 1", "Banner 2"…) com a miniatura, o botão
 *   "Escolher imagem" (abre o gerenciador de imagens), o destino (Link da
 *   oferta / Página do funil, opcional — banner decorativo não leva a nada) e a
 *   descrição (alt);
 * - "Como os banners trocam": Estático (a pessoa desliza) ou Dinâmico (troca
 *   sozinho a cada N segundos);
 * - "Mostrar as setas" / "Mostrar as bolinhas".
 *
 * As setas e as bolinhas são só da página publicada (o runtime liga a classe
 * os-bn-js e cria as bolinhas); no canvas os slides ficam empilhados (prévia) e
 * nada roda. O destino de cada banner vira `data-os-link` (link da oferta) ou
 * `href="os-page:<id>"` (página do funil), resolvidos pelo render.
 */
import type { Component, Editor } from "grapesjs";
import { linkOptionLabel } from "@/editor/grapes/components";
import {
  BANNER_INTERVAL_DEFAULT,
  BANNER_INTERVAL_MAX,
  BANNER_INTERVAL_MIN,
  BANNER_MAX_SLIDES,
  BANNER_MIN_SLIDES,
} from "@/lib/banner";
import { INTERNAL_LINK_PREFIX } from "@/lib/internal-links";
import {
  BANNER_CSS,
  BANNER_FIXED_TYPE,
  BANNER_IMG_TYPE,
  BANNER_SLIDE_TYPE,
  BANNER_TRACK_TYPE,
  BANNER_TYPE,
  bannerSlideDef,
  NEW_BANNER,
} from "./banner-content";
import { widgetContext } from "./context";
import { attr, cleanText, descendants } from "./dom";
import { checkAttr, heading, type TraitDef } from "./traits";

export const isBanner = (c: Component) => attr(c, "data-os-widget") === "banner";
const isSlide = (c: Component) => c.get("type") === BANNER_SLIDE_TYPE;
const isTrack = (c: Component) => c.getAttributes()["data-os-bn-track"] !== undefined;

/** Carrossel a que o componente pertence (ele mesmo, se for o carrossel). */
export function bannerOf(c: Component | undefined): Component | undefined {
  let at: Component | undefined = c;
  while (at && !isBanner(at)) at = at.parent();
  return at;
}

const slidesOf = (widget: Component) => descendants(widget, isSlide);
const imgOf = (slide: Component) => descendants(slide, (c) => c.get("type") === BANNER_IMG_TYPE)[0];
const imgSrc = (slide: Component) => {
  const img = imgOf(slide);
  return String(img?.get("src") || img?.getAttributes().src || "");
};

/** Elemento HTML simples para o painel. */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ─── Quantidade de banners ────────────────────────────────────────────────────

/** Deixa o carrossel com `n` banners (adiciona provisórios ou remove os últimos). */
function setCount(widget: Component, n: number) {
  const target = Math.min(BANNER_MAX_SLIDES, Math.max(BANNER_MIN_SLIDES, Math.round(n)));
  const track = descendants(widget, isTrack)[0];
  if (!track) return;
  let slides = slidesOf(widget);
  for (let i = slides.length; i < target; i++) track.append(bannerSlideDef(NEW_BANNER) as never);
  if (slides.length > target) {
    slides = slidesOf(widget);
    for (let i = slides.length - 1; i >= target; i--) slides[i].remove();
  }
}

// ─── Destino de um banner (link da oferta / página do funil / nenhum) ─────────

/** Destino atual do banner como valor da lista ("" | "link:<chave>" | "page:<id>"). */
function slideDest(slide: Component): string {
  const attrs = slide.getAttributes();
  const key = String(attrs["data-os-link"] ?? "");
  if (key) return `link:${key}`;
  const href = String(attrs.href ?? "");
  if (href.startsWith(INTERNAL_LINK_PREFIX)) return `page:${href.slice(INTERNAL_LINK_PREFIX.length)}`;
  return "";
}

function setSlideDest(slide: Component, value: string) {
  const has = (name: string) => name in slide.getAttributes();
  if (value.startsWith("link:")) {
    slide.addAttributes({ "data-os-link": value.slice(5) });
    if (has("href")) slide.removeAttributes("href");
  } else if (value.startsWith("page:")) {
    slide.addAttributes({ href: `${INTERNAL_LINK_PREFIX}${value.slice(5)}` });
    if (has("data-os-link")) slide.removeAttributes("data-os-link");
  } else {
    if (has("data-os-link")) slide.removeAttributes("data-os-link");
    if (has("href")) slide.removeAttributes("href");
  }
}

/** Abre o gerenciador de imagens para a imagem do banner e atualiza a miniatura. */
function pickImage(editor: Editor, slide: Component, thumb?: HTMLImageElement) {
  const img = imgOf(slide);
  if (!img) return;
  const am = editor.AssetManager;
  am.open({
    types: ["image"],
    accept: "image/*",
    target: img,
    select: (asset: { getSrc(): string }, complete: boolean) => {
      const src = asset.getSrc();
      img.set("src", src);
      img.addAttributes({ src });
      if (thumb) thumb.src = src;
      if (complete) am.close();
    },
  } as never);
}

// ─── Painel: "Quantas imagens" + caixinhas dos banners ────────────────────────

/** Atualiza miniaturas, destinos e descrições sem refazer a lista (o foco fica). */
function refreshImages(box: HTMLElement, slides: Component[]) {
  const count = box.querySelector<HTMLSelectElement>(".os-bnp-count select");
  if (count) count.value = String(slides.length);
  slides.forEach((slide, i) => {
    const item = box.querySelector<HTMLElement>(`[data-os-bnp="${i}"]`);
    if (!item) return;
    const thumb = item.querySelector<HTMLImageElement>(".os-bnp-thumb");
    if (thumb) thumb.src = imgSrc(slide);
    const dest = item.querySelector<HTMLSelectElement>(".os-bnp-link");
    if (dest && dest.value !== slideDest(slide)) dest.value = slideDest(slide);
    const alt = item.querySelector<HTMLInputElement>(".os-bnp-alt");
    const altVal = attr(imgOf(slide) ?? slide, "alt");
    if (alt && document.activeElement !== alt) alt.value = altVal;
  });
}

function renderImages(editor: Editor, box: HTMLElement, widget: Component) {
  const slides = slidesOf(widget);
  // Só refaz a lista quando a quantidade muda (o foco num campo não cai).
  if (box.dataset.osBnCount === String(slides.length) && box.firstChild) {
    refreshImages(box, slides);
    return;
  }
  box.textContent = "";
  box.dataset.osBnCount = String(slides.length);
  const ctx = widgetContext(editor);

  // "Quantas imagens você quer?"
  const countRow = el("label", "os-bnp-count");
  countRow.append(el("span", "os-bnp-count-label", "Quantas imagens você quer?"));
  const count = el("select", "");
  for (let n = BANNER_MIN_SLIDES; n <= BANNER_MAX_SLIDES; n++) {
    const o = el("option", "", String(n));
    o.value = String(n);
    count.appendChild(o);
  }
  count.value = String(slides.length);
  count.addEventListener("change", () => {
    setCount(widget, Number(count.value));
    renderImages(editor, box, widget);
  });
  countRow.appendChild(count);
  box.appendChild(countRow);

  // Uma caixinha por banner.
  const list = el("div", "os-bnp-list");
  slides.forEach((slide, i) => {
    const item = el("div", "os-bnp-item");
    item.setAttribute("data-os-bnp", String(i));
    item.appendChild(el("div", "os-bnp-head", `Banner ${i + 1}`));

    const row = el("div", "os-bnp-row");
    const thumb = el("img", "os-bnp-thumb");
    thumb.alt = "";
    thumb.src = imgSrc(slide);
    const pick = el("button", "os-bnp-pick", "Escolher imagem");
    pick.type = "button";
    pick.addEventListener("click", () => pickImage(editor, slide, thumb));
    row.append(thumb, pick);
    item.appendChild(row);

    // Destino (opcional).
    const dest = el("select", "os-bnp-link");
    dest.setAttribute("aria-label", `Link do banner ${i + 1}`);
    const option = (value: string, label: string) => {
      const o = el("option", "", label);
      o.value = value;
      dest.appendChild(o);
    };
    option("", "— sem link (só mostra) —");
    for (const l of ctx.links) option(`link:${l.key}`, linkOptionLabel(l));
    for (const p of ctx.pages) option(`page:${p.id}`, p.name);
    const current = slideDest(slide);
    if (current && !Array.from(dest.options).some((o) => o.value === current)) option(current, "(removido)");
    dest.value = current;
    dest.addEventListener("change", () => setSlideDest(slide, dest.value));
    const destRow = el("label", "os-bnp-field");
    destRow.append(el("span", "os-bnp-field-label", "Para onde leva"), dest);
    item.appendChild(destRow);

    // Descrição (alt).
    const alt = el("input", "os-bnp-alt");
    alt.type = "text";
    alt.maxLength = 120;
    alt.placeholder = "Descrição da imagem (opcional)";
    alt.setAttribute("aria-label", `Descrição do banner ${i + 1}`);
    alt.value = attr(imgOf(slide) ?? slide, "alt");
    alt.addEventListener("change", () => imgOf(slide)?.addAttributes({ alt: cleanText(alt.value) }));
    const altRow = el("label", "os-bnp-field");
    altRow.append(el("span", "os-bnp-field-label", "Descrição"), alt);
    item.appendChild(altRow);

    list.appendChild(item);
  });
  box.appendChild(list);
}

// ─── Painel: Estático / Dinâmico ──────────────────────────────────────────────

const autoplayOn = (widget: Component) => !/^(0|false)$/i.test(attr(widget, "data-os-autoplay") || "1");

function renderTiming(box: HTMLElement, widget: Component) {
  const on = autoplayOn(widget);
  // Só refaz quando muda de estático para dinâmico (ou ao abrir).
  if (box.dataset.osBnAuto === String(on) && box.firstChild) return;
  box.textContent = "";
  box.dataset.osBnAuto = String(on);

  const mode = el("select", "os-bnp-mode");
  mode.setAttribute("aria-label", "Como os banners trocam");
  for (const [value, label] of [
    ["0", "Estático (a pessoa desliza para o lado)"],
    ["1", "Dinâmico (troca sozinho)"],
  ] as const) {
    const o = el("option", "", label);
    o.value = value;
    mode.appendChild(o);
  }
  mode.value = on ? "1" : "0";
  mode.addEventListener("change", () => {
    widget.addAttributes({ "data-os-autoplay": mode.value });
    renderTiming(box, widget);
  });
  box.appendChild(mode);

  if (on) {
    const row = el("label", "os-bnp-field");
    row.append(el("span", "os-bnp-field-label", "Trocar a cada (segundos)"));
    const secs = el("input", "os-bnp-secs");
    secs.type = "number";
    secs.min = String(BANNER_INTERVAL_MIN);
    secs.max = String(BANNER_INTERVAL_MAX);
    secs.step = "1";
    secs.setAttribute("aria-label", "Trocar a cada quantos segundos");
    secs.value = String(Number(attr(widget, "data-os-interval")) || BANNER_INTERVAL_DEFAULT);
    secs.addEventListener("change", () => {
      let n = Math.round(Number(secs.value.replace(",", ".")));
      if (!Number.isFinite(n)) n = BANNER_INTERVAL_DEFAULT;
      n = Math.min(BANNER_INTERVAL_MAX, Math.max(BANNER_INTERVAL_MIN, n));
      secs.value = String(n);
      widget.addAttributes({ "data-os-interval": String(n) });
    });
    row.appendChild(secs);
    box.appendChild(row);
  }
}

// ─── Configurações ───────────────────────────────────────────────────────────

const WIDGET_TRAITS: TraitDef[] = [
  { type: "os-banner-images", name: "os-bn-images" } as TraitDef,
  heading("Como os banners trocam", "bn-como"),
  { type: "os-banner-timing", name: "os-bn-timing" } as TraitDef,
  heading("Mostrar", "bn-mostrar"),
  checkAttr("data-os-arrows", "Mostrar as setas", true),
  checkAttr("data-os-dots", "Mostrar as bolinhas", true),
];

// ─── Tipos ───────────────────────────────────────────────────────────────────

/** Clique num link do canvas não navega. */
const preventLink = (e: Event) => e.preventDefault();

/** Partes que não se mexem, não se apagam e não são selecionáveis (o clique vai para o carrossel). */
const INERT = {
  draggable: false,
  droppable: false,
  removable: false,
  copyable: false,
  selectable: false,
  hoverable: false,
};

export function registerBannerTypes(editor: Editor) {
  const tm = editor.Traits;
  // Campo próprio: "Quantas imagens" + as caixinhas dos banners.
  tm.addType("os-banner-images", {
    noLabel: true,
    eventCapture: [],
    templateInput: () => "",
    createInput() {
      const box = el("div", "os-bnp");
      box.addEventListener("keydown", (e) => {
        if (e.key === "Backspace" || e.key === "Delete") e.stopPropagation();
      });
      return box;
    },
    onChange() {},
    setInputValue() {},
    onUpdate({ elInput, component }: { elInput: HTMLElement; component: Component }) {
      const widget = bannerOf(component);
      if (widget) renderImages(editor, elInput, widget);
    },
  } as never);
  // Campo próprio: Estático / Dinâmico (+ segundos).
  tm.addType("os-banner-timing", {
    noLabel: true,
    eventCapture: [],
    templateInput: () => "",
    createInput() {
      const box = el("div", "os-bnp-timing");
      box.addEventListener("keydown", (e) => {
        if (e.key === "Backspace" || e.key === "Delete") e.stopPropagation();
      });
      return box;
    },
    onChange() {},
    setInputValue() {},
    onUpdate({ elInput, component }: { elInput: HTMLElement; component: Component }) {
      const widget = bannerOf(component);
      if (widget) renderTiming(elInput, widget);
    },
  } as never);

  const dc = editor.DomComponents;

  dc.addType(BANNER_TYPE, {
    isComponent: (node) => node.getAttribute?.("data-os-widget") === "banner",
    model: {
      defaults: {
        name: "Carrossel de banners",
        droppable: false,
        draggable: (_w: Component, target: Component) => !bannerOf(target),
        traits: WIDGET_TRAITS,
        styles: BANNER_CSS,
      },
    },
  });

  // Caixas e controles fixos (área da trilha, setas, bolinhas): clicar seleciona o carrossel.
  dc.addType(BANNER_FIXED_TYPE, {
    isComponent: (node) => {
      const cls = node.classList;
      return !!cls && (cls.contains("os-bn-wrap") || cls.contains("os-bn-nav") || cls.contains("os-bn-dots"));
    },
    model: { defaults: { ...INERT, editable: false, layerable: false } },
  });

  dc.addType(BANNER_TRACK_TYPE, {
    isComponent: (node) => node.hasAttribute?.("data-os-bn-track") ?? false,
    model: { defaults: { name: "Banners", ...INERT } },
  });

  dc.addType(BANNER_SLIDE_TYPE, {
    isComponent: (node) => node.tagName === "A" && (node.classList?.contains("os-bn-slide") ?? false),
    model: { defaults: { tagName: "a", name: "Banner", ...INERT } },
    view: {
      onRender({ el: node }: { el: HTMLElement }) {
        node.addEventListener("click", preventLink, true);
      },
    },
  });

  dc.addType(BANNER_IMG_TYPE, {
    extend: "image",
    isComponent: (node) => node.tagName === "IMG" && (node.classList?.contains("os-bn-img") ?? false),
    model: { defaults: { name: "Imagem do banner", ...INERT, resizable: false } },
  });
}
