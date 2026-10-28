import { PGlite } from '@electric-sql/pglite';
import { createHarness, mock, openSqlite, postgresDb, type SqlDb } from '@lean-harness/core';
import { describe, expect, it } from 'vitest';
import { Accounts, createServer } from '../src/index.js';

const post = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const admin = { name: 'Kevin', email: 'Kevin@Example.com', password: 'correct horse' };

describe.each([
  ['SQLite', () => openSqlite()],
  ['Postgres (PGlite)', async () => postgresDb(new PGlite())],
] as [string, () => Promise<SqlDb>][])('accounts on %s', (_, open) => {
  const setup = async () => {
    const harness = createHarness({ providers: [mock({ delayMs: 0 })], defaultModel: 'mock/echo' });
    const app = createServer(harness, { accounts: new Accounts(await open()) });
    return { app };
  };

  it('creates the admin once, then signs in with a cookie or a token', async () => {
    const { app } = await setup();
    expect(await (await app.request('/v1/auth/status')).json()).toMatchObject({ setupRequired: true, user: null });
    expect((await app.request('/v1/sessions')).status).toBe(401);

    expect((await app.request('/v1/auth/setup', post({ ...admin, password: 'short' }))).status).toBe(400);
    const res = await app.request('/v1/auth/setup', post(admin));
    expect(res.status).toBe(200);
    const cookie = res.headers.get('Set-Cookie')!;
    expect(cookie).toMatch(/lh_session=.+HttpOnly/);
    expect(cookie).toContain('SameSite=Lax');
    const { user, token } = await res.json();
    expect(user).toMatchObject({ name: 'Kevin', email: 'kevin@example.com', role: 'admin' });

    expect((await app.request('/v1/auth/setup', post({ ...admin, email: 'x@y.com' }))).status).toBe(403);
    const session = cookie.split(';')[0]!;
    expect((await app.request('/v1/sessions', { headers: { Cookie: session } })).status).toBe(200);
    expect(await (await app.request('/v1/me', { headers: bearer(token) })).json()).toMatchObject({ user: { role: 'admin' } });

    // A write with this cookie from another site is refused.
    const evil = await app.request('/v1/sessions', post({}, { Cookie: session, Origin: 'https://evil.example', Host: 'localhost' }));
    expect(evil.status).toBe(403);

    expect((await app.request('/v1/auth/login', post({ email: 'kevin@example.com', password: 'nope nope' }))).status).toBe(401);
    expect((await app.request('/v1/auth/login', post({ email: ' KEVIN@example.com', password: admin.password }))).status).toBe(200);

    await app.request('/v1/auth/logout', post({}, bearer(token)));
    expect((await app.request('/v1/sessions', { headers: bearer(token) })).status).toBe(401);
  });

  it('lets people join only by invite, and lets the admin manage them', async () => {
    const { app } = await setup();
    const { token: adminToken } = await (await app.request('/v1/auth/setup', post(admin))).json();
    const as = (token: string) => ({ headers: bearer(token) });

    const invited = await (await app.request('/v1/admin/invites', post({ email: 'asha@example.com' }, bearer(adminToken)))).json();
    expect(invited.invite).toMatchObject({ email: 'asha@example.com', role: 'member' });
    expect(await (await app.request(`/v1/auth/invites/${invited.token}`)).json()).toMatchObject({ invite: { email: 'asha@example.com' } });
    expect((await app.request('/v1/auth/invites/bogus')).status).toBe(404);

    const accept = (body: object) => app.request(`/v1/auth/invites/${invited.token}/accept`, post(body));
    expect((await accept({ name: 'Asha', email: 'other@example.com', password: 'asha password' })).status).toBe(400);
    const joined = await accept({ name: 'Asha', email: 'asha@example.com', password: 'asha password' });
    expect(joined.status).toBe(200);
    const asha = await joined.json();
    expect(asha.user.role).toBe('member');
    expect((await accept({ name: 'Asha', email: 'asha@example.com', password: 'asha password' })).status).toBe(404); // used

    // Members can't manage people.
    expect((await app.request('/v1/admin/users', as(asha.token))).status).toBe(403);
    expect((await app.request('/v1/admin/invites', post({}, bearer(asha.token)))).status).toBe(403);

    const { users } = await (await app.request('/v1/admin/users', as(adminToken))).json();
    expect(users.map((u: { email: string }) => u.email)).toEqual(['kevin@example.com', 'asha@example.com']);
    expect(JSON.stringify(users)).not.toContain('password');

    // Turning Asha off signs her out; the last admin can't be turned off.
    const ashaId = users[1].id;
    const patch = (id: string, body: object) => app.request(`/v1/admin/users/${id}`, { ...post(body, bearer(adminToken)), method: 'PATCH' });
    expect((await patch(ashaId, { disabled: true })).status).toBe(200);
    expect((await app.request('/v1/sessions', as(asha.token))).status).toBe(401);
    expect((await app.request('/v1/auth/login', post({ email: 'asha@example.com', password: 'asha password' }))).status).toBe(401);
    expect((await patch(users[0].id, { disabled: true })).status).toBe(400);

    // Invites can be listed and revoked.
    const open = await (await app.request('/v1/admin/invites', post({}, bearer(adminToken)))).json();
    expect((await (await app.request('/v1/admin/invites', as(adminToken))).json()).invites).toHaveLength(1);
    await app.request(`/v1/admin/invites/${open.invite.id}`, { method: 'DELETE', ...as(adminToken) });
    expect((await app.request(`/v1/auth/invites/${open.token}`)).status).toBe(404);

    expect((await app.request(`/v1/admin/users/${ashaId}`, { method: 'DELETE', ...as(adminToken) })).status).toBe(204);
  });

  it('resets a forgotten password with a one-time link from the admin', async () => {
    const { app } = await setup();
    const { token: adminToken } = await (await app.request('/v1/auth/setup', post(admin))).json();
    const invited = await (await app.request('/v1/admin/invites', post({}, bearer(adminToken)))).json();
    const asha = await (
      await app.request(`/v1/auth/invites/${invited.token}/accept`, post({ name: 'Asha', email: 'asha@example.com', password: 'first password' }))
    ).json();

    // Members can't make reset links.
    expect((await app.request(`/v1/admin/users/${asha.user.id}/reset`, post({}, bearer(asha.token)))).status).toBe(403);
    const link = await (await app.request(`/v1/admin/users/${asha.user.id}/reset`, post({}, bearer(adminToken)))).json();
    expect(await (await app.request(`/v1/auth/resets/${link.token}`)).json()).toEqual({ reset: { name: 'Asha', email: 'asha@example.com' } });

    expect((await app.request(`/v1/auth/resets/${link.token}`, post({ password: 'short' }))).status).toBe(400);
    const done = await app.request(`/v1/auth/resets/${link.token}`, post({ password: 'second password' }));
    expect(done.status).toBe(200);
    expect(done.headers.get('Set-Cookie')).toContain('lh_session=');

    // The link worked once; old sign-ins are gone; the new password works.
    expect((await app.request(`/v1/auth/resets/${link.token}`)).status).toBe(404);
    expect((await app.request('/v1/me', { headers: bearer(asha.token) })).status).toBe(401);
    expect((await app.request('/v1/auth/login', post({ email: 'asha@example.com', password: 'second password' }))).status).toBe(200);
  });

  it('changes passwords and signs out other devices', async () => {
    const { app } = await setup();
    const { token: first } = await (await app.request('/v1/auth/setup', post(admin))).json();
    const { token: second } = await (await app.request('/v1/auth/login', post(admin))).json();
    expect((await app.request('/v1/auth/password', post({ current: 'wrong', next: 'new password' }, bearer(first)))).status).toBe(401);
    expect((await app.request('/v1/auth/password', post({ current: admin.password, next: 'new password' }, bearer(first)))).status).toBe(204);
    expect((await app.request('/v1/me', { headers: bearer(first) })).status).toBe(200);
    expect((await app.request('/v1/me', { headers: bearer(second) })).status).toBe(401);
    expect((await app.request('/v1/auth/login', post({ ...admin, password: 'new password' }))).status).toBe(200);
  });
});

