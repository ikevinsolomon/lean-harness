import { startApp } from '@lean-harness/app';
import { tools } from './tools.js';

// {{name}}. What it knows and does lives next to this file:
//   instructions.md   who it is and how it behaves (the system prompt)
//   src/tools.ts      what it can do: your APIs, databases and actions
//   knowledge/        documents it can search: policies, guides, FAQs (Markdown)
//   mcp.json          MCP servers it can use
//   .env              model keys and settings
await startApp({
  root: new URL('..', import.meta.url),
  name: '{{name}}',
  tagline: 'How can I help you today?',
  knowledge: '{{name}}: guides, policies and answers to common questions',
  tools,
  suggestions: [
    { title: 'What can you help with?', detail: 'A quick tour', icon: 'spark' },
    { title: 'Look up record R-1002', detail: 'Uses the example tool', icon: 'search' },
    { title: 'Summarise the getting-started guide', detail: 'From the knowledge folder', icon: 'doc' },
    { title: 'Remember I prefer short answers', detail: 'Saved to memory', icon: 'memory' },
  ],
});
