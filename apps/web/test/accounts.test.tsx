import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { AcceptInvite, ResetPassword } from '../src/components/SignIn';
import { AppProvider } from '../src/store';

/** A fake Lean Harness server with built-in accounts, answering the app's fetch calls. */
function fakeServer() {
  const state = { admin: false, signedIn: false, calls: [] as { method: string; path: string; body?: unknown }[] };
  const user = { id: 'u1', name: 'Kevin', email: 'kevin@example.test', role: 'admin' };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const path = new URL(input).pathname.replace(/^\/v1/, '');
      const method = init.method ?? 'GET';
      state.calls.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : undefined });
      if (path === '/app') return json({ name: 'Support Desk', suggestions: [{ title: 'Find an order', detail: 'By number' }] });
      if (path === '/auth/resets/good' && method === 'GET') return json({ reset: { name: 'Asha', email: 'asha@example.test' } });
      if (path === '/auth/resets/good' && method === 'POST') {
        state.admin = state.signedIn = true;
        return json({ user, token: 't' });
      }
      if (path === '/auth/status') return json({ accounts: true, setupRequired: !state.admin, user: state.signedIn ? user : null });
      if (path === '/auth/setup' && method === 'POST') {
        state.admin = state.signedIn = true;
        return json({ user, token: 't' });
      }
      if (path === '/auth/invites/good') return json({ invite: { email: 'asha@example.test', role: 'member' } });
      if (path === '/auth/invites/used') return json({ error: { message: 'This invite link has expired or was already used' } }, 404);
      if (!state.signedIn) return json({ error: { message: 'Sign in to continue' } }, 401);
      if (path === '/me') return json({ user });
      if (path === '/models') return json({ defaultModel: 'mock/echo', models: [{ id: 'mock/echo', provider: 'mock', model: 'echo' }] });
      if (path === '/tools') return json({ tools: [] });
      if (path === '/sessions') return json({ sessions: [] });
      return json({ error: { message: 'Not found' } }, 404);
    }),
  );
  return state;
}

const app = (path: string) => {
  const router = createMemoryRouter(
    [
      { path: '/', element: <App />, children: [{ index: true }, { path: 'c/:id' }] },
      { path: '/invite/:token', element: <AcceptInvite /> },
      { path: '/reset/:token', element: <ResetPassword /> },
    ],
    { initialEntries: [path] },
  );
  return render(
    <AppProvider>
      <RouterProvider router={router} />
    </AppProvider>,
  );
};

describe('accounts in the web app', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('asks a fresh server for the admin account, then opens the app', async () => {
    const server = fakeServer();
    app('/');
    await screen.findByText('Welcome to Support Desk');
    const create = screen.getByRole('button', { name: 'Create admin account' });
    expect(create).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Kevin' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'kevin@example.test' } });
    fireEvent.change(screen.getByLabelText(/Password/), { target: { value: 'long enough' } });
    fireEvent.click(create);

    await screen.findByRole('button', { name: 'People' }); // only the admin sees People
    // The server's name and starter prompts replace the defaults.
    expect(await screen.findByText('Find an order')).toBeTruthy();
    expect(screen.getByPlaceholderText('Ask Support Desk anything…')).toBeTruthy();
    expect(server.calls.find((c) => c.path === '/auth/setup')?.body).toEqual({ name: 'Kevin', email: 'kevin@example.test', password: 'long enough' });
  });

  it('shows sign-in once the admin exists', async () => {
    const server = fakeServer();
    server.admin = true;
    app('/');
    await screen.findByText('Sign in to Support Desk');
    expect(screen.getByText(/Ask your admin for an invite link/)).toBeTruthy();
  });

  it('opens an invite with its email filled in and locked', async () => {
    fakeServer().admin = true;
    app('/invite/good');
    await screen.findByText('Join Support Desk');
    await waitFor(() => expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('asha@example.test'));
    expect((screen.getByLabelText('Email') as HTMLInputElement).readOnly).toBe(true);
  });

  it('explains a used or expired invite link', async () => {
    fakeServer().admin = true;
    app('/invite/used');
    await screen.findByText("This invite link doesn't work");
  });

  it('sets a new password from a reset link and signs in', async () => {
    const server = fakeServer();
    server.admin = true;
    app('/reset/good');
    await screen.findByText('Set a new password');
    expect(screen.getByText(/For Asha \(asha@example.test\)/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/New password/), { target: { value: 'brand new pass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set password and sign in' }));
    await waitFor(() => expect(server.calls.some((c) => c.path === '/auth/resets/good' && c.method === 'POST')).toBe(true));
    expect(server.calls.find((c) => c.method === 'POST' && c.path === '/auth/resets/good')?.body).toEqual({ password: 'brand new pass' });
  });
});
