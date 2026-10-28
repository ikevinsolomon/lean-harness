# @lean-harness/server

The HTTP API for a [Lean Harness](https://github.com/ikevinsolomon/lean-harness) agent, so any UI can drive it:
sessions, replies streamed as Server-Sent Events, approvals, stop and reconnect, memory, search,
and built-in accounts (email and password, one admin, invite links).

```ts
import { createHarness, anthropic, openSqlite, SqlSessionStore } from '@lean-harness/core';
import { Accounts, createServer, serve } from '@lean-harness/server';

const db = await openSqlite('.data/app.db');
const harness = createHarness({ providers: [anthropic()], store: new SqlSessionStore(db) });
serve(createServer(harness, { accounts: new Accounts(db) }));
```

See the [main README](https://github.com/ikevinsolomon/lean-harness#readme) for every route and option.
