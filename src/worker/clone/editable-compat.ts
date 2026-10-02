/**
 * Modo Editável sem os scripts da página: ajustes no DOM para que o que o
 * JavaScript fazia continue visível e clicável.
 *
 * - normalizeAnimations: animações de entrada (Elementor, AOS, WOW, sal.js,
 *   ScrollReveal) ficam no estado final, visível.
 * - markVideoFacades: capas "clique para carregar" do YouTube/Vimeo (WP Rocket,
 *   lite-youtube, capa do vídeo do Elementor) ganham data-os-embed.
 * - convertToggles: FAQ/acordeões feitos à mão (onclick ou script que alterna
 *   uma classe/display) ganham data-os-toggle.
 * - sanitizeScriptUrls: tira os `javascript:` que sobram em atributos.
 *
 * Os ganchos data-os-* são executados por src/runtime/clone-compat.ts, que
 * roda na prévia e na página exportada. Widgets conhecidos (acordeão/abas do
 * Elementor, collapse/abas do Bootstrap) são tratados direto pelo runtime.
 *
 * Funções puras sobre o DOM do cheerio (sem rede, sem banco).
 */
import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import { vimeoIdFromUrl, youtubeIdFromUrl } from "@/detection/videos";
import { isElement } from "./html-assets";

// ─── Animações de entrada ────────────────────────────────────────────────────

/** Remove declarações de um style="" (por nome da propriedade e valor). */
function dropDeclarations(style: string, test: (prop: string, value: string) => boolean): string {
  return style
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .filter((d) => {
      const i = d.indexOf(":");
      if (i < 0) return true;
      return !test(
        d.slice(0, i).trim().toLowerCase(),
        d
          .slice(i + 1)
          .trim()
          .toLowerCase(),
      );
    })
    .join("; ");
}

function setStyle(el: Element, style: string) {
  if (style) el.attribs.style = style.endsWith(";") ? style : `${style};`;
  else delete el.attribs.style;
}

/**
 * Deixa as animações de entrada no estado final (visível). Sem os scripts,
 * elementos que não passaram pela tela durante a captura — inclusive os que
 * só aparecem no celular, já que a versão de celular reaproveita o DOM do
 * desktop quando o HTML é o mesmo — ficariam invisíveis para sempre.
 * Devolve quantos elementos mudaram.
 */
export function normalizeAnimations($: CheerioAPI): number {
  let changed = 0;
  // Elementor: .elementor-invisible{visibility:hidden} até o "Entrance Animation" rodar.
  $(".elementor-invisible").each((_, el) => {
    $(el).removeClass("elementor-invisible");
    changed++;
  });
  // AOS: [data-aos^=fade]{opacity:0} até ganhar .aos-animate.
  $("[data-aos]").each((_, el) => {
    const $el = $(el);
    if ($el.hasClass("aos-animate")) return;
    $el.addClass("aos-init aos-animate");
    changed++;
  });
  // sal.js: [data-sal]{opacity:0} até ganhar .sal-animate.
  $("[data-sal]").each((_, el) => {
    const $el = $(el);
    if ($el.hasClass("sal-animate")) return;
    $el.addClass("sal-animate");
    changed++;
  });
  // WOW.js (style="visibility: hidden; animation-name: none") e ScrollReveal
  // (data-sr-id + style="visibility: hidden; opacity: 0; transform: …").
  $(".wow[style], [data-sr-id][style]").each((_, node) => {
    if (!isElement(node)) return;
    const style = node.attribs.style ?? "";
    const hidden = /visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0+)?\s*(?:;|$|!)/i.test(style);
    if (!hidden) return;
    const scrollReveal = node.attribs["data-sr-id"] !== undefined;
    const next = dropDeclarations(
      style,
      (prop, value) =>
        (prop === "visibility" && value.startsWith("hidden")) ||
        (prop === "opacity" && /^0(?:\.0+)?(?:\s*!important)?$/.test(value)) ||
        (prop === "animation-name" && value.startsWith("none")) ||
        (scrollReveal && prop === "transform"),
    );
    setStyle(node, next);
    changed++;
  });
  return changed;
}

