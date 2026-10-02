"use client";

import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckCircle2Icon,
  FileTextIcon,
  LinkIcon,
  ReplaceAllIcon,
  ReplaceIcon,
  SearchIcon,
} from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAction } from "@/hooks/use-action";
import {
  contextSnippet,
  createMatcher,
  type EditorMatch,
  findInEditor,
  replaceAllInEditor,
  replaceMatchInEditor,
  type SearchTargets,
  valueKindOfAttribute,
} from "@/lib/find-replace";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { bulkReplaceAction } from "@/server/actions/bulk-replace";
import type { BulkResult } from "@/server/services/bulk-replace";
import type { EditorDialogProps } from "../editor-app";

type Scope = "page" | "offer";

/** Espera o editor registrar a troca (o evento "update" dele sai no próximo ciclo). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

const DEVICE_LABEL = { ALL: "", DESKTOP: " · layout do computador", MOBILE: " · layout do celular" } as const;

function documentLabel(doc: BulkResult["documents"][number]) {
  const variant = doc.variantName !== "A" ? ` · Versão ${doc.variantName}` : "";
  return `${doc.pageName}${variant}${DEVICE_LABEL[doc.device]}`;
}

/** Atributos que levam a algum lugar (num botão ligado a link da oferta, quem manda é o link). */
const DESTINATION_ATTRS = new Set(["href", "data-os-href", "action"]);

function isOverriddenByLink(match: EditorMatch) {
  return !!match.linkKey && match.field.kind === "attr" && DESTINATION_ATTRS.has(match.field.name);
}

function MatchRow({
  match,
  active,
  linkLabel,
  onShow,
  onReplace,
  disabled,
}: {
  match: EditorMatch;
  active: boolean;
  linkLabel: string | null;
  onShow: () => void;
  onReplace: () => void;
  disabled: boolean;
}) {
  const snippet = contextSnippet(match.value, match.range, 36);
  // Endereços em fonte monoespaçada; textos (inclusive alt, dicas e rótulos) na fonte normal.
  const place = match.field.kind === "content" ? match.field.inner : match.field;
  const isText = place.kind === "text" || (place.kind === "attr" && valueKindOfAttribute(place.name) === "text");
  return (
    <li className={cn("group flex items-stretch", active && "bg-accent")}>
      <button
        type="button"
        onClick={onShow}
        aria-current={active || undefined}
        className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2 text-left outline-none hover:bg-muted/70 focus-visible:bg-muted"
      >
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{match.element}</span>
          <span aria-hidden>·</span>
          <span className="truncate">{match.where}</span>
          {linkLabel && isOverriddenByLink(match) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <LinkIcon className="size-3.5 shrink-0 text-primary" aria-label="Ligado a um link da oferta" />
              </TooltipTrigger>
              <TooltipContent className="max-w-64">
                Este botão está ligado ao link da oferta “{linkLabel}”. Na página publicada vale o endereço do link —
                para trocar em todos os botões, use “Links e checkouts”.
              </TooltipContent>
            </Tooltip>
          )}
        </span>
        <span className={cn("line-clamp-2 text-sm", isText ? "break-words" : "break-all font-mono text-xs")}>
          {snippet.before}
          <mark className="rounded-sm bg-yellow-200 px-0.5 text-foreground dark:bg-yellow-500/40">{snippet.match}</mark>
          {snippet.after}
        </span>
      </button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn(
              "m-1 self-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
              active && "opacity-100",
            )}
            aria-label="Substituir esta ocorrência"
            onClick={onReplace}
            disabled={disabled}
          >
            <ReplaceIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Substituir esta</TooltipContent>
      </Tooltip>
    </li>
  );
}

/**
 * Localizar e substituir: painel flutuante (não bloqueia o canvas) que procura
 * nos textos e nos links/imagens da página aberta — ou de todas as páginas da
 * oferta. Na página aberta, tudo passa pela API do editor (dá para desfazer);
 * nas outras, o servidor troca e guarda uma versão "Antes de substituir".
 */
