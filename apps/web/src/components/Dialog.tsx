import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Close } from './Icons';

/** Open dialogs, oldest first. */
const open: object[] = [];

/**
 * A modal dialog: closes on Escape or a click on the backdrop. Rendered at the end of the
 * page, so a dialog opened from inside another one is not clipped by it.
 */
export function Dialog({ title, onClose, children, small }: { title?: string; onClose(): void; children: ReactNode; small?: boolean }) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    // Escape closes only the dialog on top.
    const self = {};
    open.push(self);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && open.at(-1) === self && close.current();
    document.addEventListener('keydown', onKey);
    return () => {
      open.splice(open.indexOf(self), 1);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  return createPortal(
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
    </div>,
    document.body,
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
