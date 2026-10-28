import { useEffect, useState } from 'react';
import type { MemoryRecord } from '@lean-harness/widget/client';
import { api, mod, PROVIDER_COLORS } from '../lib';
import { useApp, type Theme } from '../store';
import { Dialog } from './Dialog';
import { Check, Monitor, Moon, Sun, Trash } from './Icons';

const THEMES: { id: Theme; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor },
];

/** Providers the server can use. A provider is connected when its key is in the server's .env. */
const PROVIDERS: { id: string; name: string; how: string }[] = [
  { id: 'anthropic', name: 'Anthropic (Claude)', how: 'ANTHROPIC_API_KEY' },
  { id: 'openai', name: 'OpenAI', how: 'OPENAI_API_KEY' },
  { id: 'deepseek', name: 'DeepSeek', how: 'DEEPSEEK_API_KEY' },
  { id: 'gemini', name: 'Google Gemini', how: 'GEMINI_API_KEY' },
  { id: 'openrouter', name: 'OpenRouter', how: 'OPENROUTER_API_KEY' },
  { id: 'ollama', name: 'Ollama (local models)', how: 'Run Ollama and pull a model' },
];

const SHORTCUTS: [string, string[]][] = [
  ['New chat', [mod, '⇧', 'O']],
  ['Search chats', [mod, 'K']],
  ['Show or hide the sidebar', [mod, 'B']],
  ['Send message', ['Enter']],
  ['New line', ['⇧', 'Enter']],
  ['Stop the reply', ['Esc']],
];

export function SettingsDialog() {
  const { theme, setTheme, models, defaultModel, setDefaultModel, setDialog, sessions, toast } = useApp();
  // null: the server does not expose memory (no memory store configured).
  const [memories, setMemories] = useState<MemoryRecord[] | null>(null);
  useEffect(() => {
    api.memories().then((r) => setMemories(r.memories), () => setMemories(null));
  }, []);
  const forget = async (id: string) => {
    await api.deleteMemory(id).catch(() => toast('Could not delete that memory'));
    setMemories((all) => all?.filter((m) => m.id !== id) ?? null);
  };
  const tokens = sessions.reduce((sum, s) => {
    const u = (s.metadata?.usage ?? {}) as Record<string, number | undefined>;
    return sum + (u.inputTokens ?? 0) + (u.outputTokens ?? 0) + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0);
  }, 0);
  return (
    <Dialog title="Settings" onClose={() => setDialog(null)}>
      <div className="dialog-body">
        <div className="setting">
          <div>
            <b>Appearance</b>
            <small>Light, dark, or follow your device</small>
          </div>
          <div className="segmented" role="group" aria-label="Appearance">
            {THEMES.map(({ id, label, icon: Icon }) => (
              <button key={id} aria-pressed={theme === id} onClick={() => setTheme(id)}>
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="setting">
          <div>
            <b>Default model</b>
            <small>New chats start with this model</small>
          </div>
          <select className="select" aria-label="Default model" value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label ?? m.id}
              </option>
            ))}
          </select>
        </div>
        {memories && (
          <div className="setting" style={{ display: 'block' }}>
            <b>Memory</b>
            <small>What the assistant remembers about you across chats. Delete anything that is wrong or private.</small>
            {memories.length ? (
              <ul className="memories">
                {[...memories].reverse().map((m) => (
                  <li key={m.id}>
                    <span>{m.text}</span>
                    <button className="icon-btn small" title="Forget" aria-label={`Forget: ${m.text}`} onClick={() => forget(m.id)}>
                      <Trash size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="side-empty" style={{ padding: '8px 0 0' }}>Nothing remembered yet.</p>
            )}
          </div>
        )}
        <div className="setting">
          <div>
            <b>Usage</b>
            <small>Tokens used across your chats</small>
          </div>
          <span className="usage">{tokens.toLocaleString()}</span>
        </div>
        <div className="setting" style={{ display: 'block' }}>
          <b>Providers</b>
          <small>The model menu lists models from connected providers. Connect one by adding its key to the server's .env and restarting it.</small>
          <ul className="providers">
            {PROVIDERS.map((p) => {
              const count = models.filter((m) => m.provider === p.id).length;
              return (
                <li key={p.id}>
                  <span className="dot" style={{ background: PROVIDER_COLORS[p.id] }} />
                  <span className="name">{p.name}</span>
                  {count ? (
                    <span className="connected">
                      <Check size={14} />
                      {count} {count === 1 ? 'model' : 'models'}
                    </span>
                  ) : (
                    <code className="how">{p.how}</code>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        <div className="setting" style={{ display: 'block' }}>
          <b>Keyboard shortcuts</b>
          <dl className="shortcuts">
            {SHORTCUTS.map(([what, keys]) => (
              <div key={what} style={{ display: 'contents' }}>
                <dt>{what}</dt>
                <dd>
                  {keys.map((k) => (
                    <span key={k} className="kbd">
                      {k}
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </Dialog>
  );
}
