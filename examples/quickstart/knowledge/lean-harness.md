# Lean Harness

Lean Harness is a small agent harness for TypeScript. It runs the agent loop,
connects any model, runs your tools, and serves an HTTP API with a chat UI
you can embed in any page. Replace the files in this folder with your own
documents; the assistant searches them with `search_knowledge`.

## Models

Models are named `provider/model`, for example `anthropic/claude-opus-5-5` or
`deepseek/deepseek-chat`. Built-in providers: Anthropic (official SDK), and an
OpenAI-compatible adapter with presets for OpenAI, DeepSeek, Gemini,
OpenRouter and Ollama. A conversation can switch models at any time; the next
model sees the whole history.

## Adding a tool

Define a tool with `defineTool({ name, description, input, run })`, where
`input` is a Zod schema. The model sees the schema; `run` receives validated
input. Return any value; throwing reports the error to the model. Put tools in
a plugin with `definePlugin({ name, instructions, tools })` and pass the plugin
to `createHarness`.

## Plugins

A plugin can add instructions to the system prompt, tools, model providers
and hooks. Hooks: `beforeModel` changes a request before it is sent,
`beforeToolCall` can deny a tool call, and `onEvent` observes everything.

## Memory

Conversation history is saved per session. The memory plugin adds long-term
memory per user with the tools `remember`, `forget` and `recall`. The history
window plugin sends only recent messages to small-context models.

## Context

An app can attach context to any message, such as the page the user is on or
the record they are viewing. The model sees each entry as a labelled block.
The knowledge plugin makes a folder of documents searchable.

## The chat UI

`<lean-chat>` is a web component. `mode="page"` is a full-screen chat app with
a conversation sidebar, `mode="inline"` fills its container, and
`mode="floating"` is a launcher button in the corner of any page.
