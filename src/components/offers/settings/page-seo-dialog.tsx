"use client";

/**
 * SEO de uma página (título, descrição, favicon, imagem de compartilhamento e
 * "aparecer no Google"). Campo vazio = usa o SEO padrão da oferta.
 *
 * Carrega sozinho pelo id da página: pode ser aberto da lista de páginas do
 * funil ou da aba "Empresa e SEO".
 *   <PageSeoDialog offerId={offerId} page={seoPage} onClose={() => setSeoPage(null)} />
 */
import { RotateCcwIcon } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { CharCount } from "@/components/offers/tracking/form-kit";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { getPageSeoAction, savePageSeoAction } from "@/server/actions/offer-settings";
import type { PageSeoDialogData } from "@/server/services/offer-settings";
import { assetSrcFromKey, ogImageDescription, SEO_LIMITS } from "./helpers";
import { ImageUploadField } from "./image-upload-field";
import { SearchPreview } from "./search-preview";

const INHERIT = "herdar";
const INDEX = "sim";
const NOINDEX = "nao";

interface Draft {
  title: string;
  description: string;
  faviconSrc: string | null;
  ogImageSrc: string | null;
  noindex: string;
}

type SeoField = "title" | "description" | "faviconKey" | "ogImageKey" | "noindex" | "form";

function draftFrom(data: PageSeoDialogData): Draft {
  return {
    title: data.seo.title,
    description: data.seo.description,
    faviconSrc: assetSrcFromKey(data.seo.faviconKey),
    ogImageSrc: assetSrcFromKey(data.seo.ogImageKey),
    noindex: data.seo.noindex === null ? INHERIT : data.seo.noindex ? NOINDEX : INDEX,
  };
}

