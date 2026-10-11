/**
 * Páginas publicadas em espanhol/inglês e números de fora do Brasil — partes
 * puras: número do WhatsApp com código de país, validação do telefone do
 * formulário de captura (com e sem a marca de fora do Brasil), mensagens no
 * idioma da página, o JSON #os-textos que o render embute (só nas páginas em
 * espanhol/inglês ou de oferta fora do real) e o script das páginas sem as
 * traduções dentro.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { phoneDisplay, phoneNote } from "@/editor/widgets/whatsapp";
import { injectPageTexts, renderPageHtml } from "@/lib/page-render";
import { htmlLang, INTL_PHONE_KEY, PAGE_TEXTS, type PageTextKey, pageTexts } from "@/lib/page-texts";
import { runtimeScript } from "@/lib/runtime-bundle";
import { isValidPhone, leadFieldError, normalizePhone, whatsappUrl } from "@/runtime/widgets/options";

const page = (lang: string, body = "<p>Oi</p>") =>
  `<!doctype html><html lang="${lang}"><head><title>T</title></head><body>${body}</body></html>`;

const render = (html: string, extra: Partial<Parameters<typeof renderPageHtml>[1]> = {}) =>
  renderPageHtml(html, {
    links: [],
    pageHref: (id) => `/p/${id}`,
    runtimeTag: "<script data-os-runtime></script>",
    ...extra,
  });

/** JSON #os-textos embutido (null = não tem). */
function embedded(html: string): Record<string, string> | null {
  const m = /<script type="application\/json" id="os-textos">([\s\S]*?)<\/script>/.exec(html);
  return m ? JSON.parse(m[1]) : null;
}

describe("WhatsApp: número com código de outro país", () => {
  it("“+” ou “00” na frente: o número nunca ganha o 55 do Brasil", () => {
    expect(normalizePhone("+34 612 345 678")).toBe("34612345678");
    expect(normalizePhone("+1 305 555 1234")).toBe("13055551234");
    expect(normalizePhone("0034 612 345 678")).toBe("34612345678");
    expect(normalizePhone("(+52) 55 1234 5678")).toBe("525512345678");
    expect(whatsappUrl("+34 612 345 678", "Hola")).toBe("https://wa.me/34612345678?text=Hola");
    expect(whatsappUrl("+1 305 555 1234")).toBe("https://wa.me/13055551234");
  });

  it("números do Brasil continuam iguais (com ou sem +55, com DDD, com o 0 da operadora)", () => {
    expect(normalizePhone("+55 11 91234-5678")).toBe("5511912345678");
    expect(normalizePhone("(11) 91234-5678")).toBe("5511912345678");
    expect(normalizePhone("011 3333-4444")).toBe("551133334444");
    expect(normalizePhone("5511912345678")).toBe("5511912345678");
  });

  it("oferta fora do real: sem “+”, o número fica como foi digitado (nada de 55)", () => {
    expect(normalizePhone("55 1234 5678", false)).toBe("5512345678");
    expect(normalizePhone("(11) 91234-5678", false)).toBe("11912345678");
    expect(normalizePhone("+34 612 345 678", false)).toBe("34612345678");
    expect(whatsappUrl("34612345678", "", false)).toBe("https://wa.me/34612345678");
  });

  it("número final para conferir no editor", () => {
    expect(phoneDisplay("34612345678")).toBe("+34 612345678");
    expect(phoneDisplay("13055551234")).toBe("+1 3055551234");
    expect(phoneDisplay("351912345678")).toBe("+351 912345678");
    expect(phoneDisplay("5511912345678")).toBe("+55 11 91234-5678");
    expect(phoneDisplay("551133334444")).toBe("+55 11 3333-4444");
    expect(phoneNote("34612345678")).toBe("Abre a conversa com +34 612345678.");
    expect(phoneNote("5511999999999")).toBe(
      "Abre a conversa com +55 11 99999-9999 (número de exemplo: troque pelo seu).",
    );
    expect(phoneNote("612345")).toMatch(/^Confira o número \(612345\)/);
    expect(phoneNote("")).toBe("");
  });
});

