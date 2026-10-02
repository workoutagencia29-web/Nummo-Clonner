/**
 * Barra de escassez (data-os-widget="scarcity").
 *
 * data-os-percent  quanto da barra fica preenchido (0–100)
 * data-os-animate  "1": diminui 1% a cada data-os-every segundos até data-os-min
 *
 * A barra é [data-os-sc-fill] e o número aparece em [data-os-sc-value]. O valor
 * atual fica guardado na sessão: recarregar a página não "devolve" as vagas.
 */
import { flag, load, num, save, widgets } from "./util";

export function initScarcity(root?: ParentNode) {
  widgets("scarcity", root).forEach((el, i) => {
    const fill = el.querySelector<HTMLElement>("[data-os-sc-fill]");
    const values = Array.from(el.querySelectorAll<HTMLElement>("[data-os-sc-value]"));
    const min = num(el, "min", 3, 0, 100);
    const key = `os-sc:${location.pathname}:${i}`;
    let pct = Math.round(num(el, "percent", 20, 0, 100));
    const stored = Number(load(key, true));
    if (stored && stored < pct && stored >= min) pct = stored;
    const paint = () => {
      if (fill) fill.style.width = `${pct}%`;
      for (const v of values) v.textContent = `${pct}%`;
    };
    paint();
    if (!flag(el, "animate", false) || pct <= min) return;
    el.classList.add("os-sc-a");
    const timer = setInterval(
      () => {
        pct = Math.max(min, pct - 1);
        save(key, String(pct), true);
        paint();
        if (pct > min) return;
        clearInterval(timer);
        el.classList.remove("os-sc-a");
      },
      num(el, "every", 8, 1, 3600) * 1000,
    );
  });
}
