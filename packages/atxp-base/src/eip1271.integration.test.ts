/**
 * @vitest-environment node
 * Integration test to verify JWT flow from SDK generation to paymcp parsing
 */

import { describe, it, expect } from 'vitest';
import { 
  createEIP1271JWT, 
  createEIP1271AuthData,
  constructEIP1271Message 
} from './eip1271JwtHelper.js';

// Mock the paymcp parsing functions (since we can't import from paymcp directly in SDK tests)
// These should match the exact implementation in paymcp
function parseEIP1271JWT_Mock(token: string) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    
    const [headerB64, payloadB64, signatureB64] = parts;
    
    // Decode header and verify it's EIP-1271
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    if (header.alg !== 'EIP1271' || header.typ !== 'JWT') {
      return null;
    }
    
    // Decode payload
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    
    // Decode signature (it was base64url encoded in the JWT)
    const signature = Buffer.from(signatureB64, 'base64url').toString('utf8');
    
    // Convert JWT payload back to EIP1271AuthData format
    return {
      type: 'EIP1271_AUTH',
      walletAddress: payload.sub,
      message: payload.msg,
      signature: signature,
      timestamp: payload.iat,
      nonce: payload.nonce,
      ...(payload.code_challenge && { code_challenge: payload.code_challenge }),
      ...(payload.payment_request_id && { payment_request_id: payload.payment_request_id })
    };
  } catch {
    return null;
  }
}

function isEIP1271JWT_Mock(token: string): boolean {
  // EIP-1271 JWT has 3 parts separated by dots and starts with proper header
  if (token.split('.').length !== 3) {
    return false;
  }
  
  try {
    const [headerB64] = token.split('.');
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    return header.alg === 'EIP1271' && header.typ === 'JWT';
  } catch {
    return false;
  }
}

