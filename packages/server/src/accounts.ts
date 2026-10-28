import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { SqlDb } from '@lean-harness/core';
import type { User } from './auth.js';

/**
 * Email-and-password accounts with one admin and invite links.
 * The first account (created on a fresh server) is the admin; after that, people join
 * only through invite links the admin creates. Passwords are hashed with scrypt; sign-in
 * tokens and invite tokens are random and stored only as hashes.
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
}

export interface Invite {
  id: string;
  email?: string;
  role: Role;
  createdAt: string;
  expiresAt: string;
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
}

const DAY = 86_400_000;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const now = () => new Date().toISOString();

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

export class Accounts {
  private ready?: Promise<void>;
  private readonly sessionMs: number;
  private readonly inviteMs: number;
  /** Failed sign-ins by email, to slow down password guessing. */
  private readonly failures = new Map<string, { count: number; until: number }>();
  /** Setup runs one at a time, so two first visitors can't both become admin. */
  private setupQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly db: SqlDb,
    private readonly options: AccountOptions = {},
  ) {
    this.sessionMs = (options.sessionDays ?? 30) * DAY;
    this.inviteMs = (options.inviteDays ?? 7) * DAY;
  }

  private async q(sql: string, params: unknown[] = []) {
    this.ready ??= (async () => {
      await this.db.query(`CREATE TABLE IF NOT EXISTS lh_users (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL,
        role TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`);
      await this.db.query(`CREATE TABLE IF NOT EXISTS lh_auth_sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL)`);
      await this.db.query(`CREATE TABLE IF NOT EXISTS lh_invites (
        id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, email TEXT, role TEXT NOT NULL, created_by TEXT NOT NULL,
        created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT)`);
    })();
    await this.ready;
    return this.db.query(sql, params);
  }

  private account(row: Record<string, unknown>): Account {
    return {
      id: String(row.id),
      email: String(row.email),
      name: String(row.name),
      role: row.role === 'admin' ? 'admin' : 'member',
      disabled: Boolean(Number(row.disabled)),
      createdAt: String(row.created_at),
    };
  }

  /** As a request's user: who they are and whether they are the admin. */
  static user(account: Account): User & { role: Role } {
    return { id: account.id, name: account.name, email: account.email, role: account.role };
  }

  /** True on a fresh server, before the admin account exists. */
  async setupRequired(): Promise<boolean> {
    return (await this.q('SELECT COUNT(*) AS n FROM lh_users'))[0]?.n == 0;
  }

  private async create(input: { name: string; email: string; password: string }, role: Role): Promise<Account> {
    const account: Account = { id: randomUUID(), email: email(input.email), name: name(input.name), role, disabled: false, createdAt: now() };
    if ((await this.q('SELECT id FROM lh_users WHERE email = ?', [account.email])).length) {
      throw new AccountError(409, 'An account with that email already exists');
    }
    await this.q('INSERT INTO lh_users (id, email, name, password_hash, role, disabled, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)', [
      account.id,
      account.email,
      account.name,
      await hashPassword(password(input.password)),
      role,
      account.createdAt,
    ]);
    return account;
  }

  private async startSession(userId: string): Promise<string> {
    const t = token();
    await this.q('INSERT INTO lh_auth_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', [
      hash(t),
      userId,
      now(),
      new Date(Date.now() + this.sessionMs).toISOString(),
    ]);
    return t;
  }

  /** Create the admin account. Only works once, on a fresh server. */
  setup(input: { name: string; email: string; password: string }) {
    const run = this.setupQueue.then(async () => {
      if (!(await this.setupRequired())) throw new AccountError(403, 'The admin account already exists');
      const account = await this.create(input, 'admin');
      await this.options.onSetup?.(account);
      return { account, token: await this.startSession(account.id) };
    });
    this.setupQueue = run.catch(() => undefined);
    return run;
  }

  async login(emailInput: string, plain: string) {
    const key = emailInput.trim().toLowerCase();
    const failed = this.failures.get(key);
    if (failed && failed.count >= 10 && failed.until > Date.now()) {
      throw new AccountError(429, 'Too many attempts. Try again in a few minutes.');
    }
    const [row] = await this.q('SELECT * FROM lh_users WHERE email = ?', [key]);
    const ok = row ? await verifyPassword(plain, String(row.password_hash)) : (await hashPassword(plain), false); // same work either way
    if (!ok || !row || Number(row.disabled)) {
      if (this.failures.size > 10_000) for (const [k, v] of this.failures) if (v.until <= Date.now()) this.failures.delete(k);
      const f = failed && failed.until > Date.now() ? failed : { count: 0, until: Date.now() + 15 * 60_000 };
      this.failures.set(key, { ...f, count: f.count + 1 });
      throw new AccountError(401, row && Number(row.disabled) && ok ? 'This account is turned off' : 'Wrong email or password');
    }
    this.failures.delete(key);
    return { account: this.account(row), token: await this.startSession(String(row.id)) };
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

  async logout(t: string | undefined) {
    if (t) await this.q('DELETE FROM lh_auth_sessions WHERE token_hash = ?', [hash(t)]);
  }

  /** Change your password; signs you out everywhere else. */
  async changePassword(userId: string, current: string, next: string, keepToken?: string) {
    const [row] = await this.q('SELECT password_hash FROM lh_users WHERE id = ?', [userId]);
    if (!row || !(await verifyPassword(current, String(row.password_hash)))) throw new AccountError(401, 'Your current password is wrong');
    await this.q('UPDATE lh_users SET password_hash = ? WHERE id = ?', [await hashPassword(password(next)), userId]);
    await this.q('DELETE FROM lh_auth_sessions WHERE user_id = ? AND token_hash != ?', [userId, keepToken ? hash(keepToken) : '']);
  }

  /** A new invite link token (shown once). `email` locks the invite to that address. */
  async createInvite(createdBy: string, input: { email?: string; role?: Role } = {}) {
    const t = token();
    const invite: Invite = {
      id: randomUUID(),
      email: input.email ? email(input.email) : undefined,
      role: input.role ?? 'member',
      createdAt: now(),
      expiresAt: new Date(Date.now() + this.inviteMs).toISOString(),
    };
    await this.q('INSERT INTO lh_invites (id, token_hash, email, role, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      invite.id,
      hash(t),
      invite.email ?? null,
      invite.role,
      createdBy,
      invite.createdAt,
      invite.expiresAt,
    ]);
    return { invite, token: t };
  }

  /** An invite that can still be used, or null. */
  async invite(t: string): Promise<Invite | null> {
    const [row] = await this.q('SELECT * FROM lh_invites WHERE token_hash = ? AND used_at IS NULL', [hash(t)]);
    if (!row || String(row.expires_at) < now()) return null;
    return {
      id: String(row.id),
      ...(row.email != null ? { email: String(row.email) } : {}),
      role: row.role === 'admin' ? 'admin' : 'member',
      createdAt: String(row.created_at),
      expiresAt: String(row.expires_at),
    };
  }

  async acceptInvite(t: string, input: { name: string; email: string; password: string }) {
    const invite = await this.invite(t);
    if (!invite) throw new AccountError(404, 'This invite link has expired or was already used');
    if (invite.email && invite.email !== email(input.email)) throw new AccountError(400, `This invite is for ${invite.email}`);
    const account = await this.create(input, invite.role);
    await this.q('UPDATE lh_invites SET used_at = ? WHERE id = ?', [now(), invite.id]);
    return { account, token: await this.startSession(account.id) };
  }

  async listUsers(): Promise<Account[]> {
    return (await this.q('SELECT * FROM lh_users ORDER BY created_at')).map((r) => this.account(r));
  }

  async listInvites(): Promise<Invite[]> {
    const rows = await this.q('SELECT * FROM lh_invites WHERE used_at IS NULL AND expires_at > ? ORDER BY created_at DESC', [now()]);
    return rows.map((r) => ({
      id: String(r.id),
      ...(r.email != null ? { email: String(r.email) } : {}),
      role: r.role === 'admin' ? 'admin' : 'member',
      createdAt: String(r.created_at),
      expiresAt: String(r.expires_at),
    }));
  }

  async revokeInvite(id: string) {
    await this.q('DELETE FROM lh_invites WHERE id = ?', [id]);
  }

  private async admins() {
    return (await this.q("SELECT id FROM lh_users WHERE role = 'admin' AND disabled = 0")).map((r) => String(r.id));
  }

  /** Turn an account off or on, or change its role. The last admin can't be turned off or demoted. */
  async updateUser(id: string, change: { disabled?: boolean; role?: Role }) {
    const admins = await this.admins();
    if (admins.length === 1 && admins[0] === id && (change.disabled || change.role === 'member')) {
      throw new AccountError(400, 'There must always be an admin');
    }
    if (change.disabled !== undefined) {
      await this.q('UPDATE lh_users SET disabled = ? WHERE id = ?', [change.disabled ? 1 : 0, id]);
      if (change.disabled) await this.q('DELETE FROM lh_auth_sessions WHERE user_id = ?', [id]);
    }
    if (change.role) await this.q('UPDATE lh_users SET role = ? WHERE id = ?', [change.role, id]);
    const [row] = await this.q('SELECT * FROM lh_users WHERE id = ?', [id]);
    if (!row) throw new AccountError(404, 'No such account');
    return this.account(row);
  }

  /** Remove an account (its chats stay in the database). The last admin can't be removed. */
  async deleteUser(id: string) {
    const admins = await this.admins();
    if (admins.length === 1 && admins[0] === id) throw new AccountError(400, 'There must always be an admin');
    await this.q('DELETE FROM lh_auth_sessions WHERE user_id = ?', [id]);
    await this.q('DELETE FROM lh_users WHERE id = ?', [id]);
  }
}
