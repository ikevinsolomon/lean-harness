import { serve as nodeServe } from '@hono/node-server';
import { Harness, HarnessError, type HarnessEvent } from '@lean-harness/core';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';

export interface ServerOptions {
  /** Require `Authorization: Bearer <apiKey>` on every API call. */
  apiKey?: string;
  /** Custom auth instead of (or as well as) apiKey. Return false to reject the request. */
  authorize?: (request: Request) => boolean | Promise<boolean>;
  /** Origins allowed to call the API from a browser (default "*"). False turns CORS off. */
  corsOrigin?: string | string[] | false;
  /** Path the API is mounted on (default "/v1"). */
  basePath?: string;
}

const CreateSession = z.object({
  model: z.string().optional(),
  title: z.string().max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const UpdateSession = CreateSession.partial();

const SendMessage = z.object({
  content: z.string().min(1).max(200_000),
  /** Use a different model for this turn only. */
  model: z.string().optional(),
  /** Stream Server-Sent Events (default) or return one JSON result. */
  stream: z.boolean().optional(),
  /** Retry or edit: replace this user message (and everything after it) with the new one. */
  replaceFrom: z.string().optional(),
  /** Context for this message, shown to the model as labelled blocks: `{ "Page": "Pricing" }`. */
  context: z
    .record(z.string().max(100), z.unknown())
    .refine((c) => JSON.stringify(c).length <= 100_000, 'Context is larger than 100,000 characters')
    .optional(),
});

const Decision = z.object({
  approved: z.boolean(),
  /** Allow this tool for the rest of the session without asking again. */
  always: z.boolean().optional(),
});

const STATUS = { not_found: 404, busy: 409, bad_request: 400 } as const;

function fail(c: Context, error: unknown) {
  if (error instanceof HarnessError) return c.json({ error: { code: error.code, message: error.message } }, STATUS[error.code]);
  if (error instanceof z.ZodError) {
    return c.json({ error: { code: 'bad_request', message: z.prettifyError(error) } }, 400);
  }
  if (error instanceof SyntaxError) return c.json({ error: { code: 'bad_request', message: 'Body must be JSON' } }, 400);
  console.error(error);
  return c.json({ error: { code: 'internal', message: 'Internal server error' } }, 500);
}

/**
 * The HTTP API. Everything a UI needs: list models and tools, manage sessions,
 * switch models, and stream a turn as Server-Sent Events (one event per HarnessEvent).
 */
export function createServer(harness: Harness, options: ServerOptions = {}) {
  const api = new Hono();

  if (options.corsOrigin !== false) {
    api.use('*', cors({ origin: options.corsOrigin ?? '*', allowHeaders: ['Content-Type', 'Authorization'] }));
  }
  api.use('*', async (c, next) => {
    if (c.req.method === 'OPTIONS' || c.req.path.endsWith('/health')) return next();
    const header = c.req.header('Authorization');
    if (options.apiKey && header !== `Bearer ${options.apiKey}`) {
      return c.json({ error: { code: 'unauthorized', message: 'Missing or invalid API key' } }, 401);
    }
    if (options.authorize && !(await options.authorize(c.req.raw))) {
      return c.json({ error: { code: 'unauthorized', message: 'Not authorized' } }, 401);
    }
    return next();
  });
  api.onError((error, c) => fail(c, error));

  api.get('/health', (c) => c.json({ ok: true }));

  api.get('/models', async (c) => c.json({ defaultModel: harness.defaultModel, models: await harness.listModels() }));

  api.get('/tools', (c) => c.json({ tools: harness.listTools() }));

  api.get('/sessions', async (c) => c.json({ sessions: await harness.store.list() }));

  api.post('/sessions', async (c) => {
    const body = CreateSession.parse(await c.req.json().catch(() => ({})));
    return c.json(await harness.createSession(body), 201);
  });

  api.get('/sessions/:id', async (c) => c.json(await harness.getSession(c.req.param('id'))));

  api.patch('/sessions/:id', async (c) => {
    const body = UpdateSession.parse(await c.req.json());
    return c.json(await harness.updateSession(c.req.param('id'), body));
  });

  api.delete('/sessions/:id', async (c) => {
    if (!(await harness.store.delete(c.req.param('id')))) throw new HarnessError('not_found', 'Session not found');
    return c.body(null, 204);
  });

  // Allow or decline a tool call that paused the turn (an `approval_request` event).
  api.post('/sessions/:id/approvals/:callId', async (c) => {
    const body = Decision.parse(await c.req.json());
    const found = await harness.decide(c.req.param('id'), c.req.param('callId'), body.approved, body.always);
    if (!found) throw new HarnessError('not_found', 'No tool call is waiting for that decision');
    return c.body(null, 204);
  });

  api.post('/sessions/:id/messages', async (c) => {
    const body = SendMessage.parse(await c.req.json());
    const id = c.req.param('id');

    if (body.stream === false) {
      return c.json(
        await harness.send(id, body.content, { model: body.model, context: body.context, replaceFrom: body.replaceFrom, signal: c.req.raw.signal }),
      );
    }

    const abort = new AbortController();
    const events = harness.run(id, body.content, { model: body.model, context: body.context, replaceFrom: body.replaceFrom, signal: abort.signal });
    // Pull the first event before streaming, so "not found" or "busy" become normal HTTP errors.
    const first = await events.next();
    return streamSSE(c, async (stream) => {
      stream.onAbort(() => abort.abort());
      const write = (event: HarnessEvent) => stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      if (!first.done) await write(first.value);
      for await (const event of events) await write(event);
    });
  });

  return new Hono().route(options.basePath ?? '/v1', api);
}

/** Start an HTTP server on Node. */
export function serve(app: Hono, port = Number(process.env.PORT ?? 8787)) {
  return nodeServe({ fetch: app.fetch, port }, (info) => {
    console.log(`lean-harness listening on http://localhost:${info.port}`);
  });
}

export { Hono };
