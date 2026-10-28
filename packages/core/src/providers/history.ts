import type { Message, ToolCallPart, ToolResultPart } from '../types.js';

/**
 * Every provider requires each tool call to be answered by a result. A turn that
 * stopped early (refusal, output limit, abort) can leave a call unanswered, so add
 * an error result for it instead of letting the next request fail.
 */
export function answerOrphanedToolCalls(messages: Message[]): Message[] {
  const out: Message[] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!;
    out.push(message);
    const calls = message.parts.filter((p): p is ToolCallPart => p.type === 'tool_call');
    if (message.role !== 'assistant' || calls.length === 0) continue;

    const next = messages[i + 1];
    const results = next?.role === 'tool' ? next.parts : [];
    const answered = new Set(results.flatMap((p) => (p.type === 'tool_result' ? [p.toolCallId] : [])));
    const missing: ToolResultPart[] = calls
      .filter((c) => !answered.has(c.id))
      .map((c) => ({ type: 'tool_result', toolCallId: c.id, name: c.name, output: 'This tool call was not run.', isError: true }));
    if (missing.length === 0) continue;

    if (next?.role === 'tool') {
      out.push({ ...next, parts: [...next.parts, ...missing] });
      i++;
    } else {
      out.push({ id: `${message.id}-results`, role: 'tool', parts: missing, createdAt: message.createdAt });
    }
  }
  return out;
}
