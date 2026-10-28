#!/usr/bin/env node
// A tiny MCP server, to show how any MCP server plugs into Lean Harness.
// Read-only tools say so (readOnlyHint), so the harness runs them without asking;
// tools that change data ask the user first.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const FILE = process.env.NOTES_FILE ?? new URL('../.data/notes.json', import.meta.url).pathname;

const load = async () => JSON.parse(await readFile(FILE, 'utf8').catch(() => '[]'));
const save = async (notes) => {
  await mkdir(dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(notes, null, 2));
};
const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] });

const server = new McpServer({ name: 'notes', version: '1.0.0' });

server.registerTool(
  'list_notes',
  { description: 'List all notes.', inputSchema: {}, annotations: { readOnlyHint: true } },
  async () => text(await load()),
);

server.registerTool(
  'search_notes',
  { description: 'Find notes containing some text.', inputSchema: { query: z.string() }, annotations: { readOnlyHint: true } },
  async ({ query }) => text((await load()).filter((n) => n.text.toLowerCase().includes(query.toLowerCase()))),
);

server.registerTool(
  'add_note',
  { description: 'Save a new note.', inputSchema: { text: z.string().min(1) } },
  async ({ text: body }) => {
    const notes = await load();
    const note = { id: Math.max(0, ...notes.map((n) => n.id)) + 1, text: body, createdAt: new Date().toISOString() };
    await save([...notes, note]);
    return text(note);
  },
);

server.registerTool(
  'delete_note',
  { description: 'Delete a note by id.', inputSchema: { id: z.number().int() }, annotations: { destructiveHint: true } },
  async ({ id }) => {
    const notes = await load();
    if (!notes.some((n) => n.id === id)) return { ...text(`No note ${id}`), isError: true };
    await save(notes.filter((n) => n.id !== id));
    return text(`Deleted note ${id}.`);
  },
);

await server.connect(new StdioServerTransport());
