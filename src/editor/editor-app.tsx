"use client";

import "grapesjs/dist/css/grapes.min.css";
import "./grapes/editor.css";

import type { Component, Editor } from "grapesjs";
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleAlertIcon,
  Code2Icon,
  ExternalLinkIcon,
  EyeIcon,
  FileTextIcon,
  HistoryIcon,
  InfoIcon,
  LinkIcon,
  MonitorIcon,
  MonitorSmartphoneIcon,
  MousePointerClickIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  PencilRulerIcon,
  Redo2Icon,
  ReplaceIcon,
  SearchIcon,
  SmartphoneIcon,
  TabletIcon,
  TriangleAlertIcon,
  Undo2Icon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { NotFoundState } from "@/components/app/not-found-state";
import { VariantSwitcher } from "@/components/offers/variants/variant-switcher";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAction } from "@/hooks/use-action";
import { installEditorSync } from "@/lib/find-replace";
import { PAGE_TYPE_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { offerPreviewUrlAction } from "@/server/actions/editor";
import type { EditorPayload } from "@/server/services/documents";
import { configureAssets } from "./grapes/assets";
import {
  CANVAS_FIT_EVENT,
  type CanvasFitInfo,
  fitDevice,
  setCanvasPan,
  setCanvasZoomMode,
  type ZoomMode,
} from "./grapes/canvas-fit";
import { type Patchable, patchOnce, registerDynamicTraits } from "./grapes/components";
import { STATE_LABELS } from "./grapes/i18n";
import { applyLegacyRepair } from "./grapes/legacy-repair";
import { enclosingClickable } from "./grapes/link-select";
import { installNewLinkOption, type NewLinkRequest } from "./grapes/new-link";
import { createEditor, DEVICES, type DeviceId, deviceWidthPx } from "./grapes/setup";
import { skipPhoneValues } from "./grapes/style-cascade";
import { configureVideoUpload } from "./grapes/video-upload";
import { CodeDialog } from "./panels/code-dialog";
import { FindReplaceDialog } from "./panels/find-replace-dialog";
import { LinksDialog } from "./panels/links-dialog";
import { NewLinkDialog } from "./panels/new-link-dialog";
import { VersionsDialog } from "./panels/versions-dialog";
import { setWidgetContext } from "./widgets";

type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";

export interface EditorDialogProps {
  editor: Editor;
  payload: EditorPayload;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Salva agora (se houver alterações). Resolve true se ficou tudo salvo. */
  saveNow: () => Promise<boolean>;
  /** Sai do editor para outra tela do painel, salvando antes (ou perguntando, se não der). */
  navigate: (href: string) => void;
  /** Recarrega o editor sem gravar o que está aberto (a página mudou no servidor). */
  reloadDiscarding: () => void;
}

/** Espera depois da última mudança antes de salvar sozinho. */
const AUTOSAVE_MS = 1500;
/** Novas tentativas quando o salvamento falha (a última se repete). */
const RETRY_DELAYS = [3000, 10_000, 30_000];
/** O link de prévia vale 12 h (src/lib/preview.ts): pede outro um pouco antes. */
const PREVIEW_TTL_MS = 11 * 60 * 60 * 1000;
/** Limite do navegador para pedidos que continuam depois de fechar a aba (keepalive). */
const KEEPALIVE_MAX_BYTES = 60 * 1024;
const SAVE_TOAST_ID = "os-save";

/**
 * Elementos cujas opções importam mais que o estilo (widgets, vídeos): ao
 * selecionar um deles, o painel da direita abre em "Configurações".
 */
const SETTINGS_FIRST_TYPES = new Set([
  "os-countdown",
  "os-scarcity",
  "os-sales-notification",
  "os-exit-popup",
  "os-lead-form",
  "os-whatsapp",
  "os-video-embed",
  "os-vturb-player",
  "os-video-file",
  "os-embed",
  "os-vturb",
  "os-video",
]);

const DEVICE_ICON: Record<DeviceId, typeof MonitorIcon> = {
  desktop: MonitorIcon,
  tablet: TabletIcon,
  mobile: SmartphoneIcon,
};

// ─── Texto sendo digitado no canvas ──────────────────────────────────────────
// Enquanto o editor de texto (dois cliques num texto) está aberto, o GrapesJS só
// passa o texto digitado para o projeto quando a edição fecha. Quem vai gravar
// (⌘S, Prévia, sair da página…) precisa passar antes, sem fechar a edição.

interface TextEditingView {
  rteEnabled?: boolean;
  lastContent?: string;
  model?: Component;
  getChildrenContainer?: () => HTMLElement;
  syncContent?: (opts: { content: string; noCount?: boolean; skipViewUpdate?: boolean }) => Promise<void>;
  renderChildren?: () => void;
}

interface Caret {
  start: number;
  end: number;
}

/** Posição do cursor (ou da seleção) em caracteres do texto do elemento. */
function readCaret(el: HTMLElement): Caret | null {
  const doc = el.ownerDocument;
  const selection = doc.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;
  const measure = doc.createRange();
  measure.selectNodeContents(el);
  measure.setEnd(range.startContainer, range.startOffset);
  const start = measure.toString().length;
  measure.setEnd(range.endContainer, range.endOffset);
  return { start, end: measure.toString().length };
}

function pointAt(el: HTMLElement, offset: number): { node: Node; offset: number } {
  const walker = el.ownerDocument.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  let left = offset;
  let last: Text | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (left <= text.data.length) return { node: text, offset: left };
    left -= text.data.length;
    last = text;
  }
  return last ? { node: last, offset: last.data.length } : { node: el, offset: el.childNodes.length };
}

function placeCaret(el: HTMLElement, caret: Caret) {
  const doc = el.ownerDocument;
  const selection = doc.getSelection();
  if (!selection) return;
  const start = pointAt(el, caret.start);
  const end = pointAt(el, caret.end);
  const range = doc.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Passa para o projeto o texto que está sendo digitado no canvas, sem fechar a
 * edição (o cursor fica onde estava). Síncrono: serve até no aviso de fechar a
 * aba. Devolve true se havia texto novo (uma alteração a gravar).
 */
function editingView(editor: Editor): TextEditingView | undefined {
  const view = (editor.getModel().get("editing") || undefined) as TextEditingView | undefined;
  return view?.rteEnabled && view.getChildrenContainer && view.syncContent ? view : undefined;
}

/**
 * Textos passados para o projeto sem redesenhar a tela (flushTextEditing): o
 * projeto tem os elementos novos do texto, a tela ainda os de antes.
 */
const flushedTexts = new WeakSet<object>();

export function flushTextEditing(editor: Editor): boolean {
  const view = editingView(editor);
  if (!view?.getChildrenContainer || !view.syncContent) return false;
  const el = view.getChildrenContainer();
  const content = el.innerHTML;
  if (content === view.lastContent) return false;
  // Com `content`, o syncContent atualiza o projeto antes do primeiro await.
  // noCount: a digitação já foi contada (component:input).
  if (String(view.model?.get("content") ?? "")) {
    // Texto guardado como texto simples (bloco recém-solto): ao virar elementos,
    // o GrapesJS esvazia a tela do texto — ela é redesenhada, com o cursor no lugar.
    const caret = readCaret(el);
    void view.syncContent({ content, noCount: true });
    const now = view.getChildrenContainer();
    view.lastContent = now.innerHTML;
    if (caret) placeCaret(now, caret);
    return true;
  }
  // skipViewUpdate: o texto na tela fica como está — o cursor no lugar e o
  // desfazer do navegador (⌘Z) ainda desfazendo o que foi digitado antes do ⌘S.
  // Ao fechar a edição, o texto é redesenhado a partir do projeto
  // (installTextFlushRedraw).
  void view.syncContent({ content, noCount: true, skipViewUpdate: true });
  flushedTexts.add(view);
  // Ao fechar a edição, o GrapesJS só sincroniza de novo se o texto mudar depois daqui.
  view.lastContent = content;
  return true;
}

/** Os elementos do texto na tela são os do projeto? (depois de flushTextEditing, não até redesenhar) */
function textDrawn(view: TextEditingView): boolean {
  const container = view.getChildrenContainer?.();
  const children = view.model?.components().models ?? [];
  return (
    Boolean(container) &&
    children.every((c) => {
      const el = c.getEl();
      return Boolean(el) && Boolean(container?.contains(el as Node));
    })
  );
}

/** Redesenha o texto a partir do projeto (o cursor fica no mesmo lugar). */
function redrawText(view: TextEditingView) {
  flushedTexts.delete(view);
  const container = view.getChildrenContainer?.();
  if (!container || !view.renderChildren || textDrawn(view)) return;
  const caret = readCaret(container);
  view.renderChildren();
  if (caret) placeCaret(container, caret);
}

/**
 * Depois de flushTextEditing, a tela do texto só volta a ser a do projeto
 * quando a edição fecha: se nada mudou desde então, o GrapesJS não sincroniza
 * e o texto é redesenhado aqui. Soltar um bloco dentro do texto ainda aberto
 * (insertComponent) também precisa da tela igual ao projeto.
 */
export function installTextFlushRedraw(editor: Editor) {
  const view = (editor.DomComponents.getType("text") as { view?: Patchable } | undefined)?.view;
  patchOnce(view, "text-flush-redraw", (proto) => {
    const disableEditing = proto.disableEditing as (this: TextEditingView, ...args: unknown[]) => Promise<unknown>;
    proto.disableEditing = async function (this: TextEditingView, ...args: unknown[]) {
      const result = await disableEditing.apply(this, args);
      if (flushedTexts.has(this)) redrawText(this);
      return result;
    };
    const insertComponent = proto.insertComponent as (this: TextEditingView, ...args: unknown[]) => unknown;
    proto.insertComponent = function (this: TextEditingView, ...args: unknown[]) {
      if (flushedTexts.has(this)) redrawText(this);
      return insertComponent.apply(this, args);
    };
  });
}

/** Campos do painel com um valor digitado ainda não aplicado (houve "input" depois do último "change"). */
const typedFields = new WeakSet<EventTarget>();

function isPanelField(el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const field =
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "file"].includes(el.type));
  return field && Boolean(el.closest("[data-os-panel]"));
}

