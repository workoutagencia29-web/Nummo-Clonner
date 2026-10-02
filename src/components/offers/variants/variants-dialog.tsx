"use client";

/**
 * "Teste A/B" de uma página: lista as versões (A, B…), cria versões (cópia de
 * uma versão ou a partir de um modelo), dá nome, escolhe o controle, divide o
 * tráfego do divisor do ZIP e exclui. "Editar" abre a versão no editor e
 * "Ver página" mostra a versão numa aba nova.
 *
 * Carrega sozinho pelo id da página:
 *   <VariantsDialog page={abPage} onClose={() => setAbPage(null)} />
 *
 * Mudanças feitas em outra aba ou janela (versão criada/excluída, divisão
 * salva): a ação que esbarrar nelas recarrega a lista e avisa
 * (isStaleVariantsError), sem precisar fechar e abrir o diálogo.
 */
import {
  ArrowLeftIcon,
  CheckIcon,
  CopyIcon,
  EyeIcon,
  FlagIcon,
  LayoutTemplateIcon,
  MonitorIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  ScaleIcon,
  SmartphoneIcon,
  SplitIcon,
  TagIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
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
import { Button } from "@/components/ui/button";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { isTemplateId, TEMPLATE_SUMMARIES, templateSummary, thumbnailUrl } from "@/editor/templates/catalog";
import { useAction } from "@/hooks/use-action";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  createVariantAction,
  deleteVariantAction,
  listVariantsAction,
  renameVariantAction,
  setControlVariantAction,
  setVariantWeightsAction,
  variantPreviewUrlAction,
} from "@/server/actions/variants";
import type { PageVariantsView, VariantView } from "@/server/services/variants";
import { CompareVersionsHint } from "./compare-hint";
import {
  afterDelete,
  COPY_SOURCE_GONE,
  evenSplit,
  isStaleVariantsError,
  MAX_VARIANTS,
  markTouched,
  PAGE_NOT_FOUND,
  rebalance,
  VARIANT_LABEL_MAX,
  VARIANT_NAMES,
  variantTitle,
  weightsProblem,
} from "./weights";

export interface VariantsDialogPage {
  id: string;
  name: string;
}

/** Cor de cada letra (a mesma na barra da divisão e na lista). */
const LETTER_COLOR = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"];

function colorOf(name: string) {
  const index = VARIANT_NAMES.indexOf(name as (typeof VARIANT_NAMES)[number]);
  return LETTER_COLOR[index >= 0 ? index : 0];
}

/** Quem vê cada versão: um documento para tudo, ou computador e celular separados. */
function devicesText(v: VariantView) {
  const has = (d: string) => v.documents.some((doc) => doc.device === d);
  if (has("ALL")) return "Computador e celular";
  if (has("DESKTOP") && has("MOBILE")) return "Computador + celular separado";
  if (has("MOBILE")) return "Só celular";
  return "Computador";
}

/**
 * Endereço da versão no ZIP, como o "Baixar ZIP" monta ("/oferta-b/",
 * "/upsell/oferta-b/", "/oferta-b-2/"); com uma versão só, o da página.
 */
function zipAddress(v: VariantView) {
  return v.zipDir ? `/${v.zipDir}` : "Início do site (/)";
}

/** "A 50% · B 50%". */
function weightsSummary(variants: readonly Pick<VariantView, "name">[], weights: readonly number[]) {
  return variants.map((v, i) => `${v.name} ${weights[i] ?? 0}%`).join(" · ");
}

/** Divisão do tráfego mudada e ainda não salva. */
interface WeightsDraft {
  /** `saved`: o percentual salvo de onde a pessoa partiu (o servidor recusa se outra aba mudou). */
  weights: { variantId: string; weight: number; saved: number }[];
  /** Soma 100% e todos são números válidos (dá para salvar). */
  valid: boolean;
  /** "A 50% · B 50%" (a mudada) e a salva. */
  summary: string;
  savedSummary: string;
}

/** Versão recém-criada (aviso na lista com "Editar agora"). */
interface CreatedInfo {
  name: string;
  documentId: string | null;
  count: number;
  /** Versões pausadas (0%), que continuam pausadas. */
  paused: number;
}

function createdInfo(created: { name: string; documentId: string | null }, view: PageVariantsView): CreatedInfo {
  return {
    name: created.name,
    documentId: created.documentId,
    count: view.variants.length,
    paused: view.variants.filter((v) => v.weight === 0).length,
  };
}

/**
 * Como fica a divisão com a versão nova (a mesma regra do servidor,
 * weightsAfterCreate): por igual entre as versões ativas; as pausadas (0%)
 * continuam pausadas.
 */
function splitText(total: number, paused: number) {
  if (!paused) return `dividido por igual entre as ${total} versões`;
  const rest = paused === 1 ? "a pausada (0%) continua pausada" : `as ${paused} pausadas (0%) continuam pausadas`;
  return `dividido por igual entre as ${total - paused} versões ativas; ${rest}`;
}

