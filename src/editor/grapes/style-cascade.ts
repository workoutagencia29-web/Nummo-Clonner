/**
 * Edições do painel de estilo contra o CSS original da página.
 *
 * O CSS original fica numa camada (@layer os-original) e as edições, fora de
 * camada, vencem — menos em dois casos, tratados aqui:
 *
 * 1. !important no CSS original: para declarações !important a ordem das
 *    camadas se inverte, e uma edição comum (ou até !important fora de camada)
 *    perde. Quando a propriedade editada é !important no original para o
 *    elemento, a edição é gravada com !important; o salvamento
 *    (finalizeFromEditor) copia as declarações !important para @layer os-fix,
 *    que vem antes de os-original e por isso vence. No canvas, a mesma cópia
 *    fica numa <style> própria (installImportantMirror).
 *
 * 2. Valor próprio do celular no original: uma edição feita no Desktop (regra
 *    sem @media, fora de camada) passaria por cima do valor que o site original
 *    dava ao celular (ex.: título de 48px no computador e 24px no celular vira
 *    60px no celular também). Como no Elementor, o celular mantém o valor
 *    próprio: nas mesmas media queries do original, a propriedade volta ao
 *    valor original (revert-layer), e um aviso explica como mudar no celular.
 *    Valores próprios do elemento que mudam com a largura sem um @media dele
 *    (variáveis CSS, clamp()/vw, em de um ancestral) são achados comparando o
 *    original nas duas larguras (originalChangesOnPhone) e mantidos em toda a
 *    faixa do celular; um valor só herdado, ou que só acompanha a letra do
 *    elemento, não conta.
 *    A regra fica só na faixa do celular (no Tablet vale a edição do Desktop, ou
 *    a do Tablet quando houver), ordenada entre a regra do Tablet e a do
 *    Celular (uma edição no Celular vence); só um breakpoint "computador
 *    primeiro" do original que vai além da regra do Tablet (tablet do
 *    Elementor, 1024px) fica como no original, antes da regra do Tablet — a
 *    edição do Tablet vence onde vale (phoneKeepMedia). O mesmo vale para uma
 *    edição no Tablet (o celular é mais estreito que ele).
 *    A regra que mantém o valor acompanha o elemento: Duplicar e colar copiam,
 *    trocar o id renomeia, excluir o elemento apaga.
 *    Na versão computador de uma página com versão celular separada (e na
 *    própria versão celular), nada disso: quem visita pelo celular vê a versão
 *    celular (skipPhoneValues).
 */
import type { Component, Editor } from "grapesjs";
import { toast } from "sonner";
import {
  idOfSelector,
  isKeepValue,
  KEEP_VALUE,
  mediaOrder,
  outsideMedia,
  pinComesAfter,
  pinKey,
  pinnedId,
  pinnedSelector,
  pinSelector,
} from "@/lib/css-keep";
import { CANVAS_IDS_EVENT, type RuleLike as CanvasRule, type Patchable, patchOnce, toCanvasCss } from "./components";
import { editorTimeout, watchEditor } from "./lifecycle";
import {
  longhandsOf,
  narrowOnly,
  originalChangesOnPhone,
  originalDeclares,
  originalImportant,
  originalNarrowMedia,
  type PhoneBounds,
  phoneKeepMedia,
  releaseProbe,
  withoutCovered,
} from "./original-css";

type StyleObject = Record<string, unknown>;

interface StyleTarget {
  getStyle(): StyleObject;
  get(key: string): unknown;
  getSelectorsString?: () => string;
}

interface StyleManagerInternals {
  addStyleTargets(style: StyleObject, opts?: StyleObject): void;
  getSelected(): StyleTarget | null | undefined;
}

interface RuleLike {
  get(key: string): unknown;
  set(key: string, value: unknown, opts?: StyleObject): unknown;
  getStyle(): StyleObject;
  addStyle(style: StyleObject, opts?: StyleObject): void;
  toCSS(opts?: StyleObject): string;
  selectorsToString?: (opts?: StyleObject) => string;
  getSelectors(): { length: number };
  clone(): RuleLike;
  views?: { el?: Element }[];
}

interface RuleList {
  models: RuleLike[];
  add(rule: RuleLike | StyleObject, opts?: StyleObject): unknown;
  remove(rules: RuleLike[], opts?: StyleObject): unknown;
}

