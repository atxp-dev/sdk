/**
 * EIP-1271 JWT helper utilities for creating properly formatted JWTs
 * from EIP-1271 auth data.
 */

interface EIP1271AuthData {
  type: 'EIP1271_AUTH';
  walletAddress: string;
  message: string;
  signature: string;
  timestamp: number;
  nonce?: string;
  code_challenge?: string;
  payment_request_id?: string;
}

interface EIP1271JWTHeader {
  alg: 'EIP1271';
  typ: 'JWT';
}

interface EIP1271JWTPayload {
  sub: string;           // walletAddress
  iss: string;           // issuer
  aud: string;           // audience
  iat: number;           // timestamp
  exp: number;           // expiration (timestamp + 3600)
  msg: string;           // the signed message
  code_challenge?: string;
  payment_request_id?: string;
}

// Helper function to convert to base64url that works in both Node.js and browsers
function toBase64Url(data: string): string {
  // Convert string to base64
  const base64 = typeof Buffer !== 'undefined'
    ? Buffer.from(data).toString('base64')
    : btoa(data);
  // Convert base64 to base64url
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Convert EIP-1271 auth data to JWT format
 * @param authData The EIP-1271 auth data (signature will be moved to JWT signature section)
 * @returns JWT string in the format header.payload.signature
 */
export function createEIP1271JWT(authData: EIP1271AuthData): string {
  // Create JWT header
  const header: EIP1271JWTHeader = {
    alg: 'EIP1271',
    typ: 'JWT'
  };

  // Create payload without signature (signature goes in JWT signature section)
  const payload: EIP1271JWTPayload = {
    sub: authData.walletAddress,
    iss: 'accounts.atxp.ai',
    aud: 'https://auth.atxp.ai',
    iat: authData.timestamp,
    exp: authData.timestamp + 3600, // 1 hour expiration
    msg: authData.message,
    ...(authData.code_challenge && { code_challenge: authData.code_challenge }),
    ...(authData.payment_request_id && { payment_request_id: authData.payment_request_id })
  };

  // Encode header and payload
  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(payload));

  // EIP-1271 signature goes in JWT signature section
  const encodedSignature = toBase64Url(authData.signature);

  // Return JWT format: header.payload.signature
  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

/**
 * Legacy function to create the old base64url encoded auth data format
 * This is kept for backward compatibility during transition period
 */
export function createLegacyEIP1271Auth(authData: EIP1271AuthData): string {
  return toBase64Url(JSON.stringify(authData));
}

/**
 * Create auth data structure from signing parameters
 */
export function createEIP1271AuthData({
  walletAddress,
  message,
  signature,
  timestamp,
  nonce,
  codeChallenge,
  paymentRequestId
}: {
  walletAddress: string;
  message: string;
  signature: string;
  timestamp: number;
  nonce?: string;
  codeChallenge?: string;
  paymentRequestId?: string;
}): EIP1271AuthData {
  return {
    type: 'EIP1271_AUTH',
    walletAddress,
    message,
    signature,
    timestamp,
    ...(nonce && { nonce }),
    ...(codeChallenge && { code_challenge: codeChallenge }),
    ...(paymentRequestId && { payment_request_id: paymentRequestId })
  };
}

/**
 * Construct the standardized message format for EIP-1271 signing
 */
export function constructEIP1271Message({
  walletAddress,
  timestamp,
  nonce,
  codeChallenge,
  paymentRequestId
}: {
  walletAddress: string;
  timestamp: number;
  nonce?: string;
  codeChallenge?: string;
  paymentRequestId?: string;
}): string {
  const messageParts = [
    `PayMCP Authorization Request`,
    ``,
    `Wallet: ${walletAddress}`,
    `Timestamp: ${timestamp}`
  ];

  if (nonce !== undefined && nonce !== null) {
    messageParts.push(`Nonce: ${nonce}`);
  }

  if (codeChallenge) {
    messageParts.push(`Code Challenge: ${codeChallenge}`);
  }

  if (paymentRequestId) {
    messageParts.push(`Payment Request ID: ${paymentRequestId}`);
  }

  messageParts.push('', '', 'Sign this message to prove you control this wallet.');
  return messageParts.join('\n');
}