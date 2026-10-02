/**
 * Imagens no editor: biblioteca da oferta dentro do gerenciador de imagens do
 * GrapesJS (duplo clique numa imagem, fundo no painel de estilo, arrastar
 * arquivos para a página).
 *
 * - Ao abrir, carrega as imagens da oferta (GET /api/offers/<id>/assets), mais
 *   novas primeiro.
 * - Upload próprio (POST /api/assets/upload com offerId): confere tamanho e
 *   formato antes de enviar, mostra o progresso em toast e as mensagens de erro
 *   do servidor (pt-BR). Com uma imagem só, ela já é aplicada no elemento.
 * - "Usar link": o servidor baixa a imagem do endereço colado e guarda na
 *   biblioteca (o canvas só mostra imagens do próprio painel, pela CSP).
 * - Trocar a imagem de um <img> remove srcset/sizes (e os <source> de um
 *   <picture>), que senão continuariam mostrando a imagem antiga.
 * - Textos em português e visual em grade (estilos com prefixo "os-am").
 */
import type { Asset, AssetProps, Component, Editor, UploadFileClb, UploadFileOptions } from "grapesjs";
import { toast } from "sonner";

export const UPLOAD_URL = "/api/assets/upload";

/** Mesmos limites de IMAGE_UPLOAD_LIMITS (src/server/services/assets.ts). */
export const CLIENT_UPLOAD_LIMITS = { maxFileBytes: 15 * 1024 * 1024, maxFiles: 20 } as const;

/** Valor do atributo accept do campo de arquivo. */
export const ACCEPTED_IMAGES =
  "image/jpeg,image/png,image/webp,image/gif,image/avif,image/svg+xml,.jpg,.jpeg,.png,.webp,.gif,.avif,.svg";

const ACCEPTED_MIME = /^image\/(?:jpeg|pjpeg|png|webp|gif|avif|svg\+xml)$/i;
const ACCEPTED_EXT = /\.(?:jpe?g|png|webp|gif|avif|svg)$/i;
const HEIC = /heic|heif/i;
const STYLE_ID = "os-assets-style";
const VIEW_MARK = "__osLibraryView";

const TEXTS = {
  addButton: "Usar link",
  inputPlh: "Ou cole o link de uma imagem (https://…)",
  modalTitle: "Escolher imagem",
  uploadTitle: "Arraste imagens para cá ou clique para escolher",
};
const LOADING_HTML = '<div class="os-am-empty">Carregando as imagens da oferta…</div>';
const EMPTY_HTML =
  '<div class="os-am-empty"><strong>Nenhuma imagem nesta oferta ainda.</strong><br>Arraste imagens para a área acima ou clique nela para escolher do computador.</div>';
const HINT_TEXT =
  "Clique numa imagem para usar. Dois cliques usam e fecham. JPG, PNG, WebP, GIF, AVIF ou SVG até 15 MB.";

/** Imagem no formato devolvido pelas rotas de imagens. */
export interface LibraryImage {
  type: "image";
  src: string;
  name: string;
  width?: number;
  height?: number;
  bytes?: number;
}

interface UploadErrorItem {
  name: string;
  error: string;
}

