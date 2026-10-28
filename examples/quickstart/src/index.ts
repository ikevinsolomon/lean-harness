import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  anthropic,
  createHarness,
  deepseek,
  FileMemory,
  gemini,
  knowledgePlugin,
  mcpPlugin,
  memoryPlugin,
  mock,
  ollama,
  openai,
  openrouter,
  openSqlite,
  postgresDb,
  SqlMemory,
  SqlSessionStore,
  tracing,
  webFetchPlugin,
  type Provider,
  type SqlDb,
} from '@lean-harness/core';
import { Accounts, createServer, Hono, serve, tokenAuth, type User } from '@lean-harness/server';
import { clockPlugin } from './clock-plugin.js';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

try {
  process.loadEnvFile(here('../.env'));
} catch {
  // no .env file: use the environment as it is
}

// Register every provider that has a key. A provider without a model list asks the
// provider which models exist; Ollama lists its local models only when it is running.
const env = process.env;
const list = (value?: string) => value?.split(',').map((s) => s.trim()).filter(Boolean);
const providers: Provider[] = [
  // Claude's own web search and code sandbox run on Anthropic's servers and are billed per use.
  ...(env.ANTHROPIC_API_KEY ? [anthropic({ webSearch: env.CLAUDE_WEB_SEARCH === '1', codeExecution: env.CLAUDE_CODE_EXECUTION === '1' })] : []),
  ...(env.OPENAI_API_KEY ? [openai({ models: list(env.OPENAI_MODELS) })] : []),
  ...(env.DEEPSEEK_API_KEY ? [deepseek()] : []),
  ...(env.GEMINI_API_KEY ? [gemini({ models: list(env.GEMINI_MODELS) })] : []),
  ...(env.OPENROUTER_API_KEY ? [openrouter({ models: list(env.OPENROUTER_MODELS) })] : []),
  ollama(),
];
// The offline mock model is for trying things without a key; it steps aside once a real provider is connected.
if (providers.length === 1 || env.MOCK_MODEL === '1') providers.push(mock());

const defaultModel =
  env.DEFAULT_MODEL ||
  (env.ANTHROPIC_API_KEY ? 'anthropic/claude-opus-5-5' : env.DEEPSEEK_API_KEY ? 'deepseek/deepseek-chat' : 'mock/echo');

// MCP servers from mcp.json, in the same format Claude Desktop uses. Relative paths
// in "args" and "cwd" resolve from this example's folder.
type McpConfig = { mcpServers?: Record<string, { command?: string; args?: string[]; env?: Record<string, string>; cwd?: string; url?: string; headers?: Record<string, string> }> };
const mcpConfig: McpConfig = JSON.parse(await readFile(here('../mcp.json'), 'utf8').catch(() => '{}'));
const mcp = await mcpPlugin({
  servers: Object.fromEntries(
    Object.entries(mcpConfig.mcpServers ?? {}).map(([name, s]) => [
      name,
      s.url
        ? { url: s.url, headers: s.headers }
        : { command: s.command === 'node' ? process.execPath : s.command!, args: s.args, env: s.env, cwd: s.cwd ?? here('..') },
    ]),
  ),
});
for (const s of mcp.servers) console.log(`MCP server "${s.name}": ${s.tools.join(', ')}`);

// One database for chats, memory and accounts: Postgres when DATABASE_URL is set, else a SQLite file.
async function openDb(): Promise<SqlDb> {
  if (env.DATABASE_URL) {
    const { default: pg } = await import('pg');
    return postgresDb(new pg.Pool({ connectionString: env.DATABASE_URL }));
  }
  return openSqlite(env.DATABASE_FILE || here('../.data/lean-harness.db'));
}
const db = await openDb();

// Long-term memory lives in the database; MEMORY_FILE keeps it in a JSON file instead.
const memory = env.MEMORY_FILE ? new FileMemory(env.MEMORY_FILE) : new SqlMemory(db);

const harness = createHarness({
  providers,
  plugins: [
    clockPlugin,
    // Long-term memory per signed-in user (one shared "default" user without sign-in).
    memoryPlugin({ backend: memory }),
    // Documents the model can search: every .md file in ./knowledge.
    knowledgePlugin({ dir: here('../knowledge'), description: 'Lean Harness: models, tools, plugins, memory, context and the chat UI' }),
    // Reading public web pages (private and local addresses are refused).
    webFetchPlugin(),
    // One line per reply on the console: time, tokens, tools, estimated cost.
    // Prices are US dollars per million tokens; check your provider's current prices.
    tracing({
      prices: {
        'anthropic/claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
        'anthropic/claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
        'anthropic/claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
        'anthropic/claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
      },
    }),
    mcp,
  ],
  defaultModel,
  instructions: 'You are Lean Harness, a helpful assistant. Answer clearly and briefly.',
  store: new SqlSessionStore(db),
});

