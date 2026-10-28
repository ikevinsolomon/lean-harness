import { randomUUID } from 'node:crypto';
import type { MemoryBackend, MemoryRecord } from '../plugins/memory.js';
import { isoDate, type SqlDb } from './db.js';

/** Long-term memory in the database (table `lh_memories`), next to the chats. */
export class SqlMemory implements MemoryBackend {
  private ready?: Promise<void>;

  constructor(private readonly db: SqlDb) {}

  private async q(sql: string, params: unknown[] = []) {
    this.ready ??= (async () => {
      await this.db.query(
        'CREATE TABLE IF NOT EXISTS lh_memories (id TEXT PRIMARY KEY, scope TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL)',
      );
      await this.db.query('CREATE INDEX IF NOT EXISTS lh_memories_scope ON lh_memories (scope, created_at)');
    })();
    await this.ready;
    return this.db.query(sql, params);
  }

  async list(scope: string): Promise<MemoryRecord[]> {
    const rows = await this.q('SELECT * FROM lh_memories WHERE scope = ? ORDER BY created_at', [scope]);
    return rows.map((r) => ({ id: String(r.id), scope: String(r.scope), text: String(r.text), createdAt: isoDate(r.created_at) }));
  }

  async add(scope: string, text: string): Promise<MemoryRecord> {
    const record = { id: randomUUID().slice(0, 8), scope, text, createdAt: new Date().toISOString() };
    await this.q('INSERT INTO lh_memories (id, scope, text, created_at) VALUES (?, ?, ?, ?)', [record.id, scope, text, record.createdAt]);
    return record;
  }

  async remove(scope: string, id: string): Promise<boolean> {
    const found = await this.q('SELECT id FROM lh_memories WHERE scope = ? AND id = ?', [scope, id]);
    if (!found.length) return false;
    await this.q('DELETE FROM lh_memories WHERE scope = ? AND id = ?', [scope, id]);
    return true;
  }
}