const IMPORTANT = /!\s*important/i;

function lastValue(value: unknown): string {
  return Array.isArray(value) ? String(value[value.length - 1] ?? "") : String(value ?? "");
}

function withoutImportant(value: string) {
  return value.replace(/\s*!\s*important/gi, "").trim();
}

interface EditContext {
  component: Component;
  el: HTMLElement;
  target: StyleTarget;
}

function editContext(editor: Editor, sm: StyleManagerInternals): EditContext | null {
  const component = editor.getSelected();
  const el = component?.getEl();
  const target = sm.getSelected();
  if (!component || !el || !target || !el.ownerDocument?.defaultView) return null;
  // Só o canvas (o documento do elemento é o do canvas).
  if (el.ownerDocument !== editor.Canvas.getDocument()) return null;
  return { component, el, target };
}

/** Edição que não venceria um !important do original passa a ser !important. */
function importantWhereNeeded(ctx: EditContext, style: StyleObject): StyleObject {
  if (ctx.target.get("state")) return style;
  let out: StyleObject | null = null;
  for (const [key, raw] of Object.entries(style)) {
    if (key === "__p" || typeof raw !== "string") continue;
    const value = raw.trim();
    if (!value || IMPORTANT.test(value)) continue;
    if (!originalImportant(ctx.el, longhandsOf(ctx.el.ownerDocument, key))) continue;
    out ??= { ...style };
    out[key] = `${withoutImportant(value)} !important`;
  }
  return out ?? style;
}

function allRules(editor: Editor): RuleList {
  return editor.Css.getAll() as unknown as RuleList;
}

/** Editores de uma versão computador que tem versão celular separada (skipPhoneValues). */
const withoutPhoneValues = new WeakSet<Editor>();

/**
 * Versão computador de uma página com versão celular separada: quem visita pelo
 * celular recebe a outra versão, então uma edição aqui não mantém valores "do
 * celular" do original (nem avisa para ajustar no modo Celular).
 */
export function skipPhoneValues(editor: Editor) {
  withoutPhoneValues.add(editor);
}

/**
 * A regra editada é a do próprio elemento, sem estado (hover…), no Desktop ou
 * no Tablet? Devolve a media query dela ("" no Desktop), ou null. No Celular a
 * edição é justamente para o celular: nada a manter.
 */
function elementEditMedia(editor: Editor, ctx: EditContext): string | null {
  // Versão celular separada (documento MOBILE): nenhum modo tem @media, as
  // edições valem em qualquer largura — manter o valor "do celular" do
  // original esconderia a edição justamente de quem vê esta versão.
  const devices = editor.Devices.getDevices() as unknown as { getWidthMedia(): string }[];
  if (withoutPhoneValues.has(editor) || !devices.some((d) => d.getWidthMedia())) return null;
  const { target, component } = ctx;
  if (target.get("state")) return null;
  if (idOfSelector(target.getSelectorsString?.() ?? "") !== component.getId()) return null;
  const media = String(target.get("mediaText") ?? "");
  const device = editor.getDevice();
  if (device === "desktop") return media ? null : "";
  if (device !== "tablet" || !media) return null;
  const width = (editor.Devices.get(device) as unknown as { getWidthMedia(): string } | null)?.getWidthMedia() ?? "";
  return width && mediaOrder(media) === Number.parseFloat(width) ? media : null;
}

/**
 * Id do elemento de uma regra que mantém o valor do celular: `:is(#id)` com
 * @media, sem estado e só com revert-layer. Uma regra `:is(#id)` digitada em
 * "CSS da página" (com valores de verdade) é da pessoa: nunca é mexida aqui.
 */
function pinIdOf(rule: RuleLike): string | null {
  if (rule.getSelectors().length || rule.get("state") || !rule.get("mediaText")) return null;
  const id = pinnedId(String(rule.get("selectorsAdd") ?? ""));
  if (id === null) return null;
  const values = Object.entries(rule.getStyle())
    .filter(([k, v]) => k !== "__p" && lastValue(v).trim() !== "")
    .map(([, v]) => lastValue(v));
  return values.length && values.every(isKeepValue) ? id : null;
}

