/**
 * Who is calling. `authenticate` turns a request into a user, or null to reject it.
 * Use one of these helpers, or write your own around any sign-in system.
 */

export interface User {
  id: string;
  name?: string;
  email?: string;
}

export type Authenticate = (request: Request) => User | null | Promise<User | null>;

function bearer(request: Request): string | undefined {
  const header = request.headers.get('Authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
}

/**
 * Fixed access tokens, one per user: `tokenAuth({ 'long-random-token': { id: 'asha', name: 'Asha' } })`.
 * Good for internal tools and machine clients. Compare tokens in constant time.
 */
export function tokenAuth(tokens: Record<string, User | string>): Authenticate {
  const entries = Object.entries(tokens).map(([token, user]) => [new TextEncoder().encode(token), typeof user === 'string' ? { id: user } : user] as const);
  return (request) => {
    const given = bearer(request);
    if (!given) return null;
    const bytes = new TextEncoder().encode(given);
    for (const [token, user] of entries) {
      if (token.length !== bytes.length) continue;
      let diff = 0;
      for (let i = 0; i < token.length; i++) diff |= token[i]! ^ bytes[i]!;
      if (diff === 0) return user;
    }
    return null;
  };
}

function base64url(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export interface JwtOptions {
  /** The HS256 signing secret (Supabase: the project's JWT secret). */
  secret: string;
  issuer?: string;
  audience?: string;
  /** Turn verified claims into a user. Default: id from `sub`, plus `name` and `email`. */
  user?(claims: Record<string, unknown>): User | null;
}

/**
 * Signed tokens (JWT, HS256) from your sign-in provider, checked for signature, expiry,
 * issuer and audience. For providers that sign with RS256 keys, write your own
 * `authenticate` around a JWKS library.
 */
export function jwtAuth(options: JwtOptions): Authenticate {
  const key = crypto.subtle.importKey('raw', new TextEncoder().encode(options.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return async (request) => {
    const token = bearer(request);
    const [head, body, signature] = token?.split('.') ?? [];
    if (!head || !body || !signature) return null;
    try {
      const header = JSON.parse(new TextDecoder().decode(base64url(head))) as { alg?: string };
      if (header.alg !== 'HS256') return null;
      const valid = await crypto.subtle.verify('HMAC', await key, base64url(signature), new TextEncoder().encode(`${head}.${body}`));
      if (!valid) return null;
      const claims = JSON.parse(new TextDecoder().decode(base64url(body))) as Record<string, unknown>;
      const now = Date.now() / 1000;
      if (typeof claims.exp === 'number' && claims.exp < now) return null;
      if (typeof claims.nbf === 'number' && claims.nbf > now) return null;
      if (options.issuer && claims.iss !== options.issuer) return null;
      if (options.audience) {
        const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
        if (!aud.includes(options.audience)) return null;
      }
      if (options.user) return options.user(claims);
      if (typeof claims.sub !== 'string') return null;
      return {
        id: claims.sub,
        ...(typeof claims.name === 'string' ? { name: claims.name } : {}),
        ...(typeof claims.email === 'string' ? { email: claims.email } : {}),
      };
    } catch {
      return null;
    }
  };
}
