import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { env } from "@/lib/env";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";
import { getWorkerStatus } from "@/server/queries";
import { getBackupOverview, listBackups } from "@/server/services/backup";
import { listTags } from "@/server/services/organize";
import { listPaymentGateways } from "@/server/services/payments/gateways";
import { requireSession } from "@/server/session";
import { AccountForm, PasswordForm } from "./account-forms";
import { BackupCard } from "./backup-card";
import { PaymentsCard } from "./payments-card";
import { SystemStatus } from "./system-status";
import { TagsManager } from "./tags-manager";
import { ThemePicker } from "./theme-picker";

export const metadata: Metadata = { title: "Configurações" };

export default async function ConfiguracoesPage() {
  const session = await requireSession();
  const [tags, worker, cookieStore, backup, backups, gateways] = await Promise.all([
    listTags(),
    getWorkerStatus(),
    cookies(),
    getBackupOverview(),
    listBackups(),
    listPaymentGateways(),
  ]);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sua conta, aparência, tags, pagamentos, backup e o estado do sistema.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sua conta</CardTitle>
          <CardDescription>Nome e e-mail usados para entrar no Offer Studio.</CardDescription>
        </CardHeader>
        <CardContent>
          <AccountForm name={session.user.name} email={session.user.email} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Senha</CardTitle>
          <CardDescription>Ao trocar a senha, outros navegadores conectados são desconectados.</CardDescription>
        </CardHeader>
        <CardContent>
          <PasswordForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Aparência</CardTitle>
          <CardDescription>Escolha o tema do painel.</CardDescription>
        </CardHeader>
        <CardContent>
          <ThemePicker theme={parseTheme(cookieStore.get(THEME_COOKIE)?.value)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tags</CardTitle>
          <CardDescription>Renomeie, mude a cor ou exclua tags. Excluir uma tag não apaga ofertas.</CardDescription>
        </CardHeader>
        <CardContent>
          <TagsManager tags={tags.map((t) => ({ id: t.id, name: t.name, color: t.color, count: t._count.offers }))} />
        </CardContent>
      </Card>

      <Card id="pagamentos" className="scroll-mt-6">
        <CardHeader>
          <CardTitle>Pagamentos</CardTitle>
          <CardDescription>
            Para o comprador pagar dentro da página, sem ir para outro site. Cadastre aqui a chave do seu gateway e, na
            aba “Links e checkouts” da oferta, crie um link do tipo “Pagamento na página”.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PaymentsCard gateways={gateways} />
        </CardContent>
      </Card>

      <Card id="backup" className="scroll-mt-6">
        <CardHeader>
          <CardTitle>Backup</CardTitle>
          <CardDescription>
            Uma cópia de tudo do Offer Studio numa pasta fora dele, todo dia. Com ela, você volta a qualquer dia ou leva
            tudo para outro Mac.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BackupCard overview={backup} folder={backups.folder} files={backups.files} />
        </CardContent>
      </Card>

      <Card id="sistema">
        <CardHeader>
          <CardTitle>Sistema</CardTitle>
          <CardDescription>Onde seus dados ficam e se o robô de tarefas está funcionando.</CardDescription>
        </CardHeader>
        <CardContent>
          <SystemStatus
            workerOnline={worker.online}
            workerLastSeen={worker.lastSeenAt?.toISOString() ?? null}
            dataDir={env.dataDir}
            backupHealth={backup.health}
          />
        </CardContent>
      </Card>
    </div>
  );
}
