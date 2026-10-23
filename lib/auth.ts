// Shared-password auth for the demo. NOT production-grade: one password for
// everyone, no per-user identity, no rate limiting. The session cookie is an
// expiry timestamp signed with HMAC-SHA256 keyed on APP_PASSWORD, so changing
// the password signs everyone out. Uses Web Crypto so it works in proxy.ts too.

export const SESSION_COOKIE = "dpa_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

const encoder = new TextEncoder();

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Constant-time password check (compares HMACs, so lengths do not leak). */
export async function passwordMatches(secret: string, attempt: string): Promise<boolean> {
  if (!secret) return false;
  const [a, b] = await Promise.all([hmac(secret, `pw:${attempt}`), hmac(secret, `pw:${secret}`)]);
  return equalBytes(a, b);
}

export async function createSessionToken(secret: string, now = Date.now()): Promise<string> {
  const expires = now + SESSION_MAX_AGE_SECONDS * 1000;
  const sig = toBase64Url(await hmac(secret, `session:${expires}`));
  return `${expires}.${sig}`;
}

export async function verifySessionToken(
  secret: string,
  token: string | undefined,
  now = Date.now(),
): Promise<boolean> {
  if (!secret || !token) return false;
  const [expiresText, sig] = token.split(".");
  const expires = Number(expiresText);
  if (!sig || !Number.isFinite(expires) || expires < now) return false;
  const expected = toBase64Url(await hmac(secret, `session:${expires}`));
  return equalBytes(encoder.encode(expected), encoder.encode(sig));
}

/** Only allow same-site relative redirects after login. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  return next;
}
