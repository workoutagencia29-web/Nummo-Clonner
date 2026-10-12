"use client";

import {
  ArrowDownIcon,
  ArrowRightIcon,
  Disc3Icon,
  ExternalLinkIcon,
  FileIcon,
  FileTextIcon,
  GitBranchIcon,
  InfoIcon,
  ListChecksIcon,
  MailIcon,
  PackageIcon,
  PartyPopperIcon,
  RotateCcwIcon,
  ShoppingCartIcon,
  StoreIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  VideoIcon,
  XIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { CloneModeValue, FunnelPageKind } from "@/worker/clone/types";
import { type FunnelProgress, KIND_LABEL, type MapLevel, type MapNode, shortPath } from "./funnel-map-logic";

const KIND_ICON: Record<FunnelPageKind, typeof FileIcon> = {
  QUIZ: ListChecksIcon,
  WHEEL: Disc3Icon,
  STORE: StoreIcon,
  PRODUCT: PackageIcon,
  VSL: VideoIcon,
  SALES: FileTextIcon,
  CAPTURE: MailIcon,
  UPSELL: TrendingUpIcon,
  DOWNSELL: TrendingDownIcon,
  THANK_YOU: PartyPopperIcon,
  OTHER: FileIcon,
};

const MODE_LABEL: Record<CloneModeValue, string> = { EDITABLE: "Editável", PRESERVE_JS: "Com scripts" };

export interface FunnelMapProps {
  levels: MapLevel[];
  progress: FunnelProgress;
  summary: string;
  /** O robô ainda procura páginas (clonar o funil inteiro ligado, sem "Parar"). */
  searching: boolean;
  /** Modo de cada página (id → modo). */
  modes: Record<string, CloneModeValue>;
  onModeChange: (ids: string[], mode: CloneModeValue) => void;
  /** Páginas prontas que entram na oferta. */
  included: Set<string>;
  onIncludeChange: (ids: string[], on: boolean) => void;
  onPreview: (node: MapNode) => void;
  onRetry: (node: MapNode) => void;
  onCancel: (node: MapNode) => void;
  onStop: () => void;
  busy: { preview: boolean; retry: boolean; cancel: boolean; stop: boolean };
}

function Thumb({ node, className }: { node: MapNode; className?: string }) {
  const Icon = KIND_ICON[node.kind ?? "OTHER"];
  return (
    <div className={cn("relative overflow-hidden rounded-md border bg-muted", className)}>
      {node.thumbnailKey ? (
        // biome-ignore lint/performance/noImgElement: miniatura do storage (sem otimização do Next)
        <img
          src={`/api/files/${node.thumbnailKey}`}
          alt=""
          loading="lazy"
          className="size-full object-cover object-top"
        />
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground">
          {node.status === "RUNNING" || node.status === "QUEUED" ? (
            <Spinner className="size-5" />
          ) : (
            <Icon className="size-6" aria-hidden />
          )}
        </div>
      )}
    </div>
  );
}

function KindBadge({ node }: { node: MapNode }) {
  if (!node.kind) return <Badge variant="outline">{node.product ? "Produto" : "Página"}</Badge>;
  const Icon = KIND_ICON[node.kind];
  return (
    <Badge variant="secondary" className="gap-1">
      <Icon className="size-3" aria-hidden />
      {KIND_LABEL[node.kind]}
    </Badge>
  );
}

function StatusLine({ node, props }: { node: MapNode; props: FunnelMapProps }) {
  if (node.status === "QUEUED" || node.status === "RUNNING") {
    return (
      <div className="flex items-center gap-2 text-xs">
        <Progress value={node.status === "QUEUED" ? 0 : node.progress} className="h-1.5" />
        <span className="shrink-0 text-muted-foreground">
          {node.status === "QUEUED" ? "Na fila" : `${node.progress}%`}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Cancelar ${node.name}`}
          title="Cancelar esta página"
          disabled={props.busy.cancel}
          onClick={() => props.onCancel(node)}
        >
          <XIcon />
        </Button>
      </div>
    );
  }
  if (node.status === "FAILED") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="min-w-0 flex-1 text-destructive">{node.errorMessage || "Não foi possível clonar."}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          aria-label={`Tentar de novo ${node.name}`}
          disabled={props.busy.retry}
          onClick={() => props.onRetry(node)}
        >
          <RotateCcwIcon />
          Tentar de novo
        </Button>
      </div>
    );
  }
  return null;
}

function ModeSelect({
  value,
  suggested,
  onChange,
  label,
}: {
  value: CloneModeValue;
  suggested: CloneModeValue | null;
  onChange: (mode: CloneModeValue) => void;
  label: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as CloneModeValue)}>
      <SelectTrigger size="sm" className="h-7 w-auto min-w-0 gap-1 px-2 text-xs" aria-label={label}>
        <SelectValue>{MODE_LABEL[value]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {(["EDITABLE", "PRESERVE_JS"] as const).map((m) => (
          <SelectItem key={m} value={m} className="text-xs">
            {MODE_LABEL[m]}
            {suggested === m ? " (recomendado)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PageCard({ node, props }: { node: MapNode; props: FunnelMapProps }) {
  const ready = node.status === "REVIEW";
  const mode = props.modes[node.id] ?? node.suggestedMode ?? "EDITABLE";
  const included = node.root || props.included.has(node.id);
  const checkboxId = `inc-${node.id}`;
  return (
    <article
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-2.5 shadow-xs",
        ready && !included && "opacity-60",
      )}
      aria-label={`${node.kind ? KIND_LABEL[node.kind] : "Página"}: ${node.name}`}
    >
      {/* No celular, miniatura pequena ao lado; no computador, em cima. */}
      <div className="flex min-w-0 gap-2.5 sm:flex-col sm:gap-2">
        <Thumb node={node} className="aspect-[16/10] w-28 shrink-0 self-start sm:w-full" />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <KindBadge node={node} />
            {node.root && <Badge variant="outline">Página do link</Badge>}
          </div>
          <p className="line-clamp-2 text-sm font-medium leading-snug" title={node.name}>
            {node.name}
          </p>
          {node.url && (
            <p className="truncate text-xs text-muted-foreground" title={node.url}>
              {shortPath(node.url)}
            </p>
          )}
          {node.checkouts > 0 && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <ShoppingCartIcon className="size-3 shrink-0" aria-hidden />
              Leva ao checkout
              {node.checkoutPlatform && node.checkoutPlatform !== "Desconhecida" ? ` (${node.checkoutPlatform})` : ""}
            </p>
          )}
        </div>
      </div>
      <StatusLine node={node} props={props} />
      {node.note && (
        <p className="flex gap-1.5 rounded-md bg-warning/10 px-2 py-1.5 text-xs text-warning-foreground dark:text-warning">
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {node.note}
        </p>
      )}
      {ready && (
        <div className="flex flex-wrap items-center gap-1.5">
          {!node.root && (
            <div className="mr-auto flex items-center gap-1.5">
              <Checkbox
                id={checkboxId}
                checked={included}
                onCheckedChange={(v) => props.onIncludeChange([node.id], v === true)}
                aria-label={`Incluir ${node.name} na oferta`}
              />
              <Label htmlFor={checkboxId} className="text-xs font-normal">
                Incluir
              </Label>
            </div>
          )}
          <ModeSelect
            value={mode}
            suggested={node.suggestedMode}
            onChange={(m) => props.onModeChange([node.id], m)}
            label={`Modo da cópia de ${node.name}`}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Abrir prévia de ${node.name}`}
            title="Ver a cópia em outra aba"
            disabled={props.busy.preview}
            onClick={() => props.onPreview(node)}
          >
            <ExternalLinkIcon />
          </Button>
        </div>
      )}
    </article>
  );
}

