import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { SqlDb } from '@lean-harness/core';
import type { User } from './auth.js';
import { linkEmail, type Mailer } from './mail.js';
import { authorizeUrl, redeemCode, type SsoProvider } from './sso.js';

/**
 * Accounts: email and password, sign-in with Google/Microsoft/OIDC, invite links, sign-up
 * (open, or for your email domains), password resets, email confirmation and an activity log.
 * The first account (created on a fresh server) is the admin. Passwords are hashed with scrypt;
 * every token (sign-ins, invites, resets, email links) is random and stored only as a hash.
 */

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export type Role = 'admin' | 'member';

export interface Account {
  id: string;
  email: string;
  name: string;
  role: Role;
  disabled: boolean;
  createdAt: string;
  /** The person proved they read this address (an emailed link, or Google/Microsoft vouching for it). */
  emailVerified: boolean;
  /** False for people who only sign in with Google/Microsoft/OIDC. */
  hasPassword: boolean;
  lastSignInAt?: string;
}

export interface Invite {
  id: string;
  email?: string;
  role: Role;
  createdAt: string;
  expiresAt: string;
}

/** Who may create an account without an invite. */
export interface SignupPolicy {
  /** `invite`: only people the admin invites (default). `domain`: anyone with an email at `domains`. `open`: anyone. */
  mode: 'invite' | 'domain' | 'open';
  domains: string[];
}

export interface ActivityEntry {
  id: string;
  at: string;
  /** Who did it (their email), or null for someone not signed in. */
  actor: string | null;
  action: string;
  /** Who or what it was done to, usually an email. */
  target: string | null;
  ip: string | null;
}

export class AccountError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 429,
    message: string,
  ) {
    super(message);
  }
}

export interface AccountOptions {
  /** How long a sign-in lasts (default 30 days). */
  sessionDays?: number;
  /** How long an invite link works (default 7 days). */
  inviteDays?: number;
  /** Runs once the admin account exists, e.g. to give it the chats made before sign-in was on. */
  onSetup?(admin: Account): void | Promise<void>;
  /** Sends invites, password resets, sign-up and confirmation links. Without it, admins copy links by hand. */
  mailer?: Mailer;
  /** The app's address, for links in emails: `https://chat.example.com`. Required with `mailer`. */
  publicUrl?: string;
  /** The app's name in email subjects (default "Lean Harness"). */
  appName?: string;
  /** Who may sign up without an invite, until the admin changes it in People (default: invite only). */
  signup?: SignupPolicy;
  /** "Continue with Google / Microsoft / ..." buttons. */
  sso?: SsoProvider[];
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const now = () => new Date().toISOString();
const later = (ms: number) => new Date(Date.now() + ms).toISOString();

function email(value: string): string {
  const e = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 254) throw new AccountError(400, 'Enter a valid email address');
  return e;
}

function password(value: string): string {
  if (value.length < 8) throw new AccountError(400, 'Use a password of at least 8 characters');
  if (value.length > 200) throw new AccountError(400, 'That password is too long');
  return value;
}

function name(value: string): string {
  const n = value.trim();
  if (!n || n.length > 100) throw new AccountError(400, 'Enter your name');
  return n;
}

const domainOf = (address: string) => address.slice(address.lastIndexOf('@') + 1);

