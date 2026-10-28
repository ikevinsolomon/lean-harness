import { describe, expect, it } from 'vitest';
import { greeting, groupByDate, renderMarkdown, summarize, type SessionSummary } from '../src/lib';

describe('renderMarkdown', () => {
  it('renders Markdown and removes anything that could run script', () => {
    const html = renderMarkdown('**Hi** <img src=x onerror="alert(1)"><script>alert(2)</script> [x](javascript:alert(3))');
    expect(html).toContain('<strong>Hi</strong>');
    expect(html).not.toMatch(/onerror|<script|javascript:/);
  });

  it('wraps code blocks with a language label and a Copy button', () => {
    const html = renderMarkdown('```ts\nconst a = 1;\n```');
    expect(html).toContain('<span>ts</span>');
    expect(html).toContain('class="code-copy"');
  });

  it('opens links in a new tab without access to this page', () => {
    expect(renderMarkdown('[docs](https://example.com)')).toMatch(/target="_blank".*rel="noopener noreferrer"|rel="noopener noreferrer".*target="_blank"/);
  });
});

describe('helpers', () => {
  it('groups chats by how recent they are', () => {
    const at = (daysAgo: number) => ({ id: String(daysAgo), updatedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString() }) as SessionSummary;
    const groups = groupByDate([at(0), at(1), at(3), at(20), at(90)]);
    expect(groups.map(([label]) => label)).toEqual(['Today', 'Yesterday', 'Previous 7 days', 'Previous 30 days', 'Older']);
  });

  it('greets by time of day and summarizes tool input', () => {
    expect(greeting(new Date(2026, 0, 1, 9))).toBe('Good morning');
    expect(greeting(new Date(2026, 0, 1, 21))).toBe('Good evening');
    expect(summarize({ city: 'Tokyo', days: 3, nested: { a: 1 } })).toBe('Tokyo · 3');
  });
});
