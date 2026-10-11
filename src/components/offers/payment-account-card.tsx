"use client";

import { CopyIcon, KeyRoundIcon, LockIcon, PlugZapIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Callout } from "@/components/offers/tracking/callout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { dateTime, plural } from "@/lib/format";
import type { ConnectionStatus, PaymentAccountView, PaymentKeySource } from "@/lib/payments/gateway";
import { connectionMessage, type PaymentProviderId } from "@/lib/payments/rules";
import { cn } from "@/lib/utils";
import {
  copyPaymentGatewayKeyAction,
  removePaymentGatewayKeyAction,
  savePaymentGatewayKeyAction,
  testPaymentGatewayAction,
} from "@/server/actions/payments";

/** id do cartão da Kyvo na aba "Links e checkouts" (âncora do "Abrir a conta da Kyvo"). */
export const PAYMENT_ACCOUNT_ID = "conta-pagamento";

/** id do cartão de cada gateway na aba "Links e checkouts". */
export const ACCOUNT_CARD_ID: Record<PaymentProviderId, string> = {
  KYVO: PAYMENT_ACCOUNT_ID,
  FLEVOPAY: "conta-flevopay",
  BLACKCAT: "conta-blackcat",
};

/** O que cada gateway cobra, onde a chave é usada e onde achá-la (texto curto para o painel). */
const GATEWAY_INFO: Record<
  PaymentProviderId,
  { title: string; usedBy: string; methods: string; keyHelp: string; placeholder: string }
> = {
  KYVO: {
    title: "Pagamento na página — conta da Kyvo desta oferta",
    usedBy:
      "Os links “Pagamento na página” e os checkouts do Offer Studio em peso, euro ou dólar desta oferta cobram nesta conta. Cada oferta pode usar uma conta diferente.",
    methods: "México (SPEI), cartão internacional, Bizum (Espanha) e MB WAY (Portugal).",
    keyHelp:
      "No painel da Kyvo, abra a parte de chaves da API (API keys) e crie uma chave com as permissões spei_charges:create, card_charges:create e transactions:read. Ela começa com kyvo_live_.",
    placeholder: "kyvo_live_…",
  },
  FLEVOPAY: {
    title: "Checkout do Offer Studio — conta da FlevoPay desta oferta",
    usedBy:
      "Os checkouts do Offer Studio desta oferta que usam a FlevoPay cobram nesta conta. Cada oferta pode usar uma conta diferente.",
    methods: "PIX no Brasil, em real.",
    keyHelp:
      "No painel da FlevoPay, copie a chave secreta da API (a da documentação para desenvolvedores) e cole aqui. Ela costuma começar com flevopay_.",
    placeholder: "flevopay_…",
  },
  BLACKCAT: {
    title: "Checkout do Offer Studio — conta da BlackCat desta oferta",
    usedBy:
      "Os checkouts do Offer Studio desta oferta que usam a BlackCat cobram nesta conta. Cada oferta pode usar uma conta diferente.",
    methods: "PIX no Brasil, em real (cartão não: só PIX pelo Offer Studio).",
    keyHelp: "No painel da BlackCat, abra a parte de chaves da API, copie a chave e cole aqui.",
    placeholder: "Chave da API da BlackCat",
  },
};

function ConnectionLine({
  provider,
  status,
  checkedAt,
}: {
  provider: PaymentProviderId;
  status: ConnectionStatus;
  checkedAt: string;
}) {
  const ok = status === "ok";
  return (
    <Callout variant={ok ? "success" : "warning"} title={ok ? "Conexão funcionando" : "A conexão falhou"}>
      <span aria-live="polite">
        {connectionMessage(provider, status)}{" "}
        <span className="whitespace-nowrap">(teste de {dateTime(checkedAt)})</span>
      </span>
    </Callout>
  );
}

