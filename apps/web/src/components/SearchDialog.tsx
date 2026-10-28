import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { relativeDate } from '../lib';
import { useApp } from '../store';
import { Dialog } from './Dialog';
import { NewChat, Search } from './Icons';

/** Find a chat by its title. Arrow keys move, Enter opens. */
export function SearchDialog() {
  const { sessions, setDialog } = useApp();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const close = () => setDialog(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? sessions.filter((s) => (s.title ?? '').toLowerCase().includes(q)) : sessions.slice(0, 12);
  }, [query, sessions]);

  const open = (path: string) => {
    close();
    navigate(path);
  };

  return (
    <Dialog onClose={close}>
      <label className="search-input">
        <Search />
        <span className="sr-only">Search chats</span>
        <input
          autoFocus
          placeholder="Search chats…"
          value={query}
          onChange={(e) => (setQuery(e.target.value), setSelected(0))}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setSelected((i) => Math.min(i + 1, results.length - 1)));
            if (e.key === 'ArrowUp') (e.preventDefault(), setSelected((i) => Math.max(i - 1, 0)));
            if (e.key === 'Enter' && results[selected]) open(`/c/${results[selected].id}`);
          }}
        />
      </label>
      <div className="search-results" role="listbox" aria-label="Chats">
        {!query && (
          <button className="menu-item" onClick={() => open('/')}>
            <NewChat size={16} />
            New chat
          </button>
        )}
        {results.map((s, i) => (
          <button
            key={s.id}
            role="option"
            aria-selected={i === selected}
            className={`menu-item ${i === selected ? 'focused' : ''}`}
            onMouseEnter={() => setSelected(i)}
            onClick={() => open(`/c/${s.id}`)}
          >
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title || 'New chat'}</span>
            <span className="when">{relativeDate(s.updatedAt)}</span>
          </button>
        ))}
        {query && !results.length && <p className="side-empty">No chats match “{query}”.</p>}
      </div>
    </Dialog>
  );
}
