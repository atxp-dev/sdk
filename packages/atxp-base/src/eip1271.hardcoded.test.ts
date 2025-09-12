/**
 * @vitest-environment node
 * Test that verifies exact JWT output for hardcoded inputs
 */

import { describe, it, expect } from 'vitest';
import { 
  createEIP1271JWT, 
  createEIP1271AuthData,
  constructEIP1271Message 
} from './eip1271JwtHelper.js';

describe('EIP-1271 JWT Hardcoded Input/Output', () => {
  it('should produce exact JWT string for hardcoded inputs', () => {
    const walletAddress = '0x742D35cC85476A95c6E4C5aDB3e5c4E5c7E5c6E5';
    const timestamp = 1640995200;
    const codeChallenge = 'xyz789_challenge';
    const paymentRequestId = 'req_payment_456';
    const signature = '0x' + '1234567890abcdef'.repeat(32);
    
    const message = constructEIP1271Message({
      walletAddress,
      timestamp,
      codeChallenge,
      paymentRequestId
    });
    
    const authData = createEIP1271AuthData({
      walletAddress,
      message,
      signature,
      timestamp,
      codeChallenge,
      paymentRequestId
    });
    
    const jwt = createEIP1271JWT(authData);
    
    const expectedJWT = 'eyJhbGciOiJFSVAxMjcxIiwidHlwIjoiSldUIn0.eyJzdWIiOiIweDc0MkQzNWNDODU0NzZBOTVjNkU0QzVhREIzZTVjNEU1YzdFNWM2RTUiLCJpc3MiOiJhY2NvdW50cy5hdHhwLmFpIiwiYXVkIjoiaHR0cHM6Ly9hdXRoLmF0eHAuYWkiLCJpYXQiOjE2NDA5OTUyMDAsImV4cCI6MTY0MDk5ODgwMCwibXNnIjoiUGF5TUNQIEF1dGhvcml6YXRpb24gUmVxdWVzdFxuXG5XYWxsZXQ6IDB4NzQyRDM1Y0M4NTQ3NkE5NWM2RTRDNWFEQjNlNWM0RTVjN0U1YzZFNVxuVGltZXN0YW1wOiAxNjQwOTk1MjAwXG5Db2RlIENoYWxsZW5nZTogeHl6Nzg5X2NoYWxsZW5nZVxuUGF5bWVudCBSZXF1ZXN0IElEOiByZXFfcGF5bWVudF80NTZcblxuXG5TaWduIHRoaXMgbWVzc2FnZSB0byBwcm92ZSB5b3UgY29udHJvbCB0aGlzIHdhbGxldC4iLCJjb2RlX2NoYWxsZW5nZSI6Inh5ejc4OV9jaGFsbGVuZ2UiLCJwYXltZW50X3JlcXVlc3RfaWQiOiJyZXFfcGF5bWVudF80NTYifQ.MHgxMjM0NTY3ODkwYWJjZGVmMTIzNDU2Nzg5MGFiY2RlZjEyMzQ1Njc4OTBhYmNkZWYxMjM0NTY3ODkwYWJjZGVmMTIzNDU2Nzg5MGFiY2RlZjEyMzQ1Njc4OTBhYmNkZWYxMjM0NTY3ODkwYWJjZGVmMTIzNDU2Nzg5MGFiY2RlZjEyMzQ1Njc4OTBhYmNkZWYxMjM0NTY3ODkwYWJjZGVmMTIzNDU2Nzg5MGFiY2RlZjEyMzQ1Njc4OTBhYmNkZWYxMjM0NTY3ODkwYWJjZGVmMTIzNDU2Nzg5MGFiY2RlZjEyMzQ1Njc4OTBhYmNkZWYxMjM0NTY3ODkwYWJjZGVmMTIzNDU2Nzg5MGFiY2RlZjEyMzQ1Njc4OTBhYmNkZWYxMjM0NTY3ODkwYWJjZGVmMTIzNDU2Nzg5MGFiY2RlZjEyMzQ1Njc4OTBhYmNkZWYxMjM0NTY3ODkwYWJjZGVmMTIzNDU2Nzg5MGFiY2RlZjEyMzQ1Njc4OTBhYmNkZWYxMjM0NTY3ODkwYWJjZGVmMTIzNDU2Nzg5MGFiY2RlZjEyMzQ1Njc4OTBhYmNkZWYxMjM0NTY3ODkwYWJjZGVmMTIzNDU2Nzg5MGFiY2RlZjEyMzQ1Njc4OTBhYmNkZWYxMjM0NTY3ODkwYWJjZGVmMTIzNDU2Nzg5MGFiY2RlZjEyMzQ1Njc4OTBhYmNkZWY';
    
    expect(jwt).toBe(expectedJWT);
    expect(jwt.length).toBeLessThan(2000);
  });

  it('should produce exact JWT string for minimal inputs', () => {
    const walletAddress = '0x1111111111111111111111111111111111111111';
    const timestamp = 1500000000;
    const signature = '0x' + 'abcdef123456'.repeat(22) + 'abcdef1234';
    
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
    
    const expectedJWT = 'eyJhbGciOiJFSVAxMjcxIiwidHlwIjoiSldUIn0.eyJzdWIiOiIweDExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJpc3MiOiJhY2NvdW50cy5hdHhwLmFpIiwiYXVkIjoiaHR0cHM6Ly9hdXRoLmF0eHAuYWkiLCJpYXQiOjE1MDAwMDAwMDAsImV4cCI6MTUwMDAwMzYwMCwibXNnIjoiUGF5TUNQIEF1dGhvcml6YXRpb24gUmVxdWVzdFxuXG5XYWxsZXQ6IDB4MTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMVxuVGltZXN0YW1wOiAxNTAwMDAwMDAwXG5cblxuU2lnbiB0aGlzIG1lc3NhZ2UgdG8gcHJvdmUgeW91IGNvbnRyb2wgdGhpcyB3YWxsZXQuIn0.MHhhYmNkZWYxMjM0NTZhYmNkZWYxMjM0NTZhYmNkZWYxMjM0NTZhYmNkZWYxMjM0NTZhYmNkZWYxMjM0NTZhYmNkZWYxMjM0NTZhYmNkZWYxMjM0NTZhYmNkZWYxMjM0NTZhYmNkZWYxMjM0NTZhYmNkZWYxMjM0NTZhYmNkZWYxMjM0NTZhYmNkZWYxMjM0NTZhYmNkZWYxMjM0NTZhYmNkZWYxMjM0NTZhYmNkZWYxMjM0NTZhYmNkZWYxMjM0NTZhYmNkZWYxMjM0NTZhYmNkZWYxMjM0NTZhYmNkZWYxMjM0NTZhYmNkZWYxMjM0NTZhYmNkZWYxMjM0NTZhYmNkZWYxMjM0NTZhYmNkZWYxMjM0';
    
    expect(jwt).toBe(expectedJWT);
    expect(jwt.length).toBeLessThan(1000);
  });
});