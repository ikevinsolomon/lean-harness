import DOMPurify from 'dompurify';
import { Marked } from 'marked';

const marked = new Marked({ gfm: true, breaks: true, async: false });

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

/** Model output is untrusted: render Markdown, then sanitize the HTML. */
export function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text) as string, { USE_PROFILES: { html: true } });
}
