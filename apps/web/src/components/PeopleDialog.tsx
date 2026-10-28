import { useCallback, useEffect, useState } from 'react';
import type { Account, Invite } from '@lean-harness/widget/client';
import { api } from '../lib';
import { useApp } from '../store';
import { ConfirmDialog, Dialog } from './Dialog';
import { Check, Copy, More, Trash } from './Icons';
import { Popover } from './Popover';

const inviteUrl = (token: string) => `${location.origin}/invite/${token}`;
const resetUrl = (token: string) => `${location.origin}/reset/${token}`;
const days = (iso: string) => Math.max(1, Math.round((Date.parse(iso) - Date.now()) / 86_400_000));

/** A link shown once, with a Copy button. */
function LinkBox({ link }: { link: string }) {
  const { toast } = useApp();
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [link]);
  const copy = () => navigator.clipboard.writeText(link).then(() => setCopied(true), () => toast('Copy the link by hand'));
  return (
    <>
      <div className="invite-link">
        <code>{link}</code>
        <button className="btn" onClick={copy}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <small>This link is shown only once.</small>
    </>
  );
}

function PersonRow({ person, me, changed }: { person: Account; me: boolean; changed(): void }) {
  const { toast } = useApp();
  const [menu, setMenu] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [reset, setReset] = useState('');
  const close = useCallback(() => setMenu(false), []);
  const act = async (action: () => Promise<unknown>) => {
    setMenu(false);
    await action().catch((e: Error) => toast(e.message));
    changed();
  };
  return (
    <li className={person.disabled ? 'off' : ''}>
      <span className="avatar" aria-hidden="true">
        {person.name.charAt(0).toUpperCase()}
      </span>
      <span className="who">
        <b>
          {person.name}
          {me && ' (you)'}
        </b>
        <small>{person.email}</small>
      </span>
      <span className={`role ${person.role}`}>{person.disabled ? 'Turned off' : person.role === 'admin' ? 'Admin' : 'Member'}</span>
      {!me && (
        <span className="row-menu">
          <button className="icon-btn small" aria-label={`Options for ${person.name}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <More size={16} />
          </button>
          {menu && (
            <Popover label={`Options for ${person.name}`} onClose={close} style={{ top: 34, right: 0, minWidth: 200 }}>
              <button className="menu-item" role="menuitem" onClick={() => act(() => api.updateUser(person.id, { role: person.role === 'admin' ? 'member' : 'admin' }))}>
                {person.role === 'admin' ? 'Make member' : 'Make admin'}
              </button>
              <button
                className="menu-item"
                role="menuitem"
                onClick={() =>
                  act(async () => setReset(resetUrl((await api.createResetLink(person.id)).token)))
                }
              >
                Reset password
              </button>
              <button className="menu-item" role="menuitem" onClick={() => act(() => api.updateUser(person.id, { disabled: !person.disabled }))}>
                {person.disabled ? 'Turn on' : 'Turn off (signs them out)'}
              </button>
              <button className="menu-item danger" role="menuitem" onClick={() => (setMenu(false), setRemoving(true))}>
                <Trash size={15} />
                Remove
              </button>
            </Popover>
          )}
        </span>
      )}
      {reset && (
        <Dialog title={`Reset ${person.name}'s password`} onClose={() => setReset('')} small>
          <div className="dialog-body">
            <p>Send this link to {person.name}. It lets them set a new password, works once, and expires in 24 hours. Their current sign-ins end when they use it.</p>
            <LinkBox link={reset} />
          </div>
        </Dialog>
      )}
      {removing && (
        <ConfirmDialog
          title={`Remove ${person.name}?`}
          body="They won't be able to sign in. Their chats stay in the database."
          confirm="Remove"
          onClose={() => setRemoving(false)}
          onConfirm={() => (setRemoving(false), act(() => api.deleteUser(person.id)))}
        />
      )}
    </li>
  );
}

/** Admin only: who can sign in, and invite links for new people. */
export function PeopleDialog() {
  const { setDialog, user, toast } = useApp();
  const [people, setPeople] = useState<Account[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState('');
  const [link, setLink] = useState('');

  const load = useCallback(() => {
    api.users().then((r) => setPeople(r.users), () => toast('Could not load people'));
    api.invites().then((r) => setInvites(r.invites), () => undefined);
  }, [toast]);
  useEffect(load, [load]);

  const create = async () => {
    try {
      const { token } = await api.createInvite({ email: email.trim() || undefined });
      setLink(inviteUrl(token));
      setEmail('');
      load();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <Dialog title="People" onClose={() => setDialog(null)}>
      <div className="dialog-body">
        <div className="setting" style={{ display: 'block' }}>
          <b>Invite someone</b>
          <small>Create a link and send it to them. It works once and expires in 7 days. Add their email to make it work only for them.</small>
          <form
            className="invite-form"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <input className="input" type="email" placeholder="Email (optional)" aria-label="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="btn primary" type="submit">
              Create invite link
            </button>
          </form>
          {link && <LinkBox link={link} />}
        </div>
        {invites.length > 0 && (
          <div className="setting" style={{ display: 'block' }}>
            <b>Open invites</b>
            <ul className="people">
              {invites.map((i) => (
                <li key={i.id}>
                  <span className="who">
                    <b>{i.email ?? 'Anyone with the link'}</b>
                    <small>Expires in {days(i.expiresAt)} {days(i.expiresAt) === 1 ? 'day' : 'days'}</small>
                  </span>
                  <button className="btn" onClick={() => api.revokeInvite(i.id).then(load, () => toast('Could not revoke'))}>
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="setting" style={{ display: 'block' }}>
          <b>Members</b>
          <ul className="people">
            {people.map((p) => (
              <PersonRow key={p.id} person={p} me={p.id === user?.id} changed={load} />
            ))}
          </ul>
        </div>
      </div>
    </Dialog>
  );
}
