import { searchHit, type SearchHit, type SessionFilter, type SessionPatch, type SessionStore, type SessionSummary } from '../store.js';
import type { Message, Session } from '../types.js';
import { isoDate as iso, openSqlite, parseJson as json, postgresDb, type PostgresClient, type Row, type SqlDb } from './db.js';

/**
 * Sessions in a SQL database: SQLite (built into Node) or Postgres (any client with
 * a `query(text, params)` method: node-postgres, Neon, Supabase, PGlite...).
 * Two tables: `lh_sessions` and `lh_messages`, one row per message, created on first use.
 */

/** Sessions in any `SqlDb`. `SqliteStore` and `PostgresStore` are shortcuts that open the connection. */
export class SqlSessionStore implements SessionStore {
  private ready?: Promise<void>;

  constructor(private readonly db: SqlDb) {}

  private init() {
    this.ready ??= (async () => {
      await this.db.query(`CREATE TABLE IF NOT EXISTS lh_sessions (
        id TEXT PRIMARY KEY, owner TEXT, title TEXT, model TEXT NOT NULL, metadata ${this.db.json} NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
      await this.db.query('CREATE INDEX IF NOT EXISTS lh_sessions_owner ON lh_sessions (owner, updated_at)');
      await this.db.query(`CREATE TABLE IF NOT EXISTS lh_messages (
        session_id TEXT NOT NULL, seq INTEGER NOT NULL, data ${this.db.json} NOT NULL, PRIMARY KEY (session_id, seq))`);
    })();
    return this.ready;
  }

  private q = async (sql: string, params: unknown[] = []) => {
    await this.init();
    return this.db.query(sql, params);
  };

  private head(row: Row): Omit<Session, 'messages'> {
    return {
      id: String(row.id),
      ...(row.owner != null ? { owner: String(row.owner) } : {}),
      ...(row.title != null ? { title: String(row.title) } : {}),
      model: String(row.model),
      metadata: json(row.metadata) ?? {},
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    };
  }

  async create(session: Session) {
    await this.q('INSERT INTO lh_sessions (id, owner, title, model, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      session.id,
      session.owner ?? null,
      session.title ?? null,
      session.model,
      JSON.stringify(session.metadata),
      session.createdAt,
      session.updatedAt,
    ]);
    if (session.messages.length) await this.append(session.id, session.messages);
    return (await this.get(session.id))!;
  }

  async get(id: string) {
    const [row] = await this.q('SELECT * FROM lh_sessions WHERE id = ?', [id]);
    if (!row) return undefined;
    const messages = await this.q('SELECT data FROM lh_messages WHERE session_id = ? ORDER BY seq', [id]);
    return { ...this.head(row), messages: messages.map((m) => json(m.data) as Message) };
  }

  async list(filter: SessionFilter = {}): Promise<SessionSummary[]> {
    const where = filter.owner !== undefined ? 'WHERE s.owner = ?' : '';
    const rows = await this.q(
      `SELECT s.*, (SELECT COUNT(*) FROM lh_messages m WHERE m.session_id = s.id) AS message_count
       FROM lh_sessions s ${where} ORDER BY s.updated_at DESC`,
      filter.owner !== undefined ? [filter.owner] : [],
    );
    return rows.map((r) => ({ ...this.head(r), messageCount: Number(r.message_count) }));
  }

  async update(id: string, patch: SessionPatch) {
    const sets: string[] = ['updated_at = ?'];
    const params: unknown[] = [new Date().toISOString()];
    if (patch.title !== undefined) (sets.push('title = ?'), params.push(patch.title));
    if (patch.model !== undefined) (sets.push('model = ?'), params.push(patch.model));
    if (patch.metadata !== undefined) (sets.push('metadata = ?'), params.push(JSON.stringify(patch.metadata)));
    await this.q(`UPDATE lh_sessions SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    return this.require(id);
  }

  async append(id: string, messages: Message[]) {
    const [count] = await this.q('SELECT COUNT(*) AS n FROM lh_messages WHERE session_id = ?', [id]);
    let seq = Number(count?.n ?? 0);
    for (const message of messages) {
      await this.q('INSERT INTO lh_messages (session_id, seq, data) VALUES (?, ?, ?)', [id, seq++, JSON.stringify(message)]);
    }
    await this.q('UPDATE lh_sessions SET updated_at = ? WHERE id = ?', [new Date().toISOString(), id]);
    return this.require(id);
  }

  async truncate(id: string, count: number) {
    await this.q('DELETE FROM lh_messages WHERE session_id = ? AND seq >= ?', [id, count]);
    await this.q('UPDATE lh_sessions SET updated_at = ? WHERE id = ?', [new Date().toISOString(), id]);
    return this.require(id);
  }

  async delete(id: string) {
    const existed = (await this.q('SELECT id FROM lh_sessions WHERE id = ?', [id])).length > 0;
    await this.q('DELETE FROM lh_messages WHERE session_id = ?', [id]);
    await this.q('DELETE FROM lh_sessions WHERE id = ?', [id]);
    return existed;
  }

  /** Messages containing `query` (case-insensitive), one hit per session, newest sessions first. */
  async search(query: string, filter: SessionFilter = {}, limit = 30): Promise<SearchHit[]> {
    const like = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const text = this.db.dialect === 'postgres' ? 'm.data::text ILIKE ?' : "m.data LIKE ? ESCAPE '\\'";
    const owner = filter.owner !== undefined ? 'AND s.owner = ?' : '';
    const rows = await this.q(
      `SELECT s.id, s.title, m.data FROM lh_messages m JOIN lh_sessions s ON s.id = m.session_id
       WHERE ${text} ${owner} ORDER BY s.updated_at DESC, m.seq LIMIT 500`,
      filter.owner !== undefined ? [like, filter.owner] : [like],
    );
    const hits: SearchHit[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const id = String(row.id);
      if (seen.has(id)) continue;
      // The JSON match may be in a field that is not the visible text; check properly.
      const hit = searchHit({ id, title: row.title != null ? String(row.title) : undefined }, json(row.data) as Message, query);
      if (!hit) continue;
      seen.add(id);
      hits.push(hit);
      if (hits.length >= limit) break;
    }
    return hits;
  }

  private async require(id: string) {
    const session = await this.get(id);
    if (!session) throw new Error(`Session ${id} not found`);
    return session;
  }
}

/** Sessions in Postgres. Pass your own client: `new PostgresStore(new pg.Pool({ connectionString }))`. */
export class PostgresStore extends SqlSessionStore {
  constructor(client: PostgresClient) {
    super(postgresDb(client));
  }
}

/** Sessions in a SQLite file, using Node's built-in SQLite. Good for one server; no extra install. */
export class SqliteStore extends SqlSessionStore {
  /** `await SqliteStore.open('data/lean-harness.db')`, or `':memory:'`. */
  static async open(file = ':memory:') {
    return new SqliteStore(await openSqlite(file));
  }
}
