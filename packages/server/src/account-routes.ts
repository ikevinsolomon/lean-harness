import type { Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { Accounts, AccountError, type Account } from './accounts.js';
import { bearer, type User } from './auth.js';

export const SESSION_COOKIE = 'lh_session';

type Env = { Variables: { user: User | null } };

const Credentials = z.object({ email: z.string().max(254), password: z.string().max(200) });
const NewAccount = Credentials.extend({ name: z.string().max(100) });
const PasswordChange = z.object({ current: z.string().max(200), next: z.string().max(200) });
const NewInvite = z.object({ email: z.string().max(254).optional(), role: z.enum(['admin', 'member']).optional() });
const NewPassword = z.object({ password: z.string().max(200) });
const UserChange = z.object({ disabled: z.boolean().optional(), role: z.enum(['admin', 'member']).optional() });

/** Paths anyone may call, signed in or not. */
export const isPublicAuthPath = (path: string) => /\/auth\/(status|setup|login|logout|(invites|resets)\/[^/]+(\/accept)?)$/.test(path);

/** The sign-in token on a request: the session cookie (browsers) or a Bearer token (other clients). */
export const sessionToken = (c: Context) => getCookie(c, SESSION_COOKIE) ?? bearer(c.req.raw);

/**
 * A cookie-authenticated write must come from this site. SameSite=Lax already blocks most
 * cross-site requests; this also covers sibling subdomains and old browsers.
 */
export function crossSite(c: Context): boolean {
  if (c.req.method === 'GET' || c.req.method === 'HEAD' || !getCookie(c, SESSION_COOKIE)) return false;
  const origin = c.req.header('Origin');
  if (!origin) return false;
  const host = c.req.header('X-Forwarded-Host') ?? c.req.header('Host');
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

export function accountRoutes(api: Hono<Env>, accounts: Accounts) {
  const signIn = (c: Context, result: { account: Account; token: string }) => {
    const secure = c.req.url.startsWith('https:') || c.req.header('X-Forwarded-Proto') === 'https';
    setCookie(c, SESSION_COOKIE, result.token, { httpOnly: true, sameSite: 'Lax', secure, path: '/', maxAge: 30 * 86_400 });
    return c.json({ user: Accounts.user(result.account), token: result.token });
  };

  const admin = (c: Context<Env>) => {
    if (c.get('user')?.role !== 'admin') throw new AccountError(403, 'Only the admin can do that');
  };

  api.get('/auth/status', async (c) => {
    const account = await accounts.accountForToken(sessionToken(c));
    return c.json({ accounts: true, setupRequired: await accounts.setupRequired(), user: account ? Accounts.user(account) : null });
  });

  api.post('/auth/setup', async (c) => signIn(c, await accounts.setup(NewAccount.parse(await c.req.json()))));

  api.post('/auth/login', async (c) => {
    const body = Credentials.parse(await c.req.json());
    return signIn(c, await accounts.login(body.email, body.password));
  });

  api.post('/auth/logout', async (c) => {
    await accounts.logout(sessionToken(c));
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.body(null, 204);
  });

  api.post('/auth/password', async (c) => {
    const body = PasswordChange.parse(await c.req.json());
    await accounts.changePassword(c.get('user')!.id, body.current, body.next, sessionToken(c));
    return c.body(null, 204);
  });

  api.get('/auth/invites/:token', async (c) => {
    const invite = await accounts.invite(c.req.param('token'));
    if (!invite) throw new AccountError(404, 'This invite link has expired or was already used');
    return c.json({ invite: { email: invite.email, role: invite.role, expiresAt: invite.expiresAt } });
  });

  api.post('/auth/invites/:token/accept', async (c) =>
    signIn(c, await accounts.acceptInvite(c.req.param('token'), NewAccount.parse(await c.req.json()))),
  );

  api.get('/auth/resets/:token', async (c) => {
    const account = await accounts.resetFor(c.req.param('token'));
    if (!account) throw new AccountError(404, 'This reset link has expired or was already used');
    return c.json({ reset: { name: account.name, email: account.email } });
  });

  api.post('/auth/resets/:token', async (c) =>
    signIn(c, await accounts.resetPassword(c.req.param('token'), NewPassword.parse(await c.req.json()).password)),
  );

  // Admin: a one-time link for someone who forgot their password.
  api.post('/admin/users/:id/reset', async (c) => {
    admin(c);
    return c.json(await accounts.createResetLink(c.req.param('id')), 201);
  });

  api.get('/admin/users', async (c) => {
    admin(c);
    return c.json({ users: await accounts.listUsers() });
  });

  api.patch('/admin/users/:id', async (c) => {
    admin(c);
    return c.json(await accounts.updateUser(c.req.param('id'), UserChange.parse(await c.req.json())));
  });

  api.delete('/admin/users/:id', async (c) => {
    admin(c);
    await accounts.deleteUser(c.req.param('id'));
    return c.body(null, 204);
  });

  api.get('/admin/invites', async (c) => {
    admin(c);
    return c.json({ invites: await accounts.listInvites() });
  });

  api.post('/admin/invites', async (c) => {
    admin(c);
    const body = NewInvite.parse(await c.req.json().catch(() => ({})));
    return c.json(await accounts.createInvite(c.get('user')!.id, { ...body, email: body.email || undefined }), 201);
  });

  api.delete('/admin/invites/:id', async (c) => {
    admin(c);
    await accounts.revokeInvite(c.req.param('id'));
    return c.body(null, 204);
  });
}
