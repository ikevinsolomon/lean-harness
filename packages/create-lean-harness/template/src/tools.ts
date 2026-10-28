import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { defineTool, z } from '@lean-harness/core';

/**
 * The assistant's tools. Each has a name, a description the model reads to decide when to
 * use it, an input schema (checked before `run`), and `run`, which returns what the model
 * sees. Replace these examples with calls to your own APIs and databases.
 */

type Record = { id: string; name: string; status: string; owner: string; updated: string };
const records = async (): Promise<Record[]> => JSON.parse(await readFile(new URL('../data/records.json', import.meta.url), 'utf8'));

export const lookupRecord = defineTool({
  name: 'lookup_record',
  description: 'Find records by id (like R-1001) or by words in their name. Returns at most 5.',
  input: z.object({ query: z.string().min(1).describe('An id or a few words from the name') }),
  async run({ query }) {
    const q = query.toLowerCase();
    const found = (await records()).filter((r) => r.id.toLowerCase() === q || r.name.toLowerCase().includes(q)).slice(0, 5);
    return found.length ? found : `No record matches "${query}".`;
  },
});

// Actions that change something should ask first: the app shows Allow / Deny before it runs.
export const addNote = defineTool({
  name: 'add_note',
  description: 'Add a note to a record. Use when the user asks to log, note or record something.',
  input: z.object({ recordId: z.string(), note: z.string().min(1).max(2000) }),
  needsApproval: true,
  async run({ recordId, note }) {
    if (!(await records()).some((r) => r.id === recordId)) throw new Error(`No record ${recordId}`);
    await mkdir(new URL('../.data/', import.meta.url), { recursive: true });
    await appendFile(new URL('../.data/notes.jsonl', import.meta.url), JSON.stringify({ recordId, note, at: new Date().toISOString() }) + '\n');
    return `Note added to ${recordId}.`;
  },
});

export const tools = [lookupRecord, addNote];