function findPin(editor: Editor, id: string, media: string): RuleLike | undefined {
  return allRules(editor).models.find((r) => r.get("mediaText") === media && pinIdOf(r) === id);
}

/**
 * O elemento já tem valor próprio destas propriedades no Tablet (um modo mais
 * estreito que a edição do Desktop)? Então quem decide a faixa do celular é esse
 * valor (e a regra que ele mesmo mantém, se houver): a edição do Desktop não
 * cria regra que passaria por cima dele.
 * Um valor do Celular não conta: a regra que mantém o original vem sempre antes
 * da regra do Celular no CSS (phoneKeepMedia), então o valor do Celular continua
 * vencendo até a largura dele, e entre ela e o Tablet (481–767px, no celular do
 * Elementor) vale o original — o mesmo resultado em qualquer ordem de edição.
 */
function ownNarrowerValue(
  editor: Editor,
  doc: Document,
  { id, longhands, editMedia, phone }: { id: string; longhands: string[]; editMedia: string; phone: PhoneRange },
) {
  return allRules(editor).models.some((r) => {
    const media = String(r.get("mediaText") ?? "");
    if (!media || r.get("state") || idOfSelector(r.selectorsToString?.() ?? "") !== id) return false;
    if (!pinComesAfter(editMedia, media) || mediaOrder(media) <= phone.phoneOrder) return false;
    return Object.entries(r.getStyle()).some(
      ([k, v]) => k !== "__p" && lastValue(v).trim() !== "" && longhandsOf(doc, k).some((p) => longhands.includes(p)),
    );
  });
}

interface PhoneRange extends PhoneBounds {
  /** Largura do canvas do Celular (375px), para comparar o original. */
  width: number;
}

function phoneRange(editor: Editor): PhoneRange | null {
  const devices = (
    editor.Devices.getDevices() as unknown as { getWidthMedia(): string; get(k: string): unknown }[]
  ).filter((d) => d.getWidthMedia());
  const widths = devices
    .map((d) => Number.parseFloat(String(d.get("width") ?? "")))
    .filter((w) => Number.isFinite(w) && w > 0);
  const orders = devices.map((d) => Number.parseFloat(d.getWidthMedia())).filter(Number.isFinite);
  if (!widths.length || !orders.length) return null;
  const tablet = Math.max(...widths);
  return {
    max: Math.round((tablet - 0.02) * 100) / 100,
    width: Math.min(...widths),
    phoneOrder: Math.min(...orders),
    tabletOrder: Math.max(...orders),
  };
}

/**
 * Media queries em que a propriedade do elemento deve continuar com o valor
 * original:
 * - as do CSS original para telas menores (phoneKeepMedia: na faixa do celular,
 *   ou do tablet do Elementor; as só de tablet saem), sem as que outra já cobre;
 * - sem nenhuma delas, a faixa do celular inteira quando o valor que o próprio
 *   elemento tem no original muda com a largura por outro caminho (variável
 *   CSS, clamp()/vw, em de um ancestral que muda no celular). Um valor só
 *   herdado (o tamanho de letra do body) não conta: como no Elementor, a
 *   edição do Desktop vale no celular quando o elemento não tem valor próprio ali.
 */
function keepMedia(el: HTMLElement, longhands: string[], phone: PhoneRange): string[] {
  const conditions = originalNarrowMedia(el, longhands)
    .map(({ media, below }) => phoneKeepMedia(media, phone, { below }))
    .filter(Boolean);
  if (conditions.length) return withoutCovered(conditions);
  if (!originalDeclares(el, longhands)) return [];
  return originalChangesOnPhone(el, longhands, phone.width) ? [`(max-width: ${phone.max}px)`] : [];
}

/**
 * Depois de uma edição no Desktop (ou no Tablet): onde o original tinha valor
 * próprio para telas menores, esse valor continua valendo. Devolve true se
 * algo foi mantido.
 */
