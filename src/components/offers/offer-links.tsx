"use client";

import { CheckIcon, LinkIcon, PlusIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { plural } from "@/lib/format";
import { linkUrlHint, linkUrlProblem, normalizeLinkUrl } from "@/lib/link-url";
import { createOfferLinkAction, deleteOfferLinkAction, updateOfferLinkAction } from "@/server/actions/offer-links";

type Kind = "CHECKOUT" | "UPSELL" | "DOWNSELL" | "WHATSAPP" | "OTHER";
const KIND_LABEL: Record<Kind, string> = {
  CHECKOUT: "Checkout",
  UPSELL: "Checkout do upsell",
  DOWNSELL: "Checkout do downsell",
  WHATSAPP: "WhatsApp",
  OTHER: "Outro",
};

export interface OfferLinkRow {
  id: string;
  key: string;
  label: string;
  url: string;
  kind: Kind;
  usage: number;
}

/**
 * Texto da confirmação de exclusão. Ao excluir, a URL atual é gravada em cada
 * botão ligado (deleteOfferLink); sem URL, eles voltam ao endereço de antes.
 */
export function deleteDescription(link: Pick<OfferLinkRow, "usage" | "url">) {
  if (!link.usage) return "Nenhum botão usa este link.";
  const many = link.usage > 1;
  if (link.url) {
    return `${plural(link.usage, "botão continua", "botões continuam")} levando para ${link.url}, mas deixa${many ? "m" : ""} de acompanhar as mudanças deste link.`;
  }
  return `Este link está sem URL: ${plural(link.usage, "botão ligado a ele volta", "botões ligados a ele voltam")} para o endereço que tinha${many ? "m" : ""} antes de ser${many ? "em" : ""} ligado${many ? "s" : ""}.`;
}

/** Exemplo curto de endereço para o tipo do link (cabe no campo sem cortar). */
function urlPlaceholder(kind: Kind) {
  return kind === "WHATSAPP" ? "https://wa.me/5511999999999" : "https://pay.hotmart.com/…";
}

/** Aviso que não bloqueia (checkout sem o código do produto…). */
function UrlHint({ url }: { url: string }) {
  const hint = linkUrlHint(url);
  if (!hint) return null;
  return (
    <p className="flex items-start gap-1.5 text-xs text-warning-foreground dark:text-warning">
      <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      {hint}
    </p>
  );
}

/** Erro do endereço antes de mandar (o mesmo texto da ação). */
function urlError(url: string) {
  return linkUrlProblem(normalizeLinkUrl(url));
}

function LinkRow({ link }: { link: OfferLinkRow }) {
  const [url, setUrl] = useState(link.url);
  const [label, setLabel] = useState(link.label);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const update = useAction(updateOfferLinkAction);
  const remove = useAction(deleteOfferLinkAction);

  useEffect(() => {
    setUrl(link.url);
    setLabel(link.label);
  }, [link.url, link.label]);

  const dirty = url.trim() !== link.url || label.trim() !== link.label;
  useUnsavedChanges(dirty);

  function save() {
    if (!dirty) return;
    const problem = urlError(url);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    void update.run(
      { id: link.id, url: url.trim(), label: label.trim() },
      { success: "Link salvo. Todos os botões ligados a ele foram atualizados.", silentError: true, onError: setError },
    );
  }

  return (
    <li className="flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={save}
          maxLength={60}
          aria-label="Nome do link"
          className="h-8 max-w-xs font-medium"
        />
        <Select
          value={link.kind}
          onValueChange={(v) => void update.run({ id: link.id, kind: v as Kind }, { success: "Tipo atualizado." })}
        >
          <SelectTrigger size="sm" className="w-48" aria-label="Tipo do link">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
              <SelectItem key={k} value={k}>
                {KIND_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant={link.usage ? "secondary" : "outline"}>
          {link.usage ? plural(link.usage, "botão ligado", "botões ligados") : "Nenhum botão ligado"}
        </Badge>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-label={`Excluir o link ${link.label}`}
          onClick={() => setDeleting(true)}
        >
          <Trash2Icon />
        </Button>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        noValidate
      >
        <Input
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
          placeholder={urlPlaceholder(link.kind)}
          aria-label={`URL do link ${link.label}`}
          aria-invalid={Boolean(error)}
          className="font-mono text-xs"
        />
        <Button type="submit" variant={dirty ? "default" : "outline"} disabled={!dirty || update.pending}>
          {update.pending ? <Spinner /> : <CheckIcon />}
          Salvar
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!error && !dirty && <UrlHint url={link.url} />}
      {!link.url && !error && (
        <p className="text-xs text-warning-foreground dark:text-warning">
          Sem URL ainda: os botões ligados a este link não levam a lugar nenhum.
        </p>
      )}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Excluir o link "${link.label}"?`}
        description={deleteDescription(link)}
        confirmLabel="Excluir link"
        destructive
        pending={remove.pending}
        onConfirm={() =>
          void remove.run({ id: link.id }, { success: "Link excluído.", onSuccess: () => setDeleting(false) })
        }
      />
    </li>
  );
}

/** Links da oferta: um lugar só para trocar o checkout de todas as páginas. */
export function OfferLinks({ offerId, links }: { offerId: string; links: OfferLinkRow[] }) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<Kind>("CHECKOUT");
  const [error, setError] = useState<string | null>(null);
  const create = useAction(createOfferLinkAction);
  const ids = useId();
  // Começou a preencher o link novo e não adicionou: a aba ganha o ponto e sair pergunta.
  useUnsavedChanges(Boolean(label.trim() || url.trim()));

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Cadastre aqui o checkout principal, os checkouts do upsell e do downsell, o WhatsApp… No editor, ligue os botões
        a esses links. Quando você trocar uma URL aqui,{" "}
        <strong className="text-foreground">todos os botões ligados a ela mudam em todas as páginas</strong>.
      </p>

      {links.length === 0 ? (
        <Empty className="border border-dashed py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LinkIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhum link ainda</EmptyTitle>
            <EmptyDescription>
              Cadastre o link do seu checkout aqui embaixo, em “Novo link”. Depois, no editor, clique no botão de compra
              e ligue-o a esse link.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border bg-card">
          {links.map((link) => (
            <LinkRow key={link.id} link={link} />
          ))}
        </ul>
      )}

      <form
        className="flex flex-col gap-3 rounded-xl border border-dashed p-4"
        aria-labelledby={`${ids}-title`}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!label.trim()) {
            setError("Dê um nome para o link, como “Checkout principal”.");
            return;
          }
          const problem = urlError(url);
          if (problem) {
            setError(problem);
            return;
          }
          void create.run(
            { offerId, label: label.trim(), url: url.trim(), kind },
            {
              success: "Link criado.",
              silentError: true,
              onError: setError,
              onSuccess: () => {
                setLabel("");
                setUrl("");
                setError(null);
              },
            },
          );
        }}
      >
        <span id={`${ids}-title`} className="text-sm font-medium">
          Novo link
        </span>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_12rem_minmax(0,1fr)_auto] sm:items-end">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={`${ids}-label`} className="text-xs text-muted-foreground">
              Nome
            </Label>
            <Input
              id={`${ids}-label`}
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                setError(null);
              }}
              placeholder="Checkout principal"
              aria-label="Nome do novo link"
              maxLength={60}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={`${ids}-kind`} className="text-xs text-muted-foreground">
              Tipo
            </Label>
            <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
              <SelectTrigger id={`${ids}-kind`} className="w-full" aria-label="Tipo do novo link">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {KIND_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={`${ids}-url`} className="text-xs text-muted-foreground">
              URL <span className="font-normal">(pode preencher depois)</span>
            </Label>
            <Input
              id={`${ids}-url`}
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
              }}
              placeholder={urlPlaceholder(kind)}
              aria-label="URL do novo link"
              inputMode="url"
              className="font-mono text-xs"
            />
          </div>
          <Button type="submit" disabled={create.pending}>
            {create.pending ? <Spinner /> : <PlusIcon />}
            Adicionar
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : (
          <UrlHint url={url} />
        )}
      </form>
    </div>
  );
}
