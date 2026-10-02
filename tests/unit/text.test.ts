import { describe, expect, it } from "vitest";
import {
  copyName,
  displayUrl,
  nameKey,
  normalizeText,
  RESERVED_SLUGS,
  SLUG_MAX,
  SLUG_PATTERN,
  slugify,
  slugProblem,
  splitCopySuffix,
  uniqueSlug,
} from "@/lib/text";

describe("normalizeText / nameKey", () => {
  it("remove acentos, baixa a caixa e apara as pontas", () => {
    expect(normalizeText("  Página Ação  ")).toBe("pagina acao");
    expect(normalizeText("ÇÃO Ñandú Über")).toBe("cao nandu uber");
  });

  it("nameKey também junta espaços repetidos (incluindo tab e quebra de linha)", () => {
    expect(nameKey("  Página   de\tAção\n Rápida ")).toBe("pagina de acao rapida");
    expect(nameKey("SAÚDE")).toBe(nameKey("saude"));
    expect(nameKey("Finanças")).toBe("financas");
  });
});

describe("slugify", () => {
  it("converte acentos e símbolos em hífens", () => {
    expect(slugify("Página de Obrigado!")).toBe("pagina-de-obrigado");
    expect(slugify("  Ação & Reação — 100%  ")).toBe("acao-reacao-100");
    expect(slugify("Oferta 2024: Black_Friday")).toBe("oferta-2024-black-friday");
    expect(slugify("Çãõ ÉÍÓ ü ñ")).toBe("cao-eio-u-n");
  });

  it("devolve vazio quando não sobra nenhum caractere válido", () => {
    expect(slugify("---")).toBe("");
    expect(slugify("!!! ???")).toBe("");
    expect(slugify("")).toBe("");
  });

  it("limita a 80 caracteres", () => {
    expect(slugify("a".repeat(100))).toBe("a".repeat(SLUG_MAX));
    expect(slugify("Palavra ".repeat(30)).length).toBeLessThanOrEqual(SLUG_MAX);
  });

  it("não deixa hífen sobrando no fim depois do corte", () => {
    // O corte em 80 cairia logo depois do hífen de "… b".
    const slug = slugify(`${"a".repeat(79)} b`);
    expect(slug).toBe("a".repeat(79));
    expect(slugProblem(slug)).toBeNull();
  });

  it("sempre gera um slug aceito pelo formato do banco", () => {
    for (const name of ["Página de Vendas", "VSL #1 (versão nova)", "Upsell – 2ª oferta", `${"x-".repeat(60)}fim`]) {
      const slug = slugify(name);
      expect(slug).toMatch(SLUG_PATTERN);
      expect(slug.length).toBeLessThanOrEqual(SLUG_MAX);
    }
  });
});

describe("slugProblem", () => {
  it("aceita slugs válidos", () => {
    expect(slugProblem("pagina-de-vendas")).toBeNull();
    expect(slugProblem("vsl2")).toBeNull();
    expect(slugProblem("a".repeat(SLUG_MAX))).toBeNull();
  });

  it("pede o endereço quando está vazio", () => {
    expect(slugProblem("")).toBe("Informe o endereço da página.");
  });

  it("recusa endereço longo demais", () => {
    expect(slugProblem("a".repeat(SLUG_MAX + 1))).toBe("O endereço pode ter no máximo 80 caracteres.");
  });

  it.each([
    "Abc",
    "pagina_vendas",
    "página",
    "a--b",
    "-a",
    "a-",
    "com espaço",
    "a/b",
    "_os",
  ])("recusa caracteres inválidos em %j", (slug) => {
    expect(slugProblem(slug)).toBe("Use só letras minúsculas, números e hífen (ex.: pagina-de-vendas).");
  });

  it("recusa endereços reservados pelo sistema", () => {
    for (const slug of RESERVED_SLUGS) {
      if (!SLUG_PATTERN.test(slug)) continue; // "_os" já cai na regra de caracteres
      expect(slugProblem(slug)).toBe(`"${slug}" é reservado pelo sistema. Escolha outro endereço.`);
    }
    expect(slugProblem("assets")).toBe('"assets" é reservado pelo sistema. Escolha outro endereço.');
  });
});