describe('app info', () => {
  it('tells any visitor the app name and starter prompts', async () => {
    const harness = createHarness({ providers: [mock({ delayMs: 0 })], defaultModel: 'mock/echo' });
    const app = createServer(harness, {
      accounts: new Accounts(await openSqlite()),
      app: { name: 'Support Desk', suggestions: [{ title: 'Find an order', icon: 'search' }] },
    });
    expect(await (await app.request('/v1/app')).json()).toEqual({ name: 'Support Desk', suggestions: [{ title: 'Find an order', icon: 'search' }] });
    expect((await app.request('/v1/sessions')).status).toBe(401);
  });
});

describe('admin setup', () => {
  it('makes only one admin when two people set up at once', async () => {
    const accounts = new Accounts(await openSqlite());
    const results = await Promise.allSettled([accounts.setup(admin), accounts.setup({ ...admin, email: 'other@example.com' })]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await accounts.listUsers()).toHaveLength(1);
  });
});

describe('sign-in throttling', () => {
  it('slows down password guessing', async () => {
    const accounts = new Accounts(await openSqlite());
    await accounts.setup(admin);
    for (let i = 0; i < 10; i++) await expect(accounts.login(admin.email, 'guess')).rejects.toMatchObject({ status: 401 });
    await expect(accounts.login(admin.email, admin.password)).rejects.toMatchObject({ status: 429 });
  });
});
