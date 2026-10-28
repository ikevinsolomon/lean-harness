import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { HookContext, Plugin } from './plugin.js';
import { cutPoint, estimateTokens, SUMMARY_PROMPT, summaryMessage, transcript, type ContextOptions, type Summary } from './context.js';
import { MemoryStore, type SessionPatch, type SessionStore } from './store.js';
import { toolOutputText, toolSpec, type Tool } from './tool.js';
import type {
  FilePart,
  HarnessEvent,
  Message,
  ModelInfo,
  ModelRequest,
  Part,
  Provider,
  ProviderEvent,
  Session,
  StopReason,
  ToolCallPart,
  ToolResultPart,
  Usage,
} from './types.js';

export interface HarnessOptions {
  /** Model providers. Shorthand for a plugin that only registers providers. */
  providers?: Provider[];
  plugins?: Plugin[];
  /** `provider/model` used when a session or turn names none. */
  defaultModel: string;
  /** Base system prompt; plugin instructions are appended. */
  instructions?: string;
  store?: SessionStore;
  /** Model calls allowed in one turn before it stops (default 12). */
  maxSteps?: number;
  /** How long a tool call waits for someone to allow it before it counts as declined (default 10 minutes). */
  approvalTimeoutMs?: number;
  /** How long one tool call may run before it fails (default 2 minutes). */
  toolTimeoutMs?: number;
  /** Summarise older turns when a conversation gets too long for the model. On by default; `false` turns it off. */
  context?: ContextOptions | false;
  /** Token limits (input, output and cached tokens together) per reply and per session. */
  budget?: { turnTokens?: number; sessionTokens?: number };
}

export interface RunOptions {
  /** Use this `provider/model` for this turn only. */
  model?: string;
  signal?: AbortSignal;
  /**
   * Context from the app, attached to this message: `{ "Page": "Q3 planning", "Role": "admin" }`.
   * Each entry becomes a labelled block the model reads before the message (objects as JSON).
   */
  context?: Record<string, unknown>;
  /**
   * Retry or edit: the id of an earlier user message. It and everything after it
   * are removed before this turn, so the new message takes its place.
   */
  replaceFrom?: string;
  /** Files attached to this message (images, PDFs, text). */
  files?: FilePart[];
}

function contextParts(context: Record<string, unknown> = {}): Part[] {
  return Object.entries(context)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([label, value]) => ({
      type: 'context' as const,
      label,
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    }));
}

interface BackgroundTurn {
  events: HarnessEvent[];
  done: boolean;
  wake: Set<() => void>;
  abort: AbortController;
}

export class HarnessError extends Error {
  constructor(
    readonly code: 'not_found' | 'busy' | 'bad_request',
    message: string,
  ) {
    super(message);
  }
}

/** Split `provider/model`. The model part may contain "/" (for example OpenRouter ids). */
export function parseModelId(id: string): { provider: string; model: string } {
  const slash = id.indexOf('/');
  if (slash <= 0 || slash === id.length - 1) {
    throw new HarnessError('bad_request', `Model "${id}" must look like "provider/model"`);
  }
  return { provider: id.slice(0, slash), model: id.slice(slash + 1) };
}

const now = () => new Date().toISOString();

function totalTokens(u: Usage = {}) {
  return (u.inputTokens ?? 0) + (u.outputTokens ?? 0) + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0);
}

function addUsage(total: Usage, add: Usage = {}): Usage {
  const sum = (a?: number, b?: number) => (a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0));
  return {
    inputTokens: sum(total.inputTokens, add.inputTokens),
    outputTokens: sum(total.outputTokens, add.outputTokens),
    cacheReadTokens: sum(total.cacheReadTokens, add.cacheReadTokens),
    cacheWriteTokens: sum(total.cacheWriteTokens, add.cacheWriteTokens),
  };
}

export class Harness {
  readonly store: SessionStore;
  readonly defaultModel: string;
  private readonly plugins: Plugin[];
  private readonly providers = new Map<string, Provider>();
  private readonly tools = new Map<string, Tool>();
  private readonly maxSteps: number;
  private readonly instructions: string;
  private readonly running = new Set<string>();
  private readonly approvalTimeoutMs: number;
  private readonly toolTimeoutMs: number;
  private readonly context: Required<ContextOptions> | false;
  private readonly budget: { turnTokens?: number; sessionTokens?: number };
  /** Tool calls waiting for a decision, by `sessionId:callId`. */
  private readonly pending = new Map<string, (approved: boolean) => void>();
  /** Turns running in the background, by session, with every event so far. */
  private readonly turns = new Map<string, BackgroundTurn>();

