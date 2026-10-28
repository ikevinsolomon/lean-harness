import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  anthropic,
  createHarness,
  deepseek,
  FileMemory,
  FileStore,
  gemini,
  knowledgePlugin,
  mcpPlugin,
  memoryPlugin,
  mock,
  ollama,
  openai,
  openrouter,
  type Provider,
} from '@lean-harness/core';
import { createServer, Hono, serve } from '@lean-harness/server';
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
  ...(env.ANTHROPIC_API_KEY ? [anthropic()] : []),
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

const harness = createHarness({
  providers,
  plugins: [
    clockPlugin,
    // Long-term memory per user (sessions created with metadata.userId), else one shared "default" user.
    memoryPlugin({ backend: new FileMemory(here('../.data/memory.json')) }),
    // Documents the model can search: every .md file in ./knowledge.
    knowledgePlugin({ dir: here('../knowledge'), description: 'Lean Harness: models, tools, plugins, memory, context and the chat UI' }),
    mcp,
  ],
  defaultModel,
  instructions: 'You are Lean Harness, a helpful assistant. Answer clearly and briefly.',
  store: new FileStore(here('../.data/sessions')),
});

const app = new Hono();

// One line per API request (method, path, status, time), so you can see what the app is doing.
app.use('/v1/*', async (c, next) => {
  const started = Date.now();
  await next();
  console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - started}ms`);
});
app.route('/', createServer(harness, { apiKey: env.HARNESS_API_KEY }));

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

serve(app);
console.log(`Default model: ${defaultModel}`);
