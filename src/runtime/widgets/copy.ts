/**
 * Copiar texto com aviso no próprio botão (cupom da roleta, dados do SPEI na
 * janela de pagamento). Sem dependências: entra também no script da janela de
 * pagamento (src/runtime/payments).
 */

/** Copia o texto (cupom; dados do SPEI na janela de pagamento) e avisa no botão. */
export function copyText(text: string, button: HTMLElement, okLabel = "Copiado!", failLabel = "Copie o cupom") {
  // O texto original fica guardado: dois cliques seguidos não deixam o "Copiado!" no botão.
  const label = button.getAttribute("data-os-label") || button.textContent || "";
  button.setAttribute("data-os-label", label);
  const done = (ok: boolean) => {
    button.textContent = ok ? okLabel : failLabel;
    setTimeout(() => {
      button.textContent = label;
    }, 2000);
  };
  const fallback = () => {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    done(ok);
  };
  try {
    navigator.clipboard.writeText(text).then(() => done(true), fallback);
  } catch {
    fallback();
  }
}
