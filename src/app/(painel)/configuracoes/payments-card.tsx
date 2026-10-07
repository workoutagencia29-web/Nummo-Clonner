"use client";

import { KeyRoundIcon, LockIcon, PlugZapIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { useId, useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Callout } from "@/components/offers/tracking/callout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { dateTime } from "@/lib/format";
import type { ConnectionStatus } from "@/lib/payments/gateway";
import { CONNECTION_MESSAGE, type PaymentProviderId } from "@/lib/payments/rules";
import {
  removePaymentGatewayKeyAction,
  savePaymentGatewayKeyAction,
  testPaymentGatewayAction,
} from "@/server/actions/payments";

/** Gateway como a tela recebe (nunca a chave: só a dica mascarada). */
export interface PaymentGatewayRow {
  provider: PaymentProviderId;
  label: string;
  configured: boolean;
  keyHint: string | null;
  keyUnreadable: boolean;
  checkedAt: string | null;
  checkStatus: ConnectionStatus | null;
}

/** O que cada gateway cobra e onde achar a chave (texto curto para o painel). */
const GATEWAY_INFO: Record<PaymentProviderId, { methods: string; keyHelp: string; placeholder: string }> = {
  KYVO: {
    methods: "México (SPEI), cartão internacional, Bizum (Espanha) e MB WAY (Portugal).",
    keyHelp:
      "No painel da Kyvo, abra a parte de chaves da API (API keys) e crie uma chave com as permissões spei_charges:create, card_charges:create e transactions:read. Ela começa com kyvo_live_.",
    placeholder: "kyvo_live_…",
  },
};

function ConnectionLine({ status, checkedAt }: { status: ConnectionStatus; checkedAt: string }) {
  const ok = status === "ok";
  return (
    <Callout variant={ok ? "success" : "warning"} title={ok ? "Conexão funcionando" : "A conexão falhou"}>
      <span aria-live="polite">
        {CONNECTION_MESSAGE[status]} <span className="whitespace-nowrap">(teste de {dateTime(checkedAt)})</span>
      </span>
    </Callout>
  );
}

function GatewayBlock({ gateway }: { gateway: PaymentGatewayRow }) {
  const info = GATEWAY_INFO[gateway.provider];
  const id = useId();
  const [replacing, setReplacing] = useState(false);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const save = useAction(savePaymentGatewayKeyAction);
  const remove = useAction(removePaymentGatewayKeyAction);
  const test = useAction(testPaymentGatewayAction);
  // Resultado do teste que acabou de rodar (a tela recarrega os dados logo depois).
  const [lastTest, setLastTest] = useState<{ status: ConnectionStatus; checkedAt: string } | null>(null);
  const saved = gateway.configured && !gateway.keyUnreadable;
  const fromServer =
    gateway.checkStatus && gateway.checkedAt ? { status: gateway.checkStatus, checkedAt: gateway.checkedAt } : null;
  const shownTest = lastTest ?? fromServer;
  const editing = !saved || replacing;
  useUnsavedChanges(editing && Boolean(key.trim()));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim()) {
      setError(`Cole a chave da API da ${gateway.label}.`);
      return;
    }
    void save.run(
      { provider: gateway.provider, apiKey: key },
      {
        success: "Chave salva. Clique em “Testar conexão” para conferir.",
        silentError: true,
        onError: setError,
        onSuccess: () => {
          setKey("");
          setError(null);
          setReplacing(false);
          setLastTest(null);
        },
      },
    );
  }

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-4 rounded-xl border p-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 id={`${id}-title`} className="font-semibold">
            {gateway.label}
          </h3>
          <p className="text-sm text-muted-foreground">{info.methods}</p>
        </div>
        {!saved ? (
          <Badge variant="outline">Não configurado</Badge>
        ) : shownTest?.status === "invalid_key" ? (
          <Badge variant="destructive">Chave recusada</Badge>
        ) : shownTest?.status === "missing_scope" ? (
          <Badge variant="destructive">Sem permissão</Badge>
        ) : (
          <Badge variant="success">Chave configurada</Badge>
        )}
      </div>

      {gateway.keyUnreadable && (
        <Callout variant="warning">
          A chave salva não pode mais ser lida (a chave de segurança do Offer Studio mudou). Cole a chave de novo.
        </Callout>
      )}

      {saved && !replacing && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 px-3 py-2">
            <KeyRoundIcon className="size-4 text-success" aria-hidden="true" />
            <span className="text-sm font-medium">Chave da API</span>
            {gateway.keyHint && (
              <span className="font-mono text-xs text-muted-foreground" title="Só o final da chave aparece">
                {gateway.keyHint}
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
                    { provider: gateway.provider },
                    {
                      success: (r) => (r.status === "ok" ? `Conexão com a ${gateway.label} funcionando.` : ""),
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
          {shownTest && <ConnectionLine status={shownTest.status} checkedAt={shownTest.checkedAt} />}
        </div>
      )}

      {editing && (
        <form onSubmit={submit} noValidate className="flex flex-col gap-2">
          <Field data-invalid={Boolean(error)}>
            <FieldLabel htmlFor={`${id}-key`}>Chave da API da {gateway.label}</FieldLabel>
            <div className="flex flex-wrap gap-2">
              <Input
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
        </form>
      )}

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <LockIcon className="mt-0.5 size-3 shrink-0" aria-hidden="true" />A chave fica só neste Mac (guardada com
        criptografia, e no backup) e no pagamento.php da sua hospedagem quando você baixa o ZIP. Ela nunca vai para o
        HTML nem para o JavaScript das páginas, e não é mostrada de novo aqui.
      </p>

      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={`Remover a chave da ${gateway.label}?`}
        description="Os links de pagamento das ofertas continuam salvos, mas o ZIP não consegue cobrar sem uma chave. Você pode cadastrar outra quando quiser."
        confirmLabel="Remover chave"
        destructive
        pending={remove.pending}
        onConfirm={() =>
          void remove.run(
            { provider: gateway.provider },
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

/** Configurações → Pagamentos: a conta de cada gateway (chave da API e teste de conexão). */
export function PaymentsCard({ gateways }: { gateways: PaymentGatewayRow[] }) {
  return (
    <div className="flex flex-col gap-4">
      {gateways.map((g) => (
        <GatewayBlock key={g.provider} gateway={g} />
      ))}
    </div>
  );
}
