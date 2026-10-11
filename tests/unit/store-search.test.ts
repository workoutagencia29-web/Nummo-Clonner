/**
 * Busca da loja (src/lib/store-search.ts): o que a pessoa digita no cabeçalho
 * de loja comparado com o nome dos produtos — sem acentos, sem pontuação, cada
 * palavra em qualquer ordem, plural simples — e o texto da linha de resultados.
 */
import { describe, expect, it } from "vitest";
import { matchesSearch, normalizeSearch, SEARCH_TEXTS, searchMessage } from "@/lib/store-search";

describe("normalizeSearch", () => {
  it("minúsculas, sem acentos e sem pontuação, com um espaço entre as palavras", () => {
    expect(normalizeSearch("  Caixa de Som PORTÁTIL à prova d'água!  ")).toBe("caixa de som portatil a prova d agua");
    expect(normalizeSearch("Coração · Ação, ÇÃO; ñandú")).toBe("coracao acao cao nandu");
    expect(normalizeSearch("Air fryer 4 litros (3,5L)")).toBe("air fryer 4 litros 3 5l");
    expect(normalizeSearch("")).toBe("");
  });
});

describe("matchesSearch", () => {
  const name = "Fone de ouvido Bluetooth sem fio";

  it("cada palavra precisa aparecer no nome, em qualquer ordem, sem ligar para acento e maiúscula", () => {
    expect(matchesSearch(name, "fone")).toBe(true);
    expect(matchesSearch(name, "BLUETOOTH fone")).toBe(true);
    expect(matchesSearch(name, "fone com fio")).toBe(false);
    expect(matchesSearch("Luminária LED de mesa", "luminaria")).toBe(true);
    expect(matchesSearch("Luminaria LED de mesa", "luminária")).toBe(true);
    // Pedaço de palavra também vale ("blue" em "Bluetooth").
    expect(matchesSearch(name, "blue")).toBe(true);
  });

  it("plural simples: a palavra vale também sem o “s”/“es” do fim", () => {
    expect(matchesSearch(name, "fones")).toBe(true);
    expect(matchesSearch("Kit 3 panelas antiaderentes", "panela")).toBe(true);
    expect(matchesSearch("Luminária LED de mesa", "luminárias")).toBe(true);
    expect(matchesSearch("Tênis de corrida leve", "tenis")).toBe(true);
    expect(matchesSearch("Smartwatch com monitor cardíaco", "monitores")).toBe(true);
    expect(matchesSearch("Mochila para notebook", "notebooks")).toBe(true);
    // Palavra curta não perde letra (senão "as" viraria "a" e acharia tudo).
    expect(matchesSearch("Tênis", "es")).toBe(false);
  });

  it("busca vazia ou só pontuação não acha nada", () => {
    expect(matchesSearch(name, "")).toBe(false);
    expect(matchesSearch(name, "  ?! ")).toBe(false);
  });
});

describe("searchMessage", () => {
  it("troca {busca} pelo que foi buscado; sem {busca}, a busca vai no fim entre aspas", () => {
    expect(searchMessage(SEARCH_TEXTS.found, "fone")).toBe("Resultados para “fone”");
    expect(searchMessage("Resultados de {busca} ({busca})", "x")).toBe("Resultados de x (x)");
    expect(searchMessage("Resultados", "fone")).toBe("Resultados “fone”");
  });
});
