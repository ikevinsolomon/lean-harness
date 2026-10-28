/**
 * The harness speaks one provider-neutral vocabulary. Provider adapters translate
 * between it and each vendor's wire format, so the loop, tools, plugins and
 * storage never depend on a specific model API.
 */

export type Role = 'user' | 'assistant' | 'tool';

export interface TextPart {
  type: 'text';
  text: string;
}

export interface ReasoningPart {
  type: 'reasoning';
  text: string;
}

export interface ToolCallPart {
  type: 'tool_call';
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultPart {
  type: 'tool_result';
  toolCallId: string;
  name: string;
  output: string;
  isError?: boolean;
}

/**
 * Context the app attached to a user message: the page the user is on, the
 * record they are looking at, their role. The model sees it; chat UIs show it as a chip.
 */
export interface ContextPart {
  type: 'context';
  label: string;
  text: string;
}

/** A file the user attached: an image, a PDF, or a text file. `data` is base64. */
export interface FilePart {
  type: 'file';
  name: string;
  mediaType: string;
  data: string;
}

export type Part = TextPart | ContextPart | FilePart | ReasoningPart | ToolCallPart | ToolResultPart;

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface Message {
  id: string;
  role: Role;
  parts: Part[];
  createdAt: string;
  /** The `provider/model` that produced an assistant message. */
  model?: string;
  usage?: Usage;
  /**
   * The provider's own form of this message, kept so the same provider can replay
   * it exactly (for example Anthropic thinking blocks, which must be sent back
   * unchanged). Other providers ignore it and use `parts`.
   */
  native?: { provider: string; data: unknown };
}

export interface Session {
  id: string;
  /** Who the session belongs to (a user id). Unset when the app has no sign-in. */
  owner?: string;
  title?: string;
  /** Default `provider/model` for this session; any turn can override it. */
  model: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}

/** Why a model call (or a whole turn) stopped. */
export type StopReason =
  | 'end'
  | 'tool_calls'
  | 'max_tokens'
  | 'refusal'
  | 'max_steps'
  /** A token budget (per reply or per session) ran out. */
  | 'budget'
  | 'aborted'
  | 'error'
  | 'other';

export type JSONSchema = Record<string, unknown>;

/** A tool as a model sees it. */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: JSONSchema;
}

export interface ModelInfo {
  /** `provider/model`, the id clients send back. */
  id: string;
  provider: string;
  model: string;
  label?: string;
}

/** One request to one model. */
export interface ModelRequest {
  model: string;
  system: string;
  messages: Message[];
  tools: ToolSpec[];
  signal?: AbortSignal;
}

/** What a provider streams back for one model call. */
export type ProviderEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  | {
      type: 'done';
      parts: Part[];
      stopReason: StopReason;
      usage?: Usage;
      native?: unknown;
      /** Set when the provider served the request with a different model (a fallback). */
      servedBy?: string;
    };

export interface Provider {
  /** The prefix in `provider/model`, for example `anthropic`. */
  id: string;
  label?: string;
  /** Models this provider offers (model names without the provider prefix). */
  listModels(): Promise<string[]>;
  stream(request: ModelRequest): AsyncIterable<ProviderEvent>;
}

/** Everything a harness run emits, in order. This is also the HTTP streaming protocol. */
export type HarnessEvent =
  | { type: 'turn_start'; sessionId: string; model: string }
  | { type: 'text_delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  /** The turn is paused until someone allows or declines this tool call (see `Harness.decide`). */
  | { type: 'approval_request'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; name: string; output: string; isError: boolean }
  | { type: 'message'; message: Message }
  | { type: 'turn_end'; stopReason: StopReason; usage: Usage; steps: number }
  | { type: 'error'; message: string };
