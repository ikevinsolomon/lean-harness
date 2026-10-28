import { html, LitElement, nothing, type PropertyValues, svg } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { ApiError, HarnessClient, type ChatEvent, type Message, type ModelInfo } from './client.js';
import { renderMarkdown } from './markdown.js';
import { styles } from './styles.js';

export { HarnessClient, ApiError } from './client.js';
export type { ChatEvent, Message, ModelInfo, Session } from './client.js';

type Item =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; reasoning: string; streaming: boolean }
  | { kind: 'tool'; id: string; name: string; input: unknown; output?: string; isError?: boolean };

const icon = {
  spark: svg`<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z" fill="currentColor"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" fill="currentColor" opacity=".7"/>`,
  send: svg`<path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  stop: svg`<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/>`,
  plus: svg`<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  chat: svg`<path d="M4 5.5A2.5 2.5 0 016.5 3h11A2.5 2.5 0 0120 5.5v8a2.5 2.5 0 01-2.5 2.5H10l-4.5 4v-4h0A1.5 1.5 0 014 14.5z" fill="currentColor"/>`,
  close: svg`<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
  tool: svg`<path d="M14.7 6.3a4 4 0 00-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 005.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>`,
  check: svg`<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  alert: svg`<path d="M12 8v5M12 16.5v.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/>`,
  brain: svg`<path d="M9 4a3 3 0 00-3 3 3 3 0 00-2 5 3 3 0 002 5 3 3 0 006 0V4.5A2.5 2.5 0 009 4zM15 4a3 3 0 013 3 3 3 0 012 5 3 3 0 01-2 5 3 3 0 01-6 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>`,
};

