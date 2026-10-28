/** A small browser client for the lean-harness HTTP API. Usable without the widget. */

export interface ModelInfo {
  id: string;
  provider: string;
  model: string;
  label?: string;
}

export type Part =
  | { type: 'text'; text: string }
  | { type: 'context'; label: string; text: string }
  | { type: 'file'; name: string; mediaType: string; data: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolCallId: string; name: string; output: string; isError?: boolean };

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  parts: Part[];
  model?: string;
}

export interface Session {
  id: string;
  running?: boolean;
  title?: string;
  model: string;
  messages: Message[];
}

export interface SessionSummary {
  id: string;
  running?: boolean;
  metadata?: Record<string, unknown>;
  title?: string;
  model: string;
  updatedAt: string;
  messageCount: number;
}

export type ChatEvent =
  | { type: 'turn_start'; sessionId: string; model: string }
  | { type: 'approval_request'; id: string; name: string; input: unknown }
  | { type: 'text_delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; name: string; output: string; isError: boolean }
  | { type: 'message'; message: Message }
  | { type: 'turn_end'; stopReason: string; steps: number }
  | { type: 'error'; message: string };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface User {
  id: string;
  name?: string;
  email?: string;
  role?: 'admin' | 'member';
}

/** With built-in accounts: a person who can sign in. */
export interface Account {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
  disabled: boolean;
  createdAt: string;
}

export interface Invite {
  id: string;
  email?: string;
  role: 'admin' | 'member';
  createdAt: string;
  expiresAt: string;
}

export interface AuthStatus {
  /** False (or a 404) when the server has no built-in accounts. */
  accounts: boolean;
  /** A fresh server: the first person to sign up becomes the admin. */
  setupRequired: boolean;
  user: User | null;
}

/** How the server's app presents itself: name, tagline, starter prompts. */
export interface AppInfo {
  name: string;
  tagline?: string;
  suggestions: { title: string; detail?: string; prompt?: string; icon?: 'spark' | 'tool' | 'clock' | 'memory' | 'search' | 'doc' }[];
}

type NewAccount = { name: string; email: string; password: string };

export interface MemoryRecord {
  id: string;
  text: string;
  createdAt: string;
}

export interface SearchResult {
  sessionId: string;
  title?: string;
  messageId: string;
  role: string;
  snippet: string;
}

export class HarnessClient {
  constructor(
    private readonly endpoint: string,
    private token?: string,
  ) {}

  /** Use a different sign-in token for the following requests (empty to sign out). */
  setToken(token?: string) {
    this.token = token || undefined;
  }

  /** Name, tagline and starter prompts (no sign-in needed). */
  appInfo() {
    return this.request<AppInfo>('/app');
  }

  me() {
    return this.request<{ user: User | null }>('/me');
  }

  // Built-in accounts. Sign-in sets a cookie for browsers and returns a token for other clients.

  authStatus() {
    return this.request<AuthStatus>('/auth/status');
  }

  setup(account: NewAccount) {
    return this.request<{ user: User; token: string }>('/auth/setup', { method: 'POST', body: JSON.stringify(account) });
  }

  login(email: string, password: string) {
    return this.request<{ user: User; token: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  }

  logout() {
    return this.request<void>('/auth/logout', { method: 'POST', body: '{}' });
  }

  changePassword(current: string, next: string) {
    return this.request<void>('/auth/password', { method: 'POST', body: JSON.stringify({ current, next }) });
  }

  invite(token: string) {
    return this.request<{ invite: Pick<Invite, 'email' | 'role' | 'expiresAt'> }>(`/auth/invites/${encodeURIComponent(token)}`);
  }

  acceptInvite(token: string, account: NewAccount) {
    return this.request<{ user: User; token: string }>(`/auth/invites/${encodeURIComponent(token)}/accept`, {
      method: 'POST',
      body: JSON.stringify(account),
    });
  }

  /** Who a password reset link is for. */
  resetInfo(token: string) {
    return this.request<{ reset: { name: string; email: string } }>(`/auth/resets/${encodeURIComponent(token)}`);
  }

  /** Set a new password with a reset link; signs in. */
  resetPassword(token: string, password: string) {
    return this.request<{ user: User; token: string }>(`/auth/resets/${encodeURIComponent(token)}`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  }

  /** Admin only: a one-time link (24 hours) that lets someone set a new password. */
  createResetLink(userId: string) {
    return this.request<{ token: string; expiresAt: string }>(`/admin/users/${encodeURIComponent(userId)}/reset`, { method: 'POST', body: '{}' });
  }

  /** Admin only: people, and invite links. */
  users() {
    return this.request<{ users: Account[] }>('/admin/users');
  }

  updateUser(id: string, change: { disabled?: boolean; role?: 'admin' | 'member' }) {
    return this.request<Account>(`/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(change) });
  }

  deleteUser(id: string) {
    return this.request<void>(`/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  invites() {
    return this.request<{ invites: Invite[] }>('/admin/invites');
  }

  /** A new invite link token. It is shown only once, so share it right away. */
  createInvite(options: { email?: string; role?: 'admin' | 'member' } = {}) {
    return this.request<{ invite: Invite; token: string }>('/admin/invites', { method: 'POST', body: JSON.stringify(options) });
  }

  revokeInvite(id: string) {
    return this.request<void>(`/admin/invites/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  /** Stop the session's running reply. Closing a stream does not stop it. */
  stop(sessionId: string) {
    return this.request<{ stopped: boolean }>(`/sessions/${encodeURIComponent(sessionId)}/stop`, { method: 'POST', body: '{}' });
  }

  memories() {
    return this.request<{ memories: MemoryRecord[] }>('/memories');
  }

  deleteMemory(id: string) {
    return this.request<void>(`/memories/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  search(query: string) {
    return this.request<{ results: SearchResult[] }>(`/search?q=${encodeURIComponent(query)}`);
  }

  /** Follow a reply that is already running (after a reload), from the start or from event `from`. */
  async *follow(sessionId: string, options: { from?: number; signal?: AbortSignal } = {}): AsyncGenerator<ChatEvent> {
    const response = await fetch(this.url(`/sessions/${encodeURIComponent(sessionId)}/stream?from=${options.from ?? 0}`), {
      headers: this.headers({ Accept: 'text/event-stream' }),
      signal: options.signal,
    });
    if (!response.ok || !response.body) throw await this.error(response);
    yield* this.events(response.body);
  }

  private url(path: string) {
    return `${this.endpoint.replace(/\/$/, '')}/v1${path}`;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(this.url(path), { ...init, headers: this.headers(init.headers) });
    if (!response.ok) throw await this.error(response);
    return (response.status === 204 ? undefined : await response.json()) as T;
  }

  private headers(extra?: HeadersInit): Headers {
    const headers = new Headers(extra);
    headers.set('Content-Type', 'application/json');
    if (this.token) headers.set('Authorization', `Bearer ${this.token}`);
    return headers;
  }

  private async error(response: Response) {
    const body = await response.json().catch(() => undefined);
    return new ApiError(response.status, body?.error?.message ?? `Request failed (${response.status})`);
  }

  models() {
    return this.request<{ defaultModel: string; models: ModelInfo[] }>('/models');
  }

  listSessions() {
    return this.request<{ sessions: SessionSummary[] }>('/sessions');
  }

  deleteSession(id: string) {
    return this.request<void>(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  createSession(model?: string) {
    return this.request<Session>('/sessions', { method: 'POST', body: JSON.stringify({ model }) });
  }

  getSession(id: string) {
    return this.request<Session>(`/sessions/${encodeURIComponent(id)}`);
  }

  /** Allow or decline a tool call that is waiting for approval. */
  decide(sessionId: string, callId: string, approved: boolean, always = false) {
    return this.request<void>(`/sessions/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(callId)}`, {
      method: 'POST',
      body: JSON.stringify({ approved, always }),
    });
  }

  rename(id: string, title: string) {
    return this.request<Session>(`/sessions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ title }) });
  }

  setModel(id: string, model: string) {
    return this.request<Session>(`/sessions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ model }) });
  }

  tools() {
    return this.request<{ tools: { name: string; description: string }[] }>('/tools');
  }

  /** Send a message (with optional context) and receive the turn as a stream of events. */
  async *send(
    sessionId: string,
    content: string,
    options: {
      context?: Record<string, unknown>;
      replaceFrom?: string;
      model?: string;
      files?: { name: string; mediaType: string; data: string }[];
      signal?: AbortSignal;
    } = {},
  ): AsyncGenerator<ChatEvent> {
    const response = await fetch(this.url(`/sessions/${encodeURIComponent(sessionId)}/messages`), {
      method: 'POST',
      headers: this.headers({ Accept: 'text/event-stream' }),
      body: JSON.stringify({ content, context: options.context, replaceFrom: options.replaceFrom, model: options.model, files: options.files }),
      signal: options.signal,
    });
    if (!response.ok || !response.body) throw await this.error(response);
    yield* this.events(response.body);
  }

  /** Server-Sent Events: blocks separated by a blank line; we only need the data lines. */
  private async *events(body: NonNullable<Response['body']>): AsyncGenerator<ChatEvent> {
    const reader = body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let end: number;
      while ((end = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end).replace(/^\r?\n\r?\n/, '');
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, ''))
          .join('\n');
        if (data) yield JSON.parse(data) as ChatEvent;
      }
    }
  }
}
