import { SignJWT, jwtVerify } from 'jose';
import { randomUUID } from 'crypto';

const RAW = process.env.PRISM_SECRET;

// Production guard — fail hard rather than run with a known secret
if (!RAW && process.env.NODE_ENV === 'production') {
  throw new Error(
    '[Prism] PRISM_SECRET is not set. Generate one: openssl rand -base64 32 ' +
    'and add it to your Vercel environment variables before deploying.'
  );
}

const WARN_KEY = RAW ? RAW : 'prism-dev-secret-UNSAFE-do-NOT-use-in-prod-00000';
if (!RAW) console.warn('[Prism] WARNING: running with dev secret — set PRISM_SECRET before deploying');

const key = new TextEncoder().encode(WARN_KEY);

export async function signToken(payload, expiresIn = '12h') {
  // Inject jti for token revocation denylist support unless caller already provides one
  const payloadWithJti = payload.jti ? payload : { ...payload, jti: randomUUID() };
  return new SignJWT(payloadWithJti)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

export async function verifyToken(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key);
    return payload;
  } catch {
    return null;
  }
}

// Derive a one-time code HMAC for password reset tokens
export async function signResetCode(email) {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const payload = { email, code, type: 'pw-reset', exp: Math.floor(Date.now() / 1000) + 1800 }; // 30 min
  const token = await signToken(payload, '30m');
  return { code, token };
}

export async function verifyResetToken(token) {
  const p = await verifyToken(token);
  if (!p || p.type !== 'pw-reset') return null;
  return p;
}

export function cookieOpts(maxAge, secure = process.env.NODE_ENV === 'production') {
  return `HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export function clearCookieOpts() {
  return cookieOpts(0);
}
