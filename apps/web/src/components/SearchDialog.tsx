import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { SearchResult } from '@lean-harness/widget/client';
import { api, relativeDate } from '../lib';
import { useApp } from '../store';
import { Dialog } from './Dialog';
import { NewChat, Search } from './Icons';

interface Row {
  id: string;
  title: string;
  detail?: string;
  when?: string;
}

/** Find a chat by its title or by something said in it. Arrow keys move, Enter opens. */
export function SearchDialog() {
  const { sessions, setDialog } = useApp();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState(0);
  const close = () => setDialog(null);

  // Search message text on the server, shortly after typing stops.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return setHits([]);
    const timer = setTimeout(() => api.search(q).then((r) => setHits(r.results), () => setHits([])), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const byTitle = (q ? sessions.filter((s) => (s.title ?? '').toLowerCase().includes(q)) : sessions.slice(0, 12)).map((s) => ({
      id: s.id,
      title: s.title || 'New chat',
      when: relativeDate(s.updatedAt),
    }));
    const seen = new Set(byTitle.map((r) => r.id));
    const byText = hits.filter((h) => !seen.has(h.sessionId)).map((h) => ({ id: h.sessionId, title: h.title || 'New chat', detail: h.snippet }));
    return [...byTitle, ...byText];
  }, [query, sessions, hits]);

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
          placeholder="Search chats and messages…"
          value={query}
          onChange={(e) => (setQuery(e.target.value), setSelected(0))}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setSelected((i) => Math.min(i + 1, rows.length - 1)));
            if (e.key === 'ArrowUp') (e.preventDefault(), setSelected((i) => Math.max(i - 1, 0)));
            if (e.key === 'Enter' && rows[selected]) open(`/c/${rows[selected].id}`);
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
        {rows.map((r, i) => (
          <button
            key={`${r.id}-${i}`}
            role="option"
            aria-selected={i === selected}
            className={`menu-item ${i === selected ? 'focused' : ''}`}
            onMouseEnter={() => setSelected(i)}
            onClick={() => open(`/c/${r.id}`)}
          >
            <span style={{ minWidth: 0, flex: 1 }}>
              <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
              {r.detail && <span className="sub snippet">{r.detail}</span>}
            </span>
            {r.when && <span className="when">{r.when}</span>}
          </button>
        ))}
        {query.trim().length >= 2 && !rows.length && <p className="side-empty">Nothing matches “{query}”.</p>}
      </div>
    </Dialog>
  );
}
