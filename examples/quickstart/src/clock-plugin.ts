import { definePlugin, defineTool, z } from '@lean-harness/core';

/**
 * A tiny example plugin: dynamic instructions plus one tool. Copy this file to
 * start your own domain (support desk, analytics, travel...).
 */
export const clockPlugin = definePlugin({
  name: 'clock',
  instructions: () => `Today is ${new Date().toDateString()}.`,
  tools: [
    defineTool({
      name: 'current_time',
      description: 'The current date and time, optionally in a given IANA time zone.',
      input: z.object({ timeZone: z.string().optional().describe('For example Asia/Kolkata') }),
      run: ({ timeZone }) => new Date().toLocaleString('en-GB', { timeZone, dateStyle: 'full', timeStyle: 'long' }),
    }),
  ],
});
