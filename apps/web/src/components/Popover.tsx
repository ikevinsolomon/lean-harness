import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

/** A floating panel that closes on Escape or a click outside, and moves focus with the arrow keys. */
export function Popover({ onClose, style, children, label }: { onClose(): void; style?: CSSProperties; children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current!;
    const items = () => [...el.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')];
    (items().find((i) => i.getAttribute('aria-checked') === 'true') ?? items()[0])?.focus();

    const onDown = (e: MouseEvent) => {
      if (!el.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const list = items();
        const at = list.indexOf(document.activeElement as HTMLElement);
        list[(at + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
      }
    };
    // Defer so the click that opened the popover doesn't close it.
    const timer = setTimeout(() => document.addEventListener('mousedown', onDown));
    el.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', onDown);
      el.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="popover" role="menu" aria-label={label} style={style}>
      {children}
    </div>
  );
}
