import { createHash } from 'node:crypto';

/**
 * Sign-in with Google, Microsoft or any OpenID Connect provider (Okta, Auth0, Keycloak...).
 * The authorization-code flow with PKCE. The ID token comes straight from the provider's
 * token endpoint over HTTPS, so its claims are checked (issuer, audience, expiry, nonce)
 * without fetching signing keys (OpenID Connect Core 3.1.3.7).
 */
export interface SsoProvider {
  /** In the URL: /v1/auth/sso/<id>. */
  id: string;
  /** On the button: "Continue with <name>". */
  name: string;
  /** Where `/.well-known/openid-configuration` lives. */
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Whether the provider vouches for this email address. Without that, the email is not used to find or create an account. */
  emailVerified?(claims: Claims): boolean;
  /** The email address in the claims (default: the `email` claim). */
  email?(claims: Claims): string | undefined;
}

export type Claims = Record<string, unknown>;

/** Google accounts. Create the client at console.cloud.google.com → APIs & Services → Credentials. */
export function google(options: { clientId: string; clientSecret: string }): SsoProvider {
  return { id: 'google', name: 'Google', issuer: 'https://accounts.google.com', ...options, emailVerified: (c) => c.email_verified === true };
}

const CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

/**
 * Microsoft work, school and personal accounts. `tenant` is your directory ID to allow only
 * your organization (recommended), or "common" for anyone with a Microsoft account.
 * Register the app at entra.microsoft.com → App registrations.
 */
export function microsoft(options: { clientId: string; clientSecret: string; tenant?: string }): SsoProvider {
  const tenant = options.tenant ?? 'common';
  const shared = ['common', 'organizations', 'consumers'].includes(tenant);
  return {
    id: 'microsoft',
    name: 'Microsoft',
    issuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    // Directory admins can set any email on their users. Trust it only from your own directory,
    // personal accounts, or when Microsoft says the domain owner verified it.
    emailVerified: (c) => !shared || c.tid === CONSUMER_TENANT || c.xms_edov === true || c.xms_edov === '1',
    email: (c) => (typeof c.email === 'string' ? c.email : !shared && typeof c.preferred_username === 'string' ? c.preferred_username : undefined),
  };
}

/** Any OpenID Connect provider. Set `trustEmail` only when the provider checks the addresses itself and doesn't send `email_verified`. */
export function oidc(options: { id?: string; name: string; issuer: string; clientId: string; clientSecret: string; trustEmail?: boolean }): SsoProvider {
  return {
    id: options.id ?? 'oidc',
    name: options.name,
    issuer: options.issuer.replace(/\/$/, ''),
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    emailVerified: (c) => options.trustEmail === true || c.email_verified === true || c.email_verified === 'true',
  };
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
}

const discovered = new Map<string, Promise<Discovery>>();

async function discover(provider: SsoProvider): Promise<Discovery> {
  let doc = discovered.get(provider.issuer);
  if (!doc) {
    doc = fetch(`${provider.issuer}/.well-known/openid-configuration`).then(async (res) => {
      if (!res.ok) throw new Error(`${provider.name} sign-in is unavailable (${res.status})`);
      return (await res.json()) as Discovery;
    });
    discovered.set(provider.issuer, doc);
    doc.catch(() => discovered.delete(provider.issuer));
  }
  return doc;
}

const b64url = (buf: Buffer) => buf.toString('base64url');

/** Where to send the browser to sign in. */
export async function authorizeUrl(provider: SsoProvider, input: { redirectUri: string; state: string; nonce: string; verifier: string }) {
  const doc = await discover(provider);
  const url = new URL(doc.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: provider.clientId,
    redirect_uri: input.redirectUri,
    scope: 'openid email profile',
    state: input.state,
    nonce: input.nonce,
    code_challenge: b64url(createHash('sha256').update(input.verifier).digest()),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return url.toString();
}

export interface SsoIdentity {
  subject: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
}

/** Trade the code for an ID token and check it is for this app, from this provider, fresh, and for this sign-in. */
export async function redeemCode(provider: SsoProvider, input: { code: string; redirectUri: string; nonce: string; verifier: string }): Promise<SsoIdentity> {
  const doc = await discover(provider);
  const res = await fetch(doc.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      code_verifier: input.verifier,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { id_token?: string; error_description?: string; error?: string };
  if (!res.ok || !body.id_token) throw new Error(body.error_description ?? body.error ?? `token endpoint answered ${res.status}`);

  const claims = JSON.parse(Buffer.from(body.id_token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Claims;
  // Multi-tenant Microsoft documents its issuer as a template with the user's tenant in it.
  const issuer = doc.issuer.replace('{tenantid}', String(claims.tid ?? ''));
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== issuer) throw new Error('the sign-in came from an unexpected issuer');
  if (!audience.includes(provider.clientId)) throw new Error('the sign-in was meant for another app');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now() - 60_000) throw new Error('the sign-in expired');
  if (claims.nonce !== input.nonce) throw new Error('the sign-in did not match this browser');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new Error('the provider did not say who you are');

  const email = (provider.email ?? ((c) => (typeof c.email === 'string' ? c.email : undefined)))(claims)?.trim().toLowerCase();
  return {
    subject: claims.sub,
    email,
    emailVerified: Boolean(email) && (provider.emailVerified?.(claims) ?? false),
    name: typeof claims.name === 'string' ? claims.name : undefined,
  };
}
