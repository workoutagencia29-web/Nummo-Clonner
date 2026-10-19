/**
 * Regra pura do "Esconder sobreposições" (src/editor/grapes/overlay-hider):
 * decide se um elemento flutua por cima da página (e atrapalha a edição).
 */
import { describe, expect, it } from "vitest";
import { isCoveringOverlay } from "@/editor/grapes/overlay-hider";

const VP = { width: 1000, height: 800 };

describe("isCoveringOverlay", () => {
  it("fixed que cobre o conteúdo some (pop-up, cookies no rodapé, modal, botão flutuante)", () => {
    // Modal/pop-up fixo de tela cheia.
    expect(isCoveringOverlay({ position: "fixed", zIndex: "9999", width: 1000, height: 800, top: 0 }, VP)).toBe(true);
    // Barra de cookies colada no RODAPÉ (não é barra do topo).
    expect(isCoveringOverlay({ position: "fixed", zIndex: "40", width: 1000, height: 60, top: 740 }, VP)).toBe(true);
    // Botão flutuante (WhatsApp) no canto.
    expect(isCoveringOverlay({ position: "fixed", zIndex: "40", width: 60, height: 60, top: 700 }, VP)).toBe(true);
  });

  it("barra colada no topo (navbar, cronômetro) FICA — inclusive uma 2ª empilhada", () => {
    // Navbar fixa no topo: fina e larga.
    expect(isCoveringOverlay({ position: "fixed", zIndex: "1000", width: 1000, height: 64, top: 0 }, VP)).toBe(false);
    // Cronômetro fixo logo abaixo da navbar (empilhado).
    expect(isCoveringOverlay({ position: "fixed", zIndex: "1000", width: 1000, height: 48, top: 64 }, VP)).toBe(false);
  });

  it("sticky nunca some (navbar comum de página clonada)", () => {
    expect(isCoveringOverlay({ position: "sticky", zIndex: "999", width: 1000, height: 70, top: 0 }, VP)).toBe(false);
    expect(isCoveringOverlay({ position: "sticky", zIndex: "999", width: 1000, height: 70, top: 400 }, VP)).toBe(false);
  });

  it("absolute só quando é um modal GRANDE com z-index alto", () => {
    // Modal de verdade: cobre boa parte da tela, z alto.
    expect(isCoveringOverlay({ position: "absolute", zIndex: "9999", width: 700, height: 500, top: 100 }, VP)).toBe(
      true,
    );
    // Enfeite pequeno posicionado de forma absoluta (selo, badge): não some.
    expect(isCoveringOverlay({ position: "absolute", zIndex: "9999", width: 120, height: 40, top: 4 }, VP)).toBe(false);
    // Grande, mas sem z-index: não é modal (ex.: seção de layout) — não some.
    expect(isCoveringOverlay({ position: "absolute", zIndex: "auto", width: 800, height: 600, top: 0 }, VP)).toBe(
      false,
    );
    // Grande e z baixo: idem.
    expect(isCoveringOverlay({ position: "absolute", zIndex: "2", width: 800, height: 600, top: 0 }, VP)).toBe(false);
  });

  it("conteúdo normal (static/relative) nunca é sobreposição", () => {
    expect(isCoveringOverlay({ position: "static", zIndex: "auto", width: 1000, height: 2000, top: 0 }, VP)).toBe(
      false,
    );
    expect(isCoveringOverlay({ position: "relative", zIndex: "999", width: 1000, height: 400, top: 0 }, VP)).toBe(
      false,
    );
  });
});
