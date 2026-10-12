/**
 * Clonar o funil inteiro: o robô clica pela página como uma pessoa faria para
 * achar a próxima etapa quando ela só aparece depois de interagir — responde o
 * quiz (a primeira opção de cada pergunta, "Continuar", "Ver resultado"…), gira
 * a roleta e clica em "Resgatar", passa pelas telas de "Analisando…".
 *
 * Roda DEPOIS da cópia e do print (a página copiada é a tela inicial). Quem
 * chama (capture.ts) intercepta as navegações enquanto o robô explora: a página
 * nova é anotada e a navegação é interrompida (o robô fica na página). Nunca
 * digita e-mail, telefone, CPF, senha ou cartão: numa etapa que pede contato, o
 * robô para. Campos genéricos obrigatórios (nome, idade, peso…) recebem um
 * valor neutro para o quiz andar.
 */
import type { Page } from "playwright";
import type { ExploreReport } from "./types";

export interface ExploreOptions {
  page: Page;
  /** Navegações anotadas até agora (a página saiu daqui). */
  navigated: () => boolean;
  /** Texto do botão clicado agora (vai junto da navegação anotada). */
  setLabel: (label: string) => void;
  maxMs?: number;
  maxClicks?: number;
  signal?: AbortSignal;
}

/** Quiz longo (25 perguntas, telas de "Analisando…") cabe com folga; a captura tem 5 min. */
export const EXPLORE_MAX_MS = 120_000;
export const EXPLORE_MAX_CLICKS = 60;

/** Atributo posto pelo robô nos candidatos a clique (só na página aberta no robô; a cópia já foi feita). */
const ID_ATTR = "data-os-explore";

interface Candidate {
  id: string;
  label: string;
  score: number;
  /** Faz parte de um grupo de opções (quiz). */
  option: string | null;
  /** Girar a roleta: a animação demora. */
  slow: boolean;
}

interface Screen {
  key: string;
  candidates: Candidate[];
  /** A etapa pede contato (e-mail, telefone, CPF…): o robô não preenche. */
  contact: boolean;
  /** Tela de espera ("Analisando suas respostas…"). */
  loading: boolean;
  /** Campos obrigatórios genéricos vazios (o robô preenche). */
  fill: { id: string; value: string }[];
}

/**
 * Lê a tela atual dentro da página: candidatos a clique, campos e um resumo do
 * que está à mostra. Função executada no navegador (sem nada de fora dela).
 */
