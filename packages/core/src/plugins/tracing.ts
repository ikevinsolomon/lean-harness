import { definePlugin } from '../plugin.js';
import type { StopReason, Usage } from '../types.js';

/**
 * Observability: one trace per reply, with every model call (time, tokens) and every
 * tool call (time, success). Log it, store it, or send it to your monitoring.
 */

/** Prices in US dollars per million tokens. */
export interface Price {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export type TraceStep =
  | { type: 'model'; model: string; durationMs: number; usage?: Usage }
  | { type: 'tool'; name: string; durationMs: number; ok: boolean };

export interface TurnTrace {
  sessionId: string;
  model: string;
  startedAt: string;
  durationMs: number;
  stopReason: StopReason;
  steps: TraceStep[];
  usage: Usage;
  /** Estimated cost, when prices for the model are known. */
  costUsd?: number;
}

export interface TracingOptions {
  /** Where traces go. Default: one line per reply on the console. */
  onTrace?: (trace: TurnTrace) => void | Promise<void>;
  /** Prices by `provider/model`, for cost estimates. */
  prices?: Record<string, Price>;
}

export function costOf(usage: Usage, price: Price): number {
  const m = 1_000_000;
  return (
    ((usage.inputTokens ?? 0) * price.input +
      (usage.outputTokens ?? 0) * price.output +
      (usage.cacheReadTokens ?? 0) * (price.cacheRead ?? price.input) +
      (usage.cacheWriteTokens ?? 0) * (price.cacheWrite ?? price.input)) /
    m
  );
}

const line = (t: TurnTrace) => {
  const tokens = (t.usage.inputTokens ?? 0) + (t.usage.outputTokens ?? 0) + (t.usage.cacheReadTokens ?? 0) + (t.usage.cacheWriteTokens ?? 0);
  const tools = t.steps.filter((s) => s.type === 'tool').length;
  const cost = t.costUsd !== undefined ? ` $${t.costUsd.toFixed(4)}` : '';
  console.log(`reply ${t.sessionId.slice(0, 8)} ${t.model} ${t.stopReason} ${t.durationMs}ms ${tokens} tokens ${tools} tools${cost}`);
};

export function tracing(options: TracingOptions = {}) {
  const onTrace = options.onTrace ?? line;
  const open = new Map<string, { trace: TurnTrace; started: number; modelStart: number; tools: Map<string, { name: string; at: number }> }>();

  return definePlugin({
    name: 'tracing',
    hooks: {
      async onEvent(event, { session, model }) {
        const now = Date.now();
        if (event.type === 'turn_start') {
          open.set(session.id, {
            trace: { sessionId: session.id, model, startedAt: new Date(now).toISOString(), durationMs: 0, stopReason: 'end', steps: [], usage: {} },
            started: now,
            modelStart: now,
            tools: new Map(),
          });
          return;
        }
        const state = open.get(session.id);
        if (!state) return;
        if (event.type === 'message' && event.message.role === 'assistant') {
          state.trace.steps.push({ type: 'model', model: event.message.model ?? model, durationMs: now - state.modelStart, usage: event.message.usage });
        } else if (event.type === 'message' && event.message.role === 'tool') {
          state.modelStart = now; // the next model call starts once the results are in
        } else if (event.type === 'tool_call') {
          state.tools.set(event.id, { name: event.name, at: now });
        } else if (event.type === 'tool_result') {
          const tool = state.tools.get(event.id);
          if (tool) state.trace.steps.push({ type: 'tool', name: tool.name, durationMs: now - tool.at, ok: !event.isError });
        } else if (event.type === 'turn_end') {
          open.delete(session.id);
          const price = options.prices?.[state.trace.model];
          await onTrace({
            ...state.trace,
            durationMs: now - state.started,
            stopReason: event.stopReason,
            usage: event.usage,
            ...(price ? { costUsd: costOf(event.usage, price) } : {}),
          });
        }
      },
    },
  });
}
