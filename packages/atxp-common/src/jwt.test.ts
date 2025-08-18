import { describe, it, expect } from 'vitest';
import { generateJWT } from './jwt.js';
import { importJWK, jwtVerify } from 'jose';
import { Keypair } from '@solana/web3.js';

function decodeB64Url(str: string) {
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
}

describe('generateJWT', () => {
  it('should generate a valid JWT with default payload', async () => {
    const keypair = Keypair.generate();
    const jwk = {
      kty: 'OKP',
      crv: 'Ed25519',
      d: Buffer.from(keypair.secretKey.slice(0, 32)).toString('base64url'),
      x: Buffer.from(keypair.publicKey.toBytes()).toString('base64url'),
    };
    const privateKey = await importJWK(jwk, 'EdDSA');
    const walletId = keypair.publicKey.toBase58();
    const jwt = await generateJWT(walletId, privateKey, 'paymentRequestId', 'codeChallenge');
    const [headerB64, payloadB64, signatureB64] = jwt.split('.');
    expect(headerB64).toBeDefined();
    expect(payloadB64).toBeDefined();
    expect(signatureB64).toBeDefined();
    const header = decodeB64Url(headerB64);
    const payload = decodeB64Url(payloadB64);
    expect(header.alg).toBe('EdDSA');
    expect(header.typ).toBe('JWT');
    expect(payload.sub).toBe(walletId);
    expect(payload.iss).toBe('atxp.ai');
    expect(payload.code_challenge).toBe('codeChallenge');
    expect(payload.payment_request_id).toBe('paymentRequestId');
    expect(payload.aud).toBe('https://api.atxp.ai');
    expect(typeof payload.iat).toBe('number');
    // Optionally, verify the JWT using jose
    const publicJwk = {
      kty: 'OKP',
      crv: 'Ed25519',
      x: Buffer.from(keypair.publicKey.toBytes()).toString('base64url'),
    };
    const publicKey = await importJWK(publicJwk, 'EdDSA');
    const { payload: verifiedPayload } = await jwtVerify(jwt, publicKey);
    expect(verifiedPayload.sub).toBe(walletId);
    const now = Math.floor(Date.now() / 1000);
    expect(payload.exp).toBeDefined();
    expect(payload.exp).toBeGreaterThanOrEqual(now + 119); // allow 1s clock drift
    expect(payload.exp).toBeLessThanOrEqual(now + 121); // allow 1s clock drift
  });

  it('should include payment request id if provided', async () => {
    const keypair = Keypair.generate();
    const jwk = {
      kty: 'OKP',
      crv: 'Ed25519',
      d: Buffer.from(keypair.secretKey.slice(0, 32)).toString('base64url'),
      x: Buffer.from(keypair.publicKey.toBytes()).toString('base64url'),
    };
    const privateKey = await importJWK(jwk, 'EdDSA');
    const walletId = keypair.publicKey.toBase58();
    const codeChallenge = 'code_challenge';
    const paymentRequestId = 'id1';
    const jwt = await generateJWT(walletId, privateKey, paymentRequestId, codeChallenge);
    const [, payloadB64] = jwt.split('.');
    const payload = decodeB64Url(payloadB64);
    expect(payload.payment_request_id).toEqual(paymentRequestId);
  });
}); 