describe('EIP-1271 JWT Integration', () => {
  describe('SDK to PayMCP Round Trip', () => {
    it('should generate JWT in SDK that PayMCP can parse identically', () => {
      // Simulate SDK generating JWT
      const walletAddress = '0x742D35cC85476A95c6E4C5aDB3e5c4E5c7E5c6E5';
      const timestamp = Math.floor(Date.now() / 1000);
      const nonce = 'test_nonce_123';
      const codeChallenge = 'challenge_abc_xyz';
      const paymentRequestId = 'req_payment_456';
      const mockSignature = '0x' + '1'.repeat(256) + '2'.repeat(256); // Mock 512 char sig
      
      // 1. SDK constructs message
      const message = constructEIP1271Message({
        walletAddress,
        timestamp,
        nonce,
        codeChallenge,
        paymentRequestId
      });
      
      // 2. SDK creates auth data structure
      const authData = createEIP1271AuthData({
        walletAddress,
        message,
        signature: mockSignature,
        timestamp,
        nonce,
        codeChallenge,
        paymentRequestId
      });
      
      // 3. SDK creates JWT
      const jwt = createEIP1271JWT(authData);
      
      // 4. PayMCP receives JWT and detects format
      expect(isEIP1271JWT_Mock(jwt)).toBe(true);
      
      // 5. PayMCP parses JWT
      const parsedData = parseEIP1271JWT_Mock(jwt);
      expect(parsedData).toBeTruthy();
      
      // 6. Verify data integrity - parsed data should match original
      expect(parsedData).toEqual(authData);
      
      // 7. Verify all fields are preserved
      expect(parsedData!.walletAddress).toBe(walletAddress);
      expect(parsedData!.message).toBe(message);
      expect(parsedData!.signature).toBe(mockSignature);
      expect(parsedData!.timestamp).toBe(timestamp);
      expect(parsedData!.nonce).toBe(nonce);
      expect(parsedData!.code_challenge).toBe(codeChallenge);
      expect(parsedData!.payment_request_id).toBe(paymentRequestId);
      expect(parsedData!.type).toBe('EIP1271_AUTH');
    });

    it('should handle JWT without optional fields', () => {
      const walletAddress = '0x742D35cC85476A95c6E4C5aDB3e5c4E5c7E5c6E5';
      const timestamp = Math.floor(Date.now() / 1000);
      const nonce = 'simple_nonce';
      const mockSignature = '0x' + 'a'.repeat(128);
      
      // Create minimal message
      const message = constructEIP1271Message({
        walletAddress,
        timestamp,
        nonce
      });
      
      const authData = createEIP1271AuthData({
        walletAddress,
        message,
        signature: mockSignature,
        timestamp,
        nonce
      });
      
      const jwt = createEIP1271JWT(authData);
      const parsedData = parseEIP1271JWT_Mock(jwt);
      
      expect(parsedData).toEqual(authData);
      expect(parsedData!.code_challenge).toBeUndefined();
      expect(parsedData!.payment_request_id).toBeUndefined();
    });

    it('should produce consistent results across multiple generations', () => {
      const params = {
        walletAddress: '0x1111111111111111111111111111111111111111',
        timestamp: 1640995200, // Fixed timestamp for consistency
        nonce: 'consistent_nonce',
        codeChallenge: 'consistent_challenge',
        paymentRequestId: 'consistent_request',
        mockSignature: '0x' + 'c'.repeat(200)
      };
      
      // Generate JWT multiple times with same parameters
      const jwts = Array.from({ length: 3 }, () => {
        const message = constructEIP1271Message(params);
        const authData = createEIP1271AuthData({
          walletAddress: params.walletAddress,
          message,
          signature: params.mockSignature,
          timestamp: params.timestamp,
          nonce: params.nonce,
          codeChallenge: params.codeChallenge,
          paymentRequestId: params.paymentRequestId
        });
        return createEIP1271JWT(authData);
      });
      
      // All JWTs should be identical
      expect(jwts[0]).toBe(jwts[1]);
      expect(jwts[1]).toBe(jwts[2]);
      
      // Parse them all and verify they're identical
      const parsedResults = jwts.map(jwt => parseEIP1271JWT_Mock(jwt));
      expect(parsedResults[0]).toEqual(parsedResults[1]);
      expect(parsedResults[1]).toEqual(parsedResults[2]);
    });

    it('should preserve exact message format for signature verification', () => {
      const walletAddress = '0x9999999999999999999999999999999999999999';
      const timestamp = 1640995200;
      const nonce = 'format_test_nonce';
      const codeChallenge = 'format_test_challenge';
      const paymentRequestId = 'format_test_request';
      
      const expectedMessage = `PayMCP Authorization Request

Wallet: ${walletAddress}
Timestamp: ${timestamp}
Nonce: ${nonce}
Code Challenge: ${codeChallenge}
Payment Request ID: ${paymentRequestId}


Sign this message to prove you control this wallet.`;
      
      const message = constructEIP1271Message({
        walletAddress,
        timestamp,
        nonce,
        codeChallenge,
        paymentRequestId
      });
      
      expect(message).toBe(expectedMessage);
      
      const authData = createEIP1271AuthData({
        walletAddress,
        message,
        signature: '0x' + 'f'.repeat(100),
        timestamp,
        nonce,
        codeChallenge,
        paymentRequestId
      });
      
      const jwt = createEIP1271JWT(authData);
      const parsedData = parseEIP1271JWT_Mock(jwt);
      
      // The message should be preserved exactly
      expect(parsedData!.message).toBe(expectedMessage);
    });
  });

  describe('Real-world Scenarios', () => {
    it('should handle Coinbase Smart Wallet signature format', () => {
      // Simulate a typical Coinbase Smart Wallet signature
      const longSignature = '0x' + 
        '1234567890abcdef'.repeat(32) + // 512 hex chars = 256 bytes for WebAuthn data
        'fedcba0987654321'.repeat(16);   // Additional ABI encoding
      
      const authData = createEIP1271AuthData({
        walletAddress: '0xCoinbaseSmartWallet000000000000000000000',
        message: constructEIP1271Message({
          walletAddress: '0xCoinbaseSmartWallet000000000000000000000',
          timestamp: 1640995200,
          nonce: 'cb_nonce_123'
        }),
        signature: longSignature,
        timestamp: 1640995200,
        nonce: 'cb_nonce_123'
      });
      
      const jwt = createEIP1271JWT(authData);
      expect(jwt.length).toBeLessThan(2000); // Should still be under URL limits
      
      const parsedData = parseEIP1271JWT_Mock(jwt);
      expect(parsedData!.signature).toBe(longSignature);
    });

    it('should handle edge case characters in wallet addresses', () => {
      const addresses = [
        '0x0000000000000000000000000000000000000000', // Zero address
        '0xffffffffffffffffffffffffffffffffffffffff', // Max address  
        '0xDeadBeefCafeBabe1337000000000000000000000' // Mixed case
      ];
      
      addresses.forEach(address => {
        const authData = createEIP1271AuthData({
          walletAddress: address,
          message: constructEIP1271Message({
            walletAddress: address,
            timestamp: 1640995200,
            nonce: 'edge_case_test'
          }),
          signature: '0x' + 'e'.repeat(200),
          timestamp: 1640995200,
          nonce: 'edge_case_test'
        });
        
        const jwt = createEIP1271JWT(authData);
        const parsedData = parseEIP1271JWT_Mock(jwt);
        
        expect(parsedData!.walletAddress).toBe(address);
      });
    });
  });

  describe('Performance and Size Validation', () => {
    it('should demonstrate JWT size efficiency', () => {
      const testCases = [
        { name: 'Minimal', optional: false },
        { name: 'With code challenge', codeChallenge: 'test_challenge' },
        { name: 'With payment request', paymentRequestId: 'test_request' },
        { name: 'With both optional fields', codeChallenge: 'test_challenge', paymentRequestId: 'test_request' }
      ];
      
      testCases.forEach(testCase => {
        const authData = createEIP1271AuthData({
          walletAddress: '0x1234567890123456789012345678901234567890',
          message: constructEIP1271Message({
            walletAddress: '0x1234567890123456789012345678901234567890',
            timestamp: 1640995200,
            nonce: 'size_test_nonce',
            codeChallenge: testCase.codeChallenge,
            paymentRequestId: testCase.paymentRequestId
          }),
          signature: '0x' + 'a'.repeat(512), // Typical smart wallet signature size
          timestamp: 1640995200,
          nonce: 'size_test_nonce',
          codeChallenge: testCase.codeChallenge,
          paymentRequestId: testCase.paymentRequestId
        });
        
        const jwt = createEIP1271JWT(authData);
        console.log(`${testCase.name}: ${jwt.length} characters`);
        
        expect(jwt.length).toBeLessThan(2000);
        
        // Verify parsing still works
        const parsed = parseEIP1271JWT_Mock(jwt);
        expect(parsed).toEqual(authData);
      });
    });
  });
});