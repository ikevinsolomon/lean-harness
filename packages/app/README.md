# @lean-harness/app

A complete [Lean Harness](https://github.com/ikevinsolomon/lean-harness) assistant from one call:
models from `.env`, the HTTP API, the web app, the `<lean-chat>` widget, email-and-password accounts
with invites, memory, a knowledge folder, MCP servers, tracing and a clean shutdown.

```ts
import { startApp } from '@lean-harness/app';

await startApp({
  root: new URL('..', import.meta.url), // reads .env, instructions.md, knowledge/, mcp.json, logo.svg
  name: 'Support Desk',
  tools: [lookupOrder],
  suggestions: [{ title: 'Where is order 1042?', icon: 'search' }],
});
```

Run `node src/index.ts reset-password [email]` to print a password reset link.
The easiest start is `npm create lean-harness@latest my-assistant`.
