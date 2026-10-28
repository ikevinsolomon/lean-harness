<p align="center"><img src="assets/logo.svg" width="96" height="96" alt="lean-harness logo: a double cup"></p>

<h1 align="center">lean-harness</h1>

**A small, readable agent harness for TypeScript.** Any model, your tools, an HTTP API, and a chat UI you can drop into any page.

- **Any model, switchable on the fly.** Claude, OpenAI, DeepSeek, Gemini, OpenRouter, Ollama, or anything that speaks the OpenAI API. Change the model per session or per message, even mid-conversation.
- **Everything is a plugin.** A domain (support desk, analytics, travel, ...) is a plugin: instructions, tools and hooks. Model providers are plugins too.
- **API-first.** A plain HTTP + Server-Sent Events API, so you can build any UI on top: web, mobile, Slack, CLI.
- **A UI you can embed anywhere.** `<lean-chat>` is a web component: a full-screen chat app like Claude or ChatGPT, a box in your page, or a floating button. Two lines of HTML, any framework, light and dark, themeable.
- **Production pieces included.** Users and sign-in, SQLite or Postgres storage, replies that keep running when the tab closes, MCP servers, tool approvals, attachments, long-conversation summaries, token budgets, tracing, and a Docker setup.
- **Small enough to read in an afternoon.** No framework to learn; every part is a short file you can replace.

```
┌──────────── your UI ─────────────┐     ┌──────────────── lean-harness ────────────────┐
│ <lean-chat>, React, mobile, CLI  │ ──▶ │ HTTP + SSE API  →  Harness (agent loop)       │
└──────────────────────────────────┘     │                     ├─ plugins: tools, hooks  │
                                         │                     ├─ providers: any model   │
                                         │                     └─ session store          │
                                         └───────────────────────────────────────────────┘
```

## Quickstart

Requires Node 22+ and pnpm.

```bash
pnpm install
pnpm dev
```

Open http://localhost:8787 for the web app: a full chat interface with a chat history sidebar, a link per chat, search (⌘K), rename and delete, copy, retry and edit, a model menu, light and dark themes, and a phone layout. http://localhost:8787/embed shows the embeddable widget on a page. Without any API key you get the offline **Mock** model, which echoes and can call tools with `/tool_name {"arg": "value"}`. To use real models, copy `examples/quickstart/.env.example` to `examples/quickstart/.env` and add a key, for example `ANTHROPIC_API_KEY`. Every provider with a key appears in the model menu.

## Build an agent in one file

```ts
import { anthropic, createHarness, definePlugin, defineTool, ollama, openai, z } from '@lean-harness/core';
import { createServer, serve } from '@lean-harness/server';

const weather = definePlugin({
  name: 'weather',
  instructions: 'You answer questions about the weather. Always use the forecast tool.',
  tools: [
    defineTool({
      name: 'forecast',
      description: 'Get the forecast for a city.',
      input: z.object({ city: z.string() }),
      run: async ({ city }) => ({ city, tempC: 21, sky: 'clear' }),
    }),
  ],
});

const harness = createHarness({
  providers: [anthropic(), openai(), ollama()],
  plugins: [weather],
  defaultModel: 'anthropic/claude-opus-5-5',
});

serve(createServer(harness)); // http://localhost:8787/v1
```

Or use the harness directly, without HTTP:

```ts
const session = await harness.createSession();
for await (const event of harness.run(session.id, 'Will it rain in Pune?')) {
  if (event.type === 'text_delta') process.stdout.write(event.text);
}
// One-shot, on another model:
const { text } = await harness.send(session.id, 'And tomorrow?', { model: 'ollama/llama3.2' });
```

## The web app

`apps/web` is a React app on the same HTTP API. Routes are `/` (new chat) and `/c/:id` (a chat), so links, reload and back/forward work. For development with hot reload, run the server and the app side by side:

```bash
pnpm --filter quickstart dev        # API on :8787
pnpm --filter @lean-harness/web dev # app on :5173, forwarding /v1 to :8787
```

`pnpm --filter @lean-harness/web build` writes `apps/web/dist`, which the quickstart server serves at `/`. To deploy it elsewhere, serve `dist` as static files with `index.html` for unknown paths, next to your API.

## Embed the chat

