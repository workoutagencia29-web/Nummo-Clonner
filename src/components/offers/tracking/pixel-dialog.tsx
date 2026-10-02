"use client";

/**
 * "Adicionar pixel" (escolher a plataforma → ID → opções) e "Editar pixel".
 *
 * O ID é conferido enquanto a pessoa digita (dá para colar o código inteiro do
 * pixel: o ID é achado nele). O token da API de Conversões / Events API nunca
 * volta para a tela: só "configurado", o final mascarado e trocar/remover.
 */
import {
  ArrowLeftIcon,
  CircleCheckIcon,
  KeyRoundIcon,
  LockIcon,
  RefreshCwIcon,
  ServerIcon,
  Trash2Icon,
} from "lucide-react";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";
import { checkConversionLabel, checkPixelId } from "@/lib/tracking/ids";
import {
  isServerApiVendor,
  PIXEL_ID_RULES,
  PIXEL_VENDOR_LABEL,
  PIXEL_VENDORS,
  type PixelVendorId,
  RULE_EVENTS,
  type RuleEventId,
  SERVER_API_VENDORS,
} from "@/lib/tracking/schema";
import { PIXEL_ID_HELP } from "@/lib/tracking/vendors";
import { cn } from "@/lib/utils";
import {
  createPixelAction,
  removePixelTokenAction,
  setPixelTokenAction,
  updatePixelAction,
} from "@/server/actions/tracking";
import type { PixelView } from "@/server/services/tracking";
import { Callout } from "./callout";
import { SwitchRow } from "./form-kit";
import { eventParts } from "./helpers";
import { VENDOR_VISUAL, VendorIcon } from "./vendor-icon";

export type PixelDialogMode = { kind: "create"; vendor?: PixelVendorId } | { kind: "edit"; pixel: PixelView };

/** Onde gerar o token e o código de teste do envio pelo servidor. */
const SERVER_API_HELP: Record<"META" | "TIKTOK", { token: string; testCode: string }> = {
  META: {
    token:
      "Gerenciador de Eventos → seu pixel → Configurações → API de Conversões → “Gerar token de acesso”. Copie o token inteiro.",
    testCode:
      "Opcional. Em Gerenciador de Eventos → Testar eventos, copie o código (ex.: TEST12345). Apague quando a oferta for ao ar.",
  },
  TIKTOK: {
    token: "TikTok Ads Manager → Ferramentas → Eventos → seu pixel → Configurações → “Gerar token de acesso”.",
    testCode:
      "Opcional. Em Eventos → seu pixel → Testar eventos, copie o código de teste. Apague quando a oferta for ao ar.",
  },
};

const TEST_CODE_RE = /^[A-Za-z0-9_-]{1,40}$/;

interface FormState {
  pixelId: string;
  label: string;
  serverApi: boolean;
  token: string;
  /** Com token salvo: "keep" mostra "configurado"; "replace" mostra o campo para colar outro. */
  tokenMode: "keep" | "replace";
  testEventCode: string;
  labels: Partial<Record<RuleEventId, string>>;
  utmsScript: boolean;
  preventSubids: boolean;
  preventXcodSck: boolean;
}

function initialState(mode: PixelDialogMode): FormState {
  if (mode.kind === "create") {
    return {
      pixelId: "",
      label: "",
      serverApi: false,
      token: "",
      tokenMode: "replace",
      testEventCode: "",
      labels: {},
      utmsScript: true,
      preventSubids: false,
      preventXcodSck: false,
    };
  }
  const p = mode.pixel;
  const options = p.options as Record<string, unknown>;
  return {
    pixelId: p.pixelId,
    label: p.label ?? "",
    serverApi: p.vendor === "META" ? options.capi === true : p.vendor === "TIKTOK" ? options.eventsApi === true : false,
    token: "",
    tokenMode: p.hasToken && !p.tokenUnreadable ? "keep" : "replace",
    testEventCode: p.testEventCode ?? "",
    labels:
      p.vendor === "GOOGLE_ADS" ? { ...(p.options.conversionLabels as Partial<Record<RuleEventId, string>>) } : {},
    utmsScript: p.vendor === "UTMIFY" ? p.options.utmsScript : true,
    preventSubids: p.vendor === "UTMIFY" ? p.options.preventSubids : false,
    preventXcodSck: p.vendor === "UTMIFY" ? p.options.preventXcodSck : false,
  };
}

