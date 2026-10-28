import { useEffect, type ReactNode } from 'react';
import { Close } from './Icons';

/** A modal dialog: closes on Escape or a click on the backdrop. */
export function Dialog({ title, onClose, children, small }: { title?: string; onClose(): void; children: ReactNode; small?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${small ? 'small' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        {title && (
          <div className="dialog-head">
            <h2>{title}</h2>
            <button className="icon-btn small" aria-label="Close" onClick={onClose}>
              <Close size={16} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog(props: { title: string; body: string; confirm: string; onConfirm(): void; onClose(): void }) {
  return (
    <Dialog title={props.title} onClose={props.onClose} small>
      <div className="dialog-body">
        <p>{props.body}</p>
        <div className="dialog-foot">
          <button className="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button className="btn danger" autoFocus onClick={props.onConfirm}>
            {props.confirm}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
