import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ATXPDestinationMaker } from './atxpDestinationMaker.js';
import { Logger, NetworkEnum, CurrencyEnum } from '@atxp/common';
import { BigNumber } from 'bignumber.js';

function makeLogger(): Logger & { warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> } {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeOption(overrides?: Record<string, unknown>) {
  return {
    network: NetworkEnum.ATXP as const,
    currency: CurrencyEnum.USDC,
    address: 'atxp_acct_abc123',
    amount: new BigNumber('5.00'),
    ...overrides,
  };
}

const sources = [
  { chain: 'base' as const, address: '0xbuyer', walletType: 'smart' as const },
  { chain: 'solana' as const, address: 'SOLbuyer', walletType: 'eoa' as const },
];

function mockFetch(destinations: unknown[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ destinations, paymentRequestId: 'pr-1' }),
  });
}

describe('ATXPDestinationMaker', () => {
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
  });

  it('parses valid destinations', async () => {
    const fetchFn = mockFetch([
      { chain: 'base', currency: 'USDC', address: '0xdest', amount: '5.00' },
      { chain: 'solana', currency: 'USDC', address: 'SOLdest', amount: '5.00' },
    ]);

    const maker = new ATXPDestinationMaker('https://accounts.test', fetchFn);
    const result = await maker.makeDestinations(makeOption(), logger, 'pr-1', sources);

    expect(result).toHaveLength(2);
    expect(result[0].chain).toBe('base');
    expect(result[1].chain).toBe('solana');
  });

  it('skips unrecognized chains instead of throwing', async () => {
    const fetchFn = mockFetch([
      { chain: 'base', currency: 'USDC', address: '0xdest', amount: '5.00' },
      { chain: 'future_chain', currency: 'USDC', address: '0xfuture', amount: '5.00' },
      { chain: 'solana', currency: 'USDC', address: 'SOLdest', amount: '5.00' },
    ]);

    const maker = new ATXPDestinationMaker('https://accounts.test', fetchFn);
    const result = await maker.makeDestinations(makeOption(), logger, 'pr-1', sources);

    expect(result).toHaveLength(2);
    expect(result[0].chain).toBe('base');
    expect(result[1].chain).toBe('solana');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('unrecognized chain "future_chain"')
    );
  });

  it('skips unrecognized currencies instead of throwing', async () => {
    const fetchFn = mockFetch([
      { chain: 'base', currency: 'USDC', address: '0xdest', amount: '5.00' },
      { chain: 'base', currency: 'DOGE', address: '0xdoge', amount: '5.00' },
    ]);

    const maker = new ATXPDestinationMaker('https://accounts.test', fetchFn);
    const result = await maker.makeDestinations(makeOption(), logger, 'pr-1', sources);

    expect(result).toHaveLength(1);
    expect(result[0].currency).toBe('USDC');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('unrecognized currency "DOGE"')
    );
  });

  it('still throws on malformed destination objects', async () => {
    const fetchFn = mockFetch([
      { chain: 'base', address: '0xdest' }, // missing currency and amount
    ]);

    const maker = new ATXPDestinationMaker('https://accounts.test', fetchFn);
    await expect(
      maker.makeDestinations(makeOption(), logger, 'pr-1', sources)
    ).rejects.toThrow('missing required fields');
  });

  it('still throws on invalid amount', async () => {
    const fetchFn = mockFetch([
      { chain: 'base', currency: 'USDC', address: '0xdest', amount: 'not-a-number' },
    ]);

    const maker = new ATXPDestinationMaker('https://accounts.test', fetchFn);
    await expect(
      maker.makeDestinations(makeOption(), logger, 'pr-1', sources)
    ).rejects.toThrow('not a valid number');
  });

  it('still throws on invalid response structure', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ bad: 'data' }),
    });

    const maker = new ATXPDestinationMaker('https://accounts.test', fetchFn);
    await expect(
      maker.makeDestinations(makeOption(), logger, 'pr-1', sources)
    ).rejects.toThrow('Invalid response');
  });

  it('returns empty array for non-atxp network', async () => {
    const fetchFn = vi.fn();
    const maker = new ATXPDestinationMaker('https://accounts.test', fetchFn);
    const result = await maker.makeDestinations(
      makeOption({ network: 'base' }),
      logger, 'pr-1', sources
    );

    expect(result).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('handles all destinations being unrecognized chains gracefully', async () => {
    const fetchFn = mockFetch([
      { chain: 'future1', currency: 'USDC', address: '0xa', amount: '5.00' },
      { chain: 'future2', currency: 'USDC', address: '0xb', amount: '5.00' },
    ]);

    const maker = new ATXPDestinationMaker('https://accounts.test', fetchFn);
    const result = await maker.makeDestinations(makeOption(), logger, 'pr-1', sources);

    expect(result).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledTimes(3); // 2 skipped + 1 "No destinations found"
  });
});
