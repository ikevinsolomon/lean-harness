import { createHarness, InMemoryMemory, mock } from '@lean-harness/core';
import { describe, expect, it } from 'vitest';
import { createServer, jwtAuth, tokenAuth } from '../src/index.js';

const json = (body: unknown, token?: string) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});
const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
const events = (text: string) =>
  text
    .split('\n\n')
    .map((b) => b.split('\n').find((l) => l.startsWith('data:')))
    .filter(Boolean)
    .map((l) => JSON.parse(l!.slice(5)));

function setup(extra: Parameters<typeof createServer>[1] = {}) {
  const harness = createHarness({ providers: [mock({ delayMs: 0 })], defaultModel: 'mock/echo' });
  const app = createServer(harness, { authenticate: tokenAuth({ 'tok-asha': { id: 'asha', name: 'Asha' }, 'tok-ben': 'ben' }), ...extra });
  return { harness, app };
}

describe('users', () => {
  it('rejects requests without a valid token, and says who is signed in', async () => {
    const { app } = setup();
    expect((await app.request('/v1/sessions')).status).toBe(401);
    expect((await app.request('/v1/sessions', auth('wrong'))).status).toBe(401);
    expect(await (await app.request('/v1/me', auth('tok-asha'))).json()).toEqual({ user: { id: 'asha', name: 'Asha' } });
    expect((await app.request('/v1/health')).status).toBe(200);
  });

  it("keeps each user's sessions private", async () => {
    const { app } = setup();
    const mine = await (await app.request('/v1/sessions', json({}, 'tok-asha'))).json();
    expect(mine.owner).toBe('asha');
    await app.request(`/v1/sessions/${mine.id}/messages`, json({ content: 'hello', stream: false }, 'tok-asha'));

    const list = async (token: string) => (await app.request('/v1/sessions', auth(token))).json();
    expect((await list('tok-asha')).sessions.map((s: { id: string }) => s.id)).toEqual([mine.id]);
    expect((await list('tok-ben')).sessions).toEqual([]);

    // Ben can't read, change, message, stop or delete Asha's session: it looks missing.
    expect((await app.request(`/v1/sessions/${mine.id}`, auth('tok-ben'))).status).toBe(404);
    expect((await app.request(`/v1/sessions/${mine.id}`, { ...json({ title: 'x' }, 'tok-ben'), method: 'PATCH' })).status).toBe(404);
    expect((await app.request(`/v1/sessions/${mine.id}/messages`, json({ content: 'hi' }, 'tok-ben'))).status).toBe(404);
    expect((await app.request(`/v1/sessions/${mine.id}/stop`, json({}, 'tok-ben'))).status).toBe(404);
    expect((await app.request(`/v1/sessions/${mine.id}`, { method: 'DELETE', ...auth('tok-ben') })).status).toBe(404);
    expect((await app.request(`/v1/sessions/${mine.id}`, auth('tok-asha'))).status).toBe(200);
  });

  it('accepts signed tokens (JWT, HS256) and rejects bad ones', async () => {
    const secret = 'test-secret';
    const sign = async (claims: Record<string, unknown>, key = secret) => {
      const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const data = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(claims)}`;
      const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const sig = Buffer.from(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data))).toString('base64url');
      return `${data}.${sig}`;
    };
    const harness = createHarness({ providers: [mock()], defaultModel: 'mock/echo' });
    const app = createServer(harness, { authenticate: jwtAuth({ secret, audience: 'lean' }) });
    const me = (token: string) => app.request('/v1/me', auth(token));
    const future = Math.floor(Date.now() / 1000) + 600;

    expect(await (await me(await sign({ sub: 'u1', email: 'u1@example.com', aud: 'lean', exp: future }))).json()).toEqual({
      user: { id: 'u1', email: 'u1@example.com' },
    });
    expect((await me(await sign({ sub: 'u1', aud: 'lean', exp: future }, 'other-secret'))).status).toBe(401);
    expect((await me(await sign({ sub: 'u1', aud: 'lean', exp: 1 }))).status).toBe(401);
    expect((await me(await sign({ sub: 'u1', aud: 'someone-else', exp: future }))).status).toBe(401);
  });
});

describe('background turns', () => {
  it('keeps running without a listener, can be stopped, and can be replayed', async () => {
    const harness = createHarness({ providers: [mock({ delayMs: 30 })], defaultModel: 'mock/echo' });
    const app = createServer(harness);
    const session = await (await app.request('/v1/sessions', json({}))).json();

    await harness.start(session.id, 'a long message to echo back slowly');
    expect(harness.isRunning(session.id)).toBe(true);
    expect((await (await app.request(`/v1/sessions/${session.id}`)).json()).running).toBe(true);
    const stopped = await (await app.request(`/v1/sessions/${session.id}/stop`, json({}))).json();
    expect(stopped).toEqual({ stopped: true });

    // Reconnecting replays the whole turn, ending with the stop.
    const replay = events(await (await app.request(`/v1/sessions/${session.id}/stream`)).text());
    expect(replay[0].type).toBe('turn_start');
    expect(replay.at(-1)).toMatchObject({ type: 'turn_end', stopReason: 'aborted' });
    const tail = events(await (await app.request(`/v1/sessions/${session.id}/stream?from=${replay.length - 1}`)).text());
    expect(tail).toEqual([replay.at(-1)]);
  });
});

describe('search, memory and rate limits', () => {
  it('finds messages in your own sessions only', async () => {
    const { app } = setup();
    const a = await (await app.request('/v1/sessions', json({}, 'tok-asha'))).json();
    await app.request(`/v1/sessions/${a.id}/messages`, json({ content: 'Plan the Lisbon offsite', stream: false }, 'tok-asha'));
    const search = async (q: string, token: string) => (await app.request(`/v1/search?q=${q}`, auth(token))).json();
    expect((await search('lisbon', 'tok-asha')).results[0]).toMatchObject({ sessionId: a.id, role: 'user' });
    expect((await search('lisbon', 'tok-ben')).results).toEqual([]);
  });

  it("lists and deletes the caller's memories", async () => {
    const memory = new InMemoryMemory();
    await memory.add('asha', 'Works in Pune');
    const ben = await memory.add('ben', 'Likes tea');
    const { app } = setup({ memory });
    const list = await (await app.request('/v1/memories', auth('tok-asha'))).json();
    expect(list.memories.map((m: { text: string }) => m.text)).toEqual(['Works in Pune']);
    expect((await app.request(`/v1/memories/${ben.id}`, { method: 'DELETE', ...auth('tok-asha') })).status).toBe(404);
    expect((await app.request(`/v1/memories/${list.memories[0].id}`, { method: 'DELETE', ...auth('tok-asha') })).status).toBe(204);
  });

  it('limits messages per user', async () => {
    const { app } = setup({ rateLimit: { windowMs: 60_000, max: 2 } });
    const s = await (await app.request('/v1/sessions', json({}, 'tok-asha'))).json();
    const send = () => app.request(`/v1/sessions/${s.id}/messages`, json({ content: 'hi', stream: false }, 'tok-asha'));
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    const third = await send();
    expect(third.status).toBe(429);
    expect(third.headers.get('Retry-After')).toBeTruthy();
  });
});
