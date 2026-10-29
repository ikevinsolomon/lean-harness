# Changelog

## 0.1.0 (unreleased)

First version.

- **New assistants in minutes:** `pnpm new-agent` / `npm create lean-harness` makes a
  folder per domain (instructions, tools, knowledge, MCP, tests); `@lean-harness/app`
  runs it with one `startApp` call, branded with its own name and starter prompts.
- **Core:** agent loop with streaming, parallel tool calls and step limits; plugins
  (instructions, tools, providers, hooks); Zod-validated tools.
- **Models:** Anthropic (official SDK; adaptive thinking, prompt caching, refusal
  fallback) and any OpenAI-compatible API (OpenAI, DeepSeek, Gemini, OpenRouter,
  Ollama); switch models per session or per message.
- **Memory and context:** long-term memory per user, history window, per-message
  context, a searchable knowledge base, and automatic summaries of long conversations.
- **Tools:** MCP servers (local and remote), approvals (allow once, always, deny),
  web fetch with network protections, sub-agents, structured output.
- **Accounts:** email and password; "Continue with Google / Microsoft / OpenID Connect";
  invites (emailed, resent, as admin); sign-up for your email domains or anyone, proven
  by an emailed link; "Forgot password?" by email; email confirmation and email change;
  profile, password and account deletion in Settings; People with last sign-in, search,
  roles and stepping down; an activity log; email by Resend, SMTP or the console.
  Sign-in limits per email and IP stored in the database, expired links cleared
  automatically, scrypt hashing, httpOnly cookies, cross-site protection. Or bring your
  own sign-in (tokens, JWT).
- **Claude server tools:** web search and code execution, with paused turns resumed
  automatically.
- **Production:** one database for chats, memory and accounts (SQLite or Postgres, with
  search in the database), graceful shutdown, replies that keep running in the background, token budgets, tool timeouts,
  attachments (images, PDFs, text), tracing with cost estimates, rate limits, Docker
  and Docker Compose.
- **Apps:** a React web app (chat history, search, model menu, retry and edit,
  approvals, attachments, settings, people and invites, light and dark, phone layout)
  and an embeddable `<lean-chat>` web component with attachments.
