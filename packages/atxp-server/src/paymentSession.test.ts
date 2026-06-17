import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BigNumber } from 'bignumber.js';
import { PaymentSessionState, settlePaymentSession } from './paymentSession.js';
import { ProtocolSettlement } from './protocol.js';
import * as TH from './serverTestHelpers.js';

const logger = TH.logger();

describe('PaymentSession.charge', () => {
  it('accumulates charges across multiple calls', () => {
    // x402 cap of 1.00 USDC (atomic 1_000_000 / 1e6).
    const session = new PaymentSessionState('x402', 'cred', { paymentRequirements: { amount: '1000000' } }, logger);
    expect(session.cap.toNumber()).toBe(1);

    expect(session.charge(BigNumber(0.3))).toBe(true);
    expect(session.charge(BigNumber(0.2))).toBe(true);
    expect(session.spent.toNumber()).toBeCloseTo(0.5);
  });

  it('returns false and does not record when a charge would exceed the cap', () => {
    const session = new PaymentSessionState('x402', 'cred', { paymentRequirements: { amount: '500000' } }, logger);
    expect(session.cap.toNumber()).toBe(0.5);

    expect(session.charge(BigNumber(0.4))).toBe(true);
    // 0.4 + 0.2 = 0.6 > 0.5 → rejected, spent unchanged
    expect(session.charge(BigNumber(0.2))).toBe(false);
    expect(session.spent.toNumber()).toBeCloseTo(0.4);
  });

  it('allows a charge that exactly equals the cap', () => {
    const session = new PaymentSessionState('x402', 'cred', { paymentRequirements: { amount: '100000' } }, logger);
    expect(session.charge(BigNumber(0.1))).toBe(true);
    expect(session.charge(BigNumber(0.0001))).toBe(false);
  });

  it('derives cap from Solana mpp credential as micro-units (challenge.method=solana)', () => {
    // Solana MPP amounts are micro-unit integer strings → divide by 1e6.
    const credential = Buffer.from(JSON.stringify({
      challenge: { id: 'ch_1', method: 'solana', request: { amount: '250000' } },
    })).toString('base64');
    const session = new PaymentSessionState('mpp', credential, {}, logger);
    expect(session.cap.toNumber()).toBe(0.25);
  });

  it('derives cap from Tempo mpp credential as a decimal (challenge.method=tempo, NO /1e6)', () => {
    // Tempo MPP amounts are human-readable decimal strings → use as-is.
    // Regression: dividing by 1e6 made the cap 1e-9, falsely re-challenging
    // already-paid Tempo requests (infinite loop).
    const credential = Buffer.from(JSON.stringify({
      challenge: { id: 'ch_1', method: 'tempo', request: { amount: '0.001' } },
    })).toString('base64');
    const session = new PaymentSessionState('mpp', credential, {}, logger);
    expect(session.cap.toNumber()).toBe(0.001);
    // A charge at the Tempo price must fit under the cap (not be rejected).
    expect(session.charge(BigNumber(0.001))).toBe(true);
  });

  it('treats an mpp credential with no recognized method as a decimal (avoids under-scaling)', () => {
    // Missing/unknown method → decimal interpretation (safe: never under-scales).
    const credential = Buffer.from(JSON.stringify({
      challenge: { id: 'ch_1', amount: '0.05' },
    })).toString('base64');
    const session = new PaymentSessionState('mpp', credential, {}, logger);
    expect(session.cap.toNumber()).toBe(0.05);
  });

  it('derives cap from atxp credential options[].amount (human-readable)', () => {
    const credential = JSON.stringify({
      sourceAccountId: 'atxp_acct_1',
      options: [{ amount: '0.05' }],
    });
    const session = new PaymentSessionState('atxp', credential, {}, logger);
    expect(session.cap.toNumber()).toBe(0.05);
  });

  it('defaults cap to Infinity when the amount cannot be parsed (best-effort)', () => {
    // atxp credential with no amount → no limit; single-charge path still works.
    const credential = JSON.stringify({ sourceAccountId: 'atxp_acct_1', sourceAccountToken: 'tok' });
    const session = new PaymentSessionState('atxp', credential, {}, logger);
    expect(session.cap.isEqualTo(Infinity)).toBe(true);
    expect(session.charge(BigNumber(999))).toBe(true);
  });
});

