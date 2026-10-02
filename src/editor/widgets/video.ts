/**
 * Vídeos:
 * - os-video-embed: <iframe data-os-video> (YouTube, Vimeo, Panda). O usuário
 *   cola qualquer link (ou o código <iframe>) e ele vira o endereço de
 *   incorporação certo. No editor aparece um marcador (com a capa do YouTube).
 * - os-vturb-player: div[data-os-widget="vturb"]; o player é montado na página
 *   (src/runtime/widgets/vturb.ts). Aceita o código do VTurb colado inteiro.
 * - os-video-file: <video data-os-file> com arquivo enviado ou endereço .mp4.
 */
import type { Component, Editor } from "grapesjs";
import { type Def, esc, type Style } from "@/editor/blocks/shared";
import { attr } from "./dom";
import { selectAttr, type TraitDef, textAttr } from "./traits";
import {
  hasAutoplay,
  normalizeVideoUrl,
  parseVturbCode,
  type VideoProvider,
  withAutoplay,
  youtubeThumb,
} from "./video-url";

const PROVIDER_LABEL: Record<string, string> = {
  youtube: "Vídeo do YouTube",
  vimeo: "Vídeo do Vimeo",
  panda: "Vídeo Panda",
  other: "Vídeo incorporado",
  vturb: "Vídeo VTurb",
};

function placeholder(el: HTMLElement, title: string, detail: string, thumb?: string | null, problem = "") {
  const bg = thumb
    ? `background:#111 url("${thumb}") center/cover no-repeat;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.8);`
    : "background:repeating-linear-gradient(45deg,#eef0f5,#eef0f5 12px,#e3e7ef 12px,#e3e7ef 24px);color:#3b4254;";
  const warn = problem
    ? `<div style="max-width:92%;padding:6px 10px;border-radius:6px;background:#fef3c7;color:#92400e;text-shadow:none;font-size:12px">${esc(problem)}</div>`
    : "";
  el.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;width:100%;height:100%;min-height:200px;box-sizing:border-box;padding:16px;border:2px dashed #8b93a7;border-radius:inherit;${bg}font:600 14px/1.3 system-ui,-apple-system,sans-serif;text-align:center;pointer-events:none"><div style="font-size:34px;line-height:1">▶</div><div>${esc(title)}</div><div style="font-weight:400;font-size:12px;opacity:.85;word-break:break-all;max-width:90%">${esc(detail)}</div>${warn}<div style="font-weight:400;font-size:11px;opacity:.7">Toca de verdade na prévia</div></div>`;
}

/** Link colado que não dá para incorporar (fica só no editor, não vai para o projeto). */
const videoProblems = new WeakMap<Component, string>();
const VIDEO_PROBLEM_EVENT = "os:video-problem";
export const NOT_EMBEDDABLE =
  "Esse link não é de um vídeo que dá para incorporar. Use o link do vídeo (YouTube, Vimeo ou Panda).";

function setVideoProblem(component: Component, problem: string) {
  if ((videoProblems.get(component) ?? "") === problem) return;
  if (problem) videoProblems.set(component, problem);
  else videoProblems.delete(component);
  component.trigger(VIDEO_PROBLEM_EVENT);
}

// ─── YouTube / Vimeo / Panda ─────────────────────────────────────────────────

const EMBED_TRAITS: TraitDef[] = [
  {
    type: "os-textarea",
    name: "os-video-url",
    label: "Link do vídeo (ou código de incorporação)",
    rows: 3,
    placeholder: "https://www.youtube.com/watch?v=…",
    getValue: ({ component }) => attr(component, "src"),
    setValue: ({ component, value }) => {
      const typed = String(value ?? "").trim();
      const embed = normalizeVideoUrl(typed);
      // Link que não é de vídeo (canal, playlist sem código, painel do Panda…):
      // não troca o vídeo e avisa no próprio marcador do canvas.
      setVideoProblem(component, typed && !embed ? NOT_EMBEDDABLE : "");
      if (!embed) {
        if (!typed) component.addAttributes({ src: "" });
        return;
      }
      const autoplay = hasAutoplay(attr(component, "src"));
      component.addAttributes({
        src: autoplay ? withAutoplay(embed.src, true) : embed.src,
        "data-os-video": embed.provider,
      });
    },
  },
  {
    type: "os-check",
    name: "os-video-autoplay",
    label: "Tocar sozinho (começa sem som)",
    getValue: ({ component }) => hasAutoplay(attr(component, "src")),
    setValue: ({ component, value }) => {
      const src = attr(component, "src");
      if (src) component.addAttributes({ src: withAutoplay(src, !!value) });
    },
  },
  textAttr("title", "Título (leitores de tela)", "Vídeo"),
];

