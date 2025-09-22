import { describe, it, expect } from 'vitest';
import {
  createEIP1271JWT,
  createEIP1271AuthData,
  constructEIP1271Message
} from './eip1271JwtHelper.js';

describe('EIP-1271 JWT Helper', () => {
  it('should generate exact JWT from hardcoded parameters', () => {
    // These are the exact parameters that should produce consistent JWTs for testing
    const walletAddress = '0x1234567890123456789012345678901234567890';
    const timestamp = 1640995200;
    const codeChallenge = 'test_challenge_123';
    const paymentRequestId = 'req_789xyz';

    // Use a reasonable test signature that complies with server minimum (256 hex chars)
    const signature = '0x' + 'a'.repeat(256);

    // Construct the message
    const message = constructEIP1271Message({
      walletAddress,
      timestamp,
      codeChallenge,
      paymentRequestId
    });

    // Verify message format
    expect(message).toBe(
      'PayMCP Authorization Request\n' +
      '\n' +
      'Wallet: 0x1234567890123456789012345678901234567890\n' +
      'Timestamp: 1640995200\n' +
      'Code Challenge: test_challenge_123\n' +
      'Payment Request ID: req_789xyz\n' +
      '\n' +
      '\n' +
      'Sign this message to prove you control this wallet.'
    );

    // Create auth data
    const authData = createEIP1271AuthData({
      walletAddress,
      message,
      signature,
      timestamp,
      codeChallenge,
      paymentRequestId
    });

    // Generate JWT
    const jwt = createEIP1271JWT(authData);

    // Verify JWT structure instead of exact match (since signature encoding may vary)
    expect(jwt).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    // Parse and verify the JWT contents
    const [header, payload, sig] = jwt.split('.');

    // Decode and verify header
    const decodedHeader = JSON.parse(Buffer.from(header, 'base64url').toString());
    expect(decodedHeader).toEqual({
      alg: 'EIP1271',
      typ: 'JWT'
    });

    // Decode and verify payload
    const decodedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString());
    expect(decodedPayload).toEqual({
      sub: '0x1234567890123456789012345678901234567890',
      iss: 'accounts.atxp.ai',
      aud: 'https://auth.atxp.ai',
      iat: 1640995200,
      exp: 1640998800,
      msg: message,
      code_challenge: 'test_challenge_123',
      payment_request_id: 'req_789xyz'
    });

    // Decode and verify signature
    const decodedSignature = Buffer.from(sig, 'base64url').toString();
    expect(decodedSignature).toBe(signature);
  });

  it('should generate JWT without optional fields', () => {
    const walletAddress = '0xabcdef0123456789012345678901234567890123';
    const timestamp = 1700000000;
    const signature = '0x' + 'b'.repeat(256);

    const message = constructEIP1271Message({
      walletAddress,
      timestamp
    });

    const authData = createEIP1271AuthData({
      walletAddress,
      message,
      signature,
      timestamp
    });

    const jwt = createEIP1271JWT(authData);

    // Parse JWT
    const [, payload] = jwt.split('.');
    const decodedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString());

    // Verify optional fields are not present
    expect(decodedPayload.code_challenge).toBeUndefined();
    expect(decodedPayload.payment_request_id).toBeUndefined();
    expect(decodedPayload.nonce).toBeUndefined();
  });

  it('should handle messages without payment request ID', () => {
    const walletAddress = '0x1234567890123456789012345678901234567890';
    const timestamp = 1640995200;
    const codeChallenge = 'test_challenge_456';

    const message = constructEIP1271Message({
      walletAddress,
      timestamp,
      codeChallenge
      // No paymentRequestId
    });

    expect(message).toBe(
      'PayMCP Authorization Request\n' +
      '\n' +
      'Wallet: 0x1234567890123456789012345678901234567890\n' +
      'Timestamp: 1640995200\n' +
      'Code Challenge: test_challenge_456\n' +
      '\n' +
      '\n' +
      'Sign this message to prove you control this wallet.'
    );
  });

  it('should create auth data with all required fields', () => {
    const walletAddress = '0x9876543210987654321098765432109876543210';
    const message = 'Test message';
    const signature = '0x' + 'c'.repeat(256);
    const timestamp = 1640995300;
    const codeChallenge = 'test_challenge';
    const paymentRequestId = 'req_123';

    const authData = createEIP1271AuthData({
      walletAddress,
      message,
      signature,
      timestamp,
      codeChallenge,
      paymentRequestId
    });

    expect(authData).toEqual({
      type: 'EIP1271_AUTH',
      walletAddress,
      message,
      signature,
      timestamp,
      code_challenge: codeChallenge,
      payment_request_id: paymentRequestId
    });
  });

  it('should create auth data without optional payment request ID', () => {
    const walletAddress = '0x9876543210987654321098765432109876543210';
    const message = 'Test message';
    const signature = '0x' + 'd'.repeat(256);
    const timestamp = 1640995400;
    const codeChallenge = 'test_challenge_2';

    const authData = createEIP1271AuthData({
      walletAddress,
      message,
      signature,
      timestamp,
      codeChallenge
      // No paymentRequestId
    });

    expect(authData).toEqual({
      type: 'EIP1271_AUTH',
      walletAddress,
      message,
      signature,
      timestamp,
      code_challenge: codeChallenge
    });

    // Should not have payment_request_id field
    expect(authData).not.toHaveProperty('payment_request_id');
  });

  it('should generate different JWTs for different inputs', () => {
    const baseParams = {
      walletAddress: '0x1111111111111111111111111111111111111111',
      timestamp: 1640995200,
      codeChallenge: 'challenge1',
      signature: '0x' + 'e'.repeat(256)
    };

    const message1 = constructEIP1271Message(baseParams);
    const authData1 = createEIP1271AuthData({
      ...baseParams,
      message: message1
    });
    const jwt1 = createEIP1271JWT(authData1);

    const message2 = constructEIP1271Message({
      ...baseParams,
      codeChallenge: 'challenge2'
    });
    const authData2 = createEIP1271AuthData({
      ...baseParams,
      message: message2,
      codeChallenge: 'challenge2'
    });
    const jwt2 = createEIP1271JWT(authData2);

    // JWTs should be different
    expect(jwt1).not.toBe(jwt2);

    // But both should be valid JWT format
    expect(jwt1.split('.')).toHaveLength(3);
    expect(jwt2.split('.')).toHaveLength(3);
  });
});