import { describe, it, expect } from 'vitest';
import { signOpaqueIdentity, verifyOpaqueIdentity } from './opaqueIdentity.js';

describe('opaqueIdentity', () => {
  it('round-trip: signOpaqueIdentity -> verifyOpaqueIdentity returns correct sub', () => {
    const sub = 'user:abc123';
    const challengeId = 'ch_test_001';
    const opaque = signOpaqueIdentity(sub, challengeId);
    const result = verifyOpaqueIdentity(opaque, challengeId);
    expect(result).toBe(sub);
  });

  it('tampered sig returns null', () => {
    const sub = 'user:abc123';
    const challengeId = 'ch_test_002';
    const opaque = signOpaqueIdentity(sub, challengeId);
    const tampered = { ...opaque, sig: opaque.sig.replace(/^./, 'x') };
    const result = verifyOpaqueIdentity(tampered, challengeId);
    expect(result).toBeNull();
  });

  it('wrong challengeId returns null', () => {
    const sub = 'user:abc123';
    const opaque = signOpaqueIdentity(sub, 'ch_original');
    const result = verifyOpaqueIdentity(opaque, 'ch_different');
    expect(result).toBeNull();
  });

  it('missing opaque returns null', () => {
    expect(verifyOpaqueIdentity(undefined, 'ch_test')).toBeNull();
    expect(verifyOpaqueIdentity(null, 'ch_test')).toBeNull();
  });

  it('malformed opaque (missing fields) returns null', () => {
    expect(verifyOpaqueIdentity({}, 'ch_test')).toBeNull();
    expect(verifyOpaqueIdentity({ atxp_sub: 'user:abc' }, 'ch_test')).toBeNull();
    expect(verifyOpaqueIdentity({ sig: 'deadbeef' }, 'ch_test')).toBeNull();
    expect(verifyOpaqueIdentity({ atxp_sub: 123, sig: 'deadbeef' }, 'ch_test')).toBeNull();
    expect(verifyOpaqueIdentity({ atxp_sub: 'user:abc', sig: 123 }, 'ch_test')).toBeNull();
  });

  it('different sub in verify returns null', () => {
    const opaque = signOpaqueIdentity('user:alice', 'ch_test_003');
    // Tamper the sub but keep the original sig — signature won't match
    const tampered = { ...opaque, atxp_sub: 'user:bob' };
    const result = verifyOpaqueIdentity(tampered, 'ch_test_003');
    expect(result).toBeNull();
  });
});
