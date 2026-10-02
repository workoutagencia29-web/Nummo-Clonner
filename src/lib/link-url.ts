/**
 * Conferência dos endereços dos links da oferta (checkouts, WhatsApp…), sem
 * rede: pega o erro de digitação comum de colar só "pay.kiwify" (sem o .com.br)
 * e avisa, sem bloquear, quando o checkout não tem o código do produto.
 * Usado na ação (src/server/actions/offer-links.ts) e na aba "Links e checkouts".
 */

/**
 * Plataformas de checkout conhecidas (nome no endereço → endereço completo de
 * exemplo). Se o nome é o fim do endereço ("pay.kiwify"), faltou o domínio.
 */
const CHECKOUT_PLATFORMS: Record<string, string> = {
  hotmart: "pay.hotmart.com",
  kiwify: "pay.kiwify.com.br",
  eduzz: "sun.eduzz.com",
  monetizze: "app.monetizze.com.br",
  braip: "ev.braip.com",
  perfectpay: "go.perfectpay.com.br",
  ticto: "checkout.ticto.app",
  kirvano: "pay.kirvano.com",
  greenn: "payfast.greenn.com.br",
  cakto: "pay.cakto.com.br",
  lastlink: "lastlink.com",
  doppus: "checkout.doppus.app",
  yampi: "seguro.yampi.com.br",
  cartpanda: "cartpanda.com",
  pepper: "checkout.pepper.com.br",
};

const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
/** Fim do endereço: 2+ letras (com, br, app, store…) ou domínio internacional (xn--…). */
const TLD_RE = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/;

/** "pay.kiwify.com.br" → "kiwify" (a plataforma conhecida no endereço, se houver). */
function platformOf(host: string): string | null {
  for (const label of host.split(".")) if (label in CHECKOUT_PLATFORMS) return label;
  return null;
}

/**
 * O que há de errado com o endereço (null = ok). Vazio é aceito (link ainda
 * sem endereço). Espera o endereço já com https:// (normalizeLinkUrl).
 */
export function linkUrlProblem(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (/^(mailto|tel):\S+$/i.test(v)) return null;
  const generic = "Digite um link completo, como https://pay.hotmart.com/…";
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return generic;
  }
  if (!/^https?:$/.test(url.protocol) || /\s/.test(v)) return generic;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (IPV4_RE.test(host)) return null;
  const labels = host.split(".");
  const last = labels[labels.length - 1] ?? "";
  if (labels.length < 2 || labels.some((l) => !l)) return generic;
  if (last in CHECKOUT_PLATFORMS) {
    return `O endereço parece incompleto: faltou o final depois de “${last}” (ex.: https://${CHECKOUT_PLATFORMS[last]}/…). Copie o link inteiro do checkout.`;
  }
  if (!TLD_RE.test(last)) {
    return `O endereço parece incompleto: “${host}” não termina num domínio (como .com ou .com.br). Copie o link inteiro.`;
  }
  return null;
}

/** "pay.kiwify.com.br/x" → "https://pay.kiwify.com.br/x" (mailto:, tel: e outros esquemas ficam como estão). */
export function normalizeLinkUrl(value: string): string {
  const v = value.trim();
  return v && !/^[a-z][a-z0-9+.-]*:/i.test(v) ? `https://${v}` : v;
}

/**
 * Aviso que não bloqueia (null = nada a dizer): checkout de plataforma
 * conhecida sem o código do produto no endereço (só o domínio).
 */
export function linkUrlHint(value: string): string | null {
  const v = normalizeLinkUrl(value);
  if (!v || linkUrlProblem(v)) return null;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  const platform = platformOf(url.hostname.toLowerCase());
  if (platform && (url.pathname === "/" || url.pathname === "") && !url.search) {
    return "Este link não tem o código do produto (a parte depois da “/”). Confira se copiou o link completo do checkout.";
  }
  return null;
}
