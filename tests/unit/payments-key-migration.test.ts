/**
 * Migração "chave da Kyvo por oferta" (prisma/migrations/*_pagamento_chave_por_oferta)
 * num banco próprio, com o SQL de verdade das migrações:
 *
 * - banco que já tinha a migração de pagamentos com uma chave GLOBAL salva: a
 *   chave (com o último "Testar conexão") vai para cada oferta com pagamento na
 *   página (link com destino "Pagamento na página" ou produto guardado) e a
 *   forma global some;
 * - banco que aplica as duas em sequência (tabela vazia): funciona e nada sobra;
 * - depois, a chave pertence à oferta (offerId obrigatório, uma por gateway,
 *   apagada junto com a oferta).
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseUrl, dropDatabase, recreateDatabase } from "../../scripts/lib/postgres";
import { postgresConfig, readEnvFile } from "../../scripts/lib/project";

const MIGRATIONS = path.resolve(import.meta.dirname, "../../prisma/migrations");
const PAYMENTS = "20261006211740_pagamentos";
const PER_OFFER = "20261006230000_pagamento_chave_por_oferta";
const cfg = postgresConfig(readEnvFile());
const DB = `offerstudio_test_migr_${process.pid}`;

let names: string[] = [];

beforeAll(async () => {
  names = (await readdir(MIGRATIONS, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  expect(names).toContain(PAYMENTS);
  expect(names).toContain(PER_OFFER);
});

afterAll(async () => {
  await dropDatabase(cfg, DB).catch(() => undefined);
});

/** Banco novo com as migrações até `last` (inclusive). */
async function freshDb(last: string) {
  await recreateDatabase(cfg, DB);
  const client = new pg.Client({ connectionString: databaseUrl(cfg, DB) });
  await client.connect();
  for (const name of names) {
    if (name > last) break;
    await client.query(await readFile(path.join(MIGRATIONS, name, "migration.sql"), "utf8"));
  }
  return client;
}

async function apply(client: pg.Client, name: string) {
  await client.query(await readFile(path.join(MIGRATIONS, name, "migration.sql"), "utf8"));
}

async function offer(client: pg.Client, id: string) {
  await client.query(`insert into "Offer" (id, name, "updatedAt") values ($1, $2, now())`, [id, `Oferta ${id}`]);
}

async function link(client: pg.Client, id: string, offerId: string, target: "URL" | "PAYMENT") {
  await client.query(
    `insert into "OfferLink" (id, "offerId", key, label, url, kind, target, "updatedAt")
     values ($1, $2, $1, $1, '', 'CHECKOUT', $3, now())`,
    [id, offerId, target],
  );
}

async function product(client: pg.Client, linkId: string) {
  await client.query(
    `insert into "PaymentProduct" (id, "linkId", name, "amountCents", currency, methods, locale, "updatedAt")
     values ($1, $2, 'Curso', 29700, 'MXN', '{SPEI,CARD}', 'ES', now())`,
    [`p-${linkId}`, linkId],
  );
}

describe("migração da chave da Kyvo para cada oferta", () => {
  it("chave global antiga: copiada (com o último teste) para as ofertas com pagamento; nada global sobra", async () => {
    const client = await freshDb(PAYMENTS);
    try {
      // a: link "Pagamento na página"; b: produto guardado num link que voltou para endereço;
      // c: só link comum; d: nenhum link. e: pagamento na página, na lixeira (a chave vai junto).
      for (const id of ["a", "b", "c", "d", "e"]) await offer(client, id);
      await client.query(`update "Offer" set "deletedAt" = now() where id = 'e'`);
      await link(client, "la", "a", "PAYMENT");
      await product(client, "la");
      await link(client, "la2", "a", "PAYMENT");
      await link(client, "lb", "b", "URL");
      await product(client, "lb");
      await link(client, "lc", "c", "URL");
      await link(client, "le", "e", "PAYMENT");
      const checkedAt = new Date("2026-10-06T21:30:00.000Z");
      await client.query(
        `insert into "PaymentGateway" (provider, "apiKeyEnc", "checkedAt", "checkStatus", "updatedAt")
         values ('KYVO', 'v1:cifrada', $1, 'missing_scope', now())`,
        [checkedAt],
      );

      await apply(client, PER_OFFER);

      const { rows } = await client.query(
        `select "offerId", provider, "apiKeyEnc", "checkedAt", "checkStatus" from "PaymentGateway" order by "offerId"`,
      );
      expect(rows).toEqual(
        ["a", "b", "e"].map((offerId) => ({
          offerId,
          provider: "KYVO",
          apiKeyEnc: "v1:cifrada",
          checkedAt,
          checkStatus: "missing_scope",
        })),
      );

      // Agora a chave é da oferta: offerId obrigatório, uma por gateway, some com a oferta.
      await expect(
        client.query(
          `insert into "PaymentGateway" (provider, "apiKeyEnc", "updatedAt") values ('KYVO', 'v1:x', now())`,
        ),
      ).rejects.toThrow(/null value in column "offerId"/);
      await expect(
        client.query(
          `insert into "PaymentGateway" ("offerId", provider, "apiKeyEnc", "updatedAt") values ('a', 'KYVO', 'v1:x', now())`,
        ),
      ).rejects.toThrow(/PaymentGateway_pkey/);
      await expect(
        client.query(
          `insert into "PaymentGateway" ("offerId", provider, "apiKeyEnc", "updatedAt") values ('nao-existe', 'KYVO', 'v1:x', now())`,
        ),
      ).rejects.toThrow(/PaymentGateway_offerId_fkey/);
      await client.query(`delete from "Offer" where id = 'a'`);
      const left = await client.query(`select "offerId" from "PaymentGateway" order by "offerId"`);
      expect(left.rows).toEqual([{ offerId: "b" }, { offerId: "e" }]);
    } finally {
      await client.end();
    }
  });

  it("chave global sem nenhuma oferta com pagamento: a forma global some", async () => {
    const client = await freshDb(PAYMENTS);
    try {
      await offer(client, "a");
      await link(client, "la", "a", "URL");
      await client.query(
        `insert into "PaymentGateway" (provider, "apiKeyEnc", "updatedAt") values ('KYVO', 'v1:cifrada', now())`,
      );
      await apply(client, PER_OFFER);
      expect((await client.query(`select count(*)::int as n from "PaymentGateway"`)).rows[0].n).toBe(0);
    } finally {
      await client.end();
    }
  });

  it("banco que aplica as duas em sequência (sem chave salva): funciona e chega ao formato novo", async () => {
    const client = await freshDb(PER_OFFER);
    try {
      const cols = await client.query(
        `select column_name, is_nullable from information_schema.columns
         where table_name = 'PaymentGateway' and column_name in ('offerId', 'provider') order by column_name`,
      );
      expect(cols.rows).toEqual([
        { column_name: "offerId", is_nullable: "NO" },
        { column_name: "provider", is_nullable: "NO" },
      ]);
      expect((await client.query(`select count(*)::int as n from "PaymentGateway"`)).rows[0].n).toBe(0);
      // As migrações seguintes (se houver) continuam aplicando por cima.
      for (const name of names.filter((n) => n > PER_OFFER)) await apply(client, name);
    } finally {
      await client.end();
    }
  });
});
