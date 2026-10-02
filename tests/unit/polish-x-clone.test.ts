/**
 * Fase 6 (polimento) — revisão e falha da clonagem: motivos das sugestões do
 * funil sem o radical da regra, contador parado no modo Editável, ações da tela
 * de falha conforme o motivo; e o link que sai da tela com alterações não salvas.
 */
import { describe, expect, it } from "vitest";
import { failureActions } from "@/app/(painel)/clonar/[jobId]/failure-logic";
import { funnelReasonText } from "@/app/(painel)/clonar/[jobId]/review-text";
import { hasFrozenTimer } from "@/app/(painel)/clonar/[jobId]/timer-check";
import { leavingHref } from "@/hooks/use-unsaved-changes";
import { formatBytes } from "@/lib/format";

describe("motivo das sugestões do funil", () => {
  it("regra do endereço vira o caminho da página, sem o radical", () => {
    expect(
      funnelReasonText('Endereço com "obrigad" costuma ser a página de obrigado', "https://site.com/obrigado/"),
    ).toBe("O endereço (/obrigado) parece ser de uma página de obrigado.");
    expect(funnelReasonText('Endereço com "upsel" costuma ser um upsell', "https://site.com/oferta/upsell-1")).toBe(
      "O endereço (/oferta/upsell-1) parece ser de um upsell.",
    );
    expect(funnelReasonText('Endereço com "down" costuma ser um downsell', "https://site.com/down")).toBe(
      "O endereço (/down) parece ser de um downsell.",
    );
    expect(funnelReasonText('Endereço com "especial" parece fazer parte do funil', "https://site.com/especial")).toBe(
      "O endereço (/especial) parece ser de outra página do funil.",
    );
  });

  it("motivo pelo texto do link fica com aspas curvas e ponto final", () => {
    expect(funnelReasonText('O texto do link "Sim, eu quero" indica um upsell', "https://x.com/a")).toBe(
      "O texto do link “Sim, eu quero” indica um upsell.",
    );
  });
});

describe("contador parado no modo Editável", () => {
  it("contador do site (classe/id) ou hh:mm:ss no texto", () => {
    expect(
      hasFrozenTimer(
        '<div class="contador" id="contador"><span>00</span>:<span>15</span>:<span>00</span></div><p>Oferta</p>',
      ),
    ).toBe(true);
    expect(hasFrozenTimer('<div id="countdown"><b>14</b> min <b>55</b> s</div>')).toBe(true);
    expect(
      hasFrozenTimer('<div class="timer-box"><span>00</span><i>h</i><span>14</span><i>m</i><span>55</span></div>'),
    ).toBe(true);
    expect(hasFrozenTimer("<p>A oferta acaba em 00:14:55</p>")).toBe(true);
  });

  it("sem contador, contador do Offer Studio ou números soltos: nada", () => {
    expect(hasFrozenTimer("<h1>Oferta</h1><p>Ao vivo às 20:00. Restam 3 de 100 vagas.</p>")).toBe(false);
    expect(hasFrozenTimer('<div data-os-widget="countdown"><span>00:14:55</span></div>')).toBe(false);
    expect(
      hasFrozenTimer('<script>var t = "00:10:00"</script><div class="contador-de-vagas">Restam 3 vagas</div>'),
    ).toBe(false);
    expect(hasFrozenTimer("")).toBe(false);
  });
});

describe("tela de falha da clonagem", () => {
  const base = {
    variant: "failed" as const,
    source: "URL" as const,
    errorCode: "ERROR",
    protectionDetail: null,
    message: "Algo deu errado.",
    canRetry: true,
  };

  it("falha passageira: Tentar de novo é a ação principal", () => {
    expect(failureActions(base)).toMatchObject({
      showRetry: true,
      retryPrimary: true,
      next: { label: "Nova clonagem" },
    });
  });

  it("endereço da rede interna: sem Tentar de novo", () => {
    const r = failureActions({
      ...base,
      message: "Esse endereço aponta para a rede interna e foi bloqueado por segurança.",
    });
    expect(r).toMatchObject({
      showRetry: false,
      retryPrimary: false,
      next: { label: "Clonar outro link", href: "/clonar" },
    });
  });

  it("proteção do site (Cloudflare) ou 404: a outra ação vem primeiro, Tentar de novo fica de reserva", () => {
    const cf = failureActions({ ...base, errorCode: "BOT_CHALLENGE" });
    expect(cf).toMatchObject({
      importAdvice: true,
      showRetry: true,
      retryPrimary: false,
      next: { label: "Importar ZIP" },
    });
    const gone = failureActions({ ...base, errorCode: "HTTP_ERROR", protectionDetail: "HTTP 404" });
    expect(gone).toMatchObject({ importAdvice: false, retryPrimary: false, next: { label: "Clonar outro link" } });
    const dns = failureActions({ ...base, message: "Não encontramos esse endereço. Confira se o link está certo." });
    expect(dns).toMatchObject({ retryPrimary: false, showRetry: true });
  });

  it("ZIP inválido não oferece Tentar de novo", () => {
    expect(failureActions({ ...base, source: "ZIP", errorCode: "IMPORT_INVALID" })).toMatchObject({
      showRetry: false,
      next: { label: "Enviar outro ZIP" },
    });
  });
});

describe("tamanho em pt-BR", () => {
  it("vírgula decimal, igual ao ZIP", () => {
    expect(formatBytes(340_000)).toBe("332 KB");
    expect(formatBytes(2.4 * 1024 * 1024)).toBe("2,4 MB");
  });
});

describe("link que sai da tela com alterações não salvas", () => {
  const here = new URL("http://localhost:3000/ofertas/abc?aba=detalhes") as unknown as Location;
  const a = (href: string | null, attrs: Record<string, string> = {}) =>
    ({
      getAttribute: (n: string) => (n === "href" ? href : (attrs[n] ?? null)),
      hasAttribute: (n: string) => n in attrs,
    }) as unknown as HTMLAnchorElement;

  it("outra tela: pergunta; outra aba da mesma tela (as abas continuam montadas): não", () => {
    expect(leavingHref(a("/configuracoes"), here)).toBe("/configuracoes");
    expect(leavingHref(a("/ofertas"), here)).toBe("/ofertas");
    expect(leavingHref(a("?aba=configuracoes"), here)).toBeNull();
  });

  it("mesma tela, âncora, nova aba do navegador, download ou outro site: não pergunta", () => {
    expect(leavingHref(a("/ofertas/abc?aba=detalhes#x"), here)).toBeNull();
    expect(leavingHref(a("#topo"), here)).toBeNull();
    expect(leavingHref(a("/x", { target: "_blank" }), here)).toBeNull();
    expect(leavingHref(a("/api/exports/1/download", { download: "" }), here)).toBeNull();
    expect(leavingHref(a("https://exemplo.com/"), here)).toBeNull();
    expect(leavingHref(a(null), here)).toBeNull();
  });
});
