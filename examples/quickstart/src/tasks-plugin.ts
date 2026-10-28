import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { definePlugin, defineTool, z } from '@lean-harness/core';

/**
 * An example domain: a small task tracker. Swap this file for your own domain
 * (support tickets, inventory, analytics...) and keep everything else.
 */

interface Task {
  id: number;
  title: string;
  due?: string;
  priority: 'low' | 'normal' | 'high';
  done: boolean;
  createdAt: string;
}

export function tasksPlugin(file: string) {
  const load = async (): Promise<Task[]> => {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as Task[];
    } catch {
      return [];
    }
  };
  const save = async (tasks: Task[]) => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(tasks, null, 2));
  };

  return definePlugin({
    name: 'tasks',
    instructions: [
      'You help the user manage their task list.',
      'Use the task tools to read and change tasks; never invent tasks or ids.',
      'After a change, confirm it in one short sentence. Show lists as a compact Markdown table.',
    ].join(' '),
    tools: [
      defineTool({
        name: 'add_task',
        description: 'Add a task to the list.',
        input: z.object({
          title: z.string().min(1).describe('What needs doing'),
          due: z.string().optional().describe('Due date, YYYY-MM-DD'),
          priority: z.enum(['low', 'normal', 'high']).default('normal'),
        }),
        async run({ title, due, priority }) {
          const tasks = await load();
          const task: Task = {
            id: Math.max(0, ...tasks.map((t) => t.id)) + 1,
            title,
            due,
            priority,
            done: false,
            createdAt: new Date().toISOString(),
          };
          await save([...tasks, task]);
          return task;
        },
      }),
      defineTool({
        name: 'list_tasks',
        description: 'List tasks. By default only open tasks.',
        input: z.object({ includeDone: z.boolean().default(false) }),
        async run({ includeDone }) {
          const tasks = await load();
          return includeDone ? tasks : tasks.filter((t) => !t.done);
        },
      }),
      defineTool({
        name: 'complete_task',
        description: 'Mark a task as done by its id.',
        input: z.object({ id: z.number().int().positive() }),
        async run({ id }) {
          const tasks = await load();
          const task = tasks.find((t) => t.id === id);
          if (!task) throw new Error(`No task with id ${id}`);
          task.done = true;
          await save(tasks);
          return task;
        },
      }),
    ],
  });
}

/** A second, tiny plugin: plugins compose. */
export const clockPlugin = definePlugin({
  name: 'clock',
  instructions: (context) => `Today is ${new Date().toDateString()}. The session started ${context.session.createdAt}.`,
  tools: [
    defineTool({
      name: 'current_time',
      description: 'The current date and time, optionally in a given IANA time zone.',
      input: z.object({ timeZone: z.string().optional().describe('For example Asia/Kolkata') }),
      run: ({ timeZone }) => new Date().toLocaleString('en-GB', { timeZone, dateStyle: 'full', timeStyle: 'long' }),
    }),
  ],
});
