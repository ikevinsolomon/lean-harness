import type { ModelRequest, Part, Provider, ProviderEvent, StopReason } from '../src/index.js';

export type Step = Part[] | ((request: ModelRequest) => Part[]);

/** A provider that replays fixed responses, one per model call, and records every request. */
export function scripted(steps: Step[], id = 'test') {
  const requests: ModelRequest[] = [];
  const provider: Provider = {
    id,
    listModels: async () => ['model-a', 'model-b'],
    async *stream(request): AsyncIterable<ProviderEvent> {
      requests.push(structuredClone({ ...request, signal: undefined }));
      const step = steps.shift();
      if (!step) throw new Error('No scripted response left');
      const parts = typeof step === 'function' ? step(request) : step;
      for (const part of parts) if (part.type === 'text') yield { type: 'text_delta', text: part.text };
      const stopReason: StopReason = parts.some((p) => p.type === 'tool_call') ? 'tool_calls' : 'end';
      yield { type: 'done', parts, stopReason, usage: { inputTokens: 10, outputTokens: 5 } };
    },
  };
  return { provider, requests };
}

export const text = (t: string): Part => ({ type: 'text', text: t });
export const call = (name: string, input: unknown, id = `call_${name}`): Part => ({ type: 'tool_call', id, name, input });
