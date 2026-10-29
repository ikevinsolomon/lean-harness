import { useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../lib';
import { useApp } from '../store';
import { Dialog } from './Dialog';

/** A small form that shows "busy" while saving and the server's message if it fails. */
function useSave() {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const save = (action: () => Promise<string | void>) => async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    try {
      const done = await action();
      if (done) toast(done);
    } catch (err) {
      toast((err as Error).message);
    }
    setBusy(false);
  };
  return { busy, save };
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="account-row">
      <span className="account-label">{label}</span>
      <div className="account-value">{children}</div>
    </div>
  );
}

function NameForm() {
  const { user, setUser } = useApp();
  const [name, setName] = useState(user?.name ?? '');
  const { busy, save } = useSave();
  return (
    <form
      className="inline-form"
      onSubmit={save(async () => {
        setUser((await api.updateProfile({ name })).user);
        return 'Name saved';
      })}
    >
      <input className="input" aria-label="Your name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
      <button className="btn" type="submit" disabled={busy || !name.trim() || name.trim() === user?.name}>
        Save
      </button>
    </form>
  );
}

function EmailForm() {
  const { user, setUser, status } = useApp();
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, save } = useSave();
  if (!editing) {
    return (
      <>
        <span className="account-email">
          {user?.email}
          {status?.email && user?.emailVerified === false && <span className="badge">Not confirmed</span>}
        </span>
        <span className="account-actions">
          {status?.email && user?.emailVerified === false && (
            <button className="link" onClick={save(async () => (await api.resendVerification(), `Confirmation link sent to ${user.email}`))} disabled={busy}>
              Send confirmation link
            </button>
          )}
          <button className="link" onClick={() => setEditing(true)}>
            Change
          </button>
        </span>
      </>
    );
  }
  return (
    <form
      className="stack-form"
      onSubmit={save(async () => {
        const result = await api.changeEmail(email.trim(), password || undefined);
        setEditing(false);
        setPassword('');
        if (result.pending) return `Open the link we sent to ${email.trim()} to finish the change`;
        setUser(result.user);
        return 'Email changed';
      })}
    >
      <input className="input" type="email" autoFocus autoComplete="email" placeholder="New email" aria-label="New email" value={email} onChange={(e) => setEmail(e.target.value)} />
      {user?.hasPassword !== false && (
        <input className="input" type="password" autoComplete="current-password" placeholder="Current password" aria-label="Current password" value={password} onChange={(e) => setPassword(e.target.value)} />
      )}
      <div className="form-buttons">
        <button className="btn" type="button" onClick={() => setEditing(false)}>
          Cancel
        </button>
        <button className="btn primary" type="submit" disabled={busy || !email.trim() || (user?.hasPassword !== false && !password)}>
          Change email
        </button>
      </div>
    </form>
  );
}

/** Change your password, or set one if you have only used Google/Microsoft so far. Signs you out on your other devices. */
function PasswordForm() {
  const { user, setUser } = useApp();
  const hasPassword = user?.hasPassword !== false;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const { busy, save } = useSave();
  return (
    <form
      className="stack-form"
      onSubmit={save(async () => {
        await api.changePassword(hasPassword ? current : undefined, next);
        setCurrent('');
        setNext('');
        if (!hasPassword && user) setUser({ ...user, hasPassword: true });
        return hasPassword ? 'Password changed. Your other devices are signed out.' : 'Password set';
      })}
    >
      {hasPassword && (
        <input className="input" type="password" autoComplete="current-password" placeholder="Current password" aria-label="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      )}
      <input className="input" type="password" autoComplete="new-password" placeholder="New password (at least 8 characters)" aria-label="New password" value={next} onChange={(e) => setNext(e.target.value)} />
      <div className="form-buttons">
        <button className="btn" type="submit" disabled={(hasPassword && !current) || next.length < 8 || busy}>
          {hasPassword ? 'Change password' : 'Set a password'}
        </button>
      </div>
    </form>
  );
}

function DeleteAccount() {
  const { user, setDialog } = useApp();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const { busy, save } = useSave();
  return (
    <>
      <button className="link danger" onClick={() => setOpen(true)}>
        Delete my account
      </button>
      {open && (
        <Dialog title="Delete your account?" onClose={() => setOpen(false)} small>
          <form
            className="dialog-body"
            onSubmit={save(async () => {
              await api.deleteAccount(password || undefined);
              setDialog(null);
              location.assign('/');
            })}
          >
            <p>You won't be able to sign in again. Your chats stay with the admin's database. This can't be undone.</p>
            {user?.hasPassword !== false && (
              <input className="input wide" type="password" autoFocus autoComplete="current-password" placeholder="Your password" aria-label="Your password" value={password} onChange={(e) => setPassword(e.target.value)} />
            )}
            <div className="dialog-foot">
              <button className="btn" type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="btn danger" type="submit" disabled={busy || (user?.hasPassword !== false && !password)}>
                Delete account
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}

/** Built-in accounts: your name, email, password, and deleting the account. */
export function AccountSettings() {
  return (
    <div className="setting account" style={{ display: 'block' }}>
      <b>Account</b>
      <Row label="Name">
        <NameForm />
      </Row>
      <Row label="Email">
        <EmailForm />
      </Row>
      <Row label="Password">
        <PasswordForm />
      </Row>
      <Row label="">
        <DeleteAccount />
      </Row>
    </div>
  );
}
