/**
 * Onde cada página vai no ZIP (função pura): pastas do funil, versões A/B,
 * divisor, versão celular e canonical. Usada pela prévia do ZIP (exportPlan) e
 * pela montagem (src/server/services/export/build.ts). Formato em ./options.ts.
 *
 * Regras:
 * - página inicial na raiz; as outras em <slug>/;
 * - página com mais de uma versão: cada versão em <pasta>/oferta-<letra>/ e o
 *   index.html da pasta é o divisor (splitter ligado) ou a versão de controle;
 * - versões separadas computador/celular: a de computador na pasta e a de
 *   celular em <pasta>/celular/ (a de computador redireciona o celular);
 * - cópias (versões e celular) apontam o canonical para a principal: com o
 *   divisor, a pasta da versão de controle (o divisor é noindex); sem ele, a
 *   pasta da página. Só o canonical, sem noindex: é o que o Google pede para
 *   testes A/B (noindex junto com canonical são sinais contraditórios);
 * - com o divisor, cada versão (e o celular dela) guarda a versão vista no
 *   mesmo formato do divisor (LayoutFile.ab), e o divisor sabe a identidade
 *   de cada versão e a pasta celular/ dela;
 * - pastas da página inicial (oferta-a/, celular/) que coincidam com o endereço
 *   de outra página ganham um sufixo ("oferta-b-2/"), com aviso.
 */
import type { ExportTreeItem } from "./options";
import { ASSETS_DIR, dirDepth, uniqueName, variantFolderName } from "./paths";
import { type SplitterVariant, weightPercents } from "./splitter";

export type LayoutDevice = "ALL" | "DESKTOP" | "MOBILE";

export interface LayoutDocument {
  id: string;
  device: LayoutDevice;
}

export interface LayoutVariant {
  id: string;
  name: string;
  label: string | null;
  isControl: boolean;
  weight: number;
  position: number;
  documents: LayoutDocument[];
}

export interface LayoutPage {
  id: string;
  name: string;
  slug: string;
  type: string;
  isHome: boolean;
  position: number;
  cloneMode: "EDITABLE" | "PRESERVE_JS";
  variants: LayoutVariant[];
}

export type LayoutFileKind = "page" | "splitter" | "variant" | "mobile" | "legal";

export interface LayoutFile {
  /** Caminho no ZIP ("upsell/oferta-b/index.html"). */
  path: string;
  /** Pasta do arquivo ("upsell/oferta-b/"). */
  dir: string;
  kind: LayoutFileKind;
  label: string;
  pageId: string;
  variantId: string | null;
  /** Documento que vira este arquivo (null: divisor ou versão vazia → página em branco). */
  documentId: string | null;
  device: LayoutDevice | null;
  /** Versão celular desta página, relativa à pasta dela ("celular/"): o arquivo redireciona o celular. */
  mobileDir: string | null;
  /** Pasta (no ZIP) da versão principal, para o canonical; null = este é o principal. */
  canonicalDir: string | null;
  /** Versão A/B com o divisor ligado: a página guarda a versão vista (ver earlyScript). */
  ab: { key: string; folder: string; id: string; up: number } | null;
  /** Pasta (no ZIP) da versão celular, para o <link rel="alternate">. */
  mobileAlternateDir: string | null;
  /** Divisor A/B: versões (pastas relativas) e chave da escolha guardada. */
  splitter: { variants: SplitterVariant[]; key: string } | null;
  preserveJs: boolean;
  /**
   * Página com mais de uma versão: a versão que este arquivo mostra — letra e
   * pasta dela, relativa à da página ("oferta-b/"), também na cópia de
   * controle da pasta da página (sem divisor) e no celular/. Vai para o
   * rastreamento (os_versao em cada evento e a marca no checkout). null =
   * página com uma versão só (ou o divisor).
   */
  version: { name: string; folder: string } | null;
}

export interface LayoutSplit {
  pageId: string;
  page: string;
  dir: string;
  splitter: boolean;
  variants: { name: string; folder: string; weight: number; percent: number }[];
}

export interface Layout {
  /** Na ordem do funil (página inicial primeiro; cada página com as versões dela). */
  files: LayoutFile[];
  /** Pasta de cada página (destino dos links do funil). */
  pageDirs: Record<string, string>;
  splits: LayoutSplit[];
  warnings: string[];
}

/** Hash curto e estável (FNV-1a) para a chave da escolha do divisor (não expõe o ID da página). */
export function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