// ─── Capas de vídeo "clique para carregar" ───────────────────────────────────

function withParams(url: string, params: string): string {
  const extra = params.replace(/^[?&]+/, "");
  if (!extra) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${extra}`;
}

function hasIframe($: CheerioAPI, el: Element): boolean {
  return $(el).find("iframe").length > 0;
}

function youtubeEmbed(id: string, host = "www.youtube.com"): string {
  return `https://${host}/embed/${encodeURIComponent(id)}?autoplay=1`;
}

/** Endereço de embed a partir das configurações do widget de vídeo do Elementor. */
function elementorEmbed(settingsJson: string | undefined): string | null {
  if (!settingsJson) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(settingsJson) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const type = String(data.video_type ?? "youtube");
  const url = typeof data[`${type}_url`] === "string" ? (data[`${type}_url`] as string) : "";
  if (type === "hosted") return "video";
  if (type === "youtube") {
    const id = url ? youtubeIdFromUrl(url) : undefined;
    return id ? youtubeEmbed(id) : null;
  }
  if (type === "vimeo") {
    const id = url ? vimeoIdFromUrl(url) : undefined;
    return id ? `https://player.vimeo.com/video/${id}?autoplay=1` : null;
  }
  return null;
}

/**
 * Capas que trocam a miniatura pelo player no clique (o script que fazia a
 * troca é removido no modo Editável). Marca a capa com
 * `data-os-embed="<url do embed>"` (o runtime cria o iframe no clique):
 * WP Rocket (.rll-youtube-player), <lite-youtube>/<lite-vimeo>, Plyr/
 * [data-youtube-id] sem iframe e a capa (image overlay) do vídeo do
 * Elementor — esta com data-os-embed-mode="overlay" (a capa sai e o player
 * entra no lugar de .elementor-video). Devolve quantas capas foram marcadas.
 */