  constructor(options: HarnessOptions) {
    this.plugins = [{ name: 'providers', providers: options.providers ?? [] }, ...(options.plugins ?? [])];
    this.defaultModel = options.defaultModel;
    this.store = options.store ?? new MemoryStore();
    this.maxSteps = options.maxSteps ?? 12;
    this.instructions = options.instructions ?? 'You are a helpful assistant.';
    this.approvalTimeoutMs = options.approvalTimeoutMs ?? 10 * 60_000;
    this.toolTimeoutMs = options.toolTimeoutMs ?? 2 * 60_000;
    this.context = options.context === false ? false : { maxTokens: 150_000, keepRecent: 12, ...options.context };
    this.budget = options.budget ?? {};
    for (const plugin of this.plugins) {
      for (const provider of plugin.providers ?? []) {
        if (this.providers.has(provider.id)) throw new Error(`Two plugins register provider "${provider.id}"`);
        this.providers.set(provider.id, provider);
      }
      for (const tool of plugin.tools ?? []) {
        if (this.tools.has(tool.name)) throw new Error(`Two plugins register tool "${tool.name}"`);
        this.tools.set(tool.name, tool);
      }
    }
    parseModelId(this.defaultModel);
  }

  /** Every model the registered providers offer right now. */
  async listModels(): Promise<ModelInfo[]> {
    const lists = await Promise.all(
      [...this.providers.values()].map(async (provider) => {
        const models = await provider.listModels().catch(() => []);
        return models.map((model) => ({
          id: `${provider.id}/${model}`,
          provider: provider.id,
          model,
          label: provider.label ? `${provider.label} · ${model}` : model,
        }));
      }),
    );
    return lists.flat();
  }

  listTools() {
    return [...this.tools.values()].map(toolSpec);
  }

  async createSession(init: { model?: string; title?: string; owner?: string; metadata?: Record<string, unknown> } = {}) {
    const model = init.model ?? this.defaultModel;
    this.requireProvider(model);
    const session: Session = {
      id: randomUUID(),
      owner: init.owner,
      title: init.title,
      model,
      metadata: init.metadata ?? {},
      createdAt: now(),
      updatedAt: now(),
      messages: [],
    };
    return this.store.create(session);
  }

  async getSession(id: string) {
    const session = await this.store.get(id);
    if (!session) throw new HarnessError('not_found', `Session ${id} not found`);
    return session;
  }

  async updateSession(id: string, patch: SessionPatch) {
    await this.getSession(id);
    if (patch.model) this.requireProvider(patch.model);
    // Only the fields given; an undefined field must not wipe the stored one.
    const changes = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as SessionPatch;
    return this.store.update(id, changes);
  }

