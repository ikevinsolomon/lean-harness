import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { Accounts, AccountError, type Account } from './accounts.js';
import { bearer, type User } from './auth.js';

export const SESSION_COOKIE = 'lh_session';
const SSO_COOKIE = 'lh_sso';

type Env = { Variables: { user: User | null } };

const Credentials = z.object({ email: z.string().max(254), password: z.string().max(200) });
const NewAccount = Credentials.extend({ name: z.string().max(100) });
const PasswordChange = z.object({ current: z.string().max(200).optional(), next: z.string().max(200) });
const NewInvite = z.object({ email: z.string().max(254).optional(), role: z.enum(['admin', 'member']).optional() });
const NewPassword = z.object({ password: z.string().max(200) });
const EmailOnly = z.object({ email: z.string().max(254) });
const EmailChange = z.object({ email: z.string().max(254), password: z.string().max(200).optional() });
const Profile = z.object({ name: z.string().max(100) });
const Confirm = z.object({ password: z.string().max(200).optional() });
const UserChange = z.object({ disabled: z.boolean().optional(), role: z.enum(['admin', 'member']).optional() });
const Settings = z.object({ signup: z.object({ mode: z.enum(['invite', 'domain', 'open']), domains: z.array(z.string().max(253)).max(50) }) });

/** Paths anyone may call, signed in or not. */
export const isPublicAuthPath = (path: string) =>
  /\/auth\/(status|setup|login|logout|forgot|signup|(invites|resets|email)\/[^/]+(\/accept)?|sso\/[\w-]+(\/callback)?)$/.test(path);

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

/** Only paths inside this app, never another site: `/c/123`, not `//evil.com` or `https://...`. */
const safeNext = (value: string | undefined) => (value && /^\/(?![/\\])[^\s]*$/.test(value) && value.length < 500 ? value : '/');

export interface AccountRouteOptions {
  /** Read the visitor's IP from X-Forwarded-For (behind a proxy or load balancer you run). */
  trustProxy?: boolean;
}

