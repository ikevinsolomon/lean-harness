import { ApiError, HarnessClient, type Message, type Part, type SessionSummary } from '@lean-harness/widget/client';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { Marked } from 'marked';

export function safeStorage<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined; // private mode or blocked storage
  }
}

/** The API lives on the same origin. The sign-in token, if any, is kept in this browser. */
export const api = new HarnessClient(location.origin, safeStorage(() => localStorage.getItem('lh:token')) ?? import.meta.env.VITE_HARNESS_API_KEY);

export const PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#d97757',
  openai: '#10a37f',
  deepseek: '#4d6bfe',
  gemini: '#4285f4',
  openrouter: '#6467f2',
  ollama: '#71717a',
  mock: '#a1a1aa',
};

// Common languages only, to keep the app small. Others render as plain text.
const LANGUAGES = { bash, css, diff, go, java, javascript, json, markdown, python, rust, sql, typescript, xml, yaml };
for (const [name, language] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, language);
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' });
hljs.registerAliases(['js', 'jsx', 'mjs'], { languageName: 'javascript' });
hljs.registerAliases(['sh', 'shell', 'zsh', 'console'], { languageName: 'bash' });
hljs.registerAliases(['html', 'svg'], { languageName: 'xml' });
hljs.registerAliases(['py'], { languageName: 'python' });
hljs.registerAliases(['yml'], { languageName: 'yaml' });
hljs.registerAliases(['md'], { languageName: 'markdown' });

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const marked = new Marked({
  gfm: true,
  breaks: true,
  async: false,
  renderer: {
    code({ text, lang }) {
      const language = (lang ?? '').trim().split(/\s+/)[0]!.toLowerCase();
      const body = language && hljs.getLanguage(language) ? hljs.highlight(text, { language, ignoreIllegals: true }).value : escape(text);
      return `<pre><code class="language-${escape(language || 'text')} hljs">${body}</code></pre>`;
    },
  },
});

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
    .replace(/<pre><code(?: class="language-([\w+#-]+)[^"]*")?>/g, (_, lang?: string) =>
      `<div class="code"><div class="code-head"><span>${lang ?? 'text'}</span><button type="button" class="code-copy">Copy</button></div><pre><code class="hljs">`,
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

export const isUnauthorized = (e: unknown) => e instanceof ApiError && e.status === 401;

export type { Message, Part, SessionSummary };
