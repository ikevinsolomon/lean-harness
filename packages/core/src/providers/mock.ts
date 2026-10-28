import type { ModelRequest, Part, Provider, ProviderEvent } from '../types.js';

export interface MockOptions {
  id?: string;
  /** Delay between streamed chunks, in milliseconds (default 20). */
  delayMs?: number;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (!ms || signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
  });

function reply(request: ModelRequest): Part[] {
  const last = request.messages.at(-1);
  if (last?.role === 'tool') {
    const lines = last.parts.flatMap((p) =>
      p.type === 'tool_result' ? [`- **${p.name}** ${p.isError ? 'failed' : 'returned'}: \`${p.output.slice(0, 300)}\``] : [],
    );
    return [{ type: 'text', text: `Here is what the tools said:\n\n${lines.join('\n')}` }];
  }

  const text = last?.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join(' ').trim() ?? '';
  // "/tool_name {json}" asks the mock model to call a tool, so tools can be tried without a real model.
  const command = /^\/([\w-]+)\s*(\{[\s\S]*\})?\s*$/.exec(text);
  if (command) {
    let input: unknown = {};
    try {
      input = command[2] ? JSON.parse(command[2]) : {};
    } catch {
      return [{ type: 'text', text: 'That tool input is not valid JSON.' }];
    }
    return [
      { type: 'text', text: `Calling \`${command[1]}\`.` },
      { type: 'tool_call', id: `mock_${Date.now().toString(36)}`, name: command[1]!, input },
    ];
  }

  const tools = request.tools.map((t) => `- \`${t.name}\`: ${t.description}`).join('\n') || '- (no tools registered)';
  return [
    {
      type: 'text',
      text:
        `You said: _${text}_\n\n` +
        `I'm the **mock model**, so I only echo. Pick a real model above, or call a tool directly ` +
        `by typing \`/tool_name {"arg": "value"}\`.\n\n**Tools available:**\n${tools}`,
    },
  ];
}

/** A scripted stand-in for a model: echoes text and calls tools on `/tool_name {json}`. */
export function mock(options: MockOptions = {}): Provider {
  const delay = options.delayMs ?? 20;
  return {
    id: options.id ?? 'mock',
    label: 'Mock',
    listModels: async () => ['echo'],
    async *stream(request): AsyncIterable<ProviderEvent> {
      const parts = reply(request);
      for (const part of parts) {
        if (part.type !== 'text') continue;
        for (const chunk of part.text.match(/\S+\s*|\s+/g) ?? []) {
          if (request.signal?.aborted) break;
          await sleep(delay, request.signal);
          yield { type: 'text_delta', text: chunk };
        }
      }
      const calls = parts.some((p) => p.type === 'tool_call');
      yield { type: 'done', parts, stopReason: calls ? 'tool_calls' : 'end', usage: { inputTokens: 0, outputTokens: 0 } };
    },
  };
}