function keepSmallScreenValues(editor: Editor, ctx: EditContext, applied: StyleObject, before: StyleObject): boolean {
  const editMedia = elementEditMedia(editor, ctx);
  if (editMedia === null) return false;
  const phone = phoneRange(editor);
  if (!phone) return false;
  const doc = ctx.el.ownerDocument;
  const win = doc.defaultView as Window;
  const hadBefore = new Set(
    Object.entries(before)
      .filter(([k, v]) => k !== "__p" && lastValue(v).trim() !== "")
      .flatMap(([k]) => longhandsOf(doc, k)),
  );
  const id = ctx.component.getId();
  let kept = false;
  for (const [key, raw] of Object.entries(applied)) {
    if (key === "__p" || !lastValue(raw).trim()) continue;
    const longhands = longhandsOf(doc, key);
    // O elemento já tinha esse valor definido aqui (estilo do próprio elemento,
    // ou edição anterior): o celular já usava esse valor, nada a manter.
    if (longhands.some((p) => hadBefore.has(p))) continue;
    if (ownNarrowerValue(editor, doc, { id, longhands, editMedia, phone })) continue;
    // Edição !important (o original era !important): a regra que mantém o
    // celular também é !important (fora de camada, vence a edição ali), e a
    // cópia os-fix da edição fica fora destas media queries (css-keep.ts).
    const keep = IMPORTANT.test(lastValue(raw)) ? `${KEEP_VALUE} !important` : KEEP_VALUE;
    const medias = new Set(keepMedia(ctx.el, longhands, phone).map((c) => win.matchMedia(c).media || c));
    for (const media of medias) {
      // Só onde a regra fixa vem depois da edição no CSS (senão não vale).
      if (!pinComesAfter(editMedia, media)) continue;
      const existing = findPin(editor, id, media);
      if (existing && lastValue(existing.getStyle()[key])) continue;
      // Fora do desfazer: o valor mantido é o próprio original (não muda nada
      // sozinho); desfazer a edição continua desfazendo só a edição.
      editor.UndoManager.skip(() => {
        if (existing) existing.addStyle({ [key]: keep });
        else {
          allRules(editor).add({
            selectors: [],
            selectorsAdd: pinSelector(id),
            mediaText: media,
            atRuleType: "media",
            style: { [key]: keep },
          });
        }
      });
      kept = true;
    }
  }
  return kept;
}

/** Regras fixas (`:is(#id)` com revert-layer) de um elemento. */
function pinsOf(rules: RuleList, id: string) {
  return rules.models.filter((r) => pinIdOf(r) === id);
}

/**
 * As regras fixas acompanham o elemento, como as regras #id dele no GrapesJS:
 * a cópia (Duplicar, colar) ganha as mesmas; um id novo (Configurações) leva
 * as dele junto; excluir o elemento apaga as dele (no mesmo passo de desfazer).
 * Instalado no plugin do editor (setup.ts), antes de o projeto salvo carregar:
 * o GrapesJS liga a troca de id de cada elemento quando ele é criado.
 */
