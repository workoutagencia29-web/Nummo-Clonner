/**
 * Revisão da Fase 3 (grupo W), funções puras dos widgets:
 * - #58 máscara de telefone não estraga números de outros países;
 * - #55 endereço digitado sem https:// ganha o https:// (não vira caminho da página);
 * - #59 playlist do YouTube e links que não são de vídeo incorporável.
 */
import { describe, expect, it } from "vitest";
import { normalizeVideoUrl, youtubeId } from "@/editor/widgets/video-url";
import { formatPhoneBR, leadFieldError, withScheme } from "@/runtime/widgets/options";

describe("#58 formatPhoneBR", () => {
  it("número de outro país fica como o visitante digitou", () => {
    expect(formatPhoneBR("+1 415 555 2671")).toBe("+1 415 555 2671");
    expect(formatPhoneBR("+351 912 345 678")).toBe("+351 912 345 678");
    expect(formatPhoneBR("+44 20 7946 0958")).toBe("+44 20 7946 0958");
    // Continua válido (não aparece erro e não é reescrito).
    expect(leadFieldError("phone", formatPhoneBR("+1 415 555 2671"), true)).toBe("");
  });

  it("+55 mantém o código do país e formata o resto", () => {
    expect(formatPhoneBR("+55 11 91234-5678")).toBe("+55 (11) 91234-5678");
    expect(formatPhoneBR("+5511912345678")).toBe("+55 (11) 91234-5678");
    expect(formatPhoneBR("+55 11 3333-4444")).toBe("+55 (11) 3333-4444");
    expect(formatPhoneBR("+55 123")).toBe("+55 123");
  });

  it("números brasileiros sem + continuam como antes", () => {
    expect(formatPhoneBR("11912345678")).toBe("(11) 91234-5678");
    expect(formatPhoneBR("(11) 3333-4444")).toBe("(11) 3333-4444");
    expect(formatPhoneBR("9999")).toBe("9999");
  });
});

describe("#55 withScheme", () => {
  it.each([
    ["meusite.com.br/obrigado", "https://meusite.com.br/obrigado"],
    ["www.site.com", "https://www.site.com"],
    ["wa.me/5511999999999", "https://wa.me/5511999999999"],
    ["site.com:8080/x", "https://site.com:8080/x"],
    ["  pay.hotmart.com/X1?off=1  ", "https://pay.hotmart.com/X1?off=1"],
    ["hooks.zapier.com/hooks/catch/1/abc/", "https://hooks.zapier.com/hooks/catch/1/abc/"],
  ])("domínio sem esquema: %s", (input, out) => {
    expect(withScheme(input)).toBe(out);
  });

  it.each([
    "https://meusite.com.br/obrigado",
    "http://site.com",
    "/obrigado",
    "obrigado.html",
    "pagina.php?x=1",
    "#",
    "",
    "os-page:abc",
    "mailto:a@b.com",
    "localhost:3000",
    "//cdn.site.com/x",
  ])("fica como está: %s", (input) => {
    expect(withScheme(input)).toBe(input.trim());
  });
});

describe("#59 normalizeVideoUrl", () => {
  const LIST = "PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG";

  it("playlist do YouTube (código de incorporação ou página) vira embed/videoseries com a lista", () => {
    const expected = { provider: "youtube", src: `https://www.youtube.com/embed/videoseries?list=${LIST}&rel=0` };
    expect(normalizeVideoUrl(`https://www.youtube.com/embed/videoseries?list=${LIST}`)).toEqual(expected);
    expect(
      normalizeVideoUrl(
        `<iframe width="560" height="315" src="https://www.youtube.com/embed/videoseries?si=x&amp;list=${LIST}" title="YouTube video player"></iframe>`,
      ),
    ).toEqual(expected);
    expect(normalizeVideoUrl(`https://www.youtube.com/playlist?list=${LIST}`)).toEqual(expected);
  });

  it('"videoseries" nunca vira o ID de um vídeo', () => {
    expect(youtubeId("videoseries")).toBeNull();
    expect(youtubeId("https://www.youtube.com/embed/videoseries?list=PL1")).toBeNull();
    expect(normalizeVideoUrl("videoseries")).toBeNull();
    expect(normalizeVideoUrl("https://www.youtube.com/embed/videoseries")).toBeNull();
  });

  it("páginas que não tocam num iframe devolvem null (o editor avisa)", () => {
    for (const url of [
      "https://www.youtube.com/@meucanal",
      "https://www.youtube.com/channel/UC1234567890",
      "https://www.youtube.com/c/MeuCanal",
      "https://www.youtube.com/results?search_query=curso",
      "https://dashboard.pandavideo.com.br/#/videos/0d0a3d3e-1111-2222-3333-444455556666",
      "https://pandavideo.com.br/",
      "https://vimeo.com/channels/staffpicks",
      "https://vimeo.com/meuperfil",
    ]) {
      expect(normalizeVideoUrl(url), url).toBeNull();
    }
  });

  it("coleção e evento ao vivo do Vimeo usam o endereço de incorporação deles", () => {
    expect(normalizeVideoUrl("https://vimeo.com/showcase/1234567")).toEqual({
      provider: "vimeo",
      src: "https://vimeo.com/showcase/1234567/embed",
    });
    expect(normalizeVideoUrl("https://vimeo.com/event/7654321/embed/ab12cd")).toEqual({
      provider: "vimeo",
      src: "https://vimeo.com/event/7654321/embed/ab12cd",
    });
  });

  it("vídeos comuns continuam iguais", () => {
    const ID = "dQw4w9WgXcQ";
    expect(normalizeVideoUrl(`https://www.youtube.com/watch?v=${ID}&list=${LIST}&index=3`)).toEqual({
      provider: "youtube",
      id: ID,
      src: `https://www.youtube.com/embed/${ID}?rel=0`,
    });
    expect(normalizeVideoUrl("https://vimeo.com/channels/staffpicks/76979871")).toEqual({
      provider: "vimeo",
      id: "76979871",
      src: "https://player.vimeo.com/video/76979871",
    });
    const panda = "https://player-vz-7b6cf9e4-8bf.tv.pandavideo.com.br/embed/?v=0d0a3d3e-1111-2222-3333-444455556666";
    expect(normalizeVideoUrl(panda)).toEqual({ provider: "panda", src: panda });
    expect(normalizeVideoUrl("http://exemplo.com/video")).toEqual({
      provider: "other",
      src: "https://exemplo.com/video",
    });
  });
});