function paintEmbed(el: HTMLElement, component: Component) {
  const src = attr(component, "src");
  const provider = (attr(component, "data-os-video") || "other") as VideoProvider;
  const problem = videoProblems.get(component) ?? "";
  if (!src)
    placeholder(
      el,
      PROVIDER_LABEL[provider] ?? PROVIDER_LABEL.other,
      "Cole o link do vídeo em Configurações",
      null,
      problem,
    );
  else
    placeholder(
      el,
      PROVIDER_LABEL[provider] ?? PROVIDER_LABEL.other,
      src,
      provider === "youtube" ? youtubeThumb(src) : null,
      problem,
    );
}

// ─── VTurb ───────────────────────────────────────────────────────────────────

const VTURB_TRAITS: TraitDef[] = [
  {
    type: "os-textarea",
    name: "os-vturb-code",
    label: "Cole aqui o código do VTurb",
    rows: 4,
    placeholder: '<vturb-smartplayer id="vid-…"></vturb-smartplayer> <script…',
    getValue: () => "",
    setValue: ({ component, value, emitUpdate }) => {
      const info = parseVturbCode(String(value ?? ""));
      if (!info) return;
      const next: Record<string, string> = {};
      if (info.account) next["data-os-account"] = info.account;
      if (info.player) next["data-os-player"] = info.player;
      if (info.version) next["data-os-version"] = info.version;
      component.addAttributes(next);
      emitUpdate();
    },
  },
  textAttr("data-os-account", "ID da conta"),
  textAttr("data-os-player", "ID do player"),
  selectAttr("data-os-version", "Tipo de player", [
    ["v4", "Novo (vturb-smartplayer)"],
    ["v3", "Antigo"],
  ]),
];

function paintVturb(el: HTMLElement, component: Component) {
  const player = attr(component, "data-os-player");
  const account = attr(component, "data-os-account");
  const detail = !player
    ? "Cole o código do VTurb em Configurações"
    : !account
      ? `Player ${player} — falta o ID da conta (cole o código completo)`
      : `Player ${player}`;
  placeholder(el, PROVIDER_LABEL.vturb, detail);
}

// ─── Arquivo de vídeo ────────────────────────────────────────────────────────

