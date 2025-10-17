import { describe, it, expect } from 'vitest';
import { SolanaPaymentMaker } from './solanaPaymentMaker.js';
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

describe('solanaPaymentMaker.generateJWT', () => {
  it('should generate a valid JWT with default payload', async () => {
    const keypair = Keypair.generate();
    const paymentMaker = new SolanaPaymentMaker('https://example.com', bs58.encode(keypair.secretKey));
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

    expect(header.alg).toBe('EdDSA');
    expect(header.typ).toBe('JWT');
    expect(payload.sub).toBe(keypair.publicKey.toBase58());
    expect(payload.iss).toBe('atxp.ai');
    expect(payload.aud).toBe('https://auth.atxp.ai');
    expect(typeof payload.iat).toBe('number');
    expect(payload.paymentIds).toBeUndefined();

    // Verify signature
    const signingInput = `${headerB64}.${payloadB64}`;
    const messageBytes = new TextEncoder().encode(signingInput);
    const signature = Buffer.from(signatureB64, 'base64url');
    const isValid = nacl.sign.detached.verify(messageBytes, signature, keypair.publicKey.toBytes());
    expect(isValid).toBe(true);
  });

  it('should include payment request id if provided', async () => {
    const keypair = Keypair.generate();
    const paymentMaker = new SolanaPaymentMaker('https://example.com', bs58.encode(keypair.secretKey));
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

describe('solanaPaymentMaker.getSourceAddresses', () => {
  it('should return the Solana public key as base58', async () => {
    const keypair = Keypair.generate();
    const paymentMaker = new SolanaPaymentMaker('https://example.com', bs58.encode(keypair.secretKey));

    const result = await paymentMaker.getSourceAddresses();

    expect(result).toHaveLength(1);
    expect(result[0].network).toBe('solana');
    expect(result[0].address).toBe(keypair.publicKey.toBase58());
  });

  it('should return a valid base58 encoded address', async () => {
    const keypair = Keypair.generate();
    const paymentMaker = new SolanaPaymentMaker('https://example.com', bs58.encode(keypair.secretKey));

    const result = await paymentMaker.getSourceAddresses();

    // Should be a valid base58 string (typically 32-44 characters for Solana addresses)
    expect(result[0].address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

    // Should be decodable as base58
    expect(() => bs58.decode(result[0].address)).not.toThrow();
  });

  it('should return consistent address across multiple calls', async () => {
    const keypair = Keypair.generate();
    const paymentMaker = new SolanaPaymentMaker('https://example.com', bs58.encode(keypair.secretKey));

    const result1 = await paymentMaker.getSourceAddresses();
    const result2 = await paymentMaker.getSourceAddresses();

    expect(result1[0].address).toBe(result2[0].address);
  });
});

