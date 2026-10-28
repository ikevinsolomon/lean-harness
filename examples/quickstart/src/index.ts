import { FileMemory, SqlMemory } from '@lean-harness/core';
import { startApp } from '@lean-harness/app';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { clockPlugin } from './clock-plugin.js';

const root = new URL('..', import.meta.url);

// A general assistant: everything else (models from .env, accounts, the web app, memory,
// the knowledge folder, mcp.json) comes from startApp. Start your own with `pnpm new-agent`.
await startApp({
  root,
  name: 'Lean Harness',
  knowledge: 'Lean Harness: models, tools, plugins, memory, context and the chat UI',
  plugins: [clockPlugin],
  suggestions: [
    { title: 'What can you do?', detail: 'Tools, memory and models', icon: 'spark' },
    { title: 'How do I add a tool?', detail: 'From the built-in guide', icon: 'tool' },
    { title: 'What time is it in Tokyo?', detail: 'Uses the clock tool', icon: 'clock' },
    { title: 'Remember I like short answers', detail: 'Saved to long-term memory', icon: 'memory' },
  ],
  // The widget demos: the <lean-chat> element full screen, and floating on a page.
  configure(app) {
    app.get('/widget', async (c) => c.html(await readFile(new URL('public/widget.html', root), 'utf8')));
    app.get('/embed', async (c) => c.html(await readFile(new URL('public/embed.html', root), 'utf8')));
  },
  // Earlier versions kept memories in a JSON file: they become the admin's.
  async onSetup(admin, db) {
    const memory = new SqlMemory(db);
    for (const m of await new FileMemory(fileURLToPath(new URL('.data/memory.json', root))).list('default')) await memory.add(admin.id, m.text);
  },
});
