/**
 * Páginas de produto criadas a partir da vitrine ("＋ Criar página deste
 * produto" no cartão e "Criar as páginas que faltam" na vitrine): limites e
 * conferências usados no diálogo do editor, na ação e no serviço
 * (src/server/services/store.ts). Sem dependências: roda no editor e no
 * servidor.
 */
import { cutText, nameKey } from "@/lib/text";

/** Páginas criadas de uma vez (a vitrine pode ter mais produtos: o resto fica para a próxima). */
export const PRODUCT_PAGES_MAX = 60;
/** Nome de página (o mesmo limite de createPageAction). */
export const PAGE_NAME_MAX = 120;
/** Nome do produto (o mesmo do campo "Nome do produto" do cartão). */
export const PRODUCT_NAME_MAX = 150;
/** HTML e CSS do cabeçalho da vitrine copiado para as páginas novas (cada um). */
export const HEADER_COPY_MAX_BYTES = 200 * 1024;
/** Foto do cartão em data: (fotos enviadas pelo editor são /os-assets/…, bem menores que isso). */
export const PRODUCT_PHOTO_MAX = 512 * 1024;
/** Endereço de página de verdade ou caminho de arquivo enviado (sem espaços nem aspas). */
const PHOTO_URL_MAX = 2000;

/** Valor da lista "Botão “Comprar agora” leva para" que deixa o link para depois. */
export const LINK_LATER = "__depois__";

/**
 * A foto do cartão pode ir para a página do produto? Vale endereço http(s)
 * (também o "//cdn…" de páginas clonadas), arquivo enviado pelo editor
 * (/os-assets/…) ou imagem em data:image/… (as fotos provisórias). Devolve o
 * problema (pt-BR) ou null.
 */
export function productPhotoProblem(src: string): string | null {
  const value = src.trim();
  if (!value) return null;
  if (/^data:/i.test(value)) {
    if (!/^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i.test(value)) {
      return "a foto não é uma imagem que dá para usar na página";
    }
    return value.length > PRODUCT_PHOTO_MAX
      ? "a foto é grande demais (troque por uma imagem enviada pelo editor)"
      : null;
  }
  if (value.length > PHOTO_URL_MAX || /[\s"'<>\\]/.test(value)) return "o endereço da foto não é válido";
  if (/^(https?:)?\/\/[^/]/i.test(value) || /^\/os-assets\/[\w.-]+$/.test(value)) return null;
  return "o endereço da foto não é válido (use uma imagem enviada pelo editor ou um endereço https://)";
}

/**
 * Produto de um cartão, para "uma página por produto": cartões com o mesmo
 * nome (sem diferenciar maiúsculas, acentos e espaços) são o mesmo produto —
 * em várias vitrines da página, no layout do celular ou numa versão A/B —, e
 * levam à mesma página. "" = cartão sem nome (não é o mesmo de nenhum outro).
 */
export function productKey(name: string): string {
  return nameKey(name);
}

/** "Fone de ouvido", ou "Fone de ouvido 2" se o nome já existe (sem diferenciar maiúsculas e acentos). */
export function freePageName(base: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map(nameKey));
  const clean = cutText(base.replace(/\s+/g, " ").trim(), PAGE_NAME_MAX).trim() || "Página do produto";
  if (!used.has(nameKey(clean))) return clean;
  for (let i = 2; ; i++) {
    const suffix = ` ${i}`;
    const candidate = `${cutText(clean, PAGE_NAME_MAX - suffix.length).trimEnd()}${suffix}`;
    if (!used.has(nameKey(candidate))) return candidate;
  }
}

/** Nomes de página para estes produtos, sem repetir entre eles nem com as páginas que já existem. */
export function freePageNames(products: readonly string[], taken: Iterable<string>): string[] {
  const used = [...taken];
  return products.map((name) => {
    const free = freePageName(name, used);
    used.push(free);
    return free;
  });
}