export function FindReplaceDialog({
  editor,
  payload,
  open,
  onOpenChange,
  saveNow,
  reloadDiscarding,
}: EditorDialogProps) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [accentInsensitive, setAccentInsensitive] = useState(false);
  const [preserveCase, setPreserveCase] = useState(true);
  const [targets, setTargets] = useState<SearchTargets>({ text: true, attributes: true });
  const [scope, setScope] = useState<Scope>("page");
  const [matches, setMatches] = useState<EditorMatch[]>([]);
  const [current, setCurrent] = useState(0);
  /** A ocorrência atual já foi mostrada no canvas? (o primeiro Enter mostra a primeira). */
  const [shown, setShown] = useState(false);
  const [others, setOthers] = useState<BulkResult | null>(null);
  const [othersError, setOthersError] = useState<string | null>(null);
  const [counting, setCounting] = useState(false);
  const [recount, setRecount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const bulk = useAction(bulkReplaceAction);

  const deferredQuery = useDeferredValue(query);
  const matcher = useMemo(
    () => createMatcher(deferredQuery, { accentInsensitive, preserveCase }),
    [deferredQuery, accentInsensitive, preserveCase],
  );
  const hasTargets = targets.text || targets.attributes;
  const index = matches.length ? Math.min(current, matches.length - 1) : -1;
  // payload.links muda no lugar (links criados no editor): lido a cada desenho, nunca guardado.
  const linkLabels = new Map(payload.links.map((l) => [l.key, l.label]));

  // Desfazer/refazer das trocas (textos e imagens) dependem de installEditorSync,
  // ligado uma vez pelo editor (src/editor/editor-app.tsx).

  const refresh = useCallback(() => {
    setMatches(open && matcher && hasTargets ? findInEditor(editor, matcher, targets) : []);
  }, [editor, open, matcher, hasTargets, targets]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Com o painel aberto, a lista acompanha as edições feitas no canvas.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);
  useEffect(() => {
    if (!open) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChange = () => {
      clearTimeout(timer);
      timer = setTimeout(() => refreshRef.current(), 200);
    };
    editor.on("update undo redo", onChange);
    return () => {
      clearTimeout(timer);
      editor.off("update undo redo", onChange);
    };
  }, [editor, open]);

  // Nova busca: volta para a primeira ocorrência e esconde o aviso de "pronto".
  // biome-ignore lint/correctness/useExhaustiveDependencies: reage à mudança da busca.
  useEffect(() => {
    setCurrent(0);
    setShown(false);
    setDone(null);
  }, [matcher, targets, scope]);

  // Contagem nas outras páginas (só no modo "todas as páginas").
  // biome-ignore lint/correctness/useExhaustiveDependencies: recount força uma nova contagem.
  useEffect(() => {
    setOthers(null);
    setOthersError(null);
    if (!open || scope !== "offer" || !matcher || !hasTargets) {
      setCounting(false);
      return;
    }
    let cancelled = false;
    setCounting(true);
    const timer = setTimeout(async () => {
      const res = await bulkReplaceAction({
        offerId: payload.offer.id,
        query: matcher.query,
        replacement: "",
        accentInsensitive,
        targets,
        dryRun: true,
        excludeDocumentIds: [payload.documentId],
      }).catch(() => null);
      if (cancelled) return;
      setCounting(false);
      if (res?.ok) setOthers(res.data);
      else setOthersError(res?.error ?? "Não foi possível contar nas outras páginas.");
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, scope, matcher, hasTargets, accentInsensitive, targets, payload.offer.id, payload.documentId, recount]);

  function show(i: number) {
    const match = matches[i];
    if (!match) return;
    setCurrent(i);
    setShown(true);
    editor.select(match.component);
    editor.Canvas.scrollTo(match.component, { behavior: "smooth", block: "center" });
  }

  function step(delta: number) {
    if (!matches.length) return;
    show(shown ? (index + delta + matches.length) % matches.length : index);
  }

  async function replaceOne(i: number) {
    const match = matches[i];
    if (!match || !matcher) return;
    const changed = replaceMatchInEditor(match, matcher, replacement, targets);
    const fresh = findInEditor(editor, matcher, targets);
    setMatches(fresh);
    if (!changed) {
      toast.error("A página mudou desde a busca. A lista foi atualizada: tente de novo.");
      return;
    }
    // Se o texto novo também contém o que se procura, pula para depois dele.
    setCurrent(Math.min(i + matcher.ranges(replacement).length, Math.max(fresh.length - 1, 0)));
    await settle();
    await saveNow();
  }

  async function replaceAllHere() {
    if (!matcher) return;
    setBusy(true);
    try {
      const count = replaceAllInEditor(editor, matcher, replacement, targets);
      refresh();
      if (!count) return;
      toast.success(`${plural(count, "troca feita", "trocas feitas")} nesta página. Para voltar, use Desfazer (⌘Z).`);
      await settle();
      await saveNow();
    } finally {
      setBusy(false);
    }
  }

  async function replaceEverywhere() {
    if (!matcher) return;
    setBusy(true);
    try {
      if (!(await saveNow())) {
        toast.error("Não foi possível salvar esta página antes de substituir. Tente de novo.");
        return;
      }
      const localCount = findInEditor(editor, matcher, targets).length;
      const res = await bulk.run({
        offerId: payload.offer.id,
        query: matcher.query,
        replacement,
        accentInsensitive,
        preserveCase,
        targets,
        excludeDocumentIds: [payload.documentId],
        snapshotDocumentId: localCount ? payload.documentId : undefined,
      });
      if (!res.ok) return;
      if (res.data.changedDocumentIds.includes(payload.documentId)) {
        // Esta página mudou no servidor: o editor precisa recarregar para mostrar.
        toast.success("Substituição feita. Recarregando o editor para mostrar esta página atualizada…");
        reloadDiscarding();
        return;
      }
      const here = localCount ? replaceAllInEditor(editor, matcher, replacement, targets) : 0;
      const pages = res.data.documents.length + (here ? 1 : 0);
      const total = res.data.total + here;
      setDone(
        total
          ? `Pronto: ${plural(total, "troca", "trocas")} em ${plural(pages, "página", "páginas")}. As outras páginas ganharam um ponto “Antes de substituir” no Histórico${here ? "; nesta, use Desfazer (⌘Z) se precisar" : ""}.`
          : "Nada para trocar.",
      );
      setConfirming(false);
      refresh();
      setRecount((n) => n + 1);
      if (here) {
        await settle();
        await saveNow();
      }
    } finally {
      setBusy(false);
    }
  }

  function onFindKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    }
  }

  function onReplaceKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (scope === "page" && (e.metaKey || e.ctrlKey)) void replaceAllHere();
    else if (scope === "page" && index >= 0) void replaceOne(index);
  }

  const othersTotal = others?.total ?? 0;
  const everywhereTotal = matches.length + othersTotal;
  const everywherePages = (others?.documents.length ?? 0) + (matches.length ? 1 : 0);
  const replacementLabel = replacement ? `“${replacement}”` : "nada (apagar)";

  let emptyMessage: string | null = null;
  if (!query.trim())
    emptyMessage = "Digite o que procurar: o nome do produto, um preço, um texto ou o endereço de um checkout.";
  else if (!hasTargets) emptyMessage = "Marque onde procurar: nos textos, nos links e imagens ou nos dois.";
  else if (matcher && !matches.length) emptyMessage = "Nada encontrado nesta página.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogContent
        className="top-14 right-3 left-auto flex max-h-[calc(100svh-4.5rem)] w-[27rem] max-w-[calc(100vw-1.5rem)] translate-x-0 translate-y-0 flex-col gap-3 p-4 sm:max-w-[27rem] data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100 data-[state=open]:slide-in-from-top-2"
        // Painel flutuante: clicar no canvas ou nos painéis não fecha.
        onInteractOutside={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          findRef.current?.focus();
          findRef.current?.select();
        }}
      >
        <DialogHeader className="gap-1 pr-6">
          <DialogTitle className="text-base">Localizar e substituir</DialogTitle>
          <DialogDescription className="text-xs">
            Procura nos textos e nos links, imagens e formulários. Maiúsculas e minúsculas contam como iguais.
          </DialogDescription>
        </DialogHeader>

        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={scope}
          onValueChange={(v) => v && setScope(v as Scope)}
          className="w-full"
          aria-label="Onde substituir"
        >
          <ToggleGroupItem value="page" className="flex-1">
            Nesta página
          </ToggleGroupItem>
          <ToggleGroupItem value="offer" className="flex-1">
            Em todas as páginas
          </ToggleGroupItem>
        </ToggleGroup>

        <div className="grid gap-2">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={findRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onFindKeyDown}
              placeholder="Localizar…"
              aria-label="Localizar"
              maxLength={500}
              className="pr-32 pl-8"
            />
            <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5">
              <span className="px-1 text-xs tabular-nums text-muted-foreground" aria-live="polite">
                {matcher && hasTargets ? (matches.length ? `${index + 1} de ${matches.length}` : "0") : ""}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-7"
                aria-label="Anterior (⇧Enter)"
                title="Anterior (⇧Enter)"
                onClick={() => step(-1)}
                disabled={!matches.length}
              >
                <ArrowUpIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-7"
                aria-label="Próxima (Enter)"
                title="Próxima (Enter)"
                onClick={() => step(1)}
                disabled={!matches.length}
              >
                <ArrowDownIcon />
              </Button>
            </div>
          </div>
          <div className="relative">
            <ReplaceIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              onKeyDown={onReplaceKeyDown}
              placeholder="Substituir por… (vazio apaga)"
              aria-label="Substituir por"
              maxLength={4000}
              className="pl-8"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <Label className="font-normal">
            <Checkbox checked={targets.text} onCheckedChange={(v) => setTargets((t) => ({ ...t, text: v === true }))} />
            Textos
          </Label>
          <Label className="font-normal">
            <Checkbox
              checked={targets.attributes}
              onCheckedChange={(v) => setTargets((t) => ({ ...t, attributes: v === true }))}
            />
            Links e imagens
          </Label>
          <Label className="font-normal" title="Com esta opção, “acao” também encontra “ação”.">
            <Checkbox checked={accentInsensitive} onCheckedChange={(v) => setAccentInsensitive(v === true)} />
            Ignorar acentos
          </Label>
          <Label
            className="font-normal"
            title="Nos textos, o texto novo segue as maiúsculas do que foi encontrado: COMPRE → GARANTA, Compre → Garanta."
          >
            <Checkbox checked={preserveCase} onCheckedChange={(v) => setPreserveCase(v === true)} />
            Manter maiúsculas
          </Label>
        </div>

        {done && (
          <p className="flex items-start gap-2 rounded-md border border-success/30 bg-success/10 p-2.5 text-xs">
            <CheckCircle2Icon className="mt-px size-4 shrink-0 text-success" />
            {done}
          </p>
        )}

        {scope === "offer" && matcher && hasTargets && (
          <section className="rounded-md border p-2.5 text-sm" aria-label="Outras páginas da oferta">
            <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              Outras páginas da oferta
              {counting && <Spinner className="size-3.5" />}
            </p>
            {othersError ? (
              <p className="mt-1 text-xs text-destructive">{othersError}</p>
            ) : others && !counting ? (
              others.documents.length ? (
                <ul className="mt-1.5 flex max-h-28 flex-col gap-1 overflow-y-auto">
                  {others.documents.map((doc) => (
                    <li key={doc.documentId} className="flex items-center gap-2 text-sm">
                      <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{documentLabel(doc)}</span>
                      <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{doc.count}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">Nenhuma ocorrência nas outras páginas.</p>
              )
            ) : null}
          </section>
        )}

        {scope === "offer" && matcher && hasTargets && (
          <p className="-mb-1 text-xs font-medium text-muted-foreground">Nesta página</p>
        )}
        {emptyMessage ? (
          <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </p>
        ) : (
          <ul
            className="min-h-0 flex-1 divide-y overflow-y-auto rounded-md border"
            aria-label="Resultados nesta página"
          >
            {matches.map((match, i) => (
              <MatchRow
                key={match.id}
                match={match}
                active={i === index}
                linkLabel={match.linkKey ? (linkLabels.get(match.linkKey) ?? match.linkKey) : null}
                onShow={() => show(i)}
                onReplace={() => void replaceOne(i)}
                disabled={busy}
              />
            ))}
          </ul>
        )}

        {scope === "page" ? (
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void replaceOne(index)}
              disabled={busy || index < 0}
              title="Enter no campo “Substituir por”"
            >
              <ReplaceIcon />
              Substituir
            </Button>
            <Button size="sm" onClick={() => void replaceAllHere()} disabled={busy || !matches.length} title="⌘Enter">
              {busy ? <Spinner /> : <ReplaceAllIcon />}
              Substituir todas{matches.length ? ` (${matches.length})` : ""}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Button
              size="sm"
              onClick={() => setConfirming(true)}
              disabled={busy || counting || !everywhereTotal || !!othersError}
              className="w-full"
            >
              {busy ? <Spinner /> : <ReplaceAllIcon />}
              Substituir em todas as páginas{everywhereTotal ? ` (${everywhereTotal})` : ""}
            </Button>
            <p className="text-xs text-muted-foreground">
              Vale para todas as páginas, versões A/B e layouts de celular. Antes de mudar, cada página ganha um ponto
              “Antes de substituir” no Histórico para você poder voltar.
            </p>
          </div>
        )}
      </DialogContent>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Substituir em todas as páginas?"
        description={`Trocar “${matcher?.query ?? ""}” por ${replacementLabel} — ${plural(everywhereTotal, "ocorrência", "ocorrências")} em ${plural(everywherePages, "página", "páginas")}. Antes de mudar, cada página ganha um ponto “Antes de substituir” no Histórico.`}
        confirmLabel="Substituir"
        pending={busy}
        onConfirm={() => void replaceEverywhere()}
      />
    </Dialog>
  );
}
