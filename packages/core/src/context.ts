import type { Message, Part } from './types.js';

/**
 * Context management: long conversations eventually exceed what a model can read.
 * Older turns are replaced, in the request only, by a summary the model wrote; the
 * stored history is never changed.
 */

export interface ContextOptions {
  /** Summarise older turns once a request would exceed this many (estimated) tokens. Default 150,000. */
  maxTokens?: number;
  /** Always send at least this many of the latest messages as they are. Default 12. */
  keepRecent?: number;
}

export interface Summary {
  /** Id of the last message the summary covers. */
  upTo: string;
  text: string;
}

/** Rough token count (about four characters per token), good enough to decide when to summarise. */
export function estimateTokens(messages: Message[], system = ''): number {
  let chars = system.length;
  for (const m of messages) chars += JSON.stringify(m.parts).length;
  return Math.ceil(chars / 4);
}

/** The index where the kept part starts: a user message, so tool calls are never split from their results. */
export function cutPoint(messages: Message[], keepRecent: number): number {
  for (let i = Math.max(1, messages.length - keepRecent); i > 0; i--) {
    if (messages[i]!.role === 'user') return i;
  }
  return 0;
}

function partText(part: Part): string {
  switch (part.type) {
    case 'text':
      return part.text;
    case 'context':
      return `[${part.label}] ${part.text}`;
    case 'tool_call':
      return `[called ${part.name} ${JSON.stringify(part.input).slice(0, 500)}]`;
    case 'tool_result':
      return `[${part.name} ${part.isError ? 'failed' : 'returned'}: ${part.output.slice(0, 1500)}]`;
    case 'file':
      return `[attached ${part.name}]`;
    default:
      return '';
  }
}

/** A plain-text transcript for the summariser. */
export function transcript(messages: Message[]): string {
  return messages
    .map((m) => `${m.role.toUpperCase()}: ${m.parts.map(partText).filter(Boolean).join('\n')}`)
    .join('\n\n');
}

export const SUMMARY_PROMPT = [
  'Summarise the conversation below so it can replace it as context for continuing the conversation.',
  "Keep every fact, decision, number, name, file, preference and open question that later turns may need, and the user's goals.",
  'Write compact notes, not prose. Do not add anything that is not in the conversation.',
].join(' ');

/** The message that stands in for the summarised turns. */
export function summaryMessage(summary: Summary): Message {
  return {
    id: `summary-${summary.upTo}`,
    role: 'user',
    createdAt: new Date(0).toISOString(),
    parts: [{ type: 'context', label: 'Summary of the earlier conversation', text: summary.text }],
  };
}