function sortVariants(variants: LayoutVariant[]): LayoutVariant[] {
  return [...variants].sort(
    (a, b) =>
      Number(b.isControl) - Number(a.isControl) ||
      a.position - b.position ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}

/** Documento de computador (ALL ou DESKTOP) e de celular (MOBILE) de uma versão. */
function pickDocuments(docs: LayoutDocument[]) {
  const all = docs.find((d) => d.device === "ALL");
  const desktop = all ?? docs.find((d) => d.device === "DESKTOP") ?? null;
  const mobile = docs.find((d) => d.device === "MOBILE") ?? null;
  if (!desktop && mobile) return { main: mobile, mobile: null };
  return { main: desktop, mobile: all ? null : mobile };
}

function versionName(v: LayoutVariant) {
  return v.label ? `${v.name} (${v.label})` : v.name;
}

export interface LayoutOptions {
  splitter: boolean;
}

export function planLayout(pages: LayoutPage[], opts: LayoutOptions): Layout {
  const warnings: string[] = [];
  const files: LayoutFile[] = [];
  const pageDirs: Record<string, string> = {};
  const splits: LayoutSplit[] = [];

  const ordered = [...pages].sort(
    (a, b) => Number(b.isHome) - Number(a.isHome) || a.position - b.position || a.id.localeCompare(b.id),
  );
  // Sem página marcada como inicial (não deveria acontecer): a primeira vai para a raiz.
  const home = ordered.find((p) => p.isHome) ?? ordered[0] ?? null;

  // Nomes já usados na raiz do ZIP (pastas das páginas + assets).
  const rootTaken = new Set<string>([ASSETS_DIR.replace(/\/$/, "")]);
  for (const p of ordered) if (p !== home) rootTaken.add(p.slug);

  for (const page of ordered) {
    const isHome = page === home;
    const dir = isHome ? "" : `${page.slug}/`;
    pageDirs[page.id] = dir;
    const legal = page.type === "LEGAL";
    const preserveJs = page.cloneMode === "PRESERVE_JS";
    // Subpastas da página (na raiz, não podem coincidir com outras páginas).
    const taken = new Set<string>(isHome ? rootTaken : []);
    const subfolder = (base: string, what: string) => {
      const name = uniqueName(base, taken);
      taken.add(name);
      if (name !== base && isHome) {
        warnings.push(
          `A pasta “${base}/” já é o endereço de outra página: ${what} da página inicial foi para “${name}/”.`,
        );
      }
      return name;
    };

    const variants = sortVariants(page.variants);
    if (!variants.length) {
      warnings.push(`A página “${page.name}” não tem conteúdo: saiu em branco.`);
      files.push({
        path: `${dir}index.html`,
        dir,
        kind: legal ? "legal" : "page",
        label: page.name,
        pageId: page.id,
        variantId: null,
        documentId: null,
        device: null,
        mobileDir: null,
        canonicalDir: null,
        ab: null,
        mobileAlternateDir: null,
        splitter: null,
        preserveJs,
        version: null,
      });
      continue;
    }

    const multi = variants.length > 1;
    const percents = weightPercents(variants.map((v) => v.weight));
    const useSplitter = multi && opts.splitter;
    // Pasta de cada versão (relativa à pasta da página).
    const folders = multi
      ? variants.map((v, i) => `${subfolder(variantFolderName(v.name, i), `a versão ${v.name}`)}/`)
      : [];
    const controlDir = multi ? `${dir}${folders[0]}` : dir;
    // Celular da cópia na pasta da página (sem divisor) e das versões: "celular/" dentro de cada pasta.
    let pageMobileFolder: string | null = null;
    const mobileFolderFor = (atPageDir: boolean) => {
      if (!atPageDir) return "celular/";
      pageMobileFolder ??= `${subfolder("celular", "a versão celular")}/`;
      return pageMobileFolder;
    };

    const abKey = shortHash(page.id);
    /** Letra e pasta de cada versão (só com mais de uma). */
    const versionOf = (v: LayoutVariant) => {
      const i = variants.indexOf(v);
      return multi && i >= 0 ? { name: v.name, folder: folders[i] } : null;
    };
    const emit = (
      v: LayoutVariant,
      vDir: string,
      kind: LayoutFileKind,
      label: string,
      canonicalDir: string | null,
      abFolder: string | null = null,
    ) => {
      const docs = pickDocuments(v.documents);
      if (!docs.main) {
        warnings.push(`A versão ${v.name} da página “${page.name}” não tem conteúdo: saiu em branco.`);
      }
      const mobileFolder = docs.mobile ? mobileFolderFor(vDir === dir) : null;
      const mobileDir = mobileFolder ? `${vDir}${mobileFolder}` : null;
      const ab = abFolder ? { key: abKey, folder: abFolder, id: shortHash(v.id), up: 1 } : null;
      const version = versionOf(v);
      files.push({
        path: `${vDir}index.html`,
        dir: vDir,
        kind,
        label,
        pageId: page.id,
        variantId: v.id,
        documentId: docs.main?.id ?? null,
        device: docs.main?.device ?? null,
        mobileDir: mobileFolder,
        canonicalDir,
        ab,
        mobileAlternateDir: mobileDir,
        splitter: null,
        preserveJs,
        version,
      });
      if (docs.mobile && mobileDir) {
        files.push({
          path: `${mobileDir}index.html`,
          dir: mobileDir,
          kind: "mobile",
          label: `${label} — celular`,
          pageId: page.id,
          variantId: v.id,
          documentId: docs.mobile.id,
          device: "MOBILE",
          mobileDir: null,
          canonicalDir: canonicalDir ?? vDir,
          ab: ab ? { ...ab, up: 1 + dirDepth(mobileFolder ?? "") } : null,
          mobileAlternateDir: null,
          splitter: null,
          preserveJs,
          version,
        });
      }
    };

    if (!multi) {
      emit(variants[0], dir, legal ? "legal" : "page", page.name, null);
      continue;
    }

    const splitVariants = variants.map((v, i) => ({
      name: versionName(v),
      folder: folders[i],
      weight: v.weight,
      percent: useSplitter ? percents[i] : 0,
    }));
    splits.push({ pageId: page.id, page: page.name, dir, splitter: useSplitter, variants: splitVariants });

    if (useSplitter) {
      const summary = splitVariants.map((v) => `${v.name.split(" ")[0]} ${v.percent}%`).join(" · ");
      files.push({
        path: `${dir}index.html`,
        dir,
        kind: "splitter",
        label: `Divisor A/B de “${page.name}” (${summary})`,
        pageId: page.id,
        variantId: null,
        documentId: null,
        device: null,
        mobileDir: null,
        canonicalDir: null,
        ab: null,
        mobileAlternateDir: null,
        splitter: {
          variants: variants.map((v, i) => ({
            folder: folders[i],
            weight: v.weight,
            id: shortHash(v.id),
            // Com o divisor, o celular de cada versão fica em <versão>/celular/.
            mobile: pickDocuments(v.documents).mobile ? "celular/" : null,
          })),
          key: abKey,
        },
        preserveJs: false,
        version: null,
      });
      const total = variants.reduce((a, v) => a + Math.max(0, v.weight), 0);
      if (total <= 0) {
        warnings.push(
          `Todas as versões de “${page.name}” estão com 0%: o divisor manda todo mundo para a versão ${variants[0].name}.`,
        );
      } else {
        for (const v of variants) {
          if (v.weight <= 0) {
            warnings.push(
              `A versão ${v.name} de “${page.name}” está com 0% (pausada): o divisor não manda visitantes para ela.`,
            );
          }
        }
      }
    } else {
      // Sem divisor: a pasta da página mostra a versão de controle.
      emit(variants[0], dir, legal ? "legal" : "page", `${page.name} — versão ${variants[0].name} (principal)`, null);
    }

    variants.forEach((v, i) => {
      const vDir = `${dir}${folders[i]}`;
      const canonical = useSplitter ? (i === 0 ? null : controlDir) : dir;
      const share = useSplitter ? ` · ${percents[i]}%` : "";
      emit(
        v,
        vDir,
        "variant",
        `${page.name} — versão ${versionName(v)}${share}`,
        canonical,
        useSplitter ? folders[i] : null,
      );
    });
  }

  return { files, pageDirs, splits, warnings };
}

/**
 * Endereço de cada versão de uma página no ZIP (como planLayout decide, com o
 * divisor ligado): pasta da versão ("oferta-b/", "upsell/oferta-b/",
 * "oferta-b-2/" quando "oferta-b" já é o endereço de outra página) ou, com uma
 * versão só, a pasta da página ("" = raiz). Usado pelo "Teste A/B" para
 * mostrar exatamente o endereço que vai no ZIP.
 */
export function variantDirs(pages: LayoutPage[], pageId: string): Record<string, string> {
  const layout = planLayout(pages, { splitter: true });
  const out: Record<string, string> = {};
  for (const f of layout.files) {
    if (f.pageId !== pageId || !f.variantId || f.kind === "mobile") continue;
    // Com várias versões, vale a pasta da versão (o index.html da página é o divisor).
    if (f.kind === "variant" || out[f.variantId] === undefined) out[f.variantId] = f.dir;
  }
  return out;
}

/** Itens da prévia (ExportPlan.tree) para as páginas (os arquivos entram depois). */
export function layoutTree(layout: Layout): ExportTreeItem[] {
  return layout.files.map((f) => ({ path: f.path, kind: f.kind, label: f.label }));
}
