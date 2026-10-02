/**
 * Script de rastreamento das páginas (prévia, tela "Testar pixels" e ZIP).
 * Fica no começo do <head> (src/lib/tracking/inject.ts) e lê a configuração
 * pública de <script type="application/json" id="os-tracking">
 * (TrackingRuntimeConfig, src/lib/tracking/runtime-config.ts).
 *
 * - Consentimento LGPD (OPT_IN: nada de marketing/estatística antes do "Aceitar";
 *   NOTICE: só aviso; OFF: sem banner) + Google Consent Mode v2 (em todo
 *   "Pedir permissão", com ou sem pixel do Google: vale para tags coladas à mão).
 *   window.osConsent = { open(), get(), granted() }, [data-os-consent-open] e,
 *   no "Pedir permissão", um botão flutuante "Cookies" nas páginas sem esse
 *   link reabrem o banner (sem banner, modo OFF, os links ficam escondidos).
 *   Recusar depois de aceitar recarrega a página: scripts de terceiros já
 *   carregados não têm como ser desligados. O banner do "Pedir permissão"
 *   aparece quando a página tem pixels/código de marketing ou quando a chegada
 *   traz IDs de clique ou UTMs para guardar (esperam o "Aceitar"; os IDs de
 *   clique contam mesmo com o repasse desligado quando a página tem um
 *   formulário de captura com webhook). Um "Recusar"
 *   guardado vale também no "Só avisar" (a oferta mudou de modo depois): nada
 *   de pixels, e o botão "Cookies" reabre o banner com "Aceitar".
 * - Pixels (./vendors.ts) com o mesmo eventID em todas as plataformas e, com o
 *   eventos.php (config.server), também pelo servidor. No teste A/B
 *   (config.variant), cada evento leva a versão (os_versao) e os links de
 *   checkout ganham a marca dela (./forwarding.ts, markVersion).
 * - Regras de evento (./rules.ts) e repasse de UTMs/IDs de clique (./forwarding.ts):
 *   no "Pedir permissão", o que fica guardado e os IDs de clique de anúncio no
 *   checkout esperam o "Aceitar" (entre as páginas do funil eles seguem no
 *   endereço, para quem aceitar numa página seguinte); "Recusar" tira os dois.
 * - window.__osTracking: { pending(), settled(ms), leaving } (scripts dos pixels
 *   ainda carregando; a página esperando para sair), usado pelo script das
 *   páginas para não trocar de página antes de o evento sair (formulário de
 *   captura, botões data-os-href) — e por ./rules.ts, para um link clicado
 *   durante essa espera também esperar.
 * - Modo "preview": nenhum pixel nem código de marketing carrega (não suja os
 *   dados); banner e repasse de UTMs funcionam. Modo "test": cada passo é
 *   informado ao painel (./report.ts).
 *
 * Idempotente (window.__osTracking) e à prova de falhas: nada aqui pode quebrar a página.
 */
import { amountOf, type Cfg, type Ev, nameOf, readConfig, type Vendor, versionOf } from "./config";
import { activateGated, type Choice, cookiesButton, hasGated, readChoice, saveChoice, showBanner } from "./consent";
import {
  CLICK_ID,
  cleanParam,
  collectParams,
  forgetParams,
  persistParams,
  startForwarding,
  startLeadPass,
  withoutClickIds,
} from "./forwarding";
import { beacon, type Report, reporter } from "./report";
import { startRules } from "./rules";
import { $$, closest, cookie, doc, on, ready, setCookie, uuid, win } from "./util";
import { consentState, createVendors, gtag } from "./vendors";

/** Formato do fbclid da Meta (vai para o cookie _fbc: nada de ";" que injetaria atributos). */
const FBCLID = /^[A-Za-z0-9_.-]{1,500}$/;
/** Dados pessoais que um endereço pode trazer (nunca vão para o eventos.php). */
const PII = /^(name|nome|first_name|last_name|email|e-mail|phone|telefone|tel|celular|whatsapp|cpf)$/i;

/** O endereço da página sem dados pessoais na query (event_source_url). */
function pageUrl() {
  const url = new URL(location.href);
  for (const k of Array.from(url.searchParams.keys())) if (PII.test(k)) url.searchParams.delete(k);
  return url.href;
}

