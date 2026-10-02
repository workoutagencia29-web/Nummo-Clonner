/**
 * CSS dos modelos de página. Cada modelo junta o tema (variáveis de cor) com os
 * módulos que usa, num único <style> no <head>. Ao abrir no editor, esse CSS vai
 * para a folha base em camada (@layer os-original): qualquer ajuste feito no
 * painel de estilo vence.
 *
 * Regras:
 * - Toda classe começa com "os-" (não colide com blocos nem com páginas clonadas).
 * - Seletores com `[data-gjs-type]` só casam dentro do editor (o GrapesJS marca
 *   cada elemento do canvas com esse atributo): assim o popup aparece como caixa
 *   editável, o vídeo como marcador etc., sem nenhum script no editor.
 * - Nada de fontes ou imagens externas: a página funciona offline.
 */
import { CSS_ICONS } from "./assets";

export interface TemplateTheme {
  /** Cor dos botões de compra e destaques. */
  primary: string;
  primaryInk: string;
  /** Fundo suave da cor principal (ícones, foco). */
  primarySoft: string;
  /** Sombra colorida do botão. */
  primaryShadow: string;
  /** Cor de apoio (faixas, selos, palavras destacadas). */
  accent: string;
  accentInk: string;
  accentSoft: string;
  ink: string;
  heading: string;
  muted: string;
  bg: string;
  soft: string;
  card: string;
  line: string;
  /** Seções escuras (hero, oferta). */
  dark: string;
  darkInk: string;
  darkMuted: string;
  heroGlow: string;
  footerBg: string;
  footerInk: string;
  countBg: string;
  countInk: string;
  font: string;
  headFont: string;
  radius: string;
  btnRadius: string;
}

export const SANS = `-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif`;
export const SERIF = `Georgia,"Times New Roman",Times,serif`;

const DEFAULT_THEME: TemplateTheme = {
  primary: "#16a34a",
  primaryInk: "#ffffff",
  primarySoft: "#dcfce7",
  primaryShadow: "rgba(22,163,74,.55)",
  accent: "#f59e0b",
  accentInk: "#1f1300",
  accentSoft: "#fde68a",
  ink: "#1e293b",
  heading: "#0f172a",
  muted: "#526079",
  bg: "#ffffff",
  soft: "#f4f6fb",
  card: "#ffffff",
  line: "#e3e8f0",
  dark: "#0b1220",
  darkInk: "#e2e8f0",
  darkMuted: "#a5b1c5",
  heroGlow: "rgba(34,197,94,.22)",
  footerBg: "#060a13",
  footerInk: "#94a3b8",
  countBg: "#0f172a",
  countInk: "#ffffff",
  font: SANS,
  headFont: SANS,
  radius: "18px",
  btnRadius: "14px",
};

export function theme(overrides: Partial<TemplateTheme> = {}): TemplateTheme {
  return { ...DEFAULT_THEME, ...overrides };
}

function themeCss(t: TemplateTheme) {
  return `:root{--os-primary:${t.primary};--os-primary-ink:${t.primaryInk};--os-primary-soft:${t.primarySoft};--os-primary-shadow:${t.primaryShadow};--os-accent:${t.accent};--os-accent-ink:${t.accentInk};--os-accent-soft:${t.accentSoft};--os-ink:${t.ink};--os-heading:${t.heading};--os-muted:${t.muted};--os-bg:${t.bg};--os-soft:${t.soft};--os-card:${t.card};--os-line:${t.line};--os-dark:${t.dark};--os-dark-ink:${t.darkInk};--os-dark-muted:${t.darkMuted};--os-hero-glow:${t.heroGlow};--os-footer-bg:${t.footerBg};--os-footer-ink:${t.footerInk};--os-count-bg:${t.countBg};--os-count-ink:${t.countInk};--os-font:${t.font};--os-head-font:${t.headFont};--os-radius:${t.radius};--os-btn-radius:${t.btnRadius};--os-max:1100px}`;
}