function optionsFor(vendor: PixelVendorId, s: FormState, adsId: string): Record<string, unknown> {
  switch (vendor) {
    case "META":
      return { capi: s.serverApi };
    case "TIKTOK":
      return { eventsApi: s.serverApi };
    case "GOOGLE_ADS": {
      const labels: Record<string, string> = {};
      for (const [event, raw] of Object.entries(s.labels)) {
        const text = (raw ?? "").trim();
        if (!text) continue;
        const check = checkConversionLabel(text, adsId);
        labels[event] = check.ok ? check.label : text;
      }
      return { conversionLabels: labels };
    }
    case "UTMIFY":
      return { utmsScript: s.utmsScript, preventSubids: s.preventSubids, preventXcodSck: s.preventXcodSck };
    default:
      return {};
  }
}

type Errors = Record<string, string | undefined>;

export function PixelDialog({
  offerId,
  open,
  onOpenChange,
  mode,
}: {
  offerId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: PixelDialogMode;
}) {
  const editing = mode.kind === "edit" ? mode.pixel : null;
  const [vendor, setVendor] = useState<PixelVendorId | null>(null);
  const [state, setState] = useState<FormState>(() => initialState(mode));
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [confirmRemoveToken, setConfirmRemoveToken] = useState(false);
  /** O token foi removido agora (a lista só atualiza depois). */
  const [tokenRemoved, setTokenRemoved] = useState(false);
  const create = useAction(createPixelAction);
  const update = useAction(updatePixelAction);
  const saveToken = useAction(setPixelTokenAction);
  const removeToken = useAction(removePixelTokenAction);
  const pending = create.pending || update.pending || saveToken.pending;
  const ids = useId();

  // Cada vez que abre, começa do zero (ou do pixel que está sendo editado).
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setVendor(mode.kind === "edit" ? mode.pixel.vendor : (mode.vendor ?? null));
      setState(initialState(mode));
      setTouched({});
      setSubmitted(false);
      setErrors({});
      setTokenRemoved(false);
    }
  }

  /** Escolher (ou trocar) a plataforma começa o formulário do zero. */
  function pickVendor(next: PixelVendorId) {
    setVendor(next);
    setState(initialState(mode));
    setTouched({});
    setSubmitted(false);
    setErrors({});
  }

  const idCheck = useMemo(() => (vendor ? checkPixelId(vendor, state.pixelId) : null), [vendor, state.pixelId]);
  const normalizedId = idCheck?.ok ? idCheck.id : "";
  const serverApi = vendor && isServerApiVendor(vendor) ? SERVER_API_VENDORS[vendor] : null;

  function set<K extends keyof FormState>(key: K, value: FormState[K], errorKey: string = key) {
    setState((s) => ({ ...s, [key]: value }));
    setErrors((e) => ({ ...e, [errorKey]: undefined }));
  }

  function labelProblem(event: RuleEventId): string | null {
    const text = (state.labels[event] ?? "").trim();
    if (!text) return null;
    const check = checkConversionLabel(text, normalizedId || undefined);
    return check.ok ? null : check.message;
  }

  /** Erros de conferência local (os do servidor chegam em `errors`). */
  function localErrors(): Errors {
    const found: Errors = {};
    if (!vendor) return found;
    if (idCheck && !idCheck.ok) found.pixelId = idCheck.message;
    if (state.label.trim().length > 60) found.label = "O apelido do pixel pode ter no máximo 60 caracteres.";
    if (vendor === "GOOGLE_ADS") {
      for (const event of RULE_EVENTS) {
        const problem = labelProblem(event);
        if (problem) found[`options.conversionLabels.${event}`] = problem;
      }
    }
    if (serverApi && state.serverApi) {
      const code = state.testEventCode.trim();
      if (code && !TEST_CODE_RE.test(code)) {
        found.testEventCode = "O código de teste tem só letras e números (ex.: TEST12345).";
      }
      const token = state.token.trim();
      if (token && /\s/.test(token)) {
        found.accessToken = "O token não pode ter espaços nem quebras de linha. Copie de novo.";
      }
    }
    return found;
  }

  const live = localErrors();
  const show = (key: string) => errors[key] ?? (submitted || touched[key] ? live[key] : undefined);

  function fail(message: string, field?: string) {
    const known =
      field !== undefined &&
      (["pixelId", "label", "accessToken", "testEventCode"].includes(field) ||
        field.startsWith("options.conversionLabels."));
    if (known) setErrors((e) => ({ ...e, [field]: message }));
    else toast.error(message);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!vendor) return;
    setSubmitted(true);
    const found = localErrors();
    if (Object.values(found).some(Boolean)) {
      setErrors({});
      return;
    }
    const withServer = Boolean(serverApi && state.serverApi);
    const token = withServer && state.tokenMode === "replace" ? state.token.trim() : "";
    const common = {
      pixelId: normalizedId,
      label: state.label.trim() || null,
      options: optionsFor(vendor, state, normalizedId),
      ...(serverApi ? { testEventCode: withServer ? state.testEventCode.trim() || null : null } : {}),
    };
    const short = VENDOR_VISUAL[vendor].short;

    if (!editing) {
      await create.run(
        { offerId, vendor, ...common, accessToken: token || null },
        {
          silentError: true,
          onError: fail,
          success: `Pixel ${short} adicionado.`,
          onSuccess: () => onOpenChange(false),
        },
      );
      return;
    }

    const updated = await update.run({ id: editing.id, ...common }, { silentError: true, onError: fail });
    if (!updated.ok) return;
    if (token) {
      const saved = await saveToken.run({ id: editing.id, token }, { silentError: true, onError: fail });
      if (!saved.ok) {
        toast.error("O pixel foi salvo, mas o token não. Confira o token e salve de novo.");
        return;
      }
    }
    toast.success(`Pixel ${short} atualizado.`);
    onOpenChange(false);
  }

  const title = editing ? `Editar pixel ${VENDOR_VISUAL[editing.vendor].short}` : "Adicionar pixel";
  const idFieldId = `${ids}-id`;

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {vendor
              ? "Os eventos desta oferta vão para este pixel em todas as páginas."
              : "Escolha a plataforma. Você pode ter mais de um pixel da mesma plataforma."}
          </DialogDescription>
        </DialogHeader>

        {!vendor ? (
          <PlatformGrid onPick={pickVendor} />
        ) : (
          <form id={`${ids}-form`} noValidate onSubmit={submit} className="flex flex-col gap-6">
            <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
              <VendorIcon vendor={vendor} />
              <div className="min-w-0 flex-1">
                <p className="font-medium leading-tight">{PIXEL_VENDOR_LABEL[vendor]}</p>
                <p className="text-xs text-muted-foreground">{VENDOR_VISUAL[vendor].about}</p>
              </div>
              {!editing && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setVendor(null)} disabled={pending}>
                  <ArrowLeftIcon />
                  Trocar plataforma
                </Button>
              )}
            </div>

            <FieldGroup className="gap-5">
              <Field data-invalid={Boolean(show("pixelId"))}>
                <FieldLabel htmlFor={idFieldId}>ID do pixel</FieldLabel>
                <div className="relative">
                  <Input
                    id={idFieldId}
                    value={state.pixelId}
                    autoFocus
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={`Ex.: ${PIXEL_ID_RULES[vendor].example}`}
                    aria-invalid={Boolean(show("pixelId"))}
                    aria-describedby={`${idFieldId}-help`}
                    className="pr-9 font-mono"
                    onChange={(e) => set("pixelId", e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, pixelId: state.pixelId.trim() !== "" }))}
                  />
                  {idCheck?.ok && (
                    <CircleCheckIcon
                      aria-hidden="true"
                      className="-translate-y-1/2 absolute top-1/2 right-3 size-4 text-success"
                    />
                  )}
                </div>
                <FieldDescription id={`${idFieldId}-help`}>
                  <span className="font-medium text-foreground">Onde encontrar:</span> {PIXEL_ID_HELP[vendor]} Pode
                  colar o código inteiro do pixel: o ID é encontrado nele.
                </FieldDescription>
                {idCheck?.ok && idCheck.id !== state.pixelId.trim() && (
                  <p className="text-sm text-success" aria-live="polite">
                    ID encontrado: <span className="font-mono">{idCheck.id}</span>
                  </p>
                )}
                <FieldError>{show("pixelId")}</FieldError>
              </Field>

              <Field data-invalid={Boolean(show("label"))}>
                <FieldLabel htmlFor={`${ids}-label`}>Apelido (opcional)</FieldLabel>
                <Input
                  id={`${ids}-label`}
                  value={state.label}
                  maxLength={60}
                  placeholder="Ex.: Conta de anúncios 2"
                  aria-invalid={Boolean(show("label"))}
                  onChange={(e) => set("label", e.target.value)}
                />
                <FieldDescription>Ajuda a diferenciar quando há mais de um pixel da mesma plataforma.</FieldDescription>
                <FieldError>{show("label")}</FieldError>
              </Field>

              {vendor === "GOOGLE_ADS" && (
                <ConversionLabels
                  labels={state.labels}
                  error={(event) => show(`options.conversionLabels.${event}`)}
                  onChange={(event, value) =>
                    set("labels", { ...state.labels, [event]: value }, `options.conversionLabels.${event}`)
                  }
                  onBlur={(event) => setTouched((t) => ({ ...t, [`options.conversionLabels.${event}`]: true }))}
                />
              )}

              {vendor === "UTMIFY" && (
                <div className="flex flex-col gap-4 rounded-lg border p-4">
                  <Callout title="A UTMify dispara os eventos sozinha">
                    O pixel dela manda PageView, ViewContent, InitiateCheckout e Lead para o pixel da Meta cadastrado no
                    painel da UTMify. Não cadastre esse mesmo pixel da Meta aqui também, ou os eventos contam duas
                    vezes.
                  </Callout>
                  <SwitchRow
                    label="Script de UTMs da UTMify"
                    description="Completa os links de checkout com as UTMs do anúncio, do jeito que a UTMify espera."
                    checked={state.utmsScript}
                    onCheckedChange={(v) => set("utmsScript", v)}
                  />
                  {state.utmsScript && (
                    <>
                      <SwitchRow
                        label="Não mexer nos subids"
                        description="Ligue só se a UTMify pedir (data-utmify-prevent-subids)."
                        checked={state.preventSubids}
                        onCheckedChange={(v) => set("preventSubids", v)}
                      />
                      <SwitchRow
                        label="Não preencher xcod e sck da Hotmart"
                        description="Ligue se você já preenche esses campos de outro jeito (data-utmify-prevent-xcod-sck)."
                        checked={state.preventXcodSck}
                        onCheckedChange={(v) => set("preventXcodSck", v)}
                      />
                    </>
                  )}
                </div>
              )}

              {serverApi && (vendor === "META" || vendor === "TIKTOK") && (
                <div className="flex flex-col gap-4 rounded-lg border p-4">
                  <SwitchRow
                    label={`Enviar também pela ${serverApi.label}`}
                    description="Além do pixel no navegador, os eventos saem pelo servidor. Recupera conversões que bloqueadores de anúncio e o iPhone escondem."
                    checked={state.serverApi}
                    onCheckedChange={(v) => set("serverApi", v)}
                  />
                  {state.serverApi && (
                    <>
                      <Callout variant="warning" icon={ServerIcon} title="Precisa de hospedagem com PHP">
                        A {serverApi.label} funciona quando a oferta estiver numa hospedagem com PHP (Hostinger,
                        HostGator, cPanel…): o ZIP leva o arquivo <strong>eventos.php</strong>, que envia os eventos
                        pelo servidor. <strong>O token nunca vai para o HTML da página</strong>: fica guardado
                        criptografado aqui no Offer Studio e só entra no eventos.php.
                      </Callout>
                      <TokenField
                        vendor={vendor}
                        apiLabel={serverApi.label}
                        pixel={
                          editing && tokenRemoved
                            ? { ...editing, hasToken: false, tokenHint: null, tokenUnreadable: false }
                            : editing
                        }
                        mode={state.tokenMode}
                        value={state.token}
                        error={show("accessToken")}
                        disabled={pending}
                        onChange={(v) => set("token", v, "accessToken")}
                        onModeChange={(m) => {
                          setState((s) => ({ ...s, tokenMode: m, token: "" }));
                          setErrors((e) => ({ ...e, accessToken: undefined }));
                        }}
                        onRemove={() => setConfirmRemoveToken(true)}
                      />
                      <Field data-invalid={Boolean(show("testEventCode"))}>
                        <FieldLabel htmlFor={`${ids}-test`}>Código de teste de eventos (opcional)</FieldLabel>
                        <Input
                          id={`${ids}-test`}
                          value={state.testEventCode}
                          maxLength={40}
                          autoComplete="off"
                          placeholder="Ex.: TEST12345"
                          className="font-mono sm:max-w-60"
                          aria-invalid={Boolean(show("testEventCode"))}
                          onChange={(e) => set("testEventCode", e.target.value)}
                          onBlur={() => setTouched((t) => ({ ...t, testEventCode: true }))}
                        />
                        <FieldDescription>{SERVER_API_HELP[vendor].testCode}</FieldDescription>
                        <FieldError>{show("testEventCode")}</FieldError>
                      </Field>
                    </>
                  )}
                </div>
              )}
            </FieldGroup>
          </form>
        )}

        {vendor && (
          <DialogFooter className="-mx-6 -mb-6 -bottom-6 sticky rounded-b-lg border-t bg-background px-6 py-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" form={`${ids}-form`} disabled={pending}>
              {pending && <Spinner />}
              {editing ? "Salvar pixel" : "Adicionar pixel"}
            </Button>
          </DialogFooter>
        )}

        {editing && (
          <ConfirmDialog
            open={confirmRemoveToken}
            onOpenChange={setConfirmRemoveToken}
            title="Remover o token?"
            description={`Sem o token, a ${serverApi?.label ?? "API"} deixa de funcionar para este pixel. O pixel no navegador continua funcionando.`}
            confirmLabel="Remover token"
            destructive
            pending={removeToken.pending}
            onConfirm={() =>
              void removeToken.run(
                { id: editing.id },
                {
                  success: "Token removido.",
                  onSuccess: () => {
                    setConfirmRemoveToken(false);
                    setTokenRemoved(true);
                    setState((s) => ({ ...s, tokenMode: "replace", token: "" }));
                  },
                },
              )
            }
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Grade de plataformas (primeiro passo de "Adicionar pixel"). */
export function PlatformGrid({ onPick, className }: { onPick: (vendor: PixelVendorId) => void; className?: string }) {
  return (
    <ul className={cn("grid gap-2 sm:grid-cols-2 lg:grid-cols-3", className)} aria-label="Plataformas">
      {PIXEL_VENDORS.map((v) => (
        <li key={v}>
          <button
            type="button"
            onClick={() => onPick(v)}
            className="flex h-full w-full items-center gap-3 rounded-lg border bg-card p-3 text-left shadow-xs outline-none transition-[border-color,box-shadow] hover:border-foreground/25 focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <VendorIcon vendor={v} />
            <span className="min-w-0">
              <span className="block font-medium text-sm leading-tight">{PIXEL_VENDOR_LABEL[v]}</span>
              <span className="block text-xs text-muted-foreground leading-snug">{VENDOR_VISUAL[v].about}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ConversionLabels({
  labels,
  error,
  onChange,
  onBlur,
}: {
  labels: Partial<Record<RuleEventId, string>>;
  error: (event: RuleEventId) => string | undefined;
  onChange: (event: RuleEventId, value: string) => void;
  onBlur: (event: RuleEventId) => void;
}) {
  const ids = useId();
  const count = RULE_EVENTS.filter((e) => (labels[e] ?? "").trim()).length;
  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border p-4">
      <legend className="px-1 font-medium text-sm">Rótulos de conversão</legend>
      <p className="text-sm text-muted-foreground">
        No Google Ads, cada conversão tem um rótulo (a parte depois da barra em <code>send_to</code>). Cole o rótulo —
        ou o send_to inteiro, como <code className="font-mono">AW-123456789/AbC-D_efG</code> — nos eventos que devem
        virar conversão. <strong className="text-foreground">Eventos sem rótulo não viram conversão.</strong>
      </p>
      {count === 0 && (
        <Callout variant="warning">
          Sem nenhum rótulo, o Google Ads só recebe as visitas (sem conversões). Preencha pelo menos a conversão
          principal, como Compra ou Lead.
        </Callout>
      )}
      <div className="grid gap-3">
        {RULE_EVENTS.map((event) => {
          const { title, code } = eventParts(event);
          const id = `${ids}-${event}`;
          const problem = error(event);
          return (
            <Field key={event} data-invalid={Boolean(problem)} className="gap-1.5">
              <div className="grid items-center gap-1.5 sm:grid-cols-[14rem_1fr] sm:gap-3">
                <FieldLabel htmlFor={id} className="font-normal">
                  {title} <span className="text-xs text-muted-foreground">({code})</span>
                </FieldLabel>
                <Input
                  id={id}
                  value={labels[event] ?? ""}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Sem conversão"
                  className="font-mono"
                  aria-invalid={Boolean(problem)}
                  onChange={(e) => onChange(event, e.target.value)}
                  onBlur={() => onBlur(event)}
                />
              </div>
              <FieldError className="sm:pl-[15rem]">{problem}</FieldError>
            </Field>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Token da API: campo de senha, ou "configurado" com trocar/remover. Nunca mostra o valor salvo. */
function TokenField({
  vendor,
  apiLabel,
  pixel,
  mode,
  value,
  error,
  disabled,
  onChange,
  onModeChange,
  onRemove,
}: {
  vendor: "META" | "TIKTOK";
  apiLabel: string;
  pixel: PixelView | null;
  mode: "keep" | "replace";
  value: string;
  error?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onModeChange: (mode: "keep" | "replace") => void;
  onRemove: () => void;
}) {
  const id = useId();
  const saved = Boolean(pixel?.hasToken && !pixel.tokenUnreadable);

  if (saved && mode === "keep") {
    return (
      <div className="flex flex-col gap-2">
        <span className="font-medium text-sm">Token de acesso da {apiLabel}</span>
        <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 px-3 py-2">
          <KeyRoundIcon className="size-4 text-success" aria-hidden="true" />
          <Badge variant="success">Token configurado</Badge>
          {pixel?.tokenHint && (
            <span className="font-mono text-xs text-muted-foreground" title="Só o final do token aparece">
              {pixel.tokenHint}
            </span>
          )}
          <div className="ml-auto flex gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onModeChange("replace")}
              disabled={disabled}
            >
              <RefreshCwIcon />
              Trocar token
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onRemove} disabled={disabled}>
              <Trash2Icon />
              Remover
            </Button>
          </div>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <LockIcon className="size-3" aria-hidden="true" />
          Por segurança, o token salvo não é mostrado de novo.
        </p>
      </div>
    );
  }

  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={id}>Token de acesso da {apiLabel}</FieldLabel>
      {pixel?.tokenUnreadable && (
        <Callout variant="warning">
          O token salvo não pode mais ser lido (a chave de segurança do Offer Studio mudou). Cole o token de novo.
        </Callout>
      )}
      <div className="flex gap-2">
        <Input
          id={id}
          type="password"
          value={value}
          autoComplete="new-password"
          spellCheck={false}
          placeholder={saved ? "Cole o token novo" : "Cole o token aqui"}
          className="font-mono"
          aria-invalid={Boolean(error)}
          onChange={(e) => onChange(e.target.value)}
        />
        {saved && (
          <Button type="button" variant="ghost" onClick={() => onModeChange("keep")} disabled={disabled}>
            Cancelar troca
          </Button>
        )}
      </div>
      <FieldDescription>
        {SERVER_API_HELP[vendor].token}
        {!saved && " Sem o token, o envio pelo servidor não funciona (o pixel no navegador continua)."}
      </FieldDescription>
      <FieldError>{error}</FieldError>
    </Field>
  );
}
