/**
 * Roleta de desconto no editor (data-os-widget="wheel"): tipos do GrapesJS e as
 * Configurações. Nada gira no canvas: a roda aparece desenhada conforme as
 * fatias (e se redesenha ao mudar) e o resultado aparece embaixo, com um rótulo.
 *
 * - As fatias ficam em data-os-slices (JSON, ver src/lib/wheel.ts) e são
 *   editadas no campo "os-slices" (lista própria: texto, cor, chance, prêmio =
 *   link da oferta com "＋ Criar link da oferta…", cupom; subir, descer,
 *   remover e "＋ Adicionar fatia"). Toda fatia tem chance real (mínimo 1%):
 *   o campo avisa se alguém tentar 0.
 * - O desenho da roda (SVG), o texto do prêmio e o cupom de exemplo do
 *   resultado não são guardados como elementos: o HTML deles é refeito a partir
 *   das fatias ao desenhar e ao salvar (getInnerHTML).
 * - Prêmio sem link: o canvas mostra um aviso na roleta (atributo só do
 *   elemento desenhado, nunca do modelo — como o selo das etapas do quiz).
 * - Clicar na roda (ou no ponteiro/centro) seleciona a roleta.
 */
import type { Component, Editor } from "grapesjs";
import { editorTimeout } from "@/editor/grapes/lifecycle";
import { NEW_LINK_OPTION, newLinkOption, requestNewLink } from "@/editor/grapes/new-link";
import {
  clampChance,
  cleanSlice,
  parseSlices,
  realChances,
  serializeSlices,
  WHEEL_COLORS,
  WHEEL_MAX_SLICES,
  WHEEL_MIN_SLICES,
  type WheelSlice,
  wheelSvg,
} from "@/lib/wheel";
import { widgetContext } from "./context";
import { destination } from "./destination";
import { attr, baseStyle, descendants, setBaseStyle } from "./dom";
import { checkAttr, heading, numberAttr, type TraitDef } from "./traits";
import {
  examplePrize,
  WHEEL_BUTTON_TYPE,
  WHEEL_CODE_TYPE,
  WHEEL_CSS,
  WHEEL_DISC_TYPE,
  WHEEL_PART_TYPE,
  WHEEL_PRIZE_TYPE,
  WHEEL_STAGE_TYPE,
  WHEEL_THEME,
  WHEEL_TYPE,
} from "./wheel-content";

/** Aviso do canvas (só no elemento desenhado, nunca no HTML salvo). */
export const WHEEL_BADGE_ATTR = "data-os-wh-badge";
/** Valor da lista de prêmio para "sem prêmio" ("Não foi dessa vez"). */
const LOSE_OPTION = "__sem-premio__";

export const isWheel = (c: Component) => attr(c, "data-os-widget") === "wheel";
const isGoButton = (c: Component) => c.getAttributes()["data-os-wh-go"] !== undefined;

/** Roleta a que o componente pertence (ela mesma, se for a roleta). */
export function wheelOf(c: Component | undefined): Component | undefined {
  let at: Component | undefined = c;
  while (at && !isWheel(at)) at = at.parent();
  return at;
}

export const wheelSlices = (wheel: Component) => parseSlices(attr(wheel, "data-os-slices"));

const escText = (s: string) => s.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Grava as fatias (2 a 12, arrumadas). */
export function setWheelSlices(wheel: Component, slices: WheelSlice[]) {
  wheel.addAttributes({ "data-os-slices": serializeSlices(slices.slice(0, WHEEL_MAX_SLICES)) });
}

/** HTML gerado de cada parte que vem das fatias. */
const GENERATED: Record<string, (slices: WheelSlice[]) => string> = {
  [WHEEL_DISC_TYPE]: (slices) => wheelSvg(slices),
  [WHEEL_PRIZE_TYPE]: (slices) => escText(examplePrize(slices)?.text ?? ""),
  [WHEEL_CODE_TYPE]: (slices) => escText(slices.find((s) => !s.lose && s.coupon)?.coupon || "SEUCUPOM"),
};