describe('settlePaymentSession', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does not settle when the session was never charged (spent == 0)', async () => {
    const settleSpy = vi.spyOn(ProtocolSettlement.prototype, 'settle').mockResolvedValue({ txHash: '0x', settledAmount: '0' });
    const session = new PaymentSessionState('atxp', '{}', {}, logger);
    await settlePaymentSession(session, 'https://auth.atxp.ai', 'base:dest', undefined, logger);
    expect(settleSpy).not.toHaveBeenCalled();
    expect(session.settled).toBe(false);
  });

  it('settles once when charged, and is idempotent across repeat calls', async () => {
    const settleSpy = vi.spyOn(ProtocolSettlement.prototype, 'settle').mockResolvedValue({ txHash: '0xabc', settledAmount: '0.01' });
    const session = new PaymentSessionState('atxp', '{}', {}, logger);
    session.charge(BigNumber(0.01));

    await settlePaymentSession(session, 'https://auth.atxp.ai', 'base:dest', undefined, logger);
    await settlePaymentSession(session, 'https://auth.atxp.ai', 'base:dest', undefined, logger);

    expect(settleSpy).toHaveBeenCalledTimes(1);
    expect(session.settled).toBe(true);
  });

  it('marks settled even if settle throws, so it is not retried at close', async () => {
    const settleSpy = vi.spyOn(ProtocolSettlement.prototype, 'settle').mockRejectedValue(new Error('settle failed'));
    const session = new PaymentSessionState('atxp', '{}', {}, logger);
    session.charge(BigNumber(0.01));

    await settlePaymentSession(session, 'https://auth.atxp.ai', 'base:dest', undefined, logger);
    await settlePaymentSession(session, 'https://auth.atxp.ai', 'base:dest', undefined, logger);

    expect(settleSpy).toHaveBeenCalledTimes(1);
    expect(session.settled).toBe(true);
  });

  // "up-to" semantics: settle the accumulated actual (spent), not the cap.
  it('settles the accumulated actual (spent) as actualAmount', async () => {
    const settleSpy = vi.spyOn(ProtocolSettlement.prototype, 'settle').mockResolvedValue({ txHash: '0xabc', settledAmount: '0.003' });
    // Cap $0.01 from the credential options; charge 3x $0.001 → spent $0.003 < cap.
    const credential = JSON.stringify({ sourceAccountId: 'atxp_acct_1', options: [{ amount: '0.01' }] });
    const session = new PaymentSessionState('atxp', credential, {}, logger);
    session.charge(BigNumber(0.001));
    session.charge(BigNumber(0.001));
    session.charge(BigNumber(0.001));
    expect(session.spent.toNumber()).toBeCloseTo(0.003);
    expect(session.cap.toNumber()).toBe(0.01);

    await settlePaymentSession(session, 'https://auth.atxp.ai', 'base:dest', undefined, logger);

    expect(settleSpy).toHaveBeenCalledTimes(1);
    // 4th positional arg is actualAmount; it must equal spent ($0.003 < cap).
    const actualAmount = settleSpy.mock.calls[0][3] as BigNumber;
    expect(actualAmount.toString()).toBe(session.spent.toString());
    expect(actualAmount.toNumber()).toBeCloseTo(0.003);
  });

  it('settles an actual equal to the cap for a single charge (unchanged one-shot path)', async () => {
    const settleSpy = vi.spyOn(ProtocolSettlement.prototype, 'settle').mockResolvedValue({ txHash: '0xabc', settledAmount: '0.01' });
    const credential = JSON.stringify({ sourceAccountId: 'atxp_acct_1', options: [{ amount: '0.01' }] });
    const session = new PaymentSessionState('atxp', credential, {}, logger);
    session.charge(BigNumber(0.01));

    await settlePaymentSession(session, 'https://auth.atxp.ai', 'base:dest', undefined, logger);

    const actualAmount = settleSpy.mock.calls[0][3] as BigNumber;
    // spent === price === cap, so the settled actual equals the cap.
    expect(actualAmount.toNumber()).toBe(0.01);
    expect(actualAmount.toNumber()).toBe(session.cap.toNumber());
  });
});
