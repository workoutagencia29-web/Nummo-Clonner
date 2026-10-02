/**
 * Compatibilidade das páginas clonadas no modo Editável (que roda sem os
 * scripts da página original). Faz de novo, com pouco código, o que os
 * scripts faziam em widgets comuns de página de oferta:
 *
 * - FAQ/acordeão/abas/toggle do Elementor (legado e "nested tabs"),
 *   collapse e abas do Bootstrap, abas ARIA (role="tab"), botões
 *   aria-expanded/aria-controls e o botão de menu do Elementor;
 * - ganchos gravados pelo clonador (src/worker/clone/editable-compat.ts):
 *   data-os-toggle (FAQ feito à mão), data-os-embed (capa "clique para
 *   carregar" do YouTube/Vimeo) e data-os-noop (link que só rodava JS).
 *
 * Sem dependências, idempotente e seguro: nunca executa código vindo da
 * página e só cria iframes https de players conhecidos.
 * Chamado por src/runtime/os-runtime.ts (prévia e exportação), exceto nas
 * cópias "Preservar JS" (<meta name="os-preserve-js">), em que os scripts
 * originais continuam rodando. Nas cópias antigas sem o marcador, um clique que
 * um script original já tratou é deixado em paz (ver onClickCapture).
 */

interface CompatWindow extends Window {
  __osCloneCompat?: boolean;
}

const STATE_CLASSES = [
  "active",
  "show",
  "in",
  "open",
  "is-open",
  "is-active",
  "is-selected",
  "selected",
  "current",
  "e-active",
  "elementor-active",
  "w--tab-active",
  "w--current",
  "uk-active",
  "tab-active",
  "active-tab",
];

const EMBED_HOST_RE =
  /^https:\/\/(?:www\.youtube\.com|www\.youtube-nocookie\.com|youtube\.com|player\.vimeo\.com)\/(?:embed\/|video\/)/;

function closestEl(target: EventTarget | null, selector: string): HTMLElement | null {
  const el = target instanceof Element ? target : null;
  try {
    return (el?.closest(selector) as HTMLElement | null) ?? null;
  } catch {
    return null;
  }
}

function safeQueryAll(root: ParentNode, selector: string): HTMLElement[] {
  try {
    return Array.from(root.querySelectorAll<HTMLElement>(selector));
  } catch {
    return [];
  }
}

function isShown(el: HTMLElement): boolean {
  return getComputedStyle(el).display !== "none";
}

function setDisplay(el: HTMLElement, show: boolean) {
  if (!show) {
    el.style.display = "none";
    return;
  }
  el.style.display = "";
  if (!isShown(el)) el.style.display = "block";
}

// ── Elementor (acordeão, toggle e abas "legados") ───────────────────────────

function elementorTabs(title: HTMLElement): boolean {
  const widget = title.closest<HTMLElement>(".elementor-accordion, .elementor-toggle, .elementor-tabs");
  if (!widget) return false;
  const tab = title.getAttribute("data-tab");
  const own = (el: Element) => el.closest(".elementor-accordion, .elementor-toggle, .elementor-tabs") === widget;
  const titles = safeQueryAll(widget, ".elementor-tab-title").filter(own);
  const contents = safeQueryAll(widget, ".elementor-tab-content").filter(own);
  const set = (t: string | null, open: boolean) => {
    for (const el of titles) {
      if (el.getAttribute("data-tab") !== t) continue;
      el.classList.toggle("elementor-active", open);
      if (el.hasAttribute("aria-expanded")) el.setAttribute("aria-expanded", String(open));
      if (el.hasAttribute("aria-selected")) el.setAttribute("aria-selected", String(open));
    }
    for (const el of contents) {
      if (el.getAttribute("data-tab") !== t) continue;
      el.classList.toggle("elementor-active", open);
      setDisplay(el, open);
    }
  };
  const isOpen = title.classList.contains("elementor-active");
  if (widget.classList.contains("elementor-toggle")) {
    set(tab, !isOpen);
  } else if (widget.classList.contains("elementor-tabs")) {
    for (const t of new Set(titles.map((el) => el.getAttribute("data-tab")))) set(t, t === tab);
  } else {
    for (const t of new Set(titles.map((el) => el.getAttribute("data-tab")))) if (t !== tab) set(t, false);
    set(tab, !isOpen);
  }
  return true;
}