export function markVideoFacades($: CheerioAPI): number {
  let marked = 0;
  const mark = (el: Element, src: string, mode?: "overlay", slot?: string) => {
    el.attribs["data-os-embed"] = src;
    if (mode) el.attribs["data-os-embed-mode"] = mode;
    if (slot) el.attribs["data-os-embed-slot"] = slot;
    marked++;
  };

  for (const el of $(".rll-youtube-player").toArray().filter(isElement)) {
    if (hasIframe($, el) || el.attribs["data-os-embed"]) continue;
    const inner = $(el).find("[data-id]").first();
    const id = el.attribs["data-id"] ?? inner.attr("data-id");
    const query = el.attribs["data-query"] ?? inner.attr("data-query") ?? "";
    const dataSrc = el.attribs["data-src"] ?? "";
    const fromSrc = /^(?:https?:)?\/\//i.test(dataSrc)
      ? youtubeIdFromUrl(dataSrc.replace(/^\/\//, "https://"))
      : undefined;
    const videoId = id && /^[\w-]{11}$/.test(id) ? id : fromSrc;
    if (!videoId) continue;
    mark(el, withParams(youtubeEmbed(videoId), query));
  }

  for (const el of $("lite-youtube").toArray().filter(isElement)) {
    if (hasIframe($, el) || el.attribs["data-os-embed"]) continue;
    const id = el.attribs.videoid ?? el.attribs["video-id"];
    if (!id || !/^[\w-]{11}$/.test(id)) continue;
    mark(el, withParams(youtubeEmbed(id, "www.youtube-nocookie.com"), el.attribs.params ?? ""));
  }

  for (const el of $("lite-vimeo").toArray().filter(isElement)) {
    if (hasIframe($, el) || el.attribs["data-os-embed"]) continue;
    const id = el.attribs.videoid ?? el.attribs["video-id"];
    if (!id || !/^\d+$/.test(id)) continue;
    mark(el, `https://player.vimeo.com/video/${id}?autoplay=1`);
  }

  for (const el of $("[data-youtube-id], [data-plyr-provider][data-plyr-embed-id]").toArray().filter(isElement)) {
    if (hasIframe($, el) || el.attribs["data-os-embed"] || $(el).find("video").length) continue;
    const provider = (el.attribs["data-plyr-provider"] ?? "youtube").toLowerCase();
    const raw = el.attribs["data-youtube-id"] ?? el.attribs["data-plyr-embed-id"] ?? "";
    if (provider === "youtube") {
      const id = /^[\w-]{11}$/.test(raw) ? raw : youtubeIdFromUrl(raw);
      if (id) mark(el, youtubeEmbed(id));
    } else if (provider === "vimeo") {
      const id = /^\d+$/.test(raw) ? raw : vimeoIdFromUrl(raw);
      if (id) mark(el, `https://player.vimeo.com/video/${id}?autoplay=1`);
    }
  }

  for (const el of $(".elementor-custom-embed-image-overlay").toArray().filter(isElement)) {
    if (el.attribs["data-os-embed"]) continue;
    const widget = $(el).closest("[data-settings]");
    const src = elementorEmbed(widget.attr("data-settings"));
    const wrapper = el.parent && isElement(el.parent) ? el.parent : null;
    // O player já está atrás da capa: basta tirar a capa no clique.
    if (wrapper && $(wrapper).children("iframe, video").length) {
      mark(el, "reveal", "overlay");
      continue;
    }
    if (!src) continue;
    mark(el, src, "overlay", ".elementor-video");
  }
  return marked;
}

// ─── FAQ / acordeões feitos à mão ────────────────────────────────────────────

/** Uma ação de alternância: o que muda (classes, display, max-height) e em quem. */
interface ToggleAction {
  /** Classes separadas por ".", ou "!display" / "!maxheight". */
  what: string;
  /** Passos a partir do elemento clicado, separados por "|" (ex.: "closest:.faq|find:.resposta"). */
  path: string;
}

const Q = String.raw`(["'\x60])`;
/** Passos de navegação no DOM depois de uma referência (this, getElementById…). */
const DOM_STEP_RE = new RegExp(
  String.raw`\.(parentElement|parentNode|nextElementSibling|previousElementSibling)\b|\.(closest|querySelector)\(\s*${Q}([^"'\x60]*?)\3\s*\)`,
  "gy",
);
const DOM_REF_RE = new RegExp(
  String.raw`(?:\bthis\b|\bdocument\.getElementById\(\s*${Q}([\w:.-]+)\1\s*\)|\bdocument\.querySelector\(\s*${Q}([^"'\x60]+?)\3\s*\))`,
  "g",
);
const JQ_REF_RE = new RegExp(String.raw`(?:\$|\bjQuery)\(\s*(?:(this)|${Q}([^"'\x60]+?)\2)\s*\)`, "g");
const JQ_STEP_RE = new RegExp(
  String.raw`\.(next|prev|parent|closest|find|children)\(\s*(?:${Q}([^"'\x60]*?)\2\s*)?\)`,
  "gy",
);

/** Nome de variável JS pronto para entrar numa expressão regular (`$` é especial). */
function escapeName(name: string): string {
  return name.replace(/\$/g, "\\$");
}

function encodeArg(arg: string): string {
  return encodeURIComponent(arg.trim());
}

/** Lê os passos que seguem `start` no código; devolve o caminho e onde parou. */
function readDomSteps(code: string, start: number, basePath: string[]): { path: string[]; end: number } | null {
  const path = [...basePath];
  let pos = start;
  for (;;) {
    DOM_STEP_RE.lastIndex = pos;
    const m = DOM_STEP_RE.exec(code);
    if (!m) break;
    pos = DOM_STEP_RE.lastIndex;
    const prop = m[1];
    if (prop === "parentElement" || prop === "parentNode") path.push("parent");
    else if (prop === "nextElementSibling") path.push("next");
    else if (prop === "previousElementSibling") path.push("prev");
    else if (m[2] === "closest") path.push(`closest:${encodeArg(m[4] ?? "")}`);
    else if (m[2] === "querySelector") path.push(`find:${encodeArg(m[4] ?? "")}`);
    if (path.length > 6) return null;
  }
  return { path, end: pos };
}

function readJqSteps(code: string, start: number, basePath: string[]): { path: string[]; end: number } | null {
  const path = [...basePath];
  let pos = start;
  for (;;) {
    JQ_STEP_RE.lastIndex = pos;
    const m = JQ_STEP_RE.exec(code);
    if (!m) break;
    pos = JQ_STEP_RE.lastIndex;
    const arg = m[3] ?? "";
    switch (m[1]) {
      case "next":
        path.push("next");
        break;
      case "prev":
        path.push("prev");
        break;
      case "parent":
        path.push("parent");
        break;
      case "closest":
        if (!arg) return null;
        path.push(`closest:${encodeArg(arg)}`);
        break;
      case "find":
      case "children":
        if (!arg) return null;
        path.push(`find:${encodeArg(arg)}`);
        break;
    }
    if (path.length > 6) return null;
  }
  return { path, end: pos };
}

function pathString(path: string[]): string {
  return path.length ? path.join("|") : "self";
}

/** Troca variáveis simples (`var panel = this.nextElementSibling;`) pelo valor. */
function inlineVariables(code: string): string {
  let out = code;
  const assign = new RegExp(
    String.raw`\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*((?:this|document\.getElementById\(\s*${Q}[\w:.-]+\3\s*\)|document\.querySelector\(\s*${Q}[^"'\x60]+?\4\s*\))(?:\.(?:parentElement|parentNode|nextElementSibling|previousElementSibling)|\.(?:closest|querySelector)\(\s*${Q}[^"'\x60]*?\5\s*\))*)\s*;?`,
    "g",
  );
  for (let guard = 0; guard < 5; guard++) {
    const m = assign.exec(out);
    if (!m) break;
    const [whole, name, value] = m;
    if (!name || !value) break;
    const rest = out
      .slice(m.index + whole.length)
      .replace(new RegExp(String.raw`(?<![\w$.])${escapeName(name)}(?![\w$])`, "g"), () => value);
    out = out.slice(0, m.index) + rest;
    assign.lastIndex = 0;
  }
  return out;
}

/** Ações de alternância num trecho de JS em que `this` é o elemento clicado. */
export function parseToggleActions(rawCode: string): ToggleAction[] {
  const code = inlineVariables(rawCode);
  const actions: ToggleAction[] = [];
  const add = (what: string, path: string[]) => {
    const p = pathString(path);
    if (!actions.some((a) => a.what === what && a.path === p)) actions.push({ what, path: p });
  };
  const displayValues = new Map<string, Set<string>>();

  for (const ref of code.matchAll(DOM_REF_RE)) {
    const base = ref[2] ? [`id:${encodeArg(ref[2])}`] : ref[4] ? [`query:${encodeArg(ref[4])}`] : [];
    const steps = readDomSteps(code, (ref.index ?? 0) + ref[0].length, base);
    if (!steps) continue;
    const tail = code.slice(steps.end);
    const toggle = new RegExp(String.raw`^\.classList\.toggle\(\s*${Q}([\w\s-]+)\1`).exec(tail);
    if (toggle?.[2]?.trim()) {
      add(toggle[2].trim().split(/\s+/).join("."), steps.path);
      continue;
    }
    // x.style.display = "none" | "block" (ou o ternário x.style.display = … ? "block" : "none")
    const display = new RegExp(String.raw`^\.style\.display\s*=(?!=)\s*(?:${Q}([\w-]*)\1|null)`).exec(tail);
    const ternary = new RegExp(
      String.raw`^\.style\.display\s*=(?!=)[^;]*?\?\s*${Q}([\w-]*)\1\s*:\s*${Q}([\w-]*)\3`,
    ).exec(tail);
    if (display || ternary) {
      const key = pathString(steps.path);
      const values = displayValues.get(key) ?? new Set<string>();
      if (display) values.add((display[2] ?? "").toLowerCase() || "none-reset");
      if (ternary) {
        values.add((ternary[2] ?? "").toLowerCase() || "none-reset");
        values.add((ternary[4] ?? "").toLowerCase() || "none-reset");
      }
      displayValues.set(key, values);
      continue;
    }
    if (/^\.style\.maxHeight\s*=/.test(tail)) add("!maxheight", steps.path);
  }
  for (const [path, values] of displayValues) {
    const hasNone = values.has("none");
    const hasShow = [...values].some((v) => v !== "none");
    if (hasNone && hasShow) add("!display", path === "self" ? [] : path.split("|"));
  }

  for (const ref of code.matchAll(JQ_REF_RE)) {
    const base = ref[1] ? [] : ref[3] ? [`all:${encodeArg(ref[3])}`] : null;
    if (!base) continue;
    const steps = readJqSteps(code, (ref.index ?? 0) + ref[0].length, base);
    if (!steps) continue;
    const tail = code.slice(steps.end);
    const toggleClass = new RegExp(String.raw`^\.toggleClass\(\s*${Q}([\w\s-]+)\1`).exec(tail);
    if (toggleClass?.[2]?.trim()) {
      add(toggleClass[2].trim().split(/\s+/).join("."), steps.path);
      continue;
    }
    if (/^\.(?:slideToggle|fadeToggle|toggle)\(/.test(tail)) add("!display", steps.path);
  }
  return actions;
}

/** Corpo `{…}` que começa em `open` (índice da chave), pulando strings. */
function blockAt(code: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < code.length && code[i] !== c; i++) if (code[i] === "\\") i++;
    } else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return code.slice(open + 1, i);
    }
  }
  return null;
}

