/**
 * Pixels de cada plataforma: códigos base padrão (fbq, ttq, kwaiq, gtag,
 * UTMify), carregamento com detecção de bloqueio e envio de cada evento com o
 * mesmo eventID em todas (a API de Conversões deduplica por ele).
 *
 * Cada plataforma fica isolada (try/catch): uma com problema não derruba as outras.
 * No modo teste, o evento só aparece como "enviado" quando o script da
 * plataforma carregou; se ele foi bloqueado, o evento aparece como bloqueado.
 */
import type { RuntimePixel } from "@/lib/tracking/runtime-config";
import { amountOf, type Cfg, type Ev, nameOf, type Vendor, versionOf } from "./config";
import type { Detail, Report } from "./report";
import { doc, type Loose, loadScript, win } from "./util";

export const BLOCKED_HINT = "Bloqueado pelo navegador (bloqueador de anúncios, extensão ou rede).";

const UTMIFY_URL = "https://cdn.utmify.com.br/scripts/";

/** Eventos padrão da Meta (os outros nomes vão como trackCustom). */
const META_STANDARD =
  /^(PageView|ViewContent|InitiateCheckout|Lead|CompleteRegistration|Contact|AddToCart|Purchase|AddPaymentInfo|Schedule|Search|StartTrial|Subscribe)$/;
const QUEUE_METHODS =
  "page track identify instances debug on off once ready alias group enableCookie disableCookie holdConsent revokeConsent grantConsent".split(
    " ",
  );

/** gtag/dataLayer padrão do Google (o Consent Mode entra antes de qualquer config). */
export function gtag(...args: unknown[]) {
  win.dataLayer = win.dataLayer || [];
  win.gtag =
    win.gtag ||
    function () {
      // biome-ignore lint/complexity/noArguments: o gtag.js só aceita o objeto arguments
      win.dataLayer.push(arguments);
    };
  win.gtag(...args);
}

/** Estado do Consent Mode v2; `wait`: o padrão espera até 500 ms pela escolha guardada. */
export function consentState(granted: boolean, wait?: boolean) {
  const v = granted ? "granted" : "denied";
  const state: Record<string, string | number> = {
    ad_storage: v,
    analytics_storage: v,
    ad_user_data: v,
    ad_personalization: v,
  };
  if (wait) state.wait_for_update = 500;
  return state;
}

/**
 * Código base do TikTok (ttq) e do Kwai (kwaiq), que usam o mesmo formato de
 * fila: os comandos esperam no array até o script da plataforma chegar.
 */
function queueSdk(name: string, url: string, onScript: (id: string, ok: boolean) => void): Loose {
  win[name === "ttq" ? "TiktokAnalyticsObject" : "KwaiAnalyticsObject"] = name;
  win[name] = win[name] || [];
  const q: Loose = win[name];
  const defer = (t: Loose, m: string) => {
    t[m] = (...args: unknown[]) => {
      t.push([m, ...args]);
    };
  };
  q.methods = QUEUE_METHODS;
  q.setAndDefer = defer;
  for (const m of QUEUE_METHODS) defer(q, m);
  q.instance = (id: string) => {
    const e = q._i[id] || [];
    for (const m of QUEUE_METHODS) defer(e, m);
    return e;
  };
  q.load = (id: string, opts?: object) => {
    q._i = q._i || {};
    q._i[id] = [];
    q._i[id]._u = url;
    q._t = q._t || {};
    q._t[id] = Date.now();
    q._o = q._o || {};
    q._o[id] = opts || {};
    loadScript(`${url}?sdkid=${id}&lib=${name}`, (ok) => onScript(id, ok));
  };
  return q;
}

