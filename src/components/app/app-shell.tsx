"use client";

import {
  CopyPlusIcon,
  FolderIcon,
  FolderPlusIcon,
  LayoutGridIcon,
  MenuIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SettingsIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, type ReactNode, Suspense, useContext, useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { CreateOfferDialog } from "@/components/app/create-offer-dialog";
import { NameDialog } from "@/components/app/name-dialog";
import { UserMenu } from "@/components/app/user-menu";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useAction } from "@/hooks/use-action";
import type { Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { createFolderAction, deleteFolderAction, renameFolderAction } from "@/server/actions/organize";

interface SidebarData {
  folders: { id: string; name: string; count: number }[];
  activeCount: number;
  trashCount: number;
}

interface ShellContextValue {
  /** Abre o "Nova oferta" (com a pasta e, opcionalmente, o modelo já escolhidos). */
  openCreateOffer: (folderId?: string | null, templateId?: string) => void;
  folders: { id: string; name: string }[];
}

const ShellContext = createContext<ShellContextValue | null>(null);

/** Acesso ao "Nova oferta" e à lista de pastas a partir de qualquer tela. */
export function useShell() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell precisa estar dentro de <AppShell>");
  return ctx;
}

interface AppShellProps {
  user: { name: string; email: string };
  sidebar: SidebarData;
  workerOnline: boolean;
  theme: Theme;
  children: ReactNode;
}

export function AppShell({ user, sidebar, workerOnline, theme, children }: AppShellProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [createFolderId, setCreateFolderId] = useState<string | null>(null);
  const [createTemplateId, setCreateTemplateId] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Fecha o menu do celular sempre que a tela muda (inclusive links do menu do usuário).
  const pathname = usePathname();
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setMobileOpen(false);
  }

  const ctx: ShellContextValue = {
    openCreateOffer: (folderId, templateId) => {
      setCreateFolderId(folderId ?? null);
      setCreateTemplateId(templateId ?? null);
      // No celular, fecha o menu: senão ele continua aberto por cima da oferta criada.
      setMobileOpen(false);
      setCreateOpen(true);
    },
    folders: sidebar.folders,
  };

  const content = (
    <Suspense>
      <SidebarContent
        sidebar={sidebar}
        user={user}
        workerOnline={workerOnline}
        theme={theme}
        onNavigate={() => setMobileOpen(false)}
        onCreateOffer={ctx.openCreateOffer}
      />
    </Suspense>
  );

  return (
    <ShellContext.Provider value={ctx}>
      <div className="min-h-svh">
        {/* Teclado: pula as ~12 paradas do menu lateral direto para o conteúdo. */}
        <a
          href="#conteudo"
          className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Pular para o conteúdo
        </a>
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
          {content}
        </aside>

        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur md:hidden">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Abrir menu">
                <MenuIcon />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 bg-sidebar p-0 text-sidebar-foreground">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <SheetDescription className="sr-only">Navegação do Offer Studio</SheetDescription>
              <div className="flex h-full flex-col">{content}</div>
            </SheetContent>
          </Sheet>
          <Logo />
        </header>

        <div className="md:pl-64">
          <main id="conteudo" tabIndex={-1} className="mx-auto w-full max-w-7xl px-4 py-6 outline-none md:px-8 md:py-8">
            {children}
          </main>
        </div>
      </div>
      <CreateOfferDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        folders={sidebar.folders}
        defaultFolderId={createFolderId}
        defaultTemplateId={createTemplateId}
      />
    </ShellContext.Provider>
  );
}

function NavLink({
  href,
  icon: Icon,
  label,
  count,
  active,
  onNavigate,
}: {
  href: string;
  icon: typeof LayoutGridIcon;
  label: string;
  count?: number;
  active: boolean;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
      )}
    >
      <Icon className="size-4 shrink-0 opacity-80" />
      <span className="truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">{count}</span>
      )}
    </Link>
  );
}

