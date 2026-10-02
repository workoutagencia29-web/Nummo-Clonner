/**
 * Envio de dados sem atrasar a página (sendBeacon, ou fetch keepalive) e o
 * relatório da tela "Testar pixels" (PixelTestReport, só no modo teste).
 *
 * Passos informados (vendor / event / status):
 * - RUNTIME / START / LOADED — o script começou (detail: consent = modo do banner, pixels = quantos,
 *   online = o navegador tem internet; no teste A/B, versao = letra e pasta = pasta da versão);
 * - CONSENT / BANNER / LOADED — o banner apareceu;
 * - CONSENT / WAITING / BLOCKED — pixels esperando o visitante clicar em "Aceitar";
 * - CONSENT / ACCEPTED | NOTICE | OFF / FIRED e CONSENT / REJECTED / BLOCKED —
 *   escolha do visitante (detail.remembered = escolha guardada de outra visita);
 * - CONSENT / <evento neutro, ex. LEAD> / BLOCKED — evento não enviado: cookies recusados;
 * - <plataforma> / load / LOADED | BLOCKED | ERROR — script de cada pixel
 *   (detail.pixel; UTMify: detail.script = "utms" para o script de UTMs; um
 *   segundo pixel da UTMify sai como ERROR: só o primeiro carrega);
 * - <plataforma> / <nome na plataforma, ex. Lead> / FIRED | BLOCKED | ERROR —
 *   cada evento (detail: event, eventId, pixel, sendTo, value, currency e, no
 *   teste A/B, os_versao quando a plataforma recebeu a versão);
 * - RUNTIME / ERROR / ERROR — falha inesperada (detail.message).
 * Toda linha leva detail.seq (ordem de envio);
 * Os passos das plataformas com BLOCKED/ERROR levam a explicação em português em
 * detail.hint ou detail.message; os de CONSENT o painel explica pelo nome do passo.
 */
import type { PixelTestReport } from "@/lib/tracking/runtime-config";
import type { Cfg } from "./config";

export type Status = PixelTestReport["status"];
export type Detail = Record<string, string | number | boolean | null | undefined>;
export type Report = (vendor: PixelTestReport["vendor"], event: string, status: Status, detail?: Detail) => void;

/**
 * POST sem esperar resposta, que sobrevive à troca de página (sendBeacon).
 * Corpo JSON como texto (text/plain: sem preflight de CORS).
 */
export function beacon(url: string, data: unknown) {
  try {
    navigator.sendBeacon(url, JSON.stringify(data));
  } catch {
    // endereço inválido ou navegador sem sendBeacon: segue sem enviar
  }
}

export function reporter(cfg: Cfg): Report {
  const test = cfg.mode === "test" && cfg.test;
  let seq = 0;
  return (vendor, event, status, detail = {}) => {
    if (!test) return;
    // Mesmo formato que o servidor aceita (src/lib/tracking/test-report.ts): textos
    // até 300 caracteres (as mensagens de erro são cortadas onde nascem).
    const name = event.replace(/[^\w .:/()-]/g, "_").slice(0, 80);
    const body = { token: test.token, vendor, event: name, status, detail: { seq: ++seq, ...detail } };
    beacon(test.endpoint, body);
    console.info("[Offer Studio]", vendor, name, status, body.detail);
  };
}
