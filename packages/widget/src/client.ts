/** A small browser client for the lean-harness HTTP API. Usable without the widget. */

export interface ModelInfo {
  id: string;
  provider: string;
  model: string;
  label?: string;
}

export type Part =
  | { type: 'text'; text: string }
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
  title?: string;
  model: string;
  messages: Message[];
}

export type ChatEvent =
  | { type: 'turn_start'; sessionId: string; model: string }
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

export class HarnessClient {
  constructor(
    private readonly endpoint: string,
    private readonly token?: string,
  ) {}

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

  createSession(model?: string) {
    return this.request<Session>('/sessions', { method: 'POST', body: JSON.stringify({ model }) });
  }

  getSession(id: string) {
    return this.request<Session>(`/sessions/${encodeURIComponent(id)}`);
  }

  setModel(id: string, model: string) {
    return this.request<Session>(`/sessions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ model }) });
  }

  /** Send a message and receive the turn as a stream of events. */
  async *send(sessionId: string, content: string, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
    const response = await fetch(this.url(`/sessions/${encodeURIComponent(sessionId)}/messages`), {
      method: 'POST',
      headers: this.headers({ Accept: 'text/event-stream' }),
      body: JSON.stringify({ content }),
      signal,
    });
    if (!response.ok || !response.body) throw await this.error(response);

    // Server-Sent Events: blocks separated by a blank line; we only need the data lines.
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
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
