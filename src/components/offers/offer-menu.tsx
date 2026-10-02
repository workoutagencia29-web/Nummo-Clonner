"use client";

import {
  ArrowRightIcon,
  CircleDotIcon,
  CopyIcon,
  DownloadIcon,
  FolderInputIcon,
  PencilIcon,
  TagsIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { NameDialog } from "@/components/app/name-dialog";
import { exportOfferHref } from "@/components/offers/export/logic";
import { LiveUrlDialog } from "@/components/offers/live-url-dialog";
import { RENAME_QUERY_PARAM } from "@/components/offers/query-params";
import { TagEditorDialog, type TagOption } from "@/components/offers/tag-editor-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { replaceQuery } from "@/hooks/replace-query";
import { useAction } from "@/hooks/use-action";
import { OFFER_STATUS_LABEL } from "@/lib/labels";
import { duplicateOfferAction, restoreOfferAction, trashOfferAction, updateOfferAction } from "@/server/actions/offers";

type Status = keyof typeof OFFER_STATUS_LABEL;
const NO_FOLDER = "__none__";

export interface OfferMenuOffer {
  id: string;
  name: string;
  status: Status;
  folderId: string | null;
  tagIds: string[];
  /** "Onde está no ar": sem ele, marcar "No ar" pede o endereço. */
  liveUrl?: string | null;
}

interface OfferMenuProps {
  offer: OfferMenuOffer;
  folders: { id: string; name: string }[];
  allTags: TagOption[];
  trigger: ReactNode;
  /**
   * No card: mostra "Abrir oferta" e "Baixar ZIP" (que leva para a oferta com o
   * diálogo já aberto). Na tela da oferta, o "Baixar ZIP" é o botão ao lado.
   */
  showOpen?: boolean;
  /** Para onde ir depois de mover para a lixeira (na tela da própria oferta). */
  afterTrashHref?: string;
  align?: "start" | "end";
  /** Abre o "Renomear" ao chegar (?renomear=1, logo depois de duplicar). */
  autoRename?: boolean;
}

/** Menu de ações de uma oferta, usado no card e na tela da oferta. */
export function OfferMenu({
  offer,
  folders,
  allTags,
  trigger,
  showOpen,
  afterTrashHref,
  align = "end",
  autoRename = false,
}: OfferMenuProps) {
  const router = useRouter();
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  const update = useAction(updateOfferAction);
  const duplicate = useAction(duplicateOfferAction);
  const trash = useAction(trashOfferAction);
  const restore = useAction(restoreOfferAction);
  const restoreRun = restore.run;

  // Cópia recém-criada: abre o "Renomear" com o nome selecionado e limpa o endereço.
  const autoRenamed = useRef(false);
  useEffect(() => {
    if (!autoRename || autoRenamed.current) return;
    autoRenamed.current = true;
    setRenameError(null);
    setRenameOpen(true);
    replaceQuery({ [RENAME_QUERY_PARAM]: null });
  }, [autoRename]);

  function setStatus(status: Status) {
    if (status === offer.status) return;
    // "No ar" sem endereço: pede o endereço no mesmo passo (senão o card fica contraditório).
    if (status === "LIVE" && !offer.liveUrl) {
      setLiveOpen(true);
      return;
    }
    void update.run({ id: offer.id, status }, { success: `Status: ${OFFER_STATUS_LABEL[status]}.` });
  }

  function moveToTrash() {
    const { id, name } = offer;
    void trash.run(
      { id },
      {
        onSuccess: () => {
          toast.success("Oferta movida para a lixeira.", {
            description: name,
            action: {
              label: "Desfazer",
              onClick: () =>
                void restoreRun(
                  { id },
                  {
                    success: `"${name}" restaurada.`,
                    onSuccess: () => {
                      if (afterTrashHref) router.push(`/ofertas/${id}`);
                    },
                  },
                ),
            },
          });
          if (afterTrashHref) router.push(afterTrashHref);
        },
      },
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="w-56">
          {showOpen && (
            <>
              <DropdownMenuItem asChild>
                <Link href={`/ofertas/${offer.id}`}>
                  <ArrowRightIcon />
                  Abrir oferta
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={exportOfferHref(offer.id)}>
                  <DownloadIcon />
                  Baixar ZIP
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem
            onSelect={() => {
              setRenameError(null);
              setRenameOpen(true);
            }}
          >
            <PencilIcon />
            Renomear…
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={duplicate.pending}
            onSelect={() =>
              void duplicate.run(
                { id: offer.id },
                {
                  success: "Oferta duplicada.",
                  onSuccess: (copy) => router.push(`/ofertas/${copy.id}?${RENAME_QUERY_PARAM}=1`),
                },
              )
            }
          >
            <CopyIcon />
            Duplicar
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderInputIcon />
              Mover para pasta
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 w-52 overflow-y-auto">
              <DropdownMenuRadioGroup
                value={offer.folderId ?? NO_FOLDER}
                onValueChange={(v) => {
                  if (v === (offer.folderId ?? NO_FOLDER)) return;
                  void update.run(
                    { id: offer.id, folderId: v === NO_FOLDER ? null : v },
                    { success: v === NO_FOLDER ? "Oferta tirada da pasta." : "Oferta movida." },
                  );
                }}
              >
                <DropdownMenuRadioItem value={NO_FOLDER}>Sem pasta</DropdownMenuRadioItem>
                {folders.map((f) => (
                  <DropdownMenuRadioItem key={f.id} value={f.id}>
                    {f.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <CircleDotIcon />
              Status
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup value={offer.status} onValueChange={(v) => setStatus(v as Status)}>
                {(Object.keys(OFFER_STATUS_LABEL) as Status[]).map((s) => (
                  <DropdownMenuRadioItem key={s} value={s}>
                    {OFFER_STATUS_LABEL[s]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem onSelect={() => setTagsOpen(true)}>
            <TagsIcon />
            Tags…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" disabled={trash.pending} onSelect={moveToTrash}>
            <Trash2Icon />
            Mover para a lixeira
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <NameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="Renomear oferta"
        label="Nome da oferta"
        initialValue={offer.name}
        submitLabel="Salvar"
        pending={update.pending}
        error={renameError}
        onSubmit={(name) => {
          if (name === offer.name) {
            setRenameOpen(false);
            return;
          }
          void update.run(
            { id: offer.id, name },
            {
              success: "Oferta renomeada.",
              silentError: true,
              onError: setRenameError,
              onSuccess: () => setRenameOpen(false),
            },
          );
        }}
      />

      <TagEditorDialog
        open={tagsOpen}
        onOpenChange={setTagsOpen}
        offerId={offer.id}
        allTags={allTags}
        selectedIds={offer.tagIds}
      />

      <LiveUrlDialog open={liveOpen} onOpenChange={setLiveOpen} offerId={offer.id} offerName={offer.name} />
    </>
  );
}
