import { useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { useApp } from '../store';
import { Close, Clip, FileIcon, Send, Stop } from './Icons';

export interface Attachment {
  name: string;
  mediaType: string;
  /** Base64 content. */
  data: string;
}

interface Props {
  busy: boolean;
  placeholder: string;
  onSend(text: string, files: Attachment[]): void;
  onStop(): void;
  autoFocus?: boolean;
}

const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,application/pdf,text/*,.md,.csv,.json,.ts,.tsx,.js,.py,.yaml,.yml';
const MAX_BYTES = 10 * 1024 * 1024;

/** Some text files arrive without a type (.md, .ts...); treat known extensions as text. */
function mediaTypeOf(file: File) {
  if (file.type) return file.type;
  return /\.(md|txt|csv|ts|tsx|js|jsx|py|go|rs|java|rb|sh|yaml|yml|toml|sql|html|css)$/i.test(file.name) ? 'text/plain' : 'application/octet-stream';
}

function read(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, mediaType: mediaTypeOf(file), data: String(reader.result).split(',')[1] ?? '' });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * The message box: Enter sends, Shift+Enter adds a line, Escape stops a reply. It grows
 * with its text. Files can be attached with the paperclip, dropped on it, or pasted.
 */
export function Composer({ busy, placeholder, onSend, onStop, autoFocus }: Props) {
  const { toast } = useApp();
  const [text, setText] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    const area = ref.current;
    if (!area) return;
    area.style.height = 'auto';
    area.style.height = `${area.scrollHeight}px`;
  }, [text]);

  useLayoutEffect(() => {
    if (autoFocus && matchMedia('(hover: hover)').matches) ref.current?.focus();
  }, [autoFocus]);

  const add = async (list: FileList | File[]) => {
    const chosen = [...list];
    const tooBig = chosen.filter((f) => f.size > MAX_BYTES);
    if (tooBig.length) toast(`${tooBig[0]!.name} is larger than 10 MB`);
    const read_ = await Promise.all(chosen.filter((f) => f.size <= MAX_BYTES).map(read));
    setFiles((current) => [...current, ...read_].slice(0, 10));
  };

  const submit = () => {
    if ((!text.trim() && !files.length) || busy) return;
    onSend(text.trim() || 'Please look at the attached file.', files);
    setText('');
    setFiles([]);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) void add(e.dataTransfer.files);
  };

  const onPaste = (e: ClipboardEvent) => {
    const pasted = [...e.clipboardData.files];
    if (pasted.length) {
      e.preventDefault();
      void add(pasted);
    }
  };

  return (
    <form
      className={`composer ${dragging ? 'dragging' : ''}`}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onDragOver={(e) => (e.preventDefault(), setDragging(true))}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {files.length > 0 && (
        <div className="attachments">
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} className="attachment">
              {f.mediaType.startsWith('image/') ? (
                <img src={`data:${f.mediaType};base64,${f.data}`} alt="" />
              ) : (
                <span className="file-tile">
                  <FileIcon size={16} />
                </span>
              )}
              <span className="file-name" title={f.name}>
                {f.name}
              </span>
              <button type="button" className="remove" aria-label={`Remove ${f.name}`} onClick={() => setFiles((all) => all.filter((_, j) => j !== i))}>
                <Close size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
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
        onPaste={onPaste}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
          if (e.key === 'Escape' && busy) onStop();
        }}
      />
      <div className="bar">
        <button type="button" className="icon-btn small attach" title="Attach files" aria-label="Attach files" onClick={() => picker.current?.click()}>
          <Clip size={17} />
        </button>
        <input
          ref={picker}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            if (e.target.files) void add(e.target.files);
            e.target.value = '';
          }}
        />
        <span className="hint">{busy ? 'Writing… Esc to stop' : ''}</span>
        {busy ? (
          <button type="button" className="send stop" aria-label="Stop" onClick={onStop}>
            <Stop />
          </button>
        ) : (
          <button type="submit" className="send" aria-label="Send" disabled={!text.trim() && !files.length}>
            <Send size={17} />
          </button>
        )}
      </div>
    </form>
  );
}
