import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages';
import type { Message, ModelRequest, Part, Provider, ProviderEvent, StopReason } from '../types.js';
import { answerOrphanedToolCalls, userText } from './history.js';

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
      push('user', [{ type: 'text', text: userText(message.parts) }]);
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
      if (request.tools.length) {
        params.tools = request.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
        }));
      }
      if (supportsAdaptiveThinking(request.model)) {
        params.thinking = { type: 'adaptive', display: options.showReasoning === false ? 'omitted' : 'summarized' };
      }
      if (options.effort) params.output_config = { effort: options.effort };

      const stream =
        options.refusalFallback !== false && FALLBACK_MODELS.has(request.model)
          ? client.beta.messages.stream(
              { ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } as BetaMessageStreamParams,
              { signal: request.signal },
            )
          : client.messages.stream(params, { signal: request.signal });

      for await (const event of stream) {
        if (event.type !== 'content_block_delta') continue;
        if (event.delta.type === 'text_delta') yield { type: 'text_delta', text: event.delta.text };
        if (event.delta.type === 'thinking_delta') yield { type: 'reasoning_delta', text: event.delta.thinking };
      }
      const message = await stream.finalMessage();

      const parts: Part[] = [];
      for (const block of message.content) {
        if (block.type === 'text') parts.push({ type: 'text', text: block.text });
        if (block.type === 'thinking' && block.thinking) parts.push({ type: 'reasoning', text: block.thinking });
        if (block.type === 'tool_use') parts.push({ type: 'tool_call', id: block.id, name: block.name, input: block.input });
      }
      yield {
        type: 'done',
        parts,
        stopReason: stopReason(message.stop_reason),
        native: message.content,
        servedBy: message.model !== request.model ? message.model : undefined,
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
          cacheReadTokens: message.usage.cache_read_input_tokens ?? undefined,
          cacheWriteTokens: message.usage.cache_creation_input_tokens ?? undefined,
        },
      };
    },
  };
}