  /**
   * Run one turn: add the user's message, then call the model and run its tools
   * until it answers without tool calls (or a limit is reached). Yields every event.
   */
  async *run(sessionId: string, input: string, options: RunOptions = {}): AsyncGenerator<HarnessEvent> {
    if (!input.trim()) throw new HarnessError('bad_request', 'Message is empty');
    let session = await this.getSession(sessionId);
    const modelId = options.model ?? session.model;
    const { model } = parseModelId(modelId);
    const provider = this.requireProvider(modelId);
    if (this.running.has(sessionId)) throw new HarnessError('busy', 'This session is already running a turn');
    let cut = -1;
    if (options.replaceFrom) {
      cut = session.messages.findIndex((m) => m.id === options.replaceFrom);
      if (cut < 0 || session.messages[cut]!.role !== 'user') {
        throw new HarnessError('bad_request', 'replaceFrom must be the id of a user message in this session');
      }
    }
    this.running.add(sessionId);
    if (cut >= 0) session = await this.store.truncate(sessionId, cut);

    const signal = options.signal ?? new AbortController().signal;
    const context = (): HookContext => ({ session, model: modelId });
    const emit = async (event: HarnessEvent) => {
      for (const plugin of this.plugins) await plugin.hooks?.onEvent?.(event, context());
      return event;
    };
    const append = async (message: Message) => {
      session = await this.store.append(sessionId, [message]);
      return emit({ type: 'message', message });
    };

    let usage: Usage = {};
    let steps = 0;
    let stopReason: StopReason = 'max_steps';
    try {
      yield await emit({ type: 'turn_start', sessionId, model: modelId });
      if (!session.title) session = await this.store.update(sessionId, { title: input.trim().slice(0, 80) });
      const userMessage: Message = {
        id: randomUUID(),
        role: 'user',
        parts: [...(options.files ?? []), ...contextParts(options.context), { type: 'text', text: input }],
        createdAt: now(),
      };
      yield await append(userMessage);

      const spent = totalTokens(session.metadata.usage as Usage | undefined);
      if (this.budget.sessionTokens && spent >= this.budget.sessionTokens) {
        stopReason = 'budget';
        yield await emit({ type: 'error', message: 'This conversation has used its token budget. Start a new chat to continue.' });
      }

      while (stopReason !== 'budget' && steps < this.maxSteps) {
        steps++;
        const system = await this.systemPrompt(context());
        const request: ModelRequest = {
          model,
          system,
          messages: await this.window(sessionId, session, userMessage.id, provider, model, system, steps === 1, signal),
          tools: this.listTools(),
          signal,
        };
        for (const plugin of this.plugins) await plugin.hooks?.beforeModel?.(request, context());

        let done: Extract<ProviderEvent, { type: 'done' }> | undefined;
        for await (const event of provider.stream(request)) {
          if (event.type === 'done') done = event;
          else yield await emit(event);
        }
        if (!done) throw new Error(`Provider "${provider.id}" ended without a result`);
        usage = addUsage(usage, done.usage);

        yield await append({
          id: randomUUID(),
          role: 'assistant',
          parts: done.parts,
          createdAt: now(),
          model: done.servedBy ? `${provider.id}/${done.servedBy}` : modelId,
          usage: done.usage,
          native: done.native === undefined ? undefined : { provider: provider.id, data: done.native },
        });

        // Stopped while the model was writing: keep what it wrote, run no tools.
        if (signal.aborted) {
          stopReason = 'aborted';
          break;
        }

        const calls = done.parts.filter((p): p is ToolCallPart => p.type === 'tool_call');
        if (calls.length === 0 || done.stopReason === 'refusal') {
          stopReason = done.stopReason === 'tool_calls' ? 'end' : done.stopReason;
          break;
        }
        if (this.budget.turnTokens && totalTokens(usage) >= this.budget.turnTokens) {
          stopReason = 'budget';
          yield await emit({ type: 'error', message: 'This reply used its token budget before finishing.' });
          break;
        }
        if (done.stopReason === 'max_tokens') {
          // A tool input cut off by the output limit can still look valid; never run it.
          stopReason = 'max_tokens';
          yield await emit({ type: 'error', message: 'The model ran out of output tokens while calling a tool.' });
          break;
        }

        for (const call of calls) yield await emit({ type: 'tool_call', id: call.id, name: call.name, input: call.input });

        // Calls that need approval wait for a decision; the others are allowed straight away.
        const asks = await Promise.all(calls.map((call) => this.needsApproval(call, sessionId, session, signal)));
        const decisions = calls.map((call, i) => (asks[i] ? this.waitForDecision(sessionId, call.id, signal) : Promise.resolve(true)));
        for (const [i, call] of calls.entries()) {
          if (asks[i]) yield await emit({ type: 'approval_request', id: call.id, name: call.name, input: call.input });
        }
        const allowed = await Promise.all(decisions);
        const results = await Promise.all(
          calls.map((call, i) =>
            allowed[i]
              ? this.runTool(call, session, modelId, signal)
              : { type: 'tool_result' as const, toolCallId: call.id, name: call.name, output: 'The user declined this action.', isError: true },
          ),
        );
        for (const r of results) {
          yield await emit({ type: 'tool_result', id: r.toolCallId, name: r.name, output: r.output, isError: !!r.isError });
        }
        yield await append({ id: randomUUID(), role: 'tool', parts: results, createdAt: now() });
        if (signal.aborted) {
          stopReason = 'aborted';
          break;
        }
      }
    } catch (error) {
      stopReason = signal.aborted ? 'aborted' : 'error';
      if (!signal.aborted) yield await emit({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      this.running.delete(sessionId);
      await this.recordUsage(sessionId, usage).catch(() => undefined);
    }
    yield await emit({ type: 'turn_end', stopReason, usage, steps });
  }

  /**
   * Allow or decline a tool call that is waiting for approval. With `always`, the tool is
   * allowed for the rest of this session without asking. Returns false if nothing was waiting.
   */
  async decide(sessionId: string, callId: string, approved: boolean, always = false): Promise<boolean> {
    const resolve = this.pending.get(`${sessionId}:${callId}`);
    if (!resolve) return false;
    if (approved && always) {
      const session = await this.getSession(sessionId);
      const call = session.messages.flatMap((m) => m.parts).find((p) => p.type === 'tool_call' && p.id === callId);
      const allowedTools = new Set((session.metadata.allowedTools as string[] | undefined) ?? []);
      if (call?.type === 'tool_call') allowedTools.add(call.name);
      await this.store.update(sessionId, { metadata: { ...session.metadata, allowedTools: [...allowedTools] } });
    }
    resolve(approved);
    return true;
  }

  /**
   * Start a turn in the background. It keeps running when the caller goes away (a
   * closed tab); follow it with `watch`, stop it with `stop`. Throws straight away for
   * a missing session, a busy one, or a bad request.
   */
  async start(sessionId: string, input: string, options: Omit<RunOptions, 'signal'> = {}): Promise<void> {
    const abort = new AbortController();
    const events = this.run(sessionId, input, { ...options, signal: abort.signal });
    const first = await events.next();
    const turn: BackgroundTurn = { events: [], done: false, wake: new Set(), abort };
    this.turns.set(sessionId, turn);
    const push = (event: HarnessEvent) => {
      turn.events.push(event);
      for (const wake of turn.wake) wake();
    };
    if (!first.done) push(first.value);
    void (async () => {
      try {
        for await (const event of events) push(event);
      } catch (error) {
        push({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      } finally {
        turn.done = true;
        for (const wake of turn.wake) wake();
        // Keep the finished turn briefly, so a client that reconnects late still gets the end.
        setTimeout(() => this.turns.get(sessionId) === turn && this.turns.delete(sessionId), 60_000).unref?.();
      }
    })();
  }

  /** Every event of the session's current (or just finished) background turn, from `from`, then live ones. */
  async *watch(sessionId: string, from = 0): AsyncGenerator<HarnessEvent> {
    const turn = this.turns.get(sessionId);
    if (!turn) return;
    let i = from;
    for (;;) {
      while (i < turn.events.length) yield turn.events[i++]!;
      if (turn.done) return;
      await new Promise<void>((resolve) => {
        const wake = () => (turn.wake.delete(wake), resolve());
        turn.wake.add(wake);
      });
    }
  }

  /** Stop the session's background turn. Returns false if none is running. */
  stop(sessionId: string): boolean {
    const turn = this.turns.get(sessionId);
    if (!turn || turn.done) return false;
    turn.abort.abort();
    return true;
  }

  /** Whether a turn is running for this session right now. */
  isRunning(sessionId: string) {
    return this.running.has(sessionId);
  }

  /**
   * Structured output: have a model answer with data matching `schema`, outside any chat.
   * `await harness.extract(z.object({ city: z.string() }), 'I live in Pune')`. The model
   * answers through a tool whose input is the schema; invalid answers are retried twice.
   */
  async extract<S extends z.ZodType>(
    schema: S,
    input: string,
    options: { model?: string; instructions?: string; signal?: AbortSignal } = {},
  ): Promise<z.infer<S>> {
    const modelId = options.model ?? this.defaultModel;
    const provider = this.requireProvider(modelId);
    const { model } = parseModelId(modelId);
    const { $schema: _, ...json } = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
    // Tool inputs must be objects; wrap anything else in { value }.
    const wrapped = json.type !== 'object';
    const inputSchema = wrapped ? { type: 'object', properties: { value: json }, required: ['value'] } : json;
    const system = `${options.instructions ?? 'Extract the requested information from the input.'} Answer only by calling the \`respond\` tool, once.`;
    const messages: Message[] = [{ id: 'input', role: 'user', parts: [{ type: 'text', text: input }], createdAt: now() }];

    for (let attempt = 0; attempt < 3; attempt++) {
      let done: Extract<ProviderEvent, { type: 'done' }> | undefined;
      for await (const event of provider.stream({
        model,
        system,
        messages,
        tools: [{ name: 'respond', description: 'Give your answer.', inputSchema }],
        signal: options.signal,
      })) {
        if (event.type === 'done') done = event;
      }
      if (!done) throw new Error(`Provider "${provider.id}" ended without a result`);
      messages.push({
        id: `answer-${attempt}`,
        role: 'assistant',
        parts: done.parts,
        createdAt: now(),
        native: done.native === undefined ? undefined : { provider: provider.id, data: done.native },
      });
      const call = done.parts.find((p): p is ToolCallPart => p.type === 'tool_call' && p.name === 'respond');
      if (!call) {
        messages.push({ id: `nudge-${attempt}`, role: 'user', parts: [{ type: 'text', text: 'Answer by calling the respond tool.' }], createdAt: now() });
        continue;
      }
      const value = wrapped ? (call.input as { value?: unknown })?.value : call.input;
      const parsed = schema.safeParse(value);
      if (parsed.success) return parsed.data;
      messages.push({
        id: `invalid-${attempt}`,
        role: 'tool',
        parts: [{ type: 'tool_result', toolCallId: call.id, name: 'respond', output: `That answer does not match the schema: ${parsed.error.message}`, isError: true }],
        createdAt: now(),
      });
    }
    throw new Error('The model did not produce a valid answer after 3 tries');
  }

  /** Run a turn to completion and return the new messages (for non-streaming callers). */
  async send(sessionId: string, input: string, options: RunOptions = {}) {
    const messages: Message[] = [];
    let end: Extract<HarnessEvent, { type: 'turn_end' }> | undefined;
    let error: string | undefined;
    for await (const event of this.run(sessionId, input, options)) {
      if (event.type === 'message') messages.push(event.message);
      if (event.type === 'turn_end') end = event;
      if (event.type === 'error') error = event.message;
    }
    const text = messages
      .filter((m) => m.role === 'assistant')
      .flatMap((m) => m.parts)
      .filter((p): p is Extract<Part, { type: 'text' }> => p.type === 'text')
      .map((p) => p.text)
      .join('\n');
    return { text, messages, stopReason: end?.stopReason ?? 'error', usage: end?.usage ?? {}, error };
  }

  private requireProvider(modelId: string): Provider {
    const { provider: id } = parseModelId(modelId);
    const provider = this.providers.get(id);
    if (!provider) {
      throw new HarnessError('bad_request', `No provider "${id}". Registered: ${[...this.providers.keys()].join(', ') || 'none'}`);
    }
    return provider;
  }

  private async systemPrompt(context: HookContext): Promise<string> {
    const sections = [this.instructions];
    for (const plugin of this.plugins) {
      const text = typeof plugin.instructions === 'function' ? await plugin.instructions(context) : plugin.instructions;
      if (text?.trim()) sections.push(text.trim());
    }
    return sections.join('\n\n');
  }

  /**
   * The messages to send. Long conversations get their older turns replaced by a summary
   * (only ever at the start of a reply). Once summarised, earlier replies are sent without
   * provider-native data such as thinking blocks, which are only valid with the exact
   * history they were written for.
   */
  private async window(
    sessionId: string,
    session: Session,
    turnStart: string,
    provider: Provider,
    model: string,
    system: string,
    mayCompact: boolean,
    signal: AbortSignal,
  ): Promise<Message[]> {
    if (!this.context) return session.messages;
    const { maxTokens, keepRecent } = this.context;
    let summary = session.metadata.summary as Summary | undefined;
    let from = summary ? session.messages.findIndex((m) => m.id === summary!.upTo) + 1 : 0;
    if (from === 0) summary = undefined; // the summarised part was cut away by a retry or edit

    const build = (s: Summary | undefined, start: number) => {
      const kept = session.messages.slice(start);
      if (!s) return kept;
      const current = kept.findIndex((m) => m.id === turnStart);
      return [summaryMessage(s), ...kept.map((m, i) => (i < current ? { ...m, native: undefined } : m))];
    };

    let messages = build(summary, from);
    if (!mayCompact || estimateTokens(messages, system) <= maxTokens) return messages;

    const rest = session.messages.slice(from);
    const cut = cutPoint(rest, keepRecent);
    if (cut <= 0) return messages;
    const old = rest.slice(0, cut);
    const text = await this.complete(provider, {
      model,
      system: SUMMARY_PROMPT,
      tools: [],
      signal,
      messages: [
        {
          id: 'summarise',
          role: 'user',
          createdAt: now(),
          parts: [{ type: 'text', text: `${summary ? `Earlier summary:\n${summary.text}\n\n` : ''}${transcript(old)}` }],
        },
      ],
    });
    summary = { upTo: old.at(-1)!.id, text };
    from += cut;
    const latest = (await this.store.get(sessionId)) ?? session;
    await this.store.update(sessionId, { metadata: { ...latest.metadata, summary } });
    messages = build(summary, from);
    return messages;
  }

  /** One model call, returning its text. */
  private async complete(provider: Provider, request: ModelRequest): Promise<string> {
    let text = '';
    for await (const event of provider.stream(request)) {
      if (event.type === 'done') text = event.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('\n');
    }
    return text.trim();
  }

  /** Add a turn's token use to the session's running total. */
  private async recordUsage(sessionId: string, usage: Usage) {
    if (!totalTokens(usage)) return;
    const latest = await this.store.get(sessionId);
    if (!latest) return;
    await this.store.update(sessionId, { metadata: { ...latest.metadata, usage: addUsage((latest.metadata.usage as Usage) ?? {}, usage) } });
  }

  private async needsApproval(call: ToolCallPart, sessionId: string, session: Session, signal: AbortSignal): Promise<boolean> {
    const tool = this.tools.get(call.name);
    if (!tool?.needsApproval) return false;
    const parsed = tool.input.safeParse(call.input);
    if (!parsed.success) return false; // runTool reports the bad input instead of asking about it
    const latest = (await this.store.get(sessionId)) ?? session;
    if (((latest.metadata.allowedTools as string[] | undefined) ?? []).includes(call.name)) return false;
    return typeof tool.needsApproval === 'function' ? !!(await tool.needsApproval(parsed.data, { session, signal })) : true;
  }

  /** Resolves true when allowed; false when declined, timed out, or the turn was stopped. */
  private waitForDecision(sessionId: string, callId: string, signal: AbortSignal): Promise<boolean> {
    const key = `${sessionId}:${callId}`;
    return new Promise((resolve) => {
      const finish = (approved: boolean) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        this.pending.delete(key);
        resolve(approved);
      };
      const onAbort = () => finish(false);
      const timer = setTimeout(() => finish(false), this.approvalTimeoutMs);
      signal.addEventListener('abort', onAbort, { once: true });
      this.pending.set(key, finish);
      if (signal.aborted) finish(false);
    });
  }

  private async runTool(call: ToolCallPart, session: Session, model: string, signal: AbortSignal): Promise<ToolResultPart> {
    const result = (output: string, isError = false): ToolResultPart => ({
      type: 'tool_result',
      toolCallId: call.id,
      name: call.name,
      output,
      isError,
    });
    const tool = this.tools.get(call.name);
    if (!tool) return result(`Unknown tool "${call.name}".`, true);
    const parsed = tool.input.safeParse(call.input);
    if (!parsed.success) return result(`Invalid input for ${call.name}: ${parsed.error.message}`, true);
    for (const plugin of this.plugins) {
      const verdict = await plugin.hooks?.beforeToolCall?.({ id: call.id, name: call.name, input: parsed.data }, { session, model });
      if (verdict && 'deny' in verdict) return result(`Not allowed: ${verdict.deny}`, true);
    }
    try {
      const timeout = AbortSignal.timeout(this.toolTimeoutMs);
      const output = await Promise.race([
        tool.run(parsed.data, { session, signal: AbortSignal.any([signal, timeout]) }),
        new Promise<never>((_, reject) =>
          timeout.addEventListener('abort', () => reject(new Error(`${call.name} timed out after ${this.toolTimeoutMs < 1000 ? `${this.toolTimeoutMs}ms` : `${Math.round(this.toolTimeoutMs / 1000)}s`}`)), { once: true }),
        ),
      ]);
      return result(toolOutputText(output));
    } catch (error) {
      return result(error instanceof Error ? error.message : String(error), true);
    }
  }
}

export function createHarness(options: HarnessOptions) {
  return new Harness(options);
}
