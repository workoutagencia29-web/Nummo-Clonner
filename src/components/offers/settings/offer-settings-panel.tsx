"use client";

/**
 * Aba "Empresa e SEO" da oferta: dados da empresa (preenchem os marcadores
 * das páginas de Política/Termos), SEO padrão das páginas e o SEO de cada
 * página. Os dados vêm de getOfferSettingsPanel (src/server/services/offer-settings.ts).
 */
import { Building2Icon, FileTextIcon, HomeIcon, SearchIcon } from "lucide-react";
import { useId, useState } from "react";
import { Callout } from "@/components/offers/tracking/callout";
import { CharCount, Panel, SaveBar, SectionHeading, SwitchRow, useDraft } from "@/components/offers/tracking/form-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { PAGE_TYPE_LABEL } from "@/lib/labels";
import type { Company, OfferSettings } from "@/lib/offer-settings";
import { saveOfferSettingsAction } from "@/server/actions/offer-settings";
import type { OfferSettingsPanel as OfferSettingsPanelData } from "@/server/services/offer-settings";
import {
  COMPANY_FIELDS,
  COMPANY_MAX,
  type CompanyFieldKey,
  companyEmailProblem,
  KEEP_LANGUAGE,
  LANGUAGE_LABEL,
  type LanguageId,
  ogImageDescription,
  SEO_LIMITS,
} from "./helpers";
import { ImageUploadField } from "./image-upload-field";
import { PageSeoDialog } from "./page-seo-dialog";
import { SearchPreview } from "./search-preview";

// ─── Dados da empresa ───────────────────────────────────────────────────────

function CompanyForm({ offerId, company }: { offerId: string; company: Company }) {
  const { draft, patch, dirty, reset, commit } = useDraft(company);
  const [errors, setErrors] = useState<Partial<Record<CompanyFieldKey | "form", string>>>({});
  const save = useAction(saveOfferSettingsAction);
  const ids = useId();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const emailProblem = companyEmailProblem(draft.email);
    if (emailProblem) {
      setErrors({ email: emailProblem });
      return;
    }
    setErrors({});
    const clean = Object.fromEntries(COMPANY_FIELDS.map((f) => [f.key, draft[f.key].trim()])) as Record<
      CompanyFieldKey,
      string
    >;
    void save.run(
      { offerId, company: clean },
      {
        success: "Dados da empresa salvos.",
        silentError: true,
        onError: (message, field) => {
          const key = field?.replace(/^company\./, "");
          setErrors(key && COMPANY_FIELDS.some((f) => f.key === key) ? { [key]: message } : { form: message });
        },
        onSuccess: (s) => commit(s.company),
      },
    );
  }

  return (
    <Panel>
      <form noValidate onSubmit={submit} className="flex flex-col gap-5">
        <SectionHeading
          title={
            <span className="flex items-center gap-2">
              <Building2Icon className="size-4.5 text-muted-foreground" aria-hidden="true" />
              Dados da empresa
            </span>
          }
          description="Usados nas páginas de Política de privacidade e Termos de uso desta oferta."
        />
        <Callout>
          Os modelos de <strong>Política de privacidade</strong> e <strong>Termos de uso</strong> têm marcadores como{" "}
          <code className="font-mono text-xs">{"{{EMPRESA}}"}</code> e{" "}
          <code className="font-mono text-xs">{"{{CNPJ}}"}</code>. Na prévia e no ZIP, eles são trocados por estes
          dados. Nome, CNPJ/CPF e e-mail vazios deixam o marcador na página, para você perceber que falta; telefone e
          endereço são opcionais e somem da página quando ficam vazios.
        </Callout>
        <div className="grid gap-4 sm:grid-cols-2">
          {COMPANY_FIELDS.map((f) => {
            const id = `${ids}-${f.key}`;
            return (
              <Field
                key={f.key}
                data-invalid={Boolean(errors[f.key])}
                className={f.key === "document" || f.key === "phone" ? undefined : "sm:col-span-2"}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <FieldLabel htmlFor={id}>{f.label}</FieldLabel>
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                    {f.marker}
                  </code>
                </div>
                <Input
                  id={id}
                  value={draft[f.key]}
                  maxLength={COMPANY_MAX[f.key]}
                  placeholder={f.placeholder}
                  type={f.key === "email" ? "email" : "text"}
                  inputMode={f.key === "phone" ? "tel" : f.key === "email" ? "email" : undefined}
                  autoComplete="off"
                  aria-invalid={Boolean(errors[f.key])}
                  onChange={(e) => {
                    patch({ [f.key]: e.target.value } as Partial<Company>);
                    setErrors((x) => ({ ...x, [f.key]: undefined, form: undefined }));
                  }}
                  onBlur={() => {
                    if (f.key === "email") {
                      const problem = companyEmailProblem(draft.email);
                      if (problem) setErrors((x) => ({ ...x, email: problem }));
                    }
                  }}
                />
                <FieldError>{errors[f.key]}</FieldError>
              </Field>
            );
          })}
        </div>
        {errors.form && <FieldError>{errors.form}</FieldError>}
        <SaveBar
          dirty={dirty}
          pending={save.pending}
          onReset={() => {
            reset();
            setErrors({});
          }}
          saveLabel="Salvar dados da empresa"
        />
      </form>
    </Panel>
  );
}

