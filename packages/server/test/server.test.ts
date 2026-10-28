import { createHarness, defineTool, mock, z } from '@lean-harness/core';
import { describe, expect, it } from 'vitest';
import { createServer } from '../src/index.js';

function app(options: Parameters<typeof createServer>[1] = {}) {
  const echo = defineTool({ name: 'echo', description: 'Echo', input: z.object({ v: z.string() }), run: ({ v }) => v });
  const harness = createHarness({
    providers: [mock({ delayMs: 0 }), mock({ id: 'other', delayMs: 0 })],
    plugins: [{ name: 'test', tools: [echo] }],
    defaultModel: 'mock/echo',
  });
  return createServer(harness, options);
}

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

function parseSSE(text: string) {
  return text
    .split('\n\n')
    .map((block) => block.split('\n').find((l) => l.startsWith('data:')))
    .filter(Boolean)
    .map((line) => JSON.parse(line!.slice(5)));
}

describe('HTTP API', () => {
  it('lists models and tools', async () => {
    const a = app();
    const models = await (await a.request('/v1/models')).json();
    expect(models.defaultModel).toBe('mock/echo');
    expect(models.models.map((m: { id: string }) => m.id)).toEqual(['mock/echo', 'other/echo']);
    const tools = await (await a.request('/v1/tools')).json();
    expect(tools.tools[0]).toMatchObject({ name: 'echo', inputSchema: { type: 'object' } });
  });

  it('runs a turn as Server-Sent Events, including a tool call', async () => {
    const a = app();
    const session = await (await a.request('/v1/sessions', json({}))).json();
    const res = await a.request(`/v1/sessions/${session.id}/messages`, json({ content: '/echo {"v": "pong"}' }));
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const events = parseSSE(await res.text());
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('turn_start');
    expect(types).toContain('tool_call');
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ output: 'pong', isError: false });
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', stopReason: 'end' });

    const stored = await (await a.request(`/v1/sessions/${session.id}`)).json();
    expect(stored.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
  });

  it('returns JSON when stream is false, and switches models', async () => {
    const a = app();
    const session = await (await a.request('/v1/sessions', json({}))).json();
    const patched = await a.request(`/v1/sessions/${session.id}`, { ...json({ model: 'other/echo' }), method: 'PATCH' });
    expect((await patched.json()).model).toBe('other/echo');
    const result = await (await a.request(`/v1/sessions/${session.id}/messages`, json({ content: 'hello', stream: false }))).json();
    expect(result.text).toContain('You said: _hello_');
    expect(result.messages.at(-1).model).toBe('other/echo');
  });

  it('attaches context to a message', async () => {
    const a = app();
    const session = await (await a.request('/v1/sessions', json({}))).json();
    await a.request(`/v1/sessions/${session.id}/messages`, json({ content: 'hi', stream: false, context: { Page: 'Pricing' } }));
    const stored = await (await a.request(`/v1/sessions/${session.id}`)).json();
    expect(stored.messages[0].parts[0]).toEqual({ type: 'context', label: 'Page', text: 'Pricing' });
    const tooBig = await a.request(`/v1/sessions/${session.id}/messages`, json({ content: 'hi', context: { x: 'y'.repeat(100_001) } }));
    expect(tooBig.status).toBe(400);
  });

  it('answers a 404 when no tool call is waiting for the decision', async () => {
    const a = app();
    const session = await (await a.request('/v1/sessions', json({}))).json();
    const res = await a.request(`/v1/sessions/${session.id}/approvals/nothing`, json({ approved: true }));
    expect(res.status).toBe(404);
    expect((await a.request(`/v1/sessions/${session.id}/approvals/nothing`, json({ approved: 'yes' }))).status).toBe(400);
  });

  it('accepts attachments and rejects unsupported ones', async () => {
    const a = app();
    const session = await (await a.request('/v1/sessions', json({}))).json();
    const png = { name: 'a.png', mediaType: 'image/png', data: Buffer.from('x').toString('base64') };
    const ok = await (await a.request(`/v1/sessions/${session.id}/messages`, json({ content: 'look', stream: false, files: [png] }))).json();
    expect(ok.text).toContain('Attached: a.png (image/png)');
    const stored = await (await a.request(`/v1/sessions/${session.id}`)).json();
    expect(stored.messages[0].parts[0]).toEqual({ type: 'file', ...png });
    const exe = { name: 'a.exe', mediaType: 'application/x-msdownload', data: 'AAAA' };
    expect((await a.request(`/v1/sessions/${session.id}/messages`, json({ content: 'x', files: [exe] }))).status).toBe(400);
  });

  it('maps errors to HTTP status codes', async () => {
    const a = app();
    expect((await a.request('/v1/sessions/nope')).status).toBe(404);
    expect((await a.request('/v1/sessions/nope/messages', json({ content: 'x' }))).status).toBe(404);
    expect((await a.request('/v1/sessions', json({ model: 'missing/model' }))).status).toBe(400);
    const session = await (await a.request('/v1/sessions', json({}))).json();
    expect((await a.request(`/v1/sessions/${session.id}/messages`, json({ content: '' }))).status).toBe(400);
    expect((await a.request(`/v1/sessions/${session.id}`, { method: 'DELETE' })).status).toBe(204);
  });

  it('enforces the API key, except for health checks and CORS preflight', async () => {
    const a = app({ apiKey: 'secret' });
    expect((await a.request('/v1/models')).status).toBe(401);
    expect((await a.request('/v1/models', { headers: { Authorization: 'Bearer secret' } })).status).toBe(200);
    expect((await a.request('/v1/health')).status).toBe(200);
    const preflight = await a.request('/v1/models', {
      method: 'OPTIONS',
      headers: { Origin: 'https://example.com', 'Access-Control-Request-Method': 'GET' },
    });
    expect(preflight.status).toBe(204);
  });
});
