import { definePlugin } from '../plugin.js';

/**
 * Short-term memory limit: send only the most recent messages to the model.
 * The full history stays stored. Use it for models with small context windows;
 * note that trimming changes the prompt each turn, so provider caching helps less.
 */
export function historyWindow(options: { maxMessages: number }) {
  return definePlugin({
    name: 'history-window',
    hooks: {
      beforeModel(request) {
        if (request.messages.length <= options.maxMessages) return;
        let start = request.messages.length - options.maxMessages;
        // Start on a user message, so a tool result is never cut off from its call.
        while (start < request.messages.length && request.messages[start]!.role !== 'user') start++;
        if (start === request.messages.length) start = request.messages.findLastIndex((m) => m.role === 'user');
        request.messages = request.messages.slice(Math.max(0, start));
      },
    },
  });
}