// ── Abas (Bootstrap, ARIA, Elementor "nested tabs") ─────────────────────────

/** Painel controlado por uma aba (aria-controls, data-bs-target, href="#id"). */
function panelOf(tab: HTMLElement): HTMLElement | null {
  const id = tab.getAttribute("aria-controls");
  if (id) return document.getElementById(id);
  const ref = tab.getAttribute("data-bs-target") ?? tab.getAttribute("data-target") ?? tab.getAttribute("href") ?? "";
  if (!ref.startsWith("#") || ref.length < 2) return null;
  return safeQueryAll(document, ref)[0] ?? null;
}

/** Passa as classes de estado (active, show, e-active…) de `from` para `to`. */
function moveState(from: HTMLElement | null, to: HTMLElement | null) {
  if (!from || !to || from === to) return;
  for (const cls of STATE_CLASSES) {
    if (from.classList.contains(cls)) {
      from.classList.remove(cls);
      to.classList.add(cls);
    }
  }
}

function activateTab(tab: HTMLElement, list: HTMLElement, tabSelector: string): boolean {
  const tabs = safeQueryAll(list, tabSelector);
  const panel = panelOf(tab);
  if (!panel) return false;
  const isCurrent = (t: HTMLElement) =>
    t.getAttribute("aria-selected") === "true" ||
    STATE_CLASSES.some((c) => t.classList.contains(c)) ||
    (t.parentElement?.tagName === "LI" && t.parentElement.classList.contains("active"));
  const current = tabs.find((t) => t !== tab && isCurrent(t));
  const currentPanel = current ? panelOf(current) : null;
  for (const t of tabs) {
    t.setAttribute("aria-selected", String(t === tab));
    if (t !== tab) t.setAttribute("tabindex", "-1");
  }
  tab.removeAttribute("tabindex");
  moveState(current ?? null, tab);
  if (!STATE_CLASSES.some((c) => tab.classList.contains(c))) tab.classList.add("active");
  // Bootstrap 3: .active fica no <li>.
  if (current?.parentElement?.tagName === "LI" && tab.parentElement?.tagName === "LI") {
    current.parentElement.classList.remove("active");
    tab.parentElement.classList.add("active");
  }
  if (currentPanel && currentPanel !== panel) {
    moveState(currentPanel, panel);
    if (currentPanel.hasAttribute("hidden") || panel.hasAttribute("hidden")) {
      currentPanel.setAttribute("hidden", "");
      panel.removeAttribute("hidden");
    }
    if (currentPanel.style.display && currentPanel.style.display !== "none") {
      panel.style.display = currentPanel.style.display;
      currentPanel.style.display = "none";
    }
  } else {
    panel.removeAttribute("hidden");
    panel.classList.add("active", "show");
  }
  if (!isShown(panel)) panel.style.display = "block";
  return true;
}

// ── Collapse (Bootstrap) e botões aria-expanded ─────────────────────────────

function bootstrapCollapse(trigger: HTMLElement): boolean {
  const ref =
    trigger.getAttribute("data-bs-target") ?? trigger.getAttribute("data-target") ?? trigger.getAttribute("href") ?? "";
  const targets = ref && ref !== "#" ? safeQueryAll(document, ref) : [];
  if (!targets.length) return false;
  const legacy = trigger.hasAttribute("data-toggle");
  for (const target of targets) {
    const open = !(target.classList.contains("show") || target.classList.contains("in"));
    const parentSel = target.getAttribute("data-bs-parent") ?? target.getAttribute("data-parent");
    if (open && parentSel) {
      const parent = safeQueryAll(document, parentSel)[0];
      for (const other of parent ? safeQueryAll(parent, ".collapse.show, .collapse.in") : []) {
        if (other === target) continue;
        other.classList.remove("show", "in");
        for (const t of safeQueryAll(
          document,
          `[data-bs-target="#${other.id}"], [data-target="#${other.id}"], [href="#${other.id}"]`,
        )) {
          t.classList.add("collapsed");
          t.setAttribute("aria-expanded", "false");
        }
      }
    }
    target.classList.toggle("show", open);
    if (legacy) target.classList.toggle("in", open);
    if (open && !isShown(target)) target.style.display = "block";
    if (!open) target.style.display = "";
    trigger.classList.toggle("collapsed", !open);
    trigger.setAttribute("aria-expanded", String(open));
  }
  return true;
}