/** Redesenha no canvas a roda, o prêmio e o cupom de exemplo. */
function redraw(wheel: Component) {
  const slices = wheelSlices(wheel);
  for (const type of Object.keys(GENERATED)) {
    for (const part of descendants(wheel, (c) => c.get("type") === type)) {
      const el = part.getEl();
      if (el) el.innerHTML = GENERATED[type](slices);
    }
  }
}

// ─── Aviso do canvas: prêmio sem link ────────────────────────────────────────

/** "Falta escolher o link do prêmio de 2 fatias…" (null = tudo certo). */
export function wheelBadge(editor: Editor, wheel: Component): string | null {
  const links = widgetContext(editor).links;
  const ok = new Set(links.filter((l) => l.url === undefined || l.url.trim()).map((l) => l.key));
  const missing = wheelSlices(wheel).filter((s) => !s.lose && !(s.link && ok.has(s.link)));
  if (!missing.length) return null;
  const which = missing.map((s) => `“${s.text}”`).join(", ");
  return missing.length === 1
    ? `O prêmio ${which} ainda não tem o link de checkout com o desconto: escolha em Configurações → Fatias`
    : `${missing.length} prêmios (${which}) ainda não têm o link de checkout com o desconto: escolha em Configurações → Fatias`;
}

function paintBadge(editor: Editor, wheel: Component, el: HTMLElement | undefined = wheel.getEl()) {
  if (!el) return;
  const text = wheelBadge(editor, wheel);
  if (text) el.setAttribute(WHEEL_BADGE_ATTR, text);
  else el.removeAttribute(WHEEL_BADGE_ATTR);
}

// ─── Campo "Fatias" (os-slices) ──────────────────────────────────────────────

const ZERO_CHANCE =
  "Toda fatia precisa ter chance de sair (mínimo 1%). Uma fatia que aparece na roleta mas nunca sai pode ser considerada propaganda enganosa — a chance voltou para 1%.";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function iconButton(label: string, text: string, disabled = false) {
  const b = el("button", "os-sl-icon", text);
  b.type = "button";
  b.title = label;
  b.setAttribute("aria-label", label);
  b.disabled = disabled;
  return b;
}

/** Texto que parece prêmio ("20% OFF", "R$ 50"…): numa fatia sem prêmio, engana quem cai nela. */
const LOOKS_LIKE_PRIZE = /%|\boff\b|\d|gr[aá]tis|b[oô]nus|desconto|cupom/i;
const LOSE_TEXT_WARN =
  "Quem cair aqui não ganha nada: use um texto como “Não foi dessa vez”, para não parecer que ganhou um desconto.";

type SliceWarn = "" | "link" | "url" | "lose";

/** Aviso embaixo da fatia ("" = nenhum). */
function sliceWarn(s: WheelSlice, links: { key: string; url?: string; payment?: string | null }[]): SliceWarn {
  if (s.lose) return LOOKS_LIKE_PRIZE.test(s.text) ? "lose" : "";
  // Link de pagamento na página também é prêmio (o produto com o preço do desconto).
  const linked = s.link && links.some((l) => l.key === s.link && (l.payment || l.url === undefined || l.url.trim()));
  if (linked) return "";
  return s.link ? "url" : "link";
}

const WARN_TEXT: Record<Exclude<SliceWarn, "">, string> = {
  url: "Este link ainda está sem endereço: preencha em “Links e checkouts” da oferta.",
  link: "Escolha o checkout com este desconto (ou crie um link novo).",
  lose: LOSE_TEXT_WARN,
};

/**
 * Forma da lista: o que muda os campos que aparecem (número de fatias, sem
 * prêmio, avisos, opções da lista de prêmio, aviso de chance). Mudou só um
 * valor (texto, cor, chance, cupom): a lista é atualizada no lugar.
 */