function ProductsGroup({ products, props }: { products: MapNode[]; props: FunnelMapProps }) {
  const ready = products.filter((p) => p.status === "REVIEW");
  const chosen = ready.filter((p) => props.included.has(p.id));
  const modes = new Set(ready.map((p) => props.modes[p.id] ?? p.suggestedMode ?? "EDITABLE"));
  const groupMode = modes.size === 1 ? [...modes][0] : undefined;
  const allId = `inc-grupo-${products[0]?.id ?? ""}`;
  return (
    <section
      className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-2.5 shadow-xs"
      aria-label={`${products.length} páginas de produto`}
    >
      <div className="flex items-center gap-1.5">
        <PackageIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <h4 className="text-sm font-medium">Produtos ({products.length})</h4>
      </div>
      {ready.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="mr-auto flex items-center gap-1.5">
            <Checkbox
              id={allId}
              aria-label="Incluir todos os produtos na oferta"
              checked={chosen.length === ready.length ? true : chosen.length ? "indeterminate" : false}
              onCheckedChange={(v) =>
                props.onIncludeChange(
                  ready.map((p) => p.id),
                  v === true,
                )
              }
            />
            <Label htmlFor={allId} className="text-xs font-normal">
              Incluir todos
            </Label>
          </div>
          <Select
            value={groupMode ?? ""}
            onValueChange={(v) =>
              props.onModeChange(
                ready.map((p) => p.id),
                v as CloneModeValue,
              )
            }
          >
            <SelectTrigger size="sm" className="h-7 w-auto gap-1 px-2 text-xs" aria-label="Modo da cópia dos produtos">
              <SelectValue placeholder="Modos diferentes">{groupMode ? MODE_LABEL[groupMode] : undefined}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="EDITABLE" className="text-xs">
                Editável (recomendado)
              </SelectItem>
              <SelectItem value="PRESERVE_JS" className="text-xs">
                Com scripts
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      <ul className="flex flex-col divide-y">
        {products.map((p) => {
          const included = props.included.has(p.id);
          const id = `inc-${p.id}`;
          return (
            <li
              key={p.id}
              className={cn("flex min-w-0 flex-col gap-1 py-1.5", p.status === "REVIEW" && !included && "opacity-60")}
            >
              <div className="flex min-w-0 items-center gap-2">
                <Thumb node={p} className="aspect-[16/10] w-14 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium" title={p.name}>
                    {p.name}
                  </p>
                  {p.status === "REVIEW" && (
                    <div className="flex items-center gap-1.5">
                      <Checkbox
                        id={id}
                        checked={included}
                        onCheckedChange={(v) => props.onIncludeChange([p.id], v === true)}
                        aria-label={`Incluir ${p.name} na oferta`}
                      />
                      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
                        Incluir
                      </Label>
                    </div>
                  )}
                </div>
                {p.status === "REVIEW" && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Abrir prévia de ${p.name}`}
                    title="Ver a cópia em outra aba"
                    disabled={props.busy.preview}
                    onClick={() => props.onPreview(p)}
                  >
                    <ExternalLinkIcon />
                  </Button>
                )}
              </div>
              <StatusLine node={p} props={props} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Seta entre as etapas: para baixo no celular, para o lado no computador. */
function Arrow({ text }: { text: string }) {
  return (
    <div className="flex shrink-0 items-center gap-2 py-1 pl-3 text-xs text-muted-foreground sm:w-24 sm:flex-col sm:justify-center sm:gap-1 sm:self-stretch sm:px-1 sm:py-0 sm:text-center">
      <ArrowDownIcon className="size-4 shrink-0 sm:hidden" aria-hidden />
      <ArrowRightIcon className="hidden size-5 shrink-0 sm:block" aria-hidden />
      <span className="min-w-0 sm:line-clamp-3">{text}</span>
    </div>
  );
}

/**
 * Mapa do funil na revisão da clonagem: as etapas lado a lado (quiz → roleta
 * → loja → produtos → checkout), cada página com a miniatura, o tipo, a
 * situação, incluir, modo e prévia. No celular, uma embaixo da outra.
 */
export function FunnelMap(props: FunnelMapProps) {
  const { levels, progress, searching } = props;
  const checkoutPlatforms = [
    ...new Set(
      levels
        .flatMap((l) => [...l.pages, ...l.products])
        .filter((n) => n.checkouts > 0)
        .map((n) => (n.checkoutPlatform && n.checkoutPlatform !== "Desconhecida" ? n.checkoutPlatform : "")),
    ),
  ];
  const platforms = checkoutPlatforms.filter(Boolean);
  const working = progress.running > 0;
  return (
    <Card className="gap-3 py-4" aria-labelledby="funnel-map-title">
      <CardHeader className="gap-2 px-4">
        <div className="flex flex-wrap items-center gap-2">
          <GitBranchIcon className="size-4 text-muted-foreground" aria-hidden />
          <CardTitle id="funnel-map-title" className="text-base">
            Mapa do funil
          </CardTitle>
          <Badge variant="secondary">
            {progress.ready} de {progress.total} {progress.total === 1 ? "página pronta" : "páginas prontas"}
          </Badge>
          {searching && (
            <Button variant="outline" size="sm" className="ml-auto" disabled={props.busy.stop} onClick={props.onStop}>
              {props.busy.stop && <Spinner />}
              Parar de procurar
            </Button>
          )}
        </div>
        <CardDescription className="text-xs">
          {props.summary && <span className="font-medium text-foreground">{props.summary}. </span>}
          {searching
            ? "O robô segue os botões e links de cada página e clona as próximas sozinho. "
            : "Estas são as páginas que o robô achou a partir do link. "}
          Desmarque o que não quiser na oferta. “Com scripts” mantém o funcionamento original (quiz, roleta); “Editável”
          abre tudo no editor.
        </CardDescription>
        {searching && (working || progress.ready < progress.total) && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
            <Spinner className="size-3.5" />
            {working
              ? `Clonando ${progress.running} ${progress.running === 1 ? "página" : "páginas"}…`
              : "Procurando as próximas páginas…"}
          </p>
        )}
      </CardHeader>
      <CardContent className="px-4">
        {/* No computador as etapas ficam lado a lado e o mapa rola para o lado dentro do cartão. */}
        <ol className="flex flex-col sm:flex-row sm:items-stretch sm:overflow-x-auto sm:pb-2">
          {levels.map((level, i) => (
            <li key={level.depth} className="flex min-w-0 flex-col sm:shrink-0 sm:flex-row">
              {i > 0 && <Arrow text={level.arrow} />}
              <div className="flex min-w-0 flex-col gap-2 sm:w-60 sm:shrink-0">
                <p className="text-xs font-medium text-muted-foreground">Etapa {i + 1}</p>
                {level.pages.map((node) => (
                  <PageCard key={node.id} node={node} props={props} />
                ))}
                {level.products.length > 0 && <ProductsGroup products={level.products} props={props} />}
              </div>
            </li>
          ))}
          {checkoutPlatforms.length > 0 && (
            <li className="flex min-w-0 flex-col sm:shrink-0 sm:flex-row">
              <Arrow text="Botões de compra" />
              <div className="flex min-w-0 flex-col gap-2 sm:w-52 sm:shrink-0">
                <p className="text-xs font-medium text-muted-foreground">Checkout</p>
                <div className="flex items-start gap-2 rounded-lg border border-dashed px-3 py-2.5 text-xs">
                  <ShoppingCartIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <p>
                    <span className="font-medium">{platforms.length ? platforms.join(", ") : "Checkout"}</span> — fica
                    no site da plataforma e não é clonado. Depois de salvar, troque pelos seus links de uma vez na aba
                    “Links e checkouts” da oferta.
                  </p>
                </div>
              </div>
            </li>
          )}
        </ol>
      </CardContent>
    </Card>
  );
}
