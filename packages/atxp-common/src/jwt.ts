import type { CustomJWTPayload, AccountId } from "./types.js";
import { SignJWT } from 'jose';

// TODO: revisit this
const ISSUER = 'atxp.ai';
const AUDIENCE = 'https://auth.atxp.ai';

/**
 * Generate a JWT using the jose library and EdDSA (Ed25519) private key.
 * @param walletId - The subject (public key, wallet address, etc.)
 * @param privateKey - Ed25519 private key as a CryptoKey or Uint8Array
 * @param paymentRequestId - Optional payment request ID to include in the payload
 * @param codeChallenge - Optional code challenge for PKCE
 * @param accountId - Optional account ID to include in the payload
 * @returns JWT string
 */
export const generateJWT = async (
  walletId: string,
  privateKey: CryptoKey | Uint8Array,
  paymentRequestId: string,
  codeChallenge: string,
  accountId?: AccountId
): Promise<string> => {
  const payload: CustomJWTPayload = {
    code_challenge: codeChallenge,
  };
  if (paymentRequestId) payload.payment_request_id = paymentRequestId;
  if (codeChallenge) payload.code_challenge = codeChallenge;
  if (accountId) payload.account_id = accountId;

  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(walletId)
    .setExpirationTime('2m')
    .sign(privateKey);
};