function structureKey(
  slices: WheelSlice[],
  links: { key: string; label: string; url?: string; payment?: string | null }[],
  notice: string,
) {
  return JSON.stringify([
    slices.map((s) => [
      s.lose ? 1 : 0,
      sliceWarn(s, links),
      s.link && !links.some((l) => l.key === s.link) ? s.link : "",
    ]),
    links.map((l) => [l.key, l.label, l.payment ? 1 : 0]),
    notice,
  ]);
}

const sumText = (slices: WheelSlice[]) => {
  const total = slices.reduce((sum, s) => sum + s.chance, 0);
  return total === 100
    ? "As chances somam 100%."
    : `As chances somam ${total}%: cada fatia sai na proporção do número dela (a chance real aparece ao lado).`;
};

/** Valor de um campo, sem mexer no que já está igual (o cursor fica onde está). */
function setValue(input: HTMLInputElement | HTMLSelectElement | null, value: string) {
  if (input && input.value !== value) input.value = value;
}

/** Atualiza os valores da lista já montada (os campos continuam os mesmos: o foco fica onde está). */
function refreshSlices(box: HTMLElement, slices: WheelSlice[]) {
  const real = realChances(slices.map((s) => s.chance));
  slices.forEach((s, i) => {
    const item = box.querySelector<HTMLElement>(`[data-os-slice="${i}"]`);
    if (!item) return;
    const q = <T extends HTMLElement>(sel: string) => item.querySelector<T>(sel);
    setValue(q<HTMLInputElement>(".os-sl-color"), /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : "#7c3aed");
    setValue(q<HTMLInputElement>(".os-sl-text"), s.text);
    setValue(q<HTMLInputElement>(".os-sl-chance"), String(s.chance));
    setValue(q<HTMLSelectElement>(".os-sl-prize"), s.lose ? LOSE_OPTION : s.link);
    setValue(q<HTMLInputElement>(".os-sl-coupon"), s.coupon);
    const realEl = q(".os-sl-real");
    if (realEl) realEl.textContent = `sai em ${fmt(real[i])}% dos giros`;
  });
  const sum = box.querySelector(".os-sl-sum");
  if (sum) sum.textContent = sumText(slices);
}

/**
 * Monta a lista de fatias no contêiner. Só refaz os campos quando a forma da
 * lista muda (fatia nova, removida, de lugar, sem prêmio, aviso): mudar um
 * valor atualiza no lugar. Assim o campo clicado logo depois de uma mudança (ou
 * o "＋ Adicionar fatia") continua lá e o foco nunca cai fora do painel — com o
 * foco na página, Backspace/Delete apagariam a roleta selecionada.
 */
