import type { Tool } from './tool.js';
import type { HarnessEvent, ModelRequest, Provider, Session } from './types.js';

export interface HookContext {
  session: Session;
  model: string;
}

export interface PendingToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface Hooks {
  /** Change a model request before it is sent (add context, trim history, swap tools). */
  beforeModel?(request: ModelRequest, context: HookContext): void | Promise<void>;
  /** Return `{ deny: reason }` to stop a tool call; the reason is reported to the model. */
  beforeToolCall?(
    call: PendingToolCall,
    context: HookContext,
  ): void | { deny: string } | Promise<void | { deny: string }>;
  /** Observe every event a run emits (logging, metrics, audit). */
  onEvent?(event: HarnessEvent, context: HookContext): void | Promise<void>;
}

/**
 * A plugin is the unit of extension. A domain (support desk, analytics, travel...)
 * is one or more plugins: instructions for the model, tools, and optional hooks.
 * Model providers are plugins too.
 */
export interface Plugin {
  name: string;
  /** Added to the system prompt. A function is called for every model request. */
  instructions?: string | ((context: HookContext) => string | Promise<string>);
  tools?: Tool[];
  providers?: Provider[];
  hooks?: Hooks;
}

export function definePlugin(plugin: Plugin): Plugin {
  return plugin;
}