export function keepPinsWithElement(editor: Editor) {
  const dc = editor.DomComponents as unknown as { Component?: Patchable };
  const rulesOf = (component: Component) =>
    (component as unknown as { em?: { Css?: { getAll(): unknown } } }).em?.Css?.getAll() as RuleList | undefined;

  // Elemento excluído: as regras fixas dele saem junto, como as regras #id (o
  // GrapesJS só avisa "component:remove" numa exclusão de verdade — não ao mover
  // nem ao desfazer; o texto relido depois de editado reaproveita os mesmos
  // elementos). No mesmo passo de desfazer da exclusão.
  editor.on("component:remove", (removed: Component) => {
    const rules = allRules(editor);
    const pins = removed?.getId ? pinsOf(rules, removed.getId()) : [];
    if (pins.length) rules.remove(pins);
  });

  // Páginas gravadas antes destas correções, ao abrir (não é uma edição: a
  // próxima gravação leva junto). Só as regras fixas (só revert-layer): uma
  // regra `:is(#id)` digitada em "CSS da página" fica como está.
  // - regras fixas sem elemento (excluir não as apagava) saem;
  // - as outras passam pela mesma regra de hoje (phoneKeepMedia): as que valiam
  //   também no Tablet (breakpoint do original entre 768 e 992px) ficam só na
  //   faixa do celular, as que o GrapesJS punha depois da regra do Celular
  //   ((max-width: 480px), em/rem) passam para antes dela, e as que só valiam
  //   no tablet saem. As que vêm antes da regra do Tablet, como a
  //   (max-width: 1024px) do Elementor, ficam iguais.
  editor.on("load", () => {
    const rules = allRules(editor);
    const phone = phoneRange(editor);
    editor.UndoManager.skip(() => {
      for (const rule of [...rules.models]) {
        const id = pinIdOf(rule);
        if (id === null) continue;
        if (!editor.Components.getById(id)) {
          rules.remove([rule], { avoidStore: true });
          continue;
        }
        const media = String(rule.get("mediaText") ?? "");
        if (!phone || !narrowOnly(media, Number.POSITIVE_INFINITY)) continue;
        const clipped = phoneKeepMedia(media, phone);
        if (clipped === media) continue;
        if (!clipped) {
          rules.remove([rule], { avoidStore: true });
          continue;
        }
        const same = findPin(editor, id, clipped);
        if (same) {
          const own = same.getStyle();
          const missing = Object.fromEntries(Object.entries(rule.getStyle()).filter(([k]) => !lastValue(own[k])));
          if (Object.keys(missing).length) same.addStyle(missing, { avoidStore: true });
          rules.remove([rule], { avoidStore: true });
        } else {
          rule.set("mediaText", clipped, { avoidStore: true });
        }
      }
    });
  });

  patchOnce(dc.Component, "pins-clone", (proto) => {
    const clone = proto.clone as (this: Component, ...args: unknown[]) => Component;
    proto.clone = function (this: Component, ...args: unknown[]) {
      const cloned = clone.apply(this, args);
      const rules = rulesOf(this);
      const from = this.getId();
      const to = cloned?.getId?.();
      if (!rules || !to || to === from) return cloned;
      const have = new Set(pinsOf(rules, to).map((r) => String(r.get("mediaText") ?? "")));
      for (const pin of pinsOf(rules, from)) {
        const media = String(pin.get("mediaText") ?? "");
        if (have.has(media)) continue;
        const copy = pin.clone();
        copy.set("selectorsAdd", pinSelector(to));
        // Logo depois da regra da origem (não no fim): a cópia nunca fica depois
        // das edições do Celular que o GrapesJS acabou de copiar.
        rules.add(copy, { at: rules.models.indexOf(pin) + 1 });
      }
      return cloned;
    };
  });

  patchOnce(dc.Component, "pins-id", (proto) => {
    const idUpdated = proto._idUpdated as (this: Component, ...args: unknown[]) => void;
    proto._idUpdated = function (this: Component, ...args: unknown[]) {
      const self = this as unknown as { ccid: string };
      const before = self.ccid;
      idUpdated.apply(this, args);
      const after = self.ccid;
      const rules = rulesOf(this);
      if (!rules || !before || !after || before === after) return;
      for (const pin of pinsOf(rules, before)) pin.set("selectorsAdd", pinSelector(after));
    };
  });
}

/** Envolve a gravação do painel de estilo (todas as propriedades passam por ela). */
export function installStyleCascadeGuard(editor: Editor) {
  watchEditor(editor);
  // Moldura escondida do originalChangesOnPhone: sai com o editor.
  editor.on("destroy", () => releaseProbe(typeof document === "undefined" ? null : document));
  const sm = editor.StyleManager as unknown as StyleManagerInternals;
  const addStyleTargets = sm.addStyleTargets.bind(sm);
  const warned = new Set<string>();
  sm.addStyleTargets = (style: StyleObject, opts: StyleObject = {}) => {
    const ctx = editContext(editor, sm);
    if (!ctx) return addStyleTargets(style, opts);
    const before = { ...ctx.target.getStyle() };
    const applied = importantWhereNeeded(ctx, style);
    addStyleTargets(applied, opts);
    // Arrastando um valor (parcial): só no fim.
    if (style.__p || opts.avoidStore) return;
    if (keepSmallScreenValues(editor, ctx, applied, before)) {
      const tablet = editor.getDevice() === "tablet";
      const key = `${tablet ? "tablet" : "desktop"}:${ctx.component.getId()}`;
      if (warned.has(key)) return;
      warned.add(key);
      toast.info(
        `Mudou no ${tablet ? "tablet" : "computador"}. No celular, este elemento continua como na página original.`,
        { description: "Para mudar no celular também, escolha o modo Celular no topo e ajuste lá." },
      );
    }
  };
}

// ─── Cópia das edições !important para o canvas ──────────────────────────────

const MIRROR_ID = "os-fix-canvas";

