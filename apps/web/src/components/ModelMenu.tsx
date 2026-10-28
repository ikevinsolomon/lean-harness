import { useCallback, useState } from 'react';
import { PROVIDER_COLORS } from '../lib';
import { useApp } from '../store';
import { Check, Chevron } from './Icons';
import { Popover } from './Popover';

/** The model picker in the top bar: providers grouped, the current model checked. */
export function ModelMenu({ value, onChange, disabled }: { value: string; onChange(model: string): void; disabled?: boolean }) {
  const { models } = useApp();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const current = models.find((m) => m.id === value);
  const providers = [...new Set(models.map((m) => m.provider))];

  return (
    <div className="model-menu">
      <button className="model-btn" aria-haspopup="menu" aria-expanded={open} disabled={disabled || !models.length} onClick={() => setOpen(!open)}>
        <span className="dot" style={{ background: PROVIDER_COLORS[current?.provider ?? ''] ?? '#a1a1aa' }} />
        <span className="label">{current ? current.model : value || 'Loading…'}</span>
        <Chevron size={15} />
      </button>
      {open && (
        <Popover label="Choose a model" onClose={close} style={{ top: 44, left: 0 }}>
          {providers.map((provider) => {
            const group = models.filter((m) => m.provider === provider);
            return (
              <div key={provider}>
                <div className="popover-label">{group[0]?.label?.split(' · ')[0] ?? provider}</div>
                {group.map((m) => (
                  <button
                    key={m.id}
                    className="menu-item"
                    role="menuitemradio"
                    aria-checked={m.id === value}
                    onClick={() => {
                      onChange(m.id);
                      close();
                    }}
                  >
                    <span className="dot" style={{ background: PROVIDER_COLORS[m.provider] ?? '#a1a1aa' }} />
                    <span>{m.model}</span>
                    {m.id === value && (
                      <span className="check">
                        <Check size={16} />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            );
          })}
        </Popover>
      )}
    </div>
  );
}