function ariaDisclosure(trigger: HTMLElement): boolean {
  const ids = (trigger.getAttribute("aria-controls") ?? "").split(/\s+/).filter(Boolean);
  const panels = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => !!el);
  if (!panels.length) return false;
  const open = trigger.getAttribute("aria-expanded") !== "true";
  trigger.setAttribute("aria-expanded", String(open));
  for (const panel of panels) {
    if (open) {
      panel.removeAttribute("hidden");
      if (!isShown(panel)) panel.style.display = "block";
    } else {
      panel.setAttribute("hidden", "");
      panel.style.display = "";
    }
  }
  return true;
}

// ── Ganchos do clonador ─────────────────────────────────────────────────────

/** Segue o caminho "parent|next|closest:.x|find:.y|id:z|query:.w|all:.v" a partir do clicado. */
function resolvePath(start: HTMLElement, path: string): HTMLElement[] {
  let current: HTMLElement[] = [start];
  if (!path || path === "self") return current;
  for (const step of path.split("|")) {
    const i = step.indexOf(":");
    const name = i < 0 ? step : step.slice(0, i);
    let arg = "";
    try {
      arg = i < 0 ? "" : decodeURIComponent(step.slice(i + 1));
    } catch {
      return [];
    }
    const next: HTMLElement[] = [];
    for (const el of current) {
      let found: Element | null | Element[] = null;
      try {
        if (name === "parent") found = el.parentElement;
        else if (name === "next") found = el.nextElementSibling;
        else if (name === "prev") found = el.previousElementSibling;
        else if (name === "closest") found = el.closest(arg);
        else if (name === "find") found = el.querySelector(arg);
        else if (name === "id") found = document.getElementById(arg);
        else if (name === "query") found = document.querySelector(arg);
        else if (name === "all") found = Array.from(document.querySelectorAll(arg));
      } catch {
        found = null;
      }
      if (Array.isArray(found)) next.push(...(found as HTMLElement[]));
      else if (found) next.push(found as HTMLElement);
    }
    current = next;
    if (!current.length) break;
  }
  return current;
}

function runToggle(trigger: HTMLElement, spec: string) {
  for (const action of spec.split(/\s+/)) {
    const at = action.lastIndexOf("@");
    if (at <= 0) continue;
    const what = action.slice(0, at);
    for (const target of resolvePath(trigger, action.slice(at + 1))) {
      if (what === "!display") setDisplay(target, !isShown(target));
      else if (what === "!maxheight") target.style.maxHeight = target.style.maxHeight ? "" : `${target.scrollHeight}px`;
      else for (const cls of what.split(".")) if (/^[\w-]+$/.test(cls)) target.classList.toggle(cls);
    }
  }
  if (trigger.hasAttribute("aria-expanded")) {
    trigger.setAttribute("aria-expanded", String(trigger.getAttribute("aria-expanded") !== "true"));
  }
}