function readScreen(attr: string): Screen {
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) return false;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) < 0.05) return false;
    if (s.pointerEvents === "none") return false;
    return !el.closest("[aria-hidden=true], [hidden], [inert]");
  };
  const body = document.body;
  // Elementos da página e dos shadow roots abertos (quiz em web component, como o Typebot).
  const all: Element[] = [];
  const collect = (root: ParentNode) => {
    for (const el of Array.from(root.querySelectorAll("*"))) {
      if (all.length >= 6000) return;
      all.push(el);
      if (el.shadowRoot) collect(el.shadowRoot);
    }
  };
  if (body) collect(body);
  // O que está à mostra (com o texto dos shadow roots: a etapa nova pode estar só lá).
  const shadowText = all
    .filter((el) => el.shadowRoot)
    .map((el) => el.shadowRoot?.textContent ?? "")
    .join(" ");
  const text = norm(`${body ? body.innerText : ""} ${shadowText}`).slice(0, 6000);
  let hash = 0;
  const keySource = `${location.pathname}${location.search}|${text}`;
  for (let i = 0; i < keySource.length; i++) hash = (hash * 31 + keySource.charCodeAt(i)) | 0;

  const STOP_WORDS =
    /\b(voltar|anterior|back|fechar|close|cancelar|cancel|sair|logout|login|entrar|whatsapp|compartilhar|share|privacidade|politica|termos|terms|cookies? settings|preferencias|configurar|recusar|rejeitar|nao aceito|idioma|language|menu)\b|^x$|^×$/;
  const CTA_WORDS =
    /\b(continuar|continue|proximo|proxima|avancar|seguir|prosseguir|comecar|iniciar|start|next|responder|enviar|ver (o |meu |minha |seu |sua )?resultado|resultado|descobrir|descubra|liberar|desbloquear|resgatar|resgate|pegar|garantir|girar|gire|gira|rodar|spin|quero|sim|ok|confirmar|aceitar|acessar|ver oferta|ver desconto|ver produtos|ir para|clique aqui|toque aqui)\b/;
  const SLOW_WORDS = /\b(girar|gire|gira|rodar|spin|roleta|sortear)\b/;
  const LOADING_WORDS =
    /\b(analisando|carregando|calculando|processando|aguarde|preparando|gerando|verificando|loading|analyzing|calculating)\b/;
  // Dados pessoais de contato: o robô NÃO preenche (nem manda um formulário pela metade).
  const CONTACT_RE = /e-?mail|telefone|celular|whats|phone|cpf|cnpj|documento|rg\b|senha|password|cart[aã]o|card|cvv/;
  // CEP: código postal público (não é dado pessoal). Preenchido com um CEP real
  // genérico para a loja/checkout puxar o endereço pela API e o funil seguir.
  const CEP_RE = /\bcep\b|postal|zip/;
  const CEP_VALUE = "01001000";

  // Campos à mostra.
  let contact = false;
  const fill: { id: string; value: string }[] = [];
  let n = 0;
  for (const input of all.filter((el) => /^(?:INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) {
    const el = input as HTMLInputElement;
    if (!visible(el) || el.disabled || el.readOnly) continue;
    // Newsletter do rodapé não é etapa do funil.
    if (el.closest("footer, nav, [role=contentinfo]")) continue;
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (["hidden", "submit", "button", "checkbox", "radio", "range", "file", "image", "reset", "color"].includes(type))
      continue;
    const hint = norm(
      `${type} ${el.name || ""} ${el.id || ""} ${el.getAttribute("placeholder") || ""} ${el.getAttribute("autocomplete") || ""} ${el.getAttribute("aria-label") || ""}`,
    );
    const isCep = CEP_RE.test(hint);
    if (!isCep && (type === "email" || type === "tel" || type === "password" || CONTACT_RE.test(hint))) {
      if (!el.value) contact = true;
      continue;
    }
    if (el.value) continue;
    const id = `f${n++}`;
    el.setAttribute(attr, id);
    if (el.tagName === "SELECT") {
      const opts = (el as unknown as HTMLSelectElement).options;
      const pick = Array.from(opts).find((o, i) => i > 0 && o.value && !o.disabled);
      if (pick) fill.push({ id, value: pick.value });
      continue;
    }
    const value = isCep
      ? CEP_VALUE
      : /idade|age|anos/.test(hint)
        ? "30"
        : /peso|weight|kg/.test(hint)
          ? "70"
          : /altura|height|cm/.test(hint)
            ? "165"
            : type === "number"
              ? "30"
              : type === "date"
                ? "1995-05-10"
                : "Maria";
    fill.push({ id, value });
  }

  // Candidatos a clique: o elemento clicável mais de fora (o cursor "pointer" passa para os filhos).
  const clickable = (el: Element) => {
    const tag = el.tagName;
    if (tag === "BUTTON" || tag === "SUMMARY") return true;
    if (tag === "INPUT")
      return ["submit", "button", "radio", "checkbox", "image"].includes((el as HTMLInputElement).type);
    const role = el.getAttribute("role");
    if (role && /^(button|radio|option|checkbox|menuitem|tab|link)$/.test(role)) return true;
    if (el.hasAttribute("onclick")) return true;
    if (tag === "A") return true;
    if (tag === "LABEL") return true;
    return getComputedStyle(el).cursor === "pointer";
  };
  const picked: Element[] = [];
  for (const el of all) {
    if (el.closest("svg") && el.tagName !== "svg") continue;
    if (!clickable(el)) continue;
    const parent = el.parentElement;
    if (parent && parent !== body && clickable(parent) && !["BODY", "HTML"].includes(parent.tagName)) {
      // O pai já é clicável: fica o de fora, a não ser que o pai seja um contêiner grande (seção inteira).
      const pr = parent.getBoundingClientRect();
      if (pr.height < window.innerHeight * 0.9) continue;
    }
    if (!visible(el)) continue;
    if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") continue;
    if (el.closest("header, nav, footer, [role=navigation], [role=banner], [role=contentinfo]")) continue;
    if (el.tagName === "A") {
      const href = (el.getAttribute("href") || "").trim();
      // Link que já leva a outra página: lido no HTML, não precisa de clique.
      if (href && !href.startsWith("#") && !/^javascript:/i.test(href)) continue;
    }
    picked.push(el);
  }

  // Grupos de opções: irmãos parecidos (mesma tag e classe), 2 ou mais, com texto curto ou imagem.
  const groupOf = new Map<Element, string>();
  let g = 0;
  for (const el of picked) {
    if (groupOf.has(el) || !el.parentElement) continue;
    const sig = `${el.tagName}|${el.className && typeof el.className === "string" ? el.className : ""}`;
    const peers = picked.filter(
      (p) =>
        p.parentElement === el.parentElement &&
        `${p.tagName}|${p.className && typeof p.className === "string" ? p.className : ""}` === sig,
    );
    if (peers.length < 2) continue;
    const short = peers.every((p) => {
      const t = norm((p as HTMLElement).innerText || "");
      return (t.length > 0 && t.length <= 90) || p.querySelector("img");
    });
    if (!short) continue;
    const name = `g${g++}`;
    for (const p of peers) groupOf.set(p, name);
  }

  const candidates: Candidate[] = [];
  let c = 0;
  for (const el of picked) {
    const label = ((el as HTMLElement).innerText || el.getAttribute("aria-label") || el.getAttribute("value") || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    const t = norm(label);
    if (STOP_WORDS.test(t)) continue;
    const option = groupOf.get(el) ?? null;
    let score = 10;
    if (CTA_WORDS.test(t)) score = 70;
    else if (option) score = 50;
    else if (el.tagName === "BUTTON" || (el as HTMLInputElement).type === "submit") score = 40;
    else if (!t && !el.querySelector("img")) continue;
    const id = `c${c++}`;
    el.setAttribute(attr, id);
    candidates.push({ id, label, score, option, slow: SLOW_WORDS.test(t) });
  }
  return {
    key: String(hash),
    candidates,
    contact,
    loading: LOADING_WORDS.test(text) && text.length < 1500,
    fill,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Espera a tela mudar (ou a página navegar), no máximo `ms`. */
async function waitForChange(page: Page, attr: string, before: string, ms: number, navigated: () => boolean) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (navigated()) return true;
    await sleep(250);
    const now = await page.evaluate(readScreen, attr).catch(() => null);
    if (!now) return navigated();
    if (now.key !== before) return true;
  }
  return false;
}

/** Clica pela página até ela levar a outra página, travar, pedir contato ou acabar o tempo. */
export async function explorePage(opts: ExploreOptions): Promise<ExploreReport> {
  const { page, navigated, signal } = opts;
  const maxMs = opts.maxMs ?? EXPLORE_MAX_MS;
  const maxClicks = opts.maxClicks ?? EXPLORE_MAX_CLICKS;
  const start = Date.now();
  const screens = new Set<string>();
  /** Por tela: quantas vezes cada candidato já foi clicado e grupos de opções respondidos. */
  const tried = new Map<string, Map<string, number>>();
  const answered = new Map<string, Set<string>>();
  const visits = new Map<string, number>();
  /** Esperas seguidas numa tela sem nada para clicar (pode estar montando por atraso/animação). */
  let emptyWaits = 0;
  let clicks = 0;

  while (true) {
    if (signal?.aborted) return { clicks, screens: screens.size, stop: "time" };
    if (navigated()) return { clicks, screens: screens.size, stop: "navigated" };
    if (Date.now() - start > maxMs) return { clicks, screens: screens.size, stop: "time" };
    if (clicks >= maxClicks) return { clicks, screens: screens.size, stop: "limit" };

    const screen = await page.evaluate(readScreen, ID_ATTR).catch(() => null);
    if (!screen) return { clicks, screens: screens.size, stop: navigated() ? "navigated" : "stuck" };
    screens.add(screen.key);
    const seen = (visits.get(screen.key) ?? 0) + 1;
    visits.set(screen.key, seen);
    if (seen > 12) return { clicks, screens: screens.size, stop: "stuck" };

    // Etapa que pede contato (e-mail, telefone, CPF…): o robô para aqui — nada de
    // mandar um formulário pela metade ao dono do site.
    if (screen.contact) return { clicks, screens: screens.size, stop: "contact" };

    // Tela de espera: dá tempo para ela passar sozinha.
    if (screen.loading && seen <= 2) {
      await waitForChange(page, ID_ATTR, screen.key, 15_000, navigated);
      continue;
    }

    // Campos genéricos obrigatórios (nome, idade…): preenche para a etapa andar.
    for (const f of screen.fill) {
      const field = page.locator(`[${ID_ATTR}="${f.id}"]`).first();
      const tag = await field.evaluate((el) => el.tagName).catch(() => "");
      if (tag === "SELECT") {
        await field.selectOption(f.value, { timeout: 1500 }).catch(() => {});
      } else {
        await field.fill(f.value, { timeout: 1500 }).catch(() => {});
        // Sair do campo dispara a busca do CEP (a loja/checkout puxa o endereço no "blur").
        await field.evaluate((el) => (el as HTMLElement).blur()).catch(() => {});
      }
    }

    const done = tried.get(screen.key) ?? new Map<string, number>();
    tried.set(screen.key, done);
    const groups = answered.get(screen.key) ?? new Set<string>();
    answered.set(screen.key, groups);
    // Quantas vezes vale clicar o mesmo candidato na mesma tela: a roleta às vezes
    // precisa de dois giros e o texto da tela não muda entre eles (só a roda anima);
    // um botão único que não fez nada também pode precisar de um 2º toque. Opção de
    // quiz e botão comum: uma vez só (não reenviar nem desmarcar).
    const tryKey = (c: Candidate) => `${c.label}|${c.option ?? ""}`;
    const sole = screen.candidates.length === 1;
    const budget = (c: Candidate) => (c.slow ? 3 : sole && c.score >= 40 ? 3 : 1);
    // Pergunta ainda sem resposta: a primeira opção de cada grupo vem antes do "Continuar".
    const next = screen.candidates
      .filter((c) => (done.get(tryKey(c)) ?? 0) < budget(c))
      .map((c, i) => ({ c, i, score: c.option ? (groups.has(c.option) ? 20 : 80) : c.score }))
      .sort((a, b) => b.score - a.score || a.i - b.i)[0];
    if (!next) {
      // Nada para clicar: a tela pode estar montando (atraso, animação da roleta).
      // Espera e relê algumas vezes antes de desistir.
      if (emptyWaits < 3) {
        emptyWaits++;
        await waitForChange(page, ID_ATTR, screen.key, 5000, navigated);
        continue;
      }
      return { clicks, screens: screens.size, stop: "stuck" };
    }
    emptyWaits = 0;
    const { c } = next;
    done.set(tryKey(c), (done.get(tryKey(c)) ?? 0) + 1);
    if (c.option) groups.add(c.option);

    opts.setLabel(c.label);
    const target = page.locator(`[${ID_ATTR}="${c.id}"]`).first();
    clicks++;
    const ok = await target
      .click({ timeout: 2500 })
      .then(() => true)
      .catch(() => false);
    if (!ok) await target.evaluate((el) => (el as HTMLElement).click()).catch(() => {});
    const changed = await waitForChange(page, ID_ATTR, screen.key, c.slow ? 12_000 : 3_000, navigated);
    if (changed && !navigated()) await sleep(c.slow ? 1200 : 400);
  }
}

// ─── Vitrine montada por script ──────────────────────────────────────────────

export const EXPLORE_CARDS_MAX = 30;

/**
 * Cartões de produto que NÃO são links (o clique chama um script, comum nas
 * lojas feitas em React): foto + preço + clicável, sem <a href> dentro. Marca
 * cada um com o índice e devolve o nome do produto. Função executada no navegador.
 */
function readCards(attr: string): string[] {
  const PRICE = /(?:R\$|US\$|MX\$|\$|€|£)\s?\d/;
  const clickable = (el: Element) =>
    el.hasAttribute("onclick") ||
    ["button", "link"].includes(el.getAttribute("role") || "") ||
    getComputedStyle(el).cursor === "pointer";
  const out: string[] = [];
  const seen = new Set<Element>();
  for (const el of Array.from(document.querySelectorAll("body *")).slice(0, 8000)) {
    if (!clickable(el) || el.closest("header, nav, footer, [role=navigation]")) continue;
    if (el.tagName === "A" && (el.getAttribute("href") || "").replace(/^#.*/, "")) continue;
    // O de fora: o pai clicável já conta.
    const parent = el.parentElement;
    if (parent && clickable(parent) && parent.getBoundingClientRect().height < window.innerHeight * 0.9) continue;
    const text = ((el as HTMLElement).innerText || "").replace(/\s+/g, " ").trim();
    if (!PRICE.test(text) || text.length > 400 || !el.querySelector("img, picture, [style*=background-image]"))
      continue;
    if (el.querySelector("a[href]:not([href^='#']):not([href^='javascript'])")) continue;
    let inside = false;
    for (const s of seen) if (s.contains(el)) inside = true;
    if (inside) continue;
    seen.add(el);
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) continue;
    el.setAttribute(attr, `card${out.length}`);
    const heading = el.querySelector("h1, h2, h3, h4, h5, h6, [class*=title], [class*=name], [class*=nome]");
    const name = ((heading as HTMLElement | null)?.innerText || text.split(PRICE)[0] || text)
      .replace(/\s+/g, " ")
      .trim();
    out.push(name.slice(0, 80));
  }
  return out;
}

export interface ExploreCardsOptions {
  page: Page;
  /** Quantas navegações foram anotadas até agora. */
  navigations: () => number;
  setLabel: (label: string) => void;
  /** Endereço da vitrine (para voltar depois de uma navegação sem recarregar). */
  storeUrl: string;
  maxMs?: number;
  signal?: AbortSignal;
}

/** Há cartões de produto que só abrem por script? (decide se vale explorar a vitrine) */
export async function hasScriptCards(page: Page): Promise<boolean> {
  return page
    .evaluate(readCards, ID_ATTR)
    .then((cards) => cards.length >= 2)
    .catch(() => false);
}

/**
 * Clica em cada cartão de produto que só abre por script e anota para onde ele
 * leva. Num site-aplicativo a página muda sem recarregar: o robô volta para a
 * vitrine (history.back) antes do próximo cartão.
 */
export async function exploreCards(opts: ExploreCardsOptions): Promise<ExploreReport> {
  const { page, signal } = opts;
  const maxMs = opts.maxMs ?? EXPLORE_MAX_MS;
  const start = Date.now();
  let clicks = 0;
  for (let i = 0; i < EXPLORE_CARDS_MAX; i++) {
    if (signal?.aborted || Date.now() - start > maxMs) return { clicks, screens: 1, stop: "time" };
    const cards = await page.evaluate(readCards, ID_ATTR).catch(() => [] as string[]);
    if (i >= cards.length) break;
    opts.setLabel(cards[i] ?? "");
    const before = opts.navigations();
    const target = page.locator(`[${ID_ATTR}="card${i}"]`).first();
    clicks++;
    const ok = await target
      .click({ timeout: 2500 })
      .then(() => true)
      .catch(() => false);
    if (!ok) await target.evaluate((el) => (el as HTMLElement).click()).catch(() => {});
    const until = Date.now() + 2500;
    while (Date.now() < until && opts.navigations() === before) await sleep(150);
    // Site-aplicativo: o endereço mudou sem recarregar — volta para a vitrine.
    const now = page.url().split("#")[0];
    if (now !== opts.storeUrl) {
      await page.evaluate(() => history.back()).catch(() => {});
      const back = Date.now() + 4000;
      while (Date.now() < back && page.url().split("#")[0] !== opts.storeUrl) await sleep(150);
      await sleep(600);
    }
  }
  return { clicks, screens: 1, stop: clicks ? "navigated" : "stuck" };
}
