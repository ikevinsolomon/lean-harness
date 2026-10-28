import { serve as nodeServe } from '@hono/node-server';
import { Harness, HarnessError, searchHit, type MemoryBackend, type SearchHit, type Session } from '@lean-harness/core';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { accountRoutes, crossSite, isPublicAuthPath, sessionToken } from './account-routes.js';
import { AccountError, Accounts } from './accounts.js';
import type { Authenticate, User } from './auth.js';

export { jwtAuth, tokenAuth } from './auth.js';
export type { Authenticate, JwtOptions, User } from './auth.js';
export { AccountError, Accounts } from './accounts.js';
export type { Account, AccountOptions, Invite, Role } from './accounts.js';

/** How the app presents itself to its UIs: the web app shows these. */
export interface AppInfo {
  /** The assistant's name, e.g. "Support Desk" (default "Lean Harness"). */
  name: string;
  /** The line under the greeting on the home screen. */
  tagline?: string;
  /** Starter prompts on the home screen. `prompt` is what gets sent (default: the title). */
  suggestions?: { title: string; detail?: string; prompt?: string; icon?: 'spark' | 'tool' | 'clock' | 'memory' | 'search' | 'doc' }[];
}

export interface ServerOptions {
  /** Name, tagline and starter prompts for the UI (`GET /v1/app`, no sign-in needed). */
  app?: AppInfo;
  /**
   * Who is calling. With it, every session belongs to its creator, people see only
   * their own sessions, and memory follows the user. Without it, the API is single-user.
   */
  authenticate?: Authenticate;
  /**
   * Built-in email-and-password accounts: one admin, everyone else joins by invite link.
   * Adds `/auth/*` and `/admin/*` routes. Can be combined with `authenticate` (tried second).
   */
  accounts?: Accounts;
  /** Single-user shortcut: require `Authorization: Bearer <apiKey>`. */
  apiKey?: string;
  /** Origins allowed to call the API from a browser (default "*"). Set your app's origin in production. */
  corsOrigin?: string | string[] | false;
  /** Path the API is mounted on (default "/v1"). */
  basePath?: string;
  /** Limit messages per user (or per IP without sign-in): `{ windowMs: 60_000, max: 20 }`. */
  rateLimit?: { windowMs: number; max: number };
  /** Expose the long-term memory store, so people can see and delete what is remembered. */
  memory?: MemoryBackend;
}

type Env = { Variables: { user: User | null } };

