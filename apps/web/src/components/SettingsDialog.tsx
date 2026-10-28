import { mod } from '../lib';
import { useApp, type Theme } from '../store';
import { Dialog } from './Dialog';
import { Monitor, Moon, Sun } from './Icons';

const THEMES: { id: Theme; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor },
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
  const { theme, setTheme, models, defaultModel, setDefaultModel, setDialog } = useApp();
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
