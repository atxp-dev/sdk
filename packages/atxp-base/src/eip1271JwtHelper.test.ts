import { describe, it, expect } from 'vitest';
import { 
  createEIP1271JWT, 
  createEIP1271AuthData,
  constructEIP1271Message
} from './eip1271JwtHelper.js';

describe('EIP-1271 JWT Helper - Hardcoded Tests', () => {
  it('should generate exact JWT from hardcoded parameters', () => {
    // These are the exact parameters that should produce the JWT used in PayMCP tests
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
    
    // This should match the exact JWT in PayMCP tests
    const expectedJWT = 'eyJhbGciOiJFSVAxMjcxIiwidHlwIjoiSldUIn0.eyJzdWIiOiIweDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Njc4OTAiLCJpc3MiOiJhY2NvdW50cy5hdHhwLmFpIiwiYXVkIjoiaHR0cHM6Ly9hdXRoLmF0eHAuYWkiLCJpYXQiOjE2NDA5OTUyMDAsImV4cCI6MTY0MDk5ODgwMCwibXNnIjoiUGF5TUNQIEF1dGhvcml6YXRpb24gUmVxdWVzdFxuXG5XYWxsZXQ6IDB4MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MFxuVGltZXN0YW1wOiAxNjQwOTk1MjAwXG5Db2RlIENoYWxsZW5nZTogdGVzdF9jaGFsbGVuZ2VfMTIzXG5QYXltZW50IFJlcXVlc3QgSUQ6IHJlcV83ODl4eXpcblxuXG5TaWduIHRoaXMgbWVzc2FnZSB0byBwcm92ZSB5b3UgY29udHJvbCB0aGlzIHdhbGxldC4iLCJjb2RlX2NoYWxsZW5nZSI6InRlc3RfY2hhbGxlbmdlXzEyMyIsInBheW1lbnRfcmVxdWVzdF9pZCI6InJlcV83ODl4eXoifQ.MHhhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFh';
    
    expect(jwt).toBe(expectedJWT);
    
    // Parse the JWT to verify structure
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
    
    // Verify signature section
    const decodedSignature = Buffer.from(sig, 'base64url').toString();
    expect(decodedSignature).toBe(signature);
  });
  
  it('should generate JWT without optional fields', () => {
    const walletAddress = '0xabcdef0123456789012345678901234567890123';
    const timestamp = 1700000000;
    const signature = '0x' + 'b'.repeat(256); // Shorter signature
    
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
});