function renderSlices(editor: Editor, box: HTMLElement, wheel: Component, notice = "") {
  const slices = wheelSlices(wheel);
  const links = widgetContext(editor).links;
  const key = structureKey(slices, links, notice);
  if (box.dataset.osSlKey === key && box.firstChild) {
    refreshSlices(box, slices);
    return;
  }
  // Refeita: o foco volta ao mesmo campo (ou ao "＋ Adicionar fatia", se a fatia saiu).
  const active = document.activeElement;
  const focused = active && box.contains(active) ? active.getAttribute("aria-label") || active.className : null;

  // Cada campo lê as fatias na hora (a lista pode ter sido atualizada no lugar).
  const now = () => wheelSlices(wheel);
  const save = (next: WheelSlice[]) => setWheelSlices(wheel, next);
  const update = (i: number, patch: Partial<WheelSlice>) =>
    save(now().map((s, k) => (k === i ? cleanSlice({ ...s, ...patch }, k) : s)));
  box.textContent = "";
  box.dataset.osSlKey = key;

  const list = el("ol", "os-sl-list");
  slices.forEach((s, i) => {
    const n = i + 1;
    const item = el("li", "os-sl-item");
    item.setAttribute("data-os-slice", String(i));

    const top = el("div", "os-sl-row");
    const color = el("input", "os-sl-color");
    color.type = "color";
    color.setAttribute("aria-label", `Cor da fatia ${n}`);
    color.addEventListener("change", () => update(i, { color: color.value }));
    const text = el("input", "os-sl-text");
    text.type = "text";
    text.maxLength = 40;
    text.placeholder = "Ex.: 30% OFF";
    text.setAttribute("aria-label", `Texto da fatia ${n}`);
    text.addEventListener("change", () => update(i, { text: text.value }));
    const up = iconButton(`Subir a fatia ${n}`, "↑", i === 0);
    up.addEventListener("click", () => {
      const next = [...now()];
      if (!next[i - 1]) return;
      [next[i - 1], next[i]] = [next[i], next[i - 1]];
      save(next);
    });
    const down = iconButton(`Descer a fatia ${n}`, "↓", i === slices.length - 1);
    down.addEventListener("click", () => {
      const next = [...now()];
      if (!next[i + 1]) return;
      [next[i + 1], next[i]] = [next[i], next[i + 1]];
      save(next);
    });
    const remove = iconButton(`Remover a fatia ${n}`, "×", slices.length <= WHEEL_MIN_SLICES);
    remove.addEventListener("click", () => {
      const cur = now();
      if (cur.length > WHEEL_MIN_SLICES) save(cur.filter((_, k) => k !== i));
    });
    top.append(color, text, up, down, remove);

    const odds = el("label", "os-sl-row os-sl-odds");
    odds.append(el("span", "os-sl-label", "Chance"));
    const chance = el("input", "os-sl-chance");
    chance.type = "number";
    chance.min = "1";
    chance.max = "100";
    chance.step = "1";
    chance.setAttribute("aria-label", `Chance da fatia ${n} (%)`);
    chance.addEventListener("change", () => {
      const raw = Number(chance.value.replace(",", "."));
      const zero = !chance.value.trim() || !Number.isFinite(raw) || raw < 1;
      const cur = now();
      const next = cur.map((x, k) => (k === i ? cleanSlice({ ...x, chance: clampChance(raw) }, k) : x));
      if (zero) {
        // Sem mudança de verdade (já era 1): só mostra o aviso.
        if (cur[i]?.chance === 1) renderSlices(editor, box, wheel, ZERO_CHANCE);
        else {
          pendingNotice.set(wheel, ZERO_CHANCE);
          save(next);
        }
        return;
      }
      save(next);
    });
    odds.append(chance, el("span", "os-sl-unit", "%"), el("span", "os-sl-real"));

    const prize = el("select", "os-sl-prize");
    prize.setAttribute("aria-label", `Prêmio da fatia ${n}`);
    const option = (value: string, label: string) => {
      const o = el("option", "", label);
      o.value = value;
      prize.appendChild(o);
    };
    option("", "— escolha o link do desconto —");
    for (const l of links) option(l.key, l.payment ? `🎁 ${l.label} · Pagamento na página` : `🎁 ${l.label}`);
    if (s.link && !links.some((l) => l.key === s.link)) option(s.link, `${s.link} (removido)`);
    option(LOSE_OPTION, "Sem prêmio (“Não foi dessa vez”)");
    option(NEW_LINK_OPTION, newLinkOption.label);
    prize.addEventListener("change", () => {
      const v = prize.value;
      const cur = now()[i];
      if (!cur) return;
      if (v === NEW_LINK_OPTION) {
        prize.value = cur.lose ? LOSE_OPTION : cur.link;
        requestNewLink(editor, {
          component: wheel,
          kind: "CHECKOUT",
          name: `Checkout ${cur.lose ? "com desconto" : cur.text}`,
          bind: (linkKey) => {
            const after = now();
            if (after[i])
              setWheelSlices(
                wheel,
                after.map((x, k) => (k === i ? cleanSlice({ ...x, link: linkKey, lose: false }, k) : x)),
              );
          },
        });
        return;
      }
      // Sem prêmio: o texto do desconto sai da fatia (o ponteiro parado em "20% OFF" diria que ganhou).
      if (v === LOSE_OPTION) update(i, { lose: true, link: "", coupon: "", text: "Não foi dessa vez" });
      else update(i, { lose: false, link: v });
    });
    const prizeRow = el("label", "os-sl-row os-sl-prow");
    prizeRow.append(el("span", "os-sl-label", "Prêmio"), prize);

    item.append(top, odds, prizeRow);
    if (!s.lose) {
      const coupon = el("input", "os-sl-coupon");
      coupon.type = "text";
      coupon.maxLength = 40;
      coupon.placeholder = "opcional, ex.: ROLETA30";
      coupon.setAttribute("aria-label", `Cupom da fatia ${n} (opcional)`);
      coupon.addEventListener("change", () => update(i, { coupon: coupon.value }));
      const couponRow = el("label", "os-sl-row os-sl-prow");
      couponRow.append(el("span", "os-sl-label", "Cupom"), coupon);
      item.appendChild(couponRow);
    }
    const warn = sliceWarn(s, links);
    if (warn) item.appendChild(el("p", "os-sl-warn", WARN_TEXT[warn]));
    list.appendChild(item);
  });
  box.appendChild(list);

  box.appendChild(el("p", "os-sl-sum"));
  if (notice) {
    const alert = el("p", "os-sl-alert", notice);
    alert.setAttribute("role", "alert");
    box.appendChild(alert);
  }
  const full = slices.length >= WHEEL_MAX_SLICES;
  const add = el("button", "os-sl-add", full ? `Máximo de ${WHEEL_MAX_SLICES} fatias` : "＋ Adicionar fatia");
  add.type = "button";
  add.disabled = full;
  add.addEventListener("click", () => {
    const cur = now();
    if (cur.length >= WHEEL_MAX_SLICES) return;
    const i = cur.length;
    save([
      ...cur,
      { text: "Novo prêmio", color: WHEEL_COLORS[i % WHEEL_COLORS.length], chance: 10, link: "", coupon: "" },
    ]);
  });
  box.appendChild(add);
  refreshSlices(box, slices);

  if (focused) {
    const again =
      Array.from(box.querySelectorAll<HTMLElement>("[aria-label]")).find(
        (e) => e.getAttribute("aria-label") === focused,
      ) ?? (add.disabled ? box.querySelector<HTMLElement>(".os-sl-text") : add);
    again?.focus();
  }
}

