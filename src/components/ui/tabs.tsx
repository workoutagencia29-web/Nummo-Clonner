"use client";

import { Tabs as TabsPrimitive } from "radix-ui";
import * as React from "react";
import { UnsavedScopeContext, useHasUnsavedChanges, useNestedUnsavedScopes } from "@/hooks/use-unsaved-changes";
import { cn } from "@/lib/utils";

/** Aba aberta (para o `keepMounted`) e um ID por conjunto de abas (para o ponto de "não salvo"). */
const TabsStateContext = React.createContext<{ id: string; value: string | undefined } | null>(null);

function Tabs({
  className,
  value,
  defaultValue,
  onValueChange,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  const id = React.useId();
  const [inner, setInner] = React.useState(defaultValue);
  const current = value ?? inner;
  const state = React.useMemo(() => ({ id, value: current }), [id, current]);
  return (
    <TabsStateContext.Provider value={state}>
      <TabsPrimitive.Root
        data-slot="tabs"
        className={cn("flex flex-col gap-2", className)}
        value={current}
        onValueChange={(next) => {
          if (value === undefined) setInner(next);
          onValueChange?.(next);
        }}
        {...props}
      />
    </TabsStateContext.Provider>
  );
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex h-9 w-fit items-center justify-center rounded-lg bg-muted p-[3px] text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** Escopo de "não salvo" de uma aba (único entre conjuntos de abas da mesma tela). */
function useTabScope(value: string) {
  const state = React.useContext(TabsStateContext);
  return state ? `${state.id}:${value}` : value;
}

function TabsTrigger({ className, children, value, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const unsaved = useHasUnsavedChanges(useTabScope(value));
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      data-unsaved={unsaved || undefined}
      value={value}
      className={cn(
        "inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent px-2 py-1 font-medium text-foreground text-sm transition-[color,box-shadow] focus-visible:border-ring focus-visible:outline-1 focus-visible:outline-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:shadow-sm dark:text-muted-foreground dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30 dark:data-[state=active]:text-foreground [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      {...props}
    >
      {children}
      {unsaved && (
        <span data-slot="tabs-unsaved" className="inline-flex shrink-0 items-center" title="Tem mudança por salvar">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-warning" />
          {/* Curto e diferente do "Alterações não salvas" do rodapé (não confunde quem procura o texto). */}
          <span className="sr-only"> (não salvo)</span>
        </span>
      )}
    </TabsPrimitive.Trigger>
  );
}

/**
 * Conteúdo de uma aba. Com `keepMounted`, depois de aberta pela primeira vez a
 * aba continua montada (escondida) ao trocar de aba: o que foi digitado e não
 * salvo continua lá na volta.
 */
function TabsContent({
  className,
  keepMounted = false,
  forceMount,
  value,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content> & { keepMounted?: boolean }) {
  const state = React.useContext(TabsStateContext);
  const active = state?.value === value;
  const [visited, setVisited] = React.useState(active);
  if (keepMounted && active && !visited) setVisited(true);
  const scopes = useNestedUnsavedScopes(useTabScope(value));
  const mounted = forceMount ?? (keepMounted && visited ? true : undefined);
  return (
    <UnsavedScopeContext.Provider value={scopes}>
      <TabsPrimitive.Content
        data-slot="tabs-content"
        value={value}
        forceMount={mounted}
        className={cn("flex-1 outline-none", mounted && "data-[state=inactive]:hidden", className)}
        {...props}
      />
    </UnsavedScopeContext.Provider>
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
