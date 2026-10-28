import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anthropic, type ProviderEvent } from '../src/index.js';

// A fake Messages API: the first reply pauses mid-search (pause_turn), the second finishes.
const requests: { tools?: { type?: string; name: string }[]; messages: { role: string; content: unknown }[] }[] = [];
let server: Server;
let baseURL = '';

function sse(content: object[], text: string, stopReason: string) {
  const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const events: [string, object][] = [
    ['message_start', { type: 'message_start', message: { id: 'msg', type: 'message', role: 'assistant', model: 'claude-opus-4-8', content: [], stop_reason: null, usage } }],
  ];
  content.forEach((block, index) => {
    events.push(['content_block_start', { type: 'content_block_start', index, content_block: block }]);
    events.push(['content_block_stop', { type: 'content_block_stop', index }]);
  });
  const index = content.length;
  events.push(['content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }]);
  events.push(['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text } }]);
  events.push(['content_block_stop', { type: 'content_block_stop', index }]);
  events.push(['message_delta', { type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: 5 } }]);
  events.push(['message_stop', { type: 'message_stop' }]);
  return events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('');
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      requests.push(JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (requests.length === 1) {
        const search = { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'lean harness' } };
        res.end(sse([search], 'Searching. ', 'pause_turn'));
      } else {
        res.end(sse([], 'Found it.', 'end_turn'));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('Anthropic server tools', () => {
  it('declares web search and code execution, and resumes a paused turn', async () => {
    const provider = anthropic({ apiKey: 'test', baseURL, webSearch: { maxUses: 3 }, codeExecution: true, refusalFallback: false });
    const events: ProviderEvent[] = [];
    for await (const e of provider.stream({ model: 'claude-opus-4-8', system: 'Be brief', messages: [], tools: [] })) events.push(e);

    // With code execution on, the basic web search variant is used alongside it.
    expect(requests[0]!.tools).toEqual([
      { type: 'web_search_20250305', name: 'web_search', max_uses: 3 },
      { type: 'code_execution_20260521', name: 'code_execution' },
    ]);
    // The second request sends the paused reply back, with no extra user message.
    expect(requests).toHaveLength(2);
    const last = requests[1]!.messages.at(-1)!;
    expect(last.role).toBe('assistant');
    expect((last.content as { type: string }[]).map((b) => b.type)).toEqual(['server_tool_use', 'text']);

    const text = events.filter((e) => e.type === 'text_delta').map((e) => (e as { text: string }).text).join('');
    expect(text).toBe('Searching. Found it.');
    const done = events.at(-1) as Extract<ProviderEvent, { type: 'done' }>;
    expect(done.stopReason).toBe('end');
    expect(done.parts.some((p) => p.type === 'tool_call')).toBe(false); // server tools are not run locally
    expect(done.usage).toMatchObject({ inputTokens: 20, outputTokens: 10 });
  });

  it('uses the dynamic web search variant on newer Opus and Sonnet models', async () => {
    requests.length = 0;
    const provider = anthropic({ apiKey: 'test', baseURL, webSearch: true, refusalFallback: false });
    for await (const _ of provider.stream({ model: 'claude-sonnet-5-5', system: '', messages: [], tools: [] }));
    expect(requests[0]!.tools).toEqual([{ type: 'web_search_20260209', name: 'web_search' }]);
  });
});
