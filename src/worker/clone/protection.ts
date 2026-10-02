/**
 * Proteção anti-robô: reconhece páginas que não dá para clonar
 * automaticamente (desafio Cloudflare, DataDome, PerimeterX, Akamai, captcha,
 * login, página vazia, erro HTTP) e explica em português o que fazer.
 *
 * Só detecta e explica — nunca tenta contornar.
 */
import type { ProtectionReport } from "./types";

export interface ProtectionInput {
  status: number;
  /** Cabeçalhos da resposta do documento (qualquer caixa; set-cookie pode vir junto com \n). */
  headers: Record<string, string>;
  html: string;
  title: string;
  /** Tamanho do texto visível do body (innerText). */
  bodyTextLength: number;
}

/**
 * Alternativa oferecida quando não dá para clonar automaticamente. "Salvar
 * como (página completa)" cria um .html e uma pasta "_files": o ZIP precisa
 * dos dois. A tela de falha troca esta frase pelo passo a passo (import-steps.ts).
 */
export const IMPORT_HINT =
  "Abra a página no seu navegador e salve com Arquivo → Salvar como (página completa); compacte o arquivo .html junto com a pasta “_files” num ZIP, ou copie o HTML, e importe aqui.";

/** Abaixo disso a página é considerada "quase sem texto". */
const THIN_TEXT = 500;
const BLOCK_STATUS = new Set([401, 403, 405, 429, 503]);

function botChallenge(vendor: string, detail: string): ProtectionReport {
  return {
    kind: "BOT_CHALLENGE",
    message: `Esta página tem proteção contra robôs (${vendor}). Não é possível clonar automaticamente. ${IMPORT_HINT}`,
    detail,
  };
}

function captcha(vendor: string, detail: string): ProtectionReport {
  return {
    kind: "CAPTCHA",
    message: `Esta página pede uma verificação "não sou um robô" (${vendor}). Não é possível clonar automaticamente. ${IMPORT_HINT}`,
    detail,
  };
}

function httpError(status: number): ProtectionReport {
  const detail = `HTTP ${status}`;
  let message: string;
  if (status === 404 || status === 410) {
    message = `A página não foi encontrada (erro ${status}). Confira se o endereço está certo e se a página ainda está no ar.`;
  } else if (status === 401 || status === 403) {
    message = `O site recusou o acesso a esta página (erro ${status}). ${IMPORT_HINT}`;
  } else if (status === 429) {
    message = "O site recebeu acessos demais e pediu para esperar (erro 429). Tente de novo em alguns minutos.";
  } else if (status >= 500) {
    message = `O servidor do site está com problema (erro ${status}). Tente de novo mais tarde.`;
  } else {
    message = `O site respondeu com erro (erro ${status}). Confira o endereço e tente de novo.`;
  }
  return { kind: "HTTP_ERROR", message, detail };
}

const LOGIN_WALL: Omit<ProtectionReport, "detail"> = {
  kind: "LOGIN_WALL",
  message:
    "Esta página pede login e senha antes de mostrar o conteúdo, e o clonador não entra em áreas restritas. Se você tem acesso, abra a página no seu navegador já logado e salve com Arquivo → Salvar como (página completa); compacte o arquivo .html junto com a pasta “_files” num ZIP, ou copie o HTML, e importe aqui.",
};

const EMPTY_SHELL: Omit<ProtectionReport, "detail"> = {
  kind: "EMPTY_SHELL",
  message: `A página abriu praticamente vazia: o conteúdo é montado por JavaScript que não carregou ou fica escondido de acessos automáticos. ${IMPORT_HINT}`,
};

// ─── Padrões ─────────────────────────────────────────────────────────────────

const CF_TITLE =
  /^\s*(?:just a moment|um momento|um instante|attention required|checking your browser|verificando (?:seu navegador|se a conex)|one more step|mais uma etapa|access denied \|.*cloudflare)/i;