function start(cfg: Cfg, report: Report) {
  const preview = cfg.mode === "preview";
  const mode = cfg.consent.mode;
  const server = cfg.server;
  const has = (...v: Vendor[]) => cfg.pixels.some((p) => v.includes(p.vendor));
  const optIn = mode === "OPT_IN";

  const variant = cfg.variant;
  report("RUNTIME", "START", "LOADED", {
    consent: mode,
    pixels: cfg.pixels.length,
    online: navigator.onLine !== false,
    // Teste A/B: a versão que esta página informa nos eventos.
    ...(variant ? { versao: variant.name, pasta: variant.folder } : {}),
  });

  // ── Consentimento ───────────────────────────────────────────────────────
  let choice = readChoice(preview);
  if (optIn && choice === "notice") choice = null; // "Entendi" de antes não é permissão
  /**
   * Pode rastrear com esta escolha? Sem aviso (OFF), sempre. Um "Recusar" dado
   * quando a oferta pedia permissão continua valendo depois de ela passar para
   * "Só avisar" (quem recusou ganha o botão "Cookies" para mudar de ideia).
   */
  const grants = (c: Choice | null) => mode === "OFF" || c === "accepted" || (!optIn && c !== "rejected");
  let granted = grants(choice);
  /** Consent Mode v2 em todo "Pedir permissão" (também para GTM/gtag colados no código livre) e para quem recusou. */
  const consentMode = !preview && (optIn || !granted);
  // O padrão vale antes de qualquer gtag("config") (o script é o primeiro do <head>).
  if (consentMode) gtag("consent", "default", consentState(false, true));
  else if (!preview && has("GA4", "GOOGLE_ADS")) gtag("consent", "default", consentState(true));

  // ── UTMs e IDs de clique ────────────────────────────────────────────────
  const query = new URLSearchParams(location.search);
  const arrival = collectParams(cfg);
  const all = arrival.params;
  const stripped = withoutClickIds(all);
  /** Guarda os parâmetros da chegada (só com permissão). */
  const persist = () => {
    if (arrival.fresh) persistParams(cfg, all);
  };
  if (granted) persist();
  else if (choice === "rejected") forgetParams();
  // Sem escolha ainda, os IDs de clique seguem nos links do funil (só no endereço,
  // do próprio site): quem aceitar na página seguinte não perde a atribuição.
  const redecorate = startForwarding(cfg, (funnel) => (granted || (funnel && choice !== "rejected") ? all : stripped));
  startLeadPass(cfg);
  const clickId = (k: string) => cleanParam(k, query.get(k)) || all[k] || null;

  const vendors = createVendors(cfg, report);
  const queue: Ev[] = [];
  let enabled = false;

  /** Evento para os pixels (e para o eventos.php) com um eventID novo. */
  const send = (ev: Ev) => {
    const eventId = uuid();
    vendors.send(ev, eventId);
    const names: Record<string, string> = {};
    for (const v of server ? server.vendors : []) {
      const n = nameOf(cfg, v, ev);
      // O PageView do TikTok (ttq.page) não leva eventID: pelo servidor, contaria duas vezes.
      if (n && !(v === "TIKTOK" && ev === "PAGE_VIEW")) names[v] = n;
    }
    if (!server || !Object.keys(names).length) return;
    try {
      beacon(server.endpoint, {
        event: ev,
        event_name: names,
        event_id: eventId,
        event_time: Math.floor(Date.now() / 1000),
        event_source_url: pageUrl(),
        ...amountOf(cfg, ev),
        ...versionOf(cfg),
        fbp: cookie("_fbp"),
        fbc: cookie("_fbc"),
        ttp: cookie("_ttp"),
        ttclid: clickId("ttclid"),
      });
    } catch {
      // documento sem cookies: o evento já saiu pelos pixels
    }
  };

  /** Liga os pixels (uma vez, depois do consentimento). */
  const enable = () => {
    if (enabled || preview) return;
    enabled = true;
    try {
      // Cookies de marketing só com permissão: _fbc (a partir do fbclid) e _fbp
      // (o pixel da Meta adota o que já existe; assim o eventos.php já recebe no 1º PageView).
      if (has("META", "UTMIFY")) {
        const fbclid = clickId("fbclid");
        const fbc = cookie("_fbc");
        if (fbclid && FBCLID.test(fbclid) && (!fbc || (query.get("fbclid") && !fbc.endsWith(`.${fbclid}`)))) {
          setCookie("_fbc", `fb.1.${Date.now()}.${fbclid}`);
        }
        if (!cookie("_fbp")) setCookie("_fbp", `fb.1.${Date.now()}.${Math.floor(1e9 + Math.random() * 9e9)}`);
      }
      vendors.load();
      send("PAGE_VIEW");
      for (const ev of queue.splice(0)) send(ev);
    } catch (e) {
      report("RUNTIME", "ERROR", "ERROR", { message: `${e}`.slice(0, 300) });
    }
    ready(activateGated);
  };

  /** Manda o evento (true = saiu agora para os pixels). */
  const fire = (ev: Ev) => {
    if (enabled && granted) {
      send(ev);
      return true;
    }
    if (choice === "rejected") report("CONSENT", ev, "BLOCKED");
    else queue.push(ev);
    return false;
  };

  /**
   * No "Pedir permissão", a chegada traz o que espera o "Aceitar": UTMs para
   * guardar ou IDs de clique de anúncio — os do repasse (checkout) e, com um
   * formulário de captura ligado a um webhook, os do endereço (o formulário os
   * lê de lá e manda ao webhook, com ou sem repasse). Só depois do HTML pronto.
   */
  const waiting = () =>
    optIn &&
    ((arrival.fresh && cfg.forwarding.persistDays > 0) ||
      Object.keys(all).some((k) => CLICK_ID.test(k)) ||
      ($$('form[data-os-widget="lead-form"]').some((f) => !!(f.getAttribute("data-os-webhook") || "").trim()) &&
        Array.from(query.keys()).some((k) => !!query.get(k) && CLICK_ID.test(k))));
  /** Algo nesta página precisa de consentimento (pixels, eventos.php, código de marketing ou a chegada)? */
  const needed = () => !!(cfg.pixels.length || server || cfg.marketingCode || hasGated() || waiting());
  /**
   * Botão "Cookies" (páginas sem o link "Preferências de cookies"), depois de
   * uma escolha: no "Pedir permissão" e para quem recusou (no "Só avisar", o
   * "Entendi" não tem o que mudar).
   */
  const fab = () =>
    ready(() => cookiesButton(cfg, (optIn ? !!choice : choice === "rejected") && needed(), () => open(true)));

  const decide = (c: Choice, remembered: boolean) => {
    const before = enabled && granted;
    choice = c;
    granted = grants(c);
    if (!remembered) saveChoice(c, preview);
    if (consentMode && (granted || !remembered)) gtag("consent", "update", consentState(granted));
    report("CONSENT", c.toUpperCase(), granted ? "FIRED" : "BLOCKED", { remembered });
    if (granted) {
      if (!remembered) {
        persist();
        redecorate();
      }
      enable();
      return;
    }
    queue.length = 0;
    forgetParams();
    redecorate();
    if (before) {
      // Mudou de ideia depois de os pixels carregarem: Meta e TikTok param na
      // hora; os outros (Kwai, UTMify, código de marketing já rodando) não têm
      // como ser desligados — a página recarrega e, com "recusado" guardado, nada carrega.
      vendors.consent(false);
      for (const name of ["_fbc", "_fbp", "_ttp"]) setCookie(name, "", 0);
      setTimeout(() => location.reload(), 200);
    }
  };

  function open(focus: boolean) {
    if (mode === "OFF") return;
    ready(() => {
      cookiesButton(cfg, false, () => {});
      // Quem recusou pode aceitar depois, também no "Só avisar".
      const shown = showBanner(
        cfg,
        !optIn && choice !== "rejected",
        (c) => {
          decide(c, false);
          fab();
        },
        focus,
      );
      if (shown) report("CONSENT", "BANNER", "LOADED");
    });
  }
  /** granted(): pode rastrear (formulário de captura: IDs de clique só com permissão). */
  win.osConsent = { open: () => open(true), get: () => choice, granted: () => granted };
  // Link "Preferências de cookies" (rodapé/política): reabre o banner.
  on(
    doc,
    "click",
    (e) => {
      if (mode !== "OFF" && closest(e, "[data-os-consent-open]")) {
        e.preventDefault();
        open(true);
      }
    },
    true,
  );

  if (mode === "OFF") {
    report("CONSENT", "OFF", "FIRED");
    // Sem aviso de cookies, o link "Preferências de cookies" não teria o que abrir.
    ready(() => {
      for (const el of $$("[data-os-consent-open]"))
        (el as HTMLElement).style.setProperty("display", "none", "important");
    });
  } else if (choice) {
    decide(choice, true);
    fab();
  } else {
    if (optIn) report("CONSENT", "WAITING", "BLOCKED"); // pixels esperando o "Aceitar"
    // Só pede permissão quando há algo que precisa dela (pixels ou código livre de marketing).
    ready(() => {
      if (needed()) open(false);
    });
  }

  if (preview) {
    const list = cfg.pixels.map((p) => `${p.vendor} ${p.id}`).join(", ") || "nenhum";
    console.info(`[Offer Studio] Pixels desligados na prévia: ${list}. Veja-os em "Testar pixels".`);
  } else {
    const api = win.__osTracking;
    api.pending = vendors.pending;
    api.settled = vendors.settled;
    try {
      // O mesmo objeto do script das páginas: a espera para sair (`leaving`) é uma só.
      startRules(cfg, fire, api);
    } catch (e) {
      report("RUNTIME", "ERROR", "ERROR", { message: `${e}`.slice(0, 300) });
    }
  }
  if (granted) enable();
}

(() => {
  if (win.__osTracking) return;
  // Truthy desde já (o script roda uma vez só); os pixels preenchem pending/settled.
  win.__osTracking = { pending: () => false, settled: () => Promise.resolve() };
  const boot = () => {
    const cfg = readConfig();
    if (!cfg) return;
    const report = reporter(cfg);
    try {
      start(cfg, report);
    } catch (e) {
      report("RUNTIME", "ERROR", "ERROR", { message: `${e}`.slice(0, 300) });
    }
  };
  // A configuração vem antes do script (inject.ts); se não vier, espera o HTML todo.
  if (doc.getElementById("os-tracking")) boot();
  else ready(boot);
})();
