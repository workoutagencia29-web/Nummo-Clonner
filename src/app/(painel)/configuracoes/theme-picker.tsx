"use client";

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useState } from "react";
import { useAction } from "@/hooks/use-action";
import type { Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { setThemeAction } from "@/server/actions/preferences";

const OPTIONS: { value: Theme; label: string; icon: typeof SunIcon }[] = [
  { value: "light", label: "Claro", icon: SunIcon },
  { value: "dark", label: "Escuro", icon: MoonIcon },
  { value: "system", label: "Igual ao sistema", icon: MonitorIcon },
];

export function ThemePicker({ theme }: { theme: Theme }) {
  const [current, setCurrent] = useState<Theme>(theme);
  const { run } = useAction(setThemeAction);

  // Acompanha trocas feitas fora desta tela (ex.: pelo menu do usuário).
  const [prevTheme, setPrevTheme] = useState(theme);
  if (theme !== prevTheme) {
    setPrevTheme(theme);
    setCurrent(theme);
  }

  return (
    <div role="radiogroup" aria-label="Tema" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const selected = current === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: cartões grandes clicáveis com role=radio
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => {
              setCurrent(value);
              const html = document.documentElement;
              html.classList.remove("light", "dark", "system");
              html.classList.add(value);
              void run({ theme: value });
            }}
            className={cn(
              "flex items-center gap-3 rounded-lg border p-3 text-left text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted",
            )}
          >
            <span className="grid size-8 place-items-center rounded-md bg-muted">
              <Icon className="size-4" />
            </span>
            {label}
          </button>
        );
      })}
    </div>
  );
}
