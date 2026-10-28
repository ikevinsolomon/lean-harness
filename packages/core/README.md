# @lean-harness/core

The engine of [Lean Harness](https://github.com/ikevinsolomon/lean-harness): a small, provider-neutral agent harness.

- The agent loop: streaming, parallel tool calls, step limits, budgets, approvals.
- Models from Anthropic (Claude) and any OpenAI-compatible API, switchable per message.
- Tools (Zod-validated), plugins, MCP servers, memory, knowledge, sub-agents, structured output.
- Sessions in memory, files, SQLite or Postgres.

```ts
import { anthropic, createHarness, defineTool, z } from '@lean-harness/core';

const weather = defineTool({
  name: 'weather',
  description: 'Current weather for a city',
  input: z.object({ city: z.string() }),
  run: async ({ city }) => `Sunny in ${city}`,
});

const harness = createHarness({ providers: [anthropic()], plugins: [{ name: 'demo', tools: [weather] }] });
const session = await harness.createSession();
for await (const event of harness.run(session.id, 'Weather in Pune?')) {
  if (event.type === 'text_delta') process.stdout.write(event.text);
}
```

See the [main README](https://github.com/ikevinsolomon/lean-harness#readme) for the full guide.