// ─── SEO padrão ─────────────────────────────────────────────────────────────

interface SeoDraft {
  title: string;
  description: string;
  faviconSrc: string | null;
  ogImageSrc: string | null;
  noindex: boolean;
  language: LanguageId;
}

type SeoField = "title" | "description" | "faviconKey" | "ogImageKey" | "language" | "form";

function SeoDefaultsForm({
  offerId,
  settings,
  faviconSrc,
  ogImageSrc,
  liveUrl,
}: {
  offerId: string;
  settings: OfferSettings;
  faviconSrc: string | null;
  ogImageSrc: string | null;
  liveUrl: string | null;
}) {
  const { draft, patch, dirty, reset, commit, baseline } = useDraft<SeoDraft>({
    title: settings.seo.title,
    description: settings.seo.description,
    faviconSrc,
    ogImageSrc,
    noindex: settings.seo.noindex,
    language: settings.language,
  });
  const [errors, setErrors] = useState<Partial<Record<SeoField, string>>>({});
  const save = useAction(saveOfferSettingsAction);
  const ids = useId();

  function change(changes: Partial<SeoDraft>, field?: SeoField) {
    patch(changes);
    if (field) setErrors((e) => ({ ...e, [field]: undefined, form: undefined }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    // Imagens só vão quando mudaram (o servidor confere que são da biblioteca desta oferta).
    const seo: Record<string, unknown> = {
      title: draft.title.trim(),
      description: draft.description.trim(),
      noindex: draft.noindex,
    };
    if (draft.faviconSrc !== baseline.faviconSrc) seo.faviconKey = draft.faviconSrc;
    if (draft.ogImageSrc !== baseline.ogImageSrc) seo.ogImageKey = draft.ogImageSrc;
    const saved = { ...draft, title: draft.title.trim(), description: draft.description.trim() };
    void save.run(
      { offerId, seo, language: draft.language },
      {
        success: "SEO padrão salvo.",
        silentError: true,
        onError: (message, field) => {
          const key = field?.replace(/^seo\./, "") as SeoField | undefined;
          setErrors(
            key && ["title", "description", "faviconKey", "ogImageKey", "language"].includes(key)
              ? { [key]: message }
              : { form: message },
          );
        },
        onSuccess: () => commit(saved),
      },
    );
  }

  return (
    <Panel>
      <form noValidate onSubmit={submit} className="flex flex-col gap-5">
        <SectionHeading
          title={
            <span className="flex items-center gap-2">
              <SearchIcon className="size-4.5 text-muted-foreground" aria-hidden="true" />
              SEO padrão
            </span>
          }
          description="Vale para todas as páginas da oferta, na prévia e no ZIP. Cada página pode ter o próprio SEO (lista abaixo). Campo vazio mantém o que a página já tem."
        />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <div className="flex flex-col gap-5">
            <Field data-invalid={Boolean(errors.title)}>
              <div className="flex items-center justify-between gap-2">
                <FieldLabel htmlFor={`${ids}-title`}>Título</FieldLabel>
                <CharCount value={draft.title} max={SEO_LIMITS.title.max} recommended={SEO_LIMITS.title.recommended} />
              </div>
              <Input
                id={`${ids}-title`}
                value={draft.title}
                maxLength={SEO_LIMITS.title.max}
                placeholder="Ex.: Método X — aprenda a …"
                aria-invalid={Boolean(errors.title)}
                onChange={(e) => change({ title: e.target.value }, "title")}
              />
              <FieldDescription>Aparece na aba do navegador e no Google.</FieldDescription>
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
                placeholder="Uma ou duas frases sobre a oferta."
                aria-invalid={Boolean(errors.description)}
                onChange={(e) => change({ description: e.target.value }, "description")}
              />
              <FieldError>{errors.description}</FieldError>
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <ImageUploadField
                offerId={offerId}
                label="Ícone da aba (favicon)"
                description="Imagem quadrada, de preferência 512×512."
                shape="square"
                value={draft.faviconSrc}
                error={errors.faviconKey}
                onChange={(src) => change({ faviconSrc: src }, "faviconKey")}
              />
              <ImageUploadField
                offerId={offerId}
                label="Imagem de compartilhamento"
                description={ogImageDescription(liveUrl)}
                shape="wide"
                value={draft.ogImageSrc}
                error={errors.ogImageKey}
                onChange={(src) => change({ ogImageSrc: src }, "ogImageKey")}
              />
            </div>
            <SwitchRow
              label="Não aparecer no Google"
              description="Pede para o Google e outros buscadores não mostrarem as páginas (marca “noindex”). Bom para ofertas só de anúncio."
              checked={draft.noindex}
              onCheckedChange={(noindex) => change({ noindex })}
            />
            <Field className="max-w-xs" data-invalid={Boolean(errors.language)}>
              <FieldLabel htmlFor={`${ids}-language`}>Idioma das páginas</FieldLabel>
              <Select
                value={draft.language || KEEP_LANGUAGE}
                onValueChange={(v) =>
                  change({ language: v === KEEP_LANGUAGE ? "" : (v as keyof typeof LANGUAGE_LABEL) }, "language")
                }
              >
                <SelectTrigger id={`${ids}-language`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={KEEP_LANGUAGE}>Igual à página (não muda)</SelectItem>
                  {(Object.keys(LANGUAGE_LABEL) as (keyof typeof LANGUAGE_LABEL)[]).map((l) => (
                    <SelectItem key={l} value={l}>
                      {LANGUAGE_LABEL[l]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                Ajuda o Google, o tradutor do navegador e os leitores de tela. “Igual à página” mantém o idioma que cada
                página já declara (uma página clonada em inglês continua em inglês).
              </FieldDescription>
              <FieldError>{errors.language}</FieldError>
            </Field>
          </div>
          <SearchPreview
            title={draft.title}
            description={draft.description}
            faviconSrc={draft.faviconSrc}
            noindex={draft.noindex}
          />
        </div>
        {errors.form && <FieldError>{errors.form}</FieldError>}
        <SaveBar
          dirty={dirty}
          pending={save.pending}
          onReset={() => {
            reset();
            setErrors({});
          }}
          saveLabel="Salvar SEO padrão"
        />
      </form>
    </Panel>
  );
}

// ─── SEO de cada página ─────────────────────────────────────────────────────

type PanelPage = OfferSettingsPanelData["pages"][number];

function customizedCount(page: PanelPage) {
  const s = page.seo;
  return [s.title, s.description, s.faviconKey, s.ogImageKey, s.noindex !== null ? "x" : ""].filter(Boolean).length;
}

function PagesSeoList({ offerId, pages }: { offerId: string; pages: PanelPage[] }) {
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  return (
    <Panel>
      <SectionHeading
        title="SEO de cada página"
        description="Campos vazios usam o SEO padrão da oferta. Dê um título próprio para cada página do funil."
      />
      <ul className="flex flex-col divide-y overflow-hidden rounded-lg border" aria-label="SEO das páginas">
        {pages.map((page) => {
          const count = customizedCount(page);
          return (
            <li key={page.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                {page.isHome ? <HomeIcon className="size-4" /> : <FileTextIcon className="size-4" />}
              </span>
              <div className="min-w-0 flex-1 basis-56">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{page.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {PAGE_TYPE_LABEL[page.type as keyof typeof PAGE_TYPE_LABEL] ?? page.type}
                  </span>
                  {count > 0 ? (
                    <Badge variant="secondary">SEO próprio</Badge>
                  ) : (
                    <Badge variant="outline">Usa o padrão</Badge>
                  )}
                  {page.effective.noindex && <Badge variant="outline">Fora do Google</Badge>}
                </div>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {page.effective.title || "Usa o título da própria página"}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                aria-label={`SEO da página ${page.name}`}
                onClick={() => setEditing({ id: page.id, name: page.name })}
              >
                <SearchIcon />
                Editar SEO
              </Button>
            </li>
          );
        })}
      </ul>
      <PageSeoDialog offerId={offerId} page={editing} onClose={() => setEditing(null)} />
    </Panel>
  );
}

// ─── Aba ────────────────────────────────────────────────────────────────────

export function OfferSettingsPanel({ data }: { data: OfferSettingsPanelData }) {
  const { offer, settings } = data;
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <CompanyForm key={JSON.stringify(settings.company)} offerId={offer.id} company={settings.company} />
      <SeoDefaultsForm
        key={JSON.stringify([settings.seo, settings.language])}
        offerId={offer.id}
        settings={settings}
        faviconSrc={data.faviconSrc}
        ogImageSrc={data.ogImageSrc}
        liveUrl={offer.liveUrl}
      />
      <PagesSeoList offerId={offer.id} pages={data.pages} />
    </div>
  );
}
