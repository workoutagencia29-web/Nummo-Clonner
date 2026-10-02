import { describe, expect, it } from "vitest";
import { safeReturnPath } from "@/lib/safe-return";

describe("safeReturnPath (voltar do login)", () => {
  it("aceita caminhos internos", () => {
    expect(safeReturnPath("/ofertas")).toBe("/ofertas");
    expect(safeReturnPath("/ofertas?q=promo%20x&status=LIVE")).toBe("/ofertas?q=promo%20x&status=LIVE");
    expect(safeReturnPath("/ofertas/abc#paginas")).toBe("/ofertas/abc#paginas");
  });

  it("recusa tudo que leva para fora do Offer Studio", () => {
    for (const evil of [
      "//example.com",
      "/\\example.com",
      "/\\/example.com",
      "/\texample.com",
      "/\t/example.com",
      "/\n/example.com",
      "https://example.com",
      "javascript:alert(1)",
      "example.com",
      "",
    ]) {
      expect(safeReturnPath(evil), JSON.stringify(evil)).toBe("/ofertas");
    }
    expect(safeReturnPath(undefined)).toBe("/ofertas");
    expect(safeReturnPath(["/ofertas"])).toBe("/ofertas");
  });
});
