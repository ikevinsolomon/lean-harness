import OpenAI from 'openai';
import type { Message, ModelRequest, Part, Provider, ProviderEvent, StopReason } from '../types.js';
import { answerOrphanedToolCalls, userText } from './history.js';

export interface OpenAICompatibleOptions {
  /** The prefix in `provider/model`. */
  id: string;
  label?: string;
  baseURL?: string;
  apiKey?: string;
  /** Models offered to clients. When omitted they are read from the server's /models list. */
  models?: string[];
  maxTokens?: number;
  headers?: Record<string, string>;
}

type ChatMessage = OpenAI.Chat.ChatCompletionMessageParam;

/** Convert harness messages to the Chat Completions format. Exported for tests. */
export function toChatMessages(system: string, messages: Message[]): ChatMessage[] {
  const out: ChatMessage[] = system ? [{ role: 'system', content: system }] : [];
  for (const message of answerOrphanedToolCalls(messages)) {
    const text = message.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('\n');
    if (message.role === 'user') {
      out.push({ role: 'user', content: userText(message.parts) });
    } else if (message.role === 'assistant') {
      const calls = message.parts.flatMap((p) =>
        p.type === 'tool_call'
          ? [{ id: p.id, type: 'function' as const, function: { name: p.name, arguments: JSON.stringify(p.input ?? {}) } }]
          : [],
      );
      out.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
    } else {
      for (const p of message.parts) {
        if (p.type === 'tool_result') out.push({ role: 'tool', tool_call_id: p.toolCallId, content: p.output });
      }
    }
  }
  return out;
}

function stopReason(reason: string | null | undefined): StopReason {
  if (reason === 'stop') return 'end';
  if (reason === 'tool_calls' || reason === 'function_call') return 'tool_calls';
  if (reason === 'length') return 'max_tokens';
  if (reason === 'content_filter') return 'refusal';
  return 'other';
}

/**
 * Any server that speaks the OpenAI Chat Completions API: OpenAI, DeepSeek,
 * Google Gemini, OpenRouter, Groq, Ollama, vLLM, LM Studio...
 */
export function openaiCompatible(options: OpenAICompatibleOptions): Provider {
  const client = new OpenAI({
    apiKey: options.apiKey ?? 'not-needed',
    baseURL: options.baseURL,
    defaultHeaders: options.headers,
  });
  let discovered: Promise<string[]> | undefined;

  return {
    id: options.id,
    label: options.label,

    listModels() {
      if (options.models) return Promise.resolve(options.models);
      discovered ??= client.models
        .list({ timeout: 3000, maxRetries: 0 })
        .then((page) => page.data.map((m) => m.id).sort())
        .catch((error) => {
          discovered = undefined; // try again next time; the server may not be up yet
          throw error;
        });
      return discovered;
    },

    async *stream(request: ModelRequest): AsyncIterable<ProviderEvent> {
      const stream = await client.chat.completions.create(
        {
          model: request.model,
          messages: toChatMessages(request.system, request.messages),
          ...(request.tools.length
            ? {
                tools: request.tools.map((t) => ({
                  type: 'function' as const,
                  function: { name: t.name, description: t.description, parameters: t.inputSchema },
                })),
              }
            : {}),
          ...(options.maxTokens ? { max_completion_tokens: options.maxTokens } : {}),
          stream: true,
          stream_options: { include_usage: true },
        },
        { signal: request.signal },
      );

      let text = '';
      let reasoning = '';
      let finish: string | null | undefined;
      let usage: OpenAI.CompletionUsage | undefined;
      const calls = new Map<number, { id: string; name: string; args: string }>();

      for await (const chunk of stream) {
        if (chunk.usage) usage = chunk.usage;
        const choice = chunk.choices[0];
        if (!choice) continue;
        finish = choice.finish_reason ?? finish;
        const delta = choice.delta as typeof choice.delta & { reasoning_content?: string; reasoning?: string };
        if (delta.content) {
          text += delta.content;
          yield { type: 'text_delta', text: delta.content };
        }
        // DeepSeek, Ollama, OpenRouter and others stream reasoning under one of these names.
        const thought = delta.reasoning_content ?? delta.reasoning;
        if (thought) {
          reasoning += thought;
          yield { type: 'reasoning_delta', text: thought };
        }
        for (const call of delta.tool_calls ?? []) {
          const entry = calls.get(call.index) ?? { id: '', name: '', args: '' };
          if (call.id) entry.id = call.id;
          if (call.function?.name) entry.name += call.function.name;
          if (call.function?.arguments) entry.args += call.function.arguments;
          calls.set(call.index, entry);
        }
      }

      const parts: Part[] = [];
      if (reasoning) parts.push({ type: 'reasoning', text: reasoning });
      if (text) parts.push({ type: 'text', text });
      for (const [index, call] of [...calls.entries()].sort(([a], [b]) => a - b)) {
        let input: unknown;
        try {
          input = call.args ? JSON.parse(call.args) : {};
        } catch {
          input = call.args; // fails schema validation, and the model is told why
        }
        parts.push({ type: 'tool_call', id: call.id || `call_${index}`, name: call.name, input });
      }
      yield {
        type: 'done',
        parts,
        stopReason: calls.size && finish !== 'length' ? 'tool_calls' : stopReason(finish),
        usage: usage && {
          inputTokens: usage.prompt_tokens,
          outputTokens: usage.completion_tokens,
          cacheReadTokens: usage.prompt_tokens_details?.cached_tokens ?? undefined,
        },
      };
    },
  };
}

/** Presets for common providers. Each reads its key from the usual environment variable. */
export const openai = (o: Partial<OpenAICompatibleOptions> = {}) =>
  openaiCompatible({ id: 'openai', label: 'OpenAI', apiKey: process.env.OPENAI_API_KEY, ...o });

export const deepseek = (o: Partial<OpenAICompatibleOptions> = {}) =>
  openaiCompatible({
    id: 'deepseek',
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY,
    models: ['deepseek-chat', 'deepseek-reasoner'],
    ...o,
  });

export const gemini = (o: Partial<OpenAICompatibleOptions> = {}) =>
  openaiCompatible({
    id: 'gemini',
    label: 'Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    apiKey: process.env.GEMINI_API_KEY,
    ...o,
  });

export const openrouter = (o: Partial<OpenAICompatibleOptions> = {}) =>
  openaiCompatible({
    id: 'openrouter',
    label: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
    ...o,
  });

/** Local models through Ollama. Lists whatever models are pulled. */
export const ollama = (o: Partial<OpenAICompatibleOptions> = {}) =>
  openaiCompatible({
    id: 'ollama',
    label: 'Ollama',
    baseURL: `${process.env.OLLAMA_HOST ?? 'http://localhost:11434'}/v1`,
    ...o,
  });
