import { describe, it, expect } from 'vitest';
import {
  PaymentProtocolEnum,
  type PaymentProtocol,
  type ProtocolFlag,
  type ChainFlag,
  type Chain,
} from './types.js';

describe('PaymentProtocol types', () => {
  it('PaymentProtocolEnum has expected values', () => {
    expect(PaymentProtocolEnum.ATXP).toBe('atxp');
    expect(PaymentProtocolEnum.X402).toBe('x402');
    expect(PaymentProtocolEnum.MPP).toBe('mpp');
  });

  it('PaymentProtocol type accepts valid values', () => {
    const atxp: PaymentProtocol = 'atxp';
    const x402: PaymentProtocol = 'x402';
    const mpp: PaymentProtocol = 'mpp';
    expect(atxp).toBe('atxp');
    expect(x402).toBe('x402');
    expect(mpp).toBe('mpp');
  });

  it('ProtocolFlag returns a PaymentProtocol', () => {
    const flag: ProtocolFlag = (userId: string, destination: string) => {
      if (destination.startsWith('tempo:')) return 'mpp';
      if (destination.startsWith('base:')) return 'x402';
      return 'atxp';
    };
    expect(flag('user1', 'tempo:0x123')).toBe('mpp');
    expect(flag('user1', 'base:0x456')).toBe('x402');
    expect(flag('user1', 'solana:abc')).toBe('atxp');
  });

  it('ChainFlag returns a Chain', () => {
    const chainFlag: ChainFlag = (userId: string, destination: string) => {
      if (destination.startsWith('tempo:')) return 'base' as Chain; // placeholder until tempo is added
      return 'solana';
    };
    expect(chainFlag('user1', 'tempo:0x123')).toBe('base');
    expect(chainFlag('user1', 'solana:abc')).toBe('solana');
  });
});
