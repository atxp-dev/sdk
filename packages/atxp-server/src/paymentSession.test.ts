import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BigNumber } from 'bignumber.js';
import { PaymentSessionState, settlePaymentSession } from './paymentSession.js';
import { ProtocolSettlement } from './protocol.js';
import * as TH from './serverTestHelpers.js';

const logger = TH.logger();

/** A TIP-1034 Tempo session credential (channel opened on-chain at authorize). */
function sessionCredential(amountDecimal = '0.01'): string {
  return Buffer.from(JSON.stringify({
    challenge: { id: 'ch_1', method: 'tempo', intent: 'session', request: { amount: amountDecimal } },
    payload: {
      action: 'voucher',
      channelId: '0x' + 'aa'.repeat(32),
      descriptor: { payer: '0x2', payee: '0x1' },
      cumulativeAmount: '10000',
      signature: '0x' + 'bb'.repeat(65),
    },
    source: 'tempo:0xpayer',
  })).toString('base64');
}

/** An MPP one-shot `charge` credential (no on-chain channel; no intent/descriptor). */
function chargeCredential(): string {
  return Buffer.from(JSON.stringify({
    challenge: { id: 'ch_1', method: 'tempo', request: { amount: '0.01' } },
    payload: { action: 'transaction', transaction: '0xdeadbeef' },
    source: 'tempo:0xpayer',
  })).toString('base64');
}

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

  it('settles an actual equal to the cap when the single charge equals the cap (price >= minimumPayment)', async () => {
    const settleSpy = vi.spyOn(ProtocolSettlement.prototype, 'settle').mockResolvedValue({ txHash: '0xabc', settledAmount: '0.01' });
    const credential = JSON.stringify({ sourceAccountId: 'atxp_acct_1', options: [{ amount: '0.01' }] });
    const session = new PaymentSessionState('atxp', credential, {}, logger);
    session.charge(BigNumber(0.01));

    await settlePaymentSession(session, 'https://auth.atxp.ai', 'base:dest', undefined, logger);

    const actualAmount = settleSpy.mock.calls[0][3] as BigNumber;
    // Here the single charge happens to equal the cap, so actual === cap.
    expect(actualAmount.toNumber()).toBe(0.01);
    expect(actualAmount.toNumber()).toBe(session.cap.toNumber());
  });

  it('settles the metered price (< cap) for a single charge when the cap was inflated by minimumPayment', async () => {
    const settleSpy = vi.spyOn(ProtocolSettlement.prototype, 'settle').mockResolvedValue({ txHash: '0xabc', settledAmount: '0.001' });
    // Cap $0.01 (the challenge amount = max(minimumPayment, price)); the tool's
    // actual price is $0.001. A single charge settles the price, NOT the cap —
    // "up-to" for a one-shot call. Guards against regressing to cap-settling.
    const credential = JSON.stringify({ sourceAccountId: 'atxp_acct_1', options: [{ amount: '0.01' }] });
    const session = new PaymentSessionState('atxp', credential, {}, logger);
    session.charge(BigNumber(0.001));

    await settlePaymentSession(session, 'https://auth.atxp.ai', 'base:dest', undefined, logger);

    const actualAmount = settleSpy.mock.calls[0][3] as BigNumber;
    expect(actualAmount.toNumber()).toBeCloseTo(0.001);
    expect(actualAmount.isLessThan(session.cap)).toBe(true);
  });

  // --- TIP-1034 channel sessions (requiresClose) ---

  it('flags requiresClose only for MPP session credentials', () => {
    expect(new PaymentSessionState('mpp', sessionCredential(), {}, logger).requiresClose).toBe(true);
    // One-shot MPP charge: no on-chain channel to tear down.
    expect(new PaymentSessionState('mpp', chargeCredential(), {}, logger).requiresClose).toBe(false);
    expect(new PaymentSessionState('atxp', JSON.stringify({ options: [{ amount: '0.01' }] }), {}, logger).requiresClose).toBe(false);
    expect(new PaymentSessionState('x402', 'cred', { paymentRequirements: { amount: '100000' } }, logger).requiresClose).toBe(false);
  });

  it('settles a channel session even at spent == 0 (closes + refunds the locked deposit)', async () => {
    // Bug: the early-return on spent<=0 strands the on-chain deposit opened at
    // authorize. A session must still settle (capture 0, refund the deposit).
    const settleSpy = vi.spyOn(ProtocolSettlement.prototype, 'settle').mockResolvedValue({ txHash: '0xclose', settledAmount: '0' });
    const session = new PaymentSessionState('mpp', sessionCredential(), {}, logger);
    expect(session.spent.toNumber()).toBe(0);

    await settlePaymentSession(session, 'https://auth.atxp.ai', 'tempo:dest', undefined, logger);

    expect(settleSpy).toHaveBeenCalledTimes(1);
    expect((settleSpy.mock.calls[0][3] as BigNumber).toNumber()).toBe(0);
    expect(session.settled).toBe(true);
  });

  it('leaves a channel session unsettled when settle throws, so the locked deposit can be re-driven', async () => {
    const settleSpy = vi.spyOn(ProtocolSettlement.prototype, 'settle').mockRejectedValueOnce(new Error('auth unreachable'));
    const session = new PaymentSessionState('mpp', sessionCredential(), {}, logger);
    session.charge(BigNumber(0.003));

    await settlePaymentSession(session, 'https://auth.atxp.ai', 'tempo:dest', undefined, logger);
    // Failure must NOT mark settled — otherwise the deposit is stranded forever.
    expect(session.settled).toBe(false);
    expect(settleSpy).toHaveBeenCalledTimes(1);

    // A later re-drive succeeds (on-chain close is idempotent).
    settleSpy.mockResolvedValueOnce({ txHash: '0xclose', settledAmount: '0.003' });
    await settlePaymentSession(session, 'https://auth.atxp.ai', 'tempo:dest', undefined, logger);
    expect(settleSpy).toHaveBeenCalledTimes(2);
    expect(session.settled).toBe(true);
  });

  it('settles at most once under re-entrant calls (settling guard)', async () => {
    let resolveSettle: (v: { txHash: string; settledAmount: string }) => void = () => {};
    const settleSpy = vi.spyOn(ProtocolSettlement.prototype, 'settle')
      .mockReturnValue(new Promise((r) => { resolveSettle = r; }));
    const session = new PaymentSessionState('mpp', sessionCredential(), {}, logger);
    session.charge(BigNumber(0.001));

    const p1 = settlePaymentSession(session, 'https://auth.atxp.ai', 'tempo:dest', undefined, logger);
    const p2 = settlePaymentSession(session, 'https://auth.atxp.ai', 'tempo:dest', undefined, logger);
    resolveSettle({ txHash: '0xclose', settledAmount: '0.001' });
    await Promise.all([p1, p2]);

    expect(settleSpy).toHaveBeenCalledTimes(1);
    expect(session.settled).toBe(true);
  });
});
