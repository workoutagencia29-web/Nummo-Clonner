/**
 * Blocos e widgets — partes puras: leitura das opções (nomes, datas, telefone,
 * validação do formulário), endereços de vídeo, código do VTurb, a biblioteca de
 * blocos em si e o tamanho do script das páginas.
 */
import { buildSync } from "esbuild";
import { describe, expect, it } from "vitest";
import { ALL_BLOCKS, BLOCK_CATEGORIES } from "@/editor/blocks";
import type { Def } from "@/editor/blocks/shared";
import { findLegalPage } from "@/editor/widgets/context";
import { countdownSample } from "@/editor/widgets/countdown";
import { notificationSample } from "@/editor/widgets/sales-notification";
import { hasAutoplay, normalizeVideoUrl, parseVturbCode, withAutoplay, youtubeId } from "@/editor/widgets/video-url";
import { runtimeScript } from "@/lib/runtime-bundle";
import {
  formatPhoneBR,
  isValidEmail,
  isValidPhone,
  leadFieldError,
  normalizePhone,
  parseDeadline,
  parsePeople,
  splitTime,
  whatsappUrl,
} from "@/runtime/widgets/options";

describe("opções dos widgets", () => {
  it("lê a lista de nomes e cidades em vários formatos", () => {
    expect(parsePeople("Maria - São Paulo\nJoão | Recife\n\nAna, Belo Horizonte; Pedro\n  Lúcia — Natal  ")).toEqual([
      { name: "Maria", city: "São Paulo" },
      { name: "João", city: "Recife" },
      { name: "Ana", city: "Belo Horizonte" },
      { name: "Pedro", city: "" },
      { name: "Lúcia", city: "Natal" },
    ]);
    expect(parsePeople("   \n ")).toEqual([]);
    // Hífen dentro do nome não separa a cidade.
    expect(parsePeople("Ana-Clara - Rio")).toEqual([{ name: "Ana-Clara", city: "Rio" }]);
  });

  it("entende datas do contador (horário de Brasília quando não há fuso)", () => {
    const brt = Date.parse("2026-10-10T23:59:00-03:00");
    expect(parseDeadline("2026-10-10T23:59")).toBe(brt);
    expect(parseDeadline("2026-10-10 23:59")).toBe(brt);
    expect(parseDeadline("10/10/2026 23:59")).toBe(brt);
    expect(parseDeadline("2026-10-10")).toBe(Date.parse("2026-10-10T23:59:59-03:00"));
    expect(parseDeadline("2026-10-10T23:59:00Z")).toBe(Date.parse("2026-10-10T23:59:00Z"));
    expect(parseDeadline("2026-10-10T23:59:00+01:00")).toBe(Date.parse("2026-10-10T22:59:00Z"));
    for (const bad of ["", "amanhã", "2026-13-45", "31/02"]) expect(parseDeadline(bad)).toBeNull();
  });

  it("divide o tempo em dias, horas, minutos e segundos", () => {
    expect(splitTime(((2 * 24 + 3) * 3600 + 4 * 60 + 5) * 1000 + 999)).toEqual({ d: 2, h: 3, m: 4, s: 5 });
    expect(splitTime(-5000)).toEqual({ d: 0, h: 0, m: 0, s: 0 });
  });

  it("monta o link do WhatsApp (DDD ganha o 55)", () => {
    expect(normalizePhone("(11) 91234-5678")).toBe("5511912345678");
    expect(normalizePhone("011 3333-4444")).toBe("551133334444");
    expect(normalizePhone("+55 21 99999-8888")).toBe("5521999998888");
    expect(normalizePhone("+351 912 345 678")).toBe("351912345678");
    expect(whatsappUrl("11 91234-5678", "Olá! Quero saber mais & comprar")).toBe(
      "https://wa.me/5511912345678?text=Ol%C3%A1!%20Quero%20saber%20mais%20%26%20comprar",
    );
    expect(whatsappUrl("11912345678", "  ")).toBe("https://wa.me/5511912345678");
  });

  it("valida o formulário com mensagens em português", () => {
    expect(leadFieldError("name", " ", true)).toBe("Digite seu nome.");
    expect(leadFieldError("email", "", true)).toBe("Digite seu e-mail.");
    expect(leadFieldError("phone", "", true)).toBe("Digite seu WhatsApp com DDD.");
    expect(leadFieldError("other", "", true)).toBe("Preencha este campo.");
    expect(leadFieldError("email", "", false)).toBe("");
    expect(leadFieldError("email", "maria@", true)).toMatch(/e-mail válido/);
    expect(leadFieldError("phone", "9999-999", true)).toMatch(/WhatsApp válido com DDD/);
    expect(leadFieldError("name", "M", true)).toBe("Digite seu nome.");
    expect(leadFieldError("email", "maria@gmail.com", true)).toBe("");
    expect(leadFieldError("phone", "(11) 91234-5678", true)).toBe("");
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("a b@c.com")).toBe(false);
    expect(isValidPhone("+55 (11) 91234-5678")).toBe(true);
    expect(formatPhoneBR("11912345678")).toBe("(11) 91234-5678");
    expect(formatPhoneBR("1133334444")).toBe("(11) 3333-4444");
    expect(formatPhoneBR("+351 912")).toBe("+351 912");
  });

  it("mostra no editor um exemplo coerente com as configurações", () => {
    expect(countdownSample({ "data-os-minutes": "15" })).toMatchObject({ d: 0, h: 0, m: 15, s: 0, showDays: false });
    expect(countdownSample({ "data-os-minutes": "90" })).toMatchObject({ h: 1, m: 30 });
    const now = Date.parse("2026-10-01T12:00:00-03:00");
    expect(countdownSample({ "data-os-mode": "date", "data-os-until": "2026-10-03T13:30" }, now)).toMatchObject({
      d: 2,
      h: 1,
      m: 30,
      showDays: true,
    });
    expect(notificationSample({ "data-os-people": "Lia - Natal", "data-os-product": "o Curso Y" })).toEqual({
      title: "Lia, de Natal",
      text: "acabou de comprar o Curso Y",
    });
    expect(notificationSample({ "data-os-people": "Lia", "data-os-action": "garantiu a vaga" })).toEqual({
      title: "Lia",
      text: "garantiu a vaga",
    });
  });

  it("acha as páginas legais do funil", () => {
    const pages = [
      { id: "a", name: "Página de vendas", type: "SALES" },
      { id: "b", name: "Termos de uso", type: "LEGAL" },
      { id: "c", name: "Política de privacidade", type: "LEGAL" },
    ];
    expect(findLegalPage(pages, "terms")?.id).toBe("b");
    expect(findLegalPage(pages, "privacy")?.id).toBe("c");
    expect(findLegalPage(pages.slice(0, 1), "terms")).toBeUndefined();
  });
});

