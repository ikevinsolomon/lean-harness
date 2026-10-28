import { describe, expect, it } from 'vitest';
import { createHarness, defineTool, z, type ModelRequest, type Provider, type ProviderEvent } from '../src/index.js';
import { call, scripted, text } from './scripted.js';

/** A model that answers summary requests with "SUMMARY" and everything else with a long reply. */
function summarising() {
  const requests: ModelRequest[] = [];
  const provider: Provider = {
    id: 'test',
    listModels: async () => ['m'],
    async *stream(request): AsyncIterable<ProviderEvent> {
      requests.push(structuredClone({ ...request, signal: undefined }));
      const summary = request.system.startsWith('Summarise');
      yield {
        type: 'done',
        parts: [text(summary ? 'SUMMARY: the user said hello several times' : 'x'.repeat(400))],
        stopReason: 'end',
        native: summary ? undefined : [{ type: 'thinking', thinking: '', signature: 'sig' }],
        usage: { inputTokens: 100, outputTokens: 100 },
      };
    },
  };
  return { provider, requests };
}

describe('context compaction', () => {
  it('replaces older turns with a summary in the request, never in storage', async () => {
    const { provider, requests } = summarising();
    const harness = createHarness({ providers: [provider], defaultModel: 'test/m', context: { maxTokens: 400, keepRecent: 2 } });
    const session = await harness.createSession();
    for (const n of [1, 2, 3, 4]) await harness.send(session.id, `hello ${n} ${'y'.repeat(300)}`);

    const summaryCalls = requests.filter((r) => r.system.startsWith('Summarise'));
    expect(summaryCalls.length).toBeGreaterThan(0);
    const last = requests.at(-1)!;
    expect(last.messages[0]!.parts[0]).toMatchObject({ type: 'context', label: 'Summary of the earlier conversation' });
    expect(last.messages.length).toBeLessThan(8);
    // Earlier replies lose their provider-native data (thinking blocks) once summarised.
    expect(last.messages.filter((m) => m.role === 'assistant').every((m) => m.native === undefined)).toBe(true);

    const stored = await harness.getSession(session.id);
    expect(stored.messages).toHaveLength(8);
    expect(stored.metadata.summary).toMatchObject({ text: 'SUMMARY: the user said hello several times' });
    expect(stored.metadata.usage).toMatchObject({ inputTokens: expect.any(Number) });
  });

  it('sends everything when the conversation is short, or when turned off', async () => {
    const { provider, requests } = summarising();
    const harness = createHarness({ providers: [provider], defaultModel: 'test/m', context: false });
    const session = await harness.createSession();
    for (const n of [1, 2, 3]) await harness.send(session.id, `hello ${n} ${'y'.repeat(3000)}`);
    expect(requests.some((r) => r.system.startsWith('Summarise'))).toBe(false);
    expect(requests.at(-1)!.messages).toHaveLength(5);
  });
});

describe('budgets and timeouts', () => {
  const echo = defineTool({ name: 'echo', description: 'Echo', input: z.object({}), run: () => 'ok' });

  it('stops a reply that uses its token budget', async () => {
    const loop = () => [call('echo', {})];
    const { provider } = scripted([loop, loop, loop]);
    const harness = createHarness({
      providers: [provider],
      plugins: [{ name: 't', tools: [echo] }],
      defaultModel: 'test/model-a',
      budget: { turnTokens: 20 },
    });
    const session = await harness.createSession();
    const result = await harness.send(session.id, 'go');
    expect(result.stopReason).toBe('budget');
    expect(result.error).toMatch(/token budget/);
  });

  it('refuses new replies once the session budget is spent', async () => {
    const { provider } = scripted([[text('one')], [text('two')]]);
    const harness = createHarness({ providers: [provider], defaultModel: 'test/model-a', budget: { sessionTokens: 10 } });
    const session = await harness.createSession();
    expect((await harness.send(session.id, 'first')).stopReason).toBe('end');
    const second = await harness.send(session.id, 'second');
    expect(second.stopReason).toBe('budget');
    expect(second.text).toBe('');
  });

  it('fails a tool that runs too long, and tells the model', async () => {
    const slow = defineTool({
      name: 'slow',
      description: 'Slow',
      input: z.object({}),
      run: (_, { signal }) => new Promise((resolve) => setTimeout(resolve, 2000, 'late')).finally(() => signal.aborted),
    });
    const { provider, requests } = scripted([[call('slow', {})], [text('gave up')]]);
    const harness = createHarness({ providers: [provider], plugins: [{ name: 't', tools: [slow] }], defaultModel: 'test/model-a', toolTimeoutMs: 50 });
    const session = await harness.createSession();
    await harness.send(session.id, 'go');
    expect(requests[1]!.messages.at(-1)!.parts[0]).toMatchObject({ isError: true, output: 'slow timed out after 50ms' });
  });
});