const app = new Hono();

// One line per API request (method, path, status, time), so you can see what the app is doing.
app.use('/v1/*', async (c, next) => {
  const started = Date.now();
  await next();
  // Invite links are secrets: keep them out of the log.
  const path = c.req.path.replace(/\/invites\/[^/]+/, '/invites/…');
  console.log(`${c.req.method} ${path} ${c.res.status} ${Date.now() - started}ms`);
});
// Sign-in, one of:
// - accounts (the default): email and password. The first visitor creates the admin account;
//   everyone else joins by an invite link the admin creates under People.
// - tokens: HARNESS_USERS="asha:long-random-token,ben:another-token", for internal tools and scripts.
// - none: AUTH=off, a single-user app (HARNESS_API_KEY can still lock the API).
const users = Object.fromEntries(
  (list(env.HARNESS_USERS) ?? []).map((entry): [string, User] => {
    const [id, token] = entry.split(':');
    return [token!, { id: id!, name: id! }];
  }),
);
const tokens = Object.keys(users).length > 0;
const accounts =
  env.AUTH !== 'off' && !tokens && !env.HARNESS_API_KEY
    ? new Accounts(db, {
        // Chats made before sign-in was on belong to the admin.
        async onSetup(admin) {
          await harness.store.list(); // creates the tables on a new database
          await db.query('UPDATE lh_sessions SET owner = ? WHERE owner IS NULL', [admin.id]);
          // So do memories kept in the JSON file by earlier versions.
          if (memory instanceof SqlMemory) {
            for (const m of await new FileMemory(here('../.data/memory.json')).list('default')) await memory.add(admin.id, m.text);
          }
        },
      })
    : undefined;
console.log(`Sign-in: ${accounts ? 'accounts (email and password)' : tokens ? 'access tokens' : 'off'}`);
app.route(
  '/',
  createServer(harness, {
    accounts,
    authenticate: tokens ? tokenAuth(users) : undefined,
    apiKey: env.HARNESS_API_KEY || undefined,
    corsOrigin: env.CORS_ORIGIN || '*',
    rateLimit: env.RATE_LIMIT_PER_MINUTE ? { windowMs: 60_000, max: Number(env.RATE_LIMIT_PER_MINUTE) } : undefined,
    memory,
  }),
);

// The demo page and the widget bundle, served next to the API.
const widget = here('../../../packages/widget/dist/lean-chat.js');
app.get('/lean-chat.js', async (c) => {
  try {
    return c.body(await readFile(widget, 'utf8'), 200, { 'Content-Type': 'text/javascript; charset=utf-8' });
  } catch {
    return c.text('Build the widget first: pnpm --filter @lean-harness/widget build', 404);
  }
});
app.get('/logo.svg', async (c) =>
  c.body(await readFile(here('../../../assets/logo.svg'), 'utf8'), 200, { 'Content-Type': 'image/svg+xml' }),
);
// The widget demos: the <lean-chat> element full screen, and floating on a page.
app.get('/widget', async (c) => c.html(await readFile(here('../public/widget.html'), 'utf8')));
app.get('/embed', async (c) => c.html(await readFile(here('../public/embed.html'), 'utf8')));

// The web app (apps/web, built with `pnpm --filter @lean-harness/web build`): its files, and
// index.html for every app route so links to /c/<id> work on reload.
const web = here('../../../apps/web/dist');
const TYPES: Record<string, string> = { js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', map: 'application/json' };
app.get('/assets/:file', async (c) => {
  const file = c.req.param('file');
  if (!/^[\w.-]+$/.test(file)) return c.notFound();
  try {
    const type = TYPES[file.split('.').pop() ?? ''] ?? 'application/octet-stream';
    return c.body(await readFile(`${web}/assets/${file}`), 200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable' });
  } catch {
    return c.notFound();
  }
});
const appPage = async () => readFile(`${web}/index.html`, 'utf8').catch(() => 'Build the web app first: pnpm --filter @lean-harness/web build');
app.get('/', async (c) => c.html(await appPage()));
app.get('/c/:id', async (c) => c.html(await appPage()));
app.get('/invite/:token', async (c) => c.html(await appPage()));

const server = serve(app);

// On Ctrl-C or SIGTERM (docker stop, a deploy): stop taking requests, let replies in progress
// finish for up to 20 seconds, then stop MCP servers and exit.
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    if (closing) process.exit(1); // a second Ctrl-C quits at once
    closing = true;
    console.log('Shutting down: waiting for replies in progress…');
    server.close();
    const stopped = await harness.shutdown(20_000);
    if (stopped) console.log(`Stopped ${stopped} unfinished ${stopped === 1 ? 'reply' : 'replies'}`);
    await mcp.close();
    process.exit(0);
  });
}
console.log(`Default model: ${defaultModel}`);
