/**
 * Textos da revisão da clonagem montados a partir do que o robô de clonagem
 * gravou (src/worker/clone): sem React, testados em tests/unit/polish-x-clone.test.ts.
 */

const KIND_TEXT: Record<string, string> = {
  downsell: "de um downsell",
  upsell: "de um upsell",
  obrigado: "de uma página de obrigado",
  funil: "de outra página do funil",
};

/** "/oferta/obrigado-1/" → "/oferta/obrigado-1" (curto o bastante para caber na linha). */
function shortPath(url: string): string {
  let path: string;
  try {
    const u = new URL(url);
    path = decodeURIComponent(u.pathname).replace(/\/+$/, "") || "/";
  } catch {
    return url;
  }
  return path.length > 40 ? `…${path.slice(-39)}` : path;
}

/**
 * Motivo de uma sugestão do funil em pt-BR claro. O robô grava o pedaço da
 * regra que bateu ('Endereço com "obrigad" costuma ser a página de obrigado'),
 * que parece erro de digitação; aqui vira 'O endereço (/obrigado) parece ser de
 * uma página de obrigado.'. Textos do link ficam como estão, com aspas curvas.
 */
export function funnelReasonText(reason: string, url: string): string {
  const path = /^Endereço com "[^"]*" (?:costuma ser|parece fazer parte) (.+)$/.exec(reason.trim());
  if (path) {
    const what = path[1];
    const kind = /downsell/i.test(what)
      ? "downsell"
      : /upsell/i.test(what)
        ? "upsell"
        : /obrigado/i.test(what)
          ? "obrigado"
          : "funil";
    return `O endereço (${shortPath(url)}) parece ser ${KIND_TEXT[kind]}.`;
  }
  const text = reason.trim().replace(/"([^"]*)"/g, "“$1”");
  return /[.!?]$/.test(text) ? text : `${text}.`;
}
