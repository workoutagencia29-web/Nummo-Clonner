"use client";

/**
 * Avisos do "Antes de subir" com a solução ali mesmo: o endereço do site
 * (imagem de compartilhamento) e os dados da empresa ({{EMPRESA}}… nas
 * páginas legais). Salvou → a prévia do ZIP é refeita; com o ZIP pronto, o
 * botão já gera o ZIP de novo. Os do pagamento na página levam para onde se
 * resolve (Configurações → Pagamentos, o link na aba "Links e checkouts", a
 * página de obrigado no editor, os eventos dos pixels).
 */
import Link from "next/link";
import { useId, useState } from "react";
import { offerLinkHref } from "@/components/offers/offer-link-href";
import { COMPANY_FIELDS, COMPANY_MAX, companyEmailProblem } from "@/components/offers/settings/helpers";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";
import { type CompanyMarkerField, exportWarningFix } from "@/lib/export/warnings";
import { cn } from "@/lib/utils";
import { saveOfferSettingsAction } from "@/server/actions/offer-settings";
import { updateOfferAction } from "@/server/actions/offers";
import type { ExportController } from "./use-export-controller";

/** "meusite.com/oferta" → "https://meusite.com/oferta" (como em Detalhes). */
export function normalizeLiveUrl(value: string): string {
  const v = value.trim();
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

/** Depois de salvar: refaz a prévia (opções) ou gera o ZIP de novo (ZIP pronto). */
function afterSave(c: ExportController) {
  if (c.stage === "done") c.retry();
  else void c.reloadPlan();
}

function LiveUrlFix({ c }: { c: ExportController }) {
  const id = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = useAction(updateOfferAction);
  const busy = save.pending || c.generating;
  return (
    <form
      noValidate
      className="mt-2 flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim()) {
          setError("Cole o endereço do site, como https://seudominio.com.br/oferta.");
          return;
        }
        setError(null);
        void save.run(
          { id: c.offerId, liveUrl: normalizeLiveUrl(value) },
          {
            success: "Endereço do site salvo.",
            silentError: true,
            onError: (msg) => setError(msg),
            onSuccess: () => afterSave(c),
          },
        );
      }}
    >
      <Label htmlFor={id} className="text-foreground text-xs">
        Endereço do site (onde a oferta vai ficar no ar)
      </Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={id}
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder="https://seudominio.com.br/oferta"
          value={value}
          aria-invalid={Boolean(error)}
          className="h-8 bg-background sm:flex-1"
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
        />
        <Button type="submit" size="sm" disabled={busy}>
          {busy && <Spinner />}
          {c.stage === "done" ? "Salvar e gerar de novo" : "Salvar endereço"}
        </Button>
      </div>
      {error && <FieldError className="text-xs">{error}</FieldError>}
    </form>
  );
}

function CompanyFix({ c, fields }: { c: ExportController; fields: CompanyMarkerField[] }) {
  const ids = useId();
  const shown = COMPANY_FIELDS.filter((f) => fields.includes(f.key));
  const [values, setValues] = useState<Partial<Record<CompanyMarkerField, string>>>({});
  const [errors, setErrors] = useState<Partial<Record<CompanyMarkerField | "form", string>>>({});
  const save = useAction(saveOfferSettingsAction);
  const busy = save.pending || c.generating;
  return (
    <form
      noValidate
      className="mt-2 flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const filled = Object.fromEntries(
          shown.map((f) => [f.key, (values[f.key] ?? "").trim()]).filter(([, v]) => v),
        ) as Partial<Record<CompanyMarkerField, string>>;
        if (!Object.keys(filled).length) {
          setErrors({ [shown[0]?.key ?? "form"]: "Preencha pelo menos um dos campos." });
          return;
        }
        const emailProblem = companyEmailProblem(filled.email ?? "");
        if (emailProblem) {
          setErrors({ email: emailProblem });
          return;
        }
        setErrors({});
        void save.run(
          { offerId: c.offerId, company: filled },
          {
            success: "Dados da empresa salvos.",
            silentError: true,
            onError: (message, field) => {
              const key = field?.replace(/^company\./, "") as CompanyMarkerField | undefined;
              setErrors(key && shown.some((f) => f.key === key) ? { [key]: message } : { form: message });
            },
            onSuccess: () => afterSave(c),
          },
        );
      }}
    >
      <div className={cn("grid gap-2", shown.length > 1 && "sm:grid-cols-2")}>
        {shown.map((f) => {
          const id = `${ids}-${f.key}`;
          return (
            <div key={f.key} className={cn("flex min-w-0 flex-col gap-1", f.key === "name" && "sm:col-span-2")}>
              <Label htmlFor={id} className="text-foreground text-xs">
                {f.label}
              </Label>
              <Input
                id={id}
                value={values[f.key] ?? ""}
                maxLength={COMPANY_MAX[f.key]}
                placeholder={f.placeholder}
                type={f.key === "email" ? "email" : "text"}
                inputMode={f.key === "email" ? "email" : f.key === "phone" ? "tel" : undefined}
                autoComplete="off"
                aria-invalid={Boolean(errors[f.key])}
                className="h-8 bg-background"
                onChange={(e) => {
                  setValues((v) => ({ ...v, [f.key]: e.target.value }));
                  setErrors((x) => ({ ...x, [f.key]: undefined, form: undefined }));
                }}
              />
              {errors[f.key] && <FieldError className="text-xs">{errors[f.key]}</FieldError>}
            </div>
          );
        })}
      </div>
      {errors.form && <FieldError className="text-xs">{errors.form}</FieldError>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy && <Spinner />}
          {c.stage === "done" ? "Salvar e gerar de novo" : "Salvar dados da empresa"}
        </Button>
        <Link
          href={`/ofertas/${c.offerId}?aba=configuracoes`}
          className="text-primary text-xs underline-offset-4 hover:underline"
          onClick={() => c.setOpen(false)}
        >
          Ver todos os dados da empresa
        </Link>
      </div>
    </form>
  );
}

