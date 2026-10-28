import { HarnessClient, type Message, type Part, type SessionSummary } from '@lean-harness/widget/client';
import DOMPurify from 'dompurify';
import { Marked } from 'marked';

/** The API lives on the same origin (in development Vite forwards /v1 to it). */
export const api = new HarnessClient(location.origin, import.meta.env.VITE_HARNESS_API_KEY);

export function safeStorage<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined; // private mode or blocked storage
  }
}

export const PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#d97757',
  openai: '#10a37f',
  deepseek: '#4d6bfe',
  gemini: '#4285f4',
  openrouter: '#6467f2',
  ollama: '#71717a',
  mock: '#a1a1aa',
};

const marked = new Marked({ gfm: true, breaks: true, async: false });

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

/**
 * Model output is untrusted: render Markdown, sanitize it, then add our own static
 * chrome (a header with a Copy button on code blocks, a scroll frame on tables).
 */
export function renderMarkdown(text: string): string {
  const clean = DOMPurify.sanitize(marked.parse(text) as string, { USE_PROFILES: { html: true } });
  return clean
    .replace(/<pre><code(?: class="language-([\w+#-]+)")?>/g, (_, lang?: string) =>
      `<div class="code"><div class="code-head"><span>${lang ?? 'text'}</span><button type="button" class="code-copy">Copy</button></div><pre><code>`,
    )
    .replace(/<\/code><\/pre>/g, '</code></pre></div>')
    .replace(/<table>/g, '<div class="table"><table>')
    .replace(/<\/table>/g, '</table></div>');
}

export function textOf(parts: Part[], type: 'text' | 'reasoning' = 'text') {
  return parts.map((p) => (p.type === type ? p.text : '')).join('');
}

export function pretty(value: unknown): string {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

/** One line describing a tool call's input: its plain values joined. */
export function summarize(input: unknown): string {
  if (input === null || typeof input !== 'object') return String(input ?? '');
  return Object.values(input)
    .filter((v) => ['string', 'number', 'boolean'].includes(typeof v))
    .join(' · ');
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** Group conversations the way chat apps do: Today, Yesterday, Previous 7 days... */
export function groupByDate(sessions: SessionSummary[]) {
  const day = 86_400_000;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const t = start.getTime();
  const buckets: [string, (time: number) => boolean][] = [
    ['Today', (x) => x >= t],
    ['Yesterday', (x) => x >= t - day],
    ['Previous 7 days', (x) => x >= t - 7 * day],
    ['Previous 30 days', (x) => x >= t - 30 * day],
    ['Older', () => true],
  ];
  const groups = new Map<string, SessionSummary[]>();
  for (const s of sessions) {
    const time = new Date(s.updatedAt).getTime();
    const label = buckets.find(([, test]) => test(time))![0];
    groups.set(label, [...(groups.get(label) ?? []), s]);
  }
  return [...groups.entries()];
}

export function relativeDate(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
export const mod = isMac ? '⌘' : 'Ctrl';

export type { Message, Part, SessionSummary };
