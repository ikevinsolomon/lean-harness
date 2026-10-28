/**
 * One SQL connection, shared by everything that keeps data in the database: chats,
 * memory, accounts. Queries use `?` placeholders; Postgres gets them rewritten.
 */

export type Row = Record<string, unknown>;

export interface SqlDb {
  query(sql: string, params?: unknown[]): Promise<Row[]>;
  /** The column type for JSON values: JSONB on Postgres, TEXT on SQLite. */
  json: string;
  dialect: 'postgres' | 'sqlite';
}

/** A Postgres client: node-postgres `Pool`, PGlite, or anything with the same `query`. */
export interface PostgresClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Row[] }>;
}

export function postgresDb(client: PostgresClient): SqlDb {
  return {
    dialect: 'postgres',
    json: 'JSONB',
    async query(sql, params = []) {
      let n = 0;
      return (await client.query(sql.replace(/\?/g, () => `$${++n}`), params)).rows;
    },
  };
}

/** A SQLite file through Node's built-in SQLite (`':memory:'` for tests). */
export async function openSqlite(file = ':memory:'): Promise<SqlDb> {
  const { DatabaseSync } = await import('node:sqlite');
  if (file !== ':memory:') {
    const { mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  return {
    dialect: 'sqlite',
    json: 'TEXT',
    async query(sql, params = []) {
      const statement = db.prepare(sql);
      const args = params as (string | number | null)[];
      return /^\s*(SELECT|WITH)/i.test(sql) ? (statement.all(...args) as Row[]) : (statement.run(...args), []);
    },
  };
}

export const parseJson = (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value);
export const isoDate = (value: unknown) => (value instanceof Date ? value.toISOString() : String(value));
