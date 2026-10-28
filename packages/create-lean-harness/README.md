# create-lean-harness

Start a new [Lean Harness](https://github.com/ikevinsolomon/lean-harness) assistant for your domain.

```bash
npm create lean-harness@latest support-desk -- --name "Support Desk"
cd support-desk && npm install
cp .env.example .env   # add a model key
npm run dev            # http://localhost:8787
```

You get `instructions.md`, `src/tools.ts` (with examples), `knowledge/`, `mcp.json`, tests and a README.