/** Acompanha a digitação nos campos do painel (para commitPanelField). Devolve a função que desliga. */
export function trackPanelTyping(doc: Document): () => void {
  const onInput = (e: Event) => {
    if (isPanelField(e.target)) typedFields.add(e.target);
  };
  const onChange = (e: Event) => {
    if (e.target) typedFields.delete(e.target);
  };
  doc.addEventListener("input", onInput, true);
  doc.addEventListener("change", onChange, true);
  return () => {
    doc.removeEventListener("input", onInput, true);
    doc.removeEventListener("change", onChange, true);
  };
}

/**
 * Campo do Estilo ou das Configurações com um valor digitado e ainda não
 * aplicado: o GrapesJS só lê o campo no "change" (Enter ou sair dele). Salvar
 * com ⌘S ou fechar a aba não tiram o foco do campo — aqui o valor é aplicado
 * antes (vira uma alteração a gravar). Só vale para um campo em que a pessoa
 * digitou: o foco parado num campo não muda nada (o campo de cor, por
 * exemplo, mostraria "rgb(…)" reescrito como "#…", e no Celular criaria uma
 * regra só do celular). Devolve true se havia um campo assim.
 */
export function commitPanelField(): boolean {
  const el = document.activeElement;
  if (!isPanelField(el) || !typedFields.has(el)) return false;
  el.dispatchEvent(new Event("change", { bubbles: true }));
  typedFields.delete(el);
  return true;
}

/**
 * O que vai para o servidor: projeto, HTML completo e CSS das edições. Chame
 * flushTextEditing antes: com a edição de texto aberta, o getProjectData do
 * GrapesJS sincroniza o texto de novo por conta própria, depois de um await, e
 * isso joga o cursor para o começo — como o texto já foi passado, essa
 * sincronização extra é desligada enquanto lê.
 */
function snapshotOf(editor: Editor) {
  const view = editingView(editor);
  if (view) view.rteEnabled = false;
  try {
    // A biblioteca de imagens vem do servidor sempre que o seletor abre: não vai no projeto.
    const { assets: _assets, ...project } = editor.getProjectData();
    return {
      project,
      html: editor.getHtml({ asDocument: true } as never),
      css: editor.getCss({ avoidProtected: true }) ?? "",
    };
  } finally {
    if (view) view.rteEnabled = true;
  }
}

/** Clique simples (sem ⌘/Ctrl/Shift/botão do meio): esse o app trata; os outros abrem aba nova. */
function isPlainClick(e: React.MouseEvent) {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

// ─── Espaço na tela ──────────────────────────────────────────────────────────

/** Painéis abertos/fechados escolhidos pela pessoa (valem para todas as páginas). */
const PANELS_KEY = "offerstudio.editor.paineis";
/** Abaixo disso o editor não cabe: aparece o aviso para aumentar a janela. */
export const MIN_EDITOR_WIDTH = 900;
/** Abaixo disso o painel de Blocos começa recolhido (o canvas fica maior). */
export const COMPACT_EDITOR_WIDTH = 1200;

interface PanelPrefs {
  left?: boolean;
  right?: boolean;
}

function readPanelPrefs(): PanelPrefs {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(PANELS_KEY) ?? "null");
    if (!value || typeof value !== "object") return {};
    const { left, right } = value as Record<string, unknown>;
    return {
      left: typeof left === "boolean" ? left : undefined,
      right: typeof right === "boolean" ? right : undefined,
    };
  } catch {
    return {};
  }
}

function writePanelPrefs(prefs: PanelPrefs) {
  try {
    window.localStorage.setItem(PANELS_KEY, JSON.stringify(prefs));
  } catch {
    // Sem armazenamento (janela anônima): vale só nesta aba.
  }
}

function useViewportWidth() {
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? 1440 : window.innerWidth));
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

