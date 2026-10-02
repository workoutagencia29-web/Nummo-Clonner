"use client";

import { useEffect, useState } from "react";
import { BLANK_TEMPLATE, TemplateGallery } from "@/components/offers/template-gallery";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { isTemplateId, templateSummary } from "@/editor/templates/catalog";
import { useAction } from "@/hooks/use-action";
import { PAGE_TYPE_LABEL } from "@/lib/labels";
import { pageSlugProblem, RESERVED_SLUGS, slugify, uniqueSlug } from "@/lib/text";
import { createPageAction, updatePageAction } from "@/server/actions/pages";

type PageType = keyof typeof PAGE_TYPE_LABEL;

/** Entrada da action de criar página (com o modelo escolhido, opcional). */
type CreatePageInput = Parameters<typeof createPageAction>[0];

const BLANK = BLANK_TEMPLATE;

export interface PageDialogPage {
  id: string;
  name: string;
  slug: string;
  type: PageType;
}

/**
 * Criar página nova (a partir de um modelo pronto ou em branco) ou editar nome,
 * endereço e tipo de uma página.
 */
export function PageDialog({
  open,
  onOpenChange,
  offerId,
  page,
  existingSlugs,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offerId: string;
  /** Sem página = criar. */
  page?: PageDialogPage | null;
  /** Endereços já usados na oferta (para sugerir um livre ao escolher um modelo). */
  existingSlugs?: string[];
}) {
  const editing = Boolean(page);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [type, setType] = useState<PageType>("SALES");
  const [templateId, setTemplateId] = useState(BLANK);
  const [errors, setErrors] = useState<{ name?: string; slug?: string }>({});
  const create = useAction(createPageAction);
  const update = useAction(updatePageAction);
  const pending = create.pending || update.pending;
  const selected = templateId === BLANK ? undefined : templateSummary(templateId);

  useEffect(() => {
    if (!open) return;
    setName(page?.name ?? "");
    setNameTouched(Boolean(page));
    setSlug(page?.slug ?? "");
    setSlugTouched(Boolean(page));
    setType(page?.type ?? "SALES");
    setTemplateId(BLANK);
    setErrors({});
  }, [open, page]);

  function suggestSlug(value: string) {
    return existingSlugs ? uniqueSlug(value, existingSlugs) : slugify(value);
  }

  function chooseTemplate(id: string) {
    setTemplateId(id);
    const summary = id === BLANK ? undefined : templateSummary(id);
    setType(summary?.pageType ?? "SALES");
    // O nome sugerido só entra se a pessoa ainda não digitou um nome.
    if (!nameTouched) {
      const nextName = summary?.pageName ?? "";
      setName(nextName);
      if (!slugTouched) setSlug(nextName ? suggestSlug(nextName) : "");
      setErrors({});
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const found: typeof errors = {};
    if (!name.trim()) found.name = "Dê um nome para a página.";
    const finalSlug = slug || slugify(name);
    // Editando sem trocar o endereço, não confere de novo (igual ao servidor).
    const problem = pageSlugProblem(finalSlug, page?.slug);
    if (problem) found.slug = problem;
    setErrors(found);
    if (Object.keys(found).length) return;

    const opts = {
      silentError: true,
      onError: (msg: string, field?: string) =>
        setErrors(field === "slug" ? { slug: msg } : field === "name" ? { name: msg } : { name: msg }),
      onSuccess: () => onOpenChange(false),
    };
    if (page) {
      void update.run(
        { id: page.id, name: name.trim(), slug: finalSlug, type },
        { ...opts, success: "Página atualizada." },
      );
    } else {
      const input: CreatePageInput = { offerId, name: name.trim(), slug: finalSlug, type };
      if (selected && isTemplateId(selected.id)) input.templateId = selected.id;
      void create.run(input, {
        ...opts,
        success: selected ? `Página criada com o modelo "${selected.name}".` : "Página criada.",
      });
    }
  }

  const nameField = (
    <Field data-invalid={Boolean(errors.name)}>
      <FieldLabel htmlFor="page-name">Nome</FieldLabel>
      <Input
        id="page-name"
        value={name}
        maxLength={120}
        placeholder="Ex.: Upsell 1"
        aria-invalid={Boolean(errors.name)}
        onChange={(e) => {
          setName(e.target.value);
          setNameTouched(e.target.value.trim() !== "");
          if (!slugTouched) setSlug(e.target.value.trim() ? suggestSlug(e.target.value) : "");
          setErrors((p) => ({ ...p, name: undefined }));
        }}
        autoFocus={editing}
      />
      <FieldError>{errors.name}</FieldError>
    </Field>
  );

  const slugField = (
    <Field data-invalid={Boolean(errors.slug)}>
      <FieldLabel htmlFor="page-slug">Endereço da página</FieldLabel>
      <div className="flex items-center rounded-md border border-input shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 has-[[aria-invalid=true]]:border-destructive">
        <span className="pl-3 text-sm text-muted-foreground">/</span>
        <Input
          id="page-slug"
          value={slug}
          maxLength={80}
          placeholder="upsell-1"
          aria-invalid={Boolean(errors.slug)}
          className="border-0 pl-0.5 shadow-none focus-visible:ring-0"
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value.toLowerCase().replace(/\s+/g, "-"));
            setErrors((p) => ({ ...p, slug: undefined }));
          }}
          onBlur={() => setSlug((s) => slugify(s))}
        />
      </div>
      <FieldDescription>
        {page && slug === page.slug && RESERVED_SLUGS.has(slug)
          ? "Este endereço passou a ser reservado (é o nome de uma pasta do ZIP). Ele continua valendo nesta página, mas é melhor trocar por outro."
          : `No ar: seudominio.com.br/${slug || "upsell-1"} · letras minúsculas, números e hífen.`}
      </FieldDescription>
      <FieldError>{errors.slug}</FieldError>
    </Field>
  );

  const typeField = (
    <Field>
      <FieldLabel htmlFor="page-type">Tipo</FieldLabel>
      <Select value={type} onValueChange={(v) => setType(v as PageType)}>
        <SelectTrigger id="page-type" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(PAGE_TYPE_LABEL) as PageType[]).map((t) => (
            <SelectItem key={t} value={t}>
              {PAGE_TYPE_LABEL[t]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={editing ? "sm:max-w-md" : "max-h-[94vh] overflow-y-auto sm:max-w-4xl"}>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar página" : "Nova página"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "O endereço vira o nome da pasta desta página no ZIP."
                : "Escolha um modelo pronto ou comece em branco. Tudo pode ser mudado depois, no editor."}
            </DialogDescription>
          </DialogHeader>

          {editing ? (
            <FieldGroup className="my-5">
              {nameField}
              {slugField}
              {typeField}
            </FieldGroup>
          ) : (
            <div className="my-5 flex flex-col gap-5">
              <TemplateGallery value={templateId} onValueChange={chooseTemplate} label="Modelo da página" />

              <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-[1fr_1fr_13rem]">
                {nameField}
                {slugField}
                {typeField}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              {editing ? "Salvar" : "Criar página"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
