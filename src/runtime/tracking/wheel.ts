/**
 * Eventos da roleta de desconto para os pixels (sem regra para configurar),
 * como os do quiz (./quiz.ts) e pelo mesmo caminho (consentimento: espera o
 * "Aceitar"; "Recusar" bloqueia; Kwai, Google Ads e UTMify não recebem):
 *
 * - girou a roleta: Meta/TikTok "RoletaGirou", GA4 "roleta_girou";
 * - clicou em "Resgatar" (só quem ganhou um prêmio: o "Continuar" de quem caiu
 *   em "Sem prêmio" não conta): Meta/TikTok "RoletaResgatou", GA4 "roleta_resgatou".
 *
 * Parâmetro: roleta_premio = o texto da fatia que saiu ("30% OFF", ou "Não foi
 * dessa vez") — nada da pessoa — e, no teste A/B, os_versao.
 *
 * A roleta (src/runtime/widgets/wheel.ts) avisa com o evento "os:wheel"; com
 * data-os-track="0" ela não vai para os pixels.
 */
import type { QuizEvent } from "./quiz";

/** Evento dos pixels para um aviso "os:wheel" (null = não manda nada). */
export function wheelEvent(detail: unknown): QuizEvent | null {
  const d = (detail || {}) as Record<string, unknown>;
  if (d.track === false) return null;
  const prize = typeof d.prize === "string" ? d.prize.slice(0, 100) : "";
  const params = { roleta_premio: prize };
  if (d.kind === "spin") return { name: "RoletaGirou", ga: "roleta_girou", params };
  if (d.kind === "redeem") return d.won === false ? null : { name: "RoletaResgatou", ga: "roleta_resgatou", params };
  return null;
}

/** Sem depender de ./util: wheelEvent é testado fora do navegador. */
export function startWheelEvents(fire: (ev: QuizEvent) => void) {
  document.addEventListener("os:wheel", (e) => {
    const ev = wheelEvent((e as CustomEvent).detail);
    if (ev) fire(ev);
  });
}
