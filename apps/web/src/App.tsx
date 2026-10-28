import { useEffect } from 'react';
import { useMatch, useNavigate } from 'react-router';
import { ChatView } from './components/ChatView';
import { SearchDialog } from './components/SearchDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { Sidebar } from './components/Sidebar';
import { isMac } from './lib';
import { useApp } from './store';

/**
 * The app shell: sidebar plus the chat. Routes are "/" (a new chat) and "/c/:id".
 * The chat view is not a routed element, so it survives the URL change when a
 * new chat gets its id mid-stream.
 */
export function App() {
  const { collapsed, drawer, setDrawer, dialog, setDialog, toggleSidebar } = useApp();
  const match = useMatch('/c/:id');
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const modKey = isMac ? e.metaKey : e.ctrlKey;
      if (!modKey) return;
      const key = e.key.toLowerCase();
      if (key === 'k') {
        e.preventDefault();
        setDialog(dialog === 'search' ? null : 'search');
      } else if (key === 'o' && e.shiftKey) {
        e.preventDefault();
        setDialog(null);
        navigate('/');
      } else if (key === 'b' && !e.shiftKey) {
        e.preventDefault();
        toggleSidebar();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dialog, navigate, setDialog, toggleSidebar]);

  return (
    <div className={`app ${collapsed ? 'collapsed' : ''} ${drawer ? 'drawer' : ''}`}>
      <Sidebar />
      <div className="scrim" onClick={() => setDrawer(false)} />
      <ChatView id={match?.params.id} />
      {dialog === 'search' && <SearchDialog />}
      {dialog === 'settings' && <SettingsDialog />}
    </div>
  );
}
