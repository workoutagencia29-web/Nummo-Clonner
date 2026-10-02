"use client";

import { ChevronsUpDownIcon, LogOutIcon, MonitorIcon, MoonIcon, SettingsIcon, SunIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAction } from "@/hooks/use-action";
import { authClient, safeAuthCall } from "@/lib/auth-client";
import type { Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { setThemeAction } from "@/server/actions/preferences";

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase() || "?";
}

export function UserMenu({
  user,
  theme,
  workerOnline,
}: {
  user: { name: string; email: string };
  theme: Theme;
  workerOnline: boolean;
}) {
  const router = useRouter();
  const setTheme = useAction(setThemeAction);

  function applyTheme(next: Theme) {
    // Aplica na hora (sem esperar o servidor) e salva no cookie.
    const html = document.documentElement;
    html.classList.remove("light", "dark", "system");
    html.classList.add(next);
    void setTheme.run({ theme: next });
  }

  async function signOut() {
    const { error } = await safeAuthCall(() => authClient.signOut());
    if (error) {
      toast.error("Não foi possível sair. Tente de novo.");
      return;
    }
    router.replace("/entrar");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md p-1.5 text-left outline-none hover:bg-sidebar-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-sidebar-accent/60">
          <Avatar className="size-8 rounded-lg">
            <AvatarFallback className="rounded-lg bg-primary/12 text-xs font-semibold text-primary">
              {initials(user.name)}
            </AvatarFallback>
          </Avatar>
          <span className="grid min-w-0 flex-1 leading-tight">
            <span className="truncate text-sm font-medium">{user.name}</span>
            <span className="truncate text-xs text-muted-foreground">{user.email}</span>
          </span>
          <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-60">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Aparência</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme} onValueChange={(v) => applyTheme(v as Theme)}>
            <DropdownMenuRadioItem value="light">
              <SunIcon />
              Claro
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">
              <MoonIcon />
              Escuro
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">
              <MonitorIcon />
              Igual ao sistema
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/configuracoes">
              <SettingsIcon />
              Configurações
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void signOut()}>
            <LogOutIcon />
            Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href="/configuracoes#sistema"
            className="grid size-8 place-items-center rounded-md hover:bg-sidebar-accent/60"
            aria-label={workerOnline ? "Robô de tarefas funcionando" : "Robô de tarefas parado"}
          >
            <span
              className={cn(
                "size-2 rounded-full",
                workerOnline ? "bg-success shadow-[0_0_0_3px] shadow-success/20" : "bg-destructive",
              )}
            />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="top">
          {workerOnline ? "Robô de tarefas funcionando" : "Robô de tarefas parado — veja Configurações"}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