describe("endereços de vídeo", () => {
  const ID = "dQw4w9WgXcQ";
  it.each([
    [`https://www.youtube.com/watch?v=${ID}`, ""],
    [`https://youtube.com/watch?feature=share&v=${ID}`, ""],
    [`https://m.youtube.com/watch?v=${ID}&t=90s`, "&start=90"],
    [`https://youtu.be/${ID}?t=1m5s`, "&start=65"],
    [`https://www.youtube.com/shorts/${ID}`, ""],
    [`https://www.youtube.com/live/${ID}?si=abc`, ""],
    [`https://www.youtube.com/embed/${ID}?autoplay=1&mute=1`, "&autoplay=1&mute=1"],
    [`https://www.youtube-nocookie.com/embed/${ID}`, ""],
    [
      `<iframe width="560" height="315" src="https://www.youtube.com/embed/${ID}?si=x" title="YouTube video player"></iframe>`,
      "",
    ],
    [ID, ""],
  ])("YouTube: %s", (input, extra) => {
    expect(normalizeVideoUrl(input)).toEqual({
      provider: "youtube",
      id: ID,
      src: `https://www.youtube.com/embed/${ID}?rel=0${extra}`,
    });
  });

  it.each([
    ["https://vimeo.com/76979871", "https://player.vimeo.com/video/76979871"],
    ["https://vimeo.com/76979871/8272103f6e", "https://player.vimeo.com/video/76979871?h=8272103f6e"],
    [
      "https://player.vimeo.com/video/76979871?h=8272103f6e&badge=0",
      "https://player.vimeo.com/video/76979871?h=8272103f6e",
    ],
    ["https://vimeo.com/channels/staffpicks/76979871", "https://player.vimeo.com/video/76979871"],
    [
      '<iframe src="https://player.vimeo.com/video/76979871?autoplay=1&amp;muted=1" frameborder="0"></iframe>',
      "https://player.vimeo.com/video/76979871?autoplay=1&muted=1",
    ],
  ])("Vimeo: %s", (input, src) => {
    expect(normalizeVideoUrl(input)).toEqual({ provider: "vimeo", id: "76979871", src });
  });

  it("Panda, outros endereços e textos inválidos", () => {
    const panda = "https://player-vz-7b6cf9e4-8bf.tv.pandavideo.com.br/embed/?v=0d0a3d3e-1111-2222-3333-444455556666";
    expect(normalizeVideoUrl(panda)).toEqual({ provider: "panda", src: panda });
    expect(
      normalizeVideoUrl(
        `<div style="position:relative"><iframe id="panda-x" src="${panda}" allowfullscreen></iframe></div>`,
      ),
    ).toEqual({
      provider: "panda",
      src: panda,
    });
    expect(normalizeVideoUrl("http://exemplo.com/video")).toEqual({
      provider: "other",
      src: "https://exemplo.com/video",
    });
    expect(normalizeVideoUrl("")).toBeNull();
    expect(normalizeVideoUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeVideoUrl("meu vídeo")).toBeNull();
    expect(youtubeId("https://www.youtube.com/watch?v=curto")).toBeNull();
  });

  it("liga e desliga o 'tocar sozinho' (sempre sem som)", () => {
    const yt = withAutoplay("https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0", true);
    expect(yt).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0&autoplay=1&mute=1");
    expect(hasAutoplay(yt)).toBe(true);
    expect(withAutoplay(yt, false)).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0");
    expect(withAutoplay("https://player.vimeo.com/video/1", true)).toBe(
      "https://player.vimeo.com/video/1?autoplay=1&muted=1",
    );
    expect(withAutoplay("não é url", true)).toBe("não é url");
  });

  it("lê o código do VTurb (novo, antigo ou só o ID)", () => {
    const account = "8e0d41ae-6a4d-4f4b-9c56-0e5b1d8c5a11";
    const player = "68a1f2c3d4e5f60718293a4b";
    const v4 = `<vturb-smartplayer id="vid-${player}" style="display: block; margin: 0 auto; width: 100%;"></vturb-smartplayer> <script type="text/javascript"> var s=document.createElement("script"); s.src="https://scripts.converteai.net/${account}/players/${player}/v4/player.js", s.async=!0,document.head.appendChild(s); </script>`;
    expect(parseVturbCode(v4)).toEqual({ account, player, version: "v4" });
    const v3 = `<div id="vid_${player}" style="position:relative;width:100%;padding: 56.25% 0 0;"></div><script type="text/javascript" id="scr_${player}"> var s=document.createElement("script"); s.src="https://scripts.converteai.net/${account}/players/${player}/player.js", s.async=!0,document.head.appendChild(s); </script>`;
    expect(parseVturbCode(v3)).toEqual({ account, player, version: "v3" });
    expect(parseVturbCode(player)).toEqual({ player });
    expect(parseVturbCode(`<vturb-smartplayer id="vid-${player}"></vturb-smartplayer>`)).toEqual({
      player,
      version: "v4",
    });
    expect(parseVturbCode("oi")).toBeNull();
  });
});

