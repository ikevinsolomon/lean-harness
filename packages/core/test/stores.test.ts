import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, describe, expect, it } from 'vitest';
import { FileStore, MemoryStore, PostgresStore, SqliteStore, type Message, type Session, type SessionStore } from '../src/index.js';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

const stores: [string, () => Promise<SessionStore>][] = [
  ['MemoryStore', async () => new MemoryStore()],
  ['FileStore', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lh-file-'));
    dirs.push(dir);
    return new FileStore(dir);
  }],
  ['SqliteStore', () => SqliteStore.open(':memory:')],
  ['PostgresStore (PGlite)', async () => new PostgresStore(new PGlite())],
];

const at = '2026-01-01T00:00:00.000Z';
const session = (id: string, owner?: string): Session => ({
  id,
  owner,
  model: 'test/m',
  metadata: { tag: id },
  createdAt: at,
  updatedAt: at,
  messages: [],
});
const msg = (id: string, text: string): Message => ({ id, role: 'user', parts: [{ type: 'text', text }], createdAt: at });

describe.each(stores)('%s', (_, open) => {
  it('creates, reads, appends, truncates, updates and deletes', async () => {
    const store = await open();
    await store.create(session('s1', 'alice'));
    await store.append('s1', [msg('m1', 'one'), msg('m2', 'two')]);
    await store.append('s1', [msg('m3', 'three')]);
    let s = await store.get('s1');
    expect(s?.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    expect(s?.owner).toBe('alice');
    expect(s?.metadata).toEqual({ tag: 's1' });

    s = await store.truncate('s1', 1);
    expect(s.messages.map((m) => m.id)).toEqual(['m1']);
    await store.append('s1', [msg('m4', 'four')]);
    expect((await store.get('s1'))?.messages.map((m) => m.id)).toEqual(['m1', 'm4']);

    s = await store.update('s1', { title: 'Hello', model: 'test/other', metadata: { a: 1 } });
    expect(s).toMatchObject({ title: 'Hello', model: 'test/other', metadata: { a: 1 } });
    expect(s.updatedAt > at).toBe(true);

    expect(await store.delete('s1')).toBe(true);
    expect(await store.get('s1')).toBeUndefined();
    expect(await store.delete('s1')).toBe(false);
  });

  it('lists newest first, filtered by owner', async () => {
    const store = await open();
    await store.create(session('a1', 'alice'));
    await store.create(session('b1', 'bob'));
    await store.create(session('a2', 'alice'));
    await store.append('a1', [msg('x', 'hi')]); // a1 is now the newest
    const all = await store.list();
    expect(all).toHaveLength(3);
    const alice = await store.list({ owner: 'alice' });
    expect(alice.map((s) => s.id)).toEqual(['a1', 'a2']);
    expect(alice[0]).toMatchObject({ messageCount: 1 });
    expect(await store.list({ owner: 'nobody' })).toEqual([]);
  });
});
