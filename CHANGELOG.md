# Changelog

## 0.1.0 (unreleased)

First version.

- **Core:** agent loop with streaming, parallel tool calls and step limits; plugins
  (instructions, tools, providers, hooks); Zod-validated tools.
- **Models:** Anthropic (official SDK; adaptive thinking, prompt caching, refusal
  fallback) and any OpenAI-compatible API (OpenAI, DeepSeek, Gemini, OpenRouter,
  Ollama); switch models per session or per message.
- **Memory and context:** long-term memory per user, history window, per-message
  context, a searchable knowledge base, and automatic summaries of long conversations.
- **Tools:** MCP servers (local and remote), approvals (allow once, always, deny),
  web fetch with network protections, sub-agents, structured output.
- **Production:** users and sign-in (tokens, JWT, or your own), SQLite and Postgres
  stores, replies that keep running in the background, token budgets, tool timeouts,
  attachments (images, PDFs, text), tracing with cost estimates, rate limits, Docker
  and Docker Compose.
- **Apps:** a React web app (chat history, search, model menu, retry and edit,
  approvals, attachments, settings, light and dark, phone layout) and an embeddable
  `<lean-chat>` web component.
