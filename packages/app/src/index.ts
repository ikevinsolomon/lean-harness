import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  anthropic,
  createHarness,
  deepseek,
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
  type Harness,
  type HarnessOptions,
  type Plugin,
  type Provider,
  type SqlDb,
  type Tool,
} from '@lean-harness/core';
import {
  Accounts,
  consoleMailer,
  createServer,
  google,
  Hono,
  microsoft,
  oidc,
  resendMailer,
  serve,
  smtpMailer,
  tokenAuth,
  type Account,
  type AppInfo,
  type Mailer,
  type SignupPolicy,
  type SsoProvider,
  type User,
} from '@lean-harness/server';

export interface AppOptions {
  /**
   * The agent's folder. Read from it when present: `.env`, `instructions.md`,
   * `knowledge/*.md`, `mcp.json`, `logo.svg`. Data goes in `.data/`.
   * Pass `new URL('..', import.meta.url)` from `src/index.ts`.
   */
  root: string | URL;
  /** The assistant's name in the app, e.g. "Support Desk" (default "Lean Harness"). */
  name?: string;
  /** The line under the greeting on the home screen. */
  tagline?: string;
  /** Starter prompts on the home screen (up to four are shown). */
  suggestions?: AppInfo['suggestions'];
  /** The system prompt. Default: `instructions.md` in the root folder. */
  instructions?: string;
  /** Your domain's tools. */
  tools?: Tool[];
  /** More plugins: instructions, tools and hooks together. */
  plugins?: Plugin[];
  /** What the knowledge folder is about, shown to the model (e.g. "our refund policy"). `false` turns it off. */
  knowledge?: string | false;
  /** Let the model read public web pages (default true). */
  webFetch?: boolean;
  /** Anything else the harness takes: `maxSteps`, `budget`, `context`, `toolTimeoutMs`... */
  harness?: Partial<Omit<HarnessOptions, 'providers' | 'plugins' | 'store' | 'instructions'>>;
  /** Add your own routes (webhooks, pages) before the app starts. */
  configure?(app: Hono, harness: Harness): void | Promise<void>;
  /** Runs once, when the admin account is created. */
  onSetup?(admin: Account, db: SqlDb): void | Promise<void>;
}

/** US dollars per million tokens, for the cost line on the console. Check current prices. */
const PRICES = {
  'anthropic/claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'anthropic/claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'anthropic/claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  'anthropic/claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
};

const list = (value?: string) => value?.split(',').map((s) => s.trim()).filter(Boolean);

/** Every provider that has a key in the environment, plus Ollama when it runs, plus the offline mock model when nothing else is set up. */
export function providersFromEnv(env = process.env): { providers: Provider[]; defaultModel: string } {
  const providers: Provider[] = [
    // Claude's own web search and code sandbox run on Anthropic's servers and are billed per use.
    ...(env.ANTHROPIC_API_KEY ? [anthropic({ webSearch: env.CLAUDE_WEB_SEARCH === '1', codeExecution: env.CLAUDE_CODE_EXECUTION === '1' })] : []),
    ...(env.OPENAI_API_KEY ? [openai({ models: list(env.OPENAI_MODELS) })] : []),
    ...(env.DEEPSEEK_API_KEY ? [deepseek()] : []),
    ...(env.GEMINI_API_KEY ? [gemini({ models: list(env.GEMINI_MODELS) })] : []),
    ...(env.OPENROUTER_API_KEY ? [openrouter({ models: list(env.OPENROUTER_MODELS) })] : []),
    ollama(),
  ];
  if (providers.length === 1 || env.MOCK_MODEL === '1') providers.push(mock());
  const defaultModel =
    env.DEFAULT_MODEL ||
    (env.ANTHROPIC_API_KEY ? 'anthropic/claude-opus-5-5' : env.DEEPSEEK_API_KEY ? 'deepseek/deepseek-chat' : 'mock/echo');
  return { providers, defaultModel };
}

