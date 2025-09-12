/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { 
  createEIP1271JWT, 
  createLegacyEIP1271Auth, 
  createEIP1271AuthData,
  constructEIP1271Message 
} from './eip1271JwtHelper.js';

describe('EIP1271 JWT Helper', () => {
  const mockAuthData = {
    type: 'EIP1271_AUTH' as const,
    walletAddress: '0x1234567890123456789012345678901234567890',
    message: `PayMCP Authorization Request

Wallet: 0x1234567890123456789012345678901234567890
Timestamp: 1640995200
Nonce: abc123def456
Code Challenge: test_challenge_123
Payment Request ID: req_789xyz


Sign this message to prove you control this wallet.`,
    signature: '0x' + 'a'.repeat(512), // Mock ABI-encoded signature
    timestamp: 1640995200,
    nonce: 'abc123def456',
    code_challenge: 'test_challenge_123',
    payment_request_id: 'req_789xyz'
  };

  describe('constructEIP1271Message', () => {
    it('should construct message with all parameters', () => {
      const message = constructEIP1271Message({
        walletAddress: mockAuthData.walletAddress,
        timestamp: mockAuthData.timestamp,
        nonce: mockAuthData.nonce,
        codeChallenge: mockAuthData.code_challenge,
        paymentRequestId: mockAuthData.payment_request_id
      });

      expect(message).toBe(mockAuthData.message);
    });

    it('should construct message without optional parameters', () => {
      const message = constructEIP1271Message({
        walletAddress: mockAuthData.walletAddress,
        timestamp: mockAuthData.timestamp,
        nonce: mockAuthData.nonce
      });

      const expectedMessage = `PayMCP Authorization Request

Wallet: ${mockAuthData.walletAddress}
Timestamp: ${mockAuthData.timestamp}
Nonce: ${mockAuthData.nonce}


Sign this message to prove you control this wallet.`;

      expect(message).toBe(expectedMessage);
    });
  });

  describe('createEIP1271AuthData', () => {
    it('should create auth data with all fields', () => {
      const authData = createEIP1271AuthData({
        walletAddress: mockAuthData.walletAddress,
        message: mockAuthData.message,
        signature: mockAuthData.signature,
        timestamp: mockAuthData.timestamp,
        nonce: mockAuthData.nonce,
        codeChallenge: mockAuthData.code_challenge,
        paymentRequestId: mockAuthData.payment_request_id
      });

      expect(authData).toEqual(mockAuthData);
    });

    it('should create auth data without optional fields', () => {
      const authData = createEIP1271AuthData({
        walletAddress: mockAuthData.walletAddress,
        message: mockAuthData.message,
        signature: mockAuthData.signature,
        timestamp: mockAuthData.timestamp,
        nonce: mockAuthData.nonce
      });

      expect(authData).toEqual({
        type: 'EIP1271_AUTH',
        walletAddress: mockAuthData.walletAddress,
        message: mockAuthData.message,
        signature: mockAuthData.signature,
        timestamp: mockAuthData.timestamp,
        nonce: mockAuthData.nonce
      });
    });
  });

  describe('createEIP1271JWT', () => {
    it('should create valid JWT with proper structure', () => {
      const jwt = createEIP1271JWT(mockAuthData);
      
      // JWT should have 3 parts separated by dots
      const parts = jwt.split('.');
      expect(parts).toHaveLength(3);
      
      const [headerB64, payloadB64, signatureB64] = parts;
      
      // Decode and verify header
      const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
      expect(header).toEqual({
        alg: 'EIP1271',
        typ: 'JWT'
      });
      
      // Decode and verify payload
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
      expect(payload).toEqual({
        sub: mockAuthData.walletAddress,
        iss: 'accounts.atxp.ai',
        aud: 'https://auth.atxp.ai',
        iat: mockAuthData.timestamp,
        exp: mockAuthData.timestamp + 3600,
        nonce: mockAuthData.nonce,
        msg: mockAuthData.message,
        code_challenge: mockAuthData.code_challenge,
        payment_request_id: mockAuthData.payment_request_id
      });
      
      // Decode and verify signature
      const signature = Buffer.from(signatureB64, 'base64url').toString('utf8');
      expect(signature).toBe(mockAuthData.signature);
    });

    it('should create valid JWT without optional fields', () => {
      const minimalAuthData = {
        type: 'EIP1271_AUTH' as const,
        walletAddress: mockAuthData.walletAddress,
        message: mockAuthData.message,
        signature: mockAuthData.signature,
        timestamp: mockAuthData.timestamp,
        nonce: mockAuthData.nonce
      };
      
      const jwt = createEIP1271JWT(minimalAuthData);
      
      const parts = jwt.split('.');
      expect(parts).toHaveLength(3);
      
      const [, payloadB64] = parts;
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
      
      expect(payload).toEqual({
        sub: minimalAuthData.walletAddress,
        iss: 'accounts.atxp.ai',
        aud: 'https://auth.atxp.ai',
        iat: minimalAuthData.timestamp,
        exp: minimalAuthData.timestamp + 3600,
        nonce: minimalAuthData.nonce,
        msg: minimalAuthData.message
      });
      
      // Optional fields should not be present
      expect(payload.code_challenge).toBeUndefined();
      expect(payload.payment_request_id).toBeUndefined();
    });
  });

  describe('createLegacyEIP1271Auth', () => {
    it('should create base64url encoded auth data', () => {
      const legacyAuth = createLegacyEIP1271Auth(mockAuthData);
      
      // Should be a base64url string without dots
      expect(legacyAuth).not.toContain('.');
      expect(legacyAuth).toMatch(/^[A-Za-z0-9_-]+$/);
      
      // Should decode back to original data
      const decoded = JSON.parse(Buffer.from(legacyAuth, 'base64url').toString('utf8'));
      expect(decoded).toEqual(mockAuthData);
    });
  });

  describe('JWT size constraints', () => {
    it('should generate JWT under browser URL limits', () => {
      const jwt = createEIP1271JWT(mockAuthData);
      
      // Should be well under 2083 characters (IE/Edge limit)
      expect(jwt.length).toBeLessThan(2000);
      console.log(`JWT length: ${jwt.length} characters`);
      
      // Compare with legacy format
      const legacy = createLegacyEIP1271Auth(mockAuthData);
      console.log(`Legacy format length: ${legacy.length} characters`);
      
      // JWT format should not be significantly larger
      const sizeDifference = jwt.length - legacy.length;
      expect(Math.abs(sizeDifference)).toBeLessThan(500); // Allow some reasonable overhead
    });
  });

  describe('Round-trip compatibility', () => {
    it('should produce deterministic output for same input', () => {
      const jwt1 = createEIP1271JWT(mockAuthData);
      const jwt2 = createEIP1271JWT(mockAuthData);
      
      expect(jwt1).toBe(jwt2);
    });

    it('should handle edge cases in data', () => {
      const edgeCaseData = createEIP1271AuthData({
        walletAddress: '0x0000000000000000000000000000000000000000',
        message: 'Simple message',
        signature: '0x' + '0'.repeat(64), // Minimal signature
        timestamp: 0,
        nonce: '1'
      });
      
      const jwt = createEIP1271JWT(edgeCaseData);
      expect(jwt.split('.')).toHaveLength(3);
    });
  });
});