/**
 * CSS da camada os-fix: regras das edições que têm alguma declaração !important
 * (a mesma cópia que importantFixCss faz no HTML final). As regras que mantêm
 * o valor do celular (revert-layer) não entram, e a edição do Desktop (ou do
 * Tablet) que elas protegem fica fora das media queries delas (ver
 * src/lib/css-keep.ts).
 */
export function importantEditsCss(editor: Editor) {
  const rules = allRules(editor).models;
  const pins = new Map<string, string[]>();
  for (const r of rules) {
    const media = String(r.get("mediaText") ?? "");
    const selector = media && !r.get("state") ? pinnedSelector(String(r.get("selectorsAdd") ?? "")) : null;
    if (!selector) continue;
    for (const [key, raw] of Object.entries(r.getStyle())) {
      const value = lastValue(raw);
      if (key === "__p" || !IMPORTANT.test(value) || !isKeepValue(value)) continue;
      const pin = pinKey(selector, key);
      pins.set(pin, [...(pins.get(pin) ?? []), media]);
    }
  }
  const parts: string[] = [];
  // Mesma ordem do CSS salvo (getCss): sem @media primeiro, depois as media
  // queries da mais larga para a mais estreita (Tablet antes do Celular).
  const order = (r: RuleLike) => mediaOrder(String(r.get("mediaText") ?? ""));
  const ordered = [...rules].sort((a, b) => (order(a) === order(b) ? 0 : order(a) > order(b) ? -1 : 1));
  for (const r of ordered) {
    const important = Object.entries(r.getStyle()).filter(([key, raw]) => {
      const value = lastValue(raw);
      return key !== "__p" && IMPORTANT.test(value) && !isKeepValue(value);
    });
    if (!important.length) continue;
    const media = String(r.get("mediaText") ?? "");
    const atRule = String(r.get("atRuleType") ?? "");
    // Só a regra do elemento no Desktop ou num @media simples tem valores fixados.
    const selector = !r.get("state") && (!atRule || atRule === "media") ? (r.selectorsToString?.() ?? "") : "";
    const pinsFor = (key: string) =>
      selector ? (pins.get(pinKey(selector, key)) ?? []).filter((m) => pinComesAfter(media, m)) : [];
    const pinned = important.filter(([key]) => pinsFor(key).length);
    // Ids repetidos: os mesmos seletores do canvas e da página final (components.ts).
    const canvas = (css: string) => toCanvasCss(editor, r as unknown as CanvasRule, css);
    if (!pinned.length) {
      parts.push(canvas(r.toCSS()));
      continue;
    }
    const inMedia = (css: string) => (media ? `@media ${media}{${css}}` : css);
    const free = important.filter(([key]) => !pinsFor(key).length);
    if (free.length) {
      parts.push(inMedia(canvas(`${selector}{${free.map(([k, v]) => `${k}:${lastValue(v)}`).join(";")}}`)));
    }
    for (const [key, raw] of pinned) {
      parts.push(inMedia(outsideMedia(pinsFor(key), canvas(`${selector}{${key}:${lastValue(raw)}}`))));
    }
  }
  const css = parts.filter(Boolean).join("\n");
  // A ordem das camadas vem primeiro no documento: os-fix antes de os-original.
  return `@layer os-fix, os-original;\n${css ? `@layer os-fix {\n${css}\n}\n` : ""}`;
}

/**
 * Mantém no canvas a mesma camada os-fix do HTML final, para uma edição
 * !important aparecer na hora (o GrapesJS desenha as edições fora de camada).
 * Fica como primeiro elemento do <head> do canvas, antes da folha base.
 */