const CF_STRONG =
  /_cf_chl_opt|cf-chl-|cf_chl_|\/cdn-cgi\/challenge-platform\/h\/|id=["']?challenge-(?:running|stage|body|form)|cf-browser-verification|used cloudflare to restrict access|sorry, you have been blocked/i;
const CF_WEAK = /\/cdn-cgi\/challenge-platform\/|cf-turnstile|challenges\.cloudflare\.com/i;

const DATADOME_PAGE = /captcha-delivery\.com|geo\.captcha-delivery|dd=\{['"]?rt['"]?\s*:\s*['"]?[ci]/i;
const PX_PAGE = /px-captcha|captcha\.px-cdn\.net|_pxCaptcha|press (?:&amp;|&) hold/i;
const AKAMAI_PAGE = /\/_sec\/cp_challenge|sec-if-cpt-container|sec-cpt-if|errors\.edgesuite\.net|Reference&#32;&#35;/i;

const RECAPTCHA = /(?:google\.com|recaptcha\.net)\/recaptcha|class=["'][^"']*\bg-recaptcha\b/i;
const HCAPTCHA = /hcaptcha\.com|class=["'][^"']*\bh-captcha\b/i;
const CAPTCHA_TITLE =
  /captcha|verifica[çc][ãa]o de seguran[çc]a|security check|are you (?:a )?(?:human|robot)|n[ãa]o sou um rob[ôo]|confirme que (?:voc[êe] )?(?:[ée] )?humano|verify you are human/i;
const CAPTCHA_TEXT =
  /verify (?:that )?you are (?:a )?human|confirme que (?:voc[êe] )?(?:[ée] )?humano|n[ãa]o sou um rob[ôo]|complete the security check|prove you'?re not a robot|verifica[çc][ãa]o de seguran[çc]a/i;
/** Campos de formulário comuns (squeeze page com captcha não é desafio). */
const FORM_FIELD = /<input\b[^>]*\btype\s*=\s*["']?(?:email|tel|text|number)\b/i;

const PASSWORD_INPUT = /<input\b[^>]*\btype\s*=\s*["']?password\b/i;
const WP_PROTECTED = /post-password-form|wp-login\.php\?action=postpass/i;
const LOGIN_TITLE =
  /login|log in|sign in|entrar|acesse sua conta|acessar conta|[áa]rea de membros|area do aluno|members area|minha conta/i;

const EMPTY_MOUNT =
  /<div\b[^>]*\bid\s*=\s*["']?(root|app|__next|__nuxt|svelte|main-app)["']?[^>]*>\s*<\/div>|<(app-root)\b[^>]*>\s*<\/app-root>/i;
const NOSCRIPT_JS =
  /<noscript\b[^>]*>[\s\S]{0,300}?(?:enable javascript|javascript (?:is )?(?:required|disabled)|habilite o javascript|ative o javascript|precisa (?:ativar|habilitar) o javascript)/i;
const BUNDLE_HINT =
  /\/_next\/static\/|\/static\/js\/main\.|\/assets\/index-[\w-]+\.js|\bapp\.[a-f0-9]{6,}\.js|chunk|bundle/i;

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    const k = key.toLowerCase();
    out[k] = out[k] ? `${out[k]}\n${value}` : String(value);
  }
  return out;
}

function hasCookie(setCookie: string, name: string): boolean {
  return new RegExp(`(?:^|[\\n,;]\\s*)${name}=`, "i").test(setCookie);
}

function countMatches(text: string, re: RegExp): number {
  return text.match(re)?.length ?? 0;
}

/**
 * Diz se a página capturada é um bloqueio/desafio/página vazia.
 * Devolve null quando a página parece normal.
 */
export function detectProtection(input: ProtectionInput): ProtectionReport | null {
  const { status, title = "", bodyTextLength } = input;
  const html = input.html ?? "";
  const headers = normalizeHeaders(input.headers);
  const cookies = headers["set-cookie"] ?? "";
  const thin = bodyTextLength < THIN_TEXT;
  const blocked = BLOCK_STATUS.has(status);

  // Cloudflare
  const mitigated = headers["cf-mitigated"];
  if (mitigated && /challenge/i.test(mitigated)) return botChallenge("Cloudflare", `cf-mitigated: ${mitigated}`);
  const cfServer = /cloudflare/i.test(headers.server ?? "") || !!headers["cf-ray"];
  const cfTitle = CF_TITLE.test(title);
  const cfStrong = CF_STRONG.exec(html);
  if (cfStrong && (thin || cfTitle || blocked)) return botChallenge("Cloudflare", `página de desafio (${cfStrong[0]})`);
  if (cfTitle && (cfServer || blocked || CF_WEAK.test(html)))
    return botChallenge("Cloudflare", `título "${title.trim()}"`);
  const cfWeak = CF_WEAK.exec(html);
  if (cfWeak && thin && (cfServer || blocked || /turnstile/i.test(cfWeak[0]))) {
    return botChallenge("Cloudflare", `página de desafio (${cfWeak[0]})`);
  }

  // DataDome
  const ddPage = DATADOME_PAGE.exec(html);
  if (ddPage) return botChallenge("DataDome", ddPage[0]);
  if (blocked && (headers["x-datadome"] || hasCookie(cookies, "datadome"))) {
    return botChallenge("DataDome", `HTTP ${status} + datadome`);
  }

  // PerimeterX / HUMAN
  const pxPage = PX_PAGE.exec(html);
  if (pxPage) return botChallenge("PerimeterX/HUMAN", pxPage[0]);
  if (hasCookie(cookies, "_pxhd") && (blocked || (thin && /_pxAppId|perimeterx/i.test(html)))) {
    return botChallenge("PerimeterX/HUMAN", `HTTP ${status} + _pxhd`);
  }

  // Akamai Bot Manager
  const akPage = AKAMAI_PAGE.exec(html);
  const akCookie = ["_abck", "ak_bmsc", "bm_sz"].find((c) => hasCookie(cookies, c));
  const akServer = /akamai/i.test(headers.server ?? "");
  const accessDenied = /access denied/i.test(title) || /<h1>\s*access denied/i.test(html);
  if (akPage && (thin || blocked || akCookie || akServer)) return botChallenge("Akamai", akPage[0]);
  if (akCookie && (blocked || (thin && accessDenied))) return botChallenge("Akamai", `HTTP ${status} + ${akCookie}`);
  if (akServer && blocked && accessDenied) return botChallenge("Akamai", `HTTP ${status} (AkamaiGHost)`);

  // reCAPTCHA / hCaptcha em página de desafio
  const vendor = HCAPTCHA.test(html) ? "hCaptcha" : RECAPTCHA.test(html) ? "reCAPTCHA" : null;
  if (vendor) {
    const challengeLike =
      CAPTCHA_TITLE.test(title) ||
      (thin && CAPTCHA_TEXT.test(html)) ||
      (bodyTextLength < 250 && !FORM_FIELD.test(html));
    if (challengeLike) return captcha(vendor, `${vendor} com pouco conteúdo`);
  }

  // Login antes do erro HTTP quando o servidor responde 401/403 com formulário.
  const login = detectLoginWall(html, title, bodyTextLength);
  if (login && (status === 401 || status === 403)) return login;

  if (status >= 400) return httpError(status);
  if (login) return login;

  return detectEmptyShell(html, bodyTextLength);
}

function detectLoginWall(html: string, title: string, bodyTextLength: number): ProtectionReport | null {
  if (WP_PROTECTED.test(html)) return { ...LOGIN_WALL, detail: "página protegida por senha (WordPress)" };
  if (!PASSWORD_INPUT.test(html)) return null;
  if (bodyTextLength < 600 || (LOGIN_TITLE.test(title) && bodyTextLength < 1500)) {
    return { ...LOGIN_WALL, detail: "campo de senha e quase nenhum conteúdo" };
  }
  return null;
}

function detectEmptyShell(html: string, bodyTextLength: number): ProtectionReport | null {
  if (bodyTextLength >= 200) return null;
  const media =
    countMatches(html, /<img\b/gi) +
    countMatches(html, /<(?:video|iframe|picture|canvas|svg)\b/gi) +
    countMatches(html, /background(?:-image)?\s*:\s*url\(/gi);
  const mount = EMPTY_MOUNT.exec(html);
  if (mount && media < 3)
    return { ...EMPTY_SHELL, detail: `#${mount[1] ?? mount[2]} vazio (página montada por JavaScript)` };
  if (NOSCRIPT_JS.test(html) && media < 3) return { ...EMPTY_SHELL, detail: "página exige JavaScript" };
  const scripts = countMatches(html, /<script\b[^>]*\bsrc\s*=/gi);
  if (media === 0 && (scripts >= 3 || (scripts > 0 && BUNDLE_HINT.test(html)))) {
    return { ...EMPTY_SHELL, detail: `${bodyTextLength} caracteres de texto e ${scripts} scripts` };
  }
  if (media === 0 && bodyTextLength < 20) return { ...EMPTY_SHELL, detail: "página sem conteúdo visível" };
  return null;
}
