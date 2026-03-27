import { describe, it, expect } from 'vitest';
import {
  getTempoPathUSDAddress,
  getTempoChain,
  PATHUSD_CONTRACT_ADDRESS_TEMPO,
  TEMPO_MAINNET_CHAIN_ID,
  TEMPO_TESTNET_CHAIN_ID,
  tempoMainnet,
  tempoTestnet,
} from './tempoConstants.js';

describe('tempoConstants', () => {
  describe('getTempoPathUSDAddress', () => {
    it('returns correct address for mainnet', () => {
      expect(getTempoPathUSDAddress(TEMPO_MAINNET_CHAIN_ID)).toBe(PATHUSD_CONTRACT_ADDRESS_TEMPO);
    });

    it('returns correct address for testnet', () => {
      expect(getTempoPathUSDAddress(TEMPO_TESTNET_CHAIN_ID)).toBe(PATHUSD_CONTRACT_ADDRESS_TEMPO);
    });

    it('returns same address for both mainnet and testnet', () => {
      expect(getTempoPathUSDAddress(TEMPO_MAINNET_CHAIN_ID)).toBe(getTempoPathUSDAddress(TEMPO_TESTNET_CHAIN_ID));
    });

    it('throws for unsupported chain ID', () => {
      expect(() => getTempoPathUSDAddress(1)).toThrow('Unsupported Tempo Chain ID: 1');
    });

    it('throws for chain ID 0', () => {
      expect(() => getTempoPathUSDAddress(0)).toThrow('Unsupported Tempo Chain ID: 0');
    });
  });

  describe('getTempoChain', () => {
    it('returns mainnet config for mainnet chain ID', () => {
      const chain = getTempoChain(TEMPO_MAINNET_CHAIN_ID);
      expect(chain).toBe(tempoMainnet);
      expect(chain.id).toBe(4217);
      expect(chain.name).toBe('Tempo');
    });

    it('returns testnet config for testnet chain ID', () => {
      const chain = getTempoChain(TEMPO_TESTNET_CHAIN_ID);
      expect(chain).toBe(tempoTestnet);
      expect(chain.id).toBe(42431);
      expect(chain.name).toBe('Tempo Moderato');
    });

    it('throws for unsupported chain ID', () => {
      expect(() => getTempoChain(999)).toThrow('Unsupported Tempo Chain ID: 999');
    });
  });

  describe('chain configs', () => {
    it('tempoMainnet has correct structure', () => {
      expect(tempoMainnet.id).toBe(4217);
      expect(tempoMainnet.nativeCurrency.symbol).toBe('TEMPO');
      expect(tempoMainnet.nativeCurrency.decimals).toBe(18);
      expect(tempoMainnet.rpcUrls.default.http[0]).toBe('https://rpc.tempo.xyz');
    });

    it('tempoTestnet has correct structure', () => {
      expect(tempoTestnet.id).toBe(42431);
      expect(tempoTestnet.nativeCurrency.symbol).toBe('TEMPO');
      expect(tempoTestnet.nativeCurrency.decimals).toBe(18);
      expect(tempoTestnet.rpcUrls.default.http[0]).toBe('https://rpc.moderato.tempo.xyz');
    });
  });
});