export function installImportantMirror(editor: Editor) {
  watchEditor(editor);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let observer: MutationObserver | null = null;
  let css = "";

  const ensure = () => {
    const doc = editor.Canvas.getDocument();
    const head = doc?.head;
    if (!head) return;
    let style = doc.getElementById(MIRROR_ID) as HTMLStyleElement | null;
    if (!style) {
      style = doc.createElement("style");
      style.id = MIRROR_ID;
    }
    if (style.textContent !== css) style.textContent = css;
    if (head.firstChild !== style) head.insertBefore(style, head.firstChild);
  };

  const update = () => {
    timer = undefined;
    css = importantEditsCss(editor);
    ensure();
  };
  const schedule = () => {
    if (timer) return;
    timer = editorTimeout(editor, update);
  };

  const watch = () => {
    observer?.disconnect();
    const head = editor.Canvas.getDocument()?.head;
    if (!head) return;
    // O GrapesJS refaz o <head> do canvas ao importar a página: volta a pôr a cópia.
    observer = new MutationObserver(() => {
      const doc = editor.Canvas.getDocument();
      const style = doc?.getElementById(MIRROR_ID);
      if (!style || style.parentNode !== doc?.head || doc.head.firstChild !== style) ensure();
    });
    observer.observe(head, { childList: true });
    update();
  };

  editor.on("load canvas:frame:load:body", watch);
  editor.on(`styleable:change undo redo ${CANVAS_IDS_EVENT}`, schedule);
  const rules = editor.Css.getAll() as unknown as {
    on(ev: string, cb: () => void): void;
    off(ev: string, cb: () => void): void;
  };
  rules.on("add remove reset", schedule);
  editor.on("destroy", () => {
    observer?.disconnect();
    if (timer) clearTimeout(timer);
    rules.off("add remove reset", schedule);
  });
}

// ─── Ordem das media queries no canvas ───────────────────────────────────────

/** Media query "computador primeiro" (max-width, width < X): ordenada pela largura. */
function desktopFirst(media: string) {
  return !/min-(?:device-)?width/i.test(media) || /max-(?:device-)?width/i.test(media);
}

/**
 * No canvas, o GrapesJS desenha cada regra com @media na caixa do dispositivo
 * de mesma largura (Tablet 992px, Celular 480px) e todas as outras — como as
 * regras que mantêm o valor do celular (max-width: 767px) — na caixa das regras
 * sem @media, ANTES das do Tablet. Na página final (getCss) a ordem é pela
 * largura: uma edição do Tablet venceria no canvas o que no site perde. Aqui
 * essas regras vão para uma caixa própria, na posição da largura delas.
 */
export function installCanvasMediaOrder(editor: Editor) {
  watchEditor(editor);
  const prefix = String((editor.Css.getConfig() as { stylePrefix?: string }).stylePrefix ?? "");
  const cls = `${prefix}rules`;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const place = () => {
    timer = undefined;
    const doc = editor.Canvas.getDocument();
    const root = doc?.body?.querySelector(`:scope > .${CSS.escape(cls)}`);
    if (!doc || !root) return;
    const boxWidth = (box: Element): number | null => {
      if (box.id === cls) return Number.POSITIVE_INFINITY;
      if (!box.id.startsWith(`${cls}-`)) return null;
      const n = Number(box.id.slice(cls.length + 1));
      return Number.isFinite(n) ? n : null;
    };
    const boxFor = (width: number) => {
      let before: Element | null = null;
      for (const box of Array.from(root.children)) {
        const w = boxWidth(box);
        if (w === width) return box;
        if (w !== null && w < width && !before) before = box;
      }
      const box = doc.createElement("div");
      box.id = `${cls}-${width}`;
      root.insertBefore(box, before);
      return box;
    };
    for (const rule of allRules(editor).models) {
      const media = String(rule.get("mediaText") ?? "");
      const atRule = String(rule.get("atRuleType") ?? "");
      if (!media || (atRule && atRule !== "media") || !desktopFirst(media)) continue;
      const width = mediaOrder(media);
      if (!Number.isFinite(width) || width === Number.MAX_VALUE) continue;
      for (const view of rule.views ?? []) {
        const el = view.el;
        if (!el || el.ownerDocument !== doc || !root.contains(el)) continue;
        const box = el.parentElement;
        if (box && box.parentElement === root && boxWidth(box) === width) continue;
        boxFor(width).appendChild(el);
      }
    }
  };
  const schedule = () => {
    if (!timer) timer = editorTimeout(editor, place);
  };

  editor.on("load canvas:frame:load:body", schedule);
  const rules = editor.Css.getAll() as unknown as {
    on(ev: string, cb: () => void): void;
    off(ev: string, cb: () => void): void;
  };
  rules.on("add reset change:mediaText", schedule);
  editor.on("destroy", () => {
    if (timer) clearTimeout(timer);
    rules.off("add reset change:mediaText", schedule);
  });
}
