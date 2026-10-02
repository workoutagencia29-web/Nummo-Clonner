/**
 * Textos do GrapesJS em português (i18n.ts) e formato das seções do painel de
 * estilo (setup.ts). O comportamento no navegador está em codestyle-editor.test.ts.
 */
import ptBase from "grapesjs/locale/pt.mjs";
import { describe, expect, it } from "vitest";
import {
  colorPickerOptions,
  type MessageTree,
  mergeMessages,
  PROPERTY_LABELS,
  ptMessages,
  RTE_ACTIONS,
  SECTOR_NAMES,
  STATE_LABELS,
} from "@/editor/grapes/i18n";
import { familyValue, fontOptions, SAFE_FONTS, SECTORS } from "@/editor/grapes/setup";

/** Palavras em inglês que não podem aparecer na interface (fronteira de palavra com acentos). */
const ENGLISH_WORDS = [
  "the",
  "select",
  "selected",
  "image",
  "images",
  "add",
  "drop",
  "click",
  "upload",
  "layer",
  "layers",
  "settings",
  "style",
  "styles",
  "manager",
  "color",
  "width",
  "height",
  "top",
  "bottom",
  "left",
  "right",
  "none",
  "solid",
  "dotted",
  "dashed",
  "double",
  "groove",
  "ridge",
  "inset",
  "outset",
  "block",
  "inline",
  "flex",
  "row",
  "column",
  "wrap",
  "nowrap",
  "start",
  "end",
  "center",
  "space",
  "between",
  "around",
  "evenly",
  "stretch",
  "baseline",
  "repeat",
  "cover",
  "contain",
  "scroll",
  "fixed",
  "static",
  "relative",
  "absolute",
  "sticky",
  "hover",
  "even",
  "odd",
  "bold",
  "italic",
  "underline",
  "strike",
  "thin",
  "light",
  "medium",
  "semi",
  "ultra",
  "outside",
  "inside",
  "type",
  "blur",
  "spread",
  "size",
  "position",
  "attachment",
  "property",
  "duration",
  "timing",
  "rotate",
  "scale",
  "box",
  "body",
  "text",
  "comment",
  "table",
  "cell",
  "head",
  "foot",
  "device",
  "mobile",
  "landscape",
  "portrait",
  "preview",
  "fullscreen",
  "code",
  "open",
  "blocks",
  "choose",
  "cancel",
  "more",
  "less",
  "clear",
  "selection",
  "window",
  "new",
  "here",
  "path",
  "label",
  "map",
  "video",
  "wrapper",
  "state",
  "sync",
  "general",
  "typography",
  "decorations",
  "dimension",
  "opacity",
  "shadow",
  "border",
  "radius",
  "margin",
  "padding",
  "font",
  "family",
  "weight",
  "align",
  "decoration",
  "transform",
  "transition",
  "display",
  "overflow",
  "visible",
  "hidden",
  "pointer",
  "default",
  "black",
  "white",
  "transparent",
  "eg",
];
const ENGLISH = new RegExp(`(?<!\\p{L})(${ENGLISH_WORDS.join("|")})(?!\\p{L})`, "iu");

function strings(tree: unknown, path = ""): [string, string][] {
  if (typeof tree === "string") return [[path, tree]];
  if (typeof tree !== "object" || tree === null) return [];
  return Object.entries(tree).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k));
}

function englishIn(entries: [string, string][]) {
  return entries.filter(([, text]) => ENGLISH.test(text)).map(([path, text]) => `${path}: ${text}`);
}

function get(tree: MessageTree, path: string): unknown {
  return path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], tree);
}

type PropDef =
  | string
  | {
      id?: string;
      extend?: string;
      property?: string;
      type?: string;
      options?: { id: string; label?: string }[];
      properties?: PropDef[];
    };

function propId(def: PropDef) {
  return typeof def === "string" ? def : (def.id ?? def.extend ?? def.property ?? "");
}

function allProps(defs: PropDef[]): PropDef[] {
  return defs.flatMap((d) => [d, ...(typeof d === "object" && d.properties ? allProps(d.properties) : [])]);
}

