import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { api } from '../lib';
import { useApp } from '../store';

/** The centred card shared by the sign-in, setup and invite screens. */
function Card({ title, intro, error, children, onSubmit }: { title: string; intro: ReactNode; error: string; children: ReactNode; onSubmit?(e: FormEvent): void }) {
  return (
    <main className="signin">
      <form className="signin-card" onSubmit={onSubmit} noValidate>
        <img src="/logo.svg" alt="" width={48} height={48} />
        <h1>{title}</h1>
        <p>{intro}</p>
        {children}
        {error && (
          <p className="signin-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}

function Field(props: { id: string; label: string; type?: string; autoComplete: string; value: string; onChange(v: string): void; autoFocus?: boolean; readOnly?: boolean }) {
  return (
    <label className="field" htmlFor={props.id}>
      <span>{props.label}</span>
      <input
        id={props.id}
        type={props.type ?? 'text'}
        autoComplete={props.autoComplete}
        autoFocus={props.autoFocus}
        readOnly={props.readOnly}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  );
}

/** Run a form action: shows "busy" while it runs and the server's message if it fails. */
function useSubmit(initialError = '') {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    }
    setBusy(false);
  };
  return { busy, error, run };
}

/** "Continue with Google" and friends, with an "or" line before the email form. */
function ProviderButtons({ verb = 'Continue', invite }: { verb?: string; invite?: string }) {
  const { status } = useApp();
  const { pathname } = useLocation();
  const providers = status?.providers ?? [];
  if (!providers.length) return null;
  const next = invite ? '/' : pathname;
  return (
    <>
      {providers.map((p) => (
        <a key={p.id} className="btn sso" href={api.ssoUrl(p.id, { invite, next })}>
          {verb} with {p.name}
        </a>
      ))}
      <div className="or" role="separator">
        <span>or</span>
      </div>
    </>
  );
}

/** Name, email and password: creating the admin account, or joining by invite. */
function NewAccountFields(props: { name: string; email: string; password: string; set(field: 'name' | 'email' | 'password', v: string): void; lockedEmail?: boolean }) {
  return (
    <>
      <Field id="name" label="Your name" autoComplete="name" autoFocus value={props.name} onChange={(v) => props.set('name', v)} />
      <Field id="email" label="Email" type="email" autoComplete="email" readOnly={props.lockedEmail} value={props.email} onChange={(v) => props.set('email', v)} />
      <Field id="password" label="Password (at least 8 characters)" type="password" autoComplete="new-password" value={props.password} onChange={(v) => props.set('password', v)} />
    </>
  );
}

function useNewAccount(email = '') {
  const [form, setForm] = useState({ name: '', email, password: '' });
  const set = (field: 'name' | 'email' | 'password', v: string) => setForm((f) => ({ ...f, [field]: v }));
  const complete = form.name.trim() && form.email.trim() && form.password.length >= 8;
  return { form, setForm, set, complete };
}

function Setup() {
  const { reload, info } = useApp();
  const { form, set, complete } = useNewAccount();
  const { busy, error, run } = useSubmit();
  return (
    <Card
      title={`Welcome to ${info.name}`}
      intro="Create the admin account. You'll decide who else can join from People."
      error={error}
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => (await api.setup(form), reload()));
      }}
    >
      <NewAccountFields {...form} set={set} />
      <button className="btn primary" type="submit" disabled={!complete || busy}>
        {busy ? 'Creating…' : 'Create admin account'}
      </button>
    </Card>
  );
}

/** An error passed back in the URL (a failed Google/Microsoft sign-in), shown once. */
function useUrlError() {
  const [error] = useState(() => new URLSearchParams(location.search).get('signin_error') ?? '');
  useEffect(() => {
    if (!error) return;
    const url = new URL(location.href);
    url.searchParams.delete('signin_error');
    history.replaceState(history.state, '', url);
  }, [error]);
  return error;
}

/** How someone without an account gets one, in a sentence. */
function JoinNote({ onSignup }: { onSignup(): void }) {
  const { status } = useApp();
  const signup = status?.signup;
  if (!signup || signup.mode === 'invite') return <small className="signin-note">No account? Ask your admin for an invite link.</small>;
  const where = signup.mode === 'domain' ? ` with your ${signup.domains.map((d) => `@${d}`).join(' or ')} email` : '';
  if (status?.email) {
    return (
      <small className="signin-note">
        No account?{' '}
        <button type="button" className="link" onClick={onSignup}>
          Create one
        </button>
        {where}.
      </small>
    );
  }
  const names = (status?.providers ?? []).map((p) => p.name).join(' or ');
  return names ? <small className="signin-note">New here? Continue with {names}{where}.</small> : null;
}

