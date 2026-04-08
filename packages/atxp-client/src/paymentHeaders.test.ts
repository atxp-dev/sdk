import { describe, it, expect } from 'vitest';
import { buildPaymentHeaders } from './paymentHeaders.js';
import type { AuthorizeResult } from './paymentHeaders.js';

describe('buildPaymentHeaders', () => {
  it('x402: sets X-PAYMENT header and Access-Control-Expose-Headers', () => {
    const result: AuthorizeResult = { protocol: 'x402', credential: 'x402-cred-abc' };
    const headers = buildPaymentHeaders(result);

    expect(headers.get('X-PAYMENT')).toBe('x402-cred-abc');
    expect(headers.get('Access-Control-Expose-Headers')).toBe('X-PAYMENT-RESPONSE');
  });

  it('mpp: sets Authorization: Payment header', () => {
    const result: AuthorizeResult = { protocol: 'mpp', credential: 'mpp-token-123' };
    const headers = buildPaymentHeaders(result);

    expect(headers.get('Authorization')).toBe('Payment mpp-token-123');
  });

  it('atxp: does not set payment headers (no-op)', () => {
    const result: AuthorizeResult = { protocol: 'atxp', credential: 'atxp-cred' };
    const headers = buildPaymentHeaders(result);

    expect(headers.get('X-PAYMENT')).toBeNull();
    expect(headers.get('Authorization')).toBeNull();
    expect(headers.get('Access-Control-Expose-Headers')).toBeNull();
  });

  it('preserves existing Headers object', () => {
    const original = new Headers({ 'Content-Type': 'application/json', 'X-Custom': 'keep-me' });
    const result: AuthorizeResult = { protocol: 'x402', credential: 'cred' };
    const headers = buildPaymentHeaders(result, original);

    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('X-Custom')).toBe('keep-me');
    expect(headers.get('X-PAYMENT')).toBe('cred');
  });

  it('preserves plain object headers', () => {
    const original = { 'Content-Type': 'text/plain', 'Accept': 'application/json' };
    const result: AuthorizeResult = { protocol: 'mpp', credential: 'tok' };
    const headers = buildPaymentHeaders(result, original);

    expect(headers.get('Content-Type')).toBe('text/plain');
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.get('Authorization')).toBe('Payment tok');
  });

  it('handles undefined original headers', () => {
    const result: AuthorizeResult = { protocol: 'x402', credential: 'val' };
    const headers = buildPaymentHeaders(result, undefined);

    expect(headers.get('X-PAYMENT')).toBe('val');
    expect(headers.get('Access-Control-Expose-Headers')).toBe('X-PAYMENT-RESPONSE');
  });
});
