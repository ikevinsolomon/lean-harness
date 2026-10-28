import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';
import { createHarness, defineTool, mcpPlugin, z, type HarnessEvent, type Harness } from '../src/index.js';
import { call, scripted, text } from './scripted.js';

const transfer = defineTool({
  name: 'transfer',
  description: 'Move money',
  input: z.object({ amount: z.number() }),
  needsApproval: ({ amount }) => amount > 100,
  run: ({ amount }) => `moved ${amount}`,
});

/** Run a turn, answering each approval request with `answer` as soon as it arrives. */
async function runWith(harness: Harness, sessionId: string, input: string, answer?: { approved: boolean; always?: boolean }) {
  const events: HarnessEvent[] = [];
  for await (const event of harness.run(sessionId, input)) {
    events.push(event);
    if (event.type === 'approval_request' && answer) {
      expect(await harness.decide(sessionId, event.id, answer.approved, answer.always)).toBe(true);
    }
  }
  return events;
}

describe('approvals', () => {
  it('asks only when the tool says so, and runs the call once allowed', async () => {
    const { provider } = scripted([[call('transfer', { amount: 50 }, 'small'), call('transfer', { amount: 500 }, 'big')], [text('done')]]);
    const harness = createHarness({ providers: [provider], plugins: [{ name: 'bank', tools: [transfer] }], defaultModel: 'test/model-a' });
    const session = await harness.createSession();
    const events = await runWith(harness, session.id, 'pay', { approved: true });

    expect(events.filter((e) => e.type === 'approval_request').map((e) => (e as { id: string }).id)).toEqual(['big']);
    const results = events.filter((e) => e.type === 'tool_result');
    expect(results.map((e) => (e as { output: string }).output)).toEqual(['moved 50', 'moved 500']);
  });

  it('reports a declined call to the model as an error', async () => {
    const { provider, requests } = scripted([[call('transfer', { amount: 500 })], [text('ok, cancelled')]]);
    const harness = createHarness({ providers: [provider], plugins: [{ name: 'bank', tools: [transfer] }], defaultModel: 'test/model-a' });
    const session = await harness.createSession();
    await runWith(harness, session.id, 'pay', { approved: false });
    expect(requests[1]!.messages.at(-1)!.parts[0]).toMatchObject({ isError: true, output: 'The user declined this action.' });
  });

  it('"always" stops asking for that tool in the same session', async () => {
    const { provider } = scripted([[call('transfer', { amount: 500 }, 'a')], [text('one')], [call('transfer', { amount: 900 }, 'b')], [text('two')]]);
    const harness = createHarness({ providers: [provider], plugins: [{ name: 'bank', tools: [transfer] }], defaultModel: 'test/model-a' });
    const session = await harness.createSession();
    await runWith(harness, session.id, 'first', { approved: true, always: true });
    const second = await runWith(harness, session.id, 'second');
    expect(second.some((e) => e.type === 'approval_request')).toBe(false);
    expect((await harness.getSession(session.id)).metadata.allowedTools).toEqual(['transfer']);
  });

  it('declines when nobody answers in time', async () => {
    const { provider } = scripted([[call('transfer', { amount: 500 })], [text('timed out')]]);
    const harness = createHarness({
      providers: [provider],
      plugins: [{ name: 'bank', tools: [transfer] }],
      defaultModel: 'test/model-a',
      approvalTimeoutMs: 20,
    });
    const session = await harness.createSession();
    const events = await runWith(harness, session.id, 'pay');
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ isError: true });
    expect(await harness.decide(session.id, 'nope', true)).toBe(false);
  });
});

describe('MCP', () => {
  async function notesServer() {
    const notes: string[] = ['buy milk'];
    const server = new McpServer({ name: 'notes', version: '1.0.0' });
    server.registerTool('list_notes', { description: 'List notes', inputSchema: {}, annotations: { readOnlyHint: true } }, async () => ({
      content: [{ type: 'text', text: JSON.stringify(notes) }],
    }));
    server.registerTool('add_note', { description: 'Add a note', inputSchema: { text: z.string() } }, async ({ text: t }) => {
      notes.push(t);
      return { content: [{ type: 'text', text: `saved "${t}"` }] };
    });
    server.registerTool('fail', { description: 'Always fails', inputSchema: {}, annotations: { readOnlyHint: true } }, async () => ({
      content: [{ type: 'text', text: 'disk full' }],
      isError: true,
    }));
    const [client, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    return { transport: client, notes };
  }

  it('exposes MCP tools with their schemas and asks before tools that are not read-only', async () => {
    const { transport, notes } = await notesServer();
    const mcp = await mcpPlugin({ servers: { notes: { transport } } });
    expect(mcp.servers).toEqual([{ name: 'notes', tools: ['list_notes', 'add_note', 'fail'] }]);

    const { provider, requests } = scripted([
      [call('notes__list_notes', {}, 'l'), call('notes__add_note', { text: 'call mum' }, 'a'), call('notes__fail', {}, 'f')],
      [text('done')],
    ]);
    const harness = createHarness({ providers: [provider], plugins: [mcp], defaultModel: 'test/model-a' });
    const session = await harness.createSession();
    const events = await runWith(harness, session.id, 'notes please', { approved: true });

    expect(requests[0]!.tools.find((t) => t.name === 'notes__add_note')!.inputSchema).toMatchObject({
      type: 'object',
      properties: { text: { type: 'string' } },
    });
    expect(events.filter((e) => e.type === 'approval_request').map((e) => (e as { id: string }).id)).toEqual(['a']);
    const results = Object.fromEntries(
      events.filter((e) => e.type === 'tool_result').map((e) => [(e as { id: string }).id, e]),
    ) as Record<string, { output: string; isError: boolean }>;
    expect(results.l!.output).toBe('["buy milk"]');
    expect(results.a!.output).toBe('saved "call mum"');
    expect(results.f).toMatchObject({ isError: true, output: 'disk full' });
    expect(notes).toEqual(['buy milk', 'call mum']);
    await mcp.close();
  });

  it('skips a server that cannot connect and keeps the others', async () => {
    const { transport } = await notesServer();
    const failures: string[] = [];
    const mcp = await mcpPlugin({
      servers: { notes: { transport }, broken: { command: '/definitely/not/a/real/binary' } },
      onError: (server) => failures.push(server),
    });
    expect(failures).toEqual(['broken']);
    expect(mcp.servers.map((s) => s.name)).toEqual(['notes']);
    await mcp.close();
  });
});