/** One database for chats, memory and accounts: Postgres when DATABASE_URL is set, else a SQLite file. */
export async function openDatabase(root: string, env = process.env): Promise<SqlDb> {
  if (env.DATABASE_URL) {
    const { default: pg } = await import('pg').catch(() => {
      throw new Error('DATABASE_URL is set: install the Postgres driver with `npm install pg`');
    });
    return postgresDb(new pg.Pool({ connectionString: env.DATABASE_URL }));
  }
  return openSqlite(env.DATABASE_FILE || join(root, '.data/lean-harness.db'));
}

type McpConfig = {
  mcpServers?: Record<string, { command?: string; args?: string[]; env?: Record<string, string>; cwd?: string; url?: string; headers?: Record<string, string> }>;
};

/** MCP servers from mcp.json, in the format Claude Desktop uses. Relative paths resolve from the root folder. */
async function mcpFromFile(root: string) {
  const config: McpConfig = JSON.parse(await readFile(join(root, 'mcp.json'), 'utf8').catch(() => '{}'));
  const mcp = await mcpPlugin({
    servers: Object.fromEntries(
      Object.entries(config.mcpServers ?? {}).map(([name, s]) => [
        name,
        s.url ? { url: s.url, headers: s.headers } : { command: s.command === 'node' ? process.execPath : s.command!, args: s.args, env: s.env, cwd: s.cwd ?? root },
      ]),
    ),
  });
  for (const s of mcp.servers) console.log(`MCP server "${s.name}": ${s.tools.join(', ')}`);
  return mcp;
}

/** Where the built web app is: apps/web/dist in the repository, or the copy bundled into this package on npm. */
function webDir() {
  const repo = fileURLToPath(new URL('../../../apps/web/dist', import.meta.url));
  return existsSync(join(repo, 'index.html')) ? repo : fileURLToPath(new URL('../web', import.meta.url));
}

