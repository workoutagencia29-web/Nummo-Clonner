"use client";

import {
  type Announcements,
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CopyIcon,
  ExternalLinkIcon,
  FileTextIcon,
  GripVerticalIcon,
  HomeIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  SmartphoneIcon,
  SplitIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { PageDialog, type PageDialogPage } from "@/components/offers/page-dialog";
import { PageSeoDialog } from "@/components/offers/settings/page-seo-dialog";
import { VariantsDialog } from "@/components/offers/variants/variants-dialog";
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
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";
import { PAGE_TYPE_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { offerPreviewUrlAction } from "@/server/actions/editor";
import {
  deletePageAction,
  duplicatePageAction,
  pageReferencesAction,
  reorderPagesAction,
  setHomePageAction,
} from "@/server/actions/pages";

/** Instruções para leitores de tela (o padrão do dnd-kit é em inglês). */
const SCREEN_READER_INSTRUCTIONS = {
  draggable:
    "Para mudar a ordem, pressione a barra de espaço. Use as setas para cima e para baixo para mover a página e pressione espaço de novo para soltar, ou Esc para cancelar.",
};

function announcementsFor(items: { id: string; name: string }[]): Announcements {
  const name = (id: UniqueIdentifier) => items.find((p) => p.id === id)?.name ?? "Página";
  const position = (id: UniqueIdentifier) => `posição ${items.findIndex((p) => p.id === id) + 1} de ${items.length}`;
  return {
    onDragStart: ({ active }) => `"${name(active.id)}" selecionada, na ${position(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `"${name(active.id)}" movida para a ${position(over.id)}.` : undefined),
    onDragEnd: ({ active, over }) =>
      over ? `"${name(active.id)}" solta na ${position(over.id)}.` : `"${name(active.id)}" solta.`,
    onDragCancel: ({ active }) => `Movimento cancelado. "${name(active.id)}" voltou para o lugar.`,
  };
}

export interface PageRow extends PageDialogPage {
  isHome: boolean;
  variantCount: number;
  /** Documento principal (abre no editor): o único, ou a versão para computador. */
  documentId: string | null;
  /** Versão celular separada (páginas clonadas de sites não responsivos). */
  mobileDocumentId?: string | null;
}

/** Lista das páginas do funil, com arrastar para reordenar. */
export function PagesList({ offerId, pages }: { offerId: string; pages: PageRow[] }) {
  const [items, setItems] = useState(pages);
  // id estável entre servidor e navegador (evita aviso de hidratação do dnd-kit).
  const dndId = useId();
  const [dialogPage, setDialogPage] = useState<PageDialogPage | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<PageRow | null>(null);
  const [seoPage, setSeoPage] = useState<{ id: string; name: string } | null>(null);
  const [abPage, setAbPage] = useState<{ id: string; name: string } | null>(null);
  const reorder = useAction(reorderPagesAction);
  const setHome = useAction(setHomePageAction);
  const duplicate = useAction(duplicatePageAction);
  const remove = useAction(deletePageAction);
  const preview = useAction(offerPreviewUrlAction);

  useEffect(() => setItems(pages), [pages]);

  /** "Ver página": abre a página numa aba nova, como o visitante vê (sem abrir o editor). */
  async function viewPage(page: PageRow) {
    const res = await preview.run({ offerId, pageId: page.id });
    if (res.ok) window.open(res.data.url, "_blank", "noopener");
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = items.findIndex((p) => p.id === active.id);
    const to = items.findIndex((p) => p.id === over.id);
    const next = arrayMove(items, from, to);
    setItems(next);
    void reorder.run({ offerId, orderedIds: next.map((p) => p.id) }, { onError: () => setItems(pages) });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          A página <strong className="font-medium text-foreground">inicial</strong> abre no endereço principal do site
          (seudominio.com.br). As outras ficam no endereço delas (seudominio.com.br/upsell). Arraste para mudar a ordem
          do funil.
        </p>
        <Button
          variant="outline"
          onClick={() => {
            setDialogPage(null);
            setDialogOpen(true);
          }}
        >
          <PlusIcon />
          Adicionar página
        </Button>
      </div>

      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        accessibility={{
          screenReaderInstructions: SCREEN_READER_INSTRUCTIONS,
          announcements: announcementsFor(items),
        }}
      >
        <SortableContext items={items.map((p) => p.id)} strategy={verticalListSortingStrategy}>
          <ol
            aria-label="Páginas do funil"
            className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card"
          >
            {items.map((page, index) => (
              <SortableRow
                key={page.id}
                page={page}
                index={index}
                onEdit={() => {
                  setDialogPage(page);
                  setDialogOpen(true);
                }}
                onView={() => void viewPage(page)}
                onSeo={() => setSeoPage({ id: page.id, name: page.name })}
                onAbTest={() => setAbPage({ id: page.id, name: page.name })}
                onSetHome={() =>
                  void setHome.run({ id: page.id }, { success: `"${page.name}" agora é a página inicial.` })
                }
                onDuplicate={() => void duplicate.run({ id: page.id }, { success: "Página duplicada." })}
                onDelete={() => setDeleting(page)}
                canDelete={items.length > 1}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>

      <PageDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        offerId={offerId}
        page={dialogPage}
        existingSlugs={items.filter((p) => p.id !== dialogPage?.id).map((p) => p.slug)}
      />

      <PageSeoDialog offerId={offerId} page={seoPage} onClose={() => setSeoPage(null)} />

      <VariantsDialog page={abPage} onClose={() => setAbPage(null)} />

      <DeletePageDialog
        page={deleting}
        pages={items}
        pending={remove.pending}
        onClose={() => setDeleting(null)}
        onConfirm={(redirectToPageId) => {
          if (!deleting) return;
          void remove.run(
            { id: deleting.id, redirectToPageId },
            { success: "Página excluída.", onSuccess: () => setDeleting(null) },
          );
        }}
      />
    </div>
  );
}

const NO_REDIRECT = "__nenhuma__";

/**
 * Confirmação de exclusão. Avisa quantas outras páginas têm botões ou links que
 * levam a esta, e deixa escolher para onde eles passam a levar.
 */
function DeletePageDialog({
  page,
  pages,
  pending,
  onClose,
  onConfirm,
}: {
  page: PageRow | null;
  pages: PageRow[];
  pending: boolean;
  onClose: () => void;
  onConfirm: (redirectToPageId?: string) => void;
}) {
  const refs = useAction(pageReferencesAction);
  const runRefs = refs.run;
  const [references, setReferences] = useState<{ count: number; pages: { id: string; name: string }[] } | null>(null);
  const [redirect, setRedirect] = useState(NO_REDIRECT);
  const pageId = page?.id;

  useEffect(() => {
    setReferences(null);
    setRedirect(NO_REDIRECT);
    if (!pageId) return;
    let cancelled = false;
    void runRefs({ pageId }, { silentError: true }).then((res) => {
      if (!cancelled && res.ok) setReferences(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [pageId, runRefs]);

  const others = pages.filter((p) => p.id !== page?.id);
  const referring = references?.pages ?? [];
  const names = referring.slice(0, 3).map((p) => `“${p.name}”`);
  const namesText =
    referring.length > names.length
      ? `${names.join(", ")} e mais ${referring.length - names.length}`
      : names.join(", ");

  return (
    <AlertDialog open={page !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{`Excluir a página "${page?.name ?? ""}"?`}</AlertDialogTitle>
          <AlertDialogDescription>
            {page?.isHome
              ? `Ela é a página inicial: "${others[0]?.name ?? "a primeira da lista"}" (a primeira da lista) passa a ser a inicial. Essa ação não pode ser desfeita.`
              : "O conteúdo e o histórico de versões desta página serão apagados. Essa ação não pode ser desfeita."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {refs.pending && !references && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-3.5" />
            Procurando links para esta página…
          </p>
        )}
        {references && references.count > 0 && (
          <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            <p>
              {references.count === 1 ? "Uma outra página tem" : `${references.count} outras páginas têm`} botões ou
              links que levam a esta página ({namesText}).
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="os-delete-redirect" className="font-normal text-xs text-muted-foreground">
                Depois de excluir, esses botões e links passam a levar para:
              </Label>
              <Select value={redirect} onValueChange={setRedirect}>
                <SelectTrigger id="os-delete-redirect" size="sm" className="w-full bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_REDIRECT}>Nenhuma página (ficam sem destino)</SelectItem>
                  {others.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              onConfirm(redirect === NO_REDIRECT ? undefined : redirect);
            }}
          >
            {pending && <Spinner />}
            Excluir página
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function SortableRow({
  page,
  index,
  onEdit,
  onView,
  onSeo,
  onAbTest,
  onSetHome,
  onDuplicate,
  onDelete,
  canDelete,
}: {
  page: PageRow;
  index: number;
  onEdit: () => void;
  onView: () => void;
  onSeo: () => void;
  onAbTest: () => void;
  onSetHome: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: page.id,
    attributes: { roleDescription: "item reordenável" },
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        // No celular: nome e dados em cima, "Editar" e o menu embaixo (nada cortado).
        "group flex flex-wrap items-center gap-x-3 gap-y-2 bg-card px-3 py-3 sm:flex-nowrap sm:px-4",
        isDragging && "relative z-10 shadow-lg ring-1 ring-border",
      )}
    >
      <button
        type="button"
        className="grid size-7 shrink-0 cursor-grab place-items-center rounded-md text-muted-foreground hover:bg-muted active:cursor-grabbing"
        aria-label={`Arrastar ${page.name}`}
        {...attributes}
        {...listeners}
      >
        <GripVerticalIcon className="size-4" />
      </button>
      <span className="hidden w-5 shrink-0 text-center text-xs tabular-nums text-muted-foreground sm:inline">
        {index + 1}
      </span>
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        {page.isHome ? <HomeIcon className="size-4" /> : <FileTextIcon className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 font-medium break-words sm:truncate">{page.name}</span>
          {page.isHome && <Badge variant="secondary">Inicial</Badge>}
          {page.variantCount > 1 && (
            <Badge variant="outline" className="gap-1 hover:bg-accent" asChild>
              <button
                type="button"
                onClick={onAbTest}
                title="Abrir o teste A/B desta página"
                aria-label={`${page.variantCount} versões A/B`}
              >
                <SplitIcon className="size-3" />
                {/* Na tela estreita, só o número (o texto inteiro passaria por baixo do "Editar"). */}
                <span className="hidden sm:inline">{page.variantCount} versões A/B</span>
                <span className="sm:hidden">{page.variantCount}</span>
              </button>
            </Badge>
          )}
          {page.mobileDocumentId && (
            <Badge
              variant="outline"
              className="min-w-0 max-w-full shrink gap-1"
              title="Quem visita pelo celular vê uma página separada (layout do celular)"
            >
              <SmartphoneIcon className="size-3 shrink-0" />
              {/* Na tela estreita, o texto encurta ("Layout do cel…") em vez de passar por baixo do "Editar". */}
              <span className="min-w-0 truncate">Layout do celular separado</span>
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
          <span className="whitespace-nowrap">{PAGE_TYPE_LABEL[page.type]}</span>
          <span className="font-mono break-all sm:whitespace-nowrap">
            {page.isHome ? <span className="whitespace-nowrap font-sans">Início do site (/)</span> : `/${page.slug}/`}
          </span>
        </div>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1 max-sm:w-full max-sm:justify-end">
        {page.documentId && (
          <Button size="sm" asChild>
            <Link href={`/editor/${page.documentId}`} aria-label={`Editar ${page.name}`}>
              <PencilIcon />
              Editar
            </Link>
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Ações da página ${page.name}`}>
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={onView}>
              <ExternalLinkIcon />
              Ver página
            </DropdownMenuItem>
            {page.mobileDocumentId && (
              <DropdownMenuItem asChild>
                <Link href={`/editor/${page.mobileDocumentId}`}>
                  <SmartphoneIcon />
                  Editar o layout do celular
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={onEdit}>
              <PencilIcon />
              Nome, endereço e tipo…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onSeo}>
              <SearchIcon />
              SEO da página…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onAbTest}>
              <SplitIcon />
              {page.variantCount > 1 ? `Teste A/B (${page.variantCount} versões)…` : "Teste A/B…"}
            </DropdownMenuItem>
            {!page.isHome && (
              <DropdownMenuItem onSelect={onSetHome}>
                <HomeIcon />
                Tornar página inicial
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={onDuplicate}>
              <CopyIcon />
              Duplicar página
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete} disabled={!canDelete}>
              <Trash2Icon />
              {canDelete ? "Excluir página" : "É a única página"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
