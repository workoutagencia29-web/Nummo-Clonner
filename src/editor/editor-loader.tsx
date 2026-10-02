"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

/** Esqueleto enquanto o editor (pesado, só no navegador) carrega. */
function EditorSkeleton() {
  return (
    <div className="flex h-svh flex-col" aria-busy="true">
      <span className="sr-only">Carregando o editor…</span>
      <div className="flex h-12 items-center gap-3 border-b px-3">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-5 w-48" />
        <div className="flex-1" />
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-7 w-28" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-72 border-r p-3">
          <Skeleton className="mb-3 h-8 w-full" />
          <div className="grid grid-cols-2 gap-2">
            {["a", "b", "c", "d", "e", "f"].map((k) => (
              <Skeleton key={k} className="h-20" />
            ))}
          </div>
        </div>
        <div className="flex-1 bg-muted/40 p-6">
          <Skeleton className="mx-auto h-full max-w-5xl" />
        </div>
        <div className="w-80 border-l p-3">
          <Skeleton className="mb-3 h-8 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    </div>
  );
}

const EditorApp = dynamic(() => import("./editor-app").then((m) => m.EditorApp), {
  ssr: false,
  loading: () => <EditorSkeleton />,
});

export function EditorLoader({ documentId }: { documentId: string }) {
  return <EditorApp documentId={documentId} />;
}