describe("biblioteca de blocos", () => {
  const walk = (def: Def, visit: (d: Def) => void) => {
    visit(def);
    if (Array.isArray(def.components)) for (const c of def.components) if (typeof c !== "string") walk(c, visit);
  };

  it("tem todos os blocos pedidos, com ids únicos e categorias válidas", () => {
    const ids = ALL_BLOCKS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const b of ALL_BLOCKS) {
      expect(Object.keys(BLOCK_CATEGORIES)).toContain(b.category);
      expect(b.label.trim()).not.toBe("");
      expect(b.media).toMatch(/^<svg/);
    }
    for (const cat of Object.keys(BLOCK_CATEGORIES)) expect(ALL_BLOCKS.some((b) => b.category === cat)).toBe(true);
    for (const id of [
      "hero",
      "secao-colorida",
      "container",
      "colunas-2",
      "colunas-3",
      "cartao",
      "cta-grande",
      "cta-checkout",
      "contador",
      "escassez",
      "notificacao-compra",
      "tabela-precos",
      "garantia",
      "whatsapp-flutuante",
      "whatsapp-botao",
      "popup-saida",
      "video-youtube",
      "video-vimeo",
      "video-vturb",
      "video-panda",
      "video-arquivo",
      "depoimentos",
      "numeros",
      "logos",
      "antes-depois",
      "form-captura",
      "rodape",
      "lista-icones",
      "icone",
      "citacao",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("definições são dados puros (vão para o projeto sem perder nada)", () => {
    for (const b of ALL_BLOCKS) {
      expect(JSON.parse(JSON.stringify(b.content))).toEqual(b.content);
    }
  });

  it("widgets guardam as opções em data-os-* e classes começam com os-", () => {
    const widgets = new Map<string, string>();
    for (const b of ALL_BLOCKS) {
      walk(b.content as Def, (d) => {
        const w = d.attributes?.["data-os-widget"];
        if (typeof w === "string") widgets.set(w, String(d.type));
        for (const cls of d.classes ?? []) expect(cls).toMatch(/^os-/);
      });
    }
    expect(Object.fromEntries(widgets)).toEqual({
      countdown: "os-countdown",
      scarcity: "os-scarcity",
      "sales-notification": "os-sales-notification",
      "exit-popup": "os-exit-popup",
      "lead-form": "os-lead-form",
      whatsapp: "os-whatsapp",
      vturb: "os-vturb-player",
    });
  });

  it("popup e notificação começam escondidos na página (hidden)", () => {
    for (const id of ["popup-saida", "notificacao-compra"]) {
      const block = ALL_BLOCKS.find((b) => b.id === id);
      expect((block?.content as Def).attributes?.hidden).toBe(true);
    }
  });
});

describe("script das páginas", () => {
  it("a parte dos widgets continua pequena (meta: menos de 13,5 KB minificado)", () => {
    const entry = [
      'import { initCountdowns } from "./src/runtime/widgets/countdown";',
      'import { initExitPopups } from "./src/runtime/widgets/exit-popup";',
      'import { initLeadForms } from "./src/runtime/widgets/lead-form";',
      'import { initSalesNotifications } from "./src/runtime/widgets/sales-notification";',
      'import { initScarcity } from "./src/runtime/widgets/scarcity";',
      'import { addCss } from "./src/runtime/widgets/util";',
      'import { initVturb } from "./src/runtime/widgets/vturb";',
      "addCss();",
      "for (const f of [initCountdowns, initScarcity, initSalesNotifications, initExitPopups, initLeadForms, initVturb]) f();",
    ].join("\n");
    const widgets = buildSync({
      stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts" },
      bundle: true,
      minify: true,
      format: "iife",
      target: ["es2018", "safari13"],
      write: false,
    }).outputFiles[0].text;
    // 12 KB até a revisão da Fase 3 (hoje ~12,9 KB): popup/aviso fora de seções com
    // delay, aviso acima do WhatsApp, navegação segura e "nada foi enviado" no formulário.
    expect(Buffer.byteLength(widgets, "utf8")).toBeLessThan(13_500);
    // O script inteiro (widgets + botões com data-os-href + delay de VSL) compila.
    expect(runtimeScript()).toContain("os-widgets-css");
  });
});
