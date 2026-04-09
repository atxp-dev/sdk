/**
 * Opaque Identity — signed user identity embedded in MPP challenge opaque fields.
 *
 * When an MCP server issues an MPP challenge, the OAuth user identity is
 * embedded in the challenge's `opaque` field with an HMAC signature.
 * On the retry request (where `Authorization: Payment` replaces
 * `Authorization: Bearer`), the server recovers the user identity from
 * the echoed-back opaque field and verifies the HMAC.
 *
 * This solves the conflict between MPP's `Authorization: Payment` and
 * OAuth's `Authorization: Bearer` — only one can occupy the header.
 * The opaque field carries the identity without a custom header.
 *
 * Security model:
 * - HMAC key is per-process (random 32 bytes at startup), never leaves the server
 * - HMAC binds the identity to the challenge ID — can't replay across challenges
 * - Challenges are short-lived (~5 min), so key rotation on restart is acceptable
 * - External MPP clients without opaque get anonymous identity (settlement still works)
 */

import { createHmac, randomBytes } from 'crypto';

// HMAC key for signing opaque identity fields.
// - ATXP_OPAQUE_KEY env var (base64): use when running multiple instances behind
//   a load balancer so that any instance can verify tokens signed by another.
// - Random fallback: safe for single-instance deployments; key rotates on restart
//   but challenges are short-lived (~5 min) so this is acceptable.
const HMAC_KEY = (() => {
  const envKey = process.env.ATXP_OPAQUE_KEY;
  if (envKey) return Buffer.from(envKey, 'base64');
  return randomBytes(32);
})();

/**
 * Sign a user identity for embedding in an MPP challenge's opaque field.
 */
export function signOpaqueIdentity(sub: string, challengeId: string): { atxp_sub: string; sig: string } {
  const sig = createHmac('sha256', HMAC_KEY)
    .update(`${sub}:${challengeId}`)
    .digest('hex');
  return { atxp_sub: sub, sig };
}

/**
 * Verify and extract user identity from an MPP credential's opaque field.
 * Returns the user sub if valid, null otherwise.
 */
export function verifyOpaqueIdentity(
  opaque: Record<string, unknown> | undefined | null,
  challengeId: string,
): string | null {
  if (!opaque || typeof opaque !== 'object') return null;

  const sub = opaque.atxp_sub;
  const sig = opaque.sig;
  if (typeof sub !== 'string' || typeof sig !== 'string') return null;

  const expected = createHmac('sha256', HMAC_KEY)
    .update(`${sub}:${challengeId}`)
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  if (sig.length !== expected.length) return null;
  let mismatch = 0;
  for (let i = 0; i < sig.length; i++) {
    mismatch |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  }

  return mismatch === 0 ? sub : null;
}
