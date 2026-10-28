import { memo, useState, type MouseEvent } from 'react';
import { pretty, renderMarkdown, summarize, textOf, type Message } from '../lib';
import { useApp } from '../store';
import { Bang, Brain, Check, Chevron, Copy, Edit, FileIcon, Retry, Right, Shield, Tick } from './Icons';

export type Turn = { kind: 'user'; message: Message } | { kind: 'assistant'; messages: Message[] };
export type Results = Map<string, { output: string; isError?: boolean }>;
export interface Live {
  text: string;
  reasoning: string;
}

/** A conversation as turns: each user message, then everything the assistant did in reply. */
export function buildTurns(messages: Message[]): Turn[] {
  const turns: Turn[] = [];
  for (const m of messages) {
    const last = turns.at(-1);
    if (m.role === 'user') turns.push({ kind: 'user', message: m });
    else if (last?.kind === 'assistant') last.messages.push(m);
    else turns.push({ kind: 'assistant', messages: [m] });
  }
  return turns;
}

export function resultsOf(messages: Message[]): Results {
  const map: Results = new Map();
  for (const m of messages) for (const p of m.parts) if (p.type === 'tool_result') map.set(p.toolCallId, p);
  return map;
}

function useCopy() {
  const { toast } = useApp();
  const [copied, setCopied] = useState(false);
  return {
    copied,
    copy(text: string) {
      void navigator.clipboard.writeText(text).then(
        () => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        },
        () => toast('Copy failed'),
      );
    },
  };
}

/** Rendered Markdown. The code blocks' Copy buttons work through one delegated click handler. */
export const Markdown = memo(function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('.code-copy');
    const code = button?.closest('.code')?.querySelector('pre')?.textContent;
    if (!button || code == null) return;
    void navigator.clipboard.writeText(code).then(() => {
      button.textContent = 'Copied';
      setTimeout(() => (button.textContent = 'Copy'), 1500);
    });
  };
  return <div className={`md ${streaming ? 'caret' : ''}`} onClick={onClick} dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
});

function Thought({ text, active }: { text: string; active?: boolean }) {
  return (
    <details className="thought" open={active}>
      <summary>
        <Right size={14} />
        {active ? 'Thinking…' : 'Thought process'}
      </summary>
      <div className="text">{text}</div>
    </details>
  );
}

export interface Approvals {
  /** Tool calls waiting for the user's decision. */
  asking: Set<string>;
  decide(callId: string, approved: boolean, always?: boolean): void;
}

/** MCP tools are named server__tool; show them as "server › tool". */
const displayName = (name: string) => name.replace('__', ' › ');

function ApprovalPrompt({ call, approvals }: { call: { id: string; name: string; input: unknown }; approvals: Approvals }) {
  return (
    <div className="approval" role="group" aria-label={`Approve ${displayName(call.name)}`}>
      <div className="approval-q">
        <Shield size={16} />
        <span>
          Allow <b>{displayName(call.name)}</b> to run?
        </span>
      </div>
      <pre>{pretty(call.input)}</pre>
      <div className="approval-actions">
        <button className="btn" onClick={() => approvals.decide(call.id, false)}>
          Deny
        </button>
        <span className="spacer" />
        <button className="btn" onClick={() => approvals.decide(call.id, true, true)}>
          Always allow in this chat
        </button>
        <button className="btn primary" autoFocus onClick={() => approvals.decide(call.id, true)}>
          Allow
        </button>
      </div>
    </div>
  );
}

