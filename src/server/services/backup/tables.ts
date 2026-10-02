/**
 * Estrutura do banco lida do próprio PostgreSQL: tabelas do app, colunas,
 * chaves primárias e estrangeiras (para a ordem de dependência), sequências e
 * migrations aplicadas. Genérico de propósito: uma tabela nova de uma fase
 * futura entra no backup sem mexer aqui.
 */
import { LOCAL_TABLES, TRANSIENT_TABLES } from "./format";

/** O que o backup precisa de um cliente do banco (pg.Client ou PoolClient). */
export interface Queryable {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export interface ColumnMeta {
  name: string;
  type: string;
  nullable: boolean;
  hasDefault: boolean;
}

export interface ForeignKeyMeta {
  columns: string[];
  refTable: string;
}

export interface TableMeta {
  name: string;
  columns: ColumnMeta[];
  primaryKey: string[];
  foreignKeys: ForeignKeyMeta[];
  /** Colunas com sequência (autoincrement), para acertar o próximo número depois de restaurar. */
  serialColumns: string[];
}

export type SchemaMeta = Map<string, TableMeta>;

/** Nome entre aspas para SQL ("user", "PageDocument"). */
export function ident(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export async function loadSchema(db: Queryable): Promise<SchemaMeta> {
  const tables = await db.query<{ name: string }>(
    `select c.relname as name from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
     order by c.relname`,
  );
  const columns = await db.query<{
    table: string;
    name: string;
    type: string;
    nullable: boolean;
    has_default: boolean;
    serial: boolean;
  }>(
    `select c.relname as table, a.attname as name, format_type(a.atttypid, a.atttypmod) as type,
            not a.attnotnull as nullable, a.atthasdef or a.attidentity <> '' as has_default,
            pg_get_serial_sequence(format('%I.%I', 'public', c.relname), a.attname) is not null as serial
     from pg_attribute a join pg_class c on c.oid = a.attrelid
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
       and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
     order by c.relname, a.attnum`,
  );
  const constraints = await db.query<{ table: string; type: string; columns: string[]; ref_table: string | null }>(
    `select c.relname as table, k.contype::text as type,
            array(select a.attname from unnest(k.conkey) with ordinality u(attnum, ord)
                  join pg_attribute a on a.attrelid = k.conrelid and a.attnum = u.attnum order by u.ord)::text[] as columns,
            r.relname as ref_table
     from pg_constraint k
     join pg_class c on c.oid = k.conrelid
     left join pg_class r on r.oid = k.confrelid
     where k.connamespace = 'public'::regnamespace and k.contype in ('p', 'f')
     order by c.relname, k.conname`,
  );
  const schema: SchemaMeta = new Map();
  for (const t of tables.rows) {
    schema.set(t.name, { name: t.name, columns: [], primaryKey: [], foreignKeys: [], serialColumns: [] });
  }
  for (const c of columns.rows) {
    const meta = schema.get(c.table);
    if (!meta) continue;
    meta.columns.push({ name: c.name, type: c.type, nullable: c.nullable, hasDefault: c.has_default });
    if (c.serial) meta.serialColumns.push(c.name);
  }
  for (const k of constraints.rows) {
    const meta = schema.get(k.table);
    if (!meta) continue;
    if (k.type === "p") meta.primaryKey = k.columns;
    else if (k.ref_table) meta.foreignKeys.push({ columns: k.columns, refTable: k.ref_table });
  }
  return schema;
}

const SKIPPED = new Set<string>([...LOCAL_TABLES, ...TRANSIENT_TABLES]);

/** Tabelas que vão para o backup (todas do app, menos as deste Mac e as passageiras). */
export function backupTableNames(schema: SchemaMeta): string[] {
  return [...schema.keys()].filter((name) => !SKIPPED.has(name));
}

/**
 * Ordem em que as tabelas podem ser preenchidas sem quebrar as chaves
 * estrangeiras (pais antes dos filhos; referência à própria tabela fica para
 * depois). Empates em ordem alfabética, para o backup sair sempre igual.
 */
export function dependencyOrder(names: string[], schema: SchemaMeta): string[] {
  const wanted = new Set(names);
  const deps = new Map<string, Set<string>>();
  for (const name of names) {
    const parents = new Set<string>();
    for (const fk of schema.get(name)?.foreignKeys ?? []) {
      if (fk.refTable !== name && wanted.has(fk.refTable)) parents.add(fk.refTable);
    }
    deps.set(name, parents);
  }
  const ordered: string[] = [];
  const done = new Set<string>();
  while (ordered.length < names.length) {
    const ready = names.filter((n) => !done.has(n) && [...(deps.get(n) ?? [])].every((p) => done.has(p))).sort();
    if (!ready.length) throw new Error(`Dependência circular entre tabelas: ${names.filter((n) => !done.has(n))}`);
    for (const n of ready) {
      ordered.push(n);
      done.add(n);
    }
  }
  return ordered;
}

/** Colunas que apontam para a própria tabela (ex.: CloneJob.parentJobId). */
export function selfReferenceColumns(meta: TableMeta): string[] {
  return meta.foreignKeys.filter((fk) => fk.refTable === meta.name).flatMap((fk) => fk.columns);
}

/** Migrations do Prisma aplicadas neste banco, em ordem. */
export async function appliedMigrations(db: Queryable): Promise<string[]> {
  const exists = await db.query<{ ok: boolean }>(`select to_regclass('public._prisma_migrations') is not null as ok`);
  if (!exists.rows[0]?.ok) return [];
  const rows = await db.query<{ name: string }>(
    `select migration_name as name from "_prisma_migrations"
     where finished_at is not null and rolled_back_at is null order by migration_name`,
  );
  return [...new Set(rows.rows.map((r) => r.name))];
}