/** Um aviso do "Antes de subir" (com a solução, quando a tela sabe resolver). */
export function ExportWarning({ text, c }: { text: string; c: ExportController }) {
  const fix = exportWarningFix(text);
  return (
    <>
      {text}
      {fix?.kind === "liveUrl" && <LiveUrlFix c={c} />}
      {fix?.kind === "company" && <CompanyFix c={c} fields={fix.fields} />}
      {fix?.kind === "deadButtons" && <DeadButtonsFix c={c} quiz={fix.quiz ?? false} wheel={fix.wheel ?? false} />}
      {fix && (fix.kind === "paymentKey" || fix.kind === "purchaseRule") && (
        <FixLinks
          c={c}
          links={[
            fix.kind === "paymentKey"
              ? { href: "/configuracoes#pagamentos", label: "Abrir Configurações → Pagamentos" }
              : { href: `/ofertas/${c.offerId}?aba=rastreamento&secao=eventos`, label: "Abrir os eventos dos pixels" },
          ]}
        />
      )}
      {fix?.kind === "paymentLink" && <PaymentLinkFix c={c} text={text} />}
      {fix?.kind === "accessBlock" && <AccessBlockFix c={c} text={text} />}
    </>
  );
}

/** Botões que levam para onde o aviso se resolve (fecham o diálogo do ZIP). */
function FixLinks({ c, links }: { c: ExportController; links: { href: string; label: string }[] }) {
  if (!links.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {links.map((l) => (
        <Button key={l.href} size="sm" variant="outline" asChild>
          <Link href={l.href} onClick={() => c.setOpen(false)}>
            {l.label}
          </Link>
        </Button>
      ))}
    </div>
  );
}

/** Link de pagamento com algo faltando: abre o link na aba "Links e checkouts". */
function PaymentLinkFix({ c, text }: { c: ExportController; text: string }) {
  const all = c.plan.data?.paymentLinks ?? [];
  const named = all.filter((l) => text.includes(`“${l.label}”`));
  const links = (named.length ? named : all).slice(0, 4).map((l) => ({
    href: offerLinkHref(c.offerId, l.linkId),
    label: `Abrir o link “${l.label}”`,
  }));
  return (
    <FixLinks
      c={c}
      links={links.length ? links : [{ href: `/ofertas/${c.offerId}?aba=links`, label: "Abrir Links e checkouts" }]}
    />
  );
}

/** Página de obrigado sem o bloco "Acesso ao produto": abre no editor. */
function AccessBlockFix({ c, text }: { c: ExportController; text: string }) {
  const all = c.plan.data?.accessBlockPages ?? [];
  const named = all.filter((p) => text.includes(`“${p.name}”`));
  return (
    <FixLinks
      c={c}
      links={(named.length ? named : all).slice(0, 4).map((p) => ({
        href: `/editor/${p.documentId}`,
        label: `Abrir “${p.name}” no editor`,
      }))}
    />
  );
}

/**
 * Botão de compra sem link (lá, “Link da oferta” ou “Links e checkouts”), botão
 * final do quiz sem destino (Configurações do quiz) ou roleta com prêmio sem
 * link / "Resgatar" sem destino (Configurações da roleta): abre a página no editor.
 */
function DeadButtonsFix({ c, quiz, wheel }: { c: ExportController; quiz: boolean; wheel: boolean }) {
  const pages = (c.plan.data?.deadButtonPages ?? []).filter((p) => (quiz ? p.quiz : wheel ? p.wheel : p.buy !== false));
  if (!pages.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {pages.slice(0, 4).map((p) => (
        <Button key={p.documentId} size="sm" variant="outline" asChild>
          <Link href={`/editor/${p.documentId}`} onClick={() => c.setOpen(false)}>
            Abrir “{p.name}” no editor
          </Link>
        </Button>
      ))}
    </div>
  );
}
