import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { z } from 'zod';
import { definePlugin } from '../plugin.js';
import { defineTool } from '../tool.js';
import { keywordSearch } from './memory.js';

/**
 * A knowledge base the model can search: your docs, policies, product notes.
 * Documents are split into sections and found by keywords. For large or fuzzy
 * collections, pass your own `search` (a vector database, a search API).
 */

export interface KnowledgeChunk {
  source: string;
  heading: string;
  text: string;
}

export interface KnowledgeOptions {
  /** A folder of .md and .txt files, read once on first use. */
  dir?: string;
  /** Or documents given directly: `{ source, text }`. */
  documents?: { source: string; text: string }[];
  /** Replace the keyword search, for example with a vector store. */
  search?: (query: string, limit: number) => Promise<KnowledgeChunk[]>;
  /** What the knowledge base covers, so the model knows when to search it. */
  description?: string;
  /** Sections returned per search (default 5). */
  limit?: number;
}

/** Split a document at Markdown headings, then into pieces of at most ~1,500 characters. */
export function chunkDocument(source: string, text: string): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];
  let heading = source;
  let buffer: string[] = [];
  const flush = () => {
    const body = buffer.join('\n').trim();
    for (let i = 0; i < body.length; i += 1500) chunks.push({ source, heading, text: body.slice(i, i + 1500) });
    buffer = [];
  };
  for (const line of text.split('\n')) {
    const match = /^#{1,6}\s+(.*)/.exec(line);
    if (match) {
      flush();
      heading = match[1]!.trim();
    } else buffer.push(line);
  }
  flush();
  return chunks;
}

async function readFolder(dir: string): Promise<{ source: string; text: string }[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files = entries.filter((e) => e.isFile() && ['.md', '.txt', '.markdown'].includes(extname(e.name)));
  return Promise.all(
    files.map(async (e) => {
      const path = join(e.parentPath, e.name);
      return { source: relative(dir, path), text: await readFile(path, 'utf8') };
    }),
  );
}

export function knowledgePlugin(options: KnowledgeOptions) {
  const limit = options.limit ?? 5;
  let chunks: Promise<KnowledgeChunk[]> | undefined;
  const load = () =>
    (chunks ??= (async () => {
      const docs = [...(options.documents ?? []), ...(options.dir ? await readFolder(options.dir) : [])];
      return docs.flatMap((d) => chunkDocument(d.source, d.text));
    })());

  return definePlugin({
    name: 'knowledge',
    instructions: [
      `You can search a knowledge base${options.description ? ` about ${options.description}` : ''} with \`search_knowledge\`.`,
      'Search it before answering questions it may cover, answer from what you find, and name the source.',
      'If it has nothing relevant, say so rather than guessing.',
    ].join(' '),
    tools: [
      defineTool({
        name: 'search_knowledge',
        description: `Search the knowledge base${options.description ? ` (${options.description})` : ''}. Returns the most relevant sections with their source.`,
        input: z.object({ query: z.string().min(2).describe('Keywords or a question') }),
        async run({ query }) {
          const found = options.search
            ? await options.search(query, limit)
            : keywordSearch(await load(), query, (c) => `${c.heading} ${c.text}`, limit);
          return found.length ? found : 'Nothing relevant found.';
        },
      }),
    ],
  });
}
