import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';
import type { Plugin } from '../plugin.js';
import type { Tool } from '../tool.js';
import type { JSONSchema } from '../types.js';

/**
 * MCP (Model Context Protocol) is the standard way to plug ready-made tools into an
 * agent: GitHub, Slack, databases, files, browsers... This plugin connects to MCP
 * servers and offers their tools to the model like any other tool.
 */

export type McpServerConfig =
  /** A local server the harness starts as a process and talks to over stdin/stdout. */
  | { command: string; args?: string[]; env?: Record<string, string>; cwd?: string }
  /** A remote server over Streamable HTTP. */
  | { url: string; headers?: Record<string, string> }
  /** An already-built transport (tests, custom setups). */
  | { transport: Transport };

/** What an MCP server says about one of its tools. */
export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema: JSONSchema;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; title?: string };
}

export interface McpOptions {
  servers: Record<string, McpServerConfig>;
  /**
   * Which tools ask the user before running. Default "unless-read-only": tools the server
   * marks read-only run straight away, everything else asks.
   */
  approval?: 'unless-read-only' | 'always' | 'never' | ((server: string, tool: McpToolInfo) => boolean);
  /** Called when a server cannot be reached; the others still load. Default: a console warning. */
  onError?: (server: string, error: unknown) => void;
}

export interface McpPlugin extends Plugin {
  /** Servers that connected, with the names of their tools. */
  servers: { name: string; tools: string[] }[];
  /** Close every connection (stops local server processes). */
  close(): Promise<void>;
}

/** Harness tool names allow letters, digits, "_" and "-" (64 at most): `server__tool`. */
function toolName(server: string, tool: string) {
  return `${server}__${tool}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

function transportFor(config: McpServerConfig): Transport {
  if ('transport' in config) return config.transport;
  if ('url' in config) return new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } });
  return new StdioClientTransport({
    command: config.command,
    args: config.args,
    cwd: config.cwd,
    // Servers get a minimal environment plus what the config adds, not every secret in ours.
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...config.env },
    stderr: 'ignore',
  });
}

/** Text a model can read from an MCP tool result. */
function resultText(result: Record<string, unknown>): string {
  const parts = Array.isArray(result.content) ? (result.content as Record<string, any>[]) : [];
  const text = parts
    .map((c) => {
      if (c.type === 'text') return c.text as string;
      if (c.type === 'image' || c.type === 'audio') return `[${c.type}: ${c.mimeType}]`;
      if (c.type === 'resource') return (c.resource?.text as string | undefined) ?? `[resource: ${c.resource?.uri}]`;
      if (c.type === 'resource_link') return `[link: ${c.uri}]`;
      return `[${c.type}]`;
    })
    .join('\n');
  return text || (result.structuredContent !== undefined ? JSON.stringify(result.structuredContent) : '');
}

/**
 * Connect to MCP servers and expose their tools. Async because it asks each server
 * for its tools: `plugins: [await mcpPlugin({ servers: { github: { url: '...' } } })]`.
 */
export async function mcpPlugin(options: McpOptions): Promise<McpPlugin> {
  const policy = options.approval ?? 'unless-read-only';
  const ask = (server: string, tool: McpToolInfo) =>
    typeof policy === 'function' ? policy(server, tool) : policy === 'always' ? true : policy === 'never' ? false : !tool.annotations?.readOnlyHint;
  const onError = options.onError ?? ((server, error) => console.warn(`MCP server "${server}" is unavailable:`, error instanceof Error ? error.message : error));

  const clients: Client[] = [];
  const tools: Tool[] = [];
  const servers: McpPlugin['servers'] = [];

  await Promise.all(
    Object.entries(options.servers).map(async ([server, config]) => {
      const client = new Client({ name: 'lean-harness', version: '0.1.0' });
      try {
        await client.connect(transportFor(config));
        const found: McpToolInfo[] = [];
        let cursor: string | undefined;
        do {
          const page = await client.listTools(cursor ? { cursor } : undefined);
          found.push(...(page.tools as McpToolInfo[]));
          cursor = page.nextCursor;
        } while (cursor);

        clients.push(client);
        servers.push({ name: server, tools: found.map((t) => t.name) });
        for (const info of found) {
          tools.push({
            name: toolName(server, info.name),
            description: `[${server}] ${info.description ?? info.annotations?.title ?? info.name}`,
            // The server validates arguments against its own schema; we only require an object.
            input: z.record(z.string(), z.unknown()),
            jsonSchema: info.inputSchema,
            needsApproval: ask(server, info),
            async run(input, { signal }) {
              const result = await client.callTool({ name: info.name, arguments: input as Record<string, unknown> }, undefined, { signal });
              const text = resultText(result);
              if (result.isError) throw new Error(text || `${info.name} failed`);
              return text || 'Done.';
            },
          });
        }
      } catch (error) {
        onError(server, error);
        await client.close().catch(() => undefined);
      }
    }),
  );

  return {
    name: 'mcp',
    tools,
    servers,
    async close() {
      await Promise.all(clients.map((c) => c.close().catch(() => undefined)));
    },
  };
}
