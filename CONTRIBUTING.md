# Contributing

Thanks for helping. Lean Harness aims to stay small and readable, so the bar for new
code is "does it earn its place?"

## Setup

Node 22 or newer and pnpm.

```bash
pnpm install
pnpm dev            # builds the widget and web app, starts the quickstart on :8787
pnpm test           # vitest
pnpm typecheck
pnpm build
```

The quickstart works without any API key (the offline mock model). Add keys in
`examples/quickstart/.env` to try real models.

## Making a change

- Keep changes focused: one feature or fix per pull request.
- Add or update tests next to the code (`packages/*/test`). Tests must not call real
  model APIs; use the `scripted` helper or the `mock()` provider.
- Run `pnpm typecheck && pnpm test` before opening a pull request. CI runs the same.
- Match the existing style: plain functions, short files, comments that explain why.
- New behaviour that users see belongs in the README.

## Where things live

| Folder | What |
|---|---|
| `packages/core` | The agent loop, plugins, tools, providers, stores |
| `packages/server` | The HTTP API |
| `packages/widget` | `<lean-chat>` and the browser API client |
| `apps/web` | The React web app |
| `examples/quickstart` | The demo server |

## Reporting problems

Open an issue with what you did, what you expected, and what happened. For security
problems, please report privately rather than in a public issue.