function loadEmbed(facade: HTMLElement): boolean {
  const src = facade.getAttribute("data-os-embed") ?? "";
  const overlay = facade.getAttribute("data-os-embed-mode") === "overlay";
  if (src === "reveal" || src === "video") {
    const host = facade.parentElement;
    facade.remove();
    const video = host?.querySelector("video");
    if (video) void video.play().catch(() => {});
    return true;
  }
  if (!EMBED_HOST_RE.test(src)) return false;
  const iframe = document.createElement("iframe");
  iframe.src = src;
  iframe.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture; fullscreen");
  iframe.setAttribute("allowfullscreen", "");
  iframe.setAttribute("frameborder", "0");
  if (overlay) {
    const host = facade.parentElement;
    const slotSel = facade.getAttribute("data-os-embed-slot");
    facade.remove();
    if (!host) return true;
    const slot = slotSel ? safeQueryAll(host, slotSel)[0] : null;
    iframe.className = slot?.className ?? "";
    iframe.style.cssText = "width:100%;height:100%;border:0";
    if (slot) slot.replaceWith(iframe);
    else host.appendChild(iframe);
    return true;
  }
  const box = facade.getBoundingClientRect();
  iframe.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;border:0";
  if (getComputedStyle(facade).position === "static") facade.style.position = "relative";
  facade.style.backgroundImage = "none";
  facade.textContent = "";
  facade.removeAttribute("data-os-embed");
  facade.appendChild(iframe);
  // A altura vinha da capa (<img> + botão de play) que acabou de sair: sem isso a
  // caixa fica com 0 px e o vídeo toca sem imagem. Mantém o tamanho que a capa tinha.
  if (facade.getBoundingClientRect().height < 20) {
    facade.style.display = "block";
    // A largura que a caixa já tem (CSS da página) fica; sem largura, ocupa a linha.
    if (facade.getBoundingClientRect().width < 20) facade.style.width = "100%";
    facade.style.aspectRatio = box.width >= 20 && box.height >= 20 ? `${box.width} / ${box.height}` : "16 / 9";
  }
  return true;
}

// ── Clique ──────────────────────────────────────────────────────────────────

/** Tudo o que a compatibilidade sabe abrir/fechar (gatilhos). */
const TRIGGERS =
  "[data-os-embed], [data-os-toggle], .elementor-tab-title, .elementor-tab-mobile-title, .e-n-tab-title, " +
  "[data-bs-toggle], [data-toggle], [role='tab'][aria-controls], .elementor-menu-toggle, [aria-expanded][aria-controls]";

/** Gatilho clicado e o que ele controla (painéis, conteúdo do mesmo widget). */
function watched(target: EventTarget | null): HTMLElement[] {
  const trigger = closestEl(target, TRIGGERS);
  if (!trigger) return [];
  const out: HTMLElement[] = [trigger];
  if (trigger.parentElement) out.push(trigger.parentElement);
  for (const id of (trigger.getAttribute("aria-controls") ?? "").split(/\s+/)) {
    const el = id ? document.getElementById(id) : null;
    if (el) out.push(el);
  }
  const ref =
    trigger.getAttribute("data-bs-target") ?? trigger.getAttribute("data-target") ?? trigger.getAttribute("href") ?? "";
  if (ref.length > 1 && ref.startsWith("#")) out.push(...safeQueryAll(document, ref));
  const widget = trigger.closest<HTMLElement>(".elementor-accordion, .elementor-toggle, .elementor-tabs");
  if (widget) out.push(...safeQueryAll(widget, ".elementor-tab-content"));
  return out;
}

/** Estado visível de um elemento (classes, aria, hidden, estilo). */
function fingerprint(els: HTMLElement[]): string {
  return els
    .map((el) =>
      [
        el.getAttribute("class"),
        el.getAttribute("aria-expanded"),
        el.getAttribute("aria-selected"),
        el.hidden,
        el.getAttribute("style"),
        el.hasAttribute("open"),
      ].join("\u0001"),
    )
    .join("\u0002");
}

let before: { els: HTMLElement[]; state: string } | null = null;

/**
 * Antes de qualquer script da página (captura na janela): anota o estado do
 * gatilho. Se, quando o clique chega de volta à janela, esse estado já mudou, um
 * script original (página "Preservar JS" salva antes do marcador
 * <meta name="os-preserve-js">) cuidou do clique — e a compatibilidade não mexe,
 * senão desfaria o que ele fez.
 */
