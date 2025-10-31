import type { AccountId } from './types.js';

/**
 * ES256K JWT Helper for Browser Wallets
 *
 * This module provides functions to create ES256K JWTs for Ethereum EOA (Externally Owned Account)
 * wallets in browser environments. Unlike EIP-1271 which is designed for smart contract wallets,
 * ES256K works with standard ECDSA signatures from wallets like MetaMask.
 *
 * The auth server verifies these JWTs using cryptographic signature recovery, which:
 * - Works with standard 65-byte ECDSA signatures (r, s, v)
 * - Doesn't require smart contract calls
 * - Is faster and more efficient for EOA wallets
 */

const ISSUER = 'atxp.ai';
const AUDIENCE = 'https://auth.atxp.ai';

export interface ES256KJWTPayload {
  sub: string;  // Subject - wallet address or accountId
  iss: string;  // Issuer - always 'atxp.ai'
  aud: string;  // Audience - always 'https://auth.atxp.ai'
  iat: number;  // Issued at - Unix timestamp
  exp: number;  // Expiration - Unix timestamp
  code_challenge?: string;  // PKCE code challenge
  payment_request_id?: string;  // Payment request ID
  account_id?: AccountId;  // Optional account ID (e.g., 'polygon:0x...')
  source_address?: string;  // Source wallet address (when different from sub)
}

/**
 * Build the unsigned JWT message that needs to be signed
 *
 * @param params Parameters for building the JWT message
 * @returns Object containing the message to sign and the encoded header/payload
 */
export function buildES256KJWTMessage(params: {
  walletAddress: string;
  codeChallenge: string;
  paymentRequestId: string;
  accountId?: AccountId | null;
}): { message: string; headerB64: string; payloadB64: string } {
  const now = Math.floor(Date.now() / 1000);

  // Build the payload
  const payload: ES256KJWTPayload = {
    sub: params.accountId || params.walletAddress,
    iss: ISSUER,
    aud: AUDIENCE,
    iat: now,
    exp: now + 120, // 2 minutes expiration
  };

  // Add optional fields only if they have values
  if (params.codeChallenge) {
    payload.code_challenge = params.codeChallenge;
  }
  if (params.paymentRequestId) {
    payload.payment_request_id = params.paymentRequestId;
  }
  if (params.accountId) {
    payload.account_id = params.accountId;
    payload.source_address = params.walletAddress;
  }

  // Create JWT header
  const header = {
    alg: 'ES256K',
    typ: 'JWT'
  };

  // Encode header and payload as base64url
  const headerB64 = base64urlEncode(JSON.stringify(header));
  const payloadB64 = base64urlEncode(JSON.stringify(payload));

  // The message to sign is header.payload
  const message = `${headerB64}.${payloadB64}`;

  return { message, headerB64, payloadB64 };
}

/**
 * Complete an ES256K JWT with a signature
 *
 * @param params Parameters for completing the JWT
 * @param params.message The message that was signed (header.payload)
 * @param params.signature The ECDSA signature from personal_sign (0x... 130 hex chars / 65 bytes)
 * @returns Complete ES256K JWT string
 */
export function completeES256KJWT(params: {
  message: string;
  signature: string;
}): string {
  // Convert the signature from hex to base64url
  // The signature from personal_sign is in format: 0x + r (32 bytes) + s (32 bytes) + v (1 byte)
  // For JWT ES256K, we need just r + s in base64url format (v is implicit)
  let signature = params.signature;
  if (signature.startsWith('0x')) {
    signature = signature.slice(2);
  }

  // Validate signature length (should be 130 hex chars = 65 bytes)
  if (signature.length !== 130) {
    throw new Error(`Invalid signature length: expected 130 hex chars, got ${signature.length}`);
  }

  // Extract r and s (first 64 bytes, ignore v which is the last byte)
  const rHex = signature.slice(0, 64);
  const sHex = signature.slice(64, 128);
  const vHex = signature.slice(128, 130);

  // Convert r and s to bytes
  const rBytes = hexToBytes(rHex);
  const sBytes = hexToBytes(sHex);
  const vByte = parseInt(vHex, 16);

  // Normalize v to 0 or 1 (MetaMask returns 27/28, but we need 0/1)
  const vNormalized = vByte >= 27 ? vByte - 27 : vByte;

  // Combine r + s + v as a single byte array
  const signatureBytes = new Uint8Array(65);
  signatureBytes.set(rBytes, 0);
  signatureBytes.set(sBytes, 32);
  signatureBytes[64] = vNormalized;

  // Encode as base64url
  const signatureB64 = base64urlEncodeBytes(signatureBytes);

  // Construct the JWT
  return `${params.message}.${signatureB64}`;
}

/**
 * Base64URL encode a string
 */
function base64urlEncode(str: string): string {
  // Convert string to bytes
  const bytes = new TextEncoder().encode(str);
  return base64urlEncodeBytes(bytes);
}

/**
 * Base64URL encode a byte array
 */
function base64urlEncodeBytes(bytes: Uint8Array): string {
  // Convert to base64
  let base64 = '';
  if (typeof Buffer !== 'undefined') {
    // Node.js environment
    base64 = Buffer.from(bytes).toString('base64');
  } else {
    // Browser environment
    const binary = Array.from(bytes).map(b => String.fromCharCode(b)).join('');
    base64 = btoa(binary);
  }

  // Convert base64 to base64url (replace +/= with -_)
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Convert hex string to bytes
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}
