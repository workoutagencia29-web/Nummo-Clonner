/**
 * Contas das versões A/B (sem banco): letras, pastas do ZIP, divisão por igual,
 * redistribuição proporcional e o ajuste automático do editor de percentuais.
 */
import { describe, expect, it } from "vitest";
import {
  evenSplit,
  MAX_VARIANTS,
  markTouched,
  nextVariantName,
  proportionalSplit,
  rebalance,
  VARIANT_NAMES,
  variantFolder,
  variantTitle,
  weightsProblem,
  weightsTotal,
} from "@/components/offers/variants/weights";

describe("letras e pastas", () => {
  it("usa as letras A a E, no máximo 5 versões", () => {
    expect(VARIANT_NAMES).toEqual(["A", "B", "C", "D", "E"]);
    expect(MAX_VARIANTS).toBe(5);
  });

  it("pasta no ZIP: oferta-<letra minúscula>", () => {
    expect(variantFolder("A")).toBe("oferta-a");
    expect(variantFolder("E")).toBe("oferta-e");
  });

  it("próxima letra: a seguinte à maior em uso (não reaproveita logo a de uma versão excluída)", () => {
    expect(nextVariantName([])).toBe("A");
    expect(nextVariantName(["A"])).toBe("B");
    // B foi excluída: a nova é D (a pasta oferta-b/ e o histórico dela são da versão antiga).
    expect(nextVariantName(["A", "C"])).toBe("D");
    // Depois do E, volta para a primeira livre.
    expect(nextVariantName(["A", "C", "D", "E"])).toBe("B");
    expect(nextVariantName(["B", "C", "D", "E"])).toBe("A");
    expect(nextVariantName(["A", "B", "C", "D", "E"])).toBeNull();
  });

  it("título com e sem nome", () => {
    expect(variantTitle({ name: "B" })).toBe("Versão B");
    expect(variantTitle({ name: "B", label: null })).toBe("Versão B");
    expect(variantTitle({ name: "B", label: "Headline nova" })).toBe("Versão B · Headline nova");
  });
});

describe("evenSplit", () => {
  it("divide 100 por igual, com o resto nas primeiras", () => {
    expect(evenSplit(1)).toEqual([100]);
    expect(evenSplit(2)).toEqual([50, 50]);
    expect(evenSplit(3)).toEqual([34, 33, 33]);
    expect(evenSplit(4)).toEqual([25, 25, 25, 25]);
    expect(evenSplit(5)).toEqual([20, 20, 20, 20, 20]);
    expect(evenSplit(6)).toEqual([17, 17, 17, 17, 16, 16]);
    expect(evenSplit(0)).toEqual([]);
  });
});

describe("proportionalSplit", () => {
  it("mantém a proporção entre as versões que ficam", () => {
    // 50/30/20, sai a de 50 → 30:20 vira 60/40.
    expect(proportionalSplit([30, 20])).toEqual([60, 40]);
    // 70/30, sai a de 30 → a que fica leva tudo.
    expect(proportionalSplit([70])).toEqual([100]);
    // 34/33/33, sai a primeira → 50/50.
    expect(proportionalSplit([33, 33])).toEqual([50, 50]);
  });

  it("arredonda pelo maior resto e sempre soma 100", () => {
    const result = proportionalSplit([33, 33, 33]);
    expect(result).toEqual([34, 33, 33]);
    expect(weightsTotal(proportionalSplit([1, 1, 1, 1, 1, 1, 1]))).toBe(100);
    expect(proportionalSplit([10, 0, 0])).toEqual([100, 0, 0]);
  });

  it("pesos todos zerados → por igual", () => {
    expect(proportionalSplit([0, 0])).toEqual([50, 50]);
    expect(proportionalSplit([0, 0, 0])).toEqual([34, 33, 33]);
    expect(proportionalSplit([])).toEqual([]);
  });
});

describe("weightsProblem", () => {
  it("aceita inteiros de 0 a 100 que somam 100", () => {
    expect(weightsProblem([100])).toBeNull();
    expect(weightsProblem([70, 30])).toBeNull();
    expect(weightsProblem([100, 0])).toBeNull();
    expect(weightsProblem([20, 20, 20, 20, 20])).toBeNull();
  });

  it("explica em português o que está errado", () => {
    expect(weightsProblem([60, 30])).toBe("Os percentuais precisam somar 100% (agora somam 90%).");
    expect(weightsProblem([80, 30])).toBe("Os percentuais precisam somar 100% (agora somam 110%).");
    expect(weightsProblem([50.5, 49.5])).toBe("Use números inteiros de 0 a 100 em cada versão.");
    expect(weightsProblem([110, -10])).toBe("Use números inteiros de 0 a 100 em cada versão.");
    expect(weightsProblem([])).toBe("Nenhuma versão para dividir o tráfego.");
  });
});