describe("uniqueSlug", () => {
  it("usa o slug do nome quando está livre", () => {
    expect(uniqueSlug("Página", [])).toBe("pagina");
    expect(uniqueSlug("Obrigado", ["pagina"])).toBe("obrigado");
  });

  it("acrescenta -2, -3… quando já existe", () => {
    expect(uniqueSlug("Página", ["pagina"])).toBe("pagina-2");
    expect(uniqueSlug("Página", ["pagina", "pagina-2"])).toBe("pagina-3");
    expect(uniqueSlug("Página", new Set(["pagina", "pagina-2", "pagina-3"]))).toBe("pagina-4");
  });

  it('usa "pagina" quando o nome não gera slug', () => {
    expect(uniqueSlug("", [])).toBe("pagina");
    expect(uniqueSlug("!!!", ["pagina"])).toBe("pagina-2");
  });

  it("nunca devolve um endereço reservado", () => {
    expect(uniqueSlug("assets", [])).toBe("assets-pagina");
    expect(uniqueSlug("API", ["api-pagina"])).toBe("api-pagina-2");
    expect(slugProblem(uniqueSlug("Index", []))).toBeNull();
  });

  it("respeita o limite de 80 caracteres ao acrescentar o sufixo", () => {
    const long = "a".repeat(100);
    const result = uniqueSlug(long, ["a".repeat(SLUG_MAX)]);
    expect(result).toBe(`${"a".repeat(SLUG_MAX - 2)}-2`);
    expect(result.length).toBe(SLUG_MAX);
  });

  it("não gera hífen duplo quando o corte para o sufixo cai logo depois de um hífen", () => {
    const base = `${"a".repeat(77)}-bc`; // 80 caracteres; cortar em 78 deixa "…a-"
    const result = uniqueSlug(base, [base]);
    expect(slugProblem(result)).toBeNull();
    expect(result).toBe(`${"a".repeat(77)}-2`);
  });
});

describe("splitCopySuffix", () => {
  it("separa o número da cópia para o card mostrar mesmo com o nome cortado", () => {
    expect(splitCopySuffix("Cópia de Confeitaria Lucrativa (18)")).toEqual({
      base: "Cópia de Confeitaria Lucrativa",
      suffix: "(18)",
    });
    expect(splitCopySuffix("Oferta X")).toEqual({ base: "Oferta X", suffix: null });
    expect(splitCopySuffix("Oferta (beta)")).toEqual({ base: "Oferta (beta)", suffix: null });
    expect(splitCopySuffix("(2)")).toEqual({ base: "(2)", suffix: null });
  });
});

describe("copyName", () => {
  it('prefixa "Cópia de"', () => {
    expect(copyName("Oferta X", [])).toBe("Cópia de Oferta X");
    expect(copyName("Oferta X", ["Oferta X"])).toBe("Cópia de Oferta X");
  });

  it("acrescenta (2), (3)… quando o nome já existe", () => {
    expect(copyName("Oferta X", ["Cópia de Oferta X"])).toBe("Cópia de Oferta X (2)");
    expect(copyName("Oferta X", ["Cópia de Oferta X", "Cópia de Oferta X (2)"])).toBe("Cópia de Oferta X (3)");
  });

  it("compara sem diferenciar maiúsculas nem acentos", () => {
    expect(copyName("Oferta X", ["copia de oferta x"])).toBe("Cópia de Oferta X (2)");
    expect(copyName("Oferta X", ["COPIA  DE  OFERTA  X", "cópia de oferta x (2)"])).toBe("Cópia de Oferta X (3)");
  });

  it("limita o nome base a 120 caracteres", () => {
    expect(copyName("a".repeat(200), [])).toHaveLength(120);
  });

  it("nunca passa de 120 caracteres, mesmo com o sufixo (n)", () => {
    const first = copyName("a".repeat(200), []);
    const second = copyName("a".repeat(200), [first]);
    expect(second.endsWith(" (2)")).toBe(true);
    expect(second.length).toBeLessThanOrEqual(120);
  });
});

describe("displayUrl", () => {
  it("mostra domínio sem www e caminho sem barra final", () => {
    expect(displayUrl("https://www.exemplo.com.br/oferta/")).toBe("exemplo.com.br/oferta");
    expect(displayUrl("https://exemplo.com/")).toBe("exemplo.com");
    expect(displayUrl("http://sub.exemplo.com/a/b?utm_source=x#topo")).toBe("sub.exemplo.com/a/b");
  });

  it("devolve null quando não há URL", () => {
    expect(displayUrl(null)).toBeNull();
    expect(displayUrl(undefined)).toBeNull();
    expect(displayUrl("")).toBeNull();
  });

  it("devolve o texto original quando não é uma URL válida", () => {
    expect(displayUrl("não é url")).toBe("não é url");
  });
});
