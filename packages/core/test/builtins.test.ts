import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, htmlToText, isPrivateAddress, subagentTool, webFetchPlugin, z, type Tool } from '../src/index.js';
import { call, scripted, text } from './scripted.js';

const ctx = { session: { id: 's', model: 'x/y', metadata: {}, createdAt: '', updatedAt: '', messages: [] }, signal: new AbortController().signal };

describe('web fetch', () => {
  let server: Server;
  let base = '';
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/redirect-to-metadata') {
        res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data' }).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(
        '<html><head><title>Hello page</title><style>.x{}</style></head><body><h1>Welcome</h1><p>Prices &amp; plans</p><script>evil()</script></body></html>',
      );
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const fetchTool = (options = {}) => webFetchPlugin(options).tools![0] as Tool;

  it('recognises private and local addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it('refuses local addresses by default, and redirects into private networks', async () => {
    await expect(fetchTool().run({ url: `${base}/` }, ctx)).rejects.toThrow(/private or local/);
    await expect(fetchTool().run({ url: 'file:///etc/passwd' }, ctx)).rejects.toThrow(/Only http/);
    await expect(fetchTool({ allowPrivate: false }).run({ url: `${base}/redirect-to-metadata` }, ctx)).rejects.toThrow(/private or local/);
  });

  it('returns readable page text', async () => {
    const page = (await fetchTool({ allowPrivate: true }).run({ url: `${base}/` }, ctx)) as { title: string; text: string };
    expect(page.title).toBe('Hello page');
    expect(page.text).toContain('Welcome');
    expect(page.text).toContain('Prices & plans');
    expect(page.text).not.toContain('evil');
    expect(htmlToText('<p>a</p><p>b</p>').text).toBe('a\nb');
  });
});

describe('sub-agents', () => {
  it('hands a task to another agent and returns its answer', async () => {
    const worker = scripted([[text('Paris is the capital of France.')]], 'worker');
    const researcher = subagentTool({
      name: 'researcher',
      description: 'Looks things up',
      providers: [worker.provider],
      defaultModel: 'worker/model-a',
      instructions: 'You research facts.',
    });
    const main = scripted([[call('researcher', { task: 'Capital of France?' })], [text('It is Paris.')]]);
    const harness = createHarness({ providers: [main.provider], plugins: [{ name: 'agents', tools: [researcher] }], defaultModel: 'test/model-a' });
    const session = await harness.createSession();
    const result = await harness.send(session.id, 'What is the capital of France?');
    expect(result.text).toBe('It is Paris.');
    expect(worker.requests[0]!.system).toContain('You research facts.');
    expect(main.requests[1]!.messages.at(-1)!.parts[0]).toMatchObject({ output: 'Paris is the capital of France.' });
  });
});

describe('structured output', () => {
  it('returns data matching the schema, retrying an invalid answer', async () => {
    const { provider, requests } = scripted([[call('respond', { city: 42 }, 'bad')], [call('respond', { city: 'Pune', year: 2019 }, 'good')]]);
    const harness = createHarness({ providers: [provider], defaultModel: 'test/model-a' });
    const data = await harness.extract(z.object({ city: z.string(), year: z.number().int() }), 'I moved to Pune in 2019.');
    expect(data).toEqual({ city: 'Pune', year: 2019 });
    expect(requests[0]!.tools[0]).toMatchObject({ name: 'respond', inputSchema: { type: 'object' } });
    expect(requests[1]!.messages.at(-1)!.parts[0]).toMatchObject({ isError: true });
  });

  it('wraps schemas that are not objects', async () => {
    const { provider, requests } = scripted([[call('respond', { value: ['a', 'b'] })]]);
    const harness = createHarness({ providers: [provider], defaultModel: 'test/model-a' });
    expect(await harness.extract(z.array(z.string()), 'a and b')).toEqual(['a', 'b']);
    expect(requests[0]!.tools[0]!.inputSchema).toMatchObject({ properties: { value: { type: 'array' } } });
  });
});
