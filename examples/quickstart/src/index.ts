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
  memoryPlugin,
  mock,
  ollama,
  openai,
  openrouter,
  type Provider,
} from '@lean-harness/core';
import { createServer, serve } from '@lean-harness/server';
import { clockPlugin, tasksPlugin } from './tasks-plugin.js';

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
  mock(),
];

const defaultModel =
  env.DEFAULT_MODEL ??
  (env.ANTHROPIC_API_KEY ? 'anthropic/claude-opus-5-5' : env.DEEPSEEK_API_KEY ? 'deepseek/deepseek-chat' : 'mock/echo');

const harness = createHarness({
  providers,
  plugins: [
    tasksPlugin(here('../.data/tasks.json')),
    clockPlugin,
    // Long-term memory per user (sessions created with metadata.userId), else one shared "default" user.
    memoryPlugin({ backend: new FileMemory(here('../.data/memory.json')) }),
    // Documents the model can search: every .md file in ./knowledge.
    knowledgePlugin({ dir: here('../knowledge'), description: 'how this team plans and prioritises work' }),
  ],
  defaultModel,
  instructions: 'You are Lean Harness, a friendly assistant that keeps the user organised. Be brief.',
  store: new FileStore(here('../.data/sessions')),
});

const app = createServer(harness, { apiKey: env.HARNESS_API_KEY });

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
app.get('/', async (c) => c.html(await readFile(here('../public/index.html'), 'utf8')));

serve(app);
console.log(`Default model: ${defaultModel}`);
