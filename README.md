<p align="center"><img src="assets/logo.svg" width="96" height="96" alt="lean-harness logo: a double cup"></p>

<h1 align="center">lean-harness</h1>

**A small, readable agent harness for TypeScript.** Any model, your tools, an HTTP API, and a chat UI you can drop into any page.

- **Any model, switchable on the fly.** Claude, OpenAI, DeepSeek, Gemini, OpenRouter, Ollama, or anything that speaks the OpenAI API. Change the model per session or per message, even mid-conversation.
- **Everything is a plugin.** A domain (support desk, analytics, travel, ...) is a plugin: instructions, tools and hooks. Model providers are plugins too.
- **API-first.** A plain HTTP + Server-Sent Events API, so you can build any UI on top: web, mobile, Slack, CLI.
- **A UI you can embed anywhere.** `<lean-chat>` is a web component: a full-screen chat app like Claude or ChatGPT, a box in your page, or a floating button. Two lines of HTML, any framework, light and dark, themeable.
- **Small enough to read in an afternoon.** The core is about 1,500 lines with comments, built-in plugins included. No framework to learn.

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

Open http://localhost:8787 for the full-screen chat app (http://localhost:8787/embed shows the same assistant embedded in a page). Without any API key you get the offline **Mock** model, which echoes and can call tools with `/tool_name {"arg": "value"}`. To use real models, copy `examples/quickstart/.env.example` to `examples/quickstart/.env` and add a key, for example `ANTHROPIC_API_KEY`. Every provider with a key appears in the model menu.

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

All routes are under `/v1`. Set `apiKey` (or an `authorize` function) in `createServer` to require auth.

| Method | Path | |
|---|---|---|
| `GET` | `/health` | Liveness (no auth) |
| `GET` | `/models` | `{ defaultModel, models: [{ id, provider, model, label }] }` |
| `GET` | `/tools` | Tools and their JSON Schemas |
| `GET` | `/sessions` | Session summaries, newest first |
| `POST` | `/sessions` | `{ model?, title?, metadata? }` → session |
| `GET` | `/sessions/:id` | Session with all messages |
| `PATCH` | `/sessions/:id` | `{ model?, title?, metadata? }`; switch the model here |
| `DELETE` | `/sessions/:id` | |
| `POST` | `/sessions/:id/messages` | `{ content, model?, context?, stream? }` → event stream, or JSON when `stream: false` |

A turn streams as Server-Sent Events, one per event:

| Event | Data |
|---|---|
| `turn_start` | `{ sessionId, model }` |
| `text_delta` / `reasoning_delta` | `{ text }` |
| `tool_call` | `{ id, name, input }` |
| `tool_result` | `{ id, name, output, isError }` |
| `message` | `{ message }`: each stored message (user, assistant, tool results) |
| `error` | `{ message }` |
| `turn_end` | `{ stopReason, usage, steps }`; `stopReason` is `end`, `max_steps`, `max_tokens`, `refusal`, `aborted` or `error` |

```bash
curl -s -X POST localhost:8787/v1/sessions -H 'content-type: application/json' -d '{}'
curl -N -X POST localhost:8787/v1/sessions/<id>/messages -H 'content-type: application/json' \
  -d '{"content": "What is on my list?", "model": "deepseek/deepseek-chat"}'
```

## Project layout

```
packages/core     the harness: loop, plugins, tools, providers, stores  (@lean-harness/core)
packages/server   HTTP + SSE API on Hono                                 (@lean-harness/server)
packages/widget   <lean-chat> web component on Lit                       (@lean-harness/widget)
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
- A token in `<lean-chat token>` is visible to the page's users. For public sites, put the API behind your own auth (`authorize`) or a backend that adds credentials.

## License

MIT
