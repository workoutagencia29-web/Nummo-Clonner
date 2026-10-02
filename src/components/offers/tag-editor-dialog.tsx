"use client";

import { CheckIcon, PlusIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";
import { tagColorClass } from "@/lib/labels";
import { nameKey } from "@/lib/text";
import { cn } from "@/lib/utils";
import { setOfferTagsAction } from "@/server/actions/offers";
import { createTagAction } from "@/server/actions/organize";

export interface TagOption {
  id: string;
  name: string;
  color: string;
}

const NEW_TAG_COLORS = [
  "blue",
  "green",
  "violet",
  "orange",
  "pink",
  "teal",
  "amber",
  "red",
  "indigo",
  "slate",
] as const;

/** Escolher as tags de uma oferta, com criação de tag nova na hora. */
export function TagEditorDialog({
  open,
  onOpenChange,
  offerId,
  allTags,
  selectedIds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offerId: string;
  allTags: TagOption[];
  selectedIds: string[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(selectedIds));
  const [query, setQuery] = useState("");
  const [localTags, setLocalTags] = useState<TagOption[]>(allTags);
  const save = useAction(setOfferTagsAction);
  const create = useAction(createTagAction);

  // Reinicia só quando o diálogo abre. Criar uma tag revalida a tela e chegam
  // props novas (mesmo conteúdo, arrays novos); reiniciar aí desmarcaria a tag criada.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSelected(new Set(selectedIds));
      setQuery("");
      setLocalTags(allTags);
    }
  }

  const trimmed = query.trim();
  const exactExists = useMemo(() => localTags.some((t) => nameKey(t.name) === nameKey(trimmed)), [localTags, trimmed]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function createTag() {
    const color = NEW_TAG_COLORS[localTags.length % NEW_TAG_COLORS.length];
    void create.run(
      { name: trimmed, color },
      {
        success: (t) => `Tag "${t.name}" criada.`,
        onSuccess: (tag) => {
          setLocalTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
          setSelected((prev) => new Set(prev).add(tag.id));
          setQuery("");
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-md">
        <DialogHeader className="p-6 pb-4">
          <DialogTitle>Tags da oferta</DialogTitle>
          <DialogDescription>Marque as tags ou digite para criar uma nova.</DialogDescription>
        </DialogHeader>
        <Command className="border-y" shouldFilter label="Buscar ou criar tag">
          <CommandInput placeholder="Buscar ou criar tag…" value={query} onValueChange={setQuery} />
          <CommandList className="max-h-64" label="Tags">
            <CommandEmpty className="py-4 text-center text-sm text-muted-foreground">
              {trimmed ? "Nenhuma tag com esse nome." : "Nenhuma tag ainda."}
            </CommandEmpty>
            <CommandGroup>
              {localTags.map((tag) => {
                const checked = selected.has(tag.id);
                return (
                  <CommandItem key={tag.id} value={tag.name} aria-checked={checked} onSelect={() => toggle(tag.id)}>
                    <span
                      className={cn(
                        "grid size-4 place-items-center rounded-sm border",
                        checked ? "border-primary bg-primary text-primary-foreground" : "border-input",
                      )}
                    >
                      {checked && <CheckIcon className="size-3" />}
                    </span>
                    <span className={cn("size-2 rounded-full", tagColorClass(tag.color).dot)} />
                    {tag.name}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {trimmed && !exactExists && (
              <CommandGroup forceMount>
                <CommandItem value={`__criar__${trimmed}`} onSelect={createTag} disabled={create.pending} forceMount>
                  <PlusIcon />
                  Criar tag “{trimmed}”
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
        <DialogFooter className="p-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.pending}>
            Cancelar
          </Button>
          <Button
            disabled={save.pending}
            onClick={() => {
              const unchanged = selected.size === selectedIds.length && selectedIds.every((id) => selected.has(id));
              if (unchanged) {
                onOpenChange(false);
                return;
              }
              void save.run(
                { offerId, tagIds: [...selected] },
                { success: "Tags atualizadas.", onSuccess: () => onOpenChange(false) },
              );
            }}
          >
            {save.pending && <Spinner />}
            Salvar tags
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
