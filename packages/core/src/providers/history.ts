import type { FilePart, Message, Part, ToolCallPart, ToolResultPart } from '../types.js';

export const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** Files the model reads as text (code, notes, CSV, JSON...), whatever the provider. */
export function isTextFile(file: FilePart) {
  return file.mediaType.startsWith('text/') || ['application/json', 'application/xml', 'application/x-yaml', 'application/yaml'].includes(file.mediaType);
}

/**
 * A user message as text: attached context and text files first, each in a labelled
 * tag, then what the user wrote. Images and PDFs are sent as their own blocks by each provider.
 */
export function userText(parts: Part[]): string {
  const label = (l: string) => l.replace(/["\n<>]/g, ' ');
  const blocks = parts.flatMap((p) => {
    if (p.type === 'context') return [`<context label="${label(p.label)}">\n${p.text}\n</context>`];
    if (p.type === 'file' && isTextFile(p)) return [`<file name="${label(p.name)}">\n${Buffer.from(p.data, 'base64').toString('utf8')}\n</file>`];
    return [];
  });
  const text = parts.flatMap((p) => (p.type === 'text' ? [p.text] : []));
  return [...blocks, text.join('\n')].join('\n\n');
}

/** Attached images and PDFs: the files a provider has to send as their own content blocks. */
export function binaryFiles(parts: Part[]): FilePart[] {
  return parts.filter((p): p is FilePart => p.type === 'file' && !isTextFile(p));
}

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