describe("mensagens em português (i18n.ts)", () => {
  it("o detector de inglês funciona com acentos (Flexível não é 'flex')", () => {
    expect(ENGLISH.test("Flexível (itens lado a lado)")).toBe(false);
    expect(ENGLISH.test("Select an element")).toBe(true);
    expect(ENGLISH.test("Sombra da box")).toBe(true);
  });

  it("junta o pt.mjs com os ajustes sem mudar o original", () => {
    const merged = mergeMessages({ a: { b: "1", c: "2" } }, { a: { c: "3" }, d: "4" });
    expect(merged).toEqual({ a: { b: "1", c: "3" }, d: "4" });
    // O pt.mjs continua intacto (é compartilhado).
    expect((ptBase as unknown as MessageTree).styleManager).toMatchObject({
      empty: expect.stringContaining("Selecione"),
    });
    expect(get(ptBase as unknown as MessageTree, "styleManager.properties.padding")).toBe("Padding");
  });

  it("os textos principais existem e estão em português", () => {
    const keys = [
      "assetManager.addButton",
      "assetManager.inputPlh",
      "assetManager.modalTitle",
      "assetManager.uploadTitle",
      "selectorManager.label",
      "selectorManager.selected",
      "selectorManager.emptyState",
      "selectorManager.states.hover",
      "selectorManager.states.active",
      "selectorManager.states.nth-of-type(2n)",
      "styleManager.empty",
      "styleManager.layer",
      "styleManager.fileButton",
      "styleManager.properties.padding",
      "styleManager.properties.box-shadow",
      "styleManager.properties.font-family",
      "styleManager.properties.max-width",
      "styleManager.properties.min-height",
      "styleManager.properties.flex-wrap",
      "styleManager.properties.background-attachment",
      "styleManager.properties.background-image-sub",
      "styleManager.properties.transition-property-sub",
      "styleManager.properties.border-top-left-radius-sub",
      "styleManager.sectors.typography",
      "styleManager.sectors.flex",
      "traitManager.empty",
      "traitManager.label",
      "traitManager.traits.labels.title",
      "traitManager.traits.labels.href",
      "traitManager.traits.labels.target",
      "traitManager.traits.labels.alt",
      "traitManager.traits.options.target.false",
      "traitManager.traits.options.target._blank",
      "domComponents.names.",
      "domComponents.names.wrapper",
      "domComponents.names.div",
      "domComponents.names.text",
      "domComponents.names.image",
      "deviceManager.device",
      "storageManager.recover",
    ];
    const entries: [string, string][] = keys.map((key) => {
      const value = get(ptMessages, key);
      expect(typeof value, key).toBe("string");
      expect(String(value).trim(), key).not.toBe("");
      return [key, String(value)];
    });
    expect(englishIn(entries)).toEqual([]);
    expect(get(ptMessages, "selectorManager.states.hover")).toBe("Ao passar o mouse");
  });

  it("nenhum texto das mensagens está em inglês (inclui o que veio do pt.mjs)", () => {
    const entries = strings(ptMessages).filter(([path]) => !path.startsWith("blockManager"));
    // Placeholders de exemplo (ex.: https://…) e nomes próprios ficam de fora.
    const ignored = new Set(["deviceManager.devices.desktop", "deviceManager.devices.tablet"]);
    expect(englishIn(entries.filter(([p]) => !ignored.has(p)))).toEqual([]);
  });

  it("cobre todas as chaves do inglês do GrapesJS (sem cair no inglês)", async () => {
    const en = (await import("grapesjs/locale/en.mjs")).default as unknown as MessageTree;
    const missing = strings(en)
      .map(([path]) => path)
      .filter((path) => !path.startsWith("blockManager") && get(ptMessages, path) === undefined);
    expect(missing).toEqual([]);
  });

  it("estados, barra de texto e seletor de cores em português", () => {
    expect(englishIn(Object.entries(STATE_LABELS))).toEqual([]);
    expect(RTE_ACTIONS.map((a) => a.name)).toEqual(["bold", "italic", "underline", "strikethrough", "link", "wrap"]);
    expect(englishIn(RTE_ACTIONS.map((a) => [a.name, a.attributes.title]))).toEqual([]);
    const picker = colorPickerOptions();
    const texts: [string, string][] = [
      ["chooseText", String(picker.chooseText)],
      ["cancelText", String(picker.cancelText)],
      ["clearText", String(picker.clearText)],
      ["noColorSelectedText", String(picker.noColorSelectedText)],
      ["togglePaletteMoreText", String(picker.togglePaletteMoreText)],
      ["togglePaletteLessText", String(picker.togglePaletteLessText)],
    ];
    expect(englishIn(texts)).toEqual([]);
    expect(picker.chooseText).toBe("Aplicar");
    // Sem navegador (ou com o localStorage bloqueado) não usa cores recentes — senão o seletor quebra.
    expect(picker.localStorageKey).toBe(false);
    expect(picker.palette?.flat().every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true);
  });
});

