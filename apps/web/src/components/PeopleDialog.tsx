import { useCallback, useEffect, useState } from 'react';
import type { Account, ActivityEntry, Invite, SignupPolicy } from '@lean-harness/widget/client';
import { api, relativeDate } from '../lib';
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

function PersonRow({ person, me, otherAdmins, changed }: { person: Account; me: boolean; otherAdmins: boolean; changed(): void }) {
  const { toast, status, reload, setDialog } = useApp();
  const [menu, setMenu] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [reset, setReset] = useState('');
  const close = useCallback(() => setMenu(false), []);
  const act = async (action: () => Promise<unknown>) => {
    setMenu(false);
    await action().catch((e: Error) => toast(e.message));
    changed();
  };
  const seen = person.lastSignInAt ? `Last signed in ${relativeDate(person.lastSignInAt)}` : 'Never signed in';
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
        <small>
          {person.email}
          {status?.email && !person.emailVerified && ' (not confirmed)'} · {seen}
        </small>
      </span>
      <span className={`role ${person.role}`}>{person.disabled ? 'Turned off' : person.role === 'admin' ? 'Admin' : 'Member'}</span>
      {(!me || (person.role === 'admin' && otherAdmins)) && (
        <span className="row-menu">
          <button className="icon-btn small" aria-label={`Options for ${person.name}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <More size={16} />
          </button>
          {menu && (
            <Popover label={`Options for ${person.name}`} onClose={close} style={{ top: 34, right: 0, minWidth: 210 }}>
              {me ? (
                // Handing over: another admin keeps the app running.
                <button className="menu-item" role="menuitem" onClick={() => act(async () => (await api.updateUser(person.id, { role: 'member' }), setDialog(null), reload()))}>
                  Step down to member
                </button>
              ) : (
                <>
                  <button className="menu-item" role="menuitem" onClick={() => act(() => api.updateUser(person.id, { role: person.role === 'admin' ? 'member' : 'admin' }))}>
                    {person.role === 'admin' ? 'Make member' : 'Make admin'}
                  </button>
                  <button className="menu-item" role="menuitem" onClick={() => act(async () => setReset(resetUrl((await api.createResetLink(person.id)).token)))}>
                    Reset password
                  </button>
                  <button className="menu-item" role="menuitem" onClick={() => act(() => api.updateUser(person.id, { disabled: !person.disabled }))}>
                    {person.disabled ? 'Turn on' : 'Turn off (signs them out)'}
                  </button>
                  <button className="menu-item danger" role="menuitem" onClick={() => (setMenu(false), setRemoving(true))}>
                    <Trash size={15} />
                    Remove
                  </button>
                </>
              )}
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

const MODES: { id: SignupPolicy['mode']; label: string }[] = [
  { id: 'invite', label: 'Invited people' },
  { id: 'domain', label: 'Email domains' },
  { id: 'open', label: 'Anyone' },
];

/** Who may join without an invite. */
function WhoCanJoin() {
  const { toast, reload } = useApp();
  const [settings, setSettings] = useState<{ signup: SignupPolicy; email: boolean; providers: { name: string }[] } | null>(null);
  const [mode, setMode] = useState<SignupPolicy['mode']>('invite');
  const [domains, setDomains] = useState('');
  useEffect(() => {
    api.settings().then((s) => {
      setSettings(s);
      setMode(s.signup.mode);
      setDomains(s.signup.domains.join(', '));
    }, () => undefined);
  }, []);
  if (!settings) return null;
  const canVerify = settings.email || settings.providers.length > 0;
  const list = domains.split(/[\s,]+/).filter(Boolean);
  const unchanged = mode === settings.signup.mode && list.join() === settings.signup.domains.join();
  const how = [settings.email ? 'confirming their email' : '', ...settings.providers.map((p) => `signing in with ${p.name}`)].filter(Boolean).join(' or ');
  const save = async () => {
    try {
      const { signup } = await api.updateSettings({ signup: { mode, domains: list } });
      setSettings({ ...settings, signup });
      setDomains(signup.domains.join(', '));
      toast('Saved');
      reload();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  return (
    <div className="setting" style={{ display: 'block' }}>
      <b>Who can join</b>
      <small>
        {canVerify
          ? `Besides invited people, let others create an account by ${how}.`
          : 'Only invited people can join. To let others sign up, set up email or Google/Microsoft sign-in on the server.'}
      </small>
      <div className="join-form">
        <div className="segmented" role="group" aria-label="Who can join">
          {MODES.map((m) => (
            <button key={m.id} aria-pressed={mode === m.id} disabled={m.id !== 'invite' && !canVerify} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        {mode === 'domain' && (
          <input className="input" placeholder="acme.com, acme.co.uk" aria-label="Email domains" value={domains} onChange={(e) => setDomains(e.target.value)} />
        )}
        {mode === 'open' && <small className="warn">Anyone who finds this app can create an account and use your models.</small>}
        <button className="btn" disabled={unchanged || (mode === 'domain' && !list.length)} onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}

function InviteRow({ invite, changed }: { invite: Invite; changed(): void }) {
  const { toast, status } = useApp();
  const [link, setLink] = useState('');
  const renew = async () => {
    try {
      const r = await api.renewInvite(invite.id);
      setLink(inviteUrl(r.token));
      toast(r.emailed ? `Invite sent again to ${invite.email}` : 'New link made. The old one no longer works.');
      changed();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  return (
    <li className="invite-row">
      <span className="who">
        <b>{invite.email ?? 'Anyone with the link'}</b>
        <small>
          {invite.role === 'admin' ? 'As admin · ' : ''}Expires in {days(invite.expiresAt)} {days(invite.expiresAt) === 1 ? 'day' : 'days'}
        </small>
        {link && <LinkBox link={link} />}
      </span>
      <button className="btn" onClick={renew}>
        {invite.email && status?.email ? 'Send again' : 'New link'}
      </button>
      <button className="btn" onClick={() => api.revokeInvite(invite.id).then(changed, () => toast('Could not revoke'))}>
        Revoke
      </button>
    </li>
  );
}

function PeopleTab() {
  const { user, toast, status } = useApp();
  const [people, setPeople] = useState<Account[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState('');
  const [asAdmin, setAsAdmin] = useState(false);
  const [created, setCreated] = useState<{ link: string; sentTo?: string } | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(() => {
    api.users().then((r) => setPeople(r.users), () => toast('Could not load people'));
    api.invites().then((r) => setInvites(r.invites), () => undefined);
  }, [toast]);
  useEffect(load, [load]);

  const create = async () => {
    try {
      const address = email.trim() || undefined;
      const { token, emailed } = await api.createInvite({ email: address, role: asAdmin ? 'admin' : 'member' });
      setCreated({ link: inviteUrl(token), sentTo: emailed ? address : undefined });
      setEmail('');
      setAsAdmin(false);
      load();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const q = query.trim().toLowerCase();
  const shown = q ? people.filter((p) => p.name.toLowerCase().includes(q) || p.email.includes(q)) : people;
  const activeAdmins = people.filter((p) => p.role === 'admin' && !p.disabled).length;

  return (
    <>
      <div className="setting" style={{ display: 'block' }}>
        <b>Invite someone</b>
        <small>
          {status?.email
            ? "Add their email and we'll send the invite. Or leave it empty for a link anyone can use once."
            : 'Create a link and send it to them. Add their email to make it work only for them.'}{' '}
          Invites expire in 7 days.
        </small>
        <form
          className="invite-form"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <input className="input" type="email" placeholder="Email (optional)" aria-label="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn primary" type="submit">
            {email.trim() && status?.email ? 'Send invite' : 'Create invite link'}
          </button>
        </form>
        <label className="check">
          <input type="checkbox" checked={asAdmin} onChange={(e) => setAsAdmin(e.target.checked)} />
          Make them an admin
        </label>
        {created && (
          <>
            {created.sentTo && <p className="sent">Invite sent to {created.sentTo}. You can also share the link yourself:</p>}
            <LinkBox link={created.link} />
          </>
        )}
      </div>
      <WhoCanJoin />
      {invites.length > 0 && (
        <div className="setting" style={{ display: 'block' }}>
          <b>Open invites</b>
          <ul className="people">
            {invites.map((i) => (
              <InviteRow key={i.id} invite={i} changed={load} />
            ))}
          </ul>
        </div>
      )}
      <div className="setting" style={{ display: 'block' }}>
        <div className="members-head">
          <b>
            Members <span className="count">{people.length}</span>
          </b>
          {people.length > 5 && <input className="input" type="search" placeholder="Search people" aria-label="Search people" value={query} onChange={(e) => setQuery(e.target.value)} />}
        </div>
        <ul className="people">
          {shown.map((p) => (
            <PersonRow key={p.id} person={p} me={p.id === user?.id} otherAdmins={activeAdmins > 1} changed={load} />
          ))}
          {!shown.length && <li className="side-empty">No one matches “{query}”.</li>}
        </ul>
      </div>
    </>
  );
}

/** What an activity log line says. */
const ACTIONS: Record<string, (a: ActivityEntry) => string> = {
  setup: (a) => `${a.actor} created the admin account`,
  sign_in: (a) => `${a.actor} signed in${a.target ? ` with ${a.target}` : ''}`,
  sign_in_failed: (a) => `Failed sign-in for ${a.target}`,
  sign_out: (a) => `${a.actor} signed out`,
  password_changed: (a) => `${a.actor} changed their password`,
  password_reset: (a) => `${a.actor} set a new password with a reset link`,
  reset_requested: (a) => `Password reset requested for ${a.target}`,
  reset_link_created: (a) => `${a.actor} made a password reset link for ${a.target}`,
  invite_created: (a) => `${a.actor} invited ${a.target === 'link' ? 'someone by link' : a.target}`,
  invite_renewed: (a) => `${a.actor} renewed the invite for ${a.target === 'link' ? 'a link' : a.target}`,
  invite_revoked: (a) => `${a.actor} revoked the invite for ${a.target === 'link' ? 'a link' : a.target}`,
  joined: (a) => `${a.actor} joined${a.target ? ` with ${a.target}` : ''}`,
  signup_requested: (a) => `Sign-up requested for ${a.target}`,
  signed_up: (a) => `${a.actor} signed up${a.target ? ` with ${a.target}` : ''}`,
  signup_changed: (a) => `${a.actor} changed who can join to: ${a.target}`,
  made_admin: (a) => `${a.actor} made ${a.target} an admin`,
  made_member: (a) => `${a.actor} made ${a.target} a member`,
  user_turned_off: (a) => `${a.actor} turned off ${a.target}`,
  user_turned_on: (a) => `${a.actor} turned on ${a.target}`,
  user_removed: (a) => `${a.actor} removed ${a.target}`,
  email_changed: (a) => `${a.target} changed their email to ${a.actor}`,
  email_confirmed: (a) => `${a.actor} confirmed their email`,
  sso_linked: (a) => `${a.actor} connected ${a.target}`,
  account_deleted: (a) => `${a.actor} deleted their account`,
};

function ActivityTab() {
  const { toast } = useApp();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [more, setMore] = useState(true);
  const load = useCallback(
    (before?: string) =>
      api.activity(before).then(
        ({ activity }) => {
          setEntries((all) => (before ? [...all, ...activity] : activity));
          setMore(activity.length === 50);
        },
        () => toast('Could not load activity'),
      ),
    [toast],
  );
  useEffect(() => void load(), [load]);
  return (
    <div className="setting" style={{ display: 'block' }}>
      <small>Sign-ins and changes to people and invites, newest first. Kept for a year.</small>
      <ul className="activity">
        {entries.map((a) => (
          <li key={a.id} className={a.action === 'sign_in_failed' ? 'failed' : ''}>
            <span>{(ACTIONS[a.action] ?? ((x) => `${x.actor ?? 'Someone'}: ${x.action}${x.target ? ` (${x.target})` : ''}`))(a)}</span>
            <time dateTime={a.at} title={new Date(a.at).toLocaleString()}>
              {relativeDate(a.at)}
              {a.ip ? ` · ${a.ip}` : ''}
            </time>
          </li>
        ))}
        {!entries.length && <li className="side-empty">Nothing yet.</li>}
      </ul>
      {more && entries.length > 0 && (
        <button className="btn" onClick={() => load(entries.at(-1)!.at)}>
          Show older
        </button>
      )}
    </div>
  );
}

/** Admin only: who can sign in, invites, who may join, and the activity log. */
export function PeopleDialog() {
  const { setDialog } = useApp();
  const [tab, setTab] = useState<'people' | 'activity'>('people');
  return (
    <Dialog title="People" onClose={() => setDialog(null)}>
      <div className="dialog-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'people'} onClick={() => setTab('people')}>
          People
        </button>
        <button role="tab" aria-selected={tab === 'activity'} onClick={() => setTab('activity')}>
          Activity
        </button>
      </div>
      <div className="dialog-body">{tab === 'people' ? <PeopleTab /> : <ActivityTab />}</div>
    </Dialog>
  );
}