function SidebarContent({
  sidebar,
  user,
  workerOnline,
  theme,
  onNavigate,
  onCreateOffer,
}: {
  sidebar: SidebarData;
  user: { name: string; email: string };
  workerOnline: boolean;
  theme: Theme;
  onNavigate: () => void;
  onCreateOffer: (folderId?: string | null) => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const activeFolder = pathname === "/ofertas" ? searchParams.get("pasta") : null;

  const [folderDialog, setFolderDialog] = useState<
    { mode: "create" } | { mode: "rename"; id: string; name: string } | null
  >(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string; count: number } | null>(null);
  const createFolder = useAction(createFolderAction);
  const renameFolder = useAction(renameFolderAction);
  const deleteFolder = useAction(deleteFolderAction);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center px-4">
        <Link href="/ofertas" onClick={onNavigate} aria-label="Offer Studio — início">
          <Logo />
        </Link>
      </div>

      <div className="flex flex-col gap-2 px-3 pb-2">
        <Button className="w-full justify-start" asChild>
          <Link href="/clonar" onClick={onNavigate}>
            <CopyPlusIcon />
            Clonar oferta
          </Link>
        </Button>
        <Button variant="outline" className="w-full justify-start" onClick={() => onCreateOffer(activeFolder)}>
          <PlusIcon />
          Nova oferta
        </Button>
      </div>

      <nav className="flex flex-col gap-0.5 px-3 py-2" aria-label="Principal">
        <NavLink
          href="/ofertas"
          icon={LayoutGridIcon}
          label="Todas as ofertas"
          count={sidebar.activeCount}
          active={pathname === "/ofertas" && !activeFolder}
          onNavigate={onNavigate}
        />
        <NavLink
          href="/lixeira"
          icon={Trash2Icon}
          label="Lixeira"
          count={sidebar.trashCount}
          active={pathname === "/lixeira"}
          onNavigate={onNavigate}
        />
        <NavLink
          href="/configuracoes"
          icon={SettingsIcon}
          label="Configurações"
          active={pathname.startsWith("/configuracoes")}
          onNavigate={onNavigate}
        />
      </nav>

      <div className="mt-3 flex min-h-0 flex-1 flex-col px-3">
        <div className="flex items-center justify-between px-2.5 pb-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pastas</span>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6"
            aria-label="Nova pasta"
            onClick={() => {
              setFolderError(null);
              setFolderDialog({ mode: "create" });
            }}
          >
            <FolderPlusIcon className="size-3.5" />
          </Button>
        </div>
        <div className="-mx-1 flex-1 overflow-y-auto px-1 pb-3">
          {sidebar.folders.length === 0 ? (
            <button
              type="button"
              className="w-full rounded-md px-2.5 py-2 text-left text-xs text-muted-foreground hover:bg-sidebar-accent/60"
              onClick={() => {
                setFolderError(null);
                setFolderDialog({ mode: "create" });
              }}
            >
              Crie pastas para separar nichos, clientes ou campanhas.
            </button>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {sidebar.folders.map((folder) => {
                const active = activeFolder === folder.id;
                return (
                  <li key={folder.id} className="group/folder relative">
                    <Link
                      href={`/ofertas?pasta=${folder.id}`}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-8 items-center gap-2.5 rounded-md pr-8 pl-2.5 text-sm transition-colors",
                        active
                          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60",
                      )}
                    >
                      <FolderIcon className="size-4 shrink-0 opacity-70" />
                      <span className="truncate">{folder.name}</span>
                      <span className="ml-auto text-xs tabular-nums text-muted-foreground group-hover/folder:opacity-0">
                        {folder.count || ""}
                      </span>
                    </Link>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="absolute top-1 right-1 size-6 opacity-0 group-hover/folder:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                          aria-label={`Opções da pasta ${folder.name}`}
                        >
                          <MoreHorizontalIcon className="size-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" side="right">
                        <DropdownMenuItem onSelect={() => onCreateOffer(folder.id)}>
                          <PlusIcon />
                          Nova oferta nesta pasta
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => {
                            setFolderError(null);
                            setFolderDialog({ mode: "rename", id: folder.id, name: folder.name });
                          }}
                        >
                          <PencilIcon />
                          Renomear…
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(folder)}>
                          <Trash2Icon />
                          Excluir pasta
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="border-t border-sidebar-border p-3">
        <UserMenu user={user} theme={theme} workerOnline={workerOnline} />
      </div>

      <NameDialog
        open={folderDialog !== null}
        onOpenChange={(open) => !open && setFolderDialog(null)}
        title={folderDialog?.mode === "rename" ? "Renomear pasta" : "Nova pasta"}
        label="Nome da pasta"
        placeholder="Ex.: Nutra, Clientes, Testes"
        maxLength={60}
        initialValue={folderDialog?.mode === "rename" ? folderDialog.name : ""}
        submitLabel={folderDialog?.mode === "rename" ? "Salvar" : "Criar pasta"}
        pending={createFolder.pending || renameFolder.pending}
        error={folderError}
        onSubmit={(name) => {
          const opts = {
            silentError: true,
            onError: (msg: string) => setFolderError(msg),
            onSuccess: () => setFolderDialog(null),
          };
          if (folderDialog?.mode === "rename") {
            void renameFolder.run({ id: folderDialog.id, name }, { ...opts, success: "Pasta renomeada." });
          } else {
            void createFolder.run({ name }, { ...opts, success: "Pasta criada." });
          }
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Excluir a pasta "${deleting?.name ?? ""}"?`}
        description={
          deleting?.count === 1
            ? "A oferta dela não será apagada: ela fica sem pasta."
            : deleting?.count
              ? `As ${deleting.count} ofertas dela não serão apagadas: elas ficam sem pasta.`
              : "Não há ofertas ativas nesta pasta."
        }
        confirmLabel="Excluir pasta"
        destructive
        pending={deleteFolder.pending}
        onConfirm={() => {
          if (!deleting) return;
          const wasActive = activeFolder === deleting.id;
          void deleteFolder.run(
            { id: deleting.id },
            {
              success: "Pasta excluída.",
              onSuccess: () => {
                setDeleting(null);
                if (wasActive) router.push("/ofertas");
              },
            },
          );
        }}
      />
    </div>
  );
}
