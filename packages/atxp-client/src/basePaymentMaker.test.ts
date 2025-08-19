import { describe, it, expect } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { BasePaymentMaker } from './basePaymentMaker.js';

describe('basePaymentMaker.generateJWT', () => {
  it('should generate a valid JWT with default payload', async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const paymentMaker = new BasePaymentMaker('https://example.com', privateKey);
    const jwt = await paymentMaker.generateJWT({paymentRequestId: '', codeChallenge: 'testCodeChallenge'});

    // JWT format: header.payload.signature (all base64url)
    const [headerB64, payloadB64, signatureB64] = jwt.split('.');
    expect(headerB64).toBeDefined();
    expect(payloadB64).toBeDefined();
    expect(signatureB64).toBeDefined();

    // Decode header and payload
    const decodeB64Url = (str: string) => {
      // Pad string for base64 decoding
      let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      return JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
    };
    const header = decodeB64Url(headerB64);
    const payload = decodeB64Url(payloadB64);

    expect(header.alg).toBe('ES256K');
    expect(header.typ).toBeUndefined(); // BasePaymentMaker doesn't set typ
    expect(payload.sub).toBe(account.address);
    expect(payload.iss).toBe('accounts.atxp.ai');
    expect(payload.aud).toBe('https://auth.atxp.ai');
    expect(typeof payload.iat).toBe('number');
    expect(payload.paymentIds).toBeUndefined();

    // Signature verification would require ES256K (secp256k1) verification
    // which is different from the EdDSA verification used in SolanaPaymentMaker
    // For now, we just verify the signature is present and properly formatted
    expect(signatureB64).toBeDefined();
    expect(signatureB64.length).toBeGreaterThan(0);
    
    // Decode the signature to verify it's a hex string with 0x prefix
    const decodedSig = Buffer.from(signatureB64, 'base64url').toString('utf8');
    expect(decodedSig).toMatch(/^0x[a-fA-F0-9]+$/);
  });

  it('should include payment request id if provided', async () => {
    const privateKey = generatePrivateKey();
    const paymentMaker = new BasePaymentMaker('https://example.com', privateKey);
    const paymentRequestId = 'id1';
    const jwt = await paymentMaker.generateJWT({paymentRequestId, codeChallenge: ''});
    const [, payloadB64] = jwt.split('.');
    const decodeB64Url = (str: string) => {
      let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      return JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
    };
    const payload = decodeB64Url(payloadB64);
    expect(payload.payment_request_id).toEqual(paymentRequestId);
  });
});

