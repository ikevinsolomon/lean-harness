import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { z } from 'zod';
import { definePlugin } from '../plugin.js';
import { defineTool } from '../tool.js';

/**
 * Lets the model read web pages. Addresses that resolve to private, loopback or
 * link-local networks (your intranet, cloud metadata services) are refused, so a
 * prompt cannot turn the model into a way into your network.
 */

export interface WebFetchOptions {
  /** Most characters of page text returned to the model (default 20,000). */
  maxChars?: number;
  /** Most bytes downloaded (default 2 MB). */
  maxBytes?: number;
  /** Allow private and local addresses (only for trusted, local development). */
  allowPrivate?: boolean;
  /** Ask the user before each fetch (default false: reading is allowed). */
  needsApproval?: boolean;
}

/** True for addresses that must not be reachable from a model-controlled fetch. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6 === '::' || v6 === '::1') return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return isPrivateAddress(mapped[1]!);
  return /^(fc|fd|fe8|fe9|fea|feb)/.test(v6);
}

async function assertPublic(url: URL) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http and https addresses can be fetched');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error(`${url.hostname} is a private or local address, which cannot be fetched`);
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Readable text from HTML: no scripts, styles or tags; block elements become line breaks. */
export function htmlToText(html: string): { title?: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  const text = html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br|header|footer)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (m, e: string) =>
      e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m),
    )
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
  return { title, text };
}

export function webFetchPlugin(options: WebFetchOptions = {}) {
  const maxChars = options.maxChars ?? 20_000;
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;

  return definePlugin({
    name: 'web-fetch',
    instructions: 'You can read web pages with `fetch_url`. Cite the page address when you use what you read.',
    tools: [
      defineTool({
        name: 'fetch_url',
        description: 'Fetch a public web page and return its readable text.',
        input: z.object({ url: z.string().url().describe('The full address, starting with https://') }),
        needsApproval: options.needsApproval ?? false,
        async run({ url }, { signal }) {
          let target = new URL(url);
          let response: Response | undefined;
          // Follow redirects ourselves, so every hop is checked, not just the first.
          for (let hop = 0; hop < 5; hop++) {
            if (!options.allowPrivate) await assertPublic(target);
            response = await fetch(target, {
              redirect: 'manual',
              signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
              headers: { 'User-Agent': 'lean-harness (+https://github.com/ikevinsolomon/lean-harness)', Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5' },
            });
            const next = response.headers.get('location');
            if (response.status >= 300 && response.status < 400 && next) {
              target = new URL(next, target);
              continue;
            }
            break;
          }
          if (!response) throw new Error('No response');
          if (!response.ok) throw new Error(`${target} answered ${response.status} ${response.statusText}`);

          // Read at most maxBytes.
          const reader = response.body?.getReader();
          const chunks: Uint8Array[] = [];
          let size = 0;
          while (reader) {
            const { value, done } = await reader.read();
            if (done) break;
            chunks.push(value);
            size += value.length;
            if (size >= maxBytes) {
              await reader.cancel();
              break;
            }
          }
          const body = new TextDecoder().decode(Buffer.concat(chunks));
          const type = response.headers.get('content-type') ?? '';
          const page = type.includes('html') ? htmlToText(body) : { text: body };
          const truncated = page.text.length > maxChars;
          return {
            url: target.toString(),
            ...(page.title ? { title: page.title } : {}),
            text: page.text.slice(0, maxChars),
            ...(truncated ? { truncated: true } : {}),
          };
        },
      }),
    ],
  });
}