const TYPES: Record<string, string> = { js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', ico: 'image/x-icon', map: 'application/json' };

/** Serve the web app: its files, and index.html for every app route so links work on reload. */
function serveWebApp(app: Hono, root: string, name: string) {
  const web = webDir();
  app.get('/assets/:file', async (c) => {
    const file = c.req.param('file');
    if (!/^[\w.-]+$/.test(file)) return c.notFound();
    try {
      const type = TYPES[file.split('.').pop() ?? ''] ?? 'application/octet-stream';
      return c.body(await readFile(join(web, 'assets', file)), 200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable' });
    } catch {
      return c.notFound();
    }
  });
  // Your own logo.svg in the root folder replaces the cup.
  app.get('/logo.svg', async (c) => {
    const own = join(root, 'logo.svg');
    return c.body(await readFile(existsSync(own) ? own : join(web, 'logo.svg')), 200, { 'Content-Type': 'image/svg+xml' });
  });
  const page = async () => {
    const html = await readFile(join(web, 'index.html'), 'utf8').catch(() => 'Build the web app first: pnpm --filter @lean-harness/web build');
    return html.replace(/<title>[^<]*<\/title>/, `<title>${name.replace(/[<&]/g, '')}</title>`);
  };
  for (const path of ['/', '/c/:id', '/invite/:token', '/reset/:token', '/confirm-email/:token']) app.get(path, async (c) => c.html(await page()));

  // The <lean-chat> widget, for embedding the assistant in other pages.
  app.get('/lean-chat.js', async (c) => {
    try {
      const file = fileURLToPath(import.meta.resolve('@lean-harness/widget/dist/lean-chat.js'));
      return c.body(await readFile(file, 'utf8'), 200, { 'Content-Type': 'text/javascript; charset=utf-8' });
    } catch {
      return c.text('Build the widget first: pnpm --filter @lean-harness/widget build', 404);
    }
  });
}

/** Email from the environment: Resend (RESEND_API_KEY), SMTP (SMTP_URL), or the console (EMAIL=console). */
export async function mailerFromEnv(env = process.env, name = 'Lean Harness'): Promise<Mailer | undefined> {
  const from = env.EMAIL_FROM || `${name} <noreply@localhost>`;
  if (env.RESEND_API_KEY) return resendMailer({ apiKey: env.RESEND_API_KEY, from });
  if (env.SMTP_URL) return smtpMailer({ url: env.SMTP_URL, from });
  if (env.EMAIL === 'console') return consoleMailer();
  return undefined;
}

/** "Continue with ..." providers that have a client ID and secret in the environment. */
export function ssoFromEnv(env = process.env): SsoProvider[] {
  return [
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? [google({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET })] : []),
    ...(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET
      ? [microsoft({ clientId: env.MICROSOFT_CLIENT_ID, clientSecret: env.MICROSOFT_CLIENT_SECRET, tenant: env.MICROSOFT_TENANT || undefined })]
      : []),
    ...(env.OIDC_ISSUER && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET
      ? [oidc({ name: env.OIDC_NAME || 'single sign-on', issuer: env.OIDC_ISSUER, clientId: env.OIDC_CLIENT_ID, clientSecret: env.OIDC_CLIENT_SECRET, trustEmail: env.OIDC_TRUST_EMAIL === '1' })]
      : []),
  ];
}

/** Who may sign up without an invite, until the admin changes it in People: SIGNUP=invite|domain|open, SIGNUP_DOMAINS=acme.com,acme.co.uk. */
function signupFromEnv(env: NodeJS.ProcessEnv): SignupPolicy | undefined {
  const mode = env.SIGNUP;
  if (mode !== 'domain' && mode !== 'open' && mode !== 'invite') return undefined;
  return { mode, domains: list(env.SIGNUP_DOMAINS) ?? [] };
}

/** Sign-in from the environment: accounts by default, tokens with HARNESS_USERS, none with AUTH=off. */
async function signInFromEnv(env: NodeJS.ProcessEnv, db: SqlDb, name: string, publicUrl: string, onSetup: (admin: Account) => Promise<void>) {
  const users = Object.fromEntries(
    (list(env.HARNESS_USERS) ?? []).map((entry): [string, User] => {
      const [id, token] = entry.split(':');
      return [token!, { id: id!, name: id! }];
    }),
  );
  const tokens = Object.keys(users).length > 0;
  if (env.AUTH === 'off' || tokens || env.HARNESS_API_KEY) {
    return { accounts: undefined, authenticate: tokens ? tokenAuth(users) : undefined, mode: tokens ? 'access tokens' : 'off' };
  }
  const mailer = await mailerFromEnv(env, name);
  const sso = ssoFromEnv(env);
  const accounts = new Accounts(db, {
    onSetup,
    mailer,
    publicUrl,
    appName: name,
    sso,
    signup: signupFromEnv(env),
    sessionDays: env.SESSION_DAYS ? Number(env.SESSION_DAYS) : undefined,
  });
  const extras = [mailer ? 'email' : '', ...sso.map((p) => p.name)].filter(Boolean);
  return { accounts, authenticate: undefined, mode: `accounts${extras.length ? ` (${extras.join(', ')})` : ''}` };
}

/**
 * `node src/index.ts reset-password [email]`: print a one-time link to set a new password,
 * for when the admin is locked out. Without an email, it is for the first admin.
 */
async function printResetLink(db: SqlDb, base: string, email?: string) {
  const accounts = new Accounts(db);
  const account = email ? await accounts.userByEmail(email) : (await accounts.listUsers()).find((u) => u.role === 'admin');
  if (!account) {
    console.error(email ? `No account with the email ${email}` : 'There is no admin account yet: open the app to create one.');
    process.exitCode = 1;
    return;
  }
  const { token } = await accounts.createResetLink(account.id);
  console.log(`Password reset link for ${account.name} (${account.email}), valid for 24 hours:\n\n  ${base}/reset/${token}\n`);
}

/**
 * Start a complete assistant: models from `.env`, the HTTP API, the web app, the widget,
 * sign-in with accounts, memory, knowledge, MCP servers, tracing and a clean shutdown.
 *
 * ```ts
 * await startApp({ root: new URL('..', import.meta.url), name: 'Support Desk', tools: [lookupOrder] });
 * ```
 */
export async function startApp(options: AppOptions) {
  const root = options.root instanceof URL ? fileURLToPath(options.root) : options.root;
  try {
    process.loadEnvFile(join(root, '.env'));
  } catch {
    // no .env file: use the environment as it is
  }
  const env = process.env;
  const name = options.name ?? 'Lean Harness';
  const db = await openDatabase(root, env);
  // Where people reach the app: links in emails and sign-in redirects use it.
  const publicUrl = env.PUBLIC_URL?.replace(/\/$/, '') || `http://localhost:${env.PORT ?? 8787}`;

  if (process.argv[2] === 'reset-password') {
    await printResetLink(db, publicUrl, process.argv[3]);
    return null;
  }

  const { providers, defaultModel } = providersFromEnv(env);
  const memory = new SqlMemory(db);
  const mcp = await mcpFromFile(root);
  const knowledgeDir = join(root, 'knowledge');
  const hasKnowledge = options.knowledge !== false && (await readdir(knowledgeDir).catch(() => [])).some((f) => f.endsWith('.md'));
  const instructions =
    options.instructions ??
    (await readFile(join(root, 'instructions.md'), 'utf8').catch(() => `You are ${name}, a helpful assistant. Answer clearly and briefly.`));

  const harness = createHarness({
    defaultModel,
    ...options.harness,
    providers,
    instructions,
    store: new SqlSessionStore(db),
    plugins: [
      ...(options.tools?.length ? [{ name: 'tools', tools: options.tools }] : []),
      ...(options.plugins ?? []),
      // Long-term memory per signed-in user.
      memoryPlugin({ backend: memory }),
      // Documents the model can search: every .md file in ./knowledge.
      ...(hasKnowledge ? [knowledgePlugin({ dir: knowledgeDir, description: options.knowledge || undefined })] : []),
      // Reading public web pages (private and local addresses are refused).
      ...(options.webFetch === false ? [] : [webFetchPlugin()]),
      // One line per reply on the console: time, tokens, tools, estimated cost.
      tracing({ prices: PRICES }),
      mcp,
    ],
  });

  const signIn = await signInFromEnv(env, db, name, publicUrl, async (admin) => {
    // Chats made before sign-in was on belong to the admin.
    await harness.store.list(); // creates the tables on a new database
    await db.query('UPDATE lh_sessions SET owner = ? WHERE owner IS NULL', [admin.id]);
    await options.onSetup?.(admin, db);
  });

  const app = new Hono();
  // One line per API request. Invite and reset links are secrets: keep them out of the log.
  app.use('/v1/*', async (c, next) => {
    const started = Date.now();
    await next();
    const path = c.req.path.replace(/\/(invites|resets|email)\/[^/]+/, '/$1/…');
    console.log(`${c.req.method} ${path} ${c.res.status} ${Date.now() - started}ms`);
  });
  app.route(
    '/',
    createServer(harness, {
      app: { name, tagline: options.tagline, suggestions: options.suggestions },
      accounts: signIn.accounts,
      authenticate: signIn.authenticate,
      apiKey: env.HARNESS_API_KEY || undefined,
      corsOrigin: env.CORS_ORIGIN || '*',
      trustProxy: env.TRUST_PROXY === '1',
      rateLimit: env.RATE_LIMIT_PER_MINUTE ? { windowMs: 60_000, max: Number(env.RATE_LIMIT_PER_MINUTE) } : undefined,
      memory,
    }),
  );
  await options.configure?.(app, harness);
  serveWebApp(app, root, name);

  const server = serve(app, Number(env.PORT ?? 8787));
  console.log(`${name} · sign-in: ${signIn.mode} · default model: ${harness.defaultModel}`);

  // Stop taking requests, let replies in progress finish for up to 20 seconds, then stop MCP servers.
  const close = async () => {
    server.close();
    const stopped = await harness.shutdown(20_000);
    if (stopped) console.log(`Stopped ${stopped} unfinished ${stopped === 1 ? 'reply' : 'replies'}`);
    await mcp.close();
  };
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
      if (closing) process.exit(1); // a second Ctrl-C quits at once
      closing = true;
      console.log('Shutting down: waiting for replies in progress…');
      await close();
      process.exit(0);
    });
  }
  return { app, harness, db, accounts: signIn.accounts, close };
}

export type { AppInfo };
