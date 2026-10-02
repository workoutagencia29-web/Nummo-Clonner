/**
 * Contador regressivo (data-os-widget="countdown").
 *
 * data-os-mode      "evergreen" (minutos por visitante, guardado no navegador)
 *                   ou "date" (até data-os-until, horário de Brasília se sem fuso;
 *                   data vazia/inválida conta como "por visitante")
 * data-os-minutes   minutos do modo por visitante (padrão 15)
 * data-os-expired   ao acabar: "zero" (fica 00:00), "hide" (esconde),
 *                   "text" (mostra data-os-expired-text) ou "restart" (recomeça)
 *
 * Os números ficam em [data-os-cd="d|h|m|s"]; a unidade "dias" some quando
 * falta menos de um dia (as horas passam a somar os dias): data-os-cd-days="0"
 * + regra [data-os-cd-days="0"] [data-os-cd-unit=d] (CSS da página e WIDGET_CSS).
 */
import { pad2, parseDeadline, splitTime } from "./options";
import { load, num, opt, save, widgets } from "./util";

type Tick = () => boolean;

function setup(el: HTMLElement): Tick {
  const mode = opt(el, "mode", "evergreen");
  const minutes = num(el, "minutes", 15, 0.1, 525600);
  const onEnd = opt(el, "expired", "zero");
  const key = `os-cd:${location.pathname}:${minutes}`;
  // Data inválida ou vazia: conta como "por visitante" em vez de sumir.
  let end = (mode === "date" && parseDeadline(opt(el, "until"))) || 0;
  const byDate = end > 0;
  const restart = () => {
    end = Date.now() + minutes * 60000;
    save(key, String(end));
  };
  if (!byDate) {
    end = Number(load(key)) || 0;
    if (!end || (onEnd === "restart" && end <= Date.now())) restart();
  }

  const box = (u: string) => el.querySelector<HTMLElement>(`[data-os-cd="${u}"]`);
  const nums = { d: box("d"), h: box("h"), m: box("m"), s: box("s") };
  const showDays = !!nums.d && end - Date.now() >= 86400000;
  // A caixa "dias" some pelo atributo: a regra que a esconde já vem no CSS da
  // página (componente os-countdown), então nada pisca nem pula ao carregar.
  el.setAttribute("data-os-cd-days", showDays ? "1" : "0");
  if (nums.d && !showDays && !nums.d.closest("[data-os-cd-unit]")) nums.d.style.display = "none";

  const write = (node: HTMLElement | null, value: number) => {
    const text = pad2(value);
    if (node && node.textContent !== text) node.textContent = text;
  };

  const expire = () => {
    el.setAttribute("data-os-state", "expired");
    if (onEnd === "hide") el.style.display = "none";
    else if (onEnd === "text") {
      const units = el.querySelector<HTMLElement>("[data-os-cd-units]");
      if (units) units.style.display = "none";
      const msg = document.createElement("div");
      msg.className = "os-cd-exp";
      msg.textContent = opt(el, "expired-text", "Oferta encerrada.");
      if (units) units.after(msg);
      else el.appendChild(msg);
    }
  };

  return () => {
    let left = end - Date.now();
    if (left <= 0 && onEnd === "restart" && !byDate) {
      restart();
      left = end - Date.now();
    }
    const t = splitTime(left);
    write(nums.d, t.d);
    write(nums.h, showDays ? t.h : t.h + t.d * 24);
    write(nums.m, t.m);
    write(nums.s, t.s);
    if (left > 0) return true;
    expire();
    return false;
  };
}

export function initCountdowns(root?: ParentNode) {
  let ticks = widgets("countdown", root).map(setup);
  if (!ticks.length) return;
  const run = () => {
    ticks = ticks.filter((tick) => tick());
    if (!ticks.length) clearInterval(timer);
  };
  const timer = setInterval(run, 1000);
  run();
}
