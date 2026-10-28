import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages';
import type { Message, ModelRequest, Part, Provider, ProviderEvent, StopReason } from '../types.js';
import { answerOrphanedToolCalls, binaryFiles, IMAGE_TYPES, userText } from './history.js';

export interface AnthropicOptions {
  id?: string;
  apiKey?: string;
  baseURL?: string;
  /** Models offered to clients. */
  models?: string[];
  maxTokens?: number;
  /** Thinking depth and token spend. Left to the model's default when unset. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Show summarized reasoning on models with adaptive thinking (default true). */
  showReasoning?: boolean;
  /**
   * When a model's safety classifier declines a request, let the API retry it on
   * Anthropic's recommended fallback model in the same call (default true).
   */
  refusalFallback?: boolean;
  /**
   * Let Claude search the web. Runs on Anthropic's servers: no tool code, results
   * arrive with the reply. `true`, or settings such as `{ maxUses: 5, allowedDomains: [...] }`.
   */
  webSearch?: boolean | { maxUses?: number; allowedDomains?: string[]; blockedDomains?: string[] };
  /** Let Claude run code in Anthropic's sandbox (Python and shell), e.g. for maths and data. */
  codeExecution?: boolean;
}

const DEFAULT_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'];
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

/** Adaptive thinking exists on Opus/Sonnet 4.6+, Haiku 5+, and every Fable and Mythos model. */
export function supportsAdaptiveThinking(model: string): boolean {
  const match = /^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d+))?(?:$|-)/.exec(model);
  if (!match) return false;
  const [, family, major, minor] = match;
  if (family === 'fable' || family === 'mythos') return true;
  const version = Number(major) + Number(minor && minor.length <= 2 ? minor : 0) / 10;
  return family === 'haiku' ? version >= 5 : version >= 4.6;
}

/** The web search variant with dynamic filtering exists on Opus and Sonnet 4.6 and later. */
export function supportsDynamicWebSearch(model: string): boolean {
  return /^claude-(opus|sonnet)-/.test(model) && supportsAdaptiveThinking(model);
}

/** Anthropic-hosted tools for this request: web search and code execution. */
function serverTools(model: string, options: AnthropicOptions): Anthropic.ToolUnion[] {
  const tools: Anthropic.ToolUnion[] = [];
  if (options.webSearch) {
    const s = options.webSearch === true ? {} : options.webSearch;
    const settings = {
      ...(s.maxUses ? { max_uses: s.maxUses } : {}),
      ...(s.allowedDomains ? { allowed_domains: s.allowedDomains } : {}),
      ...(s.blockedDomains ? { blocked_domains: s.blockedDomains } : {}),
    };
    // The dynamic variant runs its own code sandbox; with code execution on too, use the basic one.
    tools.push(
      supportsDynamicWebSearch(model) && !options.codeExecution
        ? { type: 'web_search_20260209', name: 'web_search', ...settings }
        : { type: 'web_search_20250305', name: 'web_search', ...settings },
    );
  }
  if (options.codeExecution) tools.push({ type: 'code_execution_20260521', name: 'code_execution' });
  return tools;
}

/** A turn paused by the server's tool loop is resumed at most this many times. */
const MAX_CONTINUATIONS = 5;

/** Convert harness messages to Anthropic's format. Exported for tests. */
export function toAnthropicMessages(messages: Message[], providerId = 'anthropic'): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  const push = (role: 'user' | 'assistant', content: Anthropic.ContentBlockParam[]) => {
    const last = out.at(-1);
    // Anthropic needs alternating roles: merge consecutive messages of the same role.
    if (last && last.role === role && Array.isArray(last.content)) last.content.push(...content);
    else out.push({ role, content });
  };

  for (const message of answerOrphanedToolCalls(messages)) {
    if (message.role === 'assistant') {
      // Replay our own responses exactly: thinking blocks must come back unchanged.
      if (message.native?.provider === providerId) {
        push('assistant', message.native.data as Anthropic.ContentBlockParam[]);
        continue;
      }
      const content: Anthropic.ContentBlockParam[] = [];
      for (const part of message.parts) {
        if (part.type === 'text' && part.text) content.push({ type: 'text', text: part.text });
        if (part.type === 'tool_call') {
          content.push({ type: 'tool_use', id: part.id, name: part.name, input: (part.input ?? {}) as Record<string, unknown> });
        }
      }
      if (content.length) push('assistant', content);
    } else if (message.role === 'tool') {
      const results: Anthropic.ToolResultBlockParam[] = message.parts.flatMap((p) =>
        p.type === 'tool_result'
          ? [{ type: 'tool_result' as const, tool_use_id: p.toolCallId, content: p.output, is_error: p.isError || undefined }]
          : [],
      );
      push('user', results);
    } else {
      const files: Anthropic.ContentBlockParam[] = binaryFiles(message.parts).map((f) =>
        IMAGE_TYPES.has(f.mediaType)
          ? { type: 'image', source: { type: 'base64', media_type: f.mediaType as 'image/png', data: f.data } }
          : f.mediaType === 'application/pdf'
            ? { type: 'document', title: f.name, source: { type: 'base64', media_type: 'application/pdf', data: f.data } }
            : { type: 'text', text: `[Attached ${f.name} (${f.mediaType}), which this model cannot read.]` },
      );
      push('user', [...files, { type: 'text', text: userText(message.parts) }]);
    }
  }
  return out;
}

