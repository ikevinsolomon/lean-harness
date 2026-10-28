import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { definePlugin } from '../plugin.js';
import { defineTool } from '../tool.js';
import { z } from 'zod';
import type { Session } from '../types.js';

/**
 * Long-term memory: facts and preferences that outlive a conversation.
 * Session history is short-term memory (one conversation); this is what the
 * assistant knows about a user across all of their conversations.
 */

export interface MemoryRecord {
  id: string;
  /** Whose memory this is, for example a user id. */
  scope: string;
  text: string;
  createdAt: string;
}

/** Where memories are kept. Implement it for a database or a vector store. */
export interface MemoryBackend {
  list(scope: string): Promise<MemoryRecord[]>;
  add(scope: string, text: string): Promise<MemoryRecord>;
  remove(scope: string, id: string): Promise<boolean>;
  /** Optional smarter search (embeddings). Without it, memories are matched by keywords. */
  search?(scope: string, query: string, limit: number): Promise<MemoryRecord[]>;
}

export class InMemoryMemory implements MemoryBackend {
  protected records: MemoryRecord[] = [];

  async list(scope: string) {
    return this.records.filter((r) => r.scope === scope);
  }

  async add(scope: string, text: string) {
    const record: MemoryRecord = { id: randomUUID().slice(0, 8), scope, text, createdAt: new Date().toISOString() };
    this.records.push(record);
    await this.persist();
    return record;
  }

  async remove(scope: string, id: string) {
    const before = this.records.length;
    this.records = this.records.filter((r) => !(r.scope === scope && r.id === id));
    await this.persist();
    return this.records.length < before;
  }

  protected async persist() {}
}

/** Memories in one JSON file. */
export class FileMemory extends InMemoryMemory {
  private loaded?: Promise<void>;

  constructor(private readonly file: string) {
    super();
  }

  private load() {
    this.loaded ??= readFile(this.file, 'utf8').then(
      (text) => void (this.records = JSON.parse(text) as MemoryRecord[]),
      () => undefined,
    );
    return this.loaded;
  }

  override async list(scope: string) {
    await this.load();
    return super.list(scope);
  }

  override async add(scope: string, text: string) {
    await this.load();
    return super.add(scope, text);
  }

  override async remove(scope: string, id: string) {
    await this.load();
    return super.remove(scope, id);
  }

  protected override async persist() {
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(this.records, null, 2));
    await rename(tmp, this.file);
  }
}

const words = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);

/** Rank records by how many query words they share. Good enough until you need embeddings. */
export function keywordSearch<T>(items: T[], query: string, text: (item: T) => string, limit: number): T[] {
  const q = words(query);
  return items
    .map((item) => ({ item, score: [...words(text(item))].filter((w) => q.has(w)).length }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.item);
}

export interface MemoryPluginOptions {
  backend: MemoryBackend;
  /** Whose memories a session uses. Default: `session.metadata.userId`, else "default". */
  scope?: (session: Session) => string;
  /** How many memories go into every request (newest first; default 30). The rest are found with `recall`. */
  inject?: number;
}

export function memoryPlugin(options: MemoryPluginOptions) {
  const { backend } = options;
  const inject = options.inject ?? 30;
  const scopeOf = options.scope ?? ((s: Session) => (typeof s.metadata.userId === 'string' ? s.metadata.userId : 'default'));

  return definePlugin({
    name: 'memory',
    async instructions({ session }) {
      const all = await backend.list(scopeOf(session));
      const shown = all.slice(-inject).reverse();
      const lines = shown.map((m) => `- [${m.id}] ${m.text}`).join('\n');
      return [
        'You have long-term memory about this user that lasts across conversations.',
        'When the user states a lasting preference or fact about themselves, or asks you to remember something, save it with `remember`.',
        'Do not save one-off details, secrets or passwords. When a memory is wrong or the user asks you to forget it, use `forget`.',
        shown.length ? `What you remember:\n${lines}` : 'You have no memories of this user yet.',
        all.length > shown.length ? `There are ${all.length - shown.length} older memories; use \`recall\` to search them.` : '',
      ]
        .filter(Boolean)
        .join('\n');
    },
    tools: [
      defineTool({
        name: 'remember',
        description: 'Save a lasting fact or preference about the user, as one short sentence.',
        input: z.object({ text: z.string().min(3).max(500) }),
        run: async ({ text }, { session }) => backend.add(scopeOf(session), text),
      }),
      defineTool({
        name: 'forget',
        description: 'Delete a memory by its id.',
        input: z.object({ id: z.string() }),
        async run({ id }, { session }) {
          if (!(await backend.remove(scopeOf(session), id))) throw new Error(`No memory ${id}`);
          return `Forgot ${id}.`;
        },
      }),
      defineTool({
        name: 'recall',
        description: 'Search older memories about the user.',
        input: z.object({ query: z.string().min(2) }),
        async run({ query }, { session }) {
          const scope = scopeOf(session);
          if (backend.search) return backend.search(scope, query, 10);
          return keywordSearch(await backend.list(scope), query, (m) => m.text, 10);
        },
      }),
    ],
  });
}
