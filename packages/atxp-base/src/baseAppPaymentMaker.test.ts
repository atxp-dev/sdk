import { describe, it, expect } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http } from 'viem';
import { base } from 'viem/chains';
import { BaseAppPaymentMaker } from './baseAppPaymentMaker.js';
// import { SpendPermission } from './types.js';

describe('basePaymentMaker.generateJWT', () => {
  it('should generate EIP-1271 auth data with default payload', async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({
      account,
      chain: base,
      transport: http('https://example.com')
    });
    const paymentMaker = new BaseAppPaymentMaker('https://example.com', walletClient);
    const authData = await paymentMaker.generateJWT({paymentRequestId: '', codeChallenge: 'testCodeChallenge'});

    // Should return base64-encoded EIP-1271 auth data
    expect(authData).toBeDefined();
    expect(typeof authData).toBe('string');
    
    // Decode and verify the auth data
    const decoded = JSON.parse(Buffer.from(authData, 'base64').toString('utf-8'));
    expect(decoded.type).toBe('EIP1271_AUTH');
    expect(decoded.walletAddress).toBe(account.address);
    expect(decoded.message).toContain('PayMCP Authorization Request');
    expect(decoded.signature).toBeDefined();
    expect(decoded.timestamp).toBeDefined();
    expect(decoded.nonce).toBeDefined();
    expect(decoded.code_challenge).toBe('testCodeChallenge');


  });

  it('should include payment request id if provided', async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({
      account,
      chain: base,
      transport: http('https://example.com')
    });
    const paymentMaker = new BaseAppPaymentMaker('https://example.com', walletClient);
    const paymentRequestId = 'id1';
    const authData = await paymentMaker.generateJWT({paymentRequestId, codeChallenge: ''});
    
    // Decode and verify the auth data includes payment request ID
    const decoded = JSON.parse(Buffer.from(authData, 'base64').toString('utf-8'));
    expect(decoded.payment_request_id).toEqual(paymentRequestId);
    expect(decoded.message).toContain(`Payment Request ID: ${paymentRequestId}`);
  });
});