async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(plain, salt, 32);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [scheme, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await scrypt(plain, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

/** A dummy hash, so a sign-in for an unknown email takes as long as one for a real account. */
const NO_PASSWORD = hashPassword('no password set');

/** Limits on repeated attempts: [key prefix, how many, per how long]. */
const LIMITS = {
  /** Wrong passwords for one email from one address. Counting per pair means a stranger can't lock you out. */
  login: [10, 15 * 60_000],
  /** Wrong passwords from one address, across all emails. */
  loginIp: [100, 15 * 60_000],
  /** Emails (resets, sign-ups) to one address. */
  mail: [5, HOUR],
  /** Emails requested from one address. */
  mailIp: [30, HOUR],
} as const;

export class Accounts {
  private ready?: Promise<void>;
  /** How long a sign-in lasts, in seconds (for the cookie). */
  readonly sessionSeconds: number;
  private readonly sessionMs: number;
  private readonly inviteMs: number;
  private prunedAt = 0;
  /** Setup runs one at a time, so two first visitors can't both become admin. */
  private setupQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly db: SqlDb,
    private readonly options: AccountOptions = {},
  ) {
    this.sessionMs = (options.sessionDays ?? 30) * DAY;
    this.sessionSeconds = Math.round(this.sessionMs / 1000);
    this.inviteMs = (options.inviteDays ?? 7) * DAY;
  }

  /** Whether emails can be sent (forgot password, sign-up by email, emailed invites). */
  get canEmail() {
    return Boolean(this.options.mailer);
  }

  /** The app's address for emailed links, without a trailing slash. */
  get publicUrl(): string | undefined {
    return this.options.publicUrl?.replace(/\/$/, '') || undefined;
  }

  get providers(): { id: string; name: string }[] {
    return (this.options.sso ?? []).map((p) => ({ id: p.id, name: p.name }));
  }

  private async migrate() {
    const q = (sql: string) => this.db.query(sql);
    await q(`CREATE TABLE IF NOT EXISTS lh_users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL,
      role TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`);
    await q(`CREATE TABLE IF NOT EXISTS lh_auth_sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL)`);
    await q(`CREATE TABLE IF NOT EXISTS lh_invites (
      id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, email TEXT, role TEXT NOT NULL, created_by TEXT NOT NULL,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT)`);
    await q(`CREATE TABLE IF NOT EXISTS lh_password_resets (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL)`);
    await q(`CREATE TABLE IF NOT EXISTS lh_email_tokens (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, email TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL)`);
    await q(`CREATE TABLE IF NOT EXISTS lh_identities (
      provider TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (provider, subject))`);
    await q(`CREATE TABLE IF NOT EXISTS lh_sso_states (state_hash TEXT PRIMARY KEY, data TEXT NOT NULL, expires_at TEXT NOT NULL)`);
    await q(`CREATE TABLE IF NOT EXISTS lh_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until TEXT NOT NULL)`);
    await q(`CREATE TABLE IF NOT EXISTS lh_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    await q(`CREATE TABLE IF NOT EXISTS lh_activity (
      id TEXT PRIMARY KEY, at TEXT NOT NULL, actor TEXT, action TEXT NOT NULL, target TEXT, ip TEXT)`);
    await q('CREATE INDEX IF NOT EXISTS lh_activity_at ON lh_activity (at)');
    // Columns added after the first release.
    for (const [table, column] of [
      ['lh_users', 'email_verified INTEGER NOT NULL DEFAULT 0'],
      ['lh_users', 'last_sign_in_at TEXT'],
      ['lh_invites', 'emailed INTEGER NOT NULL DEFAULT 0'],
    ]) {
      if (this.db.dialect === 'postgres') await q(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column}`);
      else await q(`ALTER TABLE ${table} ADD COLUMN ${column}`).catch(() => undefined); // already there
    }
  }

  private async q(sql: string, params: unknown[] = []) {
    this.ready ??= this.migrate();
    await this.ready;
    if (Date.now() - this.prunedAt > HOUR) {
      this.prunedAt = Date.now();
      void this.prune().catch((e) => console.error('Clearing expired sign-ins failed:', e));
    }
    return this.db.query(sql, params);
  }

  /** Delete what has expired: sign-ins, links, attempt counters, and activity older than a year. */
  async prune() {
    const t = now();
    for (const table of ['lh_auth_sessions', 'lh_invites', 'lh_password_resets', 'lh_email_tokens', 'lh_sso_states']) {
      await this.db.query(`DELETE FROM ${table} WHERE expires_at < ?`, [t]);
    }
    await this.db.query('DELETE FROM lh_attempts WHERE until < ?', [t]);
    await this.db.query('DELETE FROM lh_activity WHERE at < ?', [new Date(Date.now() - 365 * DAY).toISOString()]);
  }

  private account(row: Record<string, unknown>): Account {
    return {
      id: String(row.id),
      email: String(row.email),
      name: String(row.name),
      role: row.role === 'admin' ? 'admin' : 'member',
      disabled: Boolean(Number(row.disabled)),
      createdAt: String(row.created_at),
      emailVerified: Boolean(Number(row.email_verified)),
      hasPassword: Boolean(row.password_hash),
      ...(row.last_sign_in_at ? { lastSignInAt: String(row.last_sign_in_at) } : {}),
    };
  }

  /** As a request's user: who they are and whether they are the admin. */
  static user(account: Account): User & { role: Role; emailVerified: boolean; hasPassword: boolean } {
    return { id: account.id, name: account.name, email: account.email, role: account.role, emailVerified: account.emailVerified, hasPassword: account.hasPassword };
  }

  // ── Limits on repeated attempts (stored in the database, so they hold across servers) ──

  private async overLimit(key: string, max: number) {
    const [row] = await this.q('SELECT count, until FROM lh_attempts WHERE key = ?', [key]);
    return Boolean(row && Number(row.count) >= max && String(row.until) > now());
  }

  private async count(key: string, windowMs: number) {
    const t = now();
    await this.q(
      `INSERT INTO lh_attempts (key, count, until) VALUES (?, 1, ?)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN lh_attempts.until < ? THEN 1 ELSE lh_attempts.count + 1 END,
         until = CASE WHEN lh_attempts.until < ? THEN ? ELSE lh_attempts.until END`,
      [key, later(windowMs), t, t, later(windowMs)],
    );
  }

  /** Count an email request (reset, sign-up); refuse when there have been too many. */
  private async limitMail(address: string, ip: string) {
    const [max, window] = LIMITS.mail;
    const [ipMax, ipWindow] = LIMITS.mailIp;
    if ((await this.overLimit(`mail:${address}`, max)) || (ip && (await this.overLimit(`mail-ip:${ip}`, ipMax)))) {
      throw new AccountError(429, 'Too many emails requested. Try again in an hour.');
    }
    await this.count(`mail:${address}`, window);
    if (ip) await this.count(`mail-ip:${ip}`, ipWindow);
  }

  // ── Activity log ──

  /** Record something that happened. `actor` and `target` are emails (kept even after the account is removed). */
  async log(action: string, entry: { actor?: string | null; target?: string | null; ip?: string } = {}) {
    await this.q('INSERT INTO lh_activity (id, at, actor, action, target, ip) VALUES (?, ?, ?, ?, ?, ?)', [
      randomUUID(),
      now(),
      entry.actor ?? null,
      action,
      entry.target ?? null,
      entry.ip || null,
    ]);
  }

  /** Newest first. Pass the last entry's `at` as `before` for the next page. */
  async activity(options: { before?: string; limit?: number } = {}): Promise<ActivityEntry[]> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const rows = await this.q(`SELECT * FROM lh_activity WHERE at < ? ORDER BY at DESC LIMIT ${limit}`, [options.before ?? '9999']);
    return rows.map((r) => ({
      id: String(r.id),
      at: String(r.at),
      actor: r.actor == null ? null : String(r.actor),
      action: String(r.action),
      target: r.target == null ? null : String(r.target),
      ip: r.ip == null ? null : String(r.ip),
    }));
  }

  // ── Email ──

  private link(path: string) {
    const base = this.publicUrl;
    if (!base) throw new Error('Set publicUrl (PUBLIC_URL) so emailed links point at your app');
    return `${base}${path}`;
  }

  private get appName() {
    return this.options.appName ?? 'Lean Harness';
  }

  /** Send in the background: the answer doesn't wait (or tell anyone) whether an account exists. */
  private sendLater(work: () => Promise<Parameters<Mailer['send']>[0] | null>) {
    void work()
      .then((mail) => mail && this.options.mailer?.send(mail))
      .catch((e: Error) => console.error(`Sending an email failed: ${e.message}`));
  }

  // ── Accounts ──

  /** True on a fresh server, before the admin account exists. */
  async setupRequired(): Promise<boolean> {
    return (await this.q('SELECT COUNT(*) AS n FROM lh_users'))[0]?.n == 0;
  }

  private async create(input: { name: string; email: string; password?: string }, role: Role, verified: boolean): Promise<Account> {
    const at = now();
    const account: Account = {
      id: randomUUID(),
      email: email(input.email),
      name: name(input.name),
      role,
      disabled: false,
      createdAt: at,
      emailVerified: verified,
      hasPassword: input.password !== undefined,
    };
    if ((await this.q('SELECT id FROM lh_users WHERE email = ?', [account.email])).length) {
      throw new AccountError(409, 'An account with that email already exists. Sign in instead.');
    }
    await this.q(
      'INSERT INTO lh_users (id, email, name, password_hash, role, disabled, created_at, email_verified) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
      [account.id, account.email, account.name, input.password === undefined ? '' : await hashPassword(password(input.password)), role, at, verified ? 1 : 0],
    );
    return account;
  }

  /** Start a sign-in for an account: a new session token, and "last sign-in" updated. */
  private async startSession(account: Account): Promise<{ account: Account; token: string }> {
    const t = token();
    const at = now();
    await this.q('INSERT INTO lh_auth_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', [
      hash(t),
      account.id,
      at,
      later(this.sessionMs),
    ]);
    await this.q('UPDATE lh_users SET last_sign_in_at = ? WHERE id = ?', [at, account.id]);
    return { account: { ...account, lastSignInAt: at }, token: t };
  }

  /** Create the admin account. Only works once, on a fresh server. */
  setup(input: { name: string; email: string; password: string }, ip = '') {
    const run = this.setupQueue.then(async () => {
      if (!(await this.setupRequired())) throw new AccountError(403, 'The admin account already exists');
      const account = await this.create(input, 'admin', false);
      await this.options.onSetup?.(account);
      await this.log('setup', { actor: account.email, ip });
      if (this.canEmail && this.options.publicUrl) await this.sendVerification(account.id);
      return this.startSession(account);
    });
    this.setupQueue = run.catch(() => undefined);
    return run;
  }

  async login(emailInput: string, plain: string, ip = '') {
    const address = emailInput.trim().toLowerCase();
    const pair = `login:${ip}|${address}`;
    if ((await this.overLimit(pair, LIMITS.login[0])) || (ip && (await this.overLimit(`login-ip:${ip}`, LIMITS.loginIp[0])))) {
      throw new AccountError(429, 'Too many attempts. Try again in a few minutes.');
    }
    const [row] = await this.q('SELECT * FROM lh_users WHERE email = ?', [address]);
    const stored = row?.password_hash ? String(row.password_hash) : await NO_PASSWORD;
    const ok = (await verifyPassword(plain, stored)) && Boolean(row?.password_hash);
    if (!ok || !row || Number(row.disabled)) {
      await this.count(pair, LIMITS.login[1]);
      if (ip) await this.count(`login-ip:${ip}`, LIMITS.loginIp[1]);
      await this.log('sign_in_failed', { target: address, ip });
      if (row && Number(row.disabled) && ok) throw new AccountError(401, 'This account is turned off');
      if (row && !row.password_hash) {
        const via = this.providers.map((p) => p.name).join(' or ');
        throw new AccountError(401, via ? `This account signs in with ${via}` : 'This account has no password yet. Use "Forgot password?" to set one.');
      }
      throw new AccountError(401, 'Wrong email or password');
    }
    await this.q('DELETE FROM lh_attempts WHERE key = ?', [pair]);
    await this.log('sign_in', { actor: address, ip });
    return this.startSession(this.account(row));
  }

  /** The signed-in account for a token, or null if the token is unknown, expired, or the account is off. */
  async accountForToken(t: string | undefined): Promise<Account | null> {
    if (!t) return null;
    const [row] = await this.q(
      `SELECT u.*, s.expires_at AS session_expires FROM lh_auth_sessions s JOIN lh_users u ON u.id = s.user_id WHERE s.token_hash = ?`,
      [hash(t)],
    );
    if (!row || Number(row.disabled) || String(row.session_expires) < now()) return null;
    return this.account(row);
  }

  async logout(t: string | undefined, ip = '') {
    if (!t) return;
    const account = await this.accountForToken(t);
    await this.q('DELETE FROM lh_auth_sessions WHERE token_hash = ?', [hash(t)]);
    if (account) await this.log('sign_out', { actor: account.email, ip });
  }

  private async byId(id: string): Promise<Account> {
    const [row] = await this.q('SELECT * FROM lh_users WHERE id = ?', [id]);
    if (!row) throw new AccountError(404, 'No such account');
    return this.account(row);
  }

  /** Check the password of someone who has one (re-confirming before a sensitive change). */
  private async checkPassword(id: string, plain: string | undefined) {
    const [row] = await this.q('SELECT password_hash FROM lh_users WHERE id = ?', [id]);
    if (!row) throw new AccountError(404, 'No such account');
    if (row.password_hash && !(await verifyPassword(plain ?? '', String(row.password_hash)))) {
      throw new AccountError(401, 'Your current password is wrong');
    }
  }

  /**
   * Change your password (or set one, if you only used Google/Microsoft so far).
   * Signs you out everywhere else.
   */
  async changePassword(userId: string, current: string | undefined, next: string, keepToken?: string, ip = '') {
    await this.checkPassword(userId, current);
    await this.q('UPDATE lh_users SET password_hash = ? WHERE id = ?', [await hashPassword(password(next)), userId]);
    await this.q('DELETE FROM lh_auth_sessions WHERE user_id = ? AND token_hash != ?', [userId, keepToken ? hash(keepToken) : '']);
    await this.log('password_changed', { actor: (await this.byId(userId)).email, ip });
  }

  /** Change your name. */
  async updateProfile(userId: string, change: { name: string }) {
    await this.q('UPDATE lh_users SET name = ? WHERE id = ?', [name(change.name), userId]);
    return this.byId(userId);
  }

  /**
   * Change your email. With email set up, a link goes to the new address and the change
   * happens when it's opened; without, it changes now (unconfirmed).
   */
  async changeEmail(userId: string, input: { email: string; password?: string }, ip = '') {
    const next = email(input.email);
    await this.checkPassword(userId, input.password);
    const me = await this.byId(userId);
    if (next === me.email) throw new AccountError(400, 'That is already your email');
    if (await this.userByEmail(next)) throw new AccountError(409, 'Another account uses that email');
    if (!this.canEmail) {
      await this.q('UPDATE lh_users SET email = ?, email_verified = 0 WHERE id = ?', [next, userId]);
      await this.log('email_changed', { actor: next, target: me.email, ip });
      return { pending: false, account: await this.byId(userId) };
    }
    await this.limitMail(next, ip);
    await this.sendEmailLink(userId, next);
    return { pending: true, account: me };
  }

  /** Email a link that confirms an address: your current one, or the one you are changing to. */
  private async sendEmailLink(userId: string, address: string) {
    const t = token();
    await this.q('DELETE FROM lh_email_tokens WHERE user_id = ?', [userId]);
    await this.q('INSERT INTO lh_email_tokens (token_hash, user_id, email, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', [
      hash(t),
      userId,
      address,
      now(),
      later(DAY),
    ]);
    const me = await this.byId(userId);
    const changing = address !== me.email;
    const link = this.link(`/confirm-email/${t}`);
    this.sendLater(async () =>
      linkEmail({
        to: address,
        subject: changing ? `Confirm your new email for ${this.appName}` : `Confirm your email for ${this.appName}`,
        intro: changing
          ? `Hi ${me.name}, confirm that you want to use this address to sign in to ${this.appName}.`
          : `Hi ${me.name}, confirm your email address for ${this.appName}.`,
        button: 'Confirm email',
        link,
        outro: "The link works for 24 hours. If you didn't ask for this, ignore this email.",
      }),
    );
  }

  /** Send (again) the link that confirms your current email. */
  async sendVerification(userId: string, ip = '') {
    if (!this.canEmail) throw new AccountError(400, "Email isn't set up on this server");
    const me = await this.byId(userId);
    if (me.emailVerified) return;
    await this.limitMail(me.email, ip);
    await this.sendEmailLink(userId, me.email);
  }

  /** Open an emailed confirmation link: marks the address confirmed, or switches to the new one. */
  async confirmEmail(t: string, ip = '') {
    const [row] = await this.q('SELECT * FROM lh_email_tokens WHERE token_hash = ?', [hash(t)]);
    if (!row || String(row.expires_at) < now()) throw new AccountError(404, 'This link has expired or was already used');
    const userId = String(row.user_id);
    const address = String(row.email);
    const me = await this.byId(userId);
    await this.q('DELETE FROM lh_email_tokens WHERE user_id = ?', [userId]);
    if (address !== me.email) {
      if (await this.userByEmail(address)) throw new AccountError(409, 'Another account uses that email now');
      await this.q('UPDATE lh_users SET email = ?, email_verified = 1 WHERE id = ?', [address, userId]);
      await this.log('email_changed', { actor: address, target: me.email, ip });
      // Tell the old address, in case this wasn't them.
      this.sendLater(async () => ({
        to: me.email,
        subject: `Your ${this.appName} email was changed`,
        text: `Hi ${me.name}, the email for your ${this.appName} account was changed to ${address}. If you didn't do this, contact your admin.`,
      }));
    } else {
      await this.q('UPDATE lh_users SET email_verified = 1 WHERE id = ?', [userId]);
      await this.log('email_confirmed', { actor: address, ip });
    }
    return this.byId(userId);
  }

  /** Delete your own account. The last admin can't. */
  async deleteSelf(userId: string, plain: string | undefined, ip = '') {
    await this.checkPassword(userId, plain);
    const me = await this.byId(userId);
    await this.deleteUser(userId);
    await this.log('account_deleted', { actor: me.email, ip });
  }

  // ── Invites and sign-up ──

  /** A new invite link token (shown once). `email` locks the invite to that address, and emails it when email is set up. */
  async createInvite(createdBy: string, input: { email?: string; role?: Role } = {}, actor?: string, ip = '') {
    const t = token();
    const invite: Invite = {
      id: randomUUID(),
      email: input.email ? email(input.email) : undefined,
      role: input.role ?? 'member',
      createdAt: now(),
      expiresAt: later(this.inviteMs),
    };
    if (invite.email && (await this.userByEmail(invite.email))) throw new AccountError(409, 'That person already has an account');
    const emailed = Boolean(invite.email && this.canEmail);
    await this.q(
      'INSERT INTO lh_invites (id, token_hash, email, role, created_by, created_at, expires_at, emailed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [invite.id, hash(t), invite.email ?? null, invite.role, createdBy, invite.createdAt, invite.expiresAt, emailed ? 1 : 0],
    );
    if (emailed) await this.emailInvite(invite.email!, t, actor);
    if (actor) await this.log('invite_created', { actor, target: invite.email ?? 'link', ip });
    return { invite, token: t, emailed };
  }

  private async emailInvite(to: string, t: string, from?: string) {
    const link = this.link(`/invite/${t}`);
    const days = Math.round(this.inviteMs / DAY);
    // The admin is waiting on this one: report a failure to them.
    await this.options.mailer!.send(
      linkEmail({
        to,
        subject: `You're invited to ${this.appName}`,
        intro: `${from ? `${from} invited you` : "You've been invited"} to ${this.appName}. Set your name and a password to join.`,
        button: 'Accept invite',
        link,
        outro: `The link works once and expires in ${days} ${days === 1 ? 'day' : 'days'}.`,
      }),
    );
  }

  /** A fresh link (and expiry) for an open invite; the old link stops working. Emails it again when it has an email. */
  async renewInvite(id: string, actor?: string, ip = '') {
    const [row] = await this.q('SELECT * FROM lh_invites WHERE id = ? AND used_at IS NULL', [id]);
    if (!row) throw new AccountError(404, 'That invite was used or revoked');
    const t = token();
    const expiresAt = later(this.inviteMs);
    const address = row.email == null ? undefined : String(row.email);
    const emailed = Boolean(address && this.canEmail);
    await this.q('UPDATE lh_invites SET token_hash = ?, expires_at = ?, emailed = ? WHERE id = ?', [hash(t), expiresAt, emailed ? 1 : 0, id]);
    if (emailed) await this.emailInvite(address!, t, actor);
    if (actor) await this.log('invite_renewed', { actor, target: address ?? 'link', ip });
    return { invite: this.toInvite(row, expiresAt), token: t, emailed };
  }

  private toInvite(row: Record<string, unknown>, expiresAt = String(row.expires_at)): Invite {
    return {
      id: String(row.id),
      ...(row.email != null ? { email: String(row.email) } : {}),
      role: row.role === 'admin' ? 'admin' : 'member',
      createdAt: String(row.created_at),
      expiresAt,
    };
  }

  private async inviteRow(t: string) {
    const [row] = await this.q('SELECT * FROM lh_invites WHERE token_hash = ? AND used_at IS NULL', [hash(t)]);
    return row && String(row.expires_at) >= now() ? row : null;
  }

  /** An invite that can still be used, or null. */
  async invite(t: string): Promise<Invite | null> {
    const row = await this.inviteRow(t);
    return row ? this.toInvite(row) : null;
  }

  async acceptInvite(t: string, input: { name: string; email: string; password: string }, ip = '') {
    const row = await this.inviteRow(t);
    if (!row) throw new AccountError(404, 'This invite link has expired or was already used');
    const invite = this.toInvite(row);
    if (invite.email && invite.email !== email(input.email)) throw new AccountError(400, `This invite is for ${invite.email}`);
    if (row.created_by === 'signup' && !(await this.allowsSignup(invite.email!))) throw new AccountError(403, 'Sign-up is closed. Ask the admin for an invite.');
    // The link went to that inbox, so whoever opened it reads that email.
    const account = await this.create(input, invite.role, Boolean(invite.email && Number(row.emailed)));
    await this.q('UPDATE lh_invites SET used_at = ? WHERE id = ?', [now(), invite.id]);
    await this.log(row.created_by === 'signup' ? 'signed_up' : 'joined', { actor: account.email, ip });
    if (!account.emailVerified && this.canEmail && this.options.publicUrl) await this.sendEmailLink(account.id, account.email);
    return this.startSession(account);
  }

  async signupPolicy(): Promise<SignupPolicy> {
    const [row] = await this.q("SELECT value FROM lh_settings WHERE key = 'signup'");
    return row ? (JSON.parse(String(row.value)) as SignupPolicy) : (this.options.signup ?? { mode: 'invite', domains: [] });
  }

  async setSignupPolicy(policy: SignupPolicy, actor?: string, ip = '') {
    const domains = [...new Set(policy.domains.map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean))];
    for (const d of domains) if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) throw new AccountError(400, `"${d}" isn't a domain like example.com`);
    if (policy.mode === 'domain' && !domains.length) throw new AccountError(400, 'Add at least one email domain');
    if (policy.mode !== 'invite' && !this.canEmail && !this.providers.length) {
      throw new AccountError(400, 'Set up email or Google/Microsoft sign-in first, so new people can prove their email address');
    }
    const value = JSON.stringify({ mode: policy.mode, domains });
    await this.q('DELETE FROM lh_settings WHERE key = ?', ['signup']);
    await this.q('INSERT INTO lh_settings (key, value) VALUES (?, ?)', ['signup', value]);
    await this.log('signup_changed', { actor, target: policy.mode === 'domain' ? `domain: ${domains.join(', ')}` : policy.mode, ip });
    return this.signupPolicy();
  }

  private async allowsSignup(address: string) {
    const policy = await this.signupPolicy();
    return policy.mode === 'open' || (policy.mode === 'domain' && policy.domains.includes(domainOf(address)));
  }

  /**
   * Sign up without an invite: emails a link that finishes it, so the address is proven.
   * Someone who already has an account gets a "you already have an account" email instead.
   */
  async requestSignup(input: string, ip = '') {
    const address = email(input);
    if (!this.canEmail) throw new AccountError(400, "Sign-up by email isn't set up on this server");
    if (await this.setupRequired()) throw new AccountError(403, 'This app is still being set up');
    if (!(await this.allowsSignup(address))) {
      const policy = await this.signupPolicy();
      throw new AccountError(403, policy.mode === 'domain' ? `Sign up with an email at ${policy.domains.join(' or ')}` : 'You need an invite to join. Ask the admin.');
    }
    await this.limitMail(address, ip);
    await this.log('signup_requested', { target: address, ip });
    this.sendLater(async () => {
      if (await this.userByEmail(address)) {
        return linkEmail({
          to: address,
          subject: `You already have a ${this.appName} account`,
          intro: `Someone (hopefully you) tried to sign up to ${this.appName} with this email, but you already have an account.`,
          button: 'Sign in',
          link: this.link('/'),
          outro: 'Forgot your password? Use "Forgot password?" on the sign-in page.',
        });
      }
      const t = token();
      await this.q('DELETE FROM lh_invites WHERE email = ? AND created_by = ? AND used_at IS NULL', [address, 'signup']);
      await this.q(
        'INSERT INTO lh_invites (id, token_hash, email, role, created_by, created_at, expires_at, emailed) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
        [randomUUID(), hash(t), address, 'member', 'signup', now(), later(DAY)],
      );
      return linkEmail({
        to: address,
        subject: `Finish signing up for ${this.appName}`,
        intro: `Open this link to set your name and password for ${this.appName}.`,
        button: 'Finish signing up',
        link: this.link(`/invite/${t}`),
        outro: "The link works for 24 hours. If you didn't ask for this, ignore this email.",
      });
    });
  }

  // ── Password resets ──

  /**
   * A link that lets someone set a new password (shown once, works once, for 24 hours).
   * The admin makes one from People; a locked-out admin gets one from the command line.
   */
  async createResetLink(userId: string, actor?: string, ip = '') {
    const account = await this.byId(userId);
    const t = token();
    const expiresAt = later(DAY);
    await this.q('DELETE FROM lh_password_resets WHERE user_id = ?', [userId]); // only the newest link works
    await this.q('INSERT INTO lh_password_resets (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', [hash(t), userId, now(), expiresAt]);
    if (actor) await this.log('reset_link_created', { actor, target: account.email, ip });
    return { token: t, expiresAt };
  }

  /** "Forgot password?": emails a reset link if the account exists. Answers the same either way. */
  async requestReset(input: string, ip = '') {
    const address = email(input);
    if (!this.canEmail) throw new AccountError(400, "Password reset by email isn't set up. Ask your admin for a reset link.");
    await this.limitMail(address, ip);
    await this.log('reset_requested', { target: address, ip });
    this.sendLater(async () => {
      const account = await this.userByEmail(address);
      if (!account || account.disabled) return null;
      const { token: t } = await this.createResetLink(account.id);
      return linkEmail({
        to: address,
        subject: `Reset your ${this.appName} password`,
        intro: `Hi ${account.name}, open this link to set a new password for ${this.appName}.`,
        button: 'Set a new password',
        link: this.link(`/reset/${t}`),
        outro: "The link works once, for 24 hours. If you didn't ask for this, ignore this email: your password stays the same.",
      });
    });
  }

  /** Whose password a reset link is for, or null if the link is unknown, used or expired. */
  async resetFor(t: string): Promise<Account | null> {
    const [row] = await this.q(
      'SELECT u.*, r.expires_at AS reset_expires FROM lh_password_resets r JOIN lh_users u ON u.id = r.user_id WHERE r.token_hash = ?',
      [hash(t)],
    );
    if (!row || Number(row.disabled) || String(row.reset_expires) < now()) return null;
    return this.account(row);
  }

  /** Set a new password with a reset link. Signs out everywhere else and signs in here. */
  async resetPassword(t: string, next: string, ip = '') {
    const account = await this.resetFor(t);
    if (!account) throw new AccountError(404, 'This reset link has expired or was already used');
    await this.q('UPDATE lh_users SET password_hash = ? WHERE id = ?', [await hashPassword(password(next)), account.id]);
    await this.q('DELETE FROM lh_password_resets WHERE user_id = ?', [account.id]);
    await this.q('DELETE FROM lh_auth_sessions WHERE user_id = ?', [account.id]);
    await this.q('DELETE FROM lh_attempts WHERE key LIKE ?', [`login:%|${account.email}`]);
    await this.log('password_reset', { actor: account.email, ip });
    return this.startSession({ ...account, hasPassword: true });
  }

  // ── Google / Microsoft / OIDC ──

  private provider(id: string) {
    const provider = this.options.sso?.find((p) => p.id === id);
    if (!provider) throw new AccountError(404, 'Unknown sign-in provider');
    return provider;
  }

  /**
   * Begin "Continue with Google": returns the provider's URL and a state value the browser
   * must bring back (in a cookie), so a sign-in can't be finished from another browser.
   */
  async startSso(providerId: string, input: { redirectUri: string; invite?: string; next?: string }) {
    const provider = this.provider(providerId);
    const state = token();
    const data = { provider: provider.id, nonce: token(), verifier: token(), redirectUri: input.redirectUri, invite: input.invite, next: input.next };
    await this.q('INSERT INTO lh_sso_states (state_hash, data, expires_at) VALUES (?, ?, ?)', [hash(state), JSON.stringify(data), later(10 * 60_000)]);
    const url = await authorizeUrl(provider, { redirectUri: input.redirectUri, state, nonce: data.nonce, verifier: data.verifier });
    return { url, state };
  }

  /** Finish it: find the account (by identity, then by verified email), or create one if an invite or sign-up allows. */
  async finishSso(providerId: string, input: { code: string; state: string; browserState?: string }, ip = '') {
    const provider = this.provider(providerId);
    if (!input.browserState || input.browserState !== input.state) throw new AccountError(400, 'Sign-in started in another browser. Try again.');
    const [row] = await this.q('SELECT data, expires_at FROM lh_sso_states WHERE state_hash = ?', [hash(input.state)]);
    await this.q('DELETE FROM lh_sso_states WHERE state_hash = ?', [hash(input.state)]);
    if (!row || String(row.expires_at) < now()) throw new AccountError(400, 'That sign-in took too long. Try again.');
    const state = JSON.parse(String(row.data)) as { provider: string; nonce: string; verifier: string; redirectUri: string; invite?: string; next?: string };
    if (state.provider !== provider.id) throw new AccountError(400, 'Sign-in mixed up two providers. Try again.');

    const who = await redeemCode(provider, { code: input.code, redirectUri: state.redirectUri, nonce: state.nonce, verifier: state.verifier }).catch(
      (e: Error) => {
        throw new AccountError(401, `${provider.name} sign-in failed: ${e.message}`);
      },
    );
    const next = state.next;
    const signIn = async (account: Account) => {
      if (account.disabled) throw new AccountError(401, 'This account is turned off');
      await this.log('sign_in', { actor: account.email, target: provider.name, ip });
      return { ...(await this.startSession(account)), next };
    };

    const [linked] = await this.q('SELECT user_id FROM lh_identities WHERE provider = ? AND subject = ?', [provider.id, who.subject]);
    if (linked) return signIn(await this.byId(String(linked.user_id)));

    if (!who.email || !who.emailVerified) throw new AccountError(401, `${provider.name} didn't confirm your email address, so it can't be used here`);
    const link = (userId: string) =>
      this.q('INSERT INTO lh_identities (provider, subject, user_id, created_at) VALUES (?, ?, ?, ?)', [provider.id, who.subject, userId, now()]);

    const existing = await this.userByEmail(who.email);
    if (existing) {
      if (!existing.emailVerified) {
        // Someone may have registered this address without owning it: the inbox owner takes it over.
        await this.q("UPDATE lh_users SET password_hash = '', email_verified = 1 WHERE id = ?", [existing.id]);
        await this.q('DELETE FROM lh_auth_sessions WHERE user_id = ?', [existing.id]);
      }
      await link(existing.id);
      await this.log('sso_linked', { actor: existing.email, target: provider.name, ip });
      return signIn(await this.byId(existing.id));
    }

    // A new person: they need an invite, or sign-up must be open to them.
    if (await this.setupRequired()) throw new AccountError(403, 'Create the admin account first');
    const invite = state.invite ? await this.inviteRow(state.invite) : null;
    if (state.invite && !invite) throw new AccountError(404, 'This invite link has expired or was already used');
    if (invite?.email != null && String(invite.email) !== who.email) throw new AccountError(400, `This invite is for ${String(invite.email)}`);
    if (!invite && !(await this.allowsSignup(who.email))) throw new AccountError(403, `No account for ${who.email}. Ask the admin for an invite.`);
    const account = await this.create({ name: who.name || who.email.split('@')[0]!, email: who.email }, invite?.role === 'admin' ? 'admin' : 'member', true);
    if (invite) await this.q('UPDATE lh_invites SET used_at = ? WHERE id = ?', [now(), String(invite.id)]);
    await link(account.id);
    await this.log(invite ? 'joined' : 'signed_up', { actor: account.email, target: provider.name, ip });
    return signIn(account);
  }

  // ── Admin ──

  async userByEmail(address: string): Promise<Account | null> {
    const [row] = await this.q('SELECT * FROM lh_users WHERE email = ?', [address.trim().toLowerCase()]);
    return row ? this.account(row) : null;
  }

  async listUsers(): Promise<Account[]> {
    return (await this.q('SELECT * FROM lh_users ORDER BY created_at')).map((r) => this.account(r));
  }

  /** Invites the admin made that are still open (not sign-up links). */
  async listInvites(): Promise<Invite[]> {
    const rows = await this.q("SELECT * FROM lh_invites WHERE used_at IS NULL AND expires_at > ? AND created_by != 'signup' ORDER BY created_at DESC", [now()]);
    return rows.map((r) => this.toInvite(r));
  }

  async revokeInvite(id: string, actor?: string, ip = '') {
    const [row] = await this.q('SELECT email FROM lh_invites WHERE id = ?', [id]);
    await this.q('DELETE FROM lh_invites WHERE id = ?', [id]);
    if (row && actor) await this.log('invite_revoked', { actor, target: row.email == null ? 'link' : String(row.email), ip });
  }

  private async admins() {
    return (await this.q("SELECT id FROM lh_users WHERE role = 'admin' AND disabled = 0")).map((r) => String(r.id));
  }

  /** Turn an account off or on, or change its role. The last admin can't be turned off or demoted. */
  async updateUser(id: string, change: { disabled?: boolean; role?: Role }, actor?: string, ip = '') {
    const admins = await this.admins();
    if (admins.length === 1 && admins[0] === id && (change.disabled || change.role === 'member')) {
      throw new AccountError(400, 'There must always be an admin. Make someone else admin first.');
    }
    const before = await this.byId(id);
    if (change.disabled !== undefined && change.disabled !== before.disabled) {
      await this.q('UPDATE lh_users SET disabled = ? WHERE id = ?', [change.disabled ? 1 : 0, id]);
      if (change.disabled) await this.q('DELETE FROM lh_auth_sessions WHERE user_id = ?', [id]);
      await this.log(change.disabled ? 'user_turned_off' : 'user_turned_on', { actor, target: before.email, ip });
    }
    if (change.role && change.role !== before.role) {
      await this.q('UPDATE lh_users SET role = ? WHERE id = ?', [change.role, id]);
      await this.log(change.role === 'admin' ? 'made_admin' : 'made_member', { actor, target: before.email, ip });
    }
    return this.byId(id);
  }

  /** Remove an account (its chats stay in the database). The last admin can't be removed. */
  async deleteUser(id: string, actor?: string, ip = '') {
    const admins = await this.admins();
    if (admins.length === 1 && admins[0] === id) throw new AccountError(400, 'There must always be an admin. Make someone else admin first.');
    const before = await this.byId(id);
    for (const table of ['lh_auth_sessions', 'lh_password_resets', 'lh_email_tokens', 'lh_identities']) {
      await this.q(`DELETE FROM ${table} WHERE user_id = ?`, [id]);
    }
    await this.q('DELETE FROM lh_users WHERE id = ?', [id]);
    if (actor) await this.log('user_removed', { actor, target: before.email, ip });
  }
}