function ToolCalls({ calls, results, approvals }: { calls: { id: string; name: string; input: unknown }[]; results: Results; approvals?: Approvals }) {
  return (
    <div className="tools">
      {calls.map((c) => {
        const r = results.get(c.id);
        if (!r && approvals?.asking.has(c.id)) return <ApprovalPrompt key={c.id} call={c} approvals={approvals} />;
        return (
          <details key={c.id} className="tool">
            <summary>
              {!r ? (
                <span className="status running" aria-label="Running" />
              ) : r.isError ? (
                <span className="status error" aria-label="Failed">
                  <Bang />
                </span>
              ) : (
                <span className="status ok" aria-label="Done">
                  <Tick />
                </span>
              )}
              <span className="tool-name">{displayName(c.name)}</span>
              <span className="tool-sum">{summarize(c.input)}</span>
              <span className="chev">
                <Chevron size={15} />
              </span>
            </summary>
            <div className="tool-body">
              <span className="label">Input</span>
              <pre>{pretty(c.input)}</pre>
              {r && (
                <>
                  <span className="label">{r.isError ? 'Error' : 'Output'}</span>
                  <pre>{pretty(r.output)}</pre>
                </>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}

export function UserTurn({ message, busy, onEdit }: { message: Message; busy: boolean; onEdit(text: string): void }) {
  const [editing, setEditing] = useState(false);
  const text = textOf(message.parts);
  const context = message.parts.flatMap((p) => (p.type === 'context' ? [p.label] : []));
  const files = message.parts.flatMap((p) => (p.type === 'file' ? [p] : []));
  const { copied, copy } = useCopy();

  if (editing) {
    return (
      <div className="user-turn" style={{ width: '100%', alignItems: 'flex-end' }}>
        <form
          className="edit-box"
          onSubmit={(e) => {
            e.preventDefault();
            const next = new FormData(e.currentTarget).get('text')?.toString().trim();
            if (next) onEdit(next);
            setEditing(false);
          }}
        >
          <label className="sr-only" htmlFor={`edit-${message.id}`}>
            Edit message
          </label>
          <textarea id={`edit-${message.id}`} name="text" defaultValue={text} autoFocus rows={3}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false);
              if (e.key === 'Enter' && !e.shiftKey) (e.preventDefault(), e.currentTarget.form?.requestSubmit());
            }}
          />
          <div className="row">
            <button type="button" className="btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="submit" className="btn primary">
              Send
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="user-turn">
      {context.length > 0 && <span className="tool-sum">With {context.join(', ')}</span>}
      {files.length > 0 && (
        <div className="sent-files">
          {files.map((f, i) =>
            f.mediaType.startsWith('image/') ? (
              <a key={i} href={`data:${f.mediaType};base64,${f.data}`} target="_blank" rel="noreferrer" title={f.name}>
                <img src={`data:${f.mediaType};base64,${f.data}`} alt={f.name} />
              </a>
            ) : (
              <span key={i} className="attachment">
                <span className="file-tile">
                  <FileIcon size={16} />
                </span>
                <span className="file-name">{f.name}</span>
              </span>
            ),
          )}
        </div>
      )}
      <div className="bubble">{text}</div>
      <div className="actions">
        <button className="icon-btn small" title="Copy" aria-label="Copy message" onClick={() => copy(text)}>
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
        {!message.id.startsWith('pending') && (
          <button className="icon-btn small" title="Edit" aria-label="Edit message" disabled={busy} onClick={() => setEditing(true)}>
            <Edit size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

interface AssistantProps {
  messages: Message[];
  results: Results;
  live?: Live | null;
  streaming: boolean;
  last: boolean;
  busy: boolean;
  modelLabel(id?: string): string;
  onRetry(): void;
  approvals?: Approvals;
}

export function AssistantTurn({ messages, results, live, streaming, last, busy, modelLabel, onRetry, approvals }: AssistantProps) {
  const { copied, copy } = useCopy();
  const assistant = messages.filter((m) => m.role === 'assistant');
  const fullText = [...assistant.map((m) => textOf(m.parts)), live?.text ?? ''].filter(Boolean).join('\n\n');
  const notes = assistant.flatMap((m) =>
    m.parts.flatMap((p) => (p.type === 'tool_call' && p.name === 'remember' && results.get(p.id) && !results.get(p.id)!.isError ? [summarize(p.input)] : [])),
  );
  const running = assistant.some((m) => m.parts.some((p) => p.type === 'tool_call' && !results.has(p.id)));
  const waiting = streaming && !live?.text && !live?.reasoning && !running;

  return (
    <div className={`assistant-turn ${last ? 'last' : ''}`}>
      {assistant.map((m) => {
        const reasoning = textOf(m.parts, 'reasoning');
        const text = textOf(m.parts);
        const calls = m.parts.flatMap((p) => (p.type === 'tool_call' ? [p] : []));
        return (
          <div key={m.id} style={{ display: 'contents' }}>
            {reasoning && <Thought text={reasoning} />}
            {text && <Markdown text={text} />}
            {calls.length > 0 && <ToolCalls calls={calls} results={results} approvals={approvals} />}
          </div>
        );
      })}
      {live?.reasoning && <Thought text={live.reasoning} active={!live.text} />}
      {live?.text && <Markdown text={live.text} streaming />}
      {waiting && (
        <div className="thinking" role="status">
          <span className="orb" />
          Thinking…
        </div>
      )}
      {notes.map((n, i) => (
        <div key={i} className="note">
          <Brain size={14} />
          <span>Saved to memory: {n}</span>
        </div>
      ))}
      {!streaming && fullText && (
        <div className="actions">
          <button className="icon-btn small" title="Copy" aria-label="Copy reply" onClick={() => copy(fullText)}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
          {last && (
            <button className="icon-btn small" title="Retry" aria-label="Retry" disabled={busy} onClick={onRetry}>
              <Retry size={16} />
            </button>
          )}
          <span className="model-tag">{modelLabel(assistant.at(-1)?.model)}</span>
        </div>
      )}
    </div>
  );
}