const CreateSession = z.object({
  model: z.string().optional(),
  title: z.string().max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const UpdateSession = CreateSession.partial();

const MB = 1024 * 1024;
const FILE_TYPES = /^(image\/(png|jpeg|gif|webp)|application\/(pdf|json|xml|yaml|x-yaml)|text\/[\w.+-]+)$/;

const File = z.object({
  name: z.string().min(1).max(200),
  mediaType: z.string().regex(FILE_TYPES, 'Attach images (PNG, JPEG, GIF, WebP), PDFs or text files'),
  /** Base64 content, at most 10 MB of file. */
  data: z.string().max(Math.ceil((10 * MB * 4) / 3) + 4, 'Each file can be at most 10 MB'),
});

const SendMessage = z.object({
  content: z.string().min(1).max(200_000),
  /** Use a different model for this turn only. */
  model: z.string().optional(),
  /** Stream Server-Sent Events (default) or return one JSON result. */
  stream: z.boolean().optional(),
  /** Retry or edit: replace this user message (and everything after it) with the new one. */
  replaceFrom: z.string().optional(),
  /** Files attached to this message: images, PDFs and text files. */
  files: z
    .array(File)
    .max(10, 'Attach at most 10 files')
    .refine((f) => f.reduce((n, x) => n + x.data.length, 0) <= Math.ceil((20 * MB * 4) / 3), 'Attachments can be at most 20 MB together')
    .optional(),
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
  if (error instanceof AccountError) return c.json({ error: { code: 'account', message: error.message } }, error.status);
  if (error instanceof HarnessError) return c.json({ error: { code: error.code, message: error.message } }, STATUS[error.code]);
  if (error instanceof z.ZodError) {
    return c.json({ error: { code: 'bad_request', message: z.prettifyError(error) } }, 400);
  }
  if (error instanceof SyntaxError) return c.json({ error: { code: 'bad_request', message: 'Body must be JSON' } }, 400);
  console.error(error);
  return c.json({ error: { code: 'internal', message: 'Internal server error' } }, 500);
}

/**
 * The HTTP API. Everything a UI needs: models and tools, sessions, switching models,
 * turns streamed as Server-Sent Events (one event per HarnessEvent), approvals, stop
 * and reconnect, memory, and search.
 */
export function createServer(harness: Harness, options: ServerOptions = {}) {
  const api = new Hono<Env>();
  const windows = new Map<string, { count: number; reset: number }>();
  const base = options.basePath ?? '/v1';
  /** Routes anyone may call: liveness, and how the app presents itself. */
  const open = new Set([`${base}/health`, `${base}/app`]);

  if (options.corsOrigin !== false) {
    api.use('*', cors({ origin: options.corsOrigin ?? '*', allowHeaders: ['Content-Type', 'Authorization'] }));
  }
  api.use('*', async (c, next) => {
    c.set('user', null);
    if (c.req.method === 'OPTIONS' || open.has(c.req.path)) return next();
    if (options.accounts && crossSite(c)) {
      return c.json({ error: { code: 'forbidden', message: 'Cross-site request refused' } }, 403);
    }
    if (options.accounts && isPublicAuthPath(c.req.path)) return next();
    if (options.apiKey && c.req.header('Authorization') !== `Bearer ${options.apiKey}`) {
      return c.json({ error: { code: 'unauthorized', message: 'Missing or invalid API key' } }, 401);
    }
    if (options.accounts || options.authenticate) {
      const account = options.accounts ? await options.accounts.accountForToken(sessionToken(c)) : null;
      const user = account ? Accounts.user(account) : ((await options.authenticate?.(c.req.raw)) ?? null);
      if (!user) return c.json({ error: { code: 'unauthorized', message: 'Sign in to continue' } }, 401);
      c.set('user', user);
    }
    return next();
  });
  api.onError((error, c) => fail(c, error));

  /** The session, if the caller may see it. Someone else's session looks like a missing one. */
  const owned = async (c: Context<Env>, id = c.req.param('id')!): Promise<Session> => {
    const session = await harness.getSession(id);
    const user = c.get('user');
    if (user && session.owner !== user.id) throw new HarnessError('not_found', `Session ${id} not found`);
    return session;
  };

  const limited = (c: Context<Env>) => {
    if (!options.rateLimit) return false;
    const key = c.get('user')?.id ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
    const now = Date.now();
    const w = windows.get(key);
    if (!w || w.reset <= now) {
      windows.set(key, { count: 1, reset: now + options.rateLimit.windowMs });
      return false;
    }
    w.count++;
    if (w.count <= options.rateLimit.max) return false;
    c.header('Retry-After', String(Math.ceil((w.reset - now) / 1000)));
    return true;
  };

  const stream = (c: Context<Env>, id: string, from = 0) =>
    streamSSE(c, async (sse) => {
      // Closing the connection leaves the turn running; reconnect with GET .../stream.
      let index = from;
      for await (const event of harness.watch(id, from)) {
        await sse.writeSSE({ id: String(index++), event: event.type, data: JSON.stringify(event) });
      }
    });

  api.get('/health', (c) => c.json({ ok: true }));

  api.get('/app', (c) => c.json({ name: 'Lean Harness', suggestions: [], ...options.app }));

  if (options.accounts) accountRoutes(api, options.accounts);

  api.get('/me', (c) => c.json({ user: c.get('user') }));

  api.get('/models', async (c) => c.json({ defaultModel: harness.defaultModel, models: await harness.listModels() }));

  api.get('/tools', (c) => c.json({ tools: harness.listTools() }));

  api.get('/sessions', async (c) => {
    const user = c.get('user');
    const sessions = await harness.store.list(user ? { owner: user.id } : {});
    return c.json({ sessions: sessions.map((s) => ({ ...s, running: harness.isRunning(s.id) })) });
  });

  api.post('/sessions', async (c) => {
    const body = CreateSession.parse(await c.req.json().catch(() => ({})));
    const user = c.get('user');
    const metadata = user ? { ...body.metadata, userId: user.id } : body.metadata;
    return c.json(await harness.createSession({ ...body, metadata, owner: user?.id }), 201);
  });

  api.get('/sessions/:id', async (c) => {
    const session = await owned(c);
    return c.json({ ...session, running: harness.isRunning(session.id) });
  });

  api.patch('/sessions/:id', async (c) => {
    const body = UpdateSession.parse(await c.req.json());
    const session = await owned(c);
    const user = c.get('user');
    const metadata = body.metadata && user ? { ...body.metadata, userId: user.id } : body.metadata;
    return c.json(await harness.updateSession(session.id, { ...body, metadata }));
  });

  api.delete('/sessions/:id', async (c) => {
    const session = await owned(c);
    harness.stop(session.id);
    await harness.store.delete(session.id);
    return c.body(null, 204);
  });

  // Allow or decline a tool call that paused the turn (an `approval_request` event).
  api.post('/sessions/:id/approvals/:callId', async (c) => {
    const body = Decision.parse(await c.req.json());
    const session = await owned(c);
    const found = await harness.decide(session.id, c.req.param('callId'), body.approved, body.always);
    if (!found) throw new HarnessError('not_found', 'No tool call is waiting for that decision');
    return c.body(null, 204);
  });

  // Stop the running turn. Closing the stream does not stop it; this does.
  api.post('/sessions/:id/stop', async (c) => {
    const session = await owned(c);
    return c.json({ stopped: harness.stop(session.id) });
  });

  // Reconnect to the running (or just finished) turn. `?from=N` skips events already received.
  api.get('/sessions/:id/stream', async (c) => {
    const session = await owned(c);
    const from = Number(c.req.query('from') ?? c.req.header('Last-Event-ID') ?? 0) || 0;
    return stream(c, session.id, from);
  });

  api.post('/sessions/:id/messages', async (c) => {
    const body = SendMessage.parse(await c.req.json());
    const session = await owned(c);
    if (limited(c)) return c.json({ error: { code: 'rate_limited', message: 'Too many messages. Try again shortly.' } }, 429);
    const files = body.files?.map((f) => ({ type: 'file' as const, ...f }));
    const run = { model: body.model, context: body.context, replaceFrom: body.replaceFrom, files };

    if (body.stream === false) {
      return c.json(await harness.send(session.id, body.content, { ...run, signal: c.req.raw.signal }));
    }
    // Starting first turns "busy" or a bad model into a normal HTTP error.
    await harness.start(session.id, body.content, run);
    return stream(c, session.id);
  });

  // Long-term memory: what the assistant remembers about the caller.
  if (options.memory) {
    const memory = options.memory;
    const scope = (c: Context<Env>) => c.get('user')?.id ?? 'default';
    api.get('/memories', async (c) => c.json({ memories: await memory.list(scope(c)) }));
    api.delete('/memories/:id', async (c) => {
      if (!(await memory.remove(scope(c), c.req.param('id')))) throw new HarnessError('not_found', 'Memory not found');
      return c.body(null, 204);
    });
  }

  // Find messages containing some text, in the caller's sessions.
  api.get('/search', async (c) => {
    const query = (c.req.query('q') ?? '').trim().toLowerCase();
    if (query.length < 2) return c.json({ results: [] });
    const user = c.get('user');
    const filter = user ? { owner: user.id } : {};
    if (harness.store.search) return c.json({ results: await harness.store.search(query, filter, 30) });
    // Stores without search: read the newest sessions one by one.
    const results: SearchHit[] = [];
    for (const summary of (await harness.store.list(filter)).slice(0, 300)) {
      const session = await harness.store.get(summary.id);
      const hit = session?.messages.map((m) => searchHit(session, m, query)).find(Boolean);
      if (hit) results.push(hit);
      if (results.length >= 30) break;
    }
    return c.json({ results });
  });

  return new Hono().route(base, api);
}

/** Start an HTTP server on Node. */
export function serve(app: Hono, port = Number(process.env.PORT ?? 8787)) {
  return nodeServe({ fetch: app.fetch, port }, (info) => {
    console.log(`lean-harness listening on http://localhost:${info.port}`);
  });
}

export { Hono };