/** Troca o nome de uma variável por `this` (fora de propriedades: não mexe em `x.item`). */
function asThis(code: string, name: string | undefined): string {
  if (!name) return code;
  return code.replace(new RegExp(String.raw`(?<![\w$.])${escapeName(name)}(?![\w$])`, "g"), "this");
}

/** Trigger → ações; várias fontes podem somar ações ao mesmo seletor. */
type TriggerMap = Map<string, { actions: ToggleAction[]; containerSel?: string }>;

function addTrigger(map: TriggerMap, selector: string, actions: ToggleAction[]) {
  if (!selector.trim() || !actions.length) return;
  const entry = map.get(selector) ?? { actions: [] };
  for (const a of actions)
    if (!entry.actions.some((b) => b.what === a.what && b.path === a.path)) entry.actions.push(a);
  map.set(selector, entry);
}

const CLICK_HANDLER = String.raw`(?:function\s*[\w$]*\s*\(\s*([\w$]*)[^)]*\)|\(?\s*([\w$]*)\s*\)?\s*=>)\s*\{`;

/**
 * Lê os scripts inline pequenos atrás de handlers de clique que só alternam
 * classe/display (padrão do acordeão da W3Schools, FAQ com forEach, jQuery).
 */
function scriptTriggers(code: string, out: TriggerMap) {
  if (code.length > 30_000) return;
  // Coleções: var acc = document.getElementsByClassName("accordion") / querySelectorAll(".faq")
  const collections = new Map<string, string>();
  const collRe = new RegExp(
    String.raw`\b(?:var|let|const)\s+([\w$]+)\s*=\s*document\.(?:getElementsByClassName\(\s*${Q}([\w\s-]+)\2\s*\)|querySelectorAll\(\s*${Q}([^"'\x60]+?)\4\s*\))`,
    "g",
  );
  for (const m of code.matchAll(collRe)) {
    const sel =
      m[5] ??
      (m[3]
        ? m[3]
            .trim()
            .split(/\s+/)
            .map((c) => `.${c}`)
            .join("")
        : "");
    if (m[1] && sel) collections.set(m[1], sel);
  }

  // Vanilla: <alvo>.addEventListener("click", function(){…})
  const listenRe = new RegExp(
    String.raw`([\w$.\[\]()'"\x60#\s-]{1,160}?)\.addEventListener\(\s*${Q}click\2\s*,\s*${CLICK_HANDLER}`,
    "g",
  );
  for (const m of code.matchAll(listenRe)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    const body = blockAt(code, open);
    if (body == null) continue;
    const eventParam = m[3] || m[4] || "";
    const subject = (m[1] ?? "").trim();
    let trigger = "";
    let containerVar: string | undefined;
    let containerSel: string | undefined;
    let triggerVar: string | undefined;

    const byId = new RegExp(String.raw`document\.getElementById\(\s*${Q}([\w:.-]+)\1\s*\)$`).exec(subject);
    const byQuery = new RegExp(String.raw`document\.querySelector\(\s*${Q}([^"'\x60]+?)\1\s*\)$`).exec(subject);
    const indexed = /([\w$]+)\s*\[\s*[\w$]+\s*\]$/.exec(subject);
    const sub = new RegExp(String.raw`([\w$]+)\.querySelector\(\s*${Q}([^"'\x60]+?)\2\s*\)$`).exec(subject);
    const plain = /(?:^|[^\w$.])([\w$]+)$/.exec(subject);
    const before = code.slice(Math.max(0, (m.index ?? 0) - 400), m.index ?? 0);
    const loopVar = (rawName: string): string | undefined => {
      const name = escapeName(rawName);
      const forEach = new RegExp(
        String.raw`querySelectorAll\(\s*${Q}([^"'\x60]+?)\1\s*\)\s*\.forEach\(\s*(?:function\s*\(\s*${name}\b|\(?\s*${name}\s*\)?\s*=>)`,
      ).exec(before);
      if (forEach?.[2]) return forEach[2];
      const forOf = new RegExp(
        String.raw`for\s*\(\s*(?:const|let|var)\s+${name}\s+of\s+document\.querySelectorAll\(\s*${Q}([^"'\x60]+?)\1\s*\)`,
      ).exec(before);
      if (forOf?.[2]) return forOf[2];
      // acc.forEach(function (item) {…}) / Array.from(acc).forEach(…) / for (const item of acc)
      for (const [collection, sel] of collections) {
        const c = escapeName(collection);
        const loop = new RegExp(
          String.raw`(?:\b${c}\)?\s*\.forEach\(\s*(?:function\s*\(\s*${name}\b|\(?\s*${name}\s*\)?\s*=>)|for\s*\(\s*(?:const|let|var)\s+${name}\s+of\s+${c}\b)`,
        );
        if (loop.test(before)) return sel;
      }
      return undefined;
    };

    if (byId?.[2]) trigger = `#${byId[2]}`;
    else if (byQuery?.[2]) trigger = byQuery[2];
    else if (indexed?.[1] && collections.has(indexed[1])) trigger = collections.get(indexed[1]) ?? "";
    else if (sub?.[1] && sub[3]) {
      const sel = loopVar(sub[1]);
      if (sel) {
        trigger = `${sel} ${sub[3]}`;
        containerVar = sub[1];
        containerSel = sel;
      }
    } else if (plain?.[1]) {
      const sel = loopVar(plain[1]);
      if (sel) {
        trigger = sel;
        triggerVar = plain[1];
      }
    }
    if (!trigger) continue;

    let handler = body;
    if (eventParam) {
      handler = handler.replace(
        new RegExp(String.raw`(?<![\w$.])${escapeName(eventParam)}\.currentTarget\b`, "g"),
        "this",
      );
    }
    handler = asThis(handler, triggerVar);
    if (containerVar && containerSel) {
      handler = handler.replace(
        new RegExp(String.raw`(?<![\w$.])${escapeName(containerVar)}(?![\w$])`, "g"),
        () => `this.closest("${containerSel.replace(/"/g, "")}")`,
      );
    }
    addTrigger(out, trigger, parseToggleActions(handler));
  }

  // jQuery: $(".faq-q").click(function(){…}) / .on("click", function(){…}) / $(document).on("click", ".faq-q", …)
  const jqRe = new RegExp(
    String.raw`(?:\$|\bjQuery)\(\s*${Q}([^"'\x60]+?)\1\s*\)\s*\.(?:click\(|on\(\s*${Q}click\3\s*,)\s*${CLICK_HANDLER}`,
    "g",
  );
  for (const m of code.matchAll(jqRe)) {
    const body = blockAt(code, (m.index ?? 0) + m[0].length - 1);
    if (body == null || !m[2]) continue;
    addTrigger(out, m[2], parseToggleActions(body));
  }
  const jqDelegated = new RegExp(
    String.raw`(?:\$|\bjQuery)\(\s*(?:document|${Q}(?:body|html)\1)\s*\)\s*\.on\(\s*${Q}click\2\s*,\s*${Q}([^"'\x60]+?)\3\s*,\s*${CLICK_HANDLER}`,
    "g",
  );
  for (const m of code.matchAll(jqDelegated)) {
    const body = blockAt(code, (m.index ?? 0) + m[0].length - 1);
    if (body == null || !m[4]) continue;
    addTrigger(out, m[4], parseToggleActions(body));
  }
}