```html
<script type="module" src="https://your-server/lean-chat.js"></script>
<lean-chat endpoint="https://your-server" heading="Weather desk"></lean-chat>
```

| Attribute | Default | |
|---|---|---|
| `endpoint` | same origin | Base URL of a lean-harness server |
| `token` | | Sent as `Authorization: Bearer …` |
| `model` | server default | Starting `provider/model` |
| `heading`, `subtitle`, `greeting`, `placeholder`, `disclaimer` | | Text |
| `icon` | first letter of `heading` | Image URL for the header mark |
| `suggestions` | | Starter cards: `Title: detail \| Title: detail` |
| `page-context` | off | Attach the current page (title and URL) to every message |
| `mode` | `inline` | `page` is a full-screen app with a conversation sidebar and a light/dark switch, which becomes a phone layout below 768px; `inline` fills its container; `floating` is a launcher button in the corner |
| `theme` | `auto` | `auto`, `light` or `dark` |
| `hide-model-picker`, `hide-reasoning` | | Booleans |

Send your app's context with every message through the `context` property; each entry shows as a chip the user can remove:

```js
document.querySelector('lean-chat').context = { Order: 'A-4411, shipped 2 Nov', Customer: { plan: 'Pro' } };
```

Theme it with CSS variables: `lean-chat { --lc-accent: #0f766e; --lc-radius: 14px; --lc-font: Inter, sans-serif; }` (also `--lc-bg`, `--lc-panel`, `--lc-ink`, `--lc-muted`, `--lc-border`, `--lc-bubble`). It looks best with Inter and JetBrains Mono loaded on the page and falls back to system fonts. It emits `lean-chat-event` for every streamed event and `lean-chat-error` on errors. `HarnessClient` is exported from the same file if you want the API client without the UI.

## MCP servers

