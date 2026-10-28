# Your assistants

Each folder here is one assistant for one domain, made with:

```bash
pnpm new-agent support-desk --name "Support Desk"
pnpm install
cp agents/support-desk/.env.example agents/support-desk/.env   # add a model key
pnpm --filter support-desk dev
```

An assistant is a small folder: `instructions.md` (who it is), `src/tools.ts` (what it can do),
`knowledge/` (what it knows), `mcp.json` (MCP servers) and `.env` (keys). Everything else, the
web app, accounts, memory and the API, comes from `@lean-harness/app`.