/** Funções nomeadas dos scripts inline: nome → { parâmetros, corpo }. */
function namedFunctions(code: string, out: Map<string, { params: string[]; body: string }>) {
  const re = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g;
  for (const m of code.matchAll(re)) {
    const body = blockAt(code, (m.index ?? 0) + m[0].length - 1);
    if (body == null || !m[1] || out.has(m[1])) continue;
    out.set(m[1], {
      params: (m[2] ?? "")
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean),
      body,
    });
  }
}

function serializeActions(actions: ToggleAction[]): string {
  return actions.map((a) => `${a.what}@${a.path}`).join(" ");
}

function applyToggle(el: Element, actions: ToggleAction[]): boolean {
  if (!actions.length) return false;
  const existing = el.attribs["data-os-toggle"];
  const merged = existing ? `${existing} ${serializeActions(actions)}` : serializeActions(actions);
  el.attribs["data-os-toggle"] = [...new Set(merged.split(/\s+/).filter(Boolean))].join(" ");
  return true;
}

/**
 * FAQ e acordeões feitos à mão, que abriam por JavaScript: onclick que alterna
 * uma classe ou o display (inclusive via função nomeada, ex.:
 * `onclick="toggleFaq(this)"`) e scripts inline com handler de clique
 * (acordeão da W3Schools, forEach + addEventListener, jQuery .click/.on).
 * Cada elemento clicável ganha `data-os-toggle="<o que>@<caminho> …"`, que o
 * runtime executa. Rode ANTES de tirar os scripts. Devolve quantos elementos
 * receberam o gancho.
 */
