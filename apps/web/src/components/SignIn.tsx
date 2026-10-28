import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
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
function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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
      intro="Create the admin account. After this, people join only through invite links you share."
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

function Login() {
  const { reload, info } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useSubmit();
  return (
    <Card
      title={`Sign in to ${info.name}`}
      intro="Use the email and password for your account."
      error={error}
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => (await api.login(email, password), reload()));
      }}
    >
      <Field id="email" label="Email" type="email" autoComplete="username" autoFocus value={email} onChange={setEmail} />
      <Field id="password" label="Password" type="password" autoComplete="current-password" value={password} onChange={setPassword} />
      <button className="btn primary" type="submit" disabled={!email.trim() || !password || busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      <small className="signin-note">No account? Ask your admin for an invite link.</small>
    </Card>
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

/** /invite/:token — someone opening an invite link sets their name and password. */
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
  if (!invite) {
    return (
      <Card title="This invite link doesn't work" intro="It has expired or was already used. Ask your admin for a new one." error="">
        <Link className="btn primary" to="/">
          Go to sign in
        </Link>
      </Card>
    );
  }
  return (
    <Card
      title={`Join ${info.name}`}
      intro="You've been invited. Set your name and a password to get started."
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
      <NewAccountFields {...form} set={set} lockedEmail={Boolean(invite.email)} />
      <button className="btn primary" type="submit" disabled={!complete || busy}>
        {busy ? 'Joining…' : 'Create account'}
      </button>
    </Card>
  );
}

/** /reset/:token — a password reset link from the admin (or the recovery command). */
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
  if (!who) {
    return (
      <Card title="This reset link doesn't work" intro="It has expired or was already used. Ask your admin for a new one." error="">
        <Link className="btn primary" to="/">
          Go to sign in
        </Link>
      </Card>
    );
  }
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