const fmt = (n: number) => String(n).replace(".", ",");

/** Aviso a mostrar depois da próxima redesenhada da lista (chance 0 corrigida). */
const pendingNotice = new WeakMap<Component, string>();

function registerSlicesTrait(editor: Editor) {
  editor.Traits.addType<{ onChange(): void; setInputValue(): void }>("os-slices", {
    noLabel: true,
    // Os campos de dentro falam com a roleta direto (o padrão leria .value do contêiner).
    eventCapture: [],
    templateInput: () => "",
    createInput() {
      const box = el("div", "os-sl");
      // Backspace/Delete num botão da lista (subir, remover, adicionar…) é da lista: não chega
      // ao atalho do editor que apagaria a roleta selecionada.
      box.addEventListener("keydown", (e) => {
        if (e.key === "Backspace" || e.key === "Delete") e.stopPropagation();
      });
      return box;
    },
    onChange() {
      // nada: cada campo grava a sua mudança
    },
    setInputValue() {
      // o onUpdate redesenha a lista
    },
    onUpdate({ elInput, component }: { elInput: HTMLElement; component: Component }) {
      const wheel = wheelOf(component);
      if (!wheel) return;
      const notice = pendingNotice.get(wheel) ?? "";
      pendingNotice.delete(wheel);
      renderSlices(editor, elInput, wheel, notice);
    },
  } as never);
}

// ─── Configurações ───────────────────────────────────────────────────────────

const wheelDestination = destination({
  title: "Ao resgatar o prêmio",
  prefix: "os-wh",
  pageLabel: "Botão “Resgatar” leva para a página do funil (a página de vendas)",
  // Ligado a um checkout, o "Resgatar" leva ao checkout do prêmio sorteado (não ao checkout cheio).
  linkLabel: "…ou para um link da oferta (um checkout leva direto ao checkout do prêmio sorteado)",
  isButton: isGoButton,
  widgetOf: wheelOf,
});