const EMPTY_VIDEO_POSTER = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#e8ebf2"/><path d="M600 300v120l100-60z" fill="#8b93a7"/><text x="640" y="490" font-family="system-ui,sans-serif" font-size="34" font-weight="600" fill="#5b6475" text-anchor="middle">Escolha o arquivo do vídeo em Configurações</text></svg>',
)}`;

/** No editor: nunca toca sozinho e, sem arquivo, mostra uma capa com a instrução. */
function paintVideoFile(video: HTMLVideoElement, component: Component) {
  video.autoplay = false;
  video.pause?.();
  if (!attr(component, "src") && !attr(component, "poster")) video.setAttribute("poster", EMPTY_VIDEO_POSTER);
}

/**
 * Comando que envia um vídeo do computador e coloca o endereço no componente
 * (registrado pelo editor em src/editor/grapes/video-upload.ts).
 */
export const VIDEO_PICK_COMMAND = "os:pick-video";

function pickVideo(editor: Editor, component: Component) {
  if (editor.Commands.has(VIDEO_PICK_COMMAND)) editor.runCommand(VIDEO_PICK_COMMAND, { component });
}

const FILE_TRAITS: TraitDef[] = [
  textAttr("src", "Endereço do vídeo (.mp4)", "https://…/video.mp4"),
  {
    type: "button",
    name: "os-video-pick",
    label: "Arquivo",
    text: "Enviar vídeo do computador…",
    full: true,
    command: (editor, trait) => pickVideo(editor, trait.target),
  },
  textAttr("poster", "Imagem de capa (endereço)", "https://…/capa.jpg"),
  { type: "checkbox", name: "controls", label: "Mostrar controles" },
  {
    // O navegador (Chrome, Safari, celular) só deixa tocar sozinho sem som e, no
    // iPhone, dentro da página: liga os três juntos.
    type: "os-check",
    name: "os-autoplay",
    label: "Tocar sozinho (começa sem som)",
    getValue: ({ component }) => {
      // O checkbox antigo gravava autoplay: false ao desligar.
      const v = component.getAttributes().autoplay as unknown;
      return v !== undefined && v !== false && v !== "false";
    },
    setValue: ({ component, value }) => {
      if (value) component.addAttributes({ autoplay: true, muted: true, playsinline: true });
      else component.removeAttributes("autoplay");
    },
  },
  { type: "checkbox", name: "muted", label: "Sem som" },
  { type: "checkbox", name: "loop", label: "Repetir" },
  { type: "checkbox", name: "playsinline", label: "Tocar na página (celular)" },
];

export function registerVideoTypes(editor: Editor) {
  const dc = editor.DomComponents;

  dc.addType("os-video-embed", {
    isComponent: (node) => node.tagName === "IFRAME" && node.hasAttribute?.("data-os-video"),
    model: { defaults: { tagName: "iframe", name: "Vídeo", droppable: false, traits: EMBED_TRAITS } },
    view: {
      // No editor, um marcador no lugar do iframe (o HTML final continua com o iframe).
      tagName: () => "div",
      init({ model }: { model: Component }) {
        this.listenTo(model, `change:attributes:src change:attributes:data-os-video ${VIDEO_PROBLEM_EVENT}`, () =>
          paintEmbed(this.el, model),
        );
      },
      onRender({ el, model }: { el: HTMLElement; model: Component }) {
        paintEmbed(el, model);
      },
    },
  });

  dc.addType("os-vturb-player", {
    isComponent: (node) => node.getAttribute?.("data-os-widget") === "vturb",
    model: { defaults: { name: "Vídeo VTurb", droppable: false, traits: VTURB_TRAITS } },
    view: {
      init({ model }: { model: Component }) {
        this.listenTo(model, "change:attributes", () => paintVturb(this.el, model));
      },
      onRender({ el, model }: { el: HTMLElement; model: Component }) {
        paintVturb(el, model);
      },
    },
  });

  dc.addType("os-video-file", {
    extend: "os-video",
    isComponent: (node) => node.tagName === "VIDEO" && node.hasAttribute?.("data-os-file"),
    model: { defaults: { name: "Vídeo (arquivo)", traits: FILE_TRAITS } },
    view: {
      init({ model }: { model: Component }) {
        this.listenTo(model, "change:attributes", () => paintVideoFile(this.el as HTMLVideoElement, model));
      },
      onRender({ el, model }: { el: HTMLElement; model: Component }) {
        paintVideoFile(el as HTMLVideoElement, model);
      },
    },
  });
}

// ─── Definições usadas pelos blocos ──────────────────────────────────────────

const FRAME_STYLE = {
  display: "block",
  width: "100%",
  "aspect-ratio": "16 / 9",
  height: "auto",
  border: "0",
  "border-radius": "14px",
  "background-color": "#000000",
  "box-shadow": "0 16px 40px rgba(15,23,42,.18)",
  margin: "0 auto",
};

export function videoEmbedDef(provider: Exclude<VideoProvider, "other">, src = "", style: Style = {}): Def {
  return {
    type: "os-video-embed",
    tagName: "iframe",
    name: PROVIDER_LABEL[provider],
    attributes: {
      "data-os-video": provider,
      src,
      title: "Vídeo",
      allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
      allowfullscreen: true,
      // Sem isso o YouTube recusa tocar quando a página não manda "referrer".
      referrerpolicy: "strict-origin-when-cross-origin",
    },
    style: { ...FRAME_STYLE, ...style },
  };
}

export function vturbDef(style: Style = {}): Def {
  return {
    type: "os-vturb-player",
    name: "Vídeo VTurb",
    attributes: { "data-os-widget": "vturb", "data-os-account": "", "data-os-player": "", "data-os-version": "v4" },
    // Sem proporção fixa: o VTurb tem vídeos deitados e em pé (celular).
    style: { display: "block", width: "100%", margin: "0 auto", ...style },
  };
}

export function videoFileDef(style: Style = {}): Def {
  return {
    type: "os-video-file",
    tagName: "video",
    name: "Vídeo (arquivo)",
    attributes: { "data-os-file": "", controls: true, playsinline: true, preload: "metadata" },
    style: {
      display: "block",
      width: "100%",
      height: "auto",
      "border-radius": "14px",
      "background-color": "#000000",
      margin: "0 auto",
      ...style,
    },
  };
}