export function convertToggles($: CheerioAPI): number {
  const functions = new Map<string, { params: string[]; body: string }>();
  const triggers: TriggerMap = new Map();
  for (const el of $("script:not([src])").toArray()) {
    const type = ($(el).attr("type") ?? "").toLowerCase();
    if (type && !/javascript|ecmascript|^module$/.test(type)) continue;
    const code = $(el).html() ?? "";
    if (code.length > 100_000) continue;
    namedFunctions(code, functions);
    scriptTriggers(code, triggers);
  }

  const done = new Set<Element>();
  let count = 0;
  for (const node of $("[onclick]").toArray()) {
    if (!isElement(node)) continue;
    let code = node.attribs.onclick ?? "";
    // onclick="toggleFaq(this)" → corpo da função com o parâmetro trocado por this.
    const call =
      /^\s*(?:return\s+)?([A-Za-z_$][\w$]*)\s*\(\s*this\s*(?:,[^)]*)?\)\s*;?\s*(?:return\s+false\s*;?)?\s*$/.exec(code);
    if (call?.[1]) {
      const fn = functions.get(call[1]);
      if (!fn) continue;
      code = asThis(fn.body, fn.params[0]);
    }
    if (applyToggle(node, parseToggleActions(code))) {
      done.add(node);
      count++;
    }
  }

  for (const [selector, { actions }] of triggers) {
    if (selector.includes("|")) continue;
    let els: Element[];
    try {
      els = $(selector).toArray().filter(isElement);
    } catch {
      continue;
    }
    for (const el of els) {
      if (applyToggle(el, actions) && !done.has(el)) {
        done.add(el);
        count++;
      }
    }
  }
  return count;
}