/** "Usar a mesma chave de outra oferta": a chave é copiada no servidor (nunca passa por aqui). */
function CopyFromOffer({
  offerId,
  account,
  sources,
  onCopied,
}: {
  offerId: string;
  account: PaymentAccountView;
  sources: PaymentKeySource[];
  onCopied: () => void;
}) {
  const id = useId();
  const [from, setFrom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const copy = useAction(copyPaymentGatewayKeyAction);
  if (!sources.length) return null;
  return (
    <Field data-invalid={Boolean(error)} className="border-t pt-4">
      <FieldLabel htmlFor={`${id}-from`}>Ou use a mesma chave de outra oferta</FieldLabel>
      <div className="flex flex-wrap gap-2">
        <Select
          value={from}
          onValueChange={(v) => {
            setFrom(v);
            setError(null);
          }}
        >
          <SelectTrigger
            id={`${id}-from`}
            className="min-w-0 flex-1 basis-64"
            aria-label="Oferta de onde copiar a chave"
            aria-invalid={Boolean(error)}
          >
            <SelectValue placeholder="Escolha a oferta" />
          </SelectTrigger>
          <SelectContent>
            {sources.map((s) => (
              <SelectItem key={s.offerId} value={s.offerId}>
                {s.offerName} <span className="font-mono text-xs text-muted-foreground">{s.keyHint}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          disabled={copy.pending}
          onClick={() => {
            if (!from) {
              setError("Escolha a oferta de onde copiar a chave.");
              return;
            }
            void copy.run(
              { offerId, fromOfferId: from, provider: account.provider },
              {
                success: (r) => `Chave copiada de “${r.offerName}”. Clique em “Testar conexão” para conferir.`,
                silentError: true,
                onError: setError,
                onSuccess: () => {
                  setFrom("");
                  setError(null);
                  onCopied();
                },
              },
            );
          }}
        >
          {copy.pending ? <Spinner /> : <CopyIcon />}
          Usar esta chave
        </Button>
      </div>
      {error && <FieldError>{error}</FieldError>}
      <FieldDescription>
        Para cobrar na mesma conta da {account.label} de outra oferta. A chave é copiada aqui no Mac, sem aparecer na
        tela; depois, teste a conexão de novo.
      </FieldDescription>
    </Field>
  );
}

/**
 * Conta de um gateway desta oferta (aba "Links e checkouts"): "Pagamento na
 * página — conta da Kyvo desta oferta" e "Checkout do Offer Studio — conta da
 * FlevoPay/BlackCat desta oferta". A chave da API que os links DESTA oferta
 * usam (cada oferta pode cobrar numa conta diferente). Salvar, testar, trocar,
 * remover e usar a mesma chave de outra oferta. A tela só recebe o final
 * mascarado da chave.
 */
export function PaymentAccountCard({
  offerId,
  account,
  sources = [],
  focusSignal = 0,
  title,
}: {
  offerId: string;
  account: PaymentAccountView;
  /** Título no lugar do padrão (a Kyvo diz para que a conta é usada nesta oferta). */
  title?: string;
  /** Outras ofertas com chave salva ("Usar a mesma chave de outra oferta"). */
  sources?: PaymentKeySource[];
  /** Muda quando alguém pede para abrir o cartão (aviso do link, Próximos passos, ZIP): rola e põe o foco. */
  focusSignal?: number;
}) {
  const info = { ...GATEWAY_INFO[account.provider], ...(title ? { title } : {}) };
  const id = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [flash, setFlash] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const save = useAction(savePaymentGatewayKeyAction);
  const remove = useAction(removePaymentGatewayKeyAction);
  const test = useAction(testPaymentGatewayAction);
  // Resultado do teste que acabou de rodar (a tela recarrega os dados logo depois).
  const [lastTest, setLastTest] = useState<{ status: ConnectionStatus; checkedAt: string } | null>(null);
  const saved = account.configured && !account.keyUnreadable;
  const fromServer =
    account.checkStatus && account.checkedAt ? { status: account.checkStatus, checkedAt: account.checkedAt } : null;
  const shownTest = lastTest ?? fromServer;
  const editing = !saved || replacing;
  const others = sources.filter((s) => s.offerId !== offerId);
  // Ofertas que usam a mesma chave desta (cópias ou a mesma colada lá): o "Trocar chave" avisa.
  const sharedWith = saved ? others.filter((s) => s.sameKey) : [];
  // "Usar a mesma chave de outra oferta": nem a própria oferta, nem as que já têm esta mesma chave.
  const copySources = others.filter((s) => !(saved && s.sameKey));
  // "Trocar também nelas" (marcado por padrão: quem troca a chave da conta quer trocar em todas).
  const [alsoShared, setAlsoShared] = useState(true);
  useUnsavedChanges(editing && Boolean(key.trim()));

  useEffect(() => {
    if (!focusSignal) return;
    setFlash(true);
    const frame = requestAnimationFrame(() => {
      sectionRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      if (inputRef.current) inputRef.current.focus({ preventScroll: true });
      else sectionRef.current?.focus({ preventScroll: true });
    });
    const timer = setTimeout(() => setFlash(false), 4000);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [focusSignal]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim()) {
      setError(`Cole a chave da API da ${account.label}.`);
      return;
    }
    const alsoOfferIds = replacing && alsoShared ? sharedWith.map((s) => s.offerId) : [];
    void save.run(
      { offerId, provider: account.provider, apiKey: key, ...(alsoOfferIds.length ? { alsoOfferIds } : {}) },
      {
        success: (r) =>
          r?.alsoChanged
            ? `Chave trocada nesta oferta e em mais ${plural(r.alsoChanged, "oferta", "ofertas")}. Clique em “Testar conexão” para conferir.`
            : "Chave salva. Clique em “Testar conexão” para conferir.",
        silentError: true,
        onError: setError,
        onSuccess: () => {
          setKey("");
          setError(null);
          setReplacing(false);
          setAlsoShared(true);
          setLastTest(null);
        },
      },
    );
  }

  return (
    <section
      ref={sectionRef}
      id={ACCOUNT_CARD_ID[account.provider]}
      tabIndex={-1}
      aria-labelledby={`${id}-title`}
      data-highlight={flash || undefined}
      className={cn(
        "flex scroll-mt-20 flex-col gap-4 rounded-xl border bg-card p-4 outline-none transition-shadow md:scroll-mt-6",
        flash && "ring-2 ring-primary",
      )}
    >
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 id={`${id}-title`} className="font-semibold">
            {info.title}
          </h3>
          {!saved ? (
            <Badge variant="outline">Sem chave</Badge>
          ) : shownTest?.status === "invalid_key" ? (
            <Badge variant="destructive">Chave recusada</Badge>
          ) : shownTest?.status === "missing_scope" ? (
            <Badge variant="destructive">{account.provider === "KYVO" ? "Sem permissão" : "Conta não liberada"}</Badge>
          ) : (
            <Badge variant="success">Chave configurada</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{info.usedBy}</p>
        <p className="text-sm text-muted-foreground">{info.methods}</p>
      </div>

      {account.keyUnreadable && (
        <Callout variant="warning">
          A chave salva não pode mais ser lida (a chave de segurança do Offer Studio mudou). Cole a chave de novo.
        </Callout>
      )}

      {saved && !replacing && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 px-3 py-2">
            <KeyRoundIcon className="size-4 text-success" aria-hidden="true" />
            <span className="text-sm font-medium">Chave da API</span>
            {account.keyHint && (
              <span className="font-mono text-xs text-muted-foreground" title="Só o final da chave aparece">
                {account.keyHint}
              </span>
            )}
            <div className="ml-auto flex flex-wrap gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={test.pending}
                onClick={() =>
                  void test.run(
                    { offerId, provider: account.provider },
                    {
                      success: (r) => (r.status === "ok" ? `Conexão com a ${account.label} funcionando.` : ""),
                      onSuccess: (r) => setLastTest({ status: r.status, checkedAt: r.checkedAt }),
                    },
                  )
                }
              >
                {test.pending ? <Spinner /> : <PlugZapIcon />}
                Testar conexão
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setReplacing(true)}>
                <RefreshCwIcon />
                Trocar chave
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setRemoving(true)}>
                <Trash2Icon />
                Remover
              </Button>
            </div>
          </div>
          {sharedWith.length > 0 && (
            <p className="text-sm text-muted-foreground">
              A mesma chave também está em: {sharedWith.map((s) => `“${s.offerName}”`).join(", ")}.
            </p>
          )}
          {shownTest ? (
            <ConnectionLine provider={account.provider} status={shownTest.status} checkedAt={shownTest.checkedAt} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Ainda não testada nesta oferta: clique em “Testar conexão” para conferir a chave (nada é cobrado).
            </p>
          )}
        </div>
      )}

      {editing && (
        <form onSubmit={submit} noValidate className="flex flex-col gap-2">
          <Field data-invalid={Boolean(error)}>
            <FieldLabel htmlFor={`${id}-key`}>Chave da API da {account.label}</FieldLabel>
            <div className="flex flex-wrap gap-2">
              <Input
                ref={inputRef}
                id={`${id}-key`}
                type="password"
                value={key}
                autoComplete="new-password"
                spellCheck={false}
                placeholder={info.placeholder}
                className="min-w-0 flex-1 basis-64 font-mono"
                aria-invalid={Boolean(error)}
                onChange={(e) => {
                  setKey(e.target.value);
                  setError(null);
                }}
              />
              <Button type="submit" disabled={save.pending}>
                {save.pending && <Spinner />}
                Salvar chave
              </Button>
              {replacing && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setReplacing(false);
                    setAlsoShared(true);
                    setKey("");
                    setError(null);
                  }}
                >
                  Cancelar troca
                </Button>
              )}
            </div>
            {error && <FieldError>{error}</FieldError>}
            <FieldDescription>{info.keyHelp}</FieldDescription>
          </Field>
          {replacing && sharedWith.length > 0 && (
            <Callout
              variant="warning"
              title={
                sharedWith.length === 1
                  ? "Outra oferta usa esta mesma chave"
                  : `${sharedWith.length} outras ofertas usam esta mesma chave`
              }
            >
              <span className="flex flex-col gap-2">
                <span>
                  {sharedWith.map((s) => `“${s.offerName}”`).join(", ")}. Se você trocar só aqui,{" "}
                  {sharedWith.length === 1 ? "ela continua" : "elas continuam"} com a chave antiga (e, se você desativou
                  a antiga na {account.label}, o pagamento {sharedWith.length === 1 ? "dela" : "delas"} para de
                  funcionar).
                </span>
                <span className="flex items-center gap-2">
                  <Checkbox id={`${id}-also`} checked={alsoShared} onCheckedChange={(v) => setAlsoShared(v === true)} />
                  <Label htmlFor={`${id}-also`} className="font-normal">
                    {sharedWith.length === 1 ? "Trocar também nela" : "Trocar também nelas"}
                  </Label>
                </span>
              </span>
            </Callout>
          )}
        </form>
      )}

      {editing && (
        <CopyFromOffer
          offerId={offerId}
          account={account}
          sources={copySources}
          onCopied={() => {
            setKey("");
            setError(null);
            setReplacing(false);
            setLastTest(null);
          }}
        />
      )}

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <LockIcon className="mt-0.5 size-3 shrink-0" aria-hidden="true" />A chave fica só neste Mac (guardada com
        criptografia, e no backup) e no pagamento.php da hospedagem desta oferta quando você baixa o ZIP. Ela nunca vai
        para o HTML nem para o JavaScript das páginas, e não é mostrada de novo aqui.
      </p>

      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={`Remover a chave da ${account.label} desta oferta?`}
        description={
          account.provider === "KYVO"
            ? "Os links de pagamento desta oferta continuam salvos, mas o ZIP não consegue cobrar sem uma chave. As outras ofertas não mudam. Você pode cadastrar outra quando quiser."
            : `Os checkouts desta oferta com a ${account.label} continuam salvos, mas o ZIP não consegue cobrar sem uma chave. As outras ofertas não mudam. Você pode cadastrar outra quando quiser.`
        }
        confirmLabel="Remover chave"
        destructive
        pending={remove.pending}
        onConfirm={() =>
          void remove.run(
            { offerId, provider: account.provider },
            {
              success: "Chave removida.",
              onSuccess: () => {
                setRemoving(false);
                setLastTest(null);
              },
            },
          )
        }
      />
    </section>
  );
}