/**
 * Liga o "Resgatar" ao link da oferta criado no diálogo "＋ Criar link da
 * oferta…" (o destino de antes sai). false = não é o "Resgatar" de uma roleta.
 */
export const bindWheelLink = (c: Component, key: string): boolean => wheelDestination.bind(c, key);

function colorTrait(name: string, label: string, prop: string, def: string): TraitDef {
  return {
    type: "os-color",
    name,
    label,
    getValue: ({ editor, component }) => {
      const wheel = wheelOf(component);
      return (wheel && baseStyle(editor, wheel)[prop]) || def;
    },
    setValue: ({ editor, component, value }) => {
      const wheel = wheelOf(component);
      if (wheel) setBaseStyle(editor, wheel, { [prop]: String(value ?? "") });
    },
  };
}

const goOf = (c: Component) => descendants(wheelOf(c) ?? c, isGoButton)[0];

const WHEEL_TRAITS: TraitDef[] = [
  heading("Fatias", "wh-fatias"),
  { type: "os-slices", name: "data-os-slices", label: "Fatias" },
  ...wheelDestination.traits,
  {
    type: "text",
    name: "os-wh-lose-label",
    label: "Texto do botão para quem caiu em “Sem prêmio”",
    placeholder: "CONTINUAR PARA A OFERTA",
    getValue: ({ component }) => {
      const go = goOf(component);
      return go ? attr(go, "data-os-lose-label") : "";
    },
    setValue: ({ component, value }) => {
      goOf(component)?.addAttributes({ "data-os-lose-label": String(value ?? "").trim() });
    },
  },
  heading("Prêmio na página de vendas", "wh-premio"),
  numberAttr("data-os-days", "Prêmio guardado por (dias)", 1, 365),
  checkAttr("data-os-banner", "Mostrar a faixa “Você ganhou…” no topo da página de vendas", true),
  numberAttr("data-os-minutes", "Contador da faixa (minutos; ao zerar, o desconto continua)", 0, 240),
  checkAttr("data-os-track", "Mandar o giro e o resgate para os pixels", true),
  heading("Cores", "wh-cores"),
  colorTrait("os-wh-cta", "Cor dos botões", "--os-wh-cta", WHEEL_THEME.cta),
  colorTrait("os-wh-rim", "Cor da borda da roda", "--os-wh-rim", WHEEL_THEME.rim),
  colorTrait("os-wh-ptr", "Cor do ponteiro", "--os-wh-ptr", WHEEL_THEME.ptr),
];

/** Partes da roda: não se mexem sozinhas e o clique seleciona a roleta. */
const PART_DEFAULTS = {
  draggable: false,
  droppable: false,
  removable: false,
  copyable: false,
  editable: false,
  delegate: { select: (c: Component) => wheelOf(c) ?? c },
};

/** Parte com o HTML refeito das fatias: os filhos salvos são ignorados ao abrir. */
function generatedType(editor: Editor, type: string, test: (node: HTMLElement) => boolean, name: string) {
  editor.DomComponents.addType(type, {
    isComponent: (node) => (test(node) ? { type, components: [] } : false),
    model: {
      // O texto do prêmio e o cupom continuam selecionáveis (para o painel Estilo).
      defaults: { name, ...PART_DEFAULTS, ...(type !== WHEEL_DISC_TYPE && { delegate: null }) },
      getInnerHTML(this: Component) {
        const wheel = wheelOf(this);
        return wheel ? GENERATED[type](wheelSlices(wheel)) : "";
      },
    },
    view: {
      onRender({ el, model }: { el: HTMLElement; model: Component }) {
        const wheel = wheelOf(model);
        el.innerHTML = wheel ? GENERATED[type](wheelSlices(wheel)) : "";
      },
    },
  });
}

