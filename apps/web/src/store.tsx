import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, isUnauthorized, safeStorage, type SessionSummary } from './lib';
import { ApiError, type AuthStatus, type ModelInfo, type User } from '@lean-harness/widget/client';

export type Theme = 'light' | 'dark' | 'system';

/**
 * What stands between the visitor and the app: nothing, creating the admin account
 * (fresh server), signing in with email and password, or pasting an access token
 * (servers that use tokens instead of built-in accounts).
 */
export type Gate = null | 'setup' | 'login' | 'token';

interface AppState {
  /** The signed-in user; null when the server has no sign-in. */
  user: User | null;
  gate: Gate;
  /** The server has built-in accounts (email and password, invites). */
  accounts: boolean;
  /** Token servers: try this access token. */
  signIn(token: string): Promise<boolean>;
  /** After a sign-in, setup or accepted invite: load the app for that user. */
  reload(): void;
  signOut(): Promise<void>;
  models: ModelInfo[];
  /** The model new chats start with: the user's choice, else the server's default. */
  defaultModel: string;
  setDefaultModel(model: string): void;
  hasMemory: boolean;
  sessions: SessionSummary[];
  refreshSessions(): Promise<void>;
  theme: Theme;
  setTheme(theme: Theme): void;
  collapsed: boolean;
  setCollapsed(value: boolean): void;
  drawer: boolean;
  setDrawer(value: boolean): void;
  /** Open the sidebar: a drawer on small screens, a column on wide ones. */
  toggleSidebar(): void;
  dialog: Dialog;
  setDialog(dialog: Dialog): void;
  toast(message: string): void;
  error: string;
}

type Dialog = 'search' | 'settings' | 'people' | null;

const Ctx = createContext<AppState | null>(null);

export function useApp() {
  const state = useContext(Ctx);
  if (!state) throw new Error('useApp must be used inside <AppProvider>');
  return state;
}

const small = () => matchMedia('(max-width: 768px)').matches;

function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [serverDefault, setServerDefault] = useState('');
  const [chosenDefault, setChosenDefault] = useState(() => safeStorage(() => localStorage.getItem('lh:model')) ?? '');
  const [hasMemory, setHasMemory] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [theme, setThemeState] = useState<Theme>(() => (safeStorage(() => localStorage.getItem('lh:theme')) as Theme) ?? 'light');
  const [collapsed, setCollapsedState] = useState(() => safeStorage(() => localStorage.getItem('lh:collapsed')) === '1');
  const [drawer, setDrawer] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toastText, setToastText] = useState('');
  const [error, setError] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [gate, setGate] = useState<Gate>(null);
  const [accounts, setAccounts] = useState(false);
  const [loaded, setLoaded] = useState(0);

  const refreshSessions = useCallback(async () => {
    try {
      setSessions((await api.listSessions()).sessions.filter((s) => s.messageCount > 0));
    } catch {
      // the list is a convenience; chats still work
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      // Servers without built-in accounts answer 404 (or 401 when they use tokens).
      const status = await api.authStatus().catch((e): AuthStatus | null => {
        if (e instanceof ApiError) return null;
        throw e;
      });
      setAccounts(Boolean(status));
      if (status?.setupRequired) return setGate('setup');
      if (status && !status.user) return setGate('login');
      const [me, m, t] = await Promise.all([api.me(), api.models(), api.tools()]);
      setUser(me.user);
      setGate(null);
      setError('');
      setModels(m.models);
      setServerDefault(m.defaultModel);
      setHasMemory(t.tools.some((tool) => tool.name === 'remember'));
      void refreshSessions();
    };
    load().catch((e) => (isUnauthorized(e) ? setGate((g) => g ?? 'token') : setError(`Can't reach the Lean Harness server at ${location.origin}.`)));
  }, [refreshSessions, loaded]);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const media = matchMedia('(prefers-color-scheme: dark)');
    const listener = () => applyTheme('system');
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [theme]);

  useEffect(() => {
    if (!toastText) return;
    const timer = setTimeout(() => setToastText(''), 1800);
    return () => clearTimeout(timer);
  }, [toastText]);

  const value = useMemo<AppState>(
    () => ({
      user,
      gate,
      accounts,
      reload: () => setLoaded((n) => n + 1),
      async signIn(token) {
        api.setToken(token);
        try {
          await api.me();
        } catch {
          api.setToken(safeStorage(() => localStorage.getItem('lh:token')) ?? undefined);
          return false;
        }
        safeStorage(() => localStorage.setItem('lh:token', token));
        setLoaded((n) => n + 1);
        return true;
      },
      async signOut() {
        if (accounts) await api.logout().catch(() => undefined);
        safeStorage(() => localStorage.removeItem('lh:token'));
        api.setToken(undefined);
        setSessions([]);
        setUser(null);
        setLoaded((n) => n + 1);
      },
      models,
      defaultModel: models.some((m) => m.id === chosenDefault) ? chosenDefault : serverDefault,
      setDefaultModel(model) {
        setChosenDefault(model);
        safeStorage(() => localStorage.setItem('lh:model', model));
      },
      hasMemory,
      sessions,
      refreshSessions,
      theme,
      setTheme(next) {
        setThemeState(next);
        safeStorage(() => localStorage.setItem('lh:theme', next));
      },
      collapsed,
      setCollapsed(next) {
        setCollapsedState(next);
        safeStorage(() => localStorage.setItem('lh:collapsed', next ? '1' : '0'));
      },
      drawer,
      setDrawer,
      toggleSidebar() {
        if (small()) setDrawer((d) => !d);
        else value.setCollapsed(!collapsed);
      },
      dialog,
      setDialog,
      toast: setToastText,
      error,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, gate, accounts, models, chosenDefault, serverDefault, hasMemory, sessions, refreshSessions, theme, collapsed, drawer, dialog, error],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {toastText && (
        <div className="toast" role="status">
          {toastText}
        </div>
      )}
    </Ctx.Provider>
  );
}