const svgIcon = (body: ReturnType<typeof svg>, size = 18) =>
  html`<svg width=${size} height=${size} viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

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

/** Turn stored messages back into chat items. */
function toItems(messages: Message[]): Item[] {
  const items: Item[] = [];
  const results = new Map<string, { output: string; isError?: boolean }>();
  for (const m of messages) for (const p of m.parts) if (p.type === 'tool_result') results.set(p.toolCallId, p);
  for (const m of messages) {
    if (m.role === 'user') {
      items.push({ kind: 'user', text: m.parts.map((p) => (p.type === 'text' ? p.text : '')).join('\n') });
    } else if (m.role === 'assistant') {
      const text = m.parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
      const reasoning = m.parts.map((p) => (p.type === 'reasoning' ? p.text : '')).join('');
      if (text || reasoning) items.push({ kind: 'assistant', text, reasoning, streaming: false });
      for (const p of m.parts) {
        if (p.type === 'tool_call') items.push({ kind: 'tool', id: p.id, name: p.name, input: p.input, ...results.get(p.id) });
      }
    }
  }
  return items;
}

/**
 * <lean-chat endpoint="https://your-server"></lean-chat>
 *
 * Attributes: endpoint, token, model, heading, subtitle, placeholder, greeting,
 * suggestions ("First idea | Second idea"), mode ("inline" | "floating"),
 * theme ("auto" | "light" | "dark"), hide-model-picker, hide-reasoning.
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
    placeholder: { type: String },
    greeting: { type: String },
    suggestions: { type: String },
    mode: { type: String, reflect: true },
    theme: { type: String, reflect: true },
    hideModelPicker: { type: Boolean, attribute: 'hide-model-picker' },
    hideReasoning: { type: Boolean, attribute: 'hide-reasoning' },
    open: { type: Boolean, reflect: true },
    items: { state: true },
    models: { state: true },
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
  declare placeholder: string;
  declare greeting: string;
  declare suggestions: string;
  declare mode: 'inline' | 'floating';
  declare theme: 'auto' | 'light' | 'dark';
  declare hideModelPicker: boolean;
  declare hideReasoning: boolean;
  declare open: boolean;
  declare private items: Item[];
  declare private models: ModelInfo[];
  declare private busy: boolean;
  declare private error: string;
  declare private draft: string;

  private sessionId?: string;
  private abort?: AbortController;
  private client!: HarnessClient;

  constructor() {
    super();
    this.endpoint = '';
    this.model = '';
    this.heading = 'Assistant';
    this.subtitle = '';
    this.placeholder = 'Message…';
    this.greeting = 'How can I help you today?';
    this.suggestions = '';
    this.mode = 'inline';
    this.theme = 'auto';
    this.hideModelPicker = false;
    this.hideReasoning = false;
    this.open = false;
    this.items = [];
    this.models = [];
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
      const { defaultModel, models } = await this.client.models();
      this.models = models;
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

  /** Start a fresh conversation. */
  newChat() {
    this.abort?.abort();
    this.sessionId = undefined;
    this.items = [];
    this.error = '';
    safeStorage(() => localStorage.removeItem(this.storageKey));
    this.focusInput();
  }

  /** Send a message as if the user typed it. */
  async send(text: string) {
    const content = text.trim();
    if (!content || this.busy) return;
    this.error = '';
    this.draft = '';
    const area = this.renderRoot.querySelector('textarea');
    if (area) area.style.height = 'auto';
    this.items = [...this.items, { kind: 'user', text: content }];
    this.busy = true;
    this.abort = new AbortController();
    try {
      if (!this.sessionId) {
        const session = await this.client.createSession(this.model || undefined);
        this.sessionId = session.id;
        safeStorage(() => localStorage.setItem(this.storageKey, session.id));
      }
      for await (const event of this.client.send(this.sessionId, content, this.abort.signal)) this.apply(event);
    } catch (error) {
      if (!this.abort.signal.aborted) this.fail(error);
    } finally {
      this.busy = false;
      this.items = this.items.map((i) => (i.kind === 'assistant' && i.streaming ? { ...i, streaming: false } : i));
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
      case 'tool_call':
        this.items = [
          ...this.items.map((i) => (i.kind === 'assistant' ? { ...i, streaming: false } : i)),
          { kind: 'tool', id: event.id, name: event.name, input: event.input },
        ];
        break;
      case 'tool_result':
        this.items = this.items.map((i) =>
          i.kind === 'tool' && i.id === event.id ? { ...i, output: event.output, isError: event.isError } : i,
        );
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
    this.error = error instanceof ApiError || error instanceof Error ? error.message : 'Something went wrong.';
    if (error instanceof TypeError) this.error = `Can't reach the assistant at ${this.endpoint || location.origin}.`;
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
        ${svgIcon(icon.chat, 26)}
      </button>`;
    }
    return html`
      <section class="panel" role="region" aria-label=${this.heading}>
        ${this.renderHeader()}
        <div class="log" aria-live="polite">${this.items.length ? this.items.map((i) => this.renderItem(i)) : this.renderEmpty()}
          ${this.busy && this.items.at(-1)?.kind !== 'assistant' && !this.runningTool()
            ? html`<div class="row"><div class="typing" aria-label="Thinking"><span></span><span></span><span></span></div></div>`
            : nothing}
        </div>
        ${this.error
          ? html`<div class="error" role="alert">${svgIcon(icon.alert, 16)}<span>${this.error}</span>
              <button aria-label="Dismiss" @click=${() => (this.error = '')}>${svgIcon(icon.close, 14)}</button></div>`
          : nothing}
        ${this.renderComposer()}
      </section>
      ${this.mode === 'floating'
        ? html`<button class="launcher" aria-label="Close chat" @click=${() => (this.open = false)}>${svgIcon(icon.close, 24)}</button>`
        : nothing}
    `;
  }

  private runningTool() {
    return this.items.some((i) => i.kind === 'tool' && i.output === undefined);
  }

  private renderHeader() {
    const picker =
      !this.hideModelPicker && this.models.length > 1
        ? html`<select class="model" aria-label="Model" .value=${this.model} ?disabled=${this.busy}
            @change=${(e: Event) => this.changeModel((e.target as HTMLSelectElement).value)}>
            ${this.models.map((m) => html`<option value=${m.id} ?selected=${m.id === this.model}>${m.label ?? m.id}</option>`)}
          </select>`
        : nothing;
    return html`<header>
      <div class="avatar">${svgIcon(icon.spark, 20)}</div>
      <div class="titles">
        <div class="title">${this.heading}</div>
        ${this.subtitle ? html`<div class="subtitle">${this.subtitle}</div>` : nothing}
      </div>
      ${picker}
      <button class="icon-button" title="New chat" aria-label="New chat" @click=${() => this.newChat()}>${svgIcon(icon.plus)}</button>
    </header>`;
  }

  private renderEmpty() {
    const chips = this.suggestions
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
    return html`<div class="empty">
      <div class="avatar">${svgIcon(icon.spark, 28)}</div>
      <h2>${this.greeting}</h2>
      ${this.subtitle ? html`<p>${this.subtitle}</p>` : nothing}
      ${chips.length
        ? html`<div class="chips">${chips.map((c) => html`<button class="chip" @click=${() => this.send(c)}>${c}</button>`)}</div>`
        : nothing}
    </div>`;
  }

  private renderItem(item: Item) {
    if (item.kind === 'user') return html`<div class="row user"><div class="bubble">${item.text}</div></div>`;
    if (item.kind === 'tool') {
      const done = item.output !== undefined;
      const status = !done
        ? html`<span class="tool-status"><span class="spinner"></span>Running</span>`
        : item.isError
          ? html`<span class="tool-status error">${svgIcon(icon.alert, 14)}Failed</span>`
          : html`<span class="tool-status ok">${svgIcon(icon.check, 14)}Done</span>`;
      return html`<div class="row"><details class="tool" style="width:100%">
        <summary>${svgIcon(icon.tool, 15)}<span class="tool-name">${item.name}</span>${status}</summary>
        <div class="tool-body">
          <span class="label">Input</span><pre>${pretty(item.input)}</pre>
          ${done ? html`<span class="label">Output</span><pre>${pretty(item.output)}</pre>` : nothing}
        </div>
      </details></div>`;
    }
    return html`<div class="row"><div class="assistant">
      ${item.reasoning && !this.hideReasoning
        ? html`<details class="reasoning" ?open=${item.streaming && !item.text}>
            <summary>${svgIcon(icon.brain, 15)}${item.streaming && !item.text ? 'Thinking…' : 'Thought process'}</summary>
            <div class="thought">${item.reasoning}</div>
          </details>`
        : nothing}
      ${item.text || item.streaming
        ? html`<div class="md ${item.streaming ? 'cursor' : ''}">${unsafeHTML(renderMarkdown(item.text))}</div>`
        : nothing}
    </div></div>`;
  }

  private renderComposer() {
    const empty = !this.draft.trim();
    return html`<form @submit=${(e: Event) => (e.preventDefault(), this.send(this.draft))}>
      <div class="composer">
        <textarea rows="1" aria-label="Message" placeholder=${this.placeholder} .value=${this.draft}
          @input=${this.onInput} @keydown=${this.onKeydown}></textarea>
        ${this.busy
          ? html`<button type="button" class="send" aria-label="Stop" @click=${() => this.stop()}>${svgIcon(icon.stop)}</button>`
          : html`<button type="submit" class="send" aria-label="Send" ?disabled=${empty}>${svgIcon(icon.send)}</button>`}
      </div>
      <div class="footer">${this.model ? html`Using <b>${this.models.find((m) => m.id === this.model)?.label ?? this.model}</b>` : nothing}</div>
    </form>`;
  }
}

if (!customElements.get('lean-chat')) customElements.define('lean-chat', LeanChat);

declare global {
  interface HTMLElementTagNameMap {
    'lean-chat': LeanChat;
  }
}