function Login() {
  const { reload, info, status } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [screen, setScreen] = useState<'login' | 'forgot' | 'signup'>('login');
  const { busy, error, run } = useSubmit(useUrlError());
  if (screen === 'forgot') return <Forgot email={email} back={() => setScreen('login')} />;
  if (screen === 'signup') return <Signup email={email} back={() => setScreen('login')} />;
  return (
    <Card
      title={`Sign in to ${info.name}`}
      intro={status?.providers?.length ? 'Welcome back.' : 'Use the email and password for your account.'}
      error={error}
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => (await api.login(email, password), reload()));
      }}
    >
      <ProviderButtons />
      <Field id="email" label="Email" type="email" autoComplete="username" autoFocus={!status?.providers?.length} value={email} onChange={setEmail} />
      <Field id="password" label="Password" type="password" autoComplete="current-password" value={password} onChange={setPassword} />
      {status?.email && (
        <button type="button" className="link forgot" onClick={() => setScreen('forgot')}>
          Forgot password?
        </button>
      )}
      <button className="btn primary" type="submit" disabled={!email.trim() || !password || busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      <JoinNote onSignup={() => setScreen('signup')} />
    </Card>
  );
}

/** Ask for an email, send a link to it, then say "check your email". */
function EmailLinkCard(props: {
  title: string;
  intro: ReactNode;
  email: string;
  button: string;
  sent(email: string): ReactNode;
  send(email: string): Promise<unknown>;
  back(): void;
}) {
  const [email, setEmail] = useState(props.email);
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useSubmit();
  if (sent) {
    return (
      <Card title="Check your email" intro={props.sent(email.trim())} error="">
        <button type="button" className="btn" onClick={props.back}>
          Back to sign in
        </button>
      </Card>
    );
  }
  return (
    <Card
      title={props.title}
      intro={props.intro}
      error={error}
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => (await props.send(email.trim()), setSent(true)));
      }}
    >
      <Field id="email" label="Email" type="email" autoComplete="email" autoFocus value={email} onChange={setEmail} />
      <button className="btn primary" type="submit" disabled={!email.trim() || busy}>
        {busy ? 'Sending…' : props.button}
      </button>
      <button type="button" className="link" onClick={props.back}>
        Back to sign in
      </button>
    </Card>
  );
}

function Forgot({ email, back }: { email: string; back(): void }) {
  return (
    <EmailLinkCard
      title="Forgot your password?"
      intro="Enter your email and we'll send you a link to set a new one."
      email={email}
      button="Send reset link"
      send={(e) => api.forgotPassword(e)}
      sent={(e) => `If there's an account for ${e}, a link to set a new password is on its way. It works for 24 hours.`}
      back={back}
    />
  );
}

function Signup({ email, back }: { email: string; back(): void }) {
  const { info, status } = useApp();
  const domains = status?.signup?.mode === 'domain' ? status.signup.domains : [];
  return (
    <EmailLinkCard
      title={`Join ${info.name}`}
      intro={domains.length ? `Enter your ${domains.map((d) => `@${d}`).join(' or ')} email. We'll send a link to finish signing up.` : "Enter your email. We'll send a link to finish signing up."}
      email={email}
      button="Send sign-up link"
      send={(e) => api.signup(e)}
      sent={(e) => `We sent a link to ${e}. Open it to set your name and password. It works for 24 hours.`}
      back={back}
    />
  );
}

/**
 * Servers that use access tokens instead of built-in accounts. An app with its own
 * login (Supabase, Auth0, Clerk...) would put its sign-in here and hand the token to `signIn`.
 */
function TokenSignIn() {
  const { signIn, info } = useApp();
  const [token, setToken] = useState('');
  const { busy, error, run } = useSubmit();
  return (
    <Card
      title={`Sign in to ${info.name}`}
      intro="Paste the access token you were given."
      error={error}
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          if (!(await signIn(token.trim()))) throw new Error('That token was not accepted. Check it and try again.');
        });
      }}
    >
      <Field id="token" label="Access token" type="password" autoComplete="current-password" autoFocus value={token} onChange={setToken} />
      <button className="btn primary" type="submit" disabled={!token.trim() || busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </Card>
  );
}