describe("formulário de captura: telefone e mensagens", () => {
  const es = (key: PageTextKey, pt: string) => (PAGE_TEXTS.es as Record<string, string>)[key] ?? pt;

  it("sem a marca de fora do Brasil, como sempre: pede DDD (10 a 15 dígitos)", () => {
    expect(isValidPhone("612 345 678")).toBe(false);
    expect(isValidPhone("(11) 91234-5678")).toBe(true);
    expect(leadFieldError("phone", "612 345 678", true)).toBe(
      "Digite um WhatsApp válido com DDD (ex.: (11) 91234-5678).",
    );
    expect(leadFieldError("phone", "", true)).toBe("Digite seu WhatsApp com DDD.");
  });

  it("com a marca: 8 a 15 dígitos, com ou sem o código do país", () => {
    for (const ok of ["612 345 678", "+34 612 345 678", "55 1234 5678", "+1 305 555 1234", "9123 4567"]) {
      expect(isValidPhone(ok, true), ok).toBe(true);
      expect(leadFieldError("phone", ok, true, undefined, true), ok).toBe("");
    }
    for (const bad of ["1234567", "+1 2345 6789 0123 4567"]) expect(isValidPhone(bad, true), bad).toBe(false);
  });

  it("mensagens no idioma da página", () => {
    expect(leadFieldError("name", "", true, es)).toBe("Escribe tu nombre.");
    expect(leadFieldError("email", "", true, es)).toBe("Escribe tu correo electrónico.");
    expect(leadFieldError("email", "maria@", true, es)).toBe("Escribe un correo válido (ej.: nombre@gmail.com).");
    expect(leadFieldError("phone", "123", true, es, true)).toBe("Escribe un número de WhatsApp válido.");
    expect(leadFieldError("other", "", true, es)).toBe("Completa este campo.");
    expect(leadFieldError("name", "L", true, es)).toBe("Escribe tu nombre.");
  });
});

