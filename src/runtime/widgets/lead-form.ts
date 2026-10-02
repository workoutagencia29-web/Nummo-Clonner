/**
 * Formulário de captura (form[data-os-widget="lead-form"]).
 *
 * Ao enviar: valida (mensagens em pt-BR), dispara o evento "os:lead" (usado
 * pelos pixels, ver src/runtime/tracking/rules.ts), manda os dados em JSON para
 * data-os-webhook (se houver) e vai para o endereço do atributo action (URL,
 * página do funil ou link da oferta). Com o script de pixels na página, espera
 * antes de trocar de página (o Lead precisa sair): 0,4 s, ou até o script do
 * pixel terminar de carregar (no máximo 0,8 s) — ao mesmo tempo que o webhook
 * (sai quando os dois terminaram).
 * Sem action, mostra data-os-success no lugar — só se o webhook recebeu os
 * dados; sem webhook nem destino, uma mensagem neutra (e, na prévia, um aviso).
 * Endereços digitados sem https:// ("site.com/obrigado") ganham o https://.
 * Sem JavaScript, o navegador envia o formulário direto para o action (method GET).
 *
 * UTMs da URL vão junto para o webhook; os IDs de clique de anúncio (fbclid,
 * gclid…) só com permissão do aviso de cookies (window.osConsent.granted(), do
 * script de rastreamento): quem recusou ou ainda não aceitou no "Pedir
 * permissão" não tem o ID mandado — nem no endereço da página (`page`).
 *
 * data-os-pass="1" leva nome/e-mail/telefone ao checkout (muitos checkouts
 * preenchem os dados com isso): na URL, se o destino é outro site; se é uma
 * página do funil, pela sessão ("os_lead"), e o rastreamento acrescenta aos
 * links de checkout de lá (startLeadPass) — dado pessoal nunca vai no endereço
 * das páginas, que os pixels mandam para as plataformas.
 */
import { formatPhoneBR, type LeadFieldKind, leadFieldError, withScheme } from "./options";
import { flag, isPreview, navigate, opt, save, widgets } from "./util";

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

// UTMs e IDs de clique (Meta, Google, TikTok, Kwai) e parâmetros de afiliado.
const TRACKING = /^(utm_|fbclid|gclid|ttclid|kwai|src$|sck$|xcod$)/;
/** IDs de clique de anúncio: só com permissão (mesma lista de src/runtime/tracking/forwarding.ts). */
const CLICK_ID = /^(fbclid|gclid|gbraid|wbraid|ttclid|kwai_click_id|msclkid)$/;

interface Tracking {
  pending?: () => boolean;
  settled?: (ms: number) => Promise<void>;
}
type OsWindow = Window & { __osTracking?: Tracking; osConsent?: { granted?: () => boolean } };
const osw = window as OsWindow;

/** Pode mandar IDs de clique? Sem o script de rastreamento (sem aviso de cookies), pode. */
const marketingAllowed = () => {
  const c = osw.osConsent;
  return !c || !c.granted || c.granted();
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function kindOf(f: Field): LeadFieldKind {
  if (f.type === "email") return "email";
  if (f.type === "tel") return "phone";
  return /^(name|nome|first_name)$/i.test(f.name) ? "name" : "other";
}

let seq = 0;

/** Espera mínima antes de ir para o destino quando o script de rastreamento está na página (ms). */
const LEAD_EVENT_WAIT_MS = 400;
/** Espera máxima pelo script de um pixel que ainda carrega (ms). */
const PIXEL_LOAD_WAIT_MS = 800;

/** Até o Lead sair: 0,4 s, ou até o pixel carregar (no máximo 0,8 s + o envio). */
export function leadWait(t: Tracking): Promise<unknown> {
  return Promise.all([
    sleep(LEAD_EVENT_WAIT_MS),
    t.pending && t.settled && t.pending() ? t.settled(PIXEL_LOAD_WAIT_MS).then(() => sleep(100)) : null,
  ]);
}

function showError(f: Field, message: string) {
  const next = f.nextElementSibling as HTMLElement | null;
  let err = next && next.className === "os-lf-err" ? next : null;
  if (!message) {
    f.removeAttribute("aria-invalid");
    if (err) err.remove();
    return;
  }
  if (!err) {
    err = document.createElement("small");
    err.className = "os-lf-err";
    err.id = `os-lf-err-${++seq}`;
    f.insertAdjacentElement("afterend", err);
  }
  err.textContent = message;
  f.setAttribute("aria-invalid", "true");
  f.setAttribute("aria-describedby", err.id);
}

async function post(url: string, data: Record<string, string>) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  const signal = ctl.signal;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      signal,
    });
  } catch {
    // Webhook sem CORS: manda de novo como formulário simples (a resposta não é lida).
    try {
      await fetch(url, { method: "POST", mode: "no-cors", body: new URLSearchParams(data), signal });
    } catch {
      // sem rede: segue para o próximo passo mesmo assim
    }
  } finally {
    clearTimeout(timer);
  }
}

