import { randomUUID } from 'node:crypto';
import type { HookContext, Plugin } from './plugin.js';
import { MemoryStore, type SessionPatch, type SessionStore } from './store.js';
import { toolOutputText, toolSpec, type Tool } from './tool.js';
import type {
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
}

export interface RunOptions {
  /** Use this `provider/model` for this turn only. */
  model?: string;
  signal?: AbortSignal;
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

  constructor(options: HarnessOptions) {
    this.plugins = [{ name: 'providers', providers: options.providers ?? [] }, ...(options.plugins ?? [])];
    this.defaultModel = options.defaultModel;
    this.store = options.store ?? new MemoryStore();
    this.maxSteps = options.maxSteps ?? 12;
    this.instructions = options.instructions ?? 'You are a helpful assistant.';
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

  async createSession(init: { model?: string; title?: string; metadata?: Record<string, unknown> } = {}) {
    const model = init.model ?? this.defaultModel;
    this.requireProvider(model);
    const session: Session = {
      id: randomUUID(),
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
    return this.store.update(id, patch);
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
    this.running.add(sessionId);

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
      yield await append({ id: randomUUID(), role: 'user', parts: [{ type: 'text', text: input }], createdAt: now() });

      while (steps < this.maxSteps) {
        steps++;
        const request: ModelRequest = {
          model,
          system: await this.systemPrompt(context()),
          messages: session.messages,
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

        const calls = done.parts.filter((p): p is ToolCallPart => p.type === 'tool_call');
        if (calls.length === 0 || done.stopReason === 'refusal') {
          stopReason = done.stopReason === 'tool_calls' ? 'end' : done.stopReason;
          break;
        }
        if (done.stopReason === 'max_tokens') {
          // A tool input cut off by the output limit can still look valid; never run it.
          stopReason = 'max_tokens';
          yield await emit({ type: 'error', message: 'The model ran out of output tokens while calling a tool.' });
          break;
        }

        for (const call of calls) yield await emit({ type: 'tool_call', id: call.id, name: call.name, input: call.input });
        const results = await Promise.all(calls.map((call) => this.runTool(call, session, modelId, signal)));
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
    }
    yield await emit({ type: 'turn_end', stopReason, usage, steps });
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
      return result(toolOutputText(await tool.run(parsed.data, { session, signal })));
    } catch (error) {
      return result(error instanceof Error ? error.message : String(error), true);
    }
  }
}

export function createHarness(options: HarnessOptions) {
  return new Harness(options);
}