function stopReason(reason: string | null): StopReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end';
    case 'tool_use':
      return 'tool_calls';
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    default:
      return 'other';
  }
}

export function anthropic(options: AnthropicOptions = {}): Provider {
  const id = options.id ?? 'anthropic';
  const client = new Anthropic({ apiKey: options.apiKey, baseURL: options.baseURL });
  const models = options.models ?? DEFAULT_MODELS;

  return {
    id,
    label: 'Anthropic',
    listModels: async () => models,

    async *stream(request: ModelRequest): AsyncIterable<ProviderEvent> {
      const params: Anthropic.MessageStreamParams = {
        model: request.model,
        max_tokens: options.maxTokens ?? 64000,
        system: request.system,
        messages: toAnthropicMessages(request.messages, id),
        // Cache the stable prefix (tools, system prompt, earlier turns) automatically.
        cache_control: { type: 'ephemeral' },
      };
      const tools: Anthropic.ToolUnion[] = [
        ...request.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
        })),
        ...serverTools(request.model, options),
      ];
      if (tools.length) params.tools = tools;
      if (supportsAdaptiveThinking(request.model)) {
        params.thinking = { type: 'adaptive', display: options.showReasoning === false ? 'omitted' : 'summarized' };
      }
      if (options.effort) params.output_config = { effort: options.effort };

      const open = (p: Anthropic.MessageStreamParams) =>
        options.refusalFallback !== false && FALLBACK_MODELS.has(request.model)
          ? client.beta.messages.stream(
              { ...p, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } as BetaMessageStreamParams,
              { signal: request.signal },
            )
          : client.messages.stream(p, { signal: request.signal });

      // Server tools (web search, code execution) run in a loop on Anthropic's side. When that
      // loop pauses, send the reply so far back and the server picks up where it stopped.
      const content: Anthropic.ContentBlock[] = [];
      const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
      let message: Anthropic.Message;
      for (let round = 0; ; round++) {
        const stream = open(
          round === 0 ? params : { ...params, messages: [...params.messages, { role: 'assistant', content: content as Anthropic.ContentBlockParam[] }] },
        );
        for await (const event of stream) {
          if (event.type !== 'content_block_delta') continue;
          if (event.delta.type === 'text_delta') yield { type: 'text_delta', text: event.delta.text };
          if (event.delta.type === 'thinking_delta') yield { type: 'reasoning_delta', text: event.delta.thinking };
        }
        message = (await stream.finalMessage()) as Anthropic.Message;
        content.push(...message.content);
        usage.inputTokens += message.usage.input_tokens;
        usage.outputTokens += message.usage.output_tokens;
        usage.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0;
        usage.cacheWriteTokens += message.usage.cache_creation_input_tokens ?? 0;
        if (message.stop_reason !== 'pause_turn' || round >= MAX_CONTINUATIONS || request.signal?.aborted) break;
      }

      const parts: Part[] = [];
      for (const block of content) {
        if (block.type === 'text') parts.push({ type: 'text', text: block.text });
        if (block.type === 'thinking' && block.thinking) parts.push({ type: 'reasoning', text: block.thinking });
        // Only client tools: server tools already ran on Anthropic's side.
        if (block.type === 'tool_use') parts.push({ type: 'tool_call', id: block.id, name: block.name, input: block.input });
      }
      yield {
        type: 'done',
        parts,
        stopReason: stopReason(message.stop_reason),
        native: content,
        servedBy: message.model !== request.model ? message.model : undefined,
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens || undefined,
          cacheWriteTokens: usage.cacheWriteTokens || undefined,
        },
      };
    },
  };
}
