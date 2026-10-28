# {{name}}

An AI assistant built on [Lean Harness](https://github.com/ikevinsolomon/lean-harness).

```bash
cp .env.example .env    # add a model key, e.g. ANTHROPIC_API_KEY
npm run dev             # http://localhost:8787
```

The first visit asks you to create the admin account. Invite your team from **People** in the sidebar.

## Make it yours

| File | What it is |
|---|---|
| `instructions.md` | Who the assistant is and how it behaves |
| `src/tools.ts` | What it can do: call your APIs, query your databases, take actions |
| `knowledge/*.md` | Documents it searches before answering |
| `mcp.json` | MCP servers it can use (same format as Claude Desktop) |
| `src/index.ts` | Name, starter prompts, and more options |
| `logo.svg` | Optional: your logo in place of the cup |

A tool that changes something should set `needsApproval: true`: the app asks before it runs.

## Commands

```bash
npm run dev                      # run with reload
npm test                         # test your tools
npm run reset-password           # print a reset link for the admin (or: -- someone@example.com)
```

Everything lives in `.data/` (a SQLite database) unless you set `DATABASE_URL` for Postgres.