export function createVendors(cfg: Cfg, report: Report) {
  const w = win;
  const pixels = (v: Vendor) => cfg.pixels.filter((p) => p.vendor === v);
  /** Script de cada pixel: null = carregando (eventos esperam), true = ok, false = bloqueado. */
  const states: Record<string, { ok: boolean | null; wait: [string, Detail][] }> = {};
  const key = (vendor: string, id: string) => `${vendor}:${id}`;
  const result = (vendor: Vendor, event: string, ok: boolean, detail: Detail) =>
    report(
      vendor,
      event,
      ok ? (event === "load" ? "LOADED" : "FIRED") : "BLOCKED",
      ok ? detail : { ...detail, hint: BLOCKED_HINT },
    );

  /** Resultado do script de um pixel: informa e libera os eventos que esperavam. */
  const settle = (vendor: Vendor, id: string, ok: boolean) => {
    const st = states[key(vendor, id)];
    if (!st || st.ok !== null) return;
    st.ok = ok;
    result(vendor, "load", ok, { pixel: id });
    for (const x of st.wait.splice(0)) result(vendor, x[0], ok, x[1]);
  };
  /** Marca os pixels como carregando; o retorno informa o resultado do script. */
  const start = (list: RuntimePixel[]) => {
    for (const p of list) states[key(p.vendor, p.id)] = { ok: null, wait: [] };
    return (ok: boolean) => {
      for (const p of list) settle(p.vendor, p.id, ok);
    };
  };
  /** Roda o passo de uma plataforma; um erro vira ERROR no teste e não para as outras. */
  const guard = (vendor: Vendor, event: string, fn: () => void) => {
    try {
      fn();
      return true;
    } catch (e) {
      report(vendor, event, "ERROR", { message: `${e}`.slice(0, 300) });
    }
  };

  /** TikTok e Kwai: um script por pixel (events.js?sdkid=<id>). */
  const queued = (name: string, url: string) => (list: RuntimePixel[]) => {
    start(list);
    const q = queueSdk(name, url, (id, ok) => settle(list[0].vendor, id, ok));
    for (const p of list) q.load(p.id);
  };

  const loaders: Record<string, (list: RuntimePixel[]) => void> = {
    META(list) {
      const done = start(list);
      if (w.fbq) {
        // A página já tem o código-base da Meta (ex.: colado em "Códigos da página"):
        // vale o resultado do fbevents.js dela, que pode ter sido bloqueado.
        const t0 = Date.now();
        const poll = () => {
          // biome-ignore lint/complexity/useOptionalChain: "?." vira código mais longo no alvo es2018 (script pequeno)
          if (w.fbq && w.fbq.callMethod) done(true);
          else if (Date.now() - t0 > 5000) done(false);
          else setTimeout(poll, 100);
        };
        const script = doc.querySelector('script[src*="connect.facebook.net"][src*="fbevents.js"]');
        if (script) script.addEventListener("error", () => done(false));
        poll();
      } else {
        // Código base oficial da Meta.
        const n: Loose = function () {
          // biome-ignore lint/complexity/noArguments: formato do código base da Meta
          n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
        };
        w.fbq = n;
        w._fbq = w._fbq || n;
        n.push = n;
        n.loaded = true;
        n.version = "2.0";
        n.queue = [];
        loadScript("https://connect.facebook.net/en_US/fbevents.js", done);
      }
      for (const p of list) w.fbq("init", p.id);
    },
    TIKTOK: queued("ttq", "https://analytics.tiktok.com/i18n/pixel/events.js"),
    KWAI: queued("kwaiq", "https://s1.kwai.net/kos/s101/nlav11187/pixel/events.js"),
    UTMIFY(list) {
      // O pixel da UTMify lê window.pixelId (um só por página) e dispara os eventos sozinho.
      const p = list[0];
      const o = p.options;
      start([p]);
      for (const extra of list.slice(1)) {
        report("UTMIFY", "load", "ERROR", {
          pixel: extra.id,
          extra: true,
          message: "Só o primeiro pixel da UTMify carrega: a UTMify aceita um pixel por página.",
        });
      }
      w.pixelId = p.id;
      loadScript(`${UTMIFY_URL}pixel/pixel.js`, (ok) => settle("UTMIFY", p.id, ok));
      if (o.utmsScript === false) return;
      const attrs: Record<string, string> = { defer: "" };
      if (o.preventSubids) attrs["data-utmify-prevent-subids"] = "";
      if (o.preventXcodSck) attrs["data-utmify-prevent-xcod-sck"] = "";
      loadScript(
        `${UTMIFY_URL}utms/latest.js`,
        (ok) =>
          report("UTMIFY", "load", ok ? "LOADED" : "BLOCKED", {
            pixel: p.id,
            script: "utms",
            ...(ok ? {} : { hint: BLOCKED_HINT }),
          }),
        attrs,
      );
    },
    GOOGLE(list) {
      const done = start(list);
      const ver = versionOf(cfg);
      gtag("js", new Date());
      // Teste A/B no GA4: propriedade de usuário e parâmetro do page_view (o do config).
      if (ver.os_versao) gtag("set", "user_properties", ver);
      for (const p of list) {
        if (ver.os_versao && p.vendor === "GA4") gtag("config", p.id, ver);
        else gtag("config", p.id);
      }
      loadScript(`https://www.googletagmanager.com/gtag/js?id=${list[0].id}`, done);
    },
  };

  /** Algum script de pixel ainda está carregando (os eventos esperam por ele). */
  const pending = () => Object.keys(states).some((k) => states[k].ok === null);

  return {
    pending,
    /** Resolve quando nenhum script de pixel está carregando, ou depois de `ms`. */
    settled(ms: number) {
      const t0 = Date.now();
      return new Promise<void>((resolve) => {
        const tick = () => (!pending() || Date.now() - t0 >= ms ? resolve() : setTimeout(tick, 50));
        tick();
      });
    },

    /** Carrega os pixels (só depois do consentimento). */
    load() {
      for (const v of ["META", "TIKTOK", "KWAI", "UTMIFY", "GOOGLE"]) {
        const list = v === "GOOGLE" ? [...pixels("GA4"), ...pixels("GOOGLE_ADS")] : pixels(v as Vendor);
        if (list.length && !guard(list[0].vendor, "load", () => loaders[v](list))) {
          for (const p of list) delete states[key(p.vendor, p.id)];
        }
      }
    },

    /**
     * Manda o evento para todas as plataformas com o mesmo eventID e, no teste
     * A/B, a versão (os_versao: custom_data da Meta, properties do TikTok/Kwai,
     * parâmetro do GA4; a conversão do Google Ads vai só com o valor).
     */
    send(ev: Ev, eventId: string) {
      const amount = amountOf(cfg, ev);
      const params = { ...amount, ...versionOf(cfg) };
      const pv = ev === "PAGE_VIEW";
      for (const p of cfg.pixels) {
        const vendor = p.vendor;
        const st = states[key(vendor, p.id)];
        if (!st || vendor === "UTMIFY") continue;
        let name = nameOf(cfg, vendor, ev);
        let sendTo = "";
        if (vendor === "GOOGLE_ADS") {
          // Só vira conversão o evento com rótulo (options.conversionLabels).
          const label = String(((p.options.conversionLabels || {}) as Loose)[ev] || "").trim();
          if (!label) continue;
          name = name || "conversion";
          sendTo = `${p.id}/${label}`;
        }
        if (!name) continue;
        const n = name;
        // O que de fato vai: no PageView só a Meta passa por aqui com parâmetros
        // (ttq.page()/kwaiq.page() não levam nenhum); a conversão do Google Ads leva só o valor.
        const sent = sendTo || (pv && vendor !== "META") ? amount : params;
        const detail: Detail = { event: ev, eventId, pixel: p.id, sendTo, ...sent };
        const first = p === pixels(vendor)[0];
        guard(vendor, n, () => {
          if (vendor === "META") {
            // Um track vale para todos os pixels da Meta iniciados.
            if (first) w.fbq(META_STANDARD.test(n) ? "track" : "trackCustom", n, params, { eventID: eventId });
          } else if (vendor === "TIKTOK") {
            if (first) pv ? w.ttq.page() : w.ttq.track(n, params, { event_id: eventId });
          } else if (vendor === "KWAI") {
            if (!pv) w.kwaiq.instance(p.id).track(n, params);
            else if (first) w.kwaiq.page();
          } else if (sendTo) {
            gtag("event", n, { send_to: sendTo, ...amount });
          } else if (!pv) {
            // GA4: a visualização de página já sai no gtag("config").
            gtag("event", n, { send_to: p.id, event_id: eventId, ...params });
          }
          if (st.ok === null) st.wait.push([n, detail]);
          else result(vendor, n, st.ok, detail);
        });
      }
    },

    /** Visitante mudou de ideia depois de os pixels carregarem: Meta e TikTok param os eventos automáticos. */
    consent(granted: boolean) {
      if (w.fbq) guard("META", "consent", () => w.fbq("consent", granted ? "grant" : "revoke"));
      if (w.ttq) guard("TIKTOK", "consent", () => w.ttq[granted ? "grantConsent" : "revokeConsent"]());
    },
  };
}
