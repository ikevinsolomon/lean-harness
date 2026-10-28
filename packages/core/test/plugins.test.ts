import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  chunkDocument,
  createHarness,
  FileMemory,
  historyWindow,
  InMemoryMemory,
  knowledgePlugin,
  memoryPlugin,
  toAnthropicMessages,
  toChatMessages,
} from '../src/index.js';
import { call, scripted, text } from './scripted.js';

describe('memory', () => {
  it('saves a memory with a tool and shows it in later sessions of the same user only', async () => {
    const backend = new InMemoryMemory();
    const { provider, requests } = scripted([
      [call('remember', { text: 'Prefers metric units' })],
      [text('Noted.')],
      [text('Hi again.')],
      [text('Hello stranger.')],
    ]);
    const harness = createHarness({ providers: [provider], plugins: [memoryPlugin({ backend })], defaultModel: 'test/model-a' });

    const first = await harness.createSession({ metadata: { userId: 'asha' } });
    await harness.send(first.id, 'I use metric, remember that');
    const second = await harness.createSession({ metadata: { userId: 'asha' } });
    await harness.send(second.id, 'hi');
    const other = await harness.createSession({ metadata: { userId: 'ben' } });
    await harness.send(other.id, 'hi');

    expect(requests[0]!.system).toContain('no memories of this user yet');
    expect(requests[2]!.system).toMatch(/\[\w+\] Prefers metric units/);
    expect(requests[3]!.system).not.toContain('Prefers metric units');
  });

  it('FileMemory keeps every memory when several are saved at once', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'memory-'));
    try {
      const file = join(dir, 'memory.json');
      const backend = new FileMemory(file);
      await Promise.all(['a', 'b', 'c', 'd', 'e'].map((t) => backend.add('u', `fact ${t}`)));
      expect((await new FileMemory(file).list('u')).map((m) => m.text).sort()).toEqual(['fact a', 'fact b', 'fact c', 'fact d', 'fact e']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('forgets and recalls, and FileMemory survives a restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'memory-'));
    try {
      const file = join(dir, 'memory.json');
      const backend = new FileMemory(file);
      const kept = await backend.add('u', 'Works in the Pune office');
      const dropped = await backend.add('u', 'Likes long reports');
      expect(await backend.remove('u', dropped.id)).toBe(true);

      const reopened = new FileMemory(file);
      expect((await reopened.list('u')).map((m) => m.id)).toEqual([kept.id]);

      const { provider, requests } = scripted([[call('recall', { query: 'which office' })], [text('Pune.')]]);
      const harness = createHarness({
        providers: [provider],
        plugins: [memoryPlugin({ backend: reopened, scope: () => 'u' })],
        defaultModel: 'test/model-a',
      });
      const session = await harness.createSession();
      await harness.send(session.id, 'Where do I work?');
      expect(requests[1]!.messages.at(-1)!.parts[0]).toMatchObject({ isError: false });
      expect(JSON.stringify(requests[1]!.messages.at(-1))).toContain('Pune office');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('context', () => {
  it('attaches context to the user message and every provider sees it', async () => {
    const { provider, requests } = scripted([[text('ok')]]);
    const harness = createHarness({ providers: [provider], defaultModel: 'test/model-a' });
    const session = await harness.createSession();
    await harness.send(session.id, 'Summarise this page', { context: { Page: 'Q3 planning', User: { role: 'admin' }, Empty: '' } });

    const message = requests[0]!.messages[0]!;
    expect(message.parts.map((p) => p.type)).toEqual(['context', 'context', 'text']);
    const expected = '<context label="Page">\nQ3 planning\n</context>\n\n<context label="User">\n{\n  "role": "admin"\n}\n</context>\n\nSummarise this page';
    expect(toChatMessages('', [message])[0]).toEqual({ role: 'user', content: expected });
    expect(toAnthropicMessages([message])[0]).toEqual({ role: 'user', content: [{ type: 'text', text: expected }] });
  });
});

describe('knowledge', () => {
  it('splits documents at headings', () => {
    const chunks = chunkDocument('handbook.md', 'Intro\n# Leave\nTwenty days a year.\n## Sick leave\nAsk your lead.');
    expect(chunks.map((c) => c.heading)).toEqual(['handbook.md', 'Leave', 'Sick leave']);
  });

  it('searches a folder of documents', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kb-'));
    try {
      await writeFile(join(dir, 'policy.md'), '# Refunds\nRefunds are issued within 14 days.\n# Shipping\nWe ship in 2 days.');
      const { provider, requests } = scripted([[call('search_knowledge', { query: 'refunds how many days' })], [text('14 days.')]]);
      const harness = createHarness({
        providers: [provider],
        plugins: [knowledgePlugin({ dir, description: 'store policies' })],
        defaultModel: 'test/model-a',
      });
      const session = await harness.createSession();
      await harness.send(session.id, 'How fast are refunds?');
      expect(requests[0]!.system).toContain('knowledge base about store policies');
      const result = requests[1]!.messages.at(-1)!.parts[0] as { output: string };
      expect(JSON.parse(result.output)[0]).toMatchObject({ source: 'policy.md', heading: 'Refunds' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('historyWindow', () => {
  it('sends only recent messages, starting at a user message', async () => {
    const { provider, requests } = scripted([[text('a')], [call('remember', {}), text('b')], [text('c')], [text('d')]]);
    const harness = createHarness({ providers: [provider], plugins: [historyWindow({ maxMessages: 3 })], defaultModel: 'test/model-a' });
    const session = await harness.createSession();
    await harness.send(session.id, 'one');
    await harness.send(session.id, 'two');
    await harness.send(session.id, 'three');
    const last = requests.at(-1)!.messages;
    expect(last[0]!.role).toBe('user');
    expect(last.length).toBeLessThanOrEqual(3);
    expect((await harness.getSession(session.id)).messages.length).toBeGreaterThan(3);
  });
});
