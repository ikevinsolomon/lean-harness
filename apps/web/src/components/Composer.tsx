import { useLayoutEffect, useRef, useState } from 'react';
import { Send, Stop } from './Icons';

interface Props {
  busy: boolean;
  placeholder: string;
  onSend(text: string): void;
  onStop(): void;
  autoFocus?: boolean;
}

/** The message box: Enter sends, Shift+Enter adds a line, Escape stops a reply. It grows with its text. */
export function Composer({ busy, placeholder, onSend, onStop, autoFocus }: Props) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const area = ref.current;
    if (!area) return;
    area.style.height = 'auto';
    area.style.height = `${area.scrollHeight}px`;
  }, [text]);

  useLayoutEffect(() => {
    if (autoFocus && matchMedia('(hover: hover)').matches) ref.current?.focus();
  }, [autoFocus]);

  const submit = () => {
    if (!text.trim() || busy) return;
    onSend(text.trim());
    setText('');
  };

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor="composer-input" className="sr-only">
        Message
      </label>
      <textarea
        id="composer-input"
        ref={ref}
        rows={1}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
          if (e.key === 'Escape' && busy) onStop();
        }}
      />
      <div className="bar">
        <span className="hint">{busy ? 'Writing… Esc to stop' : ''}</span>
        {busy ? (
          <button type="button" className="send stop" aria-label="Stop" onClick={onStop}>
            <Stop />
          </button>
        ) : (
          <button type="submit" className="send" aria-label="Send" disabled={!text.trim()}>
            <Send size={17} />
          </button>
        )}
      </div>
    </form>
  );
}
