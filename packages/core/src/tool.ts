import { z } from 'zod';
import type { JSONSchema, Session, ToolSpec } from './types.js';

export interface ToolContext {
  session: Session;
  signal: AbortSignal;
}

export interface Tool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  input: S;
  /**
   * The schema the model sees, when the tool comes with its own JSON Schema (MCP tools).
   * Otherwise it is generated from `input`.
   */
  jsonSchema?: JSONSchema;
  /**
   * Ask the user before running: `true`, or a function of the input (for example, only for
   * large amounts). A declined call is reported to the model as an error.
   */
  needsApproval?: boolean | ((input: z.infer<S>, context: ToolContext) => boolean | Promise<boolean>);
  /** Returned values are sent to the model as text (objects as JSON). Throwing reports an error to the model. */
  run(input: z.infer<S>, context: ToolContext): unknown | Promise<unknown>;
}

const NAME = /^[a-zA-Z0-9_-]{1,64}$/;

/** Define a tool with a Zod input schema; the input is validated before `run` is called. */
export function defineTool<S extends z.ZodType>(tool: {
  name: string;
  description: string;
  input: S;
  needsApproval?: Tool<S>['needsApproval'];
  run(input: z.infer<S>, context: ToolContext): unknown | Promise<unknown>;
}): Tool<S> {
  if (!NAME.test(tool.name)) {
    throw new Error(`Tool name "${tool.name}" must be 1-64 letters, digits, "_" or "-"`);
  }
  return tool;
}

export function toolSpec(tool: Tool): ToolSpec {
  if (tool.jsonSchema) return { name: tool.name, description: tool.description, inputSchema: tool.jsonSchema };
  const { $schema: _, ...inputSchema } = z.toJSONSchema(tool.input, { io: 'input' }) as Record<string, unknown>;
  return { name: tool.name, description: tool.description, inputSchema };
}

/** Tool output as the text a model reads. */
export function toolOutputText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return 'Done.';
  return JSON.stringify(value);
}