// ─── javascript: em atributos ────────────────────────────────────────────────

/** URL que executa código (javascript:/vbscript:), lida como o navegador lê (ignora espaços e controles). */
function isScriptUrl(value: string): boolean {
  return /^(?:java|vb)script:/i.test(cleanUrlValue(value));
}
/** Valor de URL como o navegador lê: sem espaços/controles nas pontas e sem TAB/quebras no meio. */
function cleanUrlValue(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) <= 0x20) start++;
  while (end > start && value.charCodeAt(end - 1) <= 0x20) end--;
  return value.slice(start, end).replace(/[\t\n\r]/g, "");
}

/** Destino que o runtime pode seguir: http(s) ou sem esquema (relativo, #âncora). */
function isSafeHref(value: string): boolean {
  const v = cleanUrlValue(value);
  return /^https?:\/\//i.test(v) || !/^[a-z][a-z0-9+.-]*:/i.test(v);
}

/**
 * Modo Editável = sem scripts. Além de <script> e on*, código também roda por
 * URLs `javascript:` em atributos e por ganchos data-os-href vindos da página
 * original (o runtime navega neles). Aqui:
 * - a/area com href="javascript:…" que sobrou (nada para converter) vira
 *   href="#" + data-os-noop (o runtime ignora o clique, como antes);
 * - action/formaction `javascript:` somem; os demais atributos com
 *   `javascript:` também;
 * - data-os-href/data-os-target só ficam se o destino for http(s) ou relativo (#âncora, caminho);
 * - iframe[srcdoc] com script é removido.
 * Devolve quantos atributos mudaram.
 */
