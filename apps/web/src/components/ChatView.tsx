import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ChatEvent, Session } from '@lean-harness/widget/client';
import { api, greeting, mod, textOf, type Message } from '../lib';
import { useApp } from '../store';
import { Composer, type Attachment } from './Composer';
import { Alert, Clock, Close, Down, Menu, NewChat, Sidebar as SidebarIcon, Spark, Wrench, Brain } from './Icons';
import { AssistantTurn, buildTurns, resultsOf, UserTurn, type Live, type Results } from './Messages';
import { ModelMenu } from './ModelMenu';

const SUGGESTIONS = [
  { title: 'What can you do?', detail: 'Tools, memory and models', icon: Spark },
  { title: 'How do I add a tool?', detail: 'From the built-in guide', icon: Wrench },
  { title: 'What time is it in Tokyo?', detail: 'Uses the clock tool', icon: Clock },
  { title: 'Remember I like short answers', detail: 'Saved to long-term memory', icon: Brain },
];

/** One conversation, or a new one when `id` is undefined. Streams replies over the HTTP API. */
export function ChatView({ id }: { id?: string }) {
  const app = useApp();
  const { models, defaultModel, refreshSessions, toggleSidebar } = app;
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [newModel, setNewModel] = useState('');
  const [live, setLive] = useState<Live | null>(null);
  const [liveResults, setLiveResults] = useState<Results>(new Map());
  const [asking, setAsking] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [atBottom, setAtBottom] = useState(true);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  /** The chat on screen, so a reply that finishes after the user moved on never overwrites another chat. */
  const viewing = useRef(id);
  viewing.current = id;

  // Load the conversation named in the URL (unless it is the one this view just created).
  useEffect(() => {
    if (!id) {
      abort.current?.abort();
      setSession(null);
      setError('');
      return;
    }
    if (session?.id === id) return;
    abort.current?.abort();
    setError('');
    let stale = false;
    api
      .getSession(id)
      .then((s) => {
        if (stale) return;
        setSession(s);
        stick.current = true;
        // Still replying (opened in another tab, or reloaded mid-reply): follow it live.
        if (s.running) void consume(s.id, (signal) => api.follow(s.id, { signal }));
      })
      .catch(() => !stale && (setSession(null), setError('This chat no longer exists.')));
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    document.title = session?.title ? `${session.title} · Lean Harness` : 'Lean Harness';
  }, [session?.title]);

  const messages = session?.messages ?? [];
  const model = session?.model ?? (newModel || defaultModel);
  const turns = useMemo(() => buildTurns(messages), [messages]);
  const results = useMemo(() => {
    const map = resultsOf(messages);
    for (const [k, v] of liveResults) map.set(k, v);
    return map;
  }, [messages, liveResults]);

  // Follow the reply while the reader is at the bottom; leave them alone if they scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (stick.current) el.scrollTop = el.scrollHeight;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  }, [messages, live]);

  const onScroll = () => {
    const el = scroller.current!;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stick.current = bottom;
    setAtBottom(bottom);
  };

  const scrollDown = () => {
    stick.current = true;
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  };

  const apply = useCallback((event: ChatEvent) => {
    switch (event.type) {
      case 'message':
        setSession((s) => {
          // A replayed turn repeats messages we already have; keep one copy.
          if (!s || s.messages.some((m) => m.id === event.message.id)) return s;
          const list = s.messages.filter((m) => !(event.message.role === 'user' && m.id === 'pending'));
          return { ...s, messages: [...list, event.message] };
        });
        if (event.message.role === 'assistant') setLive(null);
        break;
      case 'text_delta':
        setLive((l) => ({ text: (l?.text ?? '') + event.text, reasoning: l?.reasoning ?? '' }));
        break;
      case 'reasoning_delta':
        setLive((l) => ({ text: l?.text ?? '', reasoning: (l?.reasoning ?? '') + event.text }));
        break;
      case 'approval_request':
        setAsking((a) => new Set(a).add(event.id));
        break;
      case 'tool_result':
        setLiveResults((r) => new Map(r).set(event.id, { output: event.output, isError: event.isError }));
        setAsking((a) => {
          const next = new Set(a);
          next.delete(event.id);
          return next;
        });
        break;
      case 'turn_end':
        if (event.stopReason === 'max_steps') setError('Stopped after too many steps.');
        if (event.stopReason === 'refusal') setError('The model declined this request.');
        break;
      case 'error':
        setError(event.message);
        break;
    }
  }, []);

  /** Show a reply as it streams. Used for a new message and to reconnect to one already running. */
  async function consume(sessionId: string, events: (signal: AbortSignal) => AsyncIterable<ChatEvent>) {
    setError('');
    setBusy(true);
    stick.current = true;
    const controller = new AbortController();
    abort.current = controller;
    try {
      for await (const event of events(controller.signal)) apply(event);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof TypeError ? 'Lost the connection to the server.' : (e as Error).message);
    } finally {
      if (abort.current === controller) {
        setBusy(false);
        setLive(null);
        setLiveResults(new Map());
        setAsking(new Set());
      }
      // The server holds the truth: reload so stopped or failed turns show exactly what was saved.
      if (viewing.current === sessionId) {
        api.getSession(sessionId).then((s) => viewing.current === s.id && setSession(s), () => undefined);
      }
      void refreshSessions();
    }
  }

  const send = async (text: string, replaceFrom?: string, files: Attachment[] = []) => {
    if (busy) return;
    let current = session;
    try {
      if (!current) {
        current = await api.createSession(model || undefined);
        viewing.current = current.id;
        navigate(`/c/${current.id}`);
      }
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    const keep = replaceFrom ? current.messages.findIndex((m) => m.id === replaceFrom) : -1;
    const pending: Message = {
      id: 'pending',
      role: 'user',
      parts: [...files.map((f) => ({ type: 'file' as const, ...f })), { type: 'text', text }],
    };
    setSession({ ...current, messages: [...(keep >= 0 ? current.messages.slice(0, keep) : current.messages), pending] });
    const sid = current.id;
    await consume(sid, (signal) => api.send(sid, text, { replaceFrom, files, signal }));
  };

  // Replies run on the server, so stopping is a request; closing the stream alone would not stop it.
  const stop = () => {
    if (session) api.stop(session.id).catch(() => undefined);
    abort.current?.abort();
  };

  const approvals = {
    asking,
    decide(callId: string, approved: boolean, always = false) {
      if (!session) return;
      setAsking((a) => {
        const next = new Set(a);
        next.delete(callId);
        return next;
      });
      api.decide(session.id, callId, approved, always).catch(() => setError('That approval expired. Ask again to retry.'));
    },
  };

  const changeModel = async (next: string) => {
    if (!session) return setNewModel(next);
    setSession({ ...session, model: next });
    await api.setModel(session.id, next).catch(() => setError('Could not switch the model.'));
  };

  const modelLabel = (mid?: string) => models.find((m) => m.id === mid)?.model ?? mid?.split('/').slice(1).join('/') ?? '';

  // Retry: send the last question again, replacing the answer it got.
  const retry = () => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUser) void send(textOf(lastUser.parts), lastUser.id);
  };

  // Esc stops a reply from anywhere on the page.
  useEffect(() => {
    if (!busy) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.overlay, .popover') && stop();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy]);

  const topbar = (
    <header className="topbar">
      <button className="icon-btn mobile-only" aria-label="Open sidebar" onClick={toggleSidebar}>
        <Menu />
      </button>
      <button className="icon-btn collapsed-only" title={`Open sidebar (${mod} B)`} aria-label="Open sidebar" onClick={toggleSidebar}>
        <SidebarIcon />
      </button>
      <button className="icon-btn collapsed-only" title={`New chat (${mod} ⇧ O)`} aria-label="New chat" onClick={() => navigate('/')}>
        <NewChat />
      </button>
      <ModelMenu value={model} onChange={changeModel} disabled={busy} />
      <span className="spacer" />
      {session?.title && <span className="topbar-title">{session.title}</span>}
      <button className="icon-btn mobile-only" aria-label="New chat" onClick={() => navigate('/')}>
        <NewChat />
      </button>
    </header>
  );

  const banner = (error || app.error) && (
    <div className="banner" role="alert">
      <Alert size={17} />
      <span>{error || app.error}</span>
      {error && (
        <button className="icon-btn small" aria-label="Dismiss" onClick={() => setError('')}>
          <Close size={14} />
        </button>
      )}
    </div>
  );

  if (!messages.length && !id) {
    return (
      <main className="main">
        {topbar}
        <div className="hero">
          <div className="column">
            <div className="hero-head">
              <img className="hero-mark" src="/logo.svg" alt="" />
              <h1>
                {greeting()}
                <span className="soft">How can I help you today?</span>
              </h1>
            </div>
            {banner}
            <div className="composer-wrap">
              <Composer busy={busy} placeholder="Ask Lean Harness anything…" onSend={(t, files) => send(t, undefined, files)} onStop={stop} autoFocus />
            </div>
            <div className="cards">
              {SUGGESTIONS.map(({ title, detail, icon: Icon }) => (
                <button key={title} className="card" onClick={() => send(title)}>
                  <span className="tile">
                    <Icon size={18} />
                  </span>
                  <span>
                    <b>{title}</b>
                    <small>{detail}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="main">
      {topbar}
      <div className="scroller" ref={scroller} onScroll={onScroll}>
        <div className="column thread">
          {turns.map((turn, i) =>
            turn.kind === 'user' ? (
              <UserTurn key={turn.message.id} message={turn.message} busy={busy} onEdit={(text) => send(text, turn.message.id)} />
            ) : (
              <AssistantTurn
                key={turn.messages[0]!.id}
                messages={turn.messages}
                results={results}
                live={i === turns.length - 1 ? live : null}
                streaming={busy && i === turns.length - 1}
                last={i === turns.length - 1}
                busy={busy}
                modelLabel={modelLabel}
                onRetry={retry}
                approvals={approvals}
              />
            ),
          )}
          {busy && turns.at(-1)?.kind === 'user' && (
            <AssistantTurn messages={[]} results={results} live={live} streaming last busy modelLabel={modelLabel} onRetry={retry} />
          )}
        </div>
      </div>
      <div className="column dock">
        {!atBottom && (
          <button className="to-bottom" aria-label="Scroll to the latest message" onClick={scrollDown}>
            <Down size={17} />
          </button>
        )}
        {banner}
        <Composer busy={busy} placeholder="Reply to Lean Harness…" onSend={(t, files) => send(t, undefined, files)} onStop={stop} autoFocus />
        <p className="disclaimer">Lean Harness can make mistakes. Check important information.</p>
      </div>
    </main>
  );
}