describe("textos da página (#os-textos)", () => {
  it("idioma do <html lang>", () => {
    expect(htmlLang(page("es-MX"))).toBe("es-MX");
    expect(htmlLang("<!doctype html><HTML class='a' LANG='en'><body>")).toBe("en");
    expect(htmlLang("<p>sem html</p>")).toBe("");
  });

  it("português de oferta em real: nada a embutir", () => {
    expect(pageTexts("pt-BR")).toBeNull();
    expect(pageTexts("pt-BR", "BRL")).toBeNull();
    expect(pageTexts("")).toBeNull();
    expect(pageTexts("pt")).toBeNull();
  });

  it("espanhol/inglês: os textos do idioma e o telefone de fora do Brasil", () => {
    expect(pageTexts("es")).toEqual({ ...PAGE_TEXTS.es, [INTL_PHONE_KEY]: "1" });
    expect(pageTexts("es-MX", "BRL")).toEqual({ ...PAGE_TEXTS.es, [INTL_PHONE_KEY]: "1" });
    expect(pageTexts("en-US")).toEqual({ ...PAGE_TEXTS.en, [INTL_PHONE_KEY]: "1" });
  });

  it("português com oferta fora do real (ou de Portugal): só o telefone muda, sem pedir DDD", () => {
    const pt = { lfPhone: "Digite seu WhatsApp.", lfPhoneBad: "Digite um WhatsApp válido.", [INTL_PHONE_KEY]: "1" };
    expect(pageTexts("pt-BR", "EUR")).toEqual(pt);
    expect(pageTexts("pt-BR", "MXN")).toEqual(pt);
    expect(pageTexts("pt-PT")).toEqual(pt);
    expect(pageTexts("fr", "USD")).toEqual(pt);
  });

  it("toda chave usada pelo script das páginas tem tradução em espanhol e inglês", () => {
    const dir = path.join(process.cwd(), "src/runtime");
    const files = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts"));
    const used = new Set<string>();
    for (const f of files) {
      // Sem os comentários (que citam t("chave", …) de exemplo).
      const code = readFileSync(path.join(dir, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const m of code.matchAll(/\bt[f]?\(\s*"(\w+)"/g)) used.add(m[1]);
    }
    used.delete(INTL_PHONE_KEY);
    expect(used.size).toBeGreaterThan(20);
    for (const key of used) {
      expect(PAGE_TEXTS.es, key).toHaveProperty(key);
      expect(PAGE_TEXTS.en, key).toHaveProperty(key);
    }
    expect(Object.keys(PAGE_TEXTS.en).sort()).toEqual(Object.keys(PAGE_TEXTS.es).sort());
  });

  it("render: página em português de oferta em real sai igual (sem #os-textos)", () => {
    const html = page("pt-BR", "<form data-os-widget='lead-form'></form>");
    const out = render(html, { currency: "BRL" });
    expect(out).toBe(render(html));
    expect(out).not.toContain("os-textos");
  });

  it("render: espanhol/inglês (inclusive pelo idioma do SEO) embute o JSON no <head>", () => {
    const es = render(page("es"), { currency: "MXN" });
    expect(embedded(es)).toEqual({ ...PAGE_TEXTS.es, intl: "1" });
    expect(es.indexOf('id="os-textos"')).toBeLessThan(es.indexOf("</head>"));
    // O idioma escolhido em "Idioma das páginas" vale (o JSON vem depois do SEO).
    const en = render(page("pt-BR"), { seo: { lang: "en" } });
    expect(htmlLang(en)).toBe("en");
    expect(embedded(en)).toEqual({ ...PAGE_TEXTS.en, intl: "1" });
    // Oferta em peso com a página em português: só o telefone.
    expect(embedded(render(page("pt-BR"), { currency: "MXN" }))).toEqual({
      lfPhone: "Digite seu WhatsApp.",
      lfPhoneBad: "Digite um WhatsApp válido.",
      intl: "1",
    });
    // Oferta em real com "Idioma das páginas" = Espanhol: a escolha vale.
    expect(embedded(render(page("pt-BR"), { currency: "BRL", seo: { lang: "es" } }))).toEqual({
      ...PAGE_TEXTS.es,
      intl: "1",
    });
  });

  it("render: oferta em real com página clonada em lang=en/es, sem idioma escolhido, sai igual à de antes", () => {
    for (const lang of ["en", "es", "es-MX", "pt-PT"]) {
      const html = page(lang, "<form data-os-widget='lead-form'></form>");
      for (const currency of ["BRL", undefined] as const) {
        const out = render(html, { currency });
        expect(out, `${lang} ${currency}`).not.toContain("os-textos");
        // Idioma do SEO vazio = mantém o da página: também não conta como escolha.
        expect(render(html, { currency, seo: { lang: "" } })).toBe(out);
      }
    }
    expect(injectPageTexts(page("en"), "BRL")).toBe(page("en"));
    expect(injectPageTexts(page("en"))).toBe(page("en"));
  });

  it("render: a moeda da oferta também decide o NIF de Portugal só com algarismos", () => {
    const html = page("pt-PT", '<p>inscrita no CNPJ sob o nº <span class="os-ph">{{CNPJ}}</span></p>');
    const company = { name: "X", document: "123 456 789", email: "", phone: "", address: "" };
    expect(render(html, { company, currency: "EUR" })).toContain("inscrita no NIF sob o nº");
    expect(render(html, { company })).toContain("inscrita no CNPJ sob o nº");
  });

  it("injectPageTexts: uma vez só, à prova de </script> e sem <head> fica depois do doctype", () => {
    const once = injectPageTexts(page("es"), "MXN");
    expect(injectPageTexts(once, "MXN")).toBe(once);
    expect(once.match(/<\/script>/g)).toHaveLength(1);
    const bare = injectPageTexts('<!DOCTYPE html><html lang="en"><body>x</body></html>', "USD");
    expect(bare.startsWith('<!DOCTYPE html><script type="application/json" id="os-textos">')).toBe(true);
  });

  it("o script das páginas não carrega as traduções (só lê o #os-textos)", () => {
    const script = runtimeScript();
    expect(script).toContain("os-textos");
    expect(script).not.toContain("Escribe tu nombre");
    expect(script).not.toContain("Spinning the wheel");
  });
});