/** Campo de texto ou texto sendo editado (também dentro do canvas, que é outro documento). */
function isTypingTarget(target: EventTarget | null | undefined) {
  const el = target as (Partial<HTMLElement> & { tagName?: string }) | null | undefined;
  if (!el || typeof el.tagName !== "string") return false;
  return Boolean(el.isContentEditable) || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

// ─── Nome da página na barra ─────────────────────────────────────────────────

/**
 * Título e subtítulo da barra. Páginas clonadas costumam ter o nome da oferta:
 * aí o nome aparece uma vez só e o subtítulo diz o tipo e o endereço.
 */
export function headerNames(payload: EditorPayload, split: boolean): { title: string; subtitle: string } {
  const sameName = payload.page.name.trim().toLowerCase() === payload.offer.name.trim().toLowerCase();
  const variants = payload.variants?.length ?? 0;
  const parts: string[] = [];
  if (sameName) {
    const isHome = payload.pages.find((p) => p.id === payload.page.id)?.isHome;
    const type = PAGE_TYPE_LABEL[payload.page.type as keyof typeof PAGE_TYPE_LABEL] ?? "Página";
    parts.push(`${type} · ${isHome ? "/" : `/${payload.page.slug}/`}`);
  } else {
    parts.push(payload.offer.name);
  }
  if (payload.variant.name !== "A" || variants > 1) {
    parts.push(`Versão ${payload.variant.name}${payload.variant.isControl && variants > 1 ? " (controle)" : ""}`);
  }
  if (!split && payload.device !== "ALL") {
    parts.push(payload.device === "MOBILE" ? "layout do celular" : "layout do computador");
  }
  return { title: payload.page.name, subtitle: parts.join(" · ") };
}

function PageTitle({ payload, split }: { payload: EditorPayload; split: boolean }) {
  const { title, subtitle } = headerNames(payload, split);
  return (
    <div className="min-w-0 border-l pl-3">
      <p className="truncate text-sm font-medium leading-tight" title={title}>
        {title}
      </p>
      <p className="truncate text-xs text-muted-foreground leading-tight" title={subtitle}>
        {subtitle}
      </p>
    </div>
  );
}

/** Janela estreita demais para o editor (celular, janela pequena): diz o que fazer. */
function NarrowScreenNotice({
  offerHref,
  onBack,
  onOpenPage,
}: {
  offerHref: string;
  /** Sai do editor salvando antes (o Link sozinho não salva). */
  onBack?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  onOpenPage?: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="os-narrow-title"
      className="fixed inset-0 z-50 grid place-items-center bg-background p-6 text-center"
    >
      <div className="flex max-w-sm flex-col items-center gap-3">
        <MonitorSmartphoneIcon className="size-10 text-muted-foreground" aria-hidden />
        <h1 id="os-narrow-title" className="text-lg font-semibold">
          O editor precisa de uma janela maior
        </h1>
        <p className="text-sm text-muted-foreground">
          Ele foi feito para o computador: aumente a janela do navegador (ou abra no Mac) para editar. Daqui dá para ver
          a página ou voltar para a oferta.
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {onOpenPage && (
            <Button variant="outline" onClick={onOpenPage}>
              <ExternalLinkIcon />
              Ver página
            </Button>
          )}
          <Button asChild>
            <Link href={offerHref} onClick={onBack}>
              <ArrowLeftIcon />
              Voltar para a oferta
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Barra superior ──────────────────────────────────────────────────────────

function SaveStatus({ state, savedAt, onRetry }: { state: SaveState; savedAt: string | null; onRetry: () => void }) {
  if (state === "saving") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Spinner className="size-3.5" />
        Salvando…
      </span>
    );
  }
  if (state === "dirty") return <span className="text-xs text-muted-foreground">Alterações não salvas</span>;
  if (state === "error" || state === "conflict") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-1.5 text-xs text-destructive hover:underline"
      >
        <CircleAlertIcon className="size-3.5" />
        {state === "conflict" ? "Conflito ao salvar" : "Erro ao salvar — tentar de novo"}
      </button>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground" suppressHydrationWarning>
      <CheckCircle2Icon className="size-3.5 text-success" />
      {savedAt
        ? `Salvo às ${new Date(savedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
        : "Salvo"}
    </span>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
  active,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={active ? "secondary" : "ghost"}
          size="icon-sm"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function Notice({
  tone = "info",
  children,
  action,
}: {
  tone?: "info" | "warning";
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  const Icon = tone === "warning" ? TriangleAlertIcon : InfoIcon;
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs",
        tone === "warning" ? "bg-warning/10" : "bg-muted/60",
      )}
    >
      <Icon className={cn("size-3.5 shrink-0", tone === "warning" ? "text-warning" : "text-muted-foreground")} />
      <p className="min-w-0 flex-1">{children}</p>
      {action}
    </div>
  );
}

/** "estilo ao passar o mouse" etc. (estados escolhidos em "Avançado"). */
function stateLabel(state: string) {
  const label = STATE_LABELS[state];
  return label ? `“${label.toLowerCase()}”` : `do estado “${state}”`;
}

/**
 * Texto dentro de um link/botão selecionado (dois cliques, camadas): o link, a
 * página do funil e o evento ficam no link — um atalho leva até ele.
 */
function LinkParentHint({ onSelect }: { onSelect: () => void }) {
  return (
    <div className="flex items-center gap-2 border-b bg-muted/60 px-3 py-2 text-xs">
      <LinkIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <p className="min-w-0 flex-1">Este texto está dentro de um botão ou link.</p>
      <Button variant="outline" size="sm" className="h-7 shrink-0" onClick={onSelect}>
        Configurar o botão
      </Button>
    </div>
  );
}

/** Painel da direita sem nada selecionado: diz o que fazer em vez de mostrar controles que não agem. */
function NothingSelected({ tab }: { tab: "estilo" | "config" }) {
  return (
    <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
      <MousePointerClickIcon className="size-8 text-muted-foreground" />
      <p className="font-medium text-sm">Selecione um elemento na página</p>
      <p className="text-xs text-muted-foreground">
        {tab === "estilo"
          ? "Clique em um texto, imagem ou botão para mudar cor, tamanho, fonte e espaçamento."
          : "Clique em um botão, imagem, vídeo ou formulário para ver as configurações dele (link, endereço, opções)."}
      </p>
      <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-left text-xs text-muted-foreground">
        <li>Dois cliques num texto: edita o texto.</li>
        <li>Dois cliques numa imagem: troca a imagem.</li>
        <li>Um clique num botão seleciona o botão (link, checkout); outro clique entra no texto dele.</li>
      </ul>
    </div>
  );
}

// ─── Abrir o editor ──────────────────────────────────────────────────────────

export function EditorApp({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [payload, setPayload] = useState<EditorPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPayload(null);
    setLoadError(null);
    setNotFound(false);
    fetch(`/api/documents/${documentId}`, { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json()) as EditorPayload & { error?: string };
        if (cancelled) return;
        if (res.status === 404) setNotFound(true);
        else if (!res.ok) setLoadError(body.error ?? "Não foi possível abrir esta página.");
        else setPayload(body);
      })
      .catch(() => !cancelled && setLoadError("Não foi possível falar com o Offer Studio. Ele ainda está aberto?"));
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  // Página excluída (ou oferta na lixeira) depois que o endereço foi aberto: a mesma tela do 404.
  if (notFound) {
    return (
      <NotFoundState
        fullPage
        title="Página não encontrada"
        description="Esta página foi excluída, ou a oferta dela está na lixeira."
        actions={[
          { label: "Ir para as ofertas", href: "/ofertas" },
          { label: "Abrir a lixeira", href: "/lixeira" },
        ]}
      />
    );
  }
  if (loadError) {
    return (
      <div className="grid h-svh place-items-center p-6 text-center">
        <div className="max-w-sm">
          <CircleAlertIcon className="mx-auto size-8 text-destructive" />
          <h1 className="mt-3 text-lg font-semibold">Não foi possível abrir o editor</h1>
          <p className="mt-1 text-sm text-muted-foreground">{loadError}</p>
          <Button
            className="mt-4"
            // Numa aba aberta direto neste endereço não há para onde voltar: vai para as ofertas.
            onClick={() => (window.history.length > 1 ? router.back() : router.push("/ofertas"))}
          >
            Voltar
          </Button>
        </div>
      </div>
    );
  }
  if (!payload || payload.documentId !== documentId) {
    return (
      <div className="grid h-svh place-items-center">
        <Spinner className="size-6 text-primary" />
      </div>
    );
  }
  // Uma instância por documento: trocar de página começa do zero (revisão, contadores…).
  return <EditorGate key={payload.documentId} payload={payload} />;
}

/**
 * Páginas "Preservar JS" nunca abertas no editor: o editor reescreve o HTML e
 * pode quebrar os scripts originais. Primeiro mostra a página como ela é e só
 * abre o editor se a pessoa pedir.
 */
function EditorGate({ payload }: { payload: EditorPayload }) {
  const [convert, setConvert] = useState(false);
  if (payload.cloneMode === "PRESERVE_JS" && !payload.project && !convert) {
    return <PreserveJsNotice payload={payload} onConvert={() => setConvert(true)} />;
  }
  return <EditorWorkspace payload={payload} />;
}

function previewDeviceOf(payload: EditorPayload): "celular" | "desktop" {
  return payload.device === "MOBILE" ? "celular" : "desktop";
}

function PreserveJsNotice({ payload, onConvert }: { payload: EditorPayload; onConvert: () => void }) {
  const router = useRouter();
  const previewAction = useAction(offerPreviewUrlAction);
  const runPreview = previewAction.run;
  /** Link de prévia e quando foi pedido (ele vence em 12 h). */
  const [preview, setPreview] = useState<{ url: string; at: number } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const requestPreview = useCallback(async () => {
    const res = await runPreview({ offerId: payload.offer.id, pageId: payload.page.id, variantId: payload.variant.id });
    if (!res.ok) return null;
    setPreview({ url: res.data.url, at: Date.now() });
    return res.data.url;
  }, [runPreview, payload.offer.id, payload.page.id, payload.variant.id]);

  useEffect(() => {
    void requestPreview();
  }, [requestPreview]);

  const withDevice = (url: string) => `${url}?dispositivo=${previewDeviceOf(payload)}`;
  const src = preview ? withDevice(preview.url) : null;

  /** Tela aberta há horas: o link guardado pode ter vencido — pede outro antes de abrir. */
  async function openAsVisitor() {
    const url = preview && Date.now() - preview.at < PREVIEW_TTL_MS ? preview.url : await requestPreview();
    if (url) window.open(withDevice(url), "_blank", "noopener");
  }

  return (
    <div className="os-editor flex h-svh flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/ofertas/${payload.offer.id}`} aria-label="Voltar para a oferta">
            <ArrowLeftIcon />
            <span className="hidden lg:inline">Oferta</span>
          </Link>
        </Button>
        <PageTitle payload={payload} split={false} />
        {/* Nada a salvar nesta tela: trocar de versão A/B é só navegar. */}
        <VariantSwitcher
          variants={payload.variants}
          currentVariantId={payload.variant.id}
          device={payload.device}
          onSelect={(documentId) => router.push(`/editor/${documentId}`)}
        />
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 lg:flex-row">
        <section className="flex max-w-md shrink-0 flex-col gap-3 rounded-lg border bg-card p-5 text-sm">
          <h1 className="font-semibold text-base">Esta página usa os scripts originais (“Preservar JS”)</h1>
          <p className="text-muted-foreground">
            Ela foi clonada para funcionar com os scripts do site original — quiz, calculadora, carrinho, animações. Por
            isso ela não abre direto no editor visual: o editor reescreve o HTML da página, e os scripts que dependem do
            HTML original podem parar de funcionar.
          </p>
          <p className="text-muted-foreground">
            Ao lado está a página como o visitante vê. Se precisar mudar textos ou imagens, converta para editável: a
            página de agora fica guardada no Histórico (“Original da clonagem”) assim que você fizer a primeira
            alteração, e dá para voltar a ela.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button onClick={() => setConfirming(true)}>
              <PencilRulerIcon />
              Converter para editável
            </Button>
            <Button
              variant="outline"
              disabled={!preview}
              onClick={() => void openAsVisitor()}
              title="Abre a página numa aba nova, como o visitante vê"
            >
              <ExternalLinkIcon />
              Ver página
            </Button>
          </div>
        </section>
        <div className="flex min-h-[60vh] min-w-0 flex-1 justify-center rounded-lg border bg-muted/40 p-3">
          {src ? (
            <iframe
              title="Prévia da página"
              src={src}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
              className="h-full min-h-[60vh] w-full rounded-md border bg-white"
              style={payload.device === "MOBILE" ? { maxWidth: 375 } : undefined}
            />
          ) : (
            <div className="grid flex-1 place-items-center">
              {previewAction.pending ? (
                <Spinner className="size-6 text-primary" />
              ) : (
                <p className="text-sm text-muted-foreground">Não foi possível mostrar a prévia desta página.</p>
              )}
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Converter para editável?"
        description="O editor visual reescreve o HTML desta página na primeira alteração que você fizer. Quiz, formulários e outros recursos feitos com os scripts originais podem parar de funcionar. Nada é gravado só por abrir, e a página de agora fica guardada no Histórico (“Original da clonagem”) para você poder voltar."
        confirmLabel="Converter e abrir no editor"
        onConfirm={() => {
          setConfirming(false);
          onConvert();
        }}
      />
    </div>
  );
}

// ─── Prévia do dispositivo ───────────────────────────────────────────────────

/**
 * Prévia na largura real do dispositivo (Desktop: 1280px, como o canvas),
 * reduzida para caber na área. Sem isso a prévia do "Desktop" tinha só a sobra
 * entre os painéis, e as regras de tablet/celular da página valiam nela.
 */
function DevicePreview({ src, device }: { src: string; device: DeviceId }) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const measure = () => setArea({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, []);

  const fit =
    area && area.width > 0 && area.height > 0 ? fitDevice(deviceWidthPx(device), area.width, area.height) : null;
  return (
    // Posição e tamanho em style: a área não depende das classes do painel.
    <div ref={areaRef} style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      {fit && area && (
        <iframe
          key={src}
          title="Prévia da página"
          src={src}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          // Contorno sem borda: a borda tiraria pixels da largura do dispositivo.
          className="rounded-lg bg-white shadow-sm ring-1 ring-border"
          style={{
            position: "absolute",
            border: 0,
            boxSizing: "border-box",
            left: fit.left,
            top: fit.top,
            width: fit.width,
            height: fit.height ?? area.height,
            transform: fit.scale === 1 ? undefined : `scale(${fit.scale})`,
            transformOrigin: "top left",
          }}
        />
      )}
    </div>
  );
}

// ─── Editor ──────────────────────────────────────────────────────────────────

interface SaveOptions {
  /** Grava mesmo sem alterações novas (⌘S, tentar de novo). */
  force?: boolean;
  /** O pedido continua mesmo se a aba fechar (aviso de fechar a aba). */
  keepalive?: boolean;
}

function EditorWorkspace({ payload }: { payload: EditorPayload }) {
  const router = useRouter();
  const canvasRef = useRef<HTMLDivElement>(null);
  const blocksRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<HTMLDivElement>(null);
  const selectorsRef = useRef<HTMLDivElement>(null);
  const stylesRef = useRef<HTMLDivElement>(null);
  const traitsRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);

  const [editor, setEditor] = useState<Editor | null>(null);
  const [device, setDevice] = useState<DeviceId>(payload.device === "MOBILE" ? "mobile" : "desktop");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [dialog, setDialog] = useState<"code" | "find" | "links" | "versions" | null>(null);
  const [newLink, setNewLink] = useState<NewLinkRequest | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<string | null>(null);
  const [layerQuery, setLayerQuery] = useState("");
  const [rightTab, setRightTab] = useState("estilo");
  const [hasSelection, setHasSelection] = useState(false);
  /** Link/botão em volta do elemento selecionado (atalho "Configurar o botão"). */
  const [linkParent, setLinkParent] = useState<Component | null>(null);
  /** Estado do estilo (":hover"…) escolhido em "Avançado"; "" = normal. */
  const [styleState, setStyleState] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  /** Zoom aplicado no canvas (canvas-fit.ts). */
  const [fit, setFit] = useState<CanvasFitInfo | null>(null);
  const viewportWidth = useViewportWidth();
  const [panelPrefs, setPanelPrefs] = useState<PanelPrefs>(() => readPanelPrefs());
  // Sem escolha guardada: em janelas médias o painel de Blocos começa recolhido.
  const leftOpen = panelPrefs.left ?? viewportWidth >= COMPACT_EDITOR_WIDTH;
  const rightOpen = panelPrefs.right ?? true;

  const revision = useRef(payload.revision);
  /** Houve 409: nada grava até a pessoa escolher no diálogo de conflito. */
  const conflicted = useRef(false);
  /** Revisão do servidor no 409 (só "Manter a minha" passa a usá-la). */
  const conflictRevision = useRef<number | null>(null);
  /** A pessoa escolheu descartar (recarregar/sair sem salvar): nada mais grava. */
  const discarding = useRef(false);
  const changeCounter = useRef(0);
  const savedCounter = useRef(0);
  const saving = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const retries = useRef(0);
  const ready = useRef(false);
  const leaving = useRef(false);
  const preview = useRef<{ url: string; at: number } | null>(null);
  const previewAction = useAction(offerPreviewUrlAction);

  const preserveJs = payload.cloneMode === "PRESERVE_JS";
  const desktopDoc = payload.documents.find((d) => d.device === "DESKTOP");
  const mobileDoc = payload.documents.find((d) => d.device === "MOBILE");
  const split = Boolean(desktopDoc && mobileDoc) && payload.device !== "ALL";
  const documentUrl = `/api/documents/${payload.documentId}`;

  /**
   * Grava o estado atual. Uma gravação por vez: quem chega durante outra espera
   * ela terminar e grava com a revisão nova (nunca duas com a mesma revisão).
   */
  const save = useCallback(
    async (opts: SaveOptions = {}): Promise<boolean> => {
      const ed = editorRef.current;
      if (!ed || discarding.current) return false;
      if (flushTextEditing(ed)) changeCounter.current++;
      if (conflicted.current) {
        setConflictOpen(true);
        return false;
      }
      while (saving.current) {
        const pending = saving.current;
        await pending.catch(() => false);
        if (saving.current === pending) saving.current = null;
      }
      if (editorRef.current !== ed || discarding.current) return false;
      if (conflicted.current) {
        setConflictOpen(true);
        return false;
      }
      // Pode ter digitado mais enquanto esperava a gravação anterior.
      if (flushTextEditing(ed)) changeCounter.current++;
      if (!opts.force && changeCounter.current === savedCounter.current) return true;

      const counterAtStart = changeCounter.current;
      let body: string;
      try {
        body = JSON.stringify({ revision: revision.current, ...snapshotOf(ed) });
      } catch {
        setSaveState("error");
        return false;
      }
      clearTimeout(timer.current);
      setSaveState("saving");
      let task: Promise<boolean> | null = null;
      task = (async (): Promise<boolean> => {
        try {
          const res = await fetch(documentUrl, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body,
            keepalive: Boolean(opts.keepalive) && body.length < KEEPALIVE_MAX_BYTES,
          });
          const data = (await res.json().catch(() => ({}))) as { revision?: number; savedAt?: string; error?: string };
          if (res.status === 409) {
            conflicted.current = true;
            conflictRevision.current = typeof data.revision === "number" ? data.revision : null;
            clearTimeout(timer.current);
            setSaveState("conflict");
            setConflictOpen(true);
            return false;
          }
          if (!res.ok) {
            setSaveState("error");
            if (retries.current === 0) {
              toast.error(data.error ?? "Não foi possível salvar esta página.", {
                id: SAVE_TOAST_ID,
                description: "Suas alterações continuam aqui. Vamos tentar salvar de novo em alguns segundos.",
              });
            }
            return false;
          }
          revision.current = data.revision ?? revision.current + 1;
          savedCounter.current = counterAtStart;
          if (retries.current > 0) toast.dismiss(SAVE_TOAST_ID);
          retries.current = 0;
          setSavedAt(data.savedAt ?? new Date().toISOString());
          setSaveState(changeCounter.current === counterAtStart ? "saved" : "dirty");
          setPreviewKey((k) => k + 1);
          return changeCounter.current === counterAtStart;
        } catch {
          setSaveState("error");
          if (retries.current === 0) {
            toast.error("Sem conexão com o Offer Studio.", {
              id: SAVE_TOAST_ID,
              description: "Suas alterações continuam aqui. Vamos tentar salvar de novo em alguns segundos.",
            });
          }
          return false;
        } finally {
          if (saving.current === task) saving.current = null;
        }
      })();
      saving.current = task;
      return task;
    },
    [documentUrl],
  );

  const scheduleSave = useCallback(() => {
    clearTimeout(timer.current);
    const tick = () => {
      const ed = editorRef.current;
      if (!ed || conflicted.current || discarding.current) return;
      // Texto sendo digitado: espera a edição fechar (gravar agora mexeria no cursor).
      if (ed.getEditing()) {
        timer.current = setTimeout(tick, AUTOSAVE_MS);
        return;
      }
      void save();
    };
    timer.current = setTimeout(tick, AUTOSAVE_MS);
  }, [save]);

  /** Qualquer mudança no projeto (contada na hora, antes do "update" do GrapesJS). */
  const markDirty = useCallback(() => {
    if (!ready.current || discarding.current) return;
    changeCounter.current++;
    if (conflicted.current) return;
    setSaveState("dirty");
    scheduleSave();
  }, [scheduleSave]);

  /**
   * Localizar e substituir, links, código e versões mexem na página inteira:
   * um texto sendo digitado fecha antes (o que foi digitado vai para o projeto
   * e a tela do texto volta a ser a do projeto).
   */
  const openDialog = useCallback(
    (name: "code" | "find" | "links" | "versions") => {
      const ed = editorRef.current;
      const editing = ed?.getEditing();
      if (ed && editing) {
        if (flushTextEditing(ed)) markDirty();
        editing.trigger("disable");
      }
      setDialog(name);
    },
    [markDirty],
  );

  /** Página reparada ao abrir: guarda no Histórico como ela estava e grava a reparada. */
  const saveRepair = useCallback(async () => {
    try {
      const res = await fetch(`${documentUrl}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Restaurada, abre como estava (sem ser reparada de novo).
        body: JSON.stringify({ label: "Antes do reparo automático", openAsIs: true }),
      });
      await res.body?.cancel();
    } catch {
      // Sem a versão, grava assim mesmo: o reparo corrige a página.
    }
    await save({ force: true });
  }, [documentUrl, save]);

  // Cria o editor uma vez.
  useEffect(() => {
    if (!canvasRef.current || editorRef.current) return;
    const ed = createEditor(
      {
        canvas: canvasRef.current,
        blocks: blocksRef.current as HTMLElement,
        layers: layersRef.current as HTMLElement,
        selectors: selectorsRef.current ?? undefined,
        styles: stylesRef.current as HTMLElement,
        traits: traitsRef.current as HTMLElement,
      },
      payload.project,
    );
    editorRef.current = ed;
    // Layout do computador com layout do celular separado: o celular vê o outro documento.
    if (payload.device === "DESKTOP" && payload.documents.some((d) => d.device === "MOBILE")) skipPhoneValues(ed);
    installTextFlushRedraw(ed);
    // payload.links é atualizado no lugar por "Links e checkouts" (links criados ali aparecem na hora).
    const offerData = () => ({ links: payload.links, pages: payload.pages });
    registerDynamicTraits(ed, offerData);
    setWidgetContext(ed, offerData);
    const disposeAssets = configureAssets(ed, payload.offer.id);
    const disposeVideo = configureVideoUpload(ed, payload.offer.id);
    const disposeSync = installEditorSync(ed);
    const disposeNewLink = installNewLinkOption(ed, setNewLink);

    const refreshUndo = () => {
      const um = ed.UndoManager;
      setCanUndo(um.hasUndo());
      setCanRedo(um.hasRedo());
    };

    ed.on("load", () => {
      // Layout do celular (páginas com computador e celular separados): ele só vai para
      // celulares, então as edições valem para qualquer largura (sem @media).
      if (payload.device === "MOBILE") {
        for (const d of ed.Devices.getDevices()) d.set("widthMedia", "");
      }
      let firstSave = false;
      // Página gravada antes de correções do editor: repara e grava (a situação de
      // antes fica no Histórico).
      let repaired = false;
      if (payload.project && applyLegacyRepair(ed, payload.repair)) {
        ed.UndoManager.clear();
        changeCounter.current++;
        repaired = true;
      }
      if (!payload.project && payload.html) {
        // Primeira abertura: importa o HTML. Páginas comuns são salvas na hora (o
        // original vira o "Original da clonagem" do Histórico); páginas "Preservar JS" só gravam
        // quando houver uma alteração de verdade.
        ed.setComponents(payload.html, { asDocument: true } as never);
        ed.UndoManager.clear();
        if (!preserveJs) {
          changeCounter.current++;
          firstSave = true;
        }
      }
      ed.setDevice(payload.device === "MOBILE" ? "mobile" : "desktop");
      ready.current = true;
      refreshUndo();
      setEditor(ed);
      if (firstSave) void save({ force: true });
      else if (repaired) void saveRepair();
    });
    // "updateBefore" sai na hora de cada mudança; o "update" só depois (setTimeout).
    ed.on("updateBefore", markDirty);
    // Digitação no editor de texto: o GrapesJS só avisa "update" quando a edição fecha.
    ed.on("component:input", markDirty);
    ed.on("update", refreshUndo);
    // Desfazer/refazer de mudanças no CSS (lista de regras) não passam pelo "update".
    ed.on("undo redo", () => {
      refreshUndo();
      markDirty();
    });
    ed.on("component:toggled", () => {
      const all = ed.getSelectedAll();
      setHasSelection(all.length > 0);
      setLinkParent(all.length === 1 ? enclosingClickable(all[0]) : null);
    });
    ed.on(CANVAS_FIT_EVENT, (info: CanvasFitInfo) => setFit(info));
    ed.on("selector:state", () => {
      const state = String(ed.Selectors.getState() ?? "");
      setStyleState(state);
      if (state) setAdvancedOpen(true);
    });
    // Widgets e vídeos: o que importa está em "Configurações".
    ed.on("component:selected", (component: Component | undefined) => {
      if (SETTINGS_FIRST_TYPES.has(component?.get("type") ?? "")) setRightTab("config");
    });

    // ⌘S / Ctrl+S salva em qualquer lugar do editor: no canvas (inclusive
    // digitando um texto), nos painéis e nos campos. O GrapesJS repassa as teclas
    // do canvas como uma cópia; o evento de verdade (do canvas) também é cancelado
    // para o navegador não abrir "Salvar como…".
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "s") return;
      // No editor de código, ⌘S aplica o código (o próprio editor de código trata).
      if (e.target instanceof Element && e.target.closest(".cm-editor")) return;
      e.preventDefault();
      (e as KeyboardEvent & { _parentEvent?: Event })._parentEvent?.preventDefault();
      // Valor digitado num campo do painel (sem Enter) entra no que é salvo.
      commitPanelField();
      // Fora do evento da tecla (o texto sendo editado pode ser redesenhado).
      setTimeout(() => void save({ force: true }), 0);
    };
    window.addEventListener("keydown", onKeyDown, true);
    const untrackTyping = trackPanelTyping(document);

    const mounted = [blocksRef, layersRef, selectorsRef, stylesRef, traitsRef];
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener("keydown", onKeyDown, true);
      untrackTyping();
      // Saindo do editor (navegação dentro do app, botão voltar do navegador):
      // grava o que ficou pendente. A página não fecha, então o pedido termina.
      if (ready.current && !discarding.current && !conflicted.current) {
        if (flushTextEditing(ed)) changeCounter.current++;
        if (changeCounter.current !== savedCounter.current) {
          let data: ReturnType<typeof snapshotOf> | null = null;
          try {
            data = snapshotOf(ed);
          } catch {
            data = null;
          }
          const counter = changeCounter.current;
          const send = () => {
            if (!data || conflicted.current || savedCounter.current === counter) return;
            const body = JSON.stringify({ revision: revision.current, ...data });
            void fetch(documentUrl, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body,
              keepalive: body.length < KEEPALIVE_MAX_BYTES,
            }).catch(() => undefined);
          };
          const pending = saving.current;
          if (pending) void pending.then(send, send);
          else send();
        }
      }
      ready.current = false;
      disposeSync();
      disposeNewLink();
      disposeAssets();
      disposeVideo();
      ed.destroy();
      editorRef.current = null;
      // Os painéis nativos ficam nos nossos contêineres: limpa para não duplicar.
      for (const ref of mounted) if (ref.current) ref.current.innerHTML = "";
    };
  }, [payload, preserveJs, documentUrl, save, saveRepair, markDirty]);

  // Aviso ao fechar a aba com alterações não salvas (inclusive texto sendo digitado).
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (discarding.current) return;
      const ed = editorRef.current;
      if (ed && flushTextEditing(ed)) changeCounter.current++;
      // Valor digitado num campo do painel (sem Enter): conta como alteração.
      if (ed) commitPanelField();
      if (changeCounter.current === savedCounter.current) return;
      e.preventDefault();
      if (!conflicted.current) void save({ keepalive: true });
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [save]);

  // Falhou ao salvar: tenta de novo sozinho (3 s, 10 s, depois a cada 30 s).
  useEffect(() => {
    if (saveState !== "error") return;
    const delay = RETRY_DELAYS[Math.min(retries.current, RETRY_DELAYS.length - 1)];
    retries.current++;
    const retry = setTimeout(() => void save({ force: true }), delay);
    return () => clearTimeout(retry);
  }, [saveState, save]);

  /** Sai do editor: salva antes; se não der, pergunta. */
  const leave = useCallback(
    async (href: string) => {
      if (leaving.current) return;
      leaving.current = true;
      try {
        const ok = conflicted.current ? false : await save();
        if (!ok && changeCounter.current !== savedCounter.current && !discarding.current) {
          // Um 409 agora abriria o diálogo de conflito junto: fica só a pergunta de
          // sair (o texto dela fala do conflito; "Continuar editando" volta a ele).
          setConflictOpen(false);
          setPendingLeave(href);
          return;
        }
        router.push(href);
      } finally {
        leaving.current = false;
      }
    },
    [save, router],
  );

  const reloadDiscarding = useCallback(() => {
    discarding.current = true;
    clearTimeout(timer.current);
    window.location.reload();
  }, []);

  function onLinkClick(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
    if (!isPlainClick(e)) return;
    e.preventDefault();
    void leave(href);
  }

  function keepMine() {
    if (conflictRevision.current !== null) revision.current = conflictRevision.current;
    conflictRevision.current = null;
    conflicted.current = false;
    setConflictOpen(false);
    void save({ force: true });
  }

  /** Abre/fecha um painel lateral ("[" e "]"); a escolha fica guardada. */
  const togglePanel = useCallback((side: "left" | "right") => {
    setPanelPrefs((prev) => {
      const current = side === "left" ? (prev.left ?? window.innerWidth >= COMPACT_EDITOR_WIDTH) : (prev.right ?? true);
      const next = { ...prev, [side]: !current };
      writePanelPrefs(next);
      return next;
    });
  }, []);

  // "[" e "]" recolhem os painéis (fora de campos e do texto sendo editado).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "[" && e.key !== "]") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const parent = (e as KeyboardEvent & { _parentEvent?: Event })._parentEvent;
      if (isTypingTarget(e.target) || isTypingTarget(parent?.target) || editorRef.current?.getEditing()) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      e.preventDefault();
      togglePanel(e.key === "[" ? "left" : "right");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [togglePanel]);

  function changeZoom(mode: ZoomMode) {
    if (editorRef.current) setCanvasZoomMode(editorRef.current, mode);
  }

  /** Seleciona o link/botão em volta do texto e mostra as configurações dele. */
  function selectLinkParent() {
    const ed = editorRef.current;
    if (!ed || !linkParent) return;
    ed.select(linkParent);
    setRightTab("config");
  }

  function changeDevice(next: DeviceId) {
    setDevice(next);
    editorRef.current?.setDevice(next);
  }

  async function ensurePreviewUrl() {
    const cached = preview.current;
    if (cached && Date.now() - cached.at < PREVIEW_TTL_MS) return cached.url;
    const result = await previewAction.run({
      offerId: payload.offer.id,
      pageId: payload.page.id,
      variantId: payload.variant.id,
    });
    if (!result.ok) return null;
    preview.current = { url: result.data.url, at: Date.now() };
    setPreviewUrl(result.data.url);
    return result.data.url;
  }

  /** Salva antes de mostrar a página: a prévia lê o que está gravado. */
  async function saveForPreview() {
    const ok = await save();
    if (ok || changeCounter.current === savedCounter.current) return true;
    if (!conflicted.current) toast.error("Não foi possível salvar as últimas alterações. Tente de novo em instantes.");
    return false;
  }

  async function togglePreview() {
    if (previewing) {
      setPreviewing(false);
      return;
    }
    if (!(await saveForPreview())) return;
    const url = await ensurePreviewUrl();
    if (url) setPreviewing(true);
  }

  async function openAsVisitor() {
    if (!(await saveForPreview())) return;
    const url = await ensurePreviewUrl();
    // Versão celular: abre ela (sem o parâmetro, o servidor escolhe pelo navegador).
    if (url) window.open(payload.device === "MOBILE" ? `${url}?dispositivo=celular` : url, "_blank", "noopener");
  }

  /** Busca nas camadas: seleciona o primeiro elemento com o texto e rola até ele. */
  function findInLayers(query: string) {
    const ed = editorRef.current;
    const q = query.trim().toLowerCase();
    if (!ed || !q) return;
    const wrapper = ed.getWrapper();
    const match = wrapper
      ?.find("*")
      .find(
        (c) =>
          (c.getEl()?.textContent ?? "").toLowerCase().includes(q) &&
          c.get("selectable") !== false &&
          !c.components().length,
      );
    const fallback = wrapper?.find("*").find((c) => (c.getName?.() ?? "").toLowerCase().includes(q));
    const target = match ?? fallback;
    if (!target) {
      toast.error(`Nada encontrado com "${query.trim()}".`);
      return;
    }
    ed.select(target);
    ed.Canvas.scrollTo(target, { behavior: "smooth", block: "center" } as never);
  }

  // Páginas com layouts separados: a prévia mostra o documento que está aberto.
  const previewDevice =
    payload.device === "ALL" ? (device === "mobile" ? "celular" : "desktop") : previewDeviceOf(payload);
  const previewSrc = previewUrl ? `${previewUrl}?dispositivo=${previewDevice}&v=${previewKey}` : null;
  const offerHref = `/ofertas/${payload.offer.id}`;
  const otherLayout = payload.device === "MOBILE" ? desktopDoc : mobileDoc;
  // Modo prévia: os painéis saem (o canvas ganha a largura toda e nada parece clicável).
  const showLeft = leftOpen && !previewing;
  const showRight = rightOpen && !previewing;
  const zoomPercent = Math.round((fit?.scale ?? 1) * 100);

  return (
    <div className="os-editor flex h-svh flex-col bg-background">
      {viewportWidth < MIN_EDITOR_WIDTH && (
        <NarrowScreenNotice
          offerHref={offerHref}
          onBack={(e) => onLinkClick(e, offerHref)}
          onOpenPage={editor ? () => void openAsVisitor() : undefined}
        />
      )}
      {/* Barra superior */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href={offerHref} aria-label="Voltar para a oferta" onClick={(e) => onLinkClick(e, offerHref)}>
            <ArrowLeftIcon />
            <span className="hidden lg:inline">Oferta</span>
          </Link>
        </Button>
        <PageTitle payload={payload} split={split} />
        {/* Teste A/B: troca de versão salvando antes (como trocar de página). */}
        <VariantSwitcher
          variants={payload.variants}
          currentVariantId={payload.variant.id}
          device={payload.device}
          onSelect={(documentId) => void leave(`/editor/${documentId}`)}
        />
        {split && (
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={payload.device}
            onValueChange={(v) => {
              const target = v === "MOBILE" ? mobileDoc : v === "DESKTOP" ? desktopDoc : undefined;
              if (target && target.id !== payload.documentId) void leave(`/editor/${target.id}`);
            }}
            aria-label="Layout que você está editando"
            className="shrink-0"
          >
            <ToggleGroupItem
              value="DESKTOP"
              aria-label="Layout do computador"
              title="Layout que aparece para quem visita pelo computador"
            >
              Computador
            </ToggleGroupItem>
            <ToggleGroupItem
              value="MOBILE"
              aria-label="Layout do celular"
              title="Página separada que aparece para quem visita pelo celular"
            >
              Celular
            </ToggleGroupItem>
          </ToggleGroup>
        )}

        <div className="mx-auto flex items-center gap-1">
          <IconButton
            label={leftOpen ? "Esconder os blocos ( [ )" : "Mostrar os blocos ( [ )"}
            onClick={() => togglePanel("left")}
            disabled={previewing}
            active={!leftOpen}
          >
            {leftOpen ? <PanelLeftCloseIcon /> : <PanelLeftOpenIcon />}
          </IconButton>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={device}
            onValueChange={(v) => v && changeDevice(v as DeviceId)}
            aria-label="Ver a página como no aparelho"
          >
            {DEVICES.map((d) => {
              const Icon = DEVICE_ICON[d.id];
              return (
                <ToggleGroupItem
                  key={d.id}
                  value={d.id}
                  aria-label={d.name}
                  title={`Ver como fica no ${d.name.toLowerCase()}`}
                >
                  <Icon />
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
          {!previewing && (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-14 tabular-nums"
                      aria-label={`Zoom da página: ${zoomPercent}%`}
                      disabled={!editor}
                    >
                      {zoomPercent}%
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Zoom da página</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="center" className="w-64">
                <DropdownMenuRadioGroup
                  value={fit?.mode ?? "fit"}
                  onValueChange={(v) => changeZoom(v === "actual" ? "actual" : "fit")}
                >
                  <DropdownMenuRadioItem value="fit">Ajustar à janela</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="actual">Tamanho real (100%)</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => togglePanel("left")}>
                  {leftOpen ? "Esconder os blocos" : "Mostrar os blocos"}
                  <DropdownMenuShortcut>[</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => togglePanel("right")}>
                  {rightOpen ? "Esconder estilo e configurações" : "Mostrar estilo e configurações"}
                  <DropdownMenuShortcut>]</DropdownMenuShortcut>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <div className="mx-1 h-5 w-px bg-border" />
          <IconButton
            label="Desfazer (⌘Z)"
            onClick={() => editorRef.current?.UndoManager.undo()}
            disabled={!canUndo || previewing}
          >
            <Undo2Icon />
          </IconButton>
          <IconButton
            label="Refazer (⌘⇧Z)"
            onClick={() => editorRef.current?.UndoManager.redo()}
            disabled={!canRedo || previewing}
          >
            <Redo2Icon />
          </IconButton>
          <IconButton
            label={rightOpen ? "Esconder estilo e configurações ( ] )" : "Mostrar estilo e configurações ( ] )"}
            onClick={() => togglePanel("right")}
            disabled={previewing}
            active={!rightOpen}
          >
            {rightOpen ? <PanelRightCloseIcon /> : <PanelRightOpenIcon />}
          </IconButton>
        </div>

        <SaveStatus state={saveState} savedAt={savedAt} onRetry={() => void save({ force: true })} />
        <div className="mx-1 h-5 w-px bg-border" />
        <IconButton label="Localizar e substituir" onClick={() => openDialog("find")} disabled={!editor}>
          <ReplaceIcon />
        </IconButton>
        <IconButton label="Links e checkouts" onClick={() => openDialog("links")} disabled={!editor}>
          <LinkIcon />
        </IconButton>
        <IconButton label="Código (HTML/CSS)" onClick={() => openDialog("code")} disabled={!editor}>
          <Code2Icon />
        </IconButton>
        <IconButton
          label="Histórico (voltar a um ponto anterior)"
          onClick={() => openDialog("versions")}
          disabled={!editor}
        >
          <HistoryIcon />
        </IconButton>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={previewing ? "default" : "outline"}
              size="sm"
              onClick={() => void togglePreview()}
              disabled={!editor}
            >
              {previewing ? <PencilRulerIcon /> : <EyeIcon />}
              {previewing ? "Voltar a editar" : "Modo prévia"}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {previewing
              ? "Volta para a edição"
              : "Testa a página aqui no editor, funcionando como para o visitante (vídeos, botões, contadores)"}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" onClick={() => void openAsVisitor()} disabled={!editor} aria-label="Ver página">
              <ExternalLinkIcon />
              <span className="hidden lg:inline">Ver página</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Ver página (abre numa aba nova, como o visitante vê)</TooltipContent>
        </Tooltip>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Painel esquerdo (escondido, nunca desmontado: os painéis do GrapesJS moram nele) */}
        <aside
          className={cn("os-panel flex w-72 shrink-0 flex-col border-r bg-card", !showLeft && "hidden")}
          aria-label="Blocos e camadas"
        >
          <Tabs defaultValue="blocos" className="flex min-h-0 flex-1 flex-col gap-0">
            <TabsList className="m-2 grid grid-cols-3">
              <TabsTrigger value="blocos">Blocos</TabsTrigger>
              <TabsTrigger value="camadas">Camadas</TabsTrigger>
              <TabsTrigger value="paginas">Páginas</TabsTrigger>
            </TabsList>
            <TabsContent
              value="blocos"
              forceMount
              className="min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden"
            >
              <p className="px-3 pb-1 text-xs text-muted-foreground">
                Clique num bloco para colocá-lo abaixo do item selecionado, ou arraste para a página.
              </p>
              <div ref={blocksRef} />
            </TabsContent>
            <TabsContent
              value="camadas"
              forceMount
              className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
            >
              <form
                className="flex gap-1 px-2 pb-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  findInLayers(layerQuery);
                }}
              >
                <Input
                  value={layerQuery}
                  onChange={(e) => setLayerQuery(e.target.value)}
                  placeholder="Achar pelo texto…"
                  className="h-8"
                  aria-label="Achar elemento pelo texto"
                />
                <Button type="submit" variant="outline" size="icon-sm" aria-label="Achar">
                  <SearchIcon />
                </Button>
              </form>
              <div ref={layersRef} className="min-h-0 flex-1 overflow-y-auto" />
            </TabsContent>
            <TabsContent value="paginas" className="min-h-0 flex-1 overflow-y-auto px-2">
              <ul className="flex flex-col gap-1">
                {payload.pages.map((p) => {
                  const current = p.id === payload.page.id;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        disabled={current || !p.documentId}
                        onClick={() => {
                          if (p.documentId) void leave(`/editor/${p.documentId}`);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm",
                          current ? "bg-accent font-medium text-accent-foreground" : "hover:bg-muted",
                        )}
                      >
                        <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{p.name}</span>
                        {p.isHome && <span className="ml-auto text-[10px] text-muted-foreground">Inicial</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </TabsContent>
          </Tabs>
        </aside>

        {/* Canvas / prévia */}
        <main className="relative flex min-w-0 flex-1 flex-col bg-muted/40">
          {previewing && (
            <Notice>
              Modo prévia: a página funciona como para o visitante (vídeos, botões, contadores). Para mudar algo, clique
              em “Voltar a editar”.
            </Notice>
          )}
          {preserveJs && !previewing && (
            <Notice tone="warning">
              Esta página usa os scripts originais (“Preservar JS”). Depois de editar, confira no Modo prévia se tudo
              continua funcionando — a página original fica no Histórico.
            </Notice>
          )}
          {split && payload.device === "DESKTOP" && device !== "desktop" && otherLayout && (
            <Notice
              action={
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  onClick={() => void leave(`/editor/${otherLayout.id}`)}
                >
                  Editar o layout do celular
                </Button>
              }
            >
              Esta página tem um layout separado para celular: quem visita pelo celular vê aquele, não este. O que você
              muda aqui aparece para quem visita pelo computador.
            </Notice>
          )}
          {split && payload.device === "MOBILE" && device === "desktop" && otherLayout && (
            <Notice
              action={
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  onClick={() => void leave(`/editor/${otherLayout.id}`)}
                >
                  Editar o layout do computador
                </Button>
              }
            >
              Este é o layout do celular (quem visita pelo celular ou tablet vê este). Quem visita pelo computador vê o
              outro layout.
            </Notice>
          )}
          <div className="relative min-h-0 flex-1">
            <div ref={canvasRef} className={cn("h-full", previewing && "invisible")} />
            {previewing && previewSrc && <DevicePreview src={previewSrc} device={device} />}
            {/* Tamanho real numa área menor: a página anda para os lados (por cima do canvas, sem mudar a altura). */}
            {!previewing && fit?.mode === "actual" && fit.maxPan > 0 && editor && (
              <div className="absolute inset-x-0 bottom-3 z-10 mx-auto flex w-[min(28rem,calc(100%-1.5rem))] items-center gap-3 rounded-md border bg-card/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
                <span className="shrink-0">Rolar para os lados</span>
                <input
                  type="range"
                  min={0}
                  max={Math.round(fit.maxPan)}
                  value={Math.round(fit.panX)}
                  onChange={(e) => setCanvasPan(editor, Number(e.target.value))}
                  aria-label="Rolar a página para os lados"
                  title="Também dá com Shift + roda do mouse ou dois dedos no trackpad"
                  className="min-w-0 flex-1 accent-primary"
                />
              </div>
            )}
          </div>
        </main>

        {/* Painel direito */}
        <aside
          className={cn("os-panel flex w-80 shrink-0 flex-col border-l bg-card", !showRight && "hidden")}
          aria-label="Estilo e configurações"
        >
          <Tabs value={rightTab} onValueChange={setRightTab} className="flex min-h-0 flex-1 flex-col gap-0">
            <TabsList className="m-2 grid grid-cols-2">
              <TabsTrigger value="estilo">Estilo</TabsTrigger>
              <TabsTrigger value="config">Configurações</TabsTrigger>
            </TabsList>
            <TabsContent
              value="estilo"
              forceMount
              className="min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden"
            >
              {!hasSelection && <NothingSelected tab="estilo" />}
              {/* Os painéis do GrapesJS moram nestes contêineres: só escondidos, nunca desmontados. */}
              <div className={cn(!hasSelection && "hidden")} data-os-panel="estilo">
                {styleState && (
                  <Notice
                    tone="warning"
                    action={
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7"
                        onClick={() => editorRef.current?.Selectors.setState("")}
                      >
                        Voltar ao normal
                      </Button>
                    }
                  >
                    Você está mudando o estilo {stateLabel(styleState)}.
                  </Notice>
                )}
                {linkParent && <LinkParentHint onSelect={selectLinkParent} />}
                <div ref={stylesRef} />
                <details
                  className="group border-t"
                  open={advancedOpen}
                  onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}
                >
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
                    <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
                    Avançado
                    <span className="font-normal text-xs text-muted-foreground">
                      classes e estados (ao passar o mouse…)
                    </span>
                  </summary>
                  <div ref={selectorsRef} />
                </details>
              </div>
            </TabsContent>
            <TabsContent
              value="config"
              forceMount
              className="min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden"
            >
              {!hasSelection && <NothingSelected tab="config" />}
              <div className={cn(!hasSelection && "hidden")} data-os-panel="config">
                {linkParent && <LinkParentHint onSelect={selectLinkParent} />}
                <div ref={traitsRef} />
              </div>
            </TabsContent>
          </Tabs>
        </aside>
      </div>

      {editor && (
        <>
          <FindReplaceDialog
            editor={editor}
            payload={payload}
            open={dialog === "find"}
            onOpenChange={(o) => setDialog(o ? "find" : null)}
            saveNow={() => save()}
            navigate={(href) => void leave(href)}
            reloadDiscarding={reloadDiscarding}
          />
          <LinksDialog
            editor={editor}
            payload={payload}
            open={dialog === "links"}
            onOpenChange={(o) => setDialog(o ? "links" : null)}
            saveNow={() => save()}
            navigate={(href) => void leave(href)}
            reloadDiscarding={reloadDiscarding}
          />
          <CodeDialog
            editor={editor}
            payload={payload}
            open={dialog === "code"}
            onOpenChange={(o) => setDialog(o ? "code" : null)}
            saveNow={() => save()}
            navigate={(href) => void leave(href)}
            reloadDiscarding={reloadDiscarding}
          />
          <VersionsDialog
            editor={editor}
            payload={payload}
            open={dialog === "versions"}
            onOpenChange={(o) => setDialog(o ? "versions" : null)}
            saveNow={() => save()}
            navigate={(href) => void leave(href)}
            reloadDiscarding={reloadDiscarding}
          />
          <NewLinkDialog
            payload={payload}
            request={newLink}
            onClose={() => setNewLink(null)}
            onBound={({ component }) => {
              // Reabre as configurações do elemento com a lista de links atualizada.
              editor.selectRemove(component);
              editor.select(component);
            }}
          />
        </>
      )}

      <Dialog open={conflictOpen} onOpenChange={setConflictOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Esta página foi alterada em outra aba</DialogTitle>
            <DialogDescription>
              Outra aba ou janela salvou esta página depois que você abriu. Escolha o que fica: recarregar mostra o que
              a outra aba salvou (as alterações desta aba se perdem); manter a sua grava por cima.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" onClick={reloadDiscarding}>
              Recarregar o que foi salvo
            </Button>
            <Button onClick={keepMine}>Manter a minha (sobrescrever)</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingLeave !== null}
        onOpenChange={(o) => {
          if (o) return;
          setPendingLeave(null);
          // Ficou no editor com a página alterada em outra aba: volta a escolha do conflito.
          if (conflicted.current && !discarding.current) setConflictOpen(true);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sair sem salvar?</AlertDialogTitle>
            <AlertDialogDescription>
              {conflicted.current
                ? "Esta página foi salva em outra aba e as suas últimas alterações não foram gravadas. Se sair agora, elas se perdem."
                : "Não foi possível salvar as últimas alterações (o Offer Studio pode estar fechado ou sem conexão). Se sair agora, elas se perdem."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar editando</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => {
                const href = pendingLeave;
                setPendingLeave(null);
                if (!href) return;
                discarding.current = true;
                clearTimeout(timer.current);
                router.push(href);
              }}
            >
              Sair sem salvar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
