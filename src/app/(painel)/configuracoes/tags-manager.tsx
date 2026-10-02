"use client";

import { CheckIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { NameDialog } from "@/components/app/name-dialog";
import { TagChip } from "@/components/offers/tag-chip";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAction } from "@/hooks/use-action";
import { plural } from "@/lib/format";
import { TAG_COLOR_LABEL, tagColorClass } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { deleteTagAction, updateTagAction } from "@/server/actions/organize";

type Color = keyof typeof TAG_COLOR_LABEL;
interface TagRow {
  id: string;
  name: string;
  color: string;
  count: number;
}

export function TagsManager({ tags }: { tags: TagRow[] }) {
  const [renaming, setRenaming] = useState<TagRow | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<TagRow | null>(null);
  const update = useAction(updateTagAction);
  const remove = useAction(deleteTagAction);

  if (!tags.length) {
    return (
      <p className="text-sm text-muted-foreground">Nenhuma tag ainda. Crie tags pelo menu de uma oferta (⋯ → Tags).</p>
    );
  }

  return (
    <>
      <ul className="flex flex-col divide-y rounded-lg border">
        {tags.map((tag) => (
          <li key={tag.id} className="flex items-center gap-3 px-3 py-2">
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="grid size-7 place-items-center rounded-md hover:bg-muted"
                  aria-label={`Cor da tag ${tag.name}`}
                >
                  <span className={cn("size-3 rounded-full", tagColorClass(tag.color).dot)} />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-2" align="start">
                <div className="grid grid-cols-5 gap-1.5">
                  {(Object.keys(TAG_COLOR_LABEL) as Color[]).map((c) => (
                    <button
                      key={c}
                      type="button"
                      title={TAG_COLOR_LABEL[c]}
                      aria-label={TAG_COLOR_LABEL[c]}
                      className="grid size-7 place-items-center rounded-md hover:bg-muted"
                      onClick={() => void update.run({ id: tag.id, color: c }, { success: "Cor atualizada." })}
                    >
                      <span
                        className={cn("grid size-4 place-items-center rounded-full text-white", tagColorClass(c).dot)}
                      >
                        {tag.color === c && <CheckIcon className="size-3" />}
                      </span>
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <TagChip name={tag.name} color={tag.color} />
            <span className="text-xs text-muted-foreground">{plural(tag.count, "oferta", "ofertas")}</span>
            <div className="ml-auto flex gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Renomear ${tag.name}`}
                onClick={() => {
                  setRenameError(null);
                  setRenaming(tag);
                }}
              >
                <PencilIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Excluir ${tag.name}`}
                onClick={() => setDeleting(tag)}
              >
                <Trash2Icon />
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <NameDialog
        open={renaming !== null}
        onOpenChange={(open) => !open && setRenaming(null)}
        title="Renomear tag"
        label="Nome da tag"
        maxLength={40}
        initialValue={renaming?.name ?? ""}
        submitLabel="Salvar"
        pending={update.pending}
        error={renameError}
        onSubmit={(name) => {
          if (!renaming) return;
          void update.run(
            { id: renaming.id, name },
            {
              success: "Tag renomeada.",
              silentError: true,
              onError: setRenameError,
              onSuccess: () => setRenaming(null),
            },
          );
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Excluir a tag "${deleting?.name ?? ""}"?`}
        description={
          deleting?.count
            ? `Ela será removida de ${plural(deleting.count, "oferta", "ofertas")}. As ofertas não são apagadas.`
            : "Nenhuma oferta usa esta tag."
        }
        confirmLabel="Excluir tag"
        destructive
        pending={remove.pending}
        onConfirm={() => {
          if (!deleting) return;
          void remove.run({ id: deleting.id }, { success: "Tag excluída.", onSuccess: () => setDeleting(null) });
        }}
      />
    </>
  );
}