describe("rebalance (editor de percentuais)", () => {
  it("com duas versões, a outra vira o que falta para 100", () => {
    expect(rebalance([50, 50], 0, 70)).toEqual([70, 30]);
    expect(rebalance([70, 30], 1, 10)).toEqual([90, 10]);
    expect(rebalance([50, 50], 1, 100)).toEqual([0, 100]);
    expect(rebalance([50, 50], 0, 0)).toEqual([0, 100]);
  });

  it("valores fora de 0–100 ou quebrados são corrigidos", () => {
    expect(rebalance([50, 50], 0, 150)).toEqual([100, 0]);
    expect(rebalance([50, 50], 0, -5)).toEqual([0, 100]);
    expect(rebalance([50, 50], 0, 33.6)).toEqual([34, 66]);
    expect(rebalance([50, 50], 0, Number.NaN)).toEqual([0, 100]);
  });

  it("as versões não mexidas absorvem a diferença por igual; as já escolhidas ficam", () => {
    let touched = markTouched([], 0);
    let w = rebalance([34, 33, 33], 0, 50, touched);
    expect(w).toEqual([50, 25, 25]);
    touched = markTouched(touched, 1);
    w = rebalance(w, 1, 30, touched);
    // A (50%) foi escolhida antes: só C (não mexida) ajusta.
    expect(w).toEqual([50, 30, 20]);
  });

  it("sem versões livres, a mexida há mais tempo absorve primeiro", () => {
    let touched: number[] = [];
    let w = [34, 33, 33];
    for (const [i, v] of [
      [0, 40],
      [1, 40],
      [2, 10],
    ] as const) {
      touched = markTouched(touched, i);
      w = rebalance(w, i, v, touched);
    }
    // Ao mudar C para 10: A e B já escolhidas; A (mais antiga) absorve os +10.
    expect(w).toEqual([50, 40, 10]);
  });

  it("quando a mais antiga não comporta, a seguinte completa", () => {
    // A=90 (mexida antes), B=10 (mexida depois); C vai de 0 para 100: A zera e B também.
    const w = rebalance([90, 10, 0], 2, 100, [0, 1]);
    expect(w).toEqual([0, 0, 100]);
  });

  it("resto de divisão vai para as primeiras livres", () => {
    expect(rebalance([25, 25, 25, 25], 0, 0)).toEqual([0, 34, 33, 33]);
    expect(rebalance([20, 20, 20, 20, 20], 4, 1)).toEqual([25, 25, 25, 24, 1]);
  });

  it("uma versão só: sempre 100", () => {
    expect(rebalance([100], 0, 40)).toEqual([100]);
  });

  it("índice inválido não muda nada (só normaliza)", () => {
    expect(rebalance([70, 30], 5, 10)).toEqual([70, 30]);
  });

  it("qualquer sequência de edições mantém a soma 100 e cada valor em 0–100", () => {
    // Gerador determinístico (sem Math.random: o teste falha sempre igual).
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let round = 0; round < 300; round++) {
      const n = 2 + Math.floor(rand() * 4);
      let w = evenSplit(n);
      let touched: number[] = [];
      for (let step = 0; step < 12; step++) {
        const i = Math.floor(rand() * n);
        const v = Math.floor(rand() * 121) - 10;
        touched = markTouched(touched, i);
        w = rebalance(w, i, v, touched);
        expect(weightsTotal(w)).toBe(100);
        expect(w.every((x) => Number.isInteger(x) && x >= 0 && x <= 100)).toBe(true);
        expect(w[i]).toBe(Math.min(100, Math.max(0, v)));
      }
    }
  });
});

describe("markTouched", () => {
  it("passa o índice para o fim sem repetir", () => {
    expect(markTouched([], 1)).toEqual([1]);
    expect(markTouched([0, 1, 2], 1)).toEqual([0, 2, 1]);
    expect(markTouched([0], 0)).toEqual([0]);
  });
});