export function PageSeoDialog({
  offerId,
  page,
  onClose,
}: {
  offerId: string;
  /** Página aberta (null = fechado). */
  page: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<PageSeoDialogData | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Página a que `data`/`loadError` se referem (evita mostrar a página anterior por um instante). */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<SeoField, string>>>({});
  const load = useAction(getPageSeoAction);
  const save = useAction(savePageSeoAction);
  const runLoad = load.run;
  const ids = useId();
  const pageId = page?.id ?? null;

  /** Busca o SEO da página (`stale()` = a resposta chegou tarde, outra página já foi aberta). */
  const fetchSeo = useCallback(
    (id: string, stale: () => boolean) => {
      setData(null);
      setDraft(null);
      setLoadError(null);
      setErrors({});
      void runLoad({ pageId: id }, { silentError: true }).then((res) => {
        if (stale()) return;
        setLoadedFor(id);
        if (!res.ok) {
          setLoadError(res.error);
          return;
        }
        setData(res.data);
        setDraft(draftFrom(res.data));
      });
    },
    [runLoad],
  );

  // Abriu (ou trocou de página): carrega o SEO dela.
  useEffect(() => {
    if (!pageId) return;
    let cancelled = false;
    fetchSeo(pageId, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [pageId, fetchSeo]);

  function change(changes: Partial<Draft>, field?: SeoField) {
    setDraft((d) => (d ? { ...d, ...changes } : d));
    if (field) setErrors((e) => ({ ...e, [field]: undefined, form: undefined }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!page || !data || !draft) return;
    setErrors({});
    const original = draftFrom(data);
    const input: Parameters<typeof savePageSeoAction>[0] = {
      pageId: page.id,
      title: draft.title.trim(),
      description: draft.description.trim(),
      noindex: draft.noindex === INHERIT ? null : draft.noindex === NOINDEX,
    };
    if (draft.faviconSrc !== original.faviconSrc) input.faviconKey = draft.faviconSrc;
    if (draft.ogImageSrc !== original.ogImageSrc) input.ogImageKey = draft.ogImageSrc;
    void save.run(input, {
      success: `SEO da página “${page.name}” salvo.`,
      silentError: true,
      onError: (message, field) => {
        const key = field as SeoField | undefined;
        if (key && ["title", "description", "faviconKey", "ogImageKey", "noindex"].includes(key)) {
          setErrors({ [key]: message });
        } else {
          setErrors({ form: message });
          toast.error(message);
        }
      },
      onSuccess: () => onClose(),
    });
  }

  const offerSeo = data?.offerSeo;
  /** O que a página já tem no HTML (fica publicado quando o SEO está vazio). */
  const own = data?.own;
  const offerFavicon = assetSrcFromKey(offerSeo?.faviconKey);
  const offerOgImage = assetSrcFromKey(offerSeo?.ogImageKey);
  const inheritIndexLabel = offerSeo?.noindex ? "não aparece no Google" : "pode aparecer no Google";
  const effectiveNoindex = draft
    ? draft.noindex === INHERIT
      ? Boolean(offerSeo?.noindex)
      : draft.noindex === NOINDEX
    : false;
  const ready = Boolean(draft && data && loadedFor === pageId);
  const customized =
    ready &&
    draft &&
    (draft.title || draft.description || draft.faviconSrc || draft.ogImageSrc || draft.noindex !== INHERIT);

  return (
    <Dialog open={page !== null} onOpenChange={(open) => !open && !save.pending && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>SEO da página “{page?.name ?? ""}”</DialogTitle>
          <DialogDescription>Campos vazios usam o SEO padrão da oferta (aba “Empresa e SEO”).</DialogDescription>
        </DialogHeader>

        {loadedFor === pageId && loadError ? (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
            <p className="text-sm">{loadError}</p>
            <Button variant="outline" size="sm" onClick={() => pageId && fetchSeo(pageId, () => false)}>
              <RotateCcwIcon />
              Tentar de novo
            </Button>
          </div>
        ) : !ready || !draft ? (
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]" aria-busy="true">
            <span className="sr-only">Carregando SEO da página…</span>
            <div className="flex flex-col gap-4">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-20 w-full" />
              <div className="flex gap-4">
                <Skeleton className="size-16" />
                <Skeleton className="h-16 w-48" />
              </div>
            </div>
            <Skeleton className="h-36 w-full" />
          </div>
        ) : (
          <form
            id={`${ids}-form`}
            noValidate
            onSubmit={submit}
            className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]"
          >
            <div className="flex flex-col gap-5">
              <Field data-invalid={Boolean(errors.title)}>
                <div className="flex items-center justify-between gap-2">
                  <FieldLabel htmlFor={`${ids}-title`}>Título</FieldLabel>
                  <CharCount
                    value={draft.title}
                    max={SEO_LIMITS.title.max}
                    recommended={SEO_LIMITS.title.recommended}
                  />
                </div>
                <Input
                  id={`${ids}-title`}
                  value={draft.title}
                  maxLength={SEO_LIMITS.title.max}
                  placeholder={
                    offerSeo?.title
                      ? `Padrão: ${offerSeo.title}`
                      : own?.title
                        ? `Da página: ${own.title}`
                        : "Ex.: Oferta especial — Método X"
                  }
                  aria-invalid={Boolean(errors.title)}
                  onChange={(e) => change({ title: e.target.value }, "title")}
                  autoFocus
                />
                {!draft.title && !offerSeo?.title && (
                  <FieldDescription data-testid="page-own-title">
                    {own?.title
                      ? `Vazio: fica o título que a página já tem (“${own.title}”).`
                      : "Vazio: a página não tem título. Escreva um para a aba do navegador e o Google."}
                  </FieldDescription>
                )}
                <FieldError>{errors.title}</FieldError>
              </Field>
              <Field data-invalid={Boolean(errors.description)}>
                <div className="flex items-center justify-between gap-2">
                  <FieldLabel htmlFor={`${ids}-description`}>Descrição</FieldLabel>
                  <CharCount
                    value={draft.description}
                    max={SEO_LIMITS.description.max}
                    recommended={SEO_LIMITS.description.recommended}
                  />
                </div>
                <Textarea
                  id={`${ids}-description`}
                  rows={3}
                  value={draft.description}
                  maxLength={SEO_LIMITS.description.max}
                  placeholder={
                    offerSeo?.description
                      ? `Padrão: ${offerSeo.description}`
                      : own?.description
                        ? `Da página: ${own.description}`
                        : "Uma ou duas frases."
                  }
                  aria-invalid={Boolean(errors.description)}
                  onChange={(e) => change({ description: e.target.value }, "description")}
                />
                <FieldError>{errors.description}</FieldError>
              </Field>
              <div className="grid gap-5">
                <ImageUploadField
                  offerId={offerId}
                  label="Ícone da aba (favicon)"
                  shape="square"
                  value={draft.faviconSrc}
                  inheritedSrc={offerFavicon}
                  error={errors.faviconKey}
                  onChange={(src) => change({ faviconSrc: src }, "faviconKey")}
                />
                <ImageUploadField
                  offerId={offerId}
                  label="Imagem de compartilhamento"
                  description={ogImageDescription(data?.liveUrl)}
                  shape="wide"
                  value={draft.ogImageSrc}
                  inheritedSrc={offerOgImage}
                  error={errors.ogImageKey}
                  onChange={(src) => change({ ogImageSrc: src }, "ogImageKey")}
                />
              </div>
              <Field data-invalid={Boolean(errors.noindex)}>
                <FieldLabel htmlFor={`${ids}-noindex`}>Aparecer no Google</FieldLabel>
                <Select value={draft.noindex} onValueChange={(v) => change({ noindex: v }, "noindex")}>
                  <SelectTrigger id={`${ids}-noindex`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={INHERIT}>Igual à oferta ({inheritIndexLabel})</SelectItem>
                    <SelectItem value={INDEX}>Pode aparecer no Google</SelectItem>
                    <SelectItem value={NOINDEX}>Não aparecer no Google</SelectItem>
                  </SelectContent>
                </Select>
                <FieldDescription>Páginas de obrigado, upsell e testes costumam ficar fora do Google.</FieldDescription>
                <FieldError>{errors.noindex}</FieldError>
              </Field>
              {errors.form && <FieldError>{errors.form}</FieldError>}
            </div>
            <SearchPreview
              title={draft.title || offerSeo?.title || own?.title || ""}
              description={draft.description || offerSeo?.description || own?.description || ""}
              faviconSrc={draft.faviconSrc ?? offerFavicon}
              noindex={effectiveNoindex}
            />
          </form>
        )}

        <DialogFooter className="-mx-6 -mb-6 -bottom-6 sticky rounded-b-lg border-t bg-background px-6 py-4 sm:justify-between">
          {customized ? (
            <Button
              type="button"
              variant="ghost"
              disabled={save.pending}
              onClick={() =>
                change({ title: "", description: "", faviconSrc: null, ogImageSrc: null, noindex: INHERIT })
              }
            >
              <RotateCcwIcon />
              Usar tudo da oferta
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={onClose} disabled={save.pending}>
              Cancelar
            </Button>
            <Button type="submit" form={`${ids}-form`} disabled={!ready || save.pending}>
              {save.pending && <Spinner />}
              Salvar SEO
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