class UploadError extends Error {
  constructor(
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = Math.ceil((bytes / (1024 * 1024)) * 10) / 10;
  return `${mb.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}

function toLibraryImage(v: unknown): LibraryImage | null {
  if (!isRecord(v) || typeof v.src !== "string" || !v.src) return null;
  const image: LibraryImage = { type: "image", src: v.src, name: typeof v.name === "string" ? v.name : "" };
  if (typeof v.width === "number" && typeof v.height === "number") {
    image.width = v.width;
    image.height = v.height;
  }
  if (typeof v.bytes === "number") image.bytes = v.bytes;
  return image;
}

/** Lê { data, errors, error } das rotas de imagens sem confiar no formato. */
export function parseAssetResponse(json: unknown): { data: LibraryImage[]; errors: UploadErrorItem[]; error?: string } {
  if (!isRecord(json)) return { data: [], errors: [] };
  const data = Array.isArray(json.data)
    ? json.data.map(toLibraryImage).filter((i): i is LibraryImage => i !== null)
    : [];
  const errors = Array.isArray(json.errors)
    ? json.errors
        .filter(isRecord)
        .map((e) => ({ name: String(e.name ?? ""), error: String(e.error ?? "") }))
        .filter((e) => e.error)
    : [];
  return { data, errors, error: typeof json.error === "string" ? json.error : undefined };
}

function statusMessage(status: number) {
  if (status === 401) return "Sua sessão expirou. Entre de novo.";
  if (status === 413) return "Envio grande demais: mande no máximo 20 imagens de até 15 MB cada.";
  return "Não foi possível enviar as imagens. Tente de novo.";
}

/**
 * Confere os arquivos antes de enviar (o servidor confere de novo). Arquivos sem
 * tipo informado seguem para o servidor, que olha o conteúdo.
 */
export function checkFiles(files: readonly Pick<File, "name" | "size" | "type">[]): {
  accepted: number[];
  problems: string[];
} {
  const accepted: number[] = [];
  const problems: string[] = [];
  files.forEach((file, index) => {
    const name = file.name || "imagem";
    if (HEIC.test(file.type) || /\.(heic|heif)$/i.test(name)) {
      problems.push(`"${name}" está no formato HEIC (fotos do iPhone). Exporte como JPG ou PNG e envie de novo.`);
    } else if (file.type && !ACCEPTED_MIME.test(file.type) && !ACCEPTED_EXT.test(name)) {
      problems.push(`"${name}" não é uma imagem aceita. Envie JPG, PNG, WebP, GIF, AVIF ou SVG.`);
    } else if (file.size === 0) {
      problems.push(`"${name}" está vazio.`);
    } else if (file.size > CLIENT_UPLOAD_LIMITS.maxFileBytes) {
      problems.push(`"${name}" tem ${formatBytes(file.size)}. O limite é 15 MB por imagem.`);
    } else {
      accepted.push(index);
    }
  });
  return { accepted, problems };
}

function nameFromUrl(url: string) {
  if (url.startsWith("data:")) return "Imagem colada";
  const last = url.split(/[?#]/)[0].split("/").pop() ?? "";
  try {
    return decodeURIComponent(last) || "Imagem por link";
  } catch {
    return last || "Imagem por link";
  }
}

/** Imagem ainda com o marcador padrão do GrapesJS (sem arquivo de verdade). */
function isEmptyImage(component: Component) {
  const image = component as Component & { isDefaultSrc?: () => boolean };
  return typeof image.isDefaultSrc === "function" ? image.isDefaultSrc() : !component.get("src");
}

function isComponent(value: unknown): value is Component {
  return isRecord(value) && typeof value.is === "function" && typeof value.getAttributes === "function";
}

/** Tira srcset/sizes do <img> (e os <source> do <picture>) para a nova imagem aparecer. */
export function clearResponsiveSources(image: Component) {
  const attrs = image.getAttributes();
  const stale = ["srcset", "sizes"].filter((name) => name in attrs);
  if (stale.length) image.removeAttributes(stale);
  const parent = image.parent();
  if (parent && String(parent.get("tagName")).toLowerCase() === "picture") {
    for (const source of parent
      .components()
      .filter((c: Component) => String(c.get("tagName")).toLowerCase() === "source")) {
      source.remove();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Visual
// ─────────────────────────────────────────────────────────────────────────────

const UPLOAD_ICON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'/%3E%3Cpath d='m17 8-5-5-5 5'/%3E%3Cpath d='M12 3v12'/%3E%3C/svg%3E\")";

const CSS = `
.os-am{--os-am-upload-icon:${UPLOAD_ICON}}
.gjs-mdl-dialog:has(.os-am){max-width:980px}
.gjs-mdl-dialog:has(.os-am) .gjs-mdl-title{font-weight:600}
.os-am.gjs-asset-manager{display:flex;flex-direction:column;gap:14px;font-weight:400}
.os-am .gjs-am-file-uploader{float:none;width:100%}
.os-am .gjs-am-file-uploader>form{margin:0;border:2px dashed var(--border)!important;border-radius:calc(var(--radius) - 2px);background:color-mix(in oklch,var(--muted) 55%,transparent)!important;color:var(--muted-foreground);transition:border-color .15s,background .15s,color .15s}
.os-am .gjs-am-file-uploader>form:hover,.os-am .gjs-am-file-uploader>form.gjs-am-hover{border-color:var(--primary)!important;color:var(--primary);background:color-mix(in oklch,var(--primary) 7%,transparent)!important}
.os-am .gjs-am-file-uploader #gjs-am-title{padding:26px 16px;font-size:14px;font-weight:500;box-sizing:border-box}
.os-am .gjs-am-file-uploader #gjs-am-title::before{content:"";display:block;width:26px;height:26px;margin:0 auto 8px;background:currentColor;-webkit-mask:var(--os-am-upload-icon) center/contain no-repeat;mask:var(--os-am-upload-icon) center/contain no-repeat}
.os-am .gjs-am-file-uploader #gjs-am-uploadFile{padding:42px 16px;cursor:pointer}
.os-am .os-am-busy>form{opacity:.55;pointer-events:none}
.os-am .gjs-am-assets-cont{float:none;width:100%;height:auto;padding:0;background:transparent!important;border:0!important}
.os-am .gjs-am-assets-header{display:flex;flex-direction:column;gap:8px;padding:0 0 12px}
.os-am .gjs-am-add-asset{display:flex;gap:8px;align-items:stretch}
.os-am .gjs-am-add-asset>div[style]{display:none}
.os-am .gjs-am-add-asset .gjs-am-add-field{float:none;width:auto;flex:1;background:var(--background);border:1px solid var(--input);border-radius:calc(var(--radius) - 4px)}
.os-am .gjs-am-add-field input{width:100%;box-sizing:border-box;padding:8px 10px;background:transparent;border:0;outline:0;color:var(--foreground);font:inherit;font-size:13px}
.os-am .gjs-am-add-asset button{float:none;width:auto;padding:0 14px;border-radius:calc(var(--radius) - 4px);background:var(--primary);color:var(--primary-foreground);font:inherit;font-size:13px;font-weight:500;cursor:pointer}
.os-am-hint{margin:0;font-size:12px;color:var(--muted-foreground)}
.os-am .gjs-am-assets{height:min(52vh,460px);display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;align-content:start;overflow:auto;padding:2px}
.os-am.os-am-loading .gjs-am-assets{opacity:.6}
.os-am .gjs-am-asset{width:auto;padding:0;display:flex;flex-direction:column;border:1px solid var(--border);border-radius:calc(var(--radius) - 2px);overflow:hidden;background:var(--card);transition:border-color .15s,box-shadow .15s}
.os-am .gjs-am-asset:hover{border-color:color-mix(in oklch,var(--primary) 55%,var(--border))}
.os-am .gjs-am-asset.gjs-am-highlight{border-color:var(--primary);box-shadow:0 0 0 2px color-mix(in oklch,var(--primary) 30%,transparent)}
.os-am .gjs-am-preview-cont{float:none;width:100%;height:auto;aspect-ratio:4/3;border-radius:0;background-color:var(--muted)}
.os-am .gjs-am-preview{background-size:contain}
.os-am .gjs-am-meta{float:none;width:100%;padding:6px 8px 8px;font-size:12px;box-sizing:border-box}
.os-am .gjs-am-meta>div{margin:0}
.os-am .gjs-am-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;color:var(--foreground)}
.os-am .gjs-am-dimensions{opacity:1;margin-top:2px;font-size:11px;color:var(--muted-foreground)}
.os-am .gjs-am-close{display:none!important}
.os-am-empty{grid-column:1/-1;padding:40px 16px;text-align:center;font-size:13px;line-height:1.6;color:var(--muted-foreground)}
.os-am-empty strong{color:var(--foreground);font-weight:600}
`;

function ensureStyles() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

interface ImageAssetView {
  pfx: string;
  model: Asset;
  getPreview(): string;
  getInfo(): string;
}

/** Cartão da imagem: sem o "×" (a biblioteca é da oferta) e com medidas e tamanho. */
function customizeImageView(editor: Editor) {
  const am = editor.AssetManager;
  const current: unknown = am.getType("image");
  const view = isRecord(current) ? current.view : undefined;
  const proto = typeof view === "function" ? (view.prototype as Record<string, unknown>) : undefined;
  if (proto?.[VIEW_MARK]) return;
  am.addType("image", {
    view: {
      [VIEW_MARK]: true,
      template(this: ImageAssetView) {
        return `<div class="${this.pfx}preview-cont">${this.getPreview()}</div><div class="${this.pfx}meta">${this.getInfo()}</div>`;
      },
      getInfo(this: ImageAssetView) {
        const model = this.model;
        const name = String(model.get("name") || model.getFilename() || "Imagem");
        const width = Number(model.get("width")) || 0;
        const height = Number(model.get("height")) || 0;
        const bytes = Number(model.get("bytes")) || 0;
        const details = [width && height ? `${width} × ${height}` : "", bytes ? formatBytes(bytes) : ""]
          .filter(Boolean)
          .join(" · ");
        return `<div class="${this.pfx}name" title="${escapeHtml(name)}">${escapeHtml(name)}</div><div class="${this.pfx}dimensions">${escapeHtml(details)}</div>`;
      },
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuração
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Liga a biblioteca de imagens da oferta ao editor. Chame logo depois de criar
 * o editor (createEditor). Devolve uma função que desfaz os ouvintes.
 */
export function configureAssets(editor: Editor, target: string | { offer: { id: string } }): () => void {
  const offerId = typeof target === "string" ? target : target.offer.id;
  const am = editor.AssetManager;
  const config = am.getConfig();
  const pfx = config.stylePrefix || "gjs-am-";
  let disposed = false;
  let loading: Promise<void> | null = null;

  ensureStyles();
  customizeImageView(editor);
  editor.I18n.addMessages({ pt: { assetManager: TEXTS }, [editor.I18n.getLocale()]: { assetManager: TEXTS } });

  const container = () => (am.getContainer() as HTMLElement | undefined) ?? null;

  /** Mostra de novo o que está na biblioteca (se o gerenciador estiver aberto). */
  const rerender = () => {
    if (am.isOpen()) am.render(am.getAll().filter((a: Asset) => a.getType() === "image"));
  };

  /** Busca a lista no servidor e junta com o que já existe (links colados ficam no topo). */
  const refresh = (): Promise<void> => {
    if (loading) return loading;
    container()?.classList.add("os-am-loading");
    loading = (async () => {
      try {
        const res = await fetch(`/api/offers/${encodeURIComponent(offerId)}/assets`, {
          cache: "no-store",
          credentials: "same-origin",
        });
        const parsed = parseAssetResponse(await res.json().catch(() => null));
        if (!res.ok) throw new UploadError(parsed.error ?? "Não foi possível carregar as imagens da oferta.");
        if (disposed) return;
        const all = am.getAll();
        const fromServer = new Set(parsed.data.map((i) => i.src));
        const extras = all.filter((a: Asset) => !fromServer.has(a.getSrc())).map((a: Asset): AssetProps => a.toJSON());
        all.reset([...extras, ...parsed.data]);
      } catch (err) {
        if (!disposed) {
          toast.error(err instanceof UploadError ? err.message : "Não foi possível carregar as imagens da oferta.");
        }
      } finally {
        loading = null;
        if (!disposed) {
          config.noAssets = EMPTY_HTML;
          container()?.classList.remove("os-am-loading");
          rerender();
        }
      }
    })();
    return loading;
  };

  /** Aplica a imagem recém-enviada (mesmo efeito de clicar nela). */
  const applyAsset = (src: string) => {
    if (!am.isOpen()) return;
    const asset = am.get(src) as (Asset & { view?: { el?: HTMLElement } }) | null;
    asset?.view?.el?.click();
  };

  /** Área de envio mostra "Enviando…" enquanto o upload não termina. */
  const setBusy = (busy: boolean, count = 0) => {
    const el = am.fu?.el;
    if (!el) return;
    el.classList.toggle("os-am-busy", busy);
    const title = el.querySelector(`#${pfx}title`);
    if (title) {
      title.textContent = busy
        ? count === 1
          ? "Enviando a imagem…"
          : `Enviando ${count} imagens…`
        : editor.I18n.t("assetManager.uploadTitle") || TEXTS.uploadTitle;
    }
  };

  /** Envia para a rota de upload e devolve as imagens aceitas (lança UploadError). */
  const send = async (body: FormData) => {
    const target = typeof config.upload === "string" && config.upload ? config.upload : UPLOAD_URL;
    let res: Response;
    try {
      res = await fetch(target, { method: "POST", body, credentials: "same-origin" });
    } catch {
      throw new UploadError("Não foi possível falar com o Offer Studio. Ele ainda está aberto?");
    }
    const json: unknown = await res.json().catch(() => null);
    const parsed = parseAssetResponse(json);
    if (!res.ok || !parsed.data.length) {
      throw new UploadError(
        parsed.error ?? statusMessage(res.status),
        parsed.errors.map((e) => e.error),
      );
    }
    return { json, parsed };
  };

  /** Põe as imagens no topo da biblioteca (reenviar uma que já existe a traz para cima). */
  const addToLibrary = (images: LibraryImage[]): AssetProps[] => {
    const added = images.map((image): AssetProps => ({ ...image }));
    const all = am.getAll();
    for (const image of images) {
      const existing = am.get(image.src);
      if (existing) all.remove(existing);
    }
    am.add(added, { at: 0 });
    return added;
  };

  const uploadFiles = async (ev: DragEvent, clb?: UploadFileClb, opts?: UploadFileOptions): Promise<void> => {
    const input = typeof HTMLInputElement !== "undefined" && ev.target instanceof HTMLInputElement ? ev.target : null;
    const picked: File[] = Array.from(ev.dataTransfer?.files ?? input?.files ?? []);
    if (input) input.value = "";
    if (!picked.length) return;

    // Imagem arrastada para a página: o elemento vazio sai se o envio falhar.
    const placeholder = opts?.componentView?.model;
    const dropPlaceholder = () => {
      if (placeholder && isEmptyImage(placeholder)) placeholder.remove();
    };

    if (picked.length > CLIENT_UPLOAD_LIMITS.maxFiles) {
      toast.error(`Envie no máximo ${CLIENT_UPLOAD_LIMITS.maxFiles} imagens por vez.`);
      dropPlaceholder();
      return;
    }
    const { accepted, problems } = checkFiles(picked);
    if (problems.length) {
      toast.error(problems.length === 1 ? problems[0] : `${problems.length} arquivos não foram enviados.`, {
        description: problems.length > 1 ? problems.slice(0, 4).join(" ") : undefined,
      });
    }
    const files = accepted.map((i) => picked[i]);
    if (!files.length) {
      dropPlaceholder();
      return;
    }

    editor.trigger("asset:upload:start");
    const toastId = toast.loading(
      files.length === 1 ? `Enviando "${files[0].name}"…` : `Enviando ${files.length} imagens…`,
    );
    setBusy(true, files.length);
    try {
      const body = new FormData();
      body.append("offerId", offerId);
      for (const file of files) body.append("files", file, file.name);
      const { json, parsed } = await send(body);

      if (!disposed) {
        editor.trigger("asset:upload:response", json);
        const added = addToLibrary(parsed.data);
        editor.trigger("asset:upload:end", json);
        clb?.({ data: added });
      }
      const sent = parsed.data.length;
      if (parsed.errors.length) {
        toast.warning(`${sent} de ${sent + parsed.errors.length} imagens enviadas.`, {
          id: toastId,
          description: parsed.errors
            .slice(0, 4)
            .map((e) => e.error)
            .join(" "),
        });
      } else {
        toast.success(sent === 1 ? "Imagem enviada." : `${sent} imagens enviadas.`, { id: toastId });
      }
      if (!disposed && files.length === 1 && sent === 1 && !placeholder) applyAsset(parsed.data[0].src);
    } catch (err) {
      const error = err instanceof UploadError ? err : new UploadError(statusMessage(0));
      const details = error.details.filter((d) => d !== error.message);
      toast.error(error.message, {
        id: toastId,
        description: details.length ? details.slice(0, 4).join(" ") : undefined,
      });
      if (!disposed) {
        editor.trigger("asset:upload:error", error);
        dropPlaceholder();
      }
    } finally {
      if (!disposed) setBusy(false);
    }
  };

  /**
   * Link colado no campo "Ou cole o link de uma imagem": o servidor baixa a
   * imagem e guarda na biblioteca (a página não fica dependendo do outro site).
   */
  const addFromUrl = async (value: string) => {
    const url = value.trim();
    const restoreField = () => {
      const field = container()?.querySelector<HTMLInputElement>(`.${pfx}add-asset input`);
      if (field && !field.value) field.value = url;
    };
    // Arquivo do próprio painel ou imagem embutida (data:) entra direto.
    if (/^\/(?!\/)\S*$/.test(url) || /^data:image\/[a-z0-9.+-]+[;,]/i.test(url)) {
      if (!am.get(url)) am.add({ type: "image", src: url, name: nameFromUrl(url) }, { at: 0 });
      applyAsset(url);
      return;
    }
    if (!/^https?:\/\/[^\s/]+\S*$/i.test(url)) {
      toast.error("Cole um link de imagem válido, começando com https://");
      restoreField();
      return;
    }
    const toastId = toast.loading("Baixando a imagem do link…");
    try {
      const body = new FormData();
      body.append("offerId", offerId);
      body.append("url", url);
      const { parsed } = await send(body);
      toast.success("Imagem adicionada à biblioteca.", { id: toastId });
      if (disposed) return;
      addToLibrary(parsed.data);
      applyAsset(parsed.data[0].src);
    } catch (err) {
      toast.error(err instanceof UploadError ? err.message : "Não foi possível baixar a imagem desse link.", {
        id: toastId,
      });
      if (!disposed) restoreField();
    }
  };

  // Upload, parâmetros e textos (a configuração é lida na hora de cada envio).
  config.upload = config.upload || UPLOAD_URL;
  config.uploadName = "files";
  config.multiUpload = true;
  config.autoAdd = true;
  config.credentials = "same-origin";
  config.params = { ...(config.params ?? {}), offerId };
  config.showUrlInput = true;
  config.noAssets = LOADING_HTML;
  config.handleAdd = (value: string) => void addFromUrl(value);
  config.uploadFile = uploadFiles;
  // Se o campo de envio já foi criado, troca a função dele também.
  if (am.fu) {
    am.fu.uploadFile = uploadFiles;
    am.fu.delegateEvents();
  }

  const onBeforeOpen = (data: { options: Record<string, unknown> }) => {
    const options = data.options;
    options.accept = ACCEPTED_IMAGES;
    const selected = options.target;
    const select = options.select;
    if (isComponent(selected) && selected.is("image") && typeof select === "function") {
      options.select = (asset: Asset, complete: boolean) => {
        clearResponsiveSources(selected);
        (select as (asset: Asset, complete: boolean) => void)(asset, complete);
      };
    }
  };

  const onOpen = () => {
    const el = container();
    if (el) {
      el.classList.add("os-am");
      el.querySelector<HTMLInputElement>(`#${pfx}uploadFile`)?.setAttribute("accept", ACCEPTED_IMAGES);
      const header = el.querySelector(`.${pfx}assets-header`);
      if (header && !header.querySelector(".os-am-hint")) {
        const hint = document.createElement("p");
        hint.className = "os-am-hint";
        hint.textContent = HINT_TEXT;
        header.appendChild(hint);
      }
    }
    void refresh();
  };

  editor.on("command:run:before:open-assets", onBeforeOpen);
  editor.on("asset:open", onOpen);

  return () => {
    disposed = true;
    editor.off("command:run:before:open-assets", onBeforeOpen);
    editor.off("asset:open", onOpen);
  };
}