async function submit(form: HTMLFormElement) {
  if (form.getAttribute("aria-busy") === "true") return;
  const fields = Array.from(form.elements).filter(
    (f): f is Field =>
      /^(INPUT|TEXTAREA|SELECT)$/.test(f.tagName) && !!(f as Field).name && (f as Field).type !== "submit",
  );
  let invalid: Field | null = null;
  for (const f of fields) {
    const msg = f.type === "checkbox" ? "" : leadFieldError(kindOf(f), f.value, f.required);
    showError(f, msg);
    if (msg && !invalid) invalid = f;
  }
  if (invalid) {
    invalid.focus();
    return;
  }

  const data: Record<string, string> = {};
  for (const f of fields) {
    if (f.type === "checkbox" && !(f as HTMLInputElement).checked) continue;
    data[f.name] = f.value.trim();
  }
  const allowed = marketingAllowed();
  const here = new URL(location.href);
  here.hash = "";
  new URLSearchParams(location.search).forEach((v, k) => {
    if (!allowed && CLICK_ID.test(k)) here.searchParams.delete(k);
    else if (TRACKING.test(k) && !(k in data)) data[k] = v;
  });
  data.page = here.href;

  form.setAttribute("aria-busy", "true");
  form.dispatchEvent(new CustomEvent("os:lead", { bubbles: true, detail: { ...data } }));
  const hook = withScheme(opt(form, "webhook"));
  const posting = /^https?:\/\//i.test(hook) ? post(hook, data) : null;
  // "sent": os dados foram mesmo para algum lugar (webhook ou próxima página).
  let sent = !!posting;

  const action = withScheme(form.getAttribute("action") || "");
  let to: URL | null = null;
  if (action && action !== "#" && !action.startsWith("os-page:")) {
    try {
      to = new URL(action, location.href);
    } catch {
      // endereço inválido: fica na página
    }
    if (to && !/^https?:$/.test(to.protocol)) to = null;
  }
  if (to) {
    if (flag(form, "pass", false)) {
      const lead: Record<string, string> = {};
      for (const k of ["name", "email", "phone"]) if (data[k]) lead[k] = data[k];
      // Página do funil: pela sessão (o endereço dela vai para os pixels); outro site: na URL.
      if (to.origin === location.origin) save("os_lead", JSON.stringify(lead), true);
      else for (const k in lead) to.searchParams.set(k, lead[k]);
    }
    // Webhook e pixels ao mesmo tempo: só troca de página quando o webhook
    // respondeu E o evento Lead saiu (o script do pixel pode ainda estar carregando).
    const tracking = osw.__osTracking;
    await Promise.all([posting, tracking ? leadWait(tracking) : null]);
    if (navigate(to)) return;
    sent = true; // prévia do painel: o destino abriu numa aba nova
  } else if (posting) await posting;
  form.removeAttribute("aria-busy");
  form.reset();
  let ok = form.querySelector<HTMLElement>(".os-lf-ok");
  if (!ok) {
    ok = document.createElement("p");
    ok.setAttribute("role", "status");
    form.appendChild(ok);
  }
  // Sem webhook nem destino, nada foi enviado: nunca diz ao visitante que "enviou o
  // material" (só "Obrigado!"). Na prévia, avisa quem está montando a página.
  const warn = !sent && isPreview();
  ok.className = warn ? "os-lf-ok os-lf-warn" : "os-lf-ok";
  ok.textContent = sent
    ? opt(form, "success", "Pronto! Recebemos seus dados.")
    : warn
      ? "Prévia: este formulário ainda não envia os dados. Configure o webhook ou o destino no editor."
      : "Obrigado!";
}

export function initLeadForms(root?: ParentNode) {
  for (const form of widgets<HTMLFormElement>("lead-form", root)) {
    if (form.tagName !== "FORM") continue;
    form.noValidate = true;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      void submit(form);
    });
    // Corrige o erro assim que o visitante mexe no campo; formata o telefone ao sair.
    form.addEventListener("input", (e) => {
      const f = e.target as Field;
      if (f.getAttribute("aria-invalid")) showError(f, leadFieldError(kindOf(f), f.value, f.required));
    });
    form.addEventListener(
      "blur",
      (e) => {
        const f = e.target as Field;
        if (f.type === "tel") f.value = formatPhoneBR(f.value);
      },
      true,
    );
  }
}
