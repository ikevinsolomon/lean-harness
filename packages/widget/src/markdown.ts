import DOMPurify from 'dompurify';
import { Marked } from 'marked';

const marked = new Marked({ gfm: true, breaks: true, async: false });

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

/** Model output is untrusted: render Markdown, then sanitize the HTML. Tables get a scrolling frame. */
export function renderMarkdown(text: string): string {
  const html = (marked.parse(text) as string).replace(/<table>/g, '<div class="table"><table>').replace(/<\/table>/g, '</table></div>');
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}