export function accountRoutes(api: Hono<Env>, accounts: Accounts, options: AccountRouteOptions = {}) {
  /** The visitor's IP address, for limits on attempts and the activity log. */
  const ip = (c: Context) => {
    if (options.trustProxy) {
      const forwarded = c.req.header('X-Forwarded-For')?.split(',')[0]?.trim();
      if (forwarded) return forwarded;
    }
    try {
      return getConnInfo(c).remote.address ?? '';
    } catch {
      return ''; // not running on Node's HTTP server (tests)
    }
  };
  const secure = (c: Context) => c.req.url.startsWith('https:') || c.req.header('X-Forwarded-Proto') === 'https';

  const setSession = (c: Context, result: { token: string }) =>
    setCookie(c, SESSION_COOKIE, result.token, { httpOnly: true, sameSite: 'Lax', secure: secure(c), path: '/', maxAge: accounts.sessionSeconds });

  const signIn = (c: Context, result: { account: Account; token: string }) => {
    setSession(c, result);
    return c.json({ user: Accounts.user(result.account), token: result.token });
  };

  const me = (c: Context<Env>) => c.get('user')!;

  const admin = (c: Context<Env>) => {
    if (c.get('user')?.role !== 'admin') throw new AccountError(403, 'Only an admin can do that');
    return c.get('user')!.email;
  };

  api.get('/auth/status', async (c) => {
    const account = await accounts.accountForToken(sessionToken(c));
    const signup = await accounts.signupPolicy();
    return c.json({
      accounts: true,
      setupRequired: await accounts.setupRequired(),
      user: account ? Accounts.user(account) : null,
      email: accounts.canEmail,
      signup: { mode: signup.mode, domains: signup.mode === 'domain' ? signup.domains : [] },
      providers: accounts.providers,
    });
  });

  api.post('/auth/setup', async (c) => signIn(c, await accounts.setup(NewAccount.parse(await c.req.json()), ip(c))));

  api.post('/auth/login', async (c) => {
    const body = Credentials.parse(await c.req.json());
    return signIn(c, await accounts.login(body.email, body.password, ip(c)));
  });

  api.post('/auth/logout', async (c) => {
    await accounts.logout(sessionToken(c), ip(c));
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.body(null, 204);
  });

  // "Forgot password?" and sign-up answer the same whether or not the email has an account.
  api.post('/auth/forgot', async (c) => {
    await accounts.requestReset(EmailOnly.parse(await c.req.json()).email, ip(c));
    return c.body(null, 202);
  });

  api.post('/auth/signup', async (c) => {
    await accounts.requestSignup(EmailOnly.parse(await c.req.json()).email, ip(c));
    return c.body(null, 202);
  });

  // ── Your own account ──

  api.patch('/auth/me', async (c) => c.json({ user: Accounts.user(await accounts.updateProfile(me(c).id, Profile.parse(await c.req.json()))) }));

  api.delete('/auth/me', async (c) => {
    await accounts.deleteSelf(me(c).id, Confirm.parse(await c.req.json().catch(() => ({}))).password, ip(c));
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.body(null, 204);
  });

  api.post('/auth/password', async (c) => {
    const body = PasswordChange.parse(await c.req.json());
    await accounts.changePassword(me(c).id, body.current, body.next, sessionToken(c), ip(c));
    return c.body(null, 204);
  });

  api.post('/auth/email', async (c) => {
    const { pending, account } = await accounts.changeEmail(me(c).id, EmailChange.parse(await c.req.json()), ip(c));
    return c.json({ pending, user: Accounts.user(account) });
  });

  api.post('/auth/verify', async (c) => {
    await accounts.sendVerification(me(c).id, ip(c));
    return c.body(null, 202);
  });

  // The link in a confirmation email. A POST, so link scanners that open emails don't use it up.
  api.post('/auth/email/:token', async (c) => c.json({ user: Accounts.user(await accounts.confirmEmail(c.req.param('token'), ip(c))) }));

  // ── Invite and reset links ──

  api.get('/auth/invites/:token', async (c) => {
    const invite = await accounts.invite(c.req.param('token'));
    if (!invite) throw new AccountError(404, 'This invite link has expired or was already used');
    return c.json({ invite: { email: invite.email, role: invite.role, expiresAt: invite.expiresAt } });
  });

  api.post('/auth/invites/:token/accept', async (c) =>
    signIn(c, await accounts.acceptInvite(c.req.param('token'), NewAccount.parse(await c.req.json()), ip(c))),
  );

  api.get('/auth/resets/:token', async (c) => {
    const account = await accounts.resetFor(c.req.param('token'));
    if (!account) throw new AccountError(404, 'This reset link has expired or was already used');
    return c.json({ reset: { name: account.name, email: account.email } });
  });

  api.post('/auth/resets/:token', async (c) =>
    signIn(c, await accounts.resetPassword(c.req.param('token'), NewPassword.parse(await c.req.json()).password, ip(c))),
  );

  // ── Google / Microsoft / OIDC: browser redirects, so errors go back to the sign-in page ──

  const ssoError = (c: Context, error: unknown) => {
    const message = error instanceof AccountError ? error.message : 'Sign-in failed. Try again.';
    if (!(error instanceof AccountError)) console.error(error);
    return c.redirect(`/?signin_error=${encodeURIComponent(message)}`);
  };

  api.get('/auth/sso/:provider', async (c) => {
    try {
      const origin = accounts.publicUrl ?? new URL(c.req.url).origin;
      const { url, state } = await accounts.startSso(c.req.param('provider'), {
        redirectUri: `${origin}${c.req.path}/callback`,
        invite: c.req.query('invite') || undefined,
        next: safeNext(c.req.query('next')),
      });
      setCookie(c, SSO_COOKIE, state, { httpOnly: true, sameSite: 'Lax', secure: secure(c), path: `${c.req.path}/callback`, maxAge: 600 });
      return c.redirect(url);
    } catch (error) {
      return ssoError(c, error);
    }
  });

  api.get('/auth/sso/:provider/callback', async (c) => {
    const browserState = getCookie(c, SSO_COOKIE);
    deleteCookie(c, SSO_COOKIE, { path: c.req.path });
    try {
      const failed = c.req.query('error_description') ?? c.req.query('error');
      if (failed) throw new AccountError(401, failed === 'access_denied' ? 'Sign-in was cancelled' : `Sign-in failed: ${failed}`);
      const result = await accounts.finishSso(
        c.req.param('provider'),
        { code: c.req.query('code') ?? '', state: c.req.query('state') ?? '', browserState },
        ip(c),
      );
      setSession(c, result);
      return c.redirect(safeNext(result.next));
    } catch (error) {
      return ssoError(c, error);
    }
  });

  // ── Admin ──

  // A one-time link for someone who forgot their password.
  api.post('/admin/users/:id/reset', async (c) => c.json(await accounts.createResetLink(c.req.param('id'), admin(c), ip(c)), 201));

  api.get('/admin/users', async (c) => {
    admin(c);
    return c.json({ users: await accounts.listUsers() });
  });

  api.patch('/admin/users/:id', async (c) => {
    const actor = admin(c);
    return c.json(await accounts.updateUser(c.req.param('id'), UserChange.parse(await c.req.json()), actor, ip(c)));
  });

  api.delete('/admin/users/:id', async (c) => {
    await accounts.deleteUser(c.req.param('id'), admin(c), ip(c));
    return c.body(null, 204);
  });

  api.get('/admin/invites', async (c) => {
    admin(c);
    return c.json({ invites: await accounts.listInvites() });
  });

  api.post('/admin/invites', async (c) => {
    const actor = admin(c);
    const body = NewInvite.parse(await c.req.json().catch(() => ({})));
    return c.json(await accounts.createInvite(me(c).id, { ...body, email: body.email || undefined }, actor, ip(c)), 201);
  });

  api.post('/admin/invites/:id/renew', async (c) => c.json(await accounts.renewInvite(c.req.param('id'), admin(c), ip(c))));

  api.delete('/admin/invites/:id', async (c) => {
    await accounts.revokeInvite(c.req.param('id'), admin(c), ip(c));
    return c.body(null, 204);
  });

  api.get('/admin/settings', async (c) => {
    admin(c);
    return c.json({ signup: await accounts.signupPolicy(), email: accounts.canEmail, providers: accounts.providers });
  });

  api.patch('/admin/settings', async (c) => {
    const actor = admin(c);
    const body = Settings.parse(await c.req.json());
    return c.json({ signup: await accounts.setSignupPolicy(body.signup, actor, ip(c)) });
  });

  api.get('/admin/activity', async (c) => {
    admin(c);
    return c.json({ activity: await accounts.activity({ before: c.req.query('before'), limit: Number(c.req.query('limit')) || undefined }) });
  });
}
