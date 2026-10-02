/**
 * Contrato do "Baixar ZIP" (Fase 5): opções, estados e o formato do ZIP.
 *
 * Formato do ZIP (tudo com caminhos RELATIVOS, então funciona na raiz do domínio
 * ou numa subpasta da hospedagem):
 *
 *   index.html               página inicial — ou o DIVISOR A/B, quando a página
 *                            inicial tem versões e o divisor está ligado
 *   oferta-a/index.html      versões A/B da página inicial (uma pasta por versão;
 *   oferta-b/index.html      o nome vem da letra da versão: "A" → oferta-a)
 *   <slug>/index.html        outras páginas do funil (ou o divisor delas)
 *   <slug>/oferta-b/…        versões A/B dessas páginas
 *   …/celular/index.html     versão celular separada (clones de sites não
 *                            responsivos); a de computador redireciona o celular
 *   assets/<sha256>.<ext>    imagens, CSS, fontes, vídeos (endereçados por hash)
 *   assets/os-runtime-<hash>.js, assets/os-tracking-<hash>.js
 *   404.html                 "página não encontrada" (endereço errado); também faz a
 *                            Cloudflare Pages parar de entregar o index.html para
 *                            qualquer caminho (ver src/lib/export/not-found.ts)
 *   eventos.php              opcional: API de Conversões (Meta) / Events API (TikTok)
 *   eventos-dados/config.php os tokens do eventos.php (+ eventos-dados/.htaccess,
 *                            que bloqueia a pasta; nada de .htaccess na raiz)
 *   LEIA-ME.txt              como subir na hospedagem (pt-BR)
 *   (Preservar JS)           arquivos nos caminhos originais do site (só funcionam
 *                            com a oferta na raiz do domínio — o painel avisa);
 *                            também copiados para as pastas das versões/celular
 *                            quando a página sai de onde estava no site original
 *                            (só o que um script pediria com endereço relativo:
 *                            nada que o HTML já pede pela raiz, nem vídeo, áudio,
 *                            fonte ou arquivo com mais de 2 MB).
 *                            Nunca arquivos que a hospedagem executaria (.php,
 *                            .htaccess…) nem caminhos que colidem com outros.
 *
 * Sem divisor, o index.html da pasta da página é a versão de controle.
 * Links do funil apontam para a pasta da página (então o visitante também passa
 * pelo divisor dela, se houver).
 */
import { z } from "zod";

export const ExportOptionsSchema = z.object({
  /** Divisor A/B: o index.html da página sorteia a versão pelo peso (e lembra a escolha). */
  splitter: z.boolean().default(true),
  /** eventos.php com a API de Conversões/Events API (só quando há token configurado). */
  serverEvents: z.boolean().default(false),
  /** HTML mais leve (sem comentários e espaços sobrando); nunca mexe em scripts. */
  optimizeHtml: z.boolean().default(true),
});
export type ExportOptions = z.infer<typeof ExportOptionsSchema>;

export const EXPORT_STATUS_LABEL = {
  QUEUED: "Na fila",
  RUNNING: "Gerando o ZIP",
  DONE: "Pronto",
  FAILED: "Falhou",
} as const;

/** O que o painel mostra de um ZIP (GET /api/exports/<id> e a lista da oferta). */
export interface ExportView {
  id: string;
  offerId: string;
  status: keyof typeof EXPORT_STATUS_LABEL;
  /** 0–100 */
  progress: number;
  /** Etapa atual em pt-BR ("Copiando imagens…"). */
  step: string | null;
  options: ExportOptions;
  /** Nome sugerido do arquivo: "<nome-da-oferta>-<aaaa-mm-dd>-<hhmm>.zip". */
  fileName: string;
  bytes: number | null;
  errorMessage: string | null;
  /** Avisos em pt-BR (ex.: página "Preservar JS" só funciona na raiz do domínio). */
  warnings: string[];
  createdAt: string;
  finishedAt: string | null;
  /**
   * Só no GET /api/exports/<id> com o ZIP na fila: o robô de tarefas (worker)
   * deu sinal de vida há pouco? false = parado (o ZIP não vai começar).
   */
  workerOnline?: boolean;
}

