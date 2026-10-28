import { describe, expect, it } from 'vitest';
import { supportsAdaptiveThinking, toAnthropicMessages, toChatMessages, type Message } from '../src/index.js';

const at = '2026-01-01T00:00:00.000Z';
const conversation: Message[] = [
  { id: '1', role: 'user', createdAt: at, parts: [{ type: 'text', text: 'Add a task' }] },
  {
    id: '2',
    role: 'assistant',
    createdAt: at,
    parts: [
      { type: 'reasoning', text: 'I should call the tool.' },
      { type: 'text', text: 'Adding it.' },
      { type: 'tool_call', id: 't1', name: 'add_task', input: { title: 'x' } },
    ],
  },
  { id: '3', role: 'tool', createdAt: at, parts: [{ type: 'tool_result', toolCallId: 't1', name: 'add_task', output: '{"id":1}' }] },
  { id: '4', role: 'assistant', createdAt: at, parts: [{ type: 'text', text: 'Done.' }] },
];

describe('Anthropic conversion', () => {
  it('maps tool calls and results, dropping other providers reasoning', () => {
    expect(toAnthropicMessages(conversation)).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Add a task' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Adding it.' },
          { type: 'tool_use', id: 't1', name: 'add_task', input: { title: 'x' } },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"id":1}', is_error: undefined }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
    ]);
  });

  it('replays its own native content unchanged (thinking blocks included)', () => {
    const native = [{ type: 'thinking', thinking: 'secret', signature: 'sig' }, { type: 'text', text: 'Hi' }];
    const messages: Message[] = [
      { id: '1', role: 'user', createdAt: at, parts: [{ type: 'text', text: 'Hi' }] },
      { id: '2', role: 'assistant', createdAt: at, parts: [{ type: 'text', text: 'Hi' }], native: { provider: 'anthropic', data: native } },
    ];
    expect(toAnthropicMessages(messages)[1]).toEqual({ role: 'assistant', content: native });
  });

  it('merges consecutive user turns and answers orphaned tool calls', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', createdAt: at, parts: [{ type: 'text', text: 'a' }] },
      { id: '2', role: 'assistant', createdAt: at, parts: [{ type: 'tool_call', id: 't9', name: 'x', input: {} }] },
      { id: '3', role: 'user', createdAt: at, parts: [{ type: 'text', text: 'b' }] },
    ];
    const out = toAnthropicMessages(messages);
    expect(out).toHaveLength(3);
    expect(out[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 't9', content: 'This tool call was not run.', is_error: true },
        { type: 'text', text: 'b' },
      ],
    });
  });

  it('knows which models take adaptive thinking', () => {
    for (const m of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1', 'claude-opus-4-6', 'claude-opus-5']) {
      expect(supportsAdaptiveThinking(m), m).toBe(true);
    }
    for (const m of ['claude-haiku-4-5', 'claude-opus-4-5', 'claude-sonnet-4-5-20250929', 'claude-3-5-sonnet', 'gpt-5']) {
      expect(supportsAdaptiveThinking(m), m).toBe(false);
    }
  });
});

describe('Chat Completions conversion', () => {
  it('maps the conversation to OpenAI messages', () => {
    expect(toChatMessages('Be brief.', conversation)).toEqual([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Add a task' },
      {
        role: 'assistant',
        content: 'Adding it.',
        tool_calls: [{ id: 't1', type: 'function', function: { name: 'add_task', arguments: '{"title":"x"}' } }],
      },
      { role: 'tool', tool_call_id: 't1', content: '{"id":1}' },
      { role: 'assistant', content: 'Done.' },
    ]);
  });
});

describe('attachments', () => {
  const png = Buffer.from('fake-png').toString('base64');
  const pdf = Buffer.from('%PDF-1.4').toString('base64');
  const notes = Buffer.from('line one\nline two').toString('base64');
  const message: Message = {
    id: 'u',
    role: 'user',
    createdAt: at,
    parts: [
      { type: 'file', name: 'photo.png', mediaType: 'image/png', data: png },
      { type: 'file', name: 'report.pdf', mediaType: 'application/pdf', data: pdf },
      { type: 'file', name: 'notes.md', mediaType: 'text/markdown', data: notes },
      { type: 'text', text: 'What is in these?' },
    ],
  };

  it('sends images and PDFs to Claude as blocks, and text files as text', () => {
    const [user] = toAnthropicMessages([message]);
    expect(user!.content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } },
      { type: 'document', title: 'report.pdf', source: { type: 'base64', media_type: 'application/pdf', data: pdf } },
      { type: 'text', text: '<file name="notes.md">\nline one\nline two\n</file>\n\nWhat is in these?' },
    ]);
  });

  it('sends images as data URLs and PDFs as files to OpenAI-style providers', () => {
    const [, user] = toChatMessages('sys', [message]);
    expect(user).toEqual({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } },
        { type: 'file', file: { filename: 'report.pdf', file_data: `data:application/pdf;base64,${pdf}` } },
        { type: 'text', text: '<file name="notes.md">\nline one\nline two\n</file>\n\nWhat is in these?' },
      ],
    });
  });
});