/** Aviso depois de uma ação que esbarrou numa mudança feita em outra aba. */
const STALE_DESCRIPTION = "A lista de versões foi atualizada com o que está salvo agora.";

export function VariantsDialog({ page, onClose }: { page: VariantsDialogPage | null; onClose: () => void }) {
  const [view, setView] = useState<PageVariantsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Página a que `view`/`loadError` se referem (evita mostrar a anterior por um instante). */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [mode, setMode] = useState<"list" | "create">("list");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<VariantView | null>(null);
  const [created, setCreated] = useState<CreatedInfo | null>(null);
  /** Divisão mudada e não salva: sair, criar versão ou editar pergunta antes (senão a mudança se perderia calada). */
  const [weightsDraft, setWeightsDraft] = useState<WeightsDraft | null>(null);
  /**
   * A mesma divisão pendente, atualizada na hora (o estado só chega na próxima
   * renderização): um Esc logo depois de digitar também pergunta.
   */
  const draftRef = useRef<WeightsDraft | null>(null);
  const onDraftChange = useCallback((draft: WeightsDraft | null) => {
    draftRef.current = draft;
    setWeightsDraft(draft);
  }, []);
  /** O que fazer depois de salvar ou descartar a divisão (a pergunta está aberta). */
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  const router = useRouter();
  const saveWeights = useAction(setVariantWeightsAction);
  const quick = useAction(createVariantAction);
  const load = useAction(listVariantsAction);
  const runLoad = load.run;
  const setControl = useAction(setControlVariantAction);
  const remove = useAction(deleteVariantAction);
  const preview = useAction(variantPreviewUrlAction);
  const pageId = page?.id ?? null;

  /**
   * O router fora das dependências do fetchView: o objeto do useRouter pode
   * mudar depois de um refresh, e o fetchView muda o diálogo inteiro (efeito abaixo).
   */
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  /** Carrega as versões da página; true = a lista na tela é a que está salva agora. */
  const fetchView = useCallback(
    async (id: string, isCurrent: () => boolean = () => true): Promise<boolean> => {
      const res = await runLoad({ pageId: id }, { silentError: true });
      if (!isCurrent()) return false;
      if (res.ok) {
        setView(res.data);
        setLoadError(null);
      } else {
        // Só o erro e "Tentar de novo": a lista velha (página excluída em outra aba) não fica junto.
        setView(null);
        setLoadError(res.error);
        // Página excluída (ou oferta na lixeira) em outra aba: a lista de páginas por trás também se atualiza.
        if (res.error === PAGE_NOT_FOUND) routerRef.current.refresh();
      }
      setLoadedFor(id);
      return res.ok;
    },
    [runLoad],
  );

  /**
   * Erro de tela desatualizada (outra aba ou janela criou, excluiu ou mudou
   * versões): recarrega a lista e, quando ela recarregou, avisa (`quiet` = a
   * tela mostra o erro do jeito dela). Se a página não existe mais, o diálogo
   * mostra o erro no lugar da lista (sem dizer que ela foi atualizada).
   * false = outro erro, que cada ação mostra como sempre.
   */
  const handleStale = useCallback(
    (message: string, opts: { quiet?: boolean } = {}) => {
      if (!isStaleVariantsError(message)) return false;
      if (!pageId) return true;
      void fetchView(pageId).then((reloaded) => {
        if (reloaded && !opts.quiet) toast.warning(message, { description: STALE_DESCRIPTION });
      });
      return true;
    },
    [pageId, fetchView],
  );
  /** Erro de uma ação: lista desatualizada → recarrega e avisa; senão, o toast de sempre. */
  const failed = useCallback(
    (message: string) => {
      if (!handleStale(message)) toast.error(message);
    },
    [handleStale],
  );

  useEffect(() => {
    setMode("list");
    setRenaming(null);
    setDeleting(null);
    setCreated(null);
    onDraftChange(null);
    setLeaving(null);
    if (!pageId) return;
    let cancelled = false;
    void fetchView(pageId, () => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [pageId, fetchView, onDraftChange]);

  const ready = view && !loadError && loadedFor === pageId && view.page.id === pageId;
  const title = mode === "create" && view?.nextName ? `Criar versão ${view.nextName}` : "Teste A/B";

  async function openPreview(v: VariantView, device?: "celular" | "desktop") {
    const res = await preview.run({ variantId: v.id }, { silentError: true, onError: failed });
    if (!res.ok) return;
    window.open(device ? `${res.data.url}?dispositivo=${device}` : res.data.url, "_blank", "noopener");
  }

  /** Faz `action`; com a divisão do tráfego mudada e não salva, pergunta antes. */
  function guard(action: () => void) {
    const pending = draftRef.current;
    if (!pending) {
      action();
      return;
    }
    setWeightsDraft(pending);
    setLeaving(() => action);
  }

  /** "Editar" de uma versão: com a divisão não salva, pergunta antes de sair da tela. */
  function guardLink(e: React.MouseEvent, href: string) {
    if (!draftRef.current) return;
    e.preventDefault();
    guard(() => router.push(href));
  }

  /** Criar a próxima versão como cópia da de controle, sem formulário (o caso mais comum). */
  function quickCreate() {
    if (!view) return;
    const control = view.variants.find((v) => v.isControl) ?? view.variants[0];
    void quick.run(
      { pageId: view.page.id, label: null, source: { kind: "copy", variantId: control?.id ?? null } },
      {
        silentError: true,
        onError: failed,
        onSuccess: ({ created: c, view: next }) => {
          setView(next);
          setCreated(createdInfo(c, next));
        },
      },
    );
  }

  function finishLeaving() {
    const next = leaving;
    onDraftChange(null);
    setLeaving(null);
    next?.();
  }

  function saveAndLeave() {
    if (!weightsDraft || !view) return;
    void saveWeights.run(
      { pageId: view.page.id, weights: weightsDraft.weights },
      {
        success: "Divisão do tráfego salva.",
        silentError: true,
        onError: (message) => {
          // Outra aba mudou as versões: a lista recarrega e a pessoa confere antes de sair.
          if (handleStale(message)) setLeaving(null);
          else toast.error(message);
        },
        onSuccess: (next) => {
          setView(next);
          finishLeaving();
        },
      },
    );
  }

  function makeControl(v: VariantView) {
    void setControl.run(
      { variantId: v.id },
      {
        success: `A versão ${v.name} agora é o controle.`,
        silentError: true,
        onError: failed,
        onSuccess: (data) => setView(data),
      },
    );
  }

  return (
    <Dialog open={page !== null} onOpenChange={(open) => !open && guard(onClose)}>
      <DialogContent
        // minmax(0,1fr): um texto que não quebra (título comprido, endereço) não alarga o diálogo
        // além da janela; ele encolhe e o título corta com "…".
        className="max-h-[92vh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-3xl"
        onEscapeKeyDown={(e) => {
          // Esc sai do que está aberto dentro do diálogo antes de fechá-lo.
          if (renaming) {
            e.preventDefault();
            setRenaming(null);
          } else if (mode === "create") {
            e.preventDefault();
            setMode("list");
          }
        }}
      >
        <DialogHeader>
          <div className="flex min-w-0 items-center gap-2 pr-6">
            {mode === "create" ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className="-my-1 -ml-2"
                aria-label="Voltar para as versões"
                onClick={() => setMode("list")}
              >
                <ArrowLeftIcon />
              </Button>
            ) : (
              <SplitIcon className="size-4 shrink-0 text-primary" aria-hidden />
            )}
            <DialogTitle className="min-w-0 truncate leading-normal">
              {title}
              <span className="font-normal text-muted-foreground"> · {page?.name}</span>
            </DialogTitle>
          </div>
          <DialogDescription>
            {mode === "create" ? (
              "A versão nova começa como uma cópia (para mudar só o que você quer testar) ou a partir de um modelo."
            ) : (
              <>
                Teste versões desta página para ver qual vende mais. No ZIP, cada versão fica numa pasta (
                <span className="whitespace-nowrap font-mono text-xs">oferta-a/</span>,{" "}
                <span className="whitespace-nowrap font-mono text-xs">oferta-b/</span>…) e o divisor sorteia a versão de
                cada visitante pelo percentual.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {!ready && !loadError && <ListSkeleton />}
        {loadError && loadedFor === pageId && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm text-destructive">{loadError}</p>
            {loadError === PAGE_NOT_FOUND ? (
              // Página excluída (ou oferta na lixeira): tentar de novo nunca daria certo.
              <>
                <p className="text-sm text-muted-foreground">A lista de páginas da oferta já foi atualizada.</p>
                <Button
                  onClick={() => {
                    // A divisão por salvar não tem mais onde ficar: fecha sem perguntar.
                    onDraftChange(null);
                    onClose();
                  }}
                >
                  Fechar
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => pageId && void fetchView(pageId)} disabled={load.pending}>
                {load.pending && <Spinner />}
                Tentar de novo
              </Button>
            )}
          </div>
        )}

        {ready && mode === "list" && (
          <>
            {created && (
              <output className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm">
                <CheckIcon className="size-4 shrink-0 text-success" aria-hidden />
                <span className="min-w-0 flex-1 basis-56">
                  <strong className="font-medium">Versão {created.name} criada.</strong> O tráfego foi{" "}
                  {splitText(created.count, created.paused)} (ajuste em “Divisão do tráfego”).
                </span>
                {created.documentId && (
                  <Button size="sm" variant="outline" asChild>
                    <Link
                      href={`/editor/${created.documentId}`}
                      onClick={(e) => guardLink(e, `/editor/${created.documentId}`)}
                    >
                      <PencilIcon />
                      Editar agora
                    </Link>
                  </Button>
                )}
              </output>
            )}
            <ul aria-label="Versões da página" className="flex flex-col divide-y overflow-hidden rounded-xl border">
              {view.variants.map((v) => (
                <VariantRow
                  key={v.id}
                  view={view}
                  variant={v}
                  renaming={renaming === v.id}
                  onRename={() => setRenaming(v.id)}
                  onRenamed={(next) => {
                    setView(next);
                    setRenaming(null);
                  }}
                  onCancelRename={() => setRenaming(null)}
                  onStale={handleStale}
                  onMakeControl={() => makeControl(v)}
                  onDelete={() => setDeleting(v)}
                  onPreview={(device) => void openPreview(v, device)}
                  onLink={guardLink}
                  busy={setControl.pending || remove.pending}
                  previewing={preview.pending}
                />
              ))}
            </ul>
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <FlagIcon className="mt-0.5 size-3 shrink-0" aria-hidden />
              <span>
                <strong className="font-medium text-foreground">Controle</strong> é a versão original do teste: sem o
                divisor, é ela que fica no endereço da página.
              </span>
            </p>

            {view.variants.length > 1 && (
              // Lista nova do servidor (versão criada/excluída, divisão salva): o editor recomeça dela.
              <WeightsEditor
                key={view.variants.map((v) => `${v.id}:${v.weight}`).join("|")}
                view={view}
                onSaved={setView}
                onDraftChange={onDraftChange}
                onStale={handleStale}
              />
            )}
            {view.variants.length > 1 && <CompareVersionsHint />}
          </>
        )}

        {ready && mode === "create" && (
          <CreateVariantForm
            view={view}
            onCancel={() => setMode("list")}
            onStale={handleStale}
            onCreated={(next, info) => {
              setView(next);
              setCreated(info);
              setMode("list");
            }}
          />
        )}

        {ready && mode === "list" && (
          <DialogFooter className="items-center gap-2 sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {view.variants.length} de {MAX_VARIANTS} versões
              {!view.nextName && " — limite atingido (A a E)"}
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button variant="outline" onClick={() => guard(onClose)}>
                Fechar
              </Button>
              {view.nextName && (
                <Button
                  variant="outline"
                  onClick={() =>
                    guard(() => {
                      setCreated(null);
                      setMode("create");
                    })
                  }
                  disabled={quick.pending}
                >
                  <LayoutTemplateIcon />
                  Modelo ou outra versão…
                </Button>
              )}
              {view.nextName && (
                <Button onClick={() => guard(quickCreate)} disabled={quick.pending}>
                  {quick.pending ? <Spinner /> : <PlusIcon />}
                  Criar versão {view.nextName} (cópia da {controlName(view)})
                </Button>
              )}
            </div>
          </DialogFooter>
        )}
      </DialogContent>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Excluir a versão ${deleting?.name ?? ""}?`}
        description={deleting && view ? deleteDescription(view, deleting) : ""}
        confirmLabel={`Excluir versão ${deleting?.name ?? ""}`}
        destructive
        pending={remove.pending}
        onConfirm={() => {
          if (!deleting) return;
          const target = deleting;
          void remove.run(
            { variantId: target.id },
            {
              silentError: true,
              onError: (message) => {
                if (!handleStale(message)) {
                  toast.error(message);
                  return;
                }
                setDeleting(null);
                setCreated(null);
              },
              success: (data) =>
                data.deleted.promoted
                  ? `Versão ${target.name} excluída. A versão ${data.deleted.promoted} agora é o controle.`
                  : `Versão ${target.name} excluída.`,
              onSuccess: (data) => {
                setView(data.view);
                setDeleting(null);
                setCreated(null);
              },
            },
          );
        }}
      />

      <AlertDialog open={leaving !== null} onOpenChange={(open) => !open && setLeaving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Salvar a divisão do tráfego?</AlertDialogTitle>
            <AlertDialogDescription>
              {weightsDraft?.valid
                ? `Você mudou os percentuais para ${weightsDraft.summary} e ainda não salvou. Sem salvar, o ZIP continua com ${weightsDraft.savedSummary}.`
                : `Os percentuais que você digitou ainda não estão certos (números de 0 a 100, somando 100%). Corrija para salvar, ou descarte a mudança: o ZIP continua com ${weightsDraft?.savedSummary ?? "a divisão salva"}.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saveWeights.pending}>Continuar editando</AlertDialogCancel>
            <Button variant="outline" onClick={finishLeaving} disabled={saveWeights.pending}>
              Descartar
            </Button>
            {weightsDraft?.valid && (
              <AlertDialogAction
                disabled={saveWeights.pending}
                onClick={(e) => {
                  e.preventDefault();
                  saveAndLeave();
                }}
              >
                {saveWeights.pending && <Spinner />}
                Salvar
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

/** Letra da versão de controle (a que a cópia rápida copia). */
function controlName(view: PageVariantsView) {
  return (view.variants.find((v) => v.isControl) ?? view.variants[0])?.name ?? "A";
}

function deleteDescription(view: PageVariantsView, v: VariantView) {
  // A mesma regra do servidor (afterDelete): o texto sempre diz o que vai acontecer.
  const { rest, control } = afterDelete(view.variants, v.id);
  const parts = [
    `A versão ${v.name}${v.label ? ` (“${v.label}”)` : ""} e o histórico de alterações dela serão apagados.`,
    v.isControl && control ? `A versão ${control.name} passa a ser o controle.` : null,
    rest.length > 1
      ? `Os ${v.weight}% de tráfego dela são divididos entre as outras versões.`
      : rest[0]
        ? `A versão ${rest[0].name} passa a receber 100% do tráfego.`
        : null,
    "Essa ação não pode ser desfeita.",
  ];
  return parts.filter(Boolean).join(" ");
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <span className="sr-only">Carregando as versões…</span>
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}

// ─── Uma versão ──────────────────────────────────────────────────────────────

function VariantRow({
  view,
  variant: v,
  renaming,
  onRename,
  onRenamed,
  onCancelRename,
  onStale,
  onMakeControl,
  onDelete,
  onPreview,
  onLink,
  busy,
  previewing,
}: {
  view: PageVariantsView;
  variant: VariantView;
  renaming: boolean;
  onRename: () => void;
  onRenamed: (view: PageVariantsView) => void;
  onCancelRename: () => void;
  /** Erro de lista desatualizada: recarrega e avisa (true = era isso). */
  onStale: (message: string) => boolean;
  onMakeControl: () => void;
  onDelete: () => void;
  onPreview: (device?: "celular" | "desktop") => void;
  /** Clique num link para o editor (a tela pode perguntar antes de sair). */
  onLink: (e: React.MouseEvent, href: string) => void;
  busy: boolean;
  previewing: boolean;
}) {
  const single = view.variants.length === 1;
  const split = Boolean(v.mobileDocumentId);
  return (
    <li aria-label={`Versão ${v.name}`} className="flex flex-wrap items-center gap-3 bg-card px-3 py-3 sm:px-4">
      <span
        aria-hidden
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-lg font-semibold text-sm text-white",
          colorOf(v.name),
        )}
      >
        {v.name}
      </span>
      {/* Base de 14rem: numa janela estreita, os botões descem para a linha de baixo. */}
      <div className="min-w-0 flex-1 basis-56">
        {renaming ? (
          <RenameForm variant={v} onDone={onRenamed} onCancel={onCancelRename} onStale={onStale} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Versão {v.name}</span>
              {v.label && <span className="truncate text-muted-foreground">· {v.label}</span>}
              {v.isControl && (
                <Badge variant="secondary" className="gap-1">
                  <FlagIcon />
                  Controle
                </Badge>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
              {!single && <span className="font-medium text-foreground tabular-nums">{v.weight}% do tráfego</span>}
              <span className="font-mono">{zipAddress(v)}</span>
              <span>{devicesText(v)}</span>
              <span suppressHydrationWarning>Alterada {timeAgo(v.updatedAt)}</span>
            </div>
          </>
        )}
      </div>
      {!renaming && (
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {split ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" aria-label={`Editar a versão ${v.name}`}>
                  <PencilIcon />
                  Editar
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="text-xs text-muted-foreground">Qual versão editar?</DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link href={`/editor/${v.documentId}`} onClick={(e) => onLink(e, `/editor/${v.documentId}`)}>
                    <MonitorIcon />
                    Computador
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link
                    href={`/editor/${v.mobileDocumentId}`}
                    onClick={(e) => onLink(e, `/editor/${v.mobileDocumentId}`)}
                  >
                    <SmartphoneIcon />
                    Celular
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            v.documentId && (
              <Button size="sm" asChild>
                <Link
                  href={`/editor/${v.documentId}`}
                  aria-label={`Editar a versão ${v.name}`}
                  onClick={(e) => onLink(e, `/editor/${v.documentId}`)}
                >
                  <PencilIcon />
                  Editar
                </Link>
              </Button>
            )
          )}
          {split ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Ver página da versão ${v.name}`}
                  title="Abre a versão numa aba nova, como o visitante vê"
                  disabled={previewing}
                >
                  <EyeIcon />
                  Ver página
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onPreview("desktop")}>
                  <MonitorIcon />
                  Computador
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onPreview("celular")}>
                  <SmartphoneIcon />
                  Celular
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              variant="outline"
              size="sm"
              aria-label={`Ver página da versão ${v.name}`}
              title="Abre a versão numa aba nova, como o visitante vê"
              disabled={previewing}
              onClick={() => onPreview()}
            >
              <EyeIcon />
              Ver página
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Ações da versão ${v.name}`} disabled={busy}>
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={onRename}>
                <TagIcon />
                {v.label ? "Renomear" : "Dar um nome"}
              </DropdownMenuItem>
              {!v.isControl && (
                <DropdownMenuItem onSelect={onMakeControl}>
                  <FlagIcon />
                  Tornar controle
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete} disabled={single}>
                <Trash2Icon />
                {single ? "É a única versão" : "Excluir versão"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </li>
  );
}

function RenameForm({
  variant: v,
  onDone,
  onCancel,
  onStale,
}: {
  variant: VariantView;
  onDone: (view: PageVariantsView) => void;
  onCancel: () => void;
  onStale: (message: string) => boolean;
}) {
  const [value, setValue] = useState(v.label ?? "");
  const [error, setError] = useState<string | null>(null);
  const rename = useAction(renameVariantAction);
  const inputId = useId();
  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        void rename.run(
          { variantId: v.id, label: value.trim() || null },
          {
            silentError: true,
            success: value.trim() ? `Nome da versão ${v.name} salvo.` : `A versão ${v.name} ficou sem nome.`,
            onSuccess: onDone,
            // A versão foi excluída em outra aba: a lista recarrega (sem ela) e o formulário fecha.
            onError: (msg) => (onStale(msg) ? onCancel() : setError(msg)),
          },
        );
      }}
    >
      <label htmlFor={inputId} className="text-xs text-muted-foreground">
        Nome da versão {v.name} (opcional, só para você reconhecer)
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={inputId}
          value={value}
          maxLength={VARIANT_LABEL_MAX}
          placeholder="Ex.: Headline nova, Preço 197"
          aria-invalid={Boolean(error)}
          className="h-8 min-w-0 flex-1"
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          autoFocus
        />
        <Button type="submit" size="sm" disabled={rename.pending}>
          {rename.pending ? <Spinner /> : <CheckIcon />}
          Salvar
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={rename.pending}>
          Cancelar
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}

// ─── Divisão do tráfego ──────────────────────────────────────────────────────

/** Percentuais editáveis: mudar um ajusta os outros para a soma continuar 100%. */
function WeightsEditor({
  view,
  onSaved,
  onDraftChange,
  onStale,
}: {
  view: PageVariantsView;
  onSaved: (view: PageVariantsView) => void;
  /** Avisa a divisão mudada e não salva (null = nada pendente). */
  onDraftChange: (draft: WeightsDraft | null) => void;
  /** Erro de lista desatualizada: recarrega e avisa (true = era isso). */
  onStale: (message: string) => boolean;
}) {
  const variants = view.variants;
  const [draft, setDraft] = useState<number[]>(() => variants.map((v) => v.weight));
  /** Texto de cada campo (pode estar vazio ou inválido enquanto a pessoa digita). */
  const [texts, setTexts] = useState<string[]>(() => variants.map((v) => String(v.weight)));
  const [touched, setTouched] = useState<number[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const save = useAction(setVariantWeightsAction);
  const ids = useId();

  const invalid = texts.map((t) => !/^\d{1,3}$/.test(t.trim()) || Number(t) > 100);
  const problem = invalid.some(Boolean) ? "Digite um número inteiro de 0 a 100 em cada versão." : weightsProblem(draft);
  const dirty = draft.some((w, i) => w !== variants[i]?.weight) || texts.some((t, i) => t !== String(draft[i]));

  // O diálogo precisa saber da mudança não salva (para perguntar antes de sair),
  // já na mesma renderização (useLayoutEffect): um Esc logo depois de digitar pergunta.
  useLayoutEffect(() => {
    onDraftChange(
      dirty
        ? {
            weights: variants.map((v, i) => ({ variantId: v.id, weight: draft[i], saved: v.weight })),
            valid: !problem,
            summary: weightsSummary(variants, draft),
            savedSummary: weightsSummary(
              variants,
              variants.map((v) => v.weight),
            ),
          }
        : null,
    );
  }, [dirty, draft, problem, variants, onDraftChange]);
  useLayoutEffect(() => () => onDraftChange(null), [onDraftChange]);

  function apply(next: number[], editedIndex?: number, raw?: string) {
    setDraft(next);
    setTexts(next.map((w, i) => (i === editedIndex && raw !== undefined ? raw : String(w))));
    setServerError(null);
  }

  function onType(index: number, raw: string) {
    const clean = raw.replace(/[^\d]/g, "").slice(0, 3);
    const value = Number(clean);
    if (clean === "" || value > 100) {
      setTexts((t) => t.map((x, i) => (i === index ? clean : x)));
      return;
    }
    const nextTouched = markTouched(touched, index);
    setTouched(nextTouched);
    apply(rebalance(draft, index, value, nextTouched), index, clean);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (problem) return;
    void save.run(
      {
        pageId: view.page.id,
        weights: variants.map((v, i) => ({ variantId: v.id, weight: draft[i], saved: v.weight })),
      },
      {
        silentError: true,
        success: "Divisão do tráfego salva.",
        onSuccess: onSaved,
        // Outra aba mudou as versões ou a divisão: a lista recarrega com o que está salvo (aviso no toast).
        onError: (msg) => {
          if (!onStale(msg)) setServerError(msg);
        },
      },
    );
  }

  const shownError = serverError ?? problem;
  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border p-4" aria-labelledby={`${ids}-title`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 basis-64">
          <h3 id={`${ids}-title`} className="flex items-center gap-1.5 font-medium text-sm">
            <ScaleIcon className="size-4 text-muted-foreground" aria-hidden />
            Divisão do tráfego
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Quanto dos visitantes vê cada versão quando o ZIP sai com o divisor. Ao mudar uma, as outras se ajustam para
            somar 100%.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => {
            setTouched([]);
            apply(evenSplit(variants.length));
          }}
        >
          <SplitIcon />
          Dividir por igual
        </Button>
      </div>

      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
        {variants.map((v, i) => (
          <div
            key={v.id}
            className={cn("h-full transition-[width]", colorOf(v.name))}
            style={{ width: `${Math.max(0, Math.min(100, draft[i] ?? 0))}%` }}
          />
        ))}
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-3">
        {variants.map((v, i) => (
          <div key={v.id} className="flex flex-col gap-1">
            <label htmlFor={`${ids}-${v.id}`} className="flex items-center gap-1.5 text-xs font-medium">
              <span aria-hidden className={cn("size-2 rounded-full", colorOf(v.name))} />
              Versão {v.name}
              {v.isControl && <FlagIcon className="size-3 text-muted-foreground" aria-label="controle" />}
            </label>
            <div className="relative">
              <Input
                id={`${ids}-${v.id}`}
                inputMode="numeric"
                aria-label={`Percentual da versão ${v.name}`}
                aria-invalid={invalid[i] || undefined}
                value={texts[i] ?? ""}
                onChange={(e) => onType(i, e.target.value)}
                onBlur={() => {
                  if (invalid[i]) setTexts((t) => t.map((x, j) => (j === i ? String(draft[i]) : x)));
                }}
                className="h-8 pr-7 tabular-nums"
              />
              <span className="pointer-events-none absolute inset-y-0 right-2.5 grid place-items-center text-xs text-muted-foreground">
                %
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          className={cn("text-xs", shownError ? "text-destructive" : "text-muted-foreground")}
          role={shownError ? "alert" : undefined}
        >
          {shownError ??
            (draft.some((w) => w === 0)
              ? "Versão com 0% não recebe visitas pelo divisor, mas continua no ZIP."
              : "Total: 100%.")}
        </p>
        <div className="flex gap-2">
          {dirty && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setTouched([]);
                apply(variants.map((v) => v.weight));
              }}
              disabled={save.pending}
            >
              <RotateCcwIcon />
              Desfazer
            </Button>
          )}
          <Button type="submit" size="sm" disabled={!dirty || Boolean(problem) || save.pending}>
            {save.pending && <Spinner />}
            Salvar divisão
          </Button>
        </div>
      </div>
    </form>
  );
}

// ─── Criar versão ────────────────────────────────────────────────────────────

const BLANK = "em-branco";

const cardClass =
  "group relative flex flex-col overflow-hidden rounded-lg border bg-card text-left shadow-xs outline-none transition-[border-color,box-shadow] hover:border-foreground/25 focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=checked]:border-primary data-[state=checked]:ring-1 data-[state=checked]:ring-primary";

function SourceOption({
  value,
  title,
  description,
  icon: Icon,
}: {
  value: string;
  title: string;
  description: string;
  icon: typeof CopyIcon;
}) {
  return (
    <RadioGroupPrimitive.Item value={value} className={cn(cardClass, "flex-row items-start gap-3 p-3")}>
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-4" />
      </span>
      <span className="flex flex-col gap-0.5 pr-6">
        <span className="font-medium text-sm">{title}</span>
        <span className="text-xs text-muted-foreground leading-snug">{description}</span>
      </span>
      <RadioGroupPrimitive.Indicator className="absolute top-2.5 right-2.5 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
        <CheckIcon className="size-3.5" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
}

function CreateVariantForm({
  view,
  onCancel,
  onStale,
  onCreated,
}: {
  view: PageVariantsView;
  onCancel: () => void;
  /** Erro de lista desatualizada: recarrega (e avisa, sem `quiet`); true = era isso. */
  onStale: (message: string, opts?: { quiet?: boolean }) => boolean;
  onCreated: (view: PageVariantsView, info: CreatedInfo) => void;
}) {
  const control = view.variants.find((v) => v.isControl) ?? view.variants[0];
  const [source, setSource] = useState<"copy" | "template">("copy");
  const [chosen, setCopyFrom] = useState(control?.id ?? "");
  // A versão escolhida foi excluída em outra aba (a lista recarregou): volta para a de controle.
  const copyFrom = view.variants.some((v) => v.id === chosen) ? chosen : (control?.id ?? "");
  const [templateId, setTemplateId] = useState(BLANK);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const create = useAction(createVariantAction);
  const ids = useId();
  const name = view.nextName ?? "";
  const selected = templateId === BLANK ? undefined : templateSummary(templateId);
  const count = view.variants.length + 1;
  const paused = view.variants.filter((v) => v.weight === 0).length;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (label.trim().length > VARIANT_LABEL_MAX) {
      setError({ message: `O nome da versão pode ter no máximo ${VARIANT_LABEL_MAX} caracteres.`, field: "label" });
      return;
    }
    const input: Parameters<typeof createVariantAction>[0] = {
      pageId: view.page.id,
      label: label.trim() || null,
      source:
        source === "copy"
          ? { kind: "copy", variantId: copyFrom || null }
          : { kind: "template", templateId: selected && isTemplateId(selected.id) ? selected.id : null },
    };
    void create.run(input, {
      silentError: true,
      onError: (message, field) => {
        if (message === COPY_SOURCE_GONE) {
          // A lista recarrega (a versão some do "Copiar a versão") e o erro fica no formulário.
          onStale(message, { quiet: true });
          setError({ message, field });
        } else if (onStale(message)) {
          onCancel();
        } else {
          setError({ message, field });
        }
      },
      onSuccess: ({ created, view: next }) => onCreated(next, createdInfo(created, next)),
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <RadioGroupPrimitive.Root
        value={source}
        onValueChange={(v) => {
          setSource(v as "copy" | "template");
          setError(null);
        }}
        aria-label="Como começar a versão"
        className="grid gap-3 sm:grid-cols-2"
      >
        <SourceOption
          value="copy"
          icon={CopyIcon}
          title="Cópia de uma versão"
          description="Mesmo conteúdo e arquivos. Depois é só mudar o que você quer testar: headline, preço, vídeo…"
        />
        <SourceOption
          value="template"
          icon={LayoutTemplateIcon}
          title="Modelo pronto ou em branco"
          description="Uma página diferente, montada a partir de um modelo da galeria."
        />
      </RadioGroupPrimitive.Root>

      {source === "copy" && view.variants.length > 1 && (
        <Field className="max-w-sm">
          <FieldLabel htmlFor={`${ids}-from`}>Copiar a versão</FieldLabel>
          <Select value={copyFrom} onValueChange={setCopyFrom}>
            <SelectTrigger id={`${ids}-from`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {view.variants.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {variantTitle(v)}
                  {v.isControl ? " (controle)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      {source === "copy" && view.variants.length === 1 && control && (
        <p className="text-sm text-muted-foreground">
          A versão {name} começa igual à {variantTitle(control)}, com os mesmos textos, imagens e scripts.
        </p>
      )}

      {source === "template" && (
        <RadioGroupPrimitive.Root
          value={templateId}
          onValueChange={setTemplateId}
          aria-label="Modelo da versão"
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5"
        >
          <RadioGroupPrimitive.Item value={BLANK} className={cardClass} aria-label="Em branco">
            <span className="grid aspect-[4/3] place-items-center border-b bg-background">
              <span className="grid size-10 place-items-center rounded-full border border-dashed text-muted-foreground">
                <PlusIcon className="size-5" />
              </span>
            </span>
            <span className="p-2.5 font-medium text-sm">Em branco</span>
            <RadioGroupPrimitive.Indicator className="absolute top-2 right-2 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm">
              <CheckIcon className="size-3.5" />
            </RadioGroupPrimitive.Indicator>
          </RadioGroupPrimitive.Item>
          {TEMPLATE_SUMMARIES.map((t) => (
            <RadioGroupPrimitive.Item
              key={t.id}
              value={t.id}
              className={cardClass}
              aria-label={t.name}
              title={t.description}
            >
              <span className="block aspect-[4/3] overflow-hidden border-b bg-muted">
                {/* biome-ignore lint/performance/noImgElement: miniatura SVG embutida (data:), sem otimização a fazer */}
                <img src={thumbnailUrl(t)} alt="" className="size-full object-cover" draggable={false} />
              </span>
              <span className="p-2.5 font-medium text-sm leading-snug">{t.name}</span>
              <RadioGroupPrimitive.Indicator className="absolute top-2 right-2 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm">
                <CheckIcon className="size-3.5" />
              </RadioGroupPrimitive.Indicator>
            </RadioGroupPrimitive.Item>
          ))}
        </RadioGroupPrimitive.Root>
      )}
      {source === "template" && selected?.notice && (
        <p role="note" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          {selected.notice}
        </p>
      )}

      <Field className="max-w-md" data-invalid={error?.field === "label" || undefined}>
        <FieldLabel htmlFor={`${ids}-label`}>Nome da versão (opcional)</FieldLabel>
        <Input
          id={`${ids}-label`}
          value={label}
          maxLength={VARIANT_LABEL_MAX}
          placeholder="Ex.: Headline nova, Preço 197"
          aria-invalid={error?.field === "label" || undefined}
          onChange={(e) => {
            setLabel(e.target.value);
            setError(null);
          }}
        />
        <FieldDescription>Só para você reconhecer a versão. A pasta no ZIP usa a letra.</FieldDescription>
        {error?.field === "label" && <FieldError>{error.message}</FieldError>}
      </Field>

      {error && error.field !== "label" && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      )}

      <DialogFooter className="items-center gap-2 sm:justify-between">
        <p className="text-xs text-muted-foreground">
          O tráfego passa a ser {splitText(count, paused)} (dá para ajustar depois).
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onCancel} disabled={create.pending}>
            Voltar
          </Button>
          <Button type="submit" disabled={create.pending || !name}>
            {create.pending && <Spinner />}
            Criar versão {name}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