export function sanitizeScriptUrls($: CheerioAPI): number {
  let changed = 0;
  $("*").each((_, node) => {
    if (!isElement(node)) return;
    const el = node;
    const tag = el.name.toLowerCase();
    for (const [name, value] of Object.entries(el.attribs)) {
      const attr = name.toLowerCase();
      if (attr === "data-os-href") {
        if (!isSafeHref(value)) {
          delete el.attribs[name];
          delete el.attribs["data-os-target"];
          changed++;
        }
        continue;
      }
      if (attr === "srcdoc") {
        if (/<script\b|\bon[a-z]+\s*=|javascript:/i.test(value)) {
          delete el.attribs[name];
          changed++;
        }
        continue;
      }
      if (!isScriptUrl(value)) continue;
      if (attr === "href" && (tag === "a" || tag === "area")) {
        el.attribs[name] = "#";
        el.attribs["data-os-noop"] = "";
      } else {
        delete el.attribs[name];
      }
      changed++;
    }
    if (el.attribs["data-os-target"] !== undefined && el.attribs["data-os-href"] === undefined) {
      delete el.attribs["data-os-target"];
    }
  });
  // SVG <animate>/<set> que trocam o href por javascript: (atributo to/values).
  $("animate, set").each((_, el) => {
    if (!isElement(el)) return;
    const name = (el.attribs.attributename ?? el.attribs.attributeName ?? "").toLowerCase();
    if (name.endsWith("href")) {
      $(el).remove();
      changed++;
    }
  });
  return changed;
}