/** Módulos de CSS. Cada modelo inclui só o que usa. */
const MODULES = {
  base: `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;font-family:var(--os-font);font-size:18px;line-height:1.65;color:var(--os-ink);background:var(--os-bg);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;overflow-wrap:break-word}
img,video,iframe{max-width:100%}
img{height:auto;display:block}
h1,h2,h3,h4{font-family:var(--os-head-font);color:var(--os-heading);line-height:1.15;margin:0 0 .5em;letter-spacing:-.02em;font-weight:800}
p{margin:0 0 1em}
a{color:var(--os-primary)}
b,strong{font-weight:800}
.os-container{width:100%;max-width:var(--os-max);margin-left:auto;margin-right:auto;padding-left:20px;padding-right:20px}
.os-narrow{max-width:800px}
.os-section{padding:84px 0}
.os-soft{background:var(--os-soft)}
.os-dark{background:var(--os-dark);color:var(--os-dark-ink)}
.os-dark h1,.os-dark h2,.os-dark h3{color:#fff}
.os-center{text-align:center}
.os-eyebrow{display:block;margin:0 0 14px;font-size:13px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--os-primary)}
.os-dark .os-eyebrow{color:var(--os-accent)}
.os-h1{font-size:clamp(31px,5.4vw,56px);font-weight:900;letter-spacing:-.03em}
.os-h2{font-size:clamp(27px,4vw,42px)}
.os-h3{font-size:clamp(20px,2.4vw,24px)}
.os-lead{font-size:clamp(18px,2.2vw,21px);line-height:1.6;color:var(--os-muted);max-width:760px;margin-left:auto;margin-right:auto}
.os-dark .os-lead{color:var(--os-dark-muted)}
.os-mark{color:var(--os-accent)}
.os-underline{background:linear-gradient(transparent 60%,var(--os-accent-soft) 60%);padding:0 .1em}
.os-muted{color:var(--os-muted)}
.os-note{font-size:14px;color:var(--os-muted);margin:0}
.os-dark .os-note{color:var(--os-dark-muted)}
.os-ph{font-weight:700}
[data-gjs-type] .os-ph{background:#fef08a;color:#713f12;border-radius:4px;padding:0 4px;box-shadow:0 0 0 1px #eab308}
@media (max-width:640px){body{font-size:17px}.os-section{padding:60px 0}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}`,

  button: `
.os-btn{display:inline-block;max-width:100%;padding:20px 38px;border:0;border-radius:var(--os-btn-radius);background:var(--os-primary);color:var(--os-primary-ink);font-family:inherit;font-size:clamp(17px,2.1vw,20px);font-weight:800;line-height:1.25;letter-spacing:.01em;text-align:center;text-decoration:none;cursor:pointer;box-shadow:0 14px 30px -12px var(--os-primary-shadow),inset 0 -3px 0 rgba(0,0,0,.16);transition:transform .15s ease,filter .15s ease}
.os-btn:hover{transform:translateY(-2px);filter:brightness(1.07)}
.os-btn:active{transform:translateY(0)}
.os-btn--xl{padding:24px 44px;font-size:clamp(18px,2.5vw,23px)}
.os-btn--block{display:block;width:100%}
.os-btn--whatsapp{background:#1fae54;color:#fff;box-shadow:0 14px 30px -12px rgba(31,174,84,.6),inset 0 -3px 0 rgba(0,0,0,.16)}
.os-pulse{animation:os-pulse 2.4s ease-in-out infinite}
@keyframes os-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.035)}}
.os-cta{display:flex;flex-direction:column;align-items:center;gap:16px;margin-top:36px}
.os-safe{display:flex;flex-wrap:wrap;justify-content:center;gap:6px 20px;margin:0;padding:0;list-style:none;font-size:14px;font-weight:600;color:var(--os-muted)}
.os-safe li::before{content:"✓";margin-right:6px;color:var(--os-primary);font-weight:900}
.os-dark .os-safe{color:var(--os-dark-muted)}`,

  hero: `
.os-topbar{background:var(--os-accent);color:var(--os-accent-ink);text-align:center;font-size:14px;font-weight:800;line-height:1.4;padding:11px 16px;margin:0}
.os-hero{padding:72px 0 88px;text-align:center;background:radial-gradient(900px 480px at 50% -8%,var(--os-hero-glow),transparent 70%),var(--os-dark);color:var(--os-dark-ink)}
.os-hero .os-h1{max-width:940px;margin-left:auto;margin-right:auto}
.os-pill{display:inline-block;margin:0 0 22px;padding:8px 16px;border-radius:999px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);font-size:13px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#fff}
.os-hero .os-media,.os-hero .os-video{margin-top:40px}
@media (max-width:640px){.os-hero{padding:48px 0 60px}}`,

  media: `
.os-media{max-width:900px;margin-left:auto;margin-right:auto;border-radius:var(--os-radius);overflow:hidden;box-shadow:0 30px 60px -30px rgba(2,6,23,.55)}
.os-media img{width:100%}
.os-figure{margin:0;border-radius:var(--os-radius);overflow:hidden}
.os-figure img{width:100%}
.os-split{display:grid;gap:44px;align-items:center;grid-template-columns:repeat(auto-fit,minmax(min(100%,400px),1fr))}
.os-split .os-h2{margin-bottom:18px}`,

  video: `
.os-video{position:relative;max-width:900px;margin-left:auto;margin-right:auto;border-radius:var(--os-radius);overflow:hidden;background:#020617 url("${CSS_ICONS.play}") center 42%/88px no-repeat;box-shadow:0 30px 70px -30px rgba(0,0,0,.7),0 0 0 1px rgba(255,255,255,.08)}
.os-video iframe{position:relative;z-index:1;display:block;width:100%;height:auto;aspect-ratio:16/9;border:0}
.os-video::after{content:"Seu vídeo aparece aqui";position:absolute;left:0;right:0;top:calc(42% + 58px);text-align:center;font-size:14px;font-weight:600;color:rgba(255,255,255,.6)}
[data-gjs-type] .os-video{background:none}
[data-gjs-type] .os-video::after{display:none}
[data-gjs-type] .os-video>*{width:100%;height:auto;aspect-ratio:16/9}
.os-sound{display:inline-block;margin:18px 0 0;padding:8px 16px;border-radius:999px;background:rgba(255,255,255,.08);font-size:14px;font-weight:700;color:var(--os-dark-ink)}`,

  cards: `
.os-grid{display:grid;gap:22px;margin-top:44px;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))}
.os-card{background:var(--os-card);color:var(--os-ink);border:1px solid var(--os-line);border-radius:var(--os-radius);padding:28px;text-align:left;box-shadow:0 1px 2px rgba(15,23,42,.04),0 14px 34px -20px rgba(15,23,42,.22)}
.os-card h3{font-size:20px;margin:0 0 8px}
.os-card p:not([class]){margin:0;font-size:16px;line-height:1.6;color:var(--os-muted)}
.os-icon{display:flex;align-items:center;justify-content:center;width:54px;height:54px;margin:0 0 18px;border-radius:15px;background:var(--os-primary-soft);font-size:27px;line-height:1}`,

  lists: `
.os-check{display:grid;gap:14px;margin:0 0 1em;padding:0;list-style:none;text-align:left}
.os-check li{position:relative;padding-left:38px;line-height:1.55}
.os-check li::before{content:"";position:absolute;left:0;top:.08em;width:25px;height:25px;border-radius:50%;background:var(--os-primary) url("${CSS_ICONS.check}") center/15px no-repeat}
.os-check--no li::before{background-color:#ef4444;background-image:url("${CSS_ICONS.cross}")}
.os-panel{max-width:800px;margin:40px auto 0;background:var(--os-card);border:1px solid var(--os-line);border-radius:var(--os-radius);padding:34px 30px 18px;text-align:left}
@media (max-width:640px){.os-panel{padding:26px 20px 12px}}`,

  modules: `
.os-modules{display:grid;gap:14px;max-width:880px;margin:44px auto 0;counter-reset:os-mod}
.os-module{display:grid;grid-template-columns:auto 1fr;gap:4px 20px;align-items:start;background:var(--os-card);border:1px solid var(--os-line);border-radius:var(--os-radius);padding:22px 24px;text-align:left}
.os-module::before{counter-increment:os-mod;content:counter(os-mod,decimal-leading-zero);grid-row:span 2;min-width:44px;font-size:30px;font-weight:900;line-height:1;color:var(--os-primary);font-variant-numeric:tabular-nums}
.os-module h3{font-size:19px;margin:0}
.os-module p:not([class]){margin:0;font-size:16px;color:var(--os-muted)}`,

  bonus: `
.os-bonuses{display:grid;gap:18px;max-width:880px;margin:44px auto 0}
.os-bonus{display:grid;grid-template-columns:132px 1fr;gap:24px;align-items:center;background:var(--os-card);border:2px dashed var(--os-accent);border-radius:var(--os-radius);padding:20px;text-align:left}
.os-bonus img{width:132px;border-radius:12px}
.os-bonus h3{font-size:20px;margin:0 0 6px}
.os-bonus p:not([class]){margin:0 0 10px;font-size:16px;color:var(--os-muted)}
.os-tag{display:inline-block;margin:0 0 10px;padding:4px 10px;border-radius:999px;background:var(--os-accent);color:var(--os-accent-ink);font-size:12px;font-weight:900;letter-spacing:.1em;text-transform:uppercase}
.os-value{margin:0;font-size:15px;font-weight:700;color:var(--os-ink)}
.os-value s{color:var(--os-muted);font-weight:500}
@media (max-width:560px){.os-bonus{grid-template-columns:1fr;text-align:center}.os-bonus img{margin:0 auto}}`,

  testimonials: `
.os-quote{display:flex;flex-direction:column;gap:16px}
.os-stars{margin:0;color:#f5a524;font-size:18px;letter-spacing:3px;line-height:1}
.os-quote blockquote{margin:0;font-size:17px;line-height:1.65;color:var(--os-ink)}
.os-person{display:flex;align-items:center;gap:12px;margin-top:auto}
.os-person img{width:48px;height:48px;border-radius:50%;object-fit:cover;flex-shrink:0}
.os-person p:not([class]){margin:0;font-size:13px;line-height:1.4;color:var(--os-muted)}
.os-person strong{display:block;font-size:15px;color:var(--os-heading)}`,

  offer: `
.os-offer{position:relative;max-width:560px;margin:48px auto 0;background:var(--os-card);color:var(--os-ink);border:3px solid var(--os-primary);border-radius:28px;padding:44px 30px 32px;text-align:center;box-shadow:0 40px 90px -40px rgba(2,6,23,.6)}
.os-offer h3{font-size:24px;margin:0 0 20px;color:var(--os-heading)}
.os-offer .os-check{margin:0 0 26px;font-size:16px}
.os-badge{position:absolute;top:-17px;left:50%;transform:translateX(-50%);margin:0;padding:8px 18px;border-radius:999px;background:var(--os-accent);color:var(--os-accent-ink);font-size:13px;font-weight:900;letter-spacing:.08em;white-space:nowrap}
.os-price-from{margin:0;font-size:17px;color:var(--os-muted)}
.os-price-from s{color:#dc2626}
.os-price-label{margin:10px 0 0;font-size:16px;font-weight:800;color:var(--os-heading)}
.os-price{margin:2px 0 4px;font-size:clamp(46px,9vw,70px);font-weight:900;line-height:1.05;letter-spacing:-.03em;color:var(--os-primary)}
.os-price-cash{margin:0 0 26px;font-size:16px;color:var(--os-muted)}
.os-pay{margin:16px 0 0;font-size:13px;color:var(--os-muted)}
@media (max-width:640px){.os-offer{padding:40px 20px 26px}}`,

  guarantee: `
.os-guarantee{display:grid;grid-template-columns:auto 1fr;gap:36px;align-items:center;max-width:900px;margin:0 auto;background:var(--os-card);border:1px solid var(--os-line);border-radius:26px;padding:40px;text-align:left;box-shadow:0 20px 50px -34px rgba(15,23,42,.35)}
.os-guarantee .os-h2{margin-bottom:12px}
.os-guarantee p:not([class]){color:var(--os-muted)}
.os-seal{display:flex;flex-direction:column;align-items:center;justify-content:center;width:156px;height:156px;border-radius:50%;text-align:center;background:radial-gradient(circle at 32% 28%,#fde68a,#f59e0b 72%);color:#3b1d02;box-shadow:inset 0 0 0 7px rgba(255,255,255,.5),0 18px 34px -14px rgba(180,83,9,.65);line-height:1.05}
.os-seal strong{display:block;font-size:54px;font-weight:900;letter-spacing:-.04em}
.os-seal span{display:block;max-width:96px;font-size:12px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}
@media (max-width:680px){.os-guarantee{grid-template-columns:1fr;text-align:center;padding:30px 22px;gap:22px}.os-seal{margin:0 auto}}`,

  faq: `
.os-faq{display:grid;gap:12px;max-width:820px;margin:44px auto 0;text-align:left}
.os-faq details{background:var(--os-card);border:1px solid var(--os-line);border-radius:16px;padding:0 24px}
.os-faq summary{position:relative;padding:20px 36px 20px 0;font-size:18px;font-weight:700;color:var(--os-heading);cursor:pointer;list-style:none}
.os-faq summary::-webkit-details-marker{display:none}
.os-faq summary::after{content:"+";position:absolute;right:0;top:50%;transform:translateY(-50%);font-size:26px;font-weight:500;line-height:1;color:var(--os-primary)}
.os-faq details[open] summary::after{content:"−"}
.os-faq details p:not([class]){margin:0;padding:0 0 22px;font-size:16px;color:var(--os-muted)}`,

  footer: `
.os-footer{background:var(--os-footer-bg);color:var(--os-footer-ink);border-top:1px solid rgba(148,163,184,.14);padding:44px 0;font-size:14px;line-height:1.6;text-align:center}
.os-footer p:not([class]){margin:0 0 8px}
.os-footer a{color:inherit;font-weight:700;text-decoration:none}
.os-footer a:hover{text-decoration:underline}
.os-footer-links{display:flex;flex-wrap:wrap;justify-content:center;gap:8px 26px;margin:0 0 18px;padding:0;list-style:none}
.os-disclaimer{max-width:820px;margin:18px auto 0;font-size:12px;opacity:.75}`,

  countdown: `
.os-timer{margin:0 0 12px;font-size:14px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}
.os-countdown{display:flex;justify-content:center}
.os-cd-units{display:inline-flex;align-items:flex-start;justify-content:center;gap:10px;font-variant-numeric:tabular-nums}
.os-cd-unit{min-width:76px;padding:12px 8px 10px;border-radius:14px;background:var(--os-count-bg);color:var(--os-count-ink);text-align:center;box-shadow:inset 0 -3px 0 rgba(0,0,0,.22)}
.os-cd-num{display:block;font-size:36px;font-weight:900;line-height:1}
.os-cd-lbl{display:block;margin-top:6px;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;opacity:.72}
.os-dark .os-cd-unit{background:rgba(255,255,255,.08);box-shadow:inset 0 0 0 1px rgba(255,255,255,.16)}`,

  form: `
.os-form{display:grid;gap:14px;margin:0;text-align:left}
.os-field{display:grid;gap:6px;margin:0;font-size:14px;font-weight:700;color:var(--os-heading)}
.os-input{display:block;width:100%;min-height:54px;padding:14px 16px;border:1.5px solid #cfd7e3;border-radius:12px;background:#fff;color:var(--os-ink);font-family:inherit;font-size:16px;font-weight:500;outline:none;transition:border-color .15s ease,box-shadow .15s ease}
.os-input::placeholder{color:#94a3b8}
.os-input:focus{border-color:var(--os-primary);box-shadow:0 0 0 4px var(--os-primary-soft)}
.os-form .os-btn{width:100%;margin-top:4px}
.os-consent{margin:0;font-size:12.5px;line-height:1.5;color:var(--os-muted);text-align:center}
.os-consent a{color:inherit}`,

  popup: `
.os-popup{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(2,6,23,.72)}
.os-popup[hidden]{display:none}
.os-popup__box{position:relative;width:100%;max-width:500px;max-height:calc(100vh - 32px);overflow:auto;margin:auto;background:#fff;color:var(--os-ink);border-radius:24px;padding:44px 28px 28px;text-align:center;box-shadow:0 40px 90px -20px rgba(0,0,0,.55);animation:os-pop .25s ease-out}
.os-popup__box h2{font-size:clamp(24px,4vw,30px);margin:0 0 10px}
.os-popup__box p:not([class]){color:var(--os-muted);font-size:17px}
.os-popup__close{position:absolute;top:12px;right:12px;width:38px;height:38px;border:0;border-radius:50%;background:#f1f5f9;color:#334155;font-family:inherit;font-size:24px;line-height:1;cursor:pointer}
.os-popup__decline{display:inline-block;margin-top:16px;padding:0;border:0;background:none;color:var(--os-muted);font-family:inherit;font-size:14px;text-decoration:underline;cursor:pointer}
@keyframes os-pop{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:none}}
[data-gjs-type] .os-popup,[data-gjs-type] .os-popup[hidden]{position:relative;inset:auto;z-index:auto;display:block;max-width:680px;margin:32px auto;padding:16px;background:repeating-linear-gradient(45deg,rgba(139,92,246,.06) 0 12px,transparent 12px 24px);outline:2px dashed #8b5cf6;outline-offset:6px}
[data-gjs-type] .os-popup::before{content:"Popup de saída (aparece ao sair)";display:block;width:max-content;max-width:100%;margin:0 0 12px;padding:5px 10px;border-radius:6px;background:#ede9fe;color:#5b21b6;font:600 12px/1.3 system-ui,-apple-system,sans-serif}
[data-gjs-type] .os-popup__box{max-height:none;animation:none}`,

  notify: `
.os-notify{max-width:360px}
.os-notify[hidden]{display:none}
.os-notify__card{display:flex;align-items:center;gap:12px;padding:12px 16px 12px 12px;border-radius:16px;background:#fff;color:#0f172a;font-size:14px;line-height:1.35;text-align:left;box-shadow:0 18px 44px -12px rgba(15,23,42,.4),0 0 0 1px rgba(15,23,42,.06)}
.os-notify__card img{width:46px;height:46px;border-radius:12px;object-fit:cover;flex-shrink:0}
.os-notify__card p{margin:0}
.os-notify__card strong{display:block;font-size:14px;font-weight:800}
.os-notify__card span{display:block;font-size:13px;color:#334155}
.os-notify__card [data-os-sn=time]{margin-top:2px;font-size:12px;color:#64748b}
[data-gjs-type] .os-notify,[data-gjs-type] .os-notify[hidden]{display:block;margin:32px auto;outline:2px dashed #8b5cf6;outline-offset:6px}
[data-gjs-type] .os-notify::before{content:"Notificação de prova social (aparece no canto da tela)";display:block;width:max-content;max-width:100%;margin:0 0 12px;padding:5px 10px;border-radius:6px;background:#ede9fe;color:#5b21b6;font:600 12px/1.3 system-ui,-apple-system,sans-serif}`,

  delay: `
[data-gjs-type] .os-delayed{position:relative;padding-top:40px}
[data-gjs-type] .os-delayed::before{content:"Aparece depois do tempo definido em Configurações › \\"Aparece depois de (segundos)\\"";position:absolute;top:8px;left:0;right:0;text-align:center;font:700 12px/1.3 system-ui,sans-serif;color:#c2410c}`,
} as const;

export type CssModule = keyof typeof MODULES;

/** Junta o tema e os módulos num CSS compacto (sem comentários nem quebras). */
export function buildCss(t: TemplateTheme, modules: CssModule[], extra = "") {
  const parts = [
    themeCss(t),
    MODULES.base,
    ...[...new Set(modules)].filter((m) => m !== "base").map((m) => MODULES[m]),
  ];
  if (extra) parts.push(extra);
  return parts.join("\n").replace(/\n\s*/g, "").trim();
}