Any [MCP](https://modelcontextprotocol.io) server's tools become harness tools, local (a command) or remote (a URL):

```ts
import { mcpPlugin } from '@lean-harness/core';

const mcp = await mcpPlugin({
  servers: {
    notes: { command: 'node', args: ['notes-server.mjs'] },
    docs: { url: 'https://example.com/mcp', headers: { Authorization: `Bearer ${process.env.DOCS_TOKEN}` } },
  },
});
const harness = createHarness({ providers, plugins: [mcp], defaultModel });
// on shutdown: await mcp.close();
```

Tools are named `server__tool` (shown as "server › tool"). A server that can't be reached is skipped with a warning; the others still load. Local servers get a minimal environment plus the `env` you give them, not every secret in yours. The quickstart reads servers from `examples/quickstart/mcp.json`, in the same format as Claude Desktop, and includes a small example server (`mcp/notes-server.mjs`).

## Tool approvals

A tool can ask before it runs. The turn pauses, emits `approval_request`, and continues when someone decides; the model is told if the user declined.

```ts
defineTool({
  name: 'transfer',
  input: z.object({ amount: z.number() }),
  needsApproval: ({ amount }) => amount > 100, // or true
  run: ...
});
```

MCP tools ask by default unless the server marks them read-only (`approval: 'unless-read-only'`; also `'always'`, `'never'`, or a function). The web app and the widget show **Allow**, **Always allow in this chat** and **Deny**. Over the API: `POST /v1/sessions/:id/approvals/:callId` with `{ "approved": true, "always": false }`, or `harness.decide(...)` in code. A call nobody answers is declined after `approvalTimeoutMs` (10 minutes by default).

## Memory and context

| | What | How |
|---|---|---|
| Conversation history | Every message in a session, sent back each turn | Built in (`SessionStore`) |
| Long-term memory | Facts and preferences that outlast a conversation, per user | `memoryPlugin({ backend: new FileMemory('memory.json') })`: tools `remember`, `forget`, `recall`; memories are added to the instructions. Users are told apart by `metadata.userId` on the session. |
| History window | Send only the last N messages to small-context models | `historyWindow({ maxMessages: 40 })` |
| Per-message context | What the user is looking at: page, record, role | `context` in the API or `harness.run(id, text, { context })`; the model sees labelled `<context>` blocks |
| Knowledge base | Documents the model can search | `knowledgePlugin({ dir: './docs' })`: tool `search_knowledge`, keyword search by default, or pass `search` for a vector store |
| Dynamic instructions | Anything computed per request | A plugin's `instructions` function, or the `beforeModel` hook |

`MemoryBackend` has four methods (`list`, `add`, `remove`, optional `search`), so a database or vector-store backend is a small class.

## Concepts

**Harness.** Owns the agent loop: add the user's message, call the model, run the tools it asks for (in parallel, with inputs validated against their schemas), feed results back, repeat until it answers or hits `maxSteps`.

**Plugin.** `{ name, instructions?, tools?, providers?, hooks? }`. Instructions are added to the system prompt (a function can make them dynamic). Hooks:

| Hook | Use it to |
|---|---|
| `beforeModel(request, ctx)` | Add context, trim history, change tools |
| `beforeToolCall(call, ctx)` | Approve or deny (`return { deny: 'reason' }`) |
| `onEvent(event, ctx)` | Log, meter, audit |

**Tool.** `defineTool({ name, description, input: zodSchema, run })`. The model sees the JSON Schema; `run` receives typed, validated input. Return any value (objects become JSON). Throwing reports the error to the model so it can recover.

**Provider.** `{ id, listModels(), stream(request) }`. Built in: `anthropic()` (official SDK; adaptive thinking, prompt caching, refusal fallback), `openaiCompatible()` with presets `openai()`, `deepseek()`, `gemini()`, `openrouter()`, `ollama()`, and `mock()` for tests and demos. Models are addressed as `provider/model`.

**Session store.** `MemoryStore` (default) or `FileStore(dir)`. Implement `SessionStore` (six methods) for Postgres, Redis, etc. History is append-only.

## HTTP API

All routes are under `/v1`. With `authenticate`, every route needs a signed-in user and only shows that user's sessions.

| Method | Path | |
|---|---|---|
| `GET` | `/health` | Liveness (no auth) |
| `GET` | `/me` | `{ user }`, or `{ user: null }` without sign-in |
| `GET` | `/models` | `{ defaultModel, models: [{ id, provider, model, label }] }` |
| `GET` | `/tools` | Tools and their JSON Schemas |
| `GET` | `/sessions` | Session summaries, newest first |
| `POST` | `/sessions` | `{ model?, title?, metadata? }` → session |
| `GET` | `/sessions/:id` | Session with all messages |
| `PATCH` | `/sessions/:id` | `{ model?, title?, metadata? }`; switch the model here |
| `DELETE` | `/sessions/:id` | |
| `POST` | `/sessions/:id/stop` | Stop the running reply |
| `GET` | `/sessions/:id/stream` | Reconnect to the running reply (`?from=N` skips events already seen) |
| `GET` | `/search?q=` | Find messages in your sessions |
| `GET`, `DELETE` | `/memories`, `/memories/:id` | What the assistant remembers about you (when `memory` is passed to `createServer`) |
| `POST` | `/sessions/:id/approvals/:callId` | `{ approved, always? }`: allow or decline a tool call that is waiting |
| `POST` | `/sessions/:id/messages` | `{ content, model?, context?, files?, replaceFrom?, stream? }` → event stream, or JSON when `stream: false`. `replaceFrom` is a user message id: it and everything after it are replaced (retry, edit) |

A turn streams as Server-Sent Events, one per event:

| Event | Data |
|---|---|
| `turn_start` | `{ sessionId, model }` |
| `text_delta` / `reasoning_delta` | `{ text }` |
| `tool_call` | `{ id, name, input }` |
| `approval_request` | `{ id, name, input }`: the turn waits for a decision |
| `tool_result` | `{ id, name, output, isError }` |
| `message` | `{ message }`: each stored message (user, assistant, tool results) |
| `error` | `{ message }` |
| `turn_end` | `{ stopReason, usage, steps }`; `stopReason` is `end`, `max_steps`, `max_tokens`, `budget`, `refusal`, `aborted` or `error` |

```bash
curl -s -X POST localhost:8787/v1/sessions -H 'content-type: application/json' -d '{}'
curl -N -X POST localhost:8787/v1/sessions/<id>/messages -H 'content-type: application/json' \
  -d '{"content": "What is on my list?", "model": "deepseek/deepseek-chat"}'
```

## Users and sign-in

Sign-in is off by default (single-user). Turn it on with `authenticate` in `createServer`; every session then belongs to its creator, people only see their own chats, and memory follows the user.

```ts
import { createServer, jwtAuth, tokenAuth } from '@lean-harness/server';

createServer(harness, { authenticate: tokenAuth({ 'long-random-token': { id: 'asha', name: 'Asha' } }) });
createServer(harness, { authenticate: jwtAuth({ secret: process.env.SUPABASE_JWT_SECRET!, audience: 'authenticated' }) });
createServer(harness, { authenticate: async (req) => (await mySession(req)) ?? null }); // any sign-in system
```

In the quickstart, set `HARNESS_USERS=asha:token1,ben:token2` in `.env`: the web app then shows a sign-in screen that takes an access token.

## Storage

| Store | Use |
|---|---|
| `MemoryStore` | Tests and demos (the default) |
| `FileStore(dir)` | One JSON file per chat |
| `await SqliteStore.open('chats.db')` | One server; uses Node's built-in SQLite |
| `new PostgresStore(pool)` | Many servers; any client with `query()`: `pg`, Neon, Supabase, PGlite |

The quickstart uses SQLite, or Postgres when `DATABASE_URL` is set. Implement `SessionStore` (seven methods) for anything else.

## Long conversations, budgets and timeouts

```ts
createHarness({
  ...,
  context: { maxTokens: 150_000, keepRecent: 12 },     // the default; false turns it off
  budget: { turnTokens: 200_000, sessionTokens: 2_000_000 },
  toolTimeoutMs: 120_000,
});
```

When a conversation would exceed `maxTokens`, older turns are summarised by the model and the summary replaces them in the request; storage is untouched. Budgets stop a reply (`stopReason: "budget"`) or refuse new ones once spent. Each session keeps its running token usage in `metadata.usage`.

## Replies in the background

Replies run on the server, not in the HTTP request: closing the tab does not stop them. `POST /sessions/:id/stop` stops one; `GET /sessions/:id/stream` reconnects (and replays the turn so far). In code: `harness.start`, `harness.watch`, `harness.stop`.

## Attachments

Messages can carry images (PNG, JPEG, GIF, WebP), PDFs and text files: `files: [{ name, mediaType, data }]` (base64) on the API, or the paperclip, drag and drop, and paste in the web app. Claude reads images and PDFs natively; OpenAI-style providers get image URLs and file parts; text files reach every model as text.

## Built-in tools

```ts
import { subagentTool, webFetchPlugin } from '@lean-harness/core';

webFetchPlugin();          // fetch_url: reads public pages; private and local addresses are refused
subagentTool({ name: 'researcher', description: 'Looks things up', providers, defaultModel: 'anthropic/claude-haiku-5-5' });
await harness.extract(z.object({ city: z.string() }), 'I live in Pune'); // structured output: { city: 'Pune' }
```

## Tracing

`tracing()` records one trace per reply: each model call (time, tokens), each tool call (time, success), and an estimated cost when you give it prices. By default it prints one line per reply; pass `onTrace` to send traces to your own logs or monitoring.

## Deploy

```bash
docker compose up --build           # the app on :8787 with Postgres; reads examples/quickstart/.env
docker build -t lean-harness .      # or just the image
```

For production: set `HARNESS_USERS` (or your own `authenticate`), `CORS_ORIGIN`, `RATE_LIMIT_PER_MINUTE`, and `DATABASE_URL`; put it behind HTTPS.

## Project layout

```
packages/core     the harness: loop, plugins, tools, providers, stores  (@lean-harness/core)
packages/server   HTTP + SSE API on Hono                                 (@lean-harness/server)
packages/widget   <lean-chat> web component on Lit, plus the browser API client (@lean-harness/widget)
apps/web          the web app: React, Vite, React Router
examples/         quickstart: a general assistant (clock tool, memory, a searchable guide) + demo pages
```

## Development

```bash
pnpm test        # vitest
pnpm typecheck
pnpm build       # dist/ for every package
```

## Security notes

- Tool inputs are validated, but a tool is your code: check permissions inside it, and use `beforeToolCall` for approval gates.
- Model output is untrusted. The widget renders Markdown through DOMPurify.
- A token in `<lean-chat token>` is visible to the page's users. For public sites, use `authenticate` with your own sign-in, or a backend that adds credentials.
- `fetch_url` refuses private and local addresses, but DNS can change between the check and the request; run the server where the network itself blocks internal services if that matters to you.
- Attachments and chats are stored as you send them. Treat the database as sensitive.

## License

MIT
