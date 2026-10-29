import { createHarness, mock, openSqlite } from '@lean-harness/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Accounts, createServer, oidc, type AccountOptions, type Email } from '../src/index.js';

const post = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const admin = { name: 'Kevin', email: 'kevin@example.com', password: 'correct horse' };

/** A server whose emails land in `inbox`. */
async function setup(options: AccountOptions = {}, server: { trustProxy?: boolean } = {}) {
  const inbox: Email[] = [];
  const accounts = new Accounts(await openSqlite(), {
    mailer: { send: async (e) => void inbox.push(e) },
    publicUrl: 'https://chat.example.com/',
    appName: 'Support Desk',
    ...options,
  });
  const harness = createHarness({ providers: [mock({ delayMs: 0 })], defaultModel: 'mock/echo' });
  const app = createServer(harness, { accounts, ...server });
  const { token } = await (await app.request('/v1/auth/setup', post(admin))).json();
  /** The link path in the newest email to `to`. */
  const linkTo = async (to: string, path: string) => {
    await vi.waitFor(() => expect(inbox.some((e) => e.to === to && e.text.includes(path))).toBe(true));
    const mail = inbox.filter((e) => e.to === to && e.text.includes(path)).at(-1)!;
    return mail.text.match(new RegExp(`https://chat\\.example\\.com(${path}[\\w-]+)`))![1]!;
  };
  return { app, accounts, inbox, adminToken: token as string, linkTo };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('email', () => {
  it('resets a forgotten password by email, without telling strangers who has an account', async () => {
    const { app, inbox, linkTo } = await setup();
    expect((await app.request('/v1/auth/forgot', post({ email: 'nobody@example.com' }))).status).toBe(202);
    expect((await app.request('/v1/auth/forgot', post({ email: 'KEVIN@example.com' }))).status).toBe(202);
    const reset = await linkTo('kevin@example.com', '/reset/');
    await settle();
    expect(inbox.filter((e) => e.to === 'nobody@example.com')).toHaveLength(0);
    expect(inbox.find((e) => e.text.includes('/reset/'))!.subject).toBe('Reset your Support Desk password');

    const token = reset.split('/').pop()!;
    expect((await app.request(`/v1/auth/resets/${token}`, post({ password: 'brand new pass' }))).status).toBe(200);
    expect((await app.request('/v1/auth/login', post({ ...admin, password: 'brand new pass' }))).status).toBe(200);
  });

  it('limits how many emails one address can be sent', async () => {
    const { app } = await setup();
    // Five an hour, counting the confirmation email sent at setup.
    for (let i = 0; i < 4; i++) expect((await app.request('/v1/auth/forgot', post({ email: admin.email }))).status).toBe(202);
    expect((await app.request('/v1/auth/forgot', post({ email: admin.email }))).status).toBe(429);
  });

  it('emails invites, and a renewed invite replaces the old link', async () => {
    const { app, adminToken, linkTo } = await setup();
    const res = await (await app.request('/v1/admin/invites', post({ email: 'asha@example.com' }, bearer(adminToken)))).json();
    expect(res.emailed).toBe(true);
    const first = await linkTo('asha@example.com', '/invite/');
    expect(first).toBe(`/invite/${res.token}`);

    const renewed = await (await app.request(`/v1/admin/invites/${res.invite.id}/renew`, post({}, bearer(adminToken)))).json();
    expect(renewed.token).not.toBe(res.token);
    expect((await app.request(`/v1/auth/invites/${res.token}`)).status).toBe(404);

    // Accepting an emailed invite proves the address.
    const joined = await (
      await app.request(`/v1/auth/invites/${renewed.token}/accept`, post({ name: 'Asha', email: 'asha@example.com', password: 'asha password' }))
    ).json();
    expect(joined.user.emailVerified).toBe(true);
  });

  it('confirms an email address, and changes it only after the new one is confirmed', async () => {
    const { app, adminToken, linkTo, inbox } = await setup();
    // The admin got a confirmation email at setup.
    const confirm = await linkTo('kevin@example.com', '/confirm-email/');
    const status = async () => (await (await app.request('/v1/auth/status', { headers: bearer(adminToken) })).json()).user;
    expect((await status()).emailVerified).toBe(false);
    expect((await app.request(`/v1/auth/email/${confirm.split('/').pop()}`, post({}))).status).toBe(200);
    expect((await status()).emailVerified).toBe(true);

    expect((await app.request('/v1/auth/email', post({ email: 'k@new.example', password: 'wrong' }, bearer(adminToken)))).status).toBe(401);
    const change = await (await app.request('/v1/auth/email', post({ email: 'k@new.example', password: admin.password }, bearer(adminToken)))).json();
    expect(change).toMatchObject({ pending: true, user: { email: 'kevin@example.com' } });
    const link = await linkTo('k@new.example', '/confirm-email/');
    await app.request(`/v1/auth/email/${link.split('/').pop()}`, post({}));
    expect(await status()).toMatchObject({ email: 'k@new.example', emailVerified: true });
    await vi.waitFor(() => expect(inbox.some((e) => e.to === 'kevin@example.com' && e.subject.includes('was changed'))).toBe(true));
  });
});

describe('sign-up', () => {
  it('is invite-only by default', async () => {
    const { app } = await setup();
    expect(await (await app.request('/v1/auth/status')).json()).toMatchObject({ email: true, signup: { mode: 'invite' } });
    expect((await app.request('/v1/auth/signup', post({ email: 'x@example.com' }))).status).toBe(403);
  });

  it('lets people with an allowed email domain sign up by confirming their address', async () => {
    const { app, adminToken, linkTo, inbox } = await setup();
    const settings = (body: unknown) => app.request('/v1/admin/settings', { ...post(body, bearer(adminToken)), method: 'PATCH' });
    expect((await settings({ signup: { mode: 'domain', domains: [] } })).status).toBe(400);
    expect((await settings({ signup: { mode: 'domain', domains: ['@Acme.com'] } })).status).toBe(200);
    expect(await (await app.request('/v1/auth/status')).json()).toMatchObject({ signup: { mode: 'domain', domains: ['acme.com'] } });

    expect((await app.request('/v1/auth/signup', post({ email: 'eve@evil.com' }))).status).toBe(403);
    expect((await app.request('/v1/auth/signup', post({ email: 'ravi@acme.com' }))).status).toBe(202);
    const link = await linkTo('ravi@acme.com', '/invite/');
    const token = link.split('/').pop()!;
    const joined = await (await app.request(`/v1/auth/invites/${token}/accept`, post({ name: 'Ravi', email: 'ravi@acme.com', password: 'ravi password' }))).json();
    expect(joined.user).toMatchObject({ role: 'member', emailVerified: true });

    // Signing up again with an existing address sends a "you already have an account" email instead.
    await app.request('/v1/auth/signup', post({ email: 'ravi@acme.com' }));
    await vi.waitFor(() => expect(inbox.some((e) => e.subject.includes('already have'))).toBe(true));
    // Sign-up links aren't listed with the admin's invites.
    expect((await (await app.request('/v1/admin/invites', { headers: bearer(adminToken) })).json()).invites).toEqual([]);
  });
});

describe('your account', () => {
  it('renames, and deletes itself unless it is the last admin', async () => {
    const { app, adminToken } = await setup();
    const renamed = await (await app.request('/v1/auth/me', { ...post({ name: 'Kev' }, bearer(adminToken)), method: 'PATCH' })).json();
    expect(renamed.user.name).toBe('Kev');
    expect((await app.request('/v1/auth/me', { ...post({ password: admin.password }, bearer(adminToken)), method: 'DELETE' })).status).toBe(400);

    const invite = await (await app.request('/v1/admin/invites', post({}, bearer(adminToken)))).json();
    const asha = await (await app.request(`/v1/auth/invites/${invite.token}/accept`, post({ name: 'Asha', email: 'asha@example.com', password: 'asha password' }))).json();
    expect((await app.request('/v1/auth/me', { ...post({ password: 'wrong' }, bearer(asha.token)), method: 'DELETE' })).status).toBe(401);
    expect((await app.request('/v1/auth/me', { ...post({ password: 'asha password' }, bearer(asha.token)), method: 'DELETE' })).status).toBe(204);
    expect((await app.request('/v1/auth/login', post({ email: 'asha@example.com', password: 'asha password' }))).status).toBe(401);
  });

  it('keeps the browser signed in for the configured time', async () => {
    const { app } = await setup({ sessionDays: 2 });
    const res = await app.request('/v1/auth/login', post(admin));
    expect(res.headers.get('Set-Cookie')).toContain(`Max-Age=${2 * 86_400}`);
  });
});

describe('sign-in limits', () => {
  it("blocks guessing one person's password without locking them out elsewhere", async () => {
    const { app } = await setup({}, { trustProxy: true });
    const from = (ip: string, password: string) => app.request('/v1/auth/login', post({ email: admin.email, password }, { 'X-Forwarded-For': ip }));
    for (let i = 0; i < 10; i++) expect((await from('203.0.113.9', 'guess')).status).toBe(401);
    expect((await from('203.0.113.9', admin.password)).status).toBe(429);
    expect((await from('198.51.100.4', admin.password)).status).toBe(200);
  });
});

describe('activity log', () => {
  it('records sign-ins and admin actions for the admin to read', async () => {
    const { app, adminToken } = await setup();
    await app.request('/v1/auth/login', post({ ...admin, password: 'wrong password' }));
    await app.request('/v1/admin/invites', post({ email: 'asha@example.com' }, bearer(adminToken)));
    const { activity } = await (await app.request('/v1/admin/activity', { headers: bearer(adminToken) })).json();
    expect(activity.map((a: { action: string }) => a.action)).toEqual(['invite_created', 'sign_in_failed', 'setup']);
    expect(activity[0]).toMatchObject({ actor: 'kevin@example.com', target: 'asha@example.com' });
  });

  it('clears expired sign-ins and links', async () => {
    const db = await openSqlite();
    const accounts = new Accounts(db);
    await accounts.setup(admin);
    await db.query("UPDATE lh_auth_sessions SET expires_at = '2000-01-01'");
    await accounts.prune();
    expect(await db.query('SELECT * FROM lh_auth_sessions')).toHaveLength(0);
  });
});

describe('single sign-on', () => {
  const issuer = 'https://id.example';
  let claims: Record<string, unknown> = {};
  let nonce = '';
  const realFetch = globalThis.fetch;
  afterEach(() => vi.restoreAllMocks());

  /** A provider that signs in whoever `claims` says. */
  const fakeProvider = () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === `${issuer}/.well-known/openid-configuration`) {
        return Response.json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token` });
      }
      if (url === `${issuer}/token`) {
        const body = new URLSearchParams(String(init?.body));
        if (body.get('code') !== 'good-code' || !body.get('code_verifier')) return Response.json({ error: 'invalid_grant' }, { status: 400 });
        const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
        const idToken = `${part({ alg: 'RS256' })}.${part({ iss: issuer, aud: 'client-1', exp: Date.now() / 1000 + 300, nonce, ...claims })}.sig`;
        return Response.json({ id_token: idToken });
      }
      return realFetch(input, init);
    });
    return oidc({ id: 'acme', name: 'Acme SSO', issuer, clientId: 'client-1', clientSecret: 'secret' });
  };

  /** Click "Continue with Acme SSO", sign in at the provider, come back. Returns where the browser lands. */
  const signInVia = async (app: Awaited<ReturnType<typeof setup>>['app'], query = '', state?: string) => {
    const start = await app.request(`/v1/auth/sso/acme${query}`);
    expect(start.status).toBe(302);
    const to = new URL(start.headers.get('Location')!);
    nonce = to.searchParams.get('nonce')!;
    expect(to.searchParams.get('code_challenge_method')).toBe('S256');
    expect(to.searchParams.get('redirect_uri')).toBe('https://chat.example.com/v1/auth/sso/acme/callback');
    const cookie = start.headers.get('Set-Cookie')!.split(';')[0]!;
    const back = await app.request(`/v1/auth/sso/acme/callback?code=good-code&state=${state ?? to.searchParams.get('state')}`, { headers: { Cookie: cookie } });
    return { location: decodeURIComponent(back.headers.get('Location') ?? ''), cookie: back.headers.get('Set-Cookie') ?? '' };
  };

  it('signs in existing people by verified email, and new people only when sign-up allows', async () => {
    const sso = fakeProvider();
    const { app, accounts } = await setup({ sso: [sso] });
    expect((await (await app.request('/v1/auth/status')).json()).providers).toEqual([{ id: 'acme', name: 'Acme SSO' }]);

    claims = { sub: 'u-1', email: 'kevin@example.com', email_verified: true, name: 'Kevin' };
    const kevin = await signInVia(app, '?next=/c/abc');
    expect(kevin.location).toBe('/c/abc');
    expect(kevin.cookie).toContain('lh_session=');

    claims = { sub: 'u-2', email: 'new@acme.com', email_verified: true, name: 'New Person' };
    expect((await signInVia(app)).location).toContain('signin_error=No account for new@acme.com');
    await accounts.setSignupPolicy({ mode: 'domain', domains: ['acme.com'] });
    expect((await signInVia(app)).location).toBe('/');
    expect(await accounts.userByEmail('new@acme.com')).toMatchObject({ name: 'New Person', emailVerified: true, hasPassword: false });

    claims = { sub: 'u-3', email: 'unverified@acme.com', email_verified: false };
    expect((await signInVia(app)).location).toContain("didn't confirm your email");
  });

  it('refuses a sign-in finished in another browser, and joins by invite', async () => {
    const sso = fakeProvider();
    const { app, adminToken } = await setup({ sso: [sso] });
    claims = { sub: 'u-9', email: 'guest@other.org', email_verified: true };
    expect((await signInVia(app, '', 'someone-elses-state')).location).toContain('another browser');

    const invite = await (await app.request('/v1/admin/invites', post({}, bearer(adminToken)))).json();
    expect((await signInVia(app, `?invite=${invite.token}`)).location).toBe('/');
    expect((await app.request(`/v1/auth/invites/${invite.token}`)).status).toBe(404);
  });

  it('takes an unconfirmed account back for the real owner of the email', async () => {
    const sso = fakeProvider();
    const { app, adminToken, accounts } = await setup({ sso: [sso], mailer: undefined });
    // Someone used an open invite link with an address that isn't theirs.
    const invite = await (await app.request('/v1/admin/invites', post({}, bearer(adminToken)))).json();
    const squatter = await (
      await app.request(`/v1/auth/invites/${invite.token}/accept`, post({ name: 'Not Pat', email: 'pat@acme.com', password: 'squatter pass' }))
    ).json();
    claims = { sub: 'pat', email: 'pat@acme.com', email_verified: true };
    await signInVia(app);
    expect((await app.request('/v1/me', { headers: bearer(squatter.token) })).status).toBe(401);
    expect((await app.request('/v1/auth/login', post({ email: 'pat@acme.com', password: 'squatter pass' }))).status).toBe(401);
    expect(await accounts.userByEmail('pat@acme.com')).toMatchObject({ emailVerified: true, hasPassword: false });
  });
});

describe('on Postgres', () => {
  it('upgrades an older accounts table and counts attempts', async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    const { postgresDb } = await import('@lean-harness/core');
    const db = postgresDb(new PGlite());
    // The table as the first release made it.
    await db.query(`CREATE TABLE lh_users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL,
      role TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`);
    const accounts = new Accounts(db);
    await accounts.setup(admin);
    for (let i = 0; i < 10; i++) await expect(accounts.login(admin.email, 'guess', '10.0.0.1')).rejects.toMatchObject({ status: 401 });
    await expect(accounts.login(admin.email, admin.password, '10.0.0.1')).rejects.toMatchObject({ status: 429 });
    expect((await accounts.login(admin.email, admin.password, '10.0.0.2')).account).toMatchObject({ emailVerified: false, hasPassword: true });
    expect((await accounts.activity()).length).toBe(12);
  });
});
