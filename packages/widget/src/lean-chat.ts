import { html, LitElement, nothing, svg, type PropertyValues, type TemplateResult } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { ApiError, HarnessClient, type ChatEvent, type Message, type ModelInfo } from './client.js';
import { renderMarkdown } from './markdown.js';
import { styles } from './styles.js';

export { HarnessClient, ApiError } from './client.js';
export type { ChatEvent, Message, ModelInfo, Session } from './client.js';

interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  output?: string;
  isError?: boolean;
}

type Item =
  | { kind: 'user'; text: string; context: string[] }
  | { kind: 'assistant'; text: string; reasoning: string; streaming: boolean }
  | { kind: 'tools'; calls: ToolCall[] }
  | { kind: 'note'; text: string };

const icon = {
  send: svg`<path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  stop: svg`<rect x="5" y="5" width="14" height="14" rx="3" fill="currentColor"/>`,
  edit: svg`<path d="M12 20h9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>`,
  chat: svg`<path d="M4 5.5A2.5 2.5 0 016.5 3h11A2.5 2.5 0 0120 5.5v8a2.5 2.5 0 01-2.5 2.5H10l-4.5 4v-4A1.5 1.5 0 014 14.5z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>`,
  close: svg`<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
  closeSmall: svg`<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`,
  check: svg`<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
  bang: svg`<path d="M12 7v6M12 17v.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`,
  alert: svg`<path d="M12 8v5M12 16.5v.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/>`,
  right: svg`<path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  down: svg`<path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  plus: svg`<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  page: svg`<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 3v5h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>`,
  brain: svg`<path d="M9 4a3 3 0 00-3 3 3 3 0 00-2 5 3 3 0 002 5 3 3 0 006 0V4.5A2.5 2.5 0 009 4zM15 4a3 3 0 013 3 3 3 0 012 5 3 3 0 01-2 5 3 3 0 01-6 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>`,
};

