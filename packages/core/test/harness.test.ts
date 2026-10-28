import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHarness, definePlugin, defineTool, FileStore, HarnessError, mock, z, type HarnessEvent } from '../src/index.js';
import { call, scripted, text } from './scripted.js';

const add = defineTool({
  name: 'add',
  description: 'Add two numbers',
  input: z.object({ a: z.number(), b: z.number() }),
  run: ({ a, b }) => ({ sum: a + b }),
});

async function collect(events: AsyncIterable<HarnessEvent>) {
  const out: HarnessEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

describe('harness loop', () => {
  it('streams a plain answer and stores both messages', async () => {
    const { provider } = scripted([[text('Hello!')]]);
    const harness = createHarness({ providers: [provider], defaultModel: 'test/model-a' });
    const session = await harness.createSession();
    const events = await collect(harness.run(session.id, 'Hi'));

    expect(events.map((e) => e.type)).toEqual(['turn_start', 'message', 'text_delta', 'message', 'turn_end']);
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', stopReason: 'end', steps: 1 });
    const stored = await harness.getSession(session.id);
    expect(stored.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(stored.messages[1]!.model).toBe('test/model-a');
    expect(stored.title).toBe('Hi');
  });

  it('runs tools and feeds results back until the model answers', async () => {
    const { provider, requests } = scripted([[text('Let me add.'), call('add', { a: 2, b: 3 })], [text('It is 5.')]]);
    const harness = createHarness({ providers: [provider], plugins: [{ name: 'math', tools: [add] }], defaultModel: 'test/model-a' });
    const session = await harness.createSession();
    const result = await harness.send(session.id, 'What is 2+3?');

    expect(result.text).toContain('It is 5.');
    expect(result.stopReason).toBe('end');
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 10, cacheReadTokens: undefined, cacheWriteTokens: undefined });
    expect(requests[0]!.tools.map((t) => t.name)).toEqual(['add']);
    const toolMessage = requests[1]!.messages.at(-1)!;
    expect(toolMessage.role).toBe('tool');
    expect(toolMessage.parts[0]).toMatchObject({ type: 'tool_result', toolCallId: 'call_add', output: '{"sum":5}' });
  });

  it('reports invalid tool input and unknown tools to the model as errors', async () => {
    const { provider, requests } = scripted([[call('add', { a: 'two' }, 'c1'), call('nope', {}, 'c2')], [text('Sorry.')]]);
    const harness = createHarness({ providers: [provider], plugins: [{ name: 'math', tools: [add] }], defaultModel: 'test/model-a' });
    const session = await harness.createSession();
    await harness.send(session.id, 'go');

    const [bad, unknown] = requests[1]!.messages.at(-1)!.parts;
    expect(bad).toMatchObject({ isError: true, toolCallId: 'c1' });
    expect(unknown).toMatchObject({ isError: true, output: 'Unknown tool "nope".' });
  });

  it('lets a hook deny a tool call', async () => {
    const { provider, requests } = scripted([[call('add', { a: 1, b: 1 })], [text('ok')]]);
    const guard = definePlugin({ name: 'guard', hooks: { beforeToolCall: (c) => (c.name === 'add' ? { deny: 'no maths today' } : undefined) } });
    const harness = createHarness({ providers: [provider], plugins: [{ name: 'math', tools: [add] }, guard], defaultModel: 'test/model-a' });
    const session = await harness.createSession();
    await harness.send(session.id, 'go');
    expect(requests[1]!.messages.at(-1)!.parts[0]).toMatchObject({ isError: true, output: 'Not allowed: no maths today' });
  });

  it('stops after maxSteps', async () => {
    const loop = () => [call('add', { a: 1, b: 1 })];
    const { provider } = scripted([loop, loop, loop]);
    const harness = createHarness({ providers: [provider], plugins: [{ name: 'math', tools: [add] }], defaultModel: 'test/model-a', maxSteps: 2 });
    const session = await harness.createSession();
    const result = await harness.send(session.id, 'go');
    expect(result.stopReason).toBe('max_steps');
  });

  it('switches models per turn and per session', async () => {
    const a = scripted([[text('from a')], [text('from a again')]], 'alpha');
    const b = scripted([[text('from b')]], 'beta');
    const harness = createHarness({ providers: [a.provider, b.provider], defaultModel: 'alpha/model-a' });
    const session = await harness.createSession();

    expect((await harness.send(session.id, 'one', { model: 'beta/model-b' })).text).toBe('from b');
    expect((await harness.send(session.id, 'two')).text).toBe('from a');
    await harness.updateSession(session.id, { model: 'alpha/model-b' });
    await harness.send(session.id, 'three');
    expect(a.requests.at(-1)!.model).toBe('model-b');
    // The second provider sees the whole conversation, including the other model's answers.
    expect(a.requests[0]!.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('composes plugin instructions into the system prompt', async () => {
    const { provider, requests } = scripted([[text('ok')]]);
    const harness = createHarness({
      providers: [provider],
      defaultModel: 'test/model-a',
      instructions: 'Base.',
      plugins: [
        { name: 'one', instructions: 'Static rule.' },
        { name: 'two', instructions: (ctx) => `Model is ${ctx.model}.` },
      ],
    });
    const session = await harness.createSession();
    await harness.send(session.id, 'hi');
    expect(requests[0]!.system).toBe('Base.\n\nStatic rule.\n\nModel is test/model-a.');
  });

  it('rejects unknown providers, empty input, a second concurrent turn, and missing sessions', async () => {
    const { provider } = scripted([[text('slow')]]);
    const harness = createHarness({ providers: [provider], defaultModel: 'test/model-a' });
    await expect(harness.createSession({ model: 'other/x' })).rejects.toThrow(/No provider "other"/);
    const session = await harness.createSession();
    await expect(harness.run(session.id, '  ').next()).rejects.toBeInstanceOf(HarnessError);
    await expect(harness.run('missing', 'hi').next()).rejects.toMatchObject({ code: 'not_found' });

    const first = harness.run(session.id, 'hi');
    await first.next();
    await expect(harness.run(session.id, 'again').next()).rejects.toMatchObject({ code: 'busy' });
    await collect(first);
  });

  it('turns a provider failure into an error event and frees the session', async () => {
    const harness = createHarness({ providers: [scripted([]).provider], defaultModel: 'test/model-a' });
    const session = await harness.createSession();
    const events = await collect(harness.run(session.id, 'hi'));
    expect(events.at(-2)).toEqual({ type: 'error', message: 'No scripted response left' });
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', stopReason: 'error' });
    await expect(collect(harness.run(session.id, 'again'))).resolves.toBeDefined();
  });

  it('replaces a user message and everything after it (retry and edit)', async () => {
    const { provider, requests } = scripted([[text('first answer')], [text('second answer')], [text('edited answer')]]);
    const harness = createHarness({ providers: [provider], defaultModel: 'test/model-a' });
    const session = await harness.createSession();
    await harness.send(session.id, 'one');
    await harness.send(session.id, 'two');
    const second = (await harness.getSession(session.id)).messages[2]!;

    const result = await harness.send(session.id, 'two, edited', { replaceFrom: second.id });
    expect(result.text).toBe('edited answer');
    const stored = await harness.getSession(session.id);
    expect(stored.messages.map((m) => m.parts.map((p) => (p.type === 'text' ? p.text : '')).join(''))).toEqual([
      'one',
      'first answer',
      'two, edited',
      'edited answer',
    ]);
    // The model saw the conversation without the replaced turn.
    expect(requests[2]!.messages).toHaveLength(3);
    await expect(harness.run(session.id, 'x', { replaceFrom: stored.messages[1]!.id }).next()).rejects.toMatchObject({ code: 'bad_request' });
  });

  it('lists models from every provider', async () => {
    const harness = createHarness({ providers: [scripted([]).provider, mock()], defaultModel: 'mock/echo' });
    expect((await harness.listModels()).map((m) => m.id)).toEqual(['test/model-a', 'test/model-b', 'mock/echo']);
  });

  it('calls tools through the mock model', async () => {
    const harness = createHarness({ providers: [mock({ delayMs: 0 })], plugins: [{ name: 'math', tools: [add] }], defaultModel: 'mock/echo' });
    const session = await harness.createSession();
    const result = await harness.send(session.id, '/add {"a": 4, "b": 5}');
    expect(result.text).toContain('{"sum":9}');
  });
});

describe('FileStore', () => {
  it('persists sessions across instances', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lean-harness-'));
    try {
      const { provider } = scripted([[text('saved')]]);
      const harness = createHarness({ providers: [provider], defaultModel: 'test/model-a', store: new FileStore(dir) });
      const session = await harness.createSession({ metadata: { user: 'u1' } });
      await harness.send(session.id, 'remember me');

      const reopened = new FileStore(dir);
      const loaded = await reopened.get(session.id);
      expect(loaded?.messages).toHaveLength(2);
      expect(loaded?.metadata).toMatchObject({ user: 'u1', usage: { inputTokens: 10, outputTokens: 5 } });
      expect((await reopened.list())[0]).toMatchObject({ id: session.id, messageCount: 2 });
      expect(await reopened.get('../escape')).toBeUndefined();
      expect(await reopened.delete(session.id)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('shuts down cleanly: lets short turns finish and stops long ones', async () => {
    const quick = createHarness({ providers: [mock({ delayMs: 1 })], defaultModel: 'mock/echo' });
    const a = await quick.createSession();
    await quick.start(a.id, 'hello there');
    expect(await quick.shutdown(5_000)).toBe(0);
    expect(quick.isRunning(a.id)).toBe(false);
    expect((await quick.getSession(a.id)).messages).toHaveLength(2);

    const slow = createHarness({ providers: [mock({ delayMs: 200 })], defaultModel: 'mock/echo' });
    const b = await slow.createSession();
    await slow.start(b.id, 'a long reply please, with many words in it');
    expect(await slow.shutdown(10)).toBe(1);
    expect(slow.isRunning(b.id)).toBe(false);
  });
});
