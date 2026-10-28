import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Message, Session } from './types.js';

export type SessionSummary = Omit<Session, 'messages'> & { messageCount: number };

export type SessionPatch = Partial<Pick<Session, 'title' | 'model' | 'metadata'>>;

/**
 * Where sessions live. Messages are never edited: history only grows, or is cut
 * back to an earlier point (retry, edit). Every earlier turn stays byte-for-byte
 * the same, which keeps model requests reproducible and provider caches valid.
 */
export interface SessionStore {
  create(session: Session): Promise<Session>;
  get(id: string): Promise<Session | undefined>;
  list(): Promise<SessionSummary[]>;
  update(id: string, patch: SessionPatch): Promise<Session>;
  append(id: string, messages: Message[]): Promise<Session>;
  /** Keep the first `count` messages and drop the rest. */
  truncate(id: string, count: number): Promise<Session>;
  delete(id: string): Promise<boolean>;
}

function summarize({ messages, ...rest }: Session): SessionSummary {
  return { ...rest, messageCount: messages.length };
}

function byNewest(a: SessionSummary, b: SessionSummary): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

function now(): string {
  return new Date().toISOString();
}

export class MemoryStore implements SessionStore {
  private sessions = new Map<string, Session>();

  async create(session: Session) {
    this.sessions.set(session.id, structuredClone(session));
    return structuredClone(session);
  }

  async get(id: string) {
    const session = this.sessions.get(id);
    return session && structuredClone(session);
  }

  async list() {
    return [...this.sessions.values()].map(summarize).sort(byNewest);
  }

  async update(id: string, patch: SessionPatch) {
    const session = this.require(id);
    Object.assign(session, patch, { updatedAt: now() });
    return structuredClone(session);
  }

  async append(id: string, messages: Message[]) {
    const session = this.require(id);
    session.messages.push(...structuredClone(messages));
    session.updatedAt = now();
    return structuredClone(session);
  }

  async truncate(id: string, count: number) {
    const session = this.require(id);
    session.messages.length = Math.min(count, session.messages.length);
    session.updatedAt = now();
    return structuredClone(session);
  }

  async delete(id: string) {
    return this.sessions.delete(id);
  }

  private require(id: string): Session {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session ${id} not found`);
    return session;
  }
}

/** One JSON file per session. Good for local apps and single servers; swap in a database store for more. */
export class FileStore implements SessionStore {
  constructor(private readonly dir: string) {}

  async create(session: Session) {
    await this.write(session);
    return session;
  }

  async get(id: string) {
    if (!/^[\w-]+$/.test(id)) return undefined;
    try {
      return JSON.parse(await readFile(this.path(id), 'utf8')) as Session;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async list() {
    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch {
      return [];
    }
    const sessions = await Promise.all(
      files.filter((f) => f.endsWith('.json')).map((f) => this.get(f.slice(0, -5))),
    );
    return sessions.filter((s): s is Session => !!s).map(summarize).sort(byNewest);
  }

  async update(id: string, patch: SessionPatch) {
    const session = await this.require(id);
    Object.assign(session, patch, { updatedAt: now() });
    await this.write(session);
    return session;
  }

  async append(id: string, messages: Message[]) {
    const session = await this.require(id);
    session.messages.push(...messages);
    session.updatedAt = now();
    await this.write(session);
    return session;
  }

  async truncate(id: string, count: number) {
    const session = await this.require(id);
    session.messages.length = Math.min(count, session.messages.length);
    session.updatedAt = now();
    await this.write(session);
    return session;
  }

  async delete(id: string) {
    if (!(await this.get(id))) return false;
    await rm(this.path(id));
    return true;
  }

  private path(id: string) {
    return join(this.dir, `${id}.json`);
  }

  private async require(id: string): Promise<Session> {
    const session = await this.get(id);
    if (!session) throw new Error(`Session ${id} not found`);
    return session;
  }

  /** Write to a temporary file, then rename, so a crash never leaves a half-written session. */
  private async write(session: Session) {
    await mkdir(this.dir, { recursive: true });
    const tmp = `${this.path(session.id)}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(session));
    await rename(tmp, this.path(session.id));
  }
}
