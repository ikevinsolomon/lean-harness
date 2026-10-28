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
}

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

  me() {
    return this.request<{ user: User | null }>('/me');
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