describe("seções do painel de estilo (setup.ts)", () => {
  it("usa os nomes de i18n.ts e ids únicos", () => {
    expect(SECTORS.map((s) => s.id)).toEqual(Object.keys(SECTOR_NAMES));
    for (const sector of SECTORS) expect(sector.name).toBe(SECTOR_NAMES[sector.id]);
  });

  it("toda propriedade (e subpropriedade) tem rótulo em português", () => {
    const props = allProps(SECTORS.flatMap((s) => s.properties) as PropDef[]);
    const missing = props.map(propId).filter((id) => !PROPERTY_LABELS[id]);
    expect(missing).toEqual([]);
    expect(englishIn(Object.entries(PROPERTY_LABELS))).toEqual([]);
  });

  it("definições completas: texto = propriedade pronta; objeto = extend ou property + type", () => {
    for (const def of allProps(SECTORS.flatMap((s) => s.properties) as PropDef[])) {
      if (typeof def === "string") {
        expect(def).toMatch(/^[a-z-]+$/);
        continue;
      }
      expect(Boolean(def.extend) || (Boolean(def.property) && Boolean(def.type)), JSON.stringify(def)).toBe(true);
    }
  });

  it("opções de listas e botões estão em português (menos nomes de fontes)", () => {
    const entries: [string, string][] = [];
    for (const def of allProps(SECTORS.flatMap((s) => s.properties) as PropDef[])) {
      if (typeof def === "string" || !def.options || propId(def) === "font-family") continue;
      for (const opt of def.options) {
        expect(opt.label, `${propId(def)}.${opt.id}`).toBeTruthy();
        entries.push([`${propId(def)}.${opt.id}`, String(opt.label)]);
      }
    }
    expect(entries.length).toBeGreaterThan(60);
    expect(englishIn(entries)).toEqual([]);
  });

  it("alinhamento do texto em botões com rótulos em português", () => {
    const text = SECTORS[0].properties.find((p) => typeof p === "object" && p.extend === "text-align");
    expect(text).toMatchObject({
      options: [
        { id: "left", label: "Esquerda" },
        { id: "center", label: "Centro" },
        { id: "right", label: "Direita" },
        { id: "justify", label: "Justificado" },
      ],
    });
    const weight = SECTORS[0].properties.find((p) => typeof p === "object" && p.extend === "font-weight") as PropDef;
    const labels = (typeof weight === "object" ? weight.options : [])?.map((o) => o.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        "Fina (100)",
        "Normal (400)",
        "Média (500)",
        "Seminegrito (600)",
        "Negrito (700)",
        "Extra-negrito (800)",
      ]),
    );
  });

  it("fontes: padrão da página, fontes da página e fontes seguras (sem Google Fonts)", () => {
    expect(familyValue("Montserrat")).toBe('"Montserrat", sans-serif');
    expect(familyValue("Playfair Display")).toBe('"Playfair Display", serif');
    expect(familyValue("Fira Code")).toBe('"Fira Code", monospace');
    expect(familyValue("Open Sans")).toBe('"Open Sans", sans-serif');
    const opts = fontOptions(["Montserrat"]);
    expect(opts[0]).toEqual({ id: "", label: "Padrão da página" });
    expect(opts[1]).toEqual({ id: '"Montserrat", sans-serif', label: "Montserrat · usada na página" });
    expect(opts).toHaveLength(2 + SAFE_FONTS.length);
    expect(SAFE_FONTS.every(([id]) => !/googleapis|fonts\.g/.test(id))).toBe(true);
    // Toda fonte segura termina numa família genérica.
    expect(SAFE_FONTS.every(([id]) => /(sans-serif|serif|monospace)$/.test(id))).toBe(true);
  });
});
