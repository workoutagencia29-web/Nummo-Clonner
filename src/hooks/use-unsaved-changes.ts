"use client";

/**
 * Alterações não salvas nos formulários do painel (ex.: abas da oferta).
 *
 * - `useUnsavedChanges(dirty)`: o formulário avisa que tem algo não salvo.
 * - A aba (TabsTrigger, src/components/ui/tabs.tsx) mostra um ponto quando algum
 *   formulário dentro dela tem alterações não salvas (`useHasUnsavedChanges`).
 * - Com alguma alteração não salva, fechar/recarregar a janela pergunta antes
 *   (beforeunload) e clicar num link que sai da tela também: o
 *   UnsavedChangesGuard (src/components/app/unsaved-changes-guard.tsx) mostra a
 *   pergunta; sem ele, a pergunta do navegador.
 */
import { createContext, useContext, useEffect, useId, useMemo, useSyncExternalStore } from "react";

/** Abas em volta do formulário (a de fora primeiro): cada uma ganha o ponto de "não salvo". */
export const UnsavedScopeContext = createContext<readonly string[]>([]);

const entries = new Map<string, readonly string[]>();
const listeners = new Set<() => void>();

/** Quem pergunta antes de sair por um link (o UnsavedChangesGuard montado na tela). */
type LeaveHost = (href: string) => void;
let leaveHost: LeaveHost | null = null;

function emit() {
  for (const l of listeners) l();
  syncWindowListeners();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function hasUnsavedChanges(scope?: string): boolean {
  if (!scope) return entries.size > 0;
  for (const scopes of entries.values()) if (scopes.includes(scope)) return true;
  return false;
}

/** Esquece tudo (a pessoa escolheu sair sem salvar). */
export function discardUnsavedChanges() {
  entries.clear();
  emit();
}

/** O formulário tem alterações não salvas enquanto `dirty` for true. */
export function useUnsavedChanges(dirty: boolean) {
  const id = useId();
  const scopes = useContext(UnsavedScopeContext);
  const key = scopes.join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` resume `scopes` (array novo a cada render).
  useEffect(() => {
    if (!dirty) return;
    entries.set(id, scopes);
    emit();
    return () => {
      entries.delete(id);
      emit();
    };
  }, [dirty, id, key]);
}

/** Algum formulário (dentro da aba `scope`, ou em qualquer lugar) tem alterações não salvas? */
export function useHasUnsavedChanges(scope?: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => hasUnsavedChanges(scope),
    () => false,
  );
}

/** Escopos para um TabsContent: os de fora + o desta aba. */
export function useNestedUnsavedScopes(scope: string): readonly string[] {
  const outer = useContext(UnsavedScopeContext);
  const key = outer.join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` resume `outer`.
  return useMemo(() => [...outer, scope], [key, scope]);
}

/** Registra quem pergunta antes de sair por um link (null ao desmontar). */
export function setLeaveHost(host: LeaveHost | null) {
  leaveHost = host;
}

// ─── Janela: fechar/recarregar e links que saem da tela ─────────────────────

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!entries.size) return;
  e.preventDefault();
  // Navegadores antigos só perguntam com returnValue preenchido.
  e.returnValue = "";
}

/**
 * Link que leva para outra tela do painel. A mesma tela com outro ?aba= (ex.:
 * "Preencher" nos próximos passos) não conta: as abas continuam montadas e o
 * que não foi salvo continua lá.
 */
export function leavingHref(anchor: HTMLAnchorElement, current: Location): string | null {
  if (anchor.hasAttribute("download")) return null;
  const target = anchor.getAttribute("target");
  if (target && target !== "_self") return null;
  const raw = anchor.getAttribute("href");
  if (!raw || raw.startsWith("#")) return null;
  let url: URL;
  try {
    url = new URL(raw, current.href);
  } catch {
    return null;
  }
  if (url.origin !== current.origin) return null;
  if (url.pathname === current.pathname) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

function onClickCapture(e: MouseEvent) {
  if (!entries.size || e.defaultPrevented || e.button !== 0) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const anchor = (e.target as Element | null)?.closest?.("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return;
  const href = leavingHref(anchor, window.location);
  if (!href) return;
  // Antes do Link do Next (que navega no clique): a pergunta decide.
  e.preventDefault();
  e.stopPropagation();
  if (leaveHost) {
    leaveHost(href);
  } else if (window.confirm("Você tem alterações não salvas. Sair sem salvar?")) {
    discardUnsavedChanges();
    window.location.assign(href);
  }
}

let listening = false;
function syncWindowListeners() {
  if (typeof window === "undefined") return;
  const want = entries.size > 0;
  if (want === listening) return;
  listening = want;
  if (want) {
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClickCapture, true);
  } else {
    window.removeEventListener("beforeunload", onBeforeUnload);
    document.removeEventListener("click", onClickCapture, true);
  }
}
