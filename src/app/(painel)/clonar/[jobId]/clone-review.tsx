"use client";

import {
  AlertTriangleIcon,
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  InfoIcon,
  PlusIcon,
  RotateCcwIcon,
  SaveIcon,
  ShieldOffIcon,
  ShoppingCartIcon,
  TimerOffIcon,
  VideoIcon,
  XIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { videoProviderLabel } from "@/detection/videos";
import { useAction } from "@/hooks/use-action";
import { formatBytes, plural } from "@/lib/format";
import { keptNeedsConsent } from "@/lib/tracking/code-trackers";
import {
  cancelCloneAction,
  clonePreviewUrlAction,
  saveCloneAction,
  startFunnelClonesAction,
} from "@/server/actions/clone";
import type { CloneStatus } from "@/server/services/clone";
import { IMPORT_HINT } from "@/worker/clone/protection";
import type { CloneModeValue, CloneResult, Device } from "@/worker/clone/types";
import { ClonePreview, type ReviewPreviews } from "./clone-preview";
import { funnelReasonText } from "./review-text";
import { useCloneStatus } from "./use-clone-status";

export type { ReviewPreviews };

const NO_FOLDER = "__none__";
const CATEGORY_LABEL: Record<string, string> = {
  PIXEL: "Pixel",
  ANALYTICS: "Análise",
  TAG_MANAGER: "Gerenciador de tags",
  CHAT: "Chat",
  ADS: "Anúncios",
  OTHER: "Outro",
};
const FUNNEL_LABEL = { UPSELL: "Upsell", DOWNSELL: "Downsell", THANK_YOU: "Obrigado", OTHER: "Página" } as const;
const KIND_LABEL: Record<string, string> = {
  "script-src": "script externo",
  "script-inline": "código na página",
  noscript: "bloco noscript",
  pixel: "pixel de imagem",
  meta: "meta tag",
  link: "pré-conexão",
  network: "bloqueado ao abrir a página",
};

function Section({
  icon: Icon,
  title,
  count,
  description,
  children,
}: {
  icon: typeof ShieldOffIcon;
  title: string;
  count?: number;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Icon className="size-4 text-muted-foreground" />
          {title}
          {count !== undefined && (
            <Badge variant="secondary" className="ml-auto">
              {count}
            </Badge>
          )}
        </CardTitle>
        {description && <CardDescription className="text-xs">{description}</CardDescription>}
      </CardHeader>
      <CardContent className="px-4">{children}</CardContent>
    </Card>
  );
}

type Child = CloneStatus["children"][number];

const isActive = (c: Child) => c.status !== "FAILED" && c.status !== "CANCELED";

/**
 * Uma linha por página do funil: quando a mesma página foi clonada de novo
 * (depois de falhar ou ser cancelada), vale a tentativa mais recente.
 */
function latestPerPage(children: Child[]) {
  const byKey = new Map<string, Child>();
  for (const c of children) {
    const key = c.matchKey ?? c.sourceUrl ?? c.id;
    const prev = byKey.get(key);
    // Uma tentativa ativa nunca é escondida por uma falha.
    if (!prev || isActive(c) || !isActive(prev)) byKey.set(key, c);
  }
  const shown = new Set(byKey.values());
  return children.filter((c) => shown.has(c));
}

/** Erro de uma página do funil sem a dica de importar (não existe importação no funil). */
function childError(message: string | null) {
  const text = (message ?? "")
    .replace(IMPORT_HINT, "")
    // Variações da dica (ex.: página com login): a frase que termina em "importe aqui".
    .replace(/[^.]*\bimporte aqui\.?/gi, "")
    .trim();
  return text || "Não foi possível clonar esta página.";
}

export function CloneReview({
  jobId,
  label,
  result,
  defaultName,
  previews,
  folders,
  initialChildren,
  funnelKeys,
  capturedDevices,
  offerDeleted = false,
  frozenTimer = false,
}: {
  jobId: string;
  label: string;
  result: CloneResult;
  /** Nome sugerido para a oferta (título da página ou nome do arquivo importado). */
  defaultName: string;
  previews: ReviewPreviews;
  folders: { id: string; name: string }[];
  initialChildren: CloneStatus["children"];
  /** Chave de comparação de cada sugestão de funil (url → chave), calculada no servidor. */
  funnelKeys: Record<string, string | null>;
  /** Versões pedidas na clonagem (desktop, celular ou as duas). */
  capturedDevices: Device[];
  /** A oferta criada desta clonagem foi excluída de vez: dá para salvar de novo. */
  offerDeleted?: boolean;
  /** A página tem um contador que depende dos scripts do site (no "Editável", fica parado). */
  frozenTimer?: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<CloneModeValue>(result.suggestedMode);
  const [keep, setKeep] = useState<Set<number>>(new Set());
  const [name, setName] = useState(defaultName.slice(0, 120));
  const [nameError, setNameError] = useState<string | null>(null);
  const [folderId, setFolderId] = useState(NO_FOLDER);
  const [funnelPick, setFunnelPick] = useState<Set<string>>(new Set());
  const [manualUrl, setManualUrl] = useState("");
  // Páginas do funil prontas entram na oferta, a não ser que você desmarque.
  const [excludedChildren, setExcludedChildren] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);

  const save = useAction(saveCloneAction);
  const startFunnel = useAction(startFunnelClonesAction);
  const openPreview = useAction(clonePreviewUrlAction);
  const cancelChild = useAction(cancelCloneAction);

  const initial = useMemo(
    () =>
      ({
        id: jobId,
        status: "REVIEW",
        progress: 100,
        step: null,
        errorMessage: null,
        offerId: null,
        logs: [],
        children: initialChildren,
      }) as CloneStatus,
    [jobId, initialChildren],
  );
  const [pollChildren, setPollChildren] = useState(
    initialChildren.some((c) => ["QUEUED", "RUNNING"].includes(c.status)),
  );
  const { status } = useCloneStatus(jobId, initial, pollChildren, 2000);
  const children = status?.children ?? initialChildren;
  // Páginas do funil pedidas agora que ainda não apareceram na lista contam como
  // "em andamento" (senão daria para salvar antes de elas entrarem).
  const [expectedChildren, setExpectedChildren] = useState<string[]>([]);
  const missing = expectedChildren.filter((id) => !children.some((c) => c.id === id));
  const stillRunning = missing.length > 0 || children.some((c) => ["QUEUED", "RUNNING"].includes(c.status));
  if (pollChildren && !stillRunning && children.length) setPollChildren(false);
  const shownChildren = latestPerPage(children);
  const readyChildren = shownChildren.filter((c) => c.status === "REVIEW");
  const included = new Set(readyChildren.filter((c) => !excludedChildren.has(c.id)).map((c) => c.id));

  const screenshots: Partial<Record<Device, string>> = {};
  for (const d of ["desktop", "mobile"] as const) {
    const key = result.devices[d]?.screenshotKey;
    if (key) screenshots[d] = key;
  }
  // Sugestões já clonadas (ou em andamento). Páginas que falharam ou foram
  // canceladas podem ser marcadas de novo.
  const clonedKeys = new Set(
    children.filter(isActive).flatMap((c) => [c.matchKey, c.sourceUrl].filter((k): k is string => Boolean(k))),
  );
  const isCloned = (url: string) => clonedKeys.has(funnelKeys[url] ?? url) || clonedKeys.has(url);

  function toggleSet<T>(set: Set<T>, value: T, on: boolean) {
    const next = new Set(set);
    if (on) next.add(value);
    else next.delete(value);
    return next;
  }

  function queueFunnel(urls: string[], after?: () => void) {
    void startFunnel.run(
      { parentId: jobId, urls },
      {
        success: (r) =>
          r.created.length
            ? `${plural(r.created.length, "página entrou", "páginas entraram")} na fila.`
            : "Essas páginas já foram clonadas.",
        onSuccess: (r) => {
          setExpectedChildren((prev) => [...prev, ...r.created]);
          after?.();
          setPollChildren(true);
          router.refresh();
        },
      },
    );
  }

  function cloneFunnel() {
    const urls = [...funnelPick].filter((u) => !isCloned(u));
    if (manualUrl.trim()) urls.push(manualUrl.trim());
    if (!urls.length) {
      toast.error("Marque uma página sugerida ou cole o link de uma página do funil.");
      return;
    }
    queueFunnel(urls, () => {
      setFunnelPick(new Set());
      setManualUrl("");
    });
  }

  function retryChild(c: Child) {
    if (c.sourceUrl) queueFunnel([c.sourceUrl]);
  }

  function stopChild(c: Child) {
    void cancelChild.run(
      { id: c.id },
      {
        success: "Página do funil cancelada.",
        onSuccess: () => {
          setExpectedChildren((prev) => prev.filter((id) => id !== c.id));
          setPollChildren(true);
        },
      },
    );
  }

  function submit() {
    if (!name.trim()) {
      setNameError("Dê um nome para a oferta.");
      return;
    }
    void save.run(
      {
        jobId,
        name: name.trim(),
        folderId: folderId === NO_FOLDER ? null : folderId,
        mode,
        keepRemoved: [...keep].map((i) => `${jobId}:${i}`),
        childJobIds: readyChildren.filter((c) => included.has(c.id)).map((c) => c.id),
      },
      {
        success: "Oferta salva.",
        silentError: true,
        onError: (msg, field) => (field === "name" ? setNameError(msg) : toast.error(msg)),
        onSuccess: (offer) => router.push(`/ofertas/${offer.id}`),
      },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Revisar cópia</h1>
          <p className="mt-1 truncate text-sm text-muted-foreground" title={label}>
            {label}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline">
            {plural(result.stats.assets, "arquivo", "arquivos")} · {formatBytes(result.stats.bytes)}
          </Badge>
          <Badge variant="outline">
            {plural(result.removed.length, "rastreador removido", "rastreadores removidos")}
          </Badge>
          <Badge variant="outline">{plural(result.checkouts.length, "checkout", "checkouts")}</Badge>
          <Badge
            variant="outline"
            title={
              capturedDevices.length > 1 && result.responsive
                ? "Página responsiva: a mesma página se ajusta ao computador e ao celular"
                : undefined
            }
          >
            {capturedDevices.length === 1
              ? capturedDevices[0] === "desktop"
                ? "Só computador"
                : "Só celular"
              : result.responsive
                ? "Mesma página no celular"
                : "Computador e celular separados"}
          </Badge>
        </div>
      </div>

      {offerDeleted && (
        <p className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <InfoIcon className="mt-0.5 size-4 shrink-0" />A oferta criada desta clonagem foi excluída. Você pode salvar a
          cópia de novo como uma oferta nova.
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {frozenTimer && mode === "EDITABLE" && (
            <div
              role="note"
              className="flex flex-wrap items-start gap-3 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2.5 text-sm"
            >
              <TimerOffIcon className="mt-0.5 size-4 shrink-0 text-warning-foreground dark:text-warning" aria-hidden />
              <div className="min-w-0 flex-1 basis-64">
                <p className="font-medium">O contador regressivo vai ficar parado</p>
                <p className="mt-0.5 text-muted-foreground">
                  No modo Editável, os scripts do site original saem e o contador para no número que estava na tela — o
                  visitante percebe. Depois de salvar, troque-o pelo bloco “Contador regressivo” no editor (aba Blocos),
                  ou use o modo “Com scripts”.
                </p>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => setMode("PRESERVE_JS")}>
                Usar “Com scripts”
              </Button>
            </div>
          )}
          <ClonePreview
            previews={previews}
            screenshots={screenshots}
            mode={mode}
            onModeChange={setMode}
            suggestedMode={result.suggestedMode}
            hasDelay={Boolean(result.delay)}
          />
        </div>

        <aside className="flex flex-col gap-4">
          <Card className="gap-3 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">Salvar como oferta</CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <FieldGroup className="gap-4">
                <Field data-invalid={Boolean(nameError)}>
                  <FieldLabel htmlFor="clone-name">Nome da oferta</FieldLabel>
                  <Input
                    id="clone-name"
                    value={name}
                    maxLength={120}
                    aria-invalid={Boolean(nameError)}
                    onChange={(e) => {
                      setName(e.target.value);
                      setNameError(null);
                    }}
                  />
                  <FieldError>{nameError}</FieldError>
                </Field>
                <Field>
                  <FieldLabel htmlFor="clone-folder">Pasta</FieldLabel>
                  <Select value={folderId} onValueChange={setFolderId}>
                    <SelectTrigger id="clone-folder" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_FOLDER}>Sem pasta</SelectItem>
                      {folders.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <p className="text-xs text-muted-foreground">
                  Modo: <strong>{mode === "EDITABLE" ? "Editável" : "Com scripts"}</strong>
                  {readyChildren.length > 0 &&
                    ` · ${plural(1 + readyChildren.filter((c) => included.has(c.id)).length, "página", "páginas")} no funil`}
                </p>
                <Button onClick={submit} disabled={save.pending || stillRunning}>
                  {save.pending ? <Spinner /> : <SaveIcon />}
                  {stillRunning ? "Aguardando páginas do funil…" : "Salvar oferta"}
                </Button>
                {stillRunning && (
                  <p className="text-xs text-muted-foreground">
                    Não quer esperar? Cancele as páginas do funil que ainda estão na fila ou clonando.
                  </p>
                )}
              </FieldGroup>
            </CardContent>
          </Card>

          {result.warnings.length > 0 && (
            <Section icon={AlertTriangleIcon} title="Avisos" count={result.warnings.length}>
              <ul className="flex flex-col gap-2 text-xs">
                {result.warnings.map((w, i) => (
                  <li key={`${w.code}-${i}`} className="flex gap-2">
                    <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-warning" />
                    <span>{w.message}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section
            icon={ShieldOffIcon}
            title="Rastreadores e chats removidos"
            count={result.removed.length}
            description="Pixels, chats e scripts de análise do dono original. Marque só o que quiser manter."
          >
            {result.removed.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum rastreador encontrado.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {result.removed.map((item, i) => (
                  <li key={`${item.vendor}-${item.pixelId ?? ""}-${i}`} className="flex items-start gap-2 text-xs">
                    {item.snippet ? (
                      <Checkbox
                        id={`keep-${i}`}
                        className="mt-0.5"
                        checked={keep.has(i)}
                        onCheckedChange={(v) => setKeep((prev) => toggleSet(prev, i, v === true))}
                        aria-label={`Manter ${item.vendor}`}
                      />
                    ) : (
                      <span className="mt-0.5 size-4 shrink-0" />
                    )}
                    <Label htmlFor={`keep-${i}`} className="block min-w-0 font-normal text-xs leading-snug">
                      <span className="font-medium">{item.vendor}</span>
                      {item.pixelId && <span className="text-muted-foreground"> · {item.pixelId}</span>}
                      <span className="block text-muted-foreground">
                        {CATEGORY_LABEL[item.category] ?? item.category}
                        {KIND_LABEL[item.kind] ? ` · ${KIND_LABEL[item.kind]}` : ""}
                        {keep.has(i) &&
                          (keptNeedsConsent(item)
                            ? " · será mantido em “Códigos da página” (espera o “Aceitar” do aviso de cookies)"
                            : " · será mantido")}
                      </span>
                    </Label>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            icon={ShoppingCartIcon}
            title="Links de checkout"
            count={result.checkouts.length}
            description="Depois de salvar, troque todos pelos seus links de uma vez na aba “Links e checkouts” da oferta."
          >
            {result.checkouts.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum link de checkout encontrado.</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {result.checkouts.map((c) => (
                  <li key={c.url} className="flex items-start gap-2 text-xs">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <Badge variant={c.confidence >= 80 ? "secondary" : "outline"}>{c.platform}</Badge>
                        {c.occurrences > 1 && <span className="text-muted-foreground">{c.occurrences}×</span>}
                      </div>
                      {c.label && <p className="mt-1 truncate font-medium">{c.label}</p>}
                      <p className="truncate text-muted-foreground" title={c.url}>
                        {c.url}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Copiar link"
                      onClick={() => {
                        void navigator.clipboard.writeText(c.url).then(() => {
                          setCopied(c.url);
                          setTimeout(() => setCopied(null), 1500);
                        });
                      }}
                    >
                      {copied === c.url ? <CheckIcon /> : <CopyIcon />}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {result.videos.length > 0 && (
            <Section icon={VideoIcon} title="Vídeos" count={result.videos.length}>
              <ul className="flex flex-col gap-1.5 text-xs">
                {result.videos.map((v, i) => (
                  <li key={`${v.provider}-${v.videoId ?? i}`}>
                    <span className="font-medium">
                      {v.provider === "NATIVE"
                        ? v.downloaded === false
                          ? "Vídeo do site (não baixado: continua no site original)"
                          : v.downloaded
                            ? "Vídeo do site (baixado)"
                            : // Clonagens antigas não registravam se o vídeo foi baixado.
                              "Vídeo do site"
                        : videoProviderLabel(v)}
                    </span>
                    {v.videoId && <span className="text-muted-foreground"> · {v.videoId}</span>}
                    {v.thirdParty && (
                      <span className="block text-warning">
                        Vídeo de terceiros: depois de salvar, troque pelo seu no editor (botão “Editar” da página, na
                        oferta).
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {result.delay && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {result.delay.seconds > 0
                    ? `${plural(result.delay.elements, "elemento aparece", "elementos aparecem")} depois de ${result.delay.seconds} s de vídeo.`
                    : "Há elementos com delay, mas o tempo não foi encontrado."}
                </p>
              )}
            </Section>
          )}

          <Section
            icon={GitBranchIcon}
            title="Páginas do funil"
            count={result.funnel.length}
            description="Upsell, downsell e obrigado costumam ser configurados na plataforma de checkout. Se não aparecerem aqui, cole o link."
          >
            <div className="flex flex-col gap-3">
              {result.funnel.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {result.funnel.map((f) => {
                    const done = isCloned(f.url);
                    return (
                      <li key={f.url} className="flex items-start gap-2 text-xs">
                        <Checkbox
                          id={`funnel-${f.url}`}
                          className="mt-0.5"
                          disabled={done}
                          checked={done || funnelPick.has(f.url)}
                          onCheckedChange={(v) => setFunnelPick((prev) => toggleSet(prev, f.url, v === true))}
                        />
                        <Label
                          htmlFor={`funnel-${f.url}`}
                          className="block min-w-0 flex-1 font-normal text-xs leading-snug"
                        >
                          <span className="font-medium">{FUNNEL_LABEL[f.kind]}</span> · {f.label}
                          <span className="mt-0.5 block truncate text-muted-foreground" title={f.url}>
                            {f.url}
                          </span>
                          <span className="mt-0.5 block text-muted-foreground">
                            {funnelReasonText(f.reason, f.url)}
                          </span>
                        </Label>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="flex gap-2">
                <Input
                  placeholder="Link de outra página do funil"
                  value={manualUrl}
                  onChange={(e) => setManualUrl(e.target.value)}
                  className="h-8 text-xs"
                  aria-label="Link de outra página do funil"
                />
              </div>
              <Button variant="outline" size="sm" onClick={cloneFunnel} disabled={startFunnel.pending}>
                {startFunnel.pending ? <Spinner /> : <PlusIcon />}
                Clonar páginas selecionadas
              </Button>

              {shownChildren.length > 0 && (
                <ul className="flex flex-col gap-2 border-t pt-3">
                  {shownChildren.map((c) => (
                    <li key={c.id} className="flex flex-col gap-1 text-xs">
                      <div className="flex items-center gap-2">
                        {c.status === "REVIEW" && (
                          <Checkbox
                            checked={included.has(c.id)}
                            onCheckedChange={(v) => setExcludedChildren((prev) => toggleSet(prev, c.id, v !== true))}
                            aria-label={`Incluir ${c.title ?? c.sourceUrl ?? "página"} na oferta`}
                          />
                        )}
                        <span className="min-w-0 flex-1 truncate font-medium" title={c.sourceUrl ?? undefined}>
                          {c.title ?? c.sourceUrl}
                        </span>
                        {c.status === "REVIEW" && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Abrir prévia desta página"
                            disabled={openPreview.pending}
                            onClick={() =>
                              void openPreview.run(
                                // Clonagem só de celular não tem versão desktop.
                                { jobId: c.id, device: c.devices.includes("desktop") ? "desktop" : "mobile", mode },
                                { onSuccess: (r) => window.open(r.url, "_blank", "noopener") },
                              )
                            }
                          >
                            <ExternalLinkIcon />
                          </Button>
                        )}
                        {["QUEUED", "RUNNING"].includes(c.status) && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Cancelar ${c.title ?? c.sourceUrl ?? "página"}`}
                            title="Cancelar esta página"
                            disabled={cancelChild.pending}
                            onClick={() => stopChild(c)}
                          >
                            <XIcon />
                          </Button>
                        )}
                        {(c.status === "FAILED" || c.status === "CANCELED") && c.sourceUrl && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            aria-label={`Tentar de novo ${c.title ?? c.sourceUrl}`}
                            disabled={startFunnel.pending}
                            onClick={() => retryChild(c)}
                          >
                            <RotateCcwIcon />
                            Tentar de novo
                          </Button>
                        )}
                      </div>
                      {["QUEUED", "RUNNING"].includes(c.status) && (
                        <div className="flex items-center gap-2">
                          <Progress value={c.progress} className="h-1.5" />
                          <span className="shrink-0 text-muted-foreground">
                            {c.status === "QUEUED" ? "Na fila" : `${c.progress}%`}
                          </span>
                        </div>
                      )}
                      {c.status === "FAILED" && <span className="text-destructive">{childError(c.errorMessage)}</span>}
                      {c.status === "CANCELED" && <span className="text-muted-foreground">Cancelada</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Section>
        </aside>
      </div>
    </div>
  );
}
