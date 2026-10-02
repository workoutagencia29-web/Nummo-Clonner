/**
 * Notificação de compra (data-os-widget="sales-notification").
 *
 * O cartão que o usuário estilizou no editor vira um aviso flutuante no canto
 * da tela: "Maria, de São Paulo" / "acabou de comprar o Método X" / "há 7 minutos".
 *
 * data-os-people    uma pessoa por linha ("Nome - Cidade"); vazio = não mostra nada
 * data-os-product   produto; data-os-action: texto da ação ("acabou de comprar")
 * data-os-start     segundos até a primeira; data-os-interval: entre uma e outra
 * data-os-duration  segundos na tela; data-os-max: quantas por visita (0 = sem limite)
 * data-os-position  "left" | "right"; data-os-time: mostra "há X minutos"
 * data-os-mobile    "0" não mostra no celular
 * (role="status"/aria-live vêm do bloco.)
 */
import { parsePeople } from "./options";
import { flag, num, opt, widgets } from "./util";

export function initSalesNotifications(root?: ParentNode) {
  const el = widgets("sales-notification", root)[0];
  if (!el) return;
  if (!flag(el, "mobile", true) && innerWidth < 640) return;
  const people = parsePeople(opt(el, "people")).sort(() => Math.random() - 0.5);
  if (!people.length) return;
  const product = opt(el, "product");
  const action = opt(el, "action", "acabou de comprar");
  const max = num(el, "max", 10, 0, 1000);
  const interval = num(el, "interval", 15, 2, 3600) * 1000;
  const duration = num(el, "duration", 5, 1, 120) * 1000;
  const part = (name: string) => el.querySelector<HTMLElement>(`[data-os-sn="${name}"]`);
  const title = part("title");
  const text = part("text");
  const time = part("time");
  if (time && !flag(el, "time", true)) time.style.display = "none";

  // Fora de seções com delay/transform: o aviso fica no canto da tela, não da seção.
  if (el.parentElement !== document.body) document.body.appendChild(el);
  el.hidden = false;
  el.classList.add("os-sn");
  if (opt(el, "position") === "right") el.classList.add("os-sn-r");
  let shown = 0;

  // Botão de WhatsApp flutuante no mesmo canto: o aviso sobe e não cobre o botão
  // (nem rouba os toques dele).
  const clearWhatsapp = () => {
    const me = el.getBoundingClientRect();
    let up = 0;
    document.querySelectorAll('[data-os-widget="whatsapp"]').forEach((wa) => {
      const r = wa.getBoundingClientRect();
      if (
        r.width &&
        getComputedStyle(wa).position === "fixed" &&
        r.left < me.right &&
        r.right > me.left &&
        r.bottom > innerHeight - me.height - 40
      )
        up = Math.max(up, innerHeight - r.top + 12);
    });
    el.style.bottom = up ? `${up}px` : "";
  };
  clearWhatsapp();

  const next = () => {
    if (max && shown >= max) return;
    clearWhatsapp();
    const p = people[shown++ % people.length];
    if (title) title.textContent = p.city ? `${p.name}, de ${p.city}` : p.name;
    if (text) text.textContent = product ? `${action} ${product}` : action;
    if (time) time.textContent = `há ${2 + Math.floor(Math.random() * 38)} minutos`;
    el.classList.add("os-show");
    setTimeout(() => {
      el.classList.remove("os-show");
      setTimeout(next, interval);
    }, duration);
  };
  setTimeout(next, num(el, "start", 6, 0, 3600) * 1000);
}
