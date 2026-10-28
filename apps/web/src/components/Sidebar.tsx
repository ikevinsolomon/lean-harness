import { useCallback, useState } from 'react';
import { Link, useMatch, useNavigate } from 'react-router';
import { api, groupByDate, mod, type SessionSummary } from '../lib';
import { useApp } from '../store';
import { ConfirmDialog } from './Dialog';
import { Brain, Edit, More, NewChat, Search, Settings, Sidebar as SidebarIcon, Trash } from './Icons';
import { Popover } from './Popover';

function ChatRow({ session, active }: { session: SessionSummary; active: boolean }) {
  const { refreshSessions, setDrawer, toast } = useApp();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const close = useCallback(() => setMenu(false), []);
  const title = session.title || 'New chat';

  const rename = async (value: string) => {
    setRenaming(false);
    const next = value.trim();
    if (!next || next === title) return;
    await api.rename(session.id, next).catch(() => toast('Could not rename'));
    await refreshSessions();
  };

  const remove = async () => {
    setConfirming(false);
    await api.deleteSession(session.id).catch(() => toast('Could not delete'));
    if (active) navigate('/');
    await refreshSessions();
  };

  return (
    <div className={`chat-row ${active ? 'active' : ''} ${menu ? 'menu-open' : ''}`}>
      {renaming ? (
        <input
          className="rename-input"
          aria-label="Chat name"
          defaultValue={title}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => rename(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setRenaming(false);
          }}
        />
      ) : (
        <Link className="chat-link" to={`/c/${session.id}`} aria-current={active ? 'page' : undefined} onClick={() => setDrawer(false)} title={title}>
          {title}
        </Link>
      )}
      {!renaming && (
        <button className="icon-btn small row-menu-btn" aria-label={`Options for ${title}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
          <More size={16} />
        </button>
      )}
      {menu && (
        <Popover label="Chat options" onClose={close} style={{ top: 34, right: 0, minWidth: 180 }}>
          <button className="menu-item" role="menuitem" onClick={() => (close(), setRenaming(true))}>
            <Edit size={16} />
            Rename
          </button>
          <button className="menu-item danger" role="menuitem" onClick={() => (close(), setConfirming(true))}>
            <Trash size={16} />
            Delete
          </button>
        </Popover>
      )}
      {confirming && (
        <ConfirmDialog
          title="Delete chat?"
          body={`"${title}" will be deleted for good.`}
          confirm="Delete"
          onConfirm={remove}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

export function Sidebar() {
  const { sessions, hasMemory, setDialog, setDrawer, toggleSidebar } = useApp();
  const match = useMatch('/c/:id');

  return (
    <aside className="sidebar" aria-label="Chats">
      <div className="side-top">
        <Link className="brand" to="/" onClick={() => setDrawer(false)}>
          <img src="/logo.svg" alt="" />
          <span>Lean Harness</span>
        </Link>
        <button className="icon-btn" title={`Close sidebar (${mod} B)`} aria-label="Close sidebar" onClick={toggleSidebar}>
          <SidebarIcon />
        </button>
      </div>
      <nav className="side-actions" aria-label="Actions">
        <Link className="side-action primary" to="/" onClick={() => setDrawer(false)}>
          <NewChat size={17} />
          New chat
          <span className="kbd">{mod} ⇧ O</span>
        </Link>
        <button className="side-action" onClick={() => (setDrawer(false), setDialog('search'))}>
          <Search size={17} />
          Search chats
          <span className="kbd">{mod} K</span>
        </button>
      </nav>
      <div className="history">
        {sessions.length ? (
          groupByDate(sessions).map(([label, group]) => (
            <section key={label} aria-label={label}>
              <div className="group-label">{label}</div>
              {group.map((s) => (
                <ChatRow key={s.id} session={s} active={match?.params.id === s.id} />
              ))}
            </section>
          ))
        ) : (
          <p className="side-empty">Your chats will show up here.</p>
        )}
      </div>
      <div className="side-foot">
        <span className="memory-badge">
          {hasMemory && (
            <>
              <Brain size={15} />
              Memory on
            </>
          )}
        </span>
        <button className="icon-btn" title="Settings" aria-label="Settings" onClick={() => (setDrawer(false), setDialog('settings'))}>
          <Settings />
        </button>
      </div>
    </aside>
  );
}