export function registerWheelTypes(editor: Editor) {
  registerSlicesTrait(editor);
  const dc = editor.DomComponents;

  dc.addType(WHEEL_TYPE, {
    isComponent: (node) => node.getAttribute?.("data-os-widget") === "wheel",
    model: {
      defaults: {
        name: "Roleta de desconto",
        droppable: false,
        // Uma roleta dentro de outra: um clique giraria as duas.
        draggable: (_wheel: Component, target: Component) => !wheelOf(target),
        traits: WHEEL_TRAITS,
        styles: WHEEL_CSS,
      },
      init(this: Component) {
        this.on("change:attributes:data-os-slices", () => redraw(this));
      },
    },
    view: {
      init(this: { model: Component; el: HTMLElement; listenTo: (o: unknown, e: string, f: () => void) => void }) {
        // O GrapesJS refaz os atributos do elemento a cada mudança: o aviso volta.
        this.listenTo(this.model, "change:attributes", () => paintBadge(editor, this.model, this.el));
      },
      onRender({ el, model }: { el: HTMLElement; model: Component }) {
        paintBadge(editor, model, el);
      },
    },
  });

  dc.addType(WHEEL_STAGE_TYPE, {
    isComponent: (node) => node.hasAttribute?.("data-os-wh-stage") ?? false,
    model: { defaults: { name: "Roda", ...PART_DEFAULTS } },
  });

  dc.addType(WHEEL_PART_TYPE, {
    isComponent: (node) =>
      (node.classList?.contains("os-wh-ptr") || node.classList?.contains("os-wh-hub")) &&
      !!node.parentElement?.hasAttribute("data-os-wh-stage"),
    model: { defaults: { name: "Roda", ...PART_DEFAULTS, layerable: false } },
  });

  generatedType(editor, WHEEL_DISC_TYPE, (n) => n.hasAttribute?.("data-os-wh-disc") ?? false, "Roda");
  generatedType(editor, WHEEL_PRIZE_TYPE, (n) => n.hasAttribute?.("data-os-wh-prize") ?? false, "Prêmio sorteado");
  generatedType(editor, WHEEL_CODE_TYPE, (n) => n.hasAttribute?.("data-os-wh-code") ?? false, "Código do cupom");

  dc.addType(WHEEL_BUTTON_TYPE, {
    isComponent: (node) => {
      if (node.tagName !== "BUTTON") return false;
      if (!(node.hasAttribute?.("data-os-wh-spin") || node.hasAttribute?.("data-os-wh-copy"))) return false;
      // Texto direto no <button>: vai para um <span> (o Espaço entra no texto ao editar).
      const wrapped = Array.from(node.children as HTMLCollection).some((c) => c.classList.contains("os-wh-btxt"));
      return !wrapped && node.innerHTML.trim()
        ? {
            type: WHEEL_BUTTON_TYPE,
            components: [{ type: "text", tagName: "span", classes: ["os-wh-btxt"], content: node.innerHTML.trim() }],
          }
        : { type: WHEEL_BUTTON_TYPE };
    },
    model: {
      defaults: { tagName: "button", droppable: false },
      getName(this: Component) {
        const custom = this.get("custom-name");
        if (custom) return String(custom);
        return this.getAttributes()["data-os-wh-copy"] !== undefined ? "Botão Copiar" : "Botão Girar";
      },
    },
  });

  // Campos "Ao resgatar o prêmio": o valor mora no botão "Resgatar".
  wheelDestination.watch(editor);

  // Links da oferta mudaram (link novo no diálogo): o aviso de prêmio sem link acompanha.
  editor.on("component:selected", (c: Component) => {
    const wheel = wheelOf(c);
    if (wheel) editorTimeout(editor, () => paintBadge(editor, wheel));
  });
}

/** A página tem roleta? (Configurações "Roleta: mostrar" nos outros elementos.) */
export const pageHasWheel = (editor: Editor) => (editor.getWrapper()?.find('[data-os-widget="wheel"]').length ?? 0) > 0;