const svgIcon = (body: ReturnType<typeof svg>, size = 18) =>
  html`<svg width=${size} height=${size} viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

/** Brand dots for the model menu. */
const PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#d97757',
  openai: '#10a37f',
  deepseek: '#4d6bfe',
  gemini: '#4285f4',
  openrouter: '#6467f2',
  ollama: '#71717a',
  mock: '#a1a1aa',
};

function safeStorage<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined; // private mode, blocked storage, sandboxed iframe
  }
}

function pretty(value: unknown): string {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

/** One line describing a tool call's input: its plain values joined. */
function summarize(input: unknown): string {
  if (input === null || typeof input !== 'object') return String(input ?? '');
  return Object.values(input)
    .filter((v) => ['string', 'number', 'boolean'].includes(typeof v))
    .join(' · ');
}

function greetingFor(hour: number) {
  return hour < 12 ? 'Good morning.' : hour < 18 ? 'Good afternoon.' : 'Good evening.';
}

/** Turn stored messages back into chat items. */
function toItems(messages: Message[]): Item[] {
  const items: Item[] = [];
  const results = new Map<string, { output: string; isError?: boolean }>();
  for (const m of messages) for (const p of m.parts) if (p.type === 'tool_result') results.set(p.toolCallId, p);
  for (const m of messages) {
    if (m.role === 'user') {
      items.push({
        kind: 'user',
        text: m.parts.map((p) => (p.type === 'text' ? p.text : '')).join(''),
        context: m.parts.flatMap((p) => (p.type === 'context' ? [p.label] : [])),
      });
    } else if (m.role === 'assistant') {
      const text = m.parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
      const reasoning = m.parts.map((p) => (p.type === 'reasoning' ? p.text : '')).join('');
      if (text || reasoning) items.push({ kind: 'assistant', text, reasoning, streaming: false });
      const calls = m.parts.flatMap((p) => (p.type === 'tool_call' ? [{ id: p.id, name: p.name, input: p.input, ...results.get(p.id) }] : []));
      if (calls.length) items.push({ kind: 'tools', calls });
    }
  }
  return items;
}

/**
 * <lean-chat endpoint="https://your-server"></lean-chat>
 *
 * Attributes: endpoint, token, model, heading, subtitle, greeting, placeholder,
 * suggestions ("Title: detail | Title: detail"), disclaimer, mode ("inline" | "floating"),
 * theme ("auto" | "light" | "dark"), page-context, hide-model-picker, hide-reasoning.
 * Property: `context`, an object sent with every message ({ "Record": "Order 4411" }).
 *
 * Events: lean-chat-event (every streamed event, in `detail`), lean-chat-error.
 */
export class LeanChat extends LitElement {
  static override styles = styles;

  static override properties = {
    endpoint: { type: String },
    token: { type: String },
    model: { type: String, reflect: true },
    heading: { type: String },
    subtitle: { type: String },
    greeting: { type: String },
    placeholder: { type: String },
    suggestions: { type: String },
    disclaimer: { type: String },
    mode: { type: String, reflect: true },
    theme: { type: String, reflect: true },
    pageContext: { type: Boolean, attribute: 'page-context' },
    hideModelPicker: { type: Boolean, attribute: 'hide-model-picker' },
    hideReasoning: { type: Boolean, attribute: 'hide-reasoning' },
    open: { type: Boolean, reflect: true },
    context: { type: Object },
    items: { state: true },
    models: { state: true },
    hasMemory: { state: true },
    dismissed: { state: true },
    busy: { state: true },
    error: { state: true },
    draft: { state: true },
  };

  // Reactive fields are declared, not initialized, so class-field semantics in any
  // bundler cannot shadow Lit's accessors. Defaults are set in the constructor.
  declare endpoint: string;
  declare token: string | undefined;
  declare model: string;
  declare heading: string;
  declare subtitle: string;
  declare greeting: string;
  declare placeholder: string;
  declare suggestions: string;
  declare disclaimer: string;
  declare mode: 'inline' | 'floating';
  declare theme: 'auto' | 'light' | 'dark';
  declare pageContext: boolean;
  declare hideModelPicker: boolean;
  declare hideReasoning: boolean;
  declare open: boolean;
  declare context: Record<string, unknown>;
  declare private items: Item[];
  declare private models: ModelInfo[];
  declare private hasMemory: boolean;
  declare private dismissed: Set<string>;
  declare private busy: boolean;
  declare private error: string;
  declare private draft: string;

  private sessionId?: string;
  private abort?: AbortController;
  private client!: HarnessClient;
  private notes: string[] = [];

  constructor() {
    super();
    this.endpoint = '';
    this.model = '';
    this.heading = 'Assistant';
    this.subtitle = '';
    this.greeting = 'How can I help?';
    this.placeholder = '';
    this.suggestions = '';
    this.disclaimer = 'Answers can be wrong. Check anything important.';
    this.mode = 'inline';
    this.theme = 'auto';
    this.pageContext = false;
    this.hideModelPicker = false;
    this.hideReasoning = false;
    this.open = false;
    this.context = {};
    this.items = [];
    this.models = [];
    this.hasMemory = false;
    this.dismissed = new Set();
    this.busy = false;
    this.error = '';
    this.draft = '';
  }

  private get storageKey() {
    return `lean-chat:${this.endpoint || location.origin}:session`;
  }

  override connectedCallback() {
    super.connectedCallback();
    this.client = new HarnessClient(this.endpoint || location.origin, this.token);
    void this.init();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.abort?.abort();
  }

  protected override willUpdate(changed: PropertyValues<this>) {
    if (changed.has('endpoint' as keyof LeanChat) || changed.has('token' as keyof LeanChat)) {
      this.client = new HarnessClient(this.endpoint || location.origin, this.token);
    }
  }

  protected override updated() {
    const log = this.renderRoot.querySelector('.log');
    if (log && this.busy) log.scrollTop = log.scrollHeight;
  }

  private async init() {
    try {
      const [{ defaultModel, models }, { tools }] = await Promise.all([this.client.models(), this.client.tools()]);
      this.models = models;
      this.hasMemory = tools.some((t) => t.name === 'remember');
      if (!this.model) this.model = defaultModel;
    } catch (error) {
      this.fail(error);
    }
    const saved = safeStorage(() => localStorage.getItem(this.storageKey));
    if (!saved) return;
    try {
      const session = await this.client.getSession(saved);
      this.sessionId = session.id;
      this.model = session.model;
      this.items = toItems(session.messages);
      await this.updateComplete;
      const log = this.renderRoot.querySelector('.log');
      if (log) log.scrollTop = log.scrollHeight;
    } catch {
      safeStorage(() => localStorage.removeItem(this.storageKey));
    }
  }

  /** Context sent with the next message: the `context` property, plus this page when enabled, minus removed chips. */
  private activeContext(): Record<string, unknown> {
    const all: Record<string, unknown> = { ...this.context };
    if (this.pageContext) all.Page = `${document.title}\n${location.href}`;
    for (const key of this.dismissed) delete all[key];
    return all;
  }

  private chipText(key: string, value: unknown) {
    const text = typeof value === 'string' ? value.split('\n')[0] : '';
    return text ? `${key}: ${text}` : key;
  }

  /** Start a fresh conversation. */
  newChat() {
    this.abort?.abort();
    this.sessionId = undefined;
    this.items = [];
    this.error = '';
    this.dismissed = new Set();
    safeStorage(() => localStorage.removeItem(this.storageKey));
    this.focusInput();
  }

  /** Send a message as if the user typed it. */
  async send(text: string) {
    const content = text.trim();
    if (!content || this.busy) return;
    const context = this.activeContext();
    this.error = '';
    this.draft = '';
    const area = this.renderRoot.querySelector('textarea');
    if (area) area.style.height = 'auto';
    this.items = [...this.items, { kind: 'user', text: content, context: Object.keys(context) }];
    this.notes = [];
    this.busy = true;
    this.abort = new AbortController();
    try {
      if (!this.sessionId) {
        const session = await this.client.createSession(this.model || undefined);
        this.sessionId = session.id;
        safeStorage(() => localStorage.setItem(this.storageKey, session.id));
      }
      for await (const event of this.client.send(this.sessionId, content, { context, signal: this.abort.signal })) {
        this.apply(event);
      }
    } catch (error) {
      if (!this.abort.signal.aborted) this.fail(error);
    } finally {
      this.busy = false;
      this.items = [
        ...this.items.map((i) => (i.kind === 'assistant' && i.streaming ? { ...i, streaming: false } : i)),
        ...this.notes.map((text) => ({ kind: 'note' as const, text })),
      ];
      this.focusInput();
    }
  }

  stop() {
    this.abort?.abort();
  }

  private apply(event: ChatEvent) {
    this.dispatchEvent(new CustomEvent('lean-chat-event', { detail: event, bubbles: true, composed: true }));
    const last = this.items.at(-1);
    const current = () => {
      if (last?.kind === 'assistant' && last.streaming) return last;
      const fresh: Item = { kind: 'assistant', text: '', reasoning: '', streaming: true };
      this.items = [...this.items, fresh];
      return fresh;
    };
    switch (event.type) {
      case 'text_delta':
        current().text += event.text;
        this.items = [...this.items];
        break;
      case 'reasoning_delta':
        current().reasoning += event.text;
        this.items = [...this.items];
        break;
      case 'tool_call': {
        const call: ToolCall = { id: event.id, name: event.name, input: event.input };
        const items = this.items.map((i) => (i.kind === 'assistant' ? { ...i, streaming: false } : i));
        const tail = items.at(-1);
        this.items = tail?.kind === 'tools' ? [...items.slice(0, -1), { kind: 'tools', calls: [...tail.calls, call] }] : [...items, { kind: 'tools', calls: [call] }];
        break;
      }
      case 'tool_result':
        this.items = this.items.map((i) =>
          i.kind === 'tools'
            ? { ...i, calls: i.calls.map((c) => (c.id === event.id ? { ...c, output: event.output, isError: event.isError } : c)) }
            : i,
        );
        if (event.name === 'remember' && !event.isError) {
          const call = this.items.flatMap((i) => (i.kind === 'tools' ? i.calls : [])).find((c) => c.id === event.id);
          this.notes.push(summarize(call?.input));
        }
        break;
      case 'turn_end':
        if (event.stopReason === 'max_steps') this.error = 'Stopped after too many steps.';
        if (event.stopReason === 'refusal') this.error = 'The model declined this request.';
        break;
      case 'error':
        this.error = event.message;
        break;
    }
  }

  private fail(error: unknown) {
    this.error =
      error instanceof TypeError
        ? `Can't reach the assistant at ${this.endpoint || location.origin}.`
        : error instanceof ApiError || error instanceof Error
          ? error.message
          : 'Something went wrong.';
    this.dispatchEvent(new CustomEvent('lean-chat-error', { detail: error, bubbles: true, composed: true }));
  }

  private async changeModel(model: string) {
    this.model = model;
    if (!this.sessionId) return;
    try {
      await this.client.setModel(this.sessionId, model);
    } catch (error) {
      this.fail(error);
    }
  }

  private focusInput() {
    void this.updateComplete.then(() => this.renderRoot.querySelector('textarea')?.focus());
  }

  private onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void this.send(this.draft);
    }
  }

  private onInput(e: Event) {
    const area = e.target as HTMLTextAreaElement;
    this.draft = area.value;
    area.style.height = 'auto';
    area.style.height = `${area.scrollHeight}px`;
  }

  override render() {
    if (this.mode === 'floating' && !this.open) {
      return html`<button class="launcher" aria-label="Open chat" @click=${() => ((this.open = true), this.focusInput())}>
        ${svgIcon(icon.chat, 22)}
      </button>`;
    }
    const waiting = this.busy && this.items.at(-1)?.kind === 'user';
    return html`
      <section class="panel" aria-label=${this.heading}>
        ${this.renderHeader()}
        <div class="log" aria-live="polite">
          ${this.items.length ? this.renderThread() : this.renderEmpty()}
          ${waiting ? html`<div class="typing" role="status" aria-label="Thinking"><span></span><span></span><span></span></div>` : nothing}
        </div>
        ${this.error
          ? html`<div class="error" role="alert">${svgIcon(icon.alert, 16)}<span>${this.error}</span>
              <button aria-label="Dismiss" @click=${() => (this.error = '')}>${svgIcon(icon.closeSmall, 14)}</button></div>`
          : nothing}
        ${this.renderComposer()}
      </section>
      ${this.mode === 'floating'
        ? html`<button class="launcher" aria-label="Close chat" @click=${() => (this.open = false)}>${svgIcon(icon.close, 20)}</button>`
        : nothing}
    `;
  }

  private renderHeader() {
    const current = this.models.find((m) => m.id === this.model);
    const picker =
      !this.hideModelPicker && this.models.length > 1
        ? html`<label class="model">
            <span class="sr-only">Model</span>
            <span class="dot" style="background:${PROVIDER_COLORS[current?.provider ?? ''] ?? '#a1a1aa'}"></span>
            <select .value=${this.model} ?disabled=${this.busy} @change=${(e: Event) => this.changeModel((e.target as HTMLSelectElement).value)}>
              ${this.models.map((m) => html`<option value=${m.id} ?selected=${m.id === this.model}>${m.label ?? m.id}</option>`)}
            </select>
            <span class="chevron">${svgIcon(icon.down, 12)}</span>
          </label>`
        : nothing;
    return html`<header>
      <div class="mark" aria-hidden="true">${this.heading.trim().charAt(0).toUpperCase()}</div>
      <div class="titles">
        <div class="title">${this.heading}</div>
        ${this.subtitle ? html`<div class="subtitle">${this.subtitle}</div>` : nothing}
      </div>
      ${picker}
      <button class="icon-button" title="New chat" aria-label="New chat" @click=${() => this.newChat()}>${svgIcon(icon.edit)}</button>
    </header>`;
  }

  private renderEmpty() {
    const cards = this.suggestions
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const at = s.indexOf(': ');
        return at > 0 ? { title: s.slice(0, at), detail: s.slice(at + 2) } : { title: s, detail: '' };
      });
    return html`<div class="empty">
      <h2>${greetingFor(new Date().getHours())}<span class="soft">${this.greeting}</span></h2>
      ${cards.length
        ? html`<div class="cards">
            ${cards.map(
              (c) => html`<button class="card" @click=${() => this.send(c.title)}>
                <b>${c.title}</b>${c.detail ? html`<small>${c.detail}</small>` : nothing}
              </button>`,
            )}
          </div>`
        : nothing}
    </div>`;
  }

  /** Group items into turns: a user message, then everything the assistant did in reply. */
  private renderThread() {
    const turns: TemplateResult[] = [];
    let reply: TemplateResult[] = [];
    const flush = () => reply.length && turns.push(html`<div class="turn">${reply}</div>`);
    for (const item of this.items) {
      if (item.kind === 'user') {
        flush();
        reply = [];
        turns.push(html`<div class="turn user">
          ${item.context.length ? html`<span class="attached">${svgIcon(icon.page, 12)}With ${item.context.join(', ')}</span>` : nothing}
          <div class="bubble">${item.text}</div>
        </div>`);
      } else reply.push(this.renderItem(item));
    }
    flush();
    return turns;
  }

  private renderItem(item: Exclude<Item, { kind: 'user' }>) {
    if (item.kind === 'note') {
      return html`<div class="note">${svgIcon(icon.brain, 14)}<span>Saved to memory: ${item.text}</span></div>`;
    }
    if (item.kind === 'tools') {
      return html`<div class="tools">${item.calls.map((c) => this.renderToolCall(c))}</div>`;
    }
    const thinking = item.streaming && !item.text;
    return html`
      ${item.reasoning && !this.hideReasoning
        ? html`<details class="thought" ?open=${thinking}>
            <summary>${svgIcon(icon.right, 14)}${thinking ? 'Thinking…' : 'Thought process'}</summary>
            <div class="text">${item.reasoning}</div>
          </details>`
        : nothing}
      ${item.text || (item.streaming && !item.reasoning)
        ? html`<div class="md ${item.streaming ? 'caret' : ''}">${unsafeHTML(renderMarkdown(item.text))}</div>`
        : nothing}
    `;
  }

  private renderToolCall(call: ToolCall) {
    const done = call.output !== undefined;
    const status = !done
      ? html`<span class="status running" aria-label="Running"></span>`
      : call.isError
        ? html`<span class="status error" aria-label="Failed">${svgIcon(icon.bang, 11)}</span>`
        : html`<span class="status ok" aria-label="Done">${svgIcon(icon.check, 11)}</span>`;
    return html`<details class="tool">
      <summary>
        ${status}<span class="tool-name">${call.name}</span>
        <span class="tool-summary">${summarize(call.input)}</span>
        <span class="chevron">${svgIcon(icon.down, 14)}</span>
      </summary>
      <div class="tool-body">
        <span class="label">Input</span><pre>${pretty(call.input)}</pre>
        ${done ? html`<span class="label">${call.isError ? 'Error' : 'Output'}</span><pre>${pretty(call.output)}</pre>` : nothing}
      </div>
    </details>`;
  }

  private renderComposer() {
    const context = this.activeContext();
    const keys = Object.keys(context);
    const running = this.items.flatMap((i) => (i.kind === 'tools' ? i.calls : [])).find((c) => c.output === undefined);
    const status = !this.busy
      ? ''
      : running
        ? `Using ${running.name}…`
        : this.items.at(-1)?.kind === 'assistant' && (this.items.at(-1) as { text: string }).text
          ? 'Writing…'
          : 'Thinking…';
    const canAddPage = this.pageContext ? this.dismissed.has('Page') : true;
    return html`<form @submit=${(e: Event) => (e.preventDefault(), this.send(this.draft))}>
      <div class="composer">
        ${keys.length
          ? html`<div class="chips">
              ${keys.map(
                (k) => html`<span class="chip">${svgIcon(icon.page, 14)}<span>${this.chipText(k, context[k])}</span>
                  <button type="button" aria-label=${`Remove ${k}`} @click=${() => (this.dismissed = new Set([...this.dismissed, k]))}>
                    ${svgIcon(icon.closeSmall, 12)}
                  </button></span>`,
              )}
            </div>`
          : nothing}
        <label class="sr-only" for="message">Message</label>
        <textarea id="message" rows="1" placeholder=${this.placeholder || `Message ${this.heading}…`} .value=${this.draft}
          @input=${this.onInput} @keydown=${this.onKeydown}></textarea>
        <div class="toolbar">
          ${canAddPage
            ? html`<button type="button" class="tool-button" title="Attach this page" aria-label="Attach this page"
                @click=${() => {
                  this.pageContext = true;
                  this.dismissed = new Set([...this.dismissed].filter((k) => k !== 'Page'));
                }}>${svgIcon(icon.plus, 16)}</button>`
            : nothing}
          ${status
            ? html`<span class="status-text" role="status">${status}</span>`
            : this.hasMemory
              ? html`<span class="pill">${svgIcon(icon.brain, 14)}Memory on</span>`
              : nothing}
          ${this.busy
            ? html`<button type="button" class="send stop" aria-label="Stop" @click=${() => this.stop()}>${svgIcon(icon.stop, 12)}</button>`
            : html`<button type="submit" class="send" aria-label="Send" ?disabled=${!this.draft.trim()}>${svgIcon(icon.send, 16)}</button>`}
        </div>
      </div>
      ${this.disclaimer ? html`<p class="disclaimer">${this.disclaimer}</p>` : nothing}
    </form>`;
  }
}

if (!customElements.get('lean-chat')) customElements.define('lean-chat', LeanChat);

declare global {
  interface HTMLElementTagNameMap {
    'lean-chat': LeanChat;
  }
}