/** Endereço de download (o navegador baixa com o nome certo). */
export const exportDownloadUrl = (id: string) => `/api/exports/${id}/download`;

/** Endereço do andamento (GET → ExportView; a tela consulta a cada segundo). */
export const exportStatusUrl = (id: string) => `/api/exports/${id}`;

/** Quantos ZIPs guardar por oferta (os mais antigos são apagados). */
export const EXPORTS_KEPT_PER_OFFER = 5;

/** Plataformas com envio pelo servidor (eventos.php). */
export type ServerEventVendor = "META" | "TIKTOK";

/**
 * O que é cada item da prévia do ZIP:
 * - page: página do funil (index.html da pasta dela);
 * - splitter: divisor A/B (sorteia a versão pelo peso);
 * - variant: versão A/B de uma página (pasta oferta-a/, oferta-b/…);
 * - mobile: versão celular separada (pasta celular/);
 * - legal: página legal (política, termos);
 * - file: arquivos (assets/, eventos.php, LEIA-ME.txt, arquivos do "Preservar JS").
 */
export type ExportTreeKind = "page" | "splitter" | "variant" | "mobile" | "legal" | "file";

export interface ExportTreeItem {
  /** Caminho dentro do ZIP ("index.html", "upsell/oferta-b/index.html", "assets/"). */
  path: string;
  kind: ExportTreeKind;
  /** Descrição em pt-BR ("Upsell — versão B (50%)"). */
  label: string;
}

/**
 * Prévia do que vai no ZIP (exportPlanAction): barata de calcular, sem montar
 * as páginas. Com as opções escolhidas (padrão: ExportOptionsSchema).
 */
export interface ExportPlan {
  offerName: string;
  /** Alguma página tem mais de uma versão (teste A/B). */
  hasVariants: boolean;
  /** Algum pixel com API de Conversões/Events API ligada E token salvo (o eventos.php pode sair). */
  hasServerEventTokens: boolean;
  /** Quais plataformas o eventos.php atende (vazio = nenhuma). */
  serverEventVendors: ServerEventVendor[];
  /** Nomes das páginas no modo "Preservar JS" (só funcionam na raiz do domínio). */
  preserveJsPages: string[];
  /** Avisos em pt-BR. */
  warnings: string[];
  /** Pastas e arquivos, na ordem do funil (página inicial primeiro), depois os arquivos. */
  tree: ExportTreeItem[];
  /** Páginas com botão sem destino (aviso "ainda não leva a lugar nenhum"): para abrir no editor. */
  deadButtonPages?: { name: string; documentId: string }[];
}

/** Etapas mostradas enquanto o ZIP é gerado. */
export const EXPORT_STEP = {
  queued: "Na fila para gerar o ZIP…",
  reading: "Lendo a oferta…",
  pages: (done: number, total: number) => `Montando as páginas (${done} de ${total})…`,
  files: "Copiando imagens e arquivos…",
  zipping: "Compactando o ZIP…",
  done: "Pronto para baixar",
} as const;

/**
 * Rótulo do eventos.php na prévia do ZIP (servidor e tela usam o mesmo):
 * "Precisa de PHP · envia os eventos para a Meta pelo servidor".
 */
export function serverEventsTreeLabel(vendors: readonly ServerEventVendor[] | null | undefined): string {
  const meta = Boolean(vendors?.includes("META"));
  const tiktok = Boolean(vendors?.includes("TIKTOK"));
  const who =
    meta && !tiktok ? "para a Meta" : tiktok && !meta ? "para o TikTok" : meta ? "para a Meta e o TikTok" : null;
  return who
    ? `Precisa de PHP · envia os eventos ${who} pelo servidor`
    : "Precisa de PHP · envia os eventos pelo servidor";
}

/**
 * "Oferta de Verão!" + 29/09/2026 14:32 → "oferta-de-verao-2026-09-29-1432.zip"
 * (data e hora locais: dois ZIPs do mesmo dia não saem com o mesmo nome).
 */
export function exportFileName(offerName: string, date: Date): string {
  const base =
    offerName
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/g, "") || "oferta";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${base}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.zip`;
}