/** Whatever the server needs before the app opens. */
export function SignIn() {
  const { gate } = useApp();
  if (gate === 'setup') return <Setup />;
  if (gate === 'login') return <Login />;
  return <TokenSignIn />;
}

/** A link from an email or the admin that no longer works. */
function DeadLink({ what }: { what: string }) {
  return (
    <Card title={`This ${what} link doesn't work`} intro="It has expired or was already used. Ask for a new one." error="">
      <Link className="btn primary" to="/">
        Go to sign in
      </Link>
    </Card>
  );
}

/** /invite/:token — someone opening an invite (or sign-up) link sets their name and password. */
export function AcceptInvite() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { reload, info } = useApp();
  const { form, setForm, set, complete } = useNewAccount();
  const { busy, error, run } = useSubmit();
  const [invite, setInvite] = useState<{ email?: string } | null | 'loading'>('loading');

  useEffect(() => {
    api.invite(token).then(
      ({ invite }) => {
        setInvite(invite);
        if (invite.email) setForm((f) => ({ ...f, email: invite.email! }));
      },
      () => setInvite(null),
    );
  }, [token, setForm]);

  if (invite === 'loading') return <main className="signin" />;
  if (!invite) return <DeadLink what="invite" />;
  return (
    <Card
      title={`Join ${info.name}`}
      intro="Set your name and a password to get started."
      error={error}
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await api.acceptInvite(token, form);
          reload();
          navigate('/', { replace: true });
        });
      }}
    >
      <ProviderButtons verb="Join" invite={token} />
      <NewAccountFields {...form} set={set} lockedEmail={Boolean(invite.email)} />
      <button className="btn primary" type="submit" disabled={!complete || busy}>
        {busy ? 'Joining…' : 'Create account'}
      </button>
    </Card>
  );
}

/** /reset/:token — a password reset link from an email, the admin, or the recovery command. */
export function ResetPassword() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { reload } = useApp();
  const [who, setWho] = useState<{ name: string; email: string } | null | 'loading'>('loading');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useSubmit();

  useEffect(() => {
    api.resetInfo(token).then(({ reset }) => setWho(reset), () => setWho(null));
  }, [token]);

  if (who === 'loading') return <main className="signin" />;
  if (!who) return <DeadLink what="reset" />;
  return (
    <Card
      title="Set a new password"
      intro={`For ${who.name} (${who.email}). You'll be signed out on your other devices.`}
      error={error}
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await api.resetPassword(token, password);
          reload();
          navigate('/', { replace: true });
        });
      }}
    >
      <Field id="password" label="New password (at least 8 characters)" type="password" autoComplete="new-password" autoFocus value={password} onChange={setPassword} />
      <button className="btn primary" type="submit" disabled={password.length < 8 || busy}>
        {busy ? 'Saving…' : 'Set password and sign in'}
      </button>
    </Card>
  );
}

/** /confirm-email/:token — the link in a "confirm your email" email. A button, so link scanners don't use it up. */
export function ConfirmEmail() {
  const { token = '' } = useParams();
  const { reload, info } = useApp();
  const [done, setDone] = useState<string | null>(null);
  const { busy, error, run } = useSubmit();
  if (done) {
    return (
      <Card title="Email confirmed" intro={`You'll use ${done} to sign in to ${info.name}.`} error="">
        <Link className="btn primary" to="/" onClick={reload}>
          Open {info.name}
        </Link>
      </Card>
    );
  }
  if (error) {
    return (
      <Card title="This confirmation link doesn't work" intro={error} error="">
        <Link className="btn primary" to="/">
          Open {info.name}
        </Link>
      </Card>
    );
  }
  return (
    <Card
      title="Confirm your email"
      intro={`Confirm this address for your ${info.name} account.`}
      error=""
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => setDone((await api.confirmEmail(token)).user.email ?? ''));
      }}
    >
      <button className="btn primary" type="submit" disabled={busy} autoFocus>
        {busy ? 'Confirming…' : 'Confirm email'}
      </button>
    </Card>
  );
}
