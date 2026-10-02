/**
 * "Esqueci a senha": troca a senha do acesso do Offer Studio pelo Terminal.
 * Uso: dois cliques em "Redefinir senha.command" (ou `npm run redefinir-senha`).
 * Funciona com o Offer Studio aberto ou fechado; as ofertas não mudam.
 */
import { existsSync } from "node:fs";
import readline from "node:readline";
import pg from "pg";
import { databaseUrl, startPostgres } from "./lib/postgres";
import { DB_NAME, ENV_FILE, postgresConfig, readEnvFile } from "./lib/project";
import { listAccounts, passwordProblem, resetPassword } from "./lib/reset-password";

let lines: AsyncIterableIterator<string> | null = null;

/** Lê uma linha; com `hidden`, nada do que é digitado aparece na tela. */
function ask(question: string, hidden = false): Promise<string> {
  const stdin = process.stdin;
  if (!hidden || !stdin.isTTY) {
    process.stdout.write(question);
    lines ??= readline.createInterface({ input: stdin, terminal: false })[Symbol.asyncIterator]();
    return lines.next().then((r) => (r.done ? "" : r.value));
  }
  return new Promise((resolve) => {
    process.stdout.write(question);
    let value = "";
    const finish = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stdout.write("\n");
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          finish();
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          finish();
          console.log("Cancelado. A senha não foi trocada.");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function main() {
  console.log("");
  console.log("Offer Studio — redefinir a senha de acesso");
  console.log("Suas ofertas, páginas e configurações não mudam.");
  console.log("");
  if (!existsSync(ENV_FILE)) {
    console.log("O Offer Studio ainda não foi configurado neste Mac. Abra pelo atalho “Abrir Offer Studio”.");
    return 1;
  }

  const cfg = postgresConfig(readEnvFile());
  const server = await startPostgres(cfg, () => {});
  const db = new pg.Client({ connectionString: databaseUrl(cfg, process.env.OS_DB_NAME || DB_NAME) });
  try {
    await db.connect();
    const accounts = await listAccounts(db);
    if (!accounts.length) {
      console.log("Ainda não existe nenhum acesso. Abra o Offer Studio: ele pede para criar o seu.");
      return 0;
    }
    // Um usuário só por Offer Studio (o banco não aceita outro).
    const account = accounts[0];
    console.log(`Conta: ${account.name} <${account.email}>`);
    console.log("");

    for (let attempt = 1; attempt <= 3; attempt++) {
      const password = await ask("Senha nova (pelo menos 8 caracteres; não aparece enquanto você digita): ", true);
      const confirm = await ask("Digite a senha nova de novo: ", true);
      const problem = passwordProblem(password, confirm);
      if (problem) {
        console.log(`${problem} Tente de novo.`);
        console.log("");
        continue;
      }
      await resetPassword(db, account.id, password);
      console.log("");
      console.log("Pronto! Senha trocada.");
      console.log(`Abra o Offer Studio e entre com o e-mail ${account.email} e a senha nova.`);
      return 0;
    }
    console.log("A senha não foi trocada. Rode de novo quando quiser.");
    return 1;
  } finally {
    await db.end().catch(() => {});
    await server.stop();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("");
    console.error(`Não foi possível trocar a senha: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
