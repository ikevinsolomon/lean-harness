import { z } from 'zod';
import { createHarness, type HarnessOptions } from '../harness.js';
import { defineTool } from '../tool.js';

/**
 * A sub-agent: a tool that hands a task to another agent with its own instructions,
 * tools and (optionally) cheaper model, and returns its answer. The main agent's
 * context stays small; the sub-agent does the reading.
 */
export interface SubagentOptions extends Omit<HarnessOptions, 'store'> {
  /** The tool name the main agent calls, e.g. "researcher". */
  name: string;
  /** When the main agent should use it. */
  description: string;
}

export function subagentTool(options: SubagentOptions) {
  const { name, description, ...harnessOptions } = options;
  const agent = createHarness(harnessOptions);
  return defineTool({
    name,
    description,
    input: z.object({ task: z.string().min(1).describe('Everything the sub-agent needs to know to do the task') }),
    async run({ task }, { signal, session }) {
      const own = await agent.createSession({ owner: session.owner, metadata: { parent: session.id } });
      const result = await agent.send(own.id, task, { signal });
      if (result.error && !result.text) throw new Error(result.error);
      return result.text || 'The sub-agent finished without an answer.';
    },
  });
}