function onClickCapture(event: MouseEvent) {
  const els = watched(event.target);
  before = els.length ? { els, state: fingerprint(els) } : null;
}

function onClick(event: MouseEvent) {
  const snap = before;
  before = null;
  if (event.defaultPrevented || event.button !== 0) return;
  if (snap && fingerprint(snap.els) !== snap.state) return;
  const t = event.target;
  let handled = false;

  const embed = closestEl(t, "[data-os-embed]");
  const toggle = closestEl(t, "[data-os-toggle]");
  const elementor = closestEl(t, ".elementor-tab-title, .elementor-tab-mobile-title");
  const nestedTab = closestEl(t, ".e-n-tab-title");
  const bsCollapse = closestEl(t, "[data-bs-toggle='collapse'], [data-toggle='collapse']");
  const bsTab = closestEl(
    t,
    "[data-bs-toggle='tab'], [data-bs-toggle='pill'], [data-bs-toggle='list'], [data-toggle='tab'], [data-toggle='pill']",
  );
  const ariaTab = closestEl(t, "[role='tab'][aria-controls]");
  const menuToggle = closestEl(t, ".elementor-menu-toggle");
  const disclosure = closestEl(t, "[aria-expanded][aria-controls]");

  if (embed) handled = loadEmbed(embed);
  else if (toggle) {
    runToggle(toggle, toggle.getAttribute("data-os-toggle") ?? "");
    handled = true;
  } else if (elementor) handled = elementorTabs(elementor);
  else if (nestedTab) {
    const list = nestedTab.closest<HTMLElement>(".e-n-tabs-heading, [role='tablist']") ?? nestedTab.parentElement;
    handled = !!list && activateTab(nestedTab, list, ".e-n-tab-title");
  } else if (bsCollapse) handled = bootstrapCollapse(bsCollapse);
  else if (bsTab) {
    const list = bsTab.closest<HTMLElement>(".nav, [role='tablist'], .list-group") ?? bsTab.parentElement;
    handled =
      !!list &&
      activateTab(
        bsTab,
        list,
        "[data-bs-toggle='tab'], [data-bs-toggle='pill'], [data-bs-toggle='list'], [data-toggle='tab'], [data-toggle='pill']",
      );
  } else if (ariaTab) {
    const list = ariaTab.closest<HTMLElement>("[role='tablist']") ?? ariaTab.parentElement;
    handled = !!list && activateTab(ariaTab, list, "[role='tab'][aria-controls]");
  } else if (menuToggle) {
    const open = !menuToggle.classList.contains("elementor-active");
    menuToggle.classList.toggle("elementor-active", open);
    menuToggle.setAttribute("aria-expanded", String(open));
    handled = true;
  } else if (disclosure) handled = ariaDisclosure(disclosure);

  const noop = closestEl(t, "a[data-os-noop]");
  if (handled || noop) {
    const link = closestEl(t, "a[href]");
    // Não segue o link do gatilho (href="#…" ou "javascript:" neutralizado).
    if (noop || (link && (link.getAttribute("href") ?? "").startsWith("#"))) event.preventDefault();
  }
}

function onKey(event: KeyboardEvent) {
  if (event.defaultPrevented || (event.key !== "Enter" && event.key !== " ")) return;
  const el = closestEl(event.target, "[data-os-embed], [data-os-toggle], .elementor-tab-title, .elementor-menu-toggle");
  if (!el || el.tagName === "A" || el.tagName === "BUTTON") return;
  event.preventDefault();
  el.click();
}

/** Liga os comportamentos (uma vez por página; chamadas repetidas não fazem nada). */
export function initCloneCompat(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const w = window as CompatWindow;
  if (w.__osCloneCompat) return;
  w.__osCloneCompat = true;
  // Na janela, fase de bolha: roda depois dos scripts da página (delegados no
  // document inclusive), que assim têm a chance de tratar o clique antes.
  window.addEventListener("click", onClickCapture, true);
  window.addEventListener("click", onClick);
  document.addEventListener("keydown", onKey);
}
