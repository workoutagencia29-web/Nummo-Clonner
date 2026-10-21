/**
 * Funil de upsell (src/lib/upsell, puro): roteamento aceitar/recusar, contagem,
 * validação e remapeamento de páginas.
 */
import { describe, expect, it } from "vitest";
import {
  downsellCount,
  parseUpsellFlow,
  remapUpsellPages,
  type UpsellFlow,
  upsellCount,
  upsellProblems,
  upsellRouting,
} from "@/lib/upsell";

const flow = (over: Partial<UpsellFlow> = {}): UpsellFlow => ({
  startLinkKeys: ["principal"],
  thankYouPageId: "obrigado",
  steps: [],
  ...over,
});

describe("upsellRouting", () => {
  it("sequência linear: cada upsell vai para o próximo e o último para o obrigado", () => {
    const f = flow({
      steps: [
        { id: "u1", kind: "UPSELL", pageId: "pu1", linkKey: "l1" },
        { id: "u2", kind: "UPSELL", pageId: "pu2", linkKey: "l2" },
      ],
    });
    const r = upsellRouting(f);
    expect(r.startPageId).toBe("pu1"); // o obrigado do produto principal é a 1ª etapa
    expect(r.steps).toEqual([
      { stepId: "u1", acceptPageId: "pu2", declinePageId: "pu2" },
      { stepId: "u2", acceptPageId: "obrigado", declinePageId: "obrigado" },
    ]);
  });

  it("downsell ATRELADO: recusar o upsell vai para o downsell; aceitar/recusar o downsell segue para o próximo", () => {
    const f = flow({
      steps: [
        { id: "u1", kind: "UPSELL", pageId: "pu1", linkKey: "l1" },
        { id: "d1", kind: "DOWNSELL", pageId: "pd1", linkKey: "ld1", attachedTo: "u1" },
        { id: "u2", kind: "UPSELL", pageId: "pu2", linkKey: "l2" },
      ],
    });
    const r = upsellRouting(f);
    // Caminho principal pula o downsell atrelado: u1 → u2.
    expect(r.startPageId).toBe("pu1");
    expect(r.steps).toContainEqual({ stepId: "u1", acceptPageId: "pu2", declinePageId: "pd1" });
    expect(r.steps).toContainEqual({ stepId: "d1", acceptPageId: "pu2", declinePageId: "pu2" });
    expect(r.steps).toContainEqual({ stepId: "u2", acceptPageId: "obrigado", declinePageId: "obrigado" });
  });

  it("downsell SOLTO: etapa no caminho, aceitar/recusar seguem para o próximo", () => {
    const f = flow({
      steps: [
        { id: "u1", kind: "UPSELL", pageId: "pu1", linkKey: "l1" },
        { id: "d1", kind: "DOWNSELL", pageId: "pd1", linkKey: "ld1" }, // sem attachedTo = solto
      ],
    });
    const r = upsellRouting(f);
    expect(r.steps).toEqual([
      { stepId: "u1", acceptPageId: "pd1", declinePageId: "pd1" },
      { stepId: "d1", acceptPageId: "obrigado", declinePageId: "obrigado" },
    ]);
  });
});

describe("contagem e validação", () => {
  it("conta upsells e downsells", () => {
    const f = flow({
      steps: [
        { id: "u1", kind: "UPSELL", pageId: "a", linkKey: "l1" },
        { id: "u2", kind: "UPSELL", pageId: "b", linkKey: "l2" },
        { id: "d1", kind: "DOWNSELL", pageId: "c", linkKey: "l3", attachedTo: "u1" },
      ],
    });
    expect(upsellCount(f)).toBe(2);
    expect(downsellCount(f)).toBe(1);
  });

  it("flow vazio não tem problema (oferta sem upsell)", () => {
    expect(upsellProblems(flow())).toEqual([]);
  });

  it("aponta etapa sem página/produto, página repetida e downsell órfão", () => {
    const f = flow({
      steps: [
        { id: "u1", kind: "UPSELL", pageId: "p", linkKey: null },
        { id: "u2", kind: "UPSELL", pageId: "p", linkKey: "l2" }, // mesma página
        { id: "d1", kind: "DOWNSELL", pageId: "pd", linkKey: "ld", attachedTo: "naoexiste" },
      ],
    });
    const msgs = upsellProblems(f).map((p) => p.message);
    expect(msgs).toContain("Escolha o produto (checkout) do upsell.");
    expect(msgs).toContain("Duas etapas usam a mesma página.");
    expect(msgs).toContain("O upsell deste downsell não existe mais.");
  });

  it("limita a 3 upsells e 2 downsells", () => {
    const f = flow({
      steps: [
        { id: "u1", kind: "UPSELL", pageId: "1", linkKey: "l1" },
        { id: "u2", kind: "UPSELL", pageId: "2", linkKey: "l2" },
        { id: "u3", kind: "UPSELL", pageId: "3", linkKey: "l3" },
        { id: "u4", kind: "UPSELL", pageId: "4", linkKey: "l4" },
      ],
    });
    expect(upsellProblems(f).map((p) => p.message)).toContain("No máximo 3 upsells.");
  });
});

describe("parse e remap", () => {
  it("parseUpsellFlow descarta item estragado e mantém o resto", () => {
    const parsed = parseUpsellFlow({
      startLinkKey: "principal",
      thankYouPageId: "ob",
      steps: [
        { id: "u1", kind: "UPSELL", pageId: "p", linkKey: "l" },
        { kind: "UPSELL" }, // sem id: some
        { id: "x", kind: "OUTRO" }, // kind inválido: some
      ],
    });
    expect(parsed.startLinkKeys).toEqual(["principal"]); // formato antigo (uma chave) vira lista de um
    expect(parsed.steps).toHaveLength(1);
    expect(parsed.steps[0]).toMatchObject({ id: "u1", kind: "UPSELL", pageId: "p", linkKey: "l" });
  });

  it("parseUpsellFlow lê a lista nova de produtos que iniciam (sem repetir)", () => {
    const parsed = parseUpsellFlow({ startLinkKeys: ["a", "b", "a", ""], steps: [] });
    expect(parsed.startLinkKeys).toEqual(["a", "b"]);
  });

  it("remapUpsellPages troca os pageId (duplicar oferta); página sem par vira null", () => {
    const f = flow({
      thankYouPageId: "ob",
      steps: [{ id: "u1", kind: "UPSELL", pageId: "pu1", linkKey: "l1" }],
    });
    const out = remapUpsellPages(f, new Map([["pu1", "novo1"]]));
    expect(out.thankYouPageId).toBeNull(); // "ob" não está no mapa
    expect(out.steps[0].pageId).toBe("novo1");
    expect(out.startLinkKeys).toEqual(["principal"]); // linkKey não muda
  });
});
