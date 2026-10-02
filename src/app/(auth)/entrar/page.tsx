import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { safeReturnPath } from "@/lib/safe-return";
import { hasAnyUser } from "@/server/queries";
import { firstRunBackups, firstRunFolderLabels, isBrandNewInstall } from "@/server/services/backup";
import { getSession } from "@/server/session";
import { EntrarScreen } from "./entrar-screen";

export const metadata: Metadata = { title: "Entrar" };

export default async function EntrarPage({ searchParams }: PageProps<"/entrar">) {
  const { voltar } = await searchParams;
  if (await getSession()) redirect("/ofertas");
  const firstAccess = !(await hasAnyUser());
  const next = safeReturnPath(voltar);
  // Instalação nova (sem conta e sem ofertas): oferece restaurar um backup achado nas pastas sugeridas.
  const firstRun =
    firstAccess && (await isBrandNewInstall())
      ? { backups: await firstRunBackups().catch(() => []), folders: await firstRunFolderLabels() }
      : null;

  return (
    <main className="relative grid min-h-svh place-items-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60rem_30rem_at_50%_-10%,color-mix(in_oklch,var(--primary)_18%,transparent),transparent)]"
      />
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo className="text-lg" />
        </div>
        <EntrarScreen mode={firstAccess ? "signup" : "signin"} next={next} firstRun={firstRun} />
        <p className="mt-6 text-center text-xs text-muted-foreground">Seus dados ficam só neste computador.</p>
      </div>
    </main>
  );
}
