import { useState } from 'react';
import { useApp } from '../store';

/**
 * Shown when the server requires sign-in. The built-in server auth uses access tokens;
 * an app with its own login (Supabase, Auth0, Clerk...) would put its sign-in here and
 * hand the resulting token to `signIn`.
 */
export function SignIn() {
  const { signIn } = useApp();
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <main className="signin">
      <form
        className="signin-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          if (!(await signIn(token.trim()))) setError('That token was not accepted. Check it and try again.');
          setBusy(false);
        }}
      >
        <img src="/logo.svg" alt="" width={48} height={48} />
        <h1>Sign in to Lean Harness</h1>
        <p>Paste the access token you were given.</p>
        <label htmlFor="token" className="sr-only">
          Access token
        </label>
        <input id="token" type="password" autoComplete="current-password" autoFocus placeholder="Access token" value={token} onChange={(e) => setToken(e.target.value)} />
        {error && (
          <p className="signin-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary" type="submit" disabled={!token.trim() || busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
