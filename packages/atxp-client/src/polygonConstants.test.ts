import { describe, it, expect } from 'vitest';
import {
  USDC_CONTRACT_ADDRESS_POLYGON_MAINNET,
  USDC_CONTRACT_ADDRESS_POLYGON_AMOY,
  POLYGON_MAINNET,
  POLYGON_AMOY,
  getPolygonUSDCAddress,
  getPolygonByChainId,
  getPolygonMainnetWithRPC,
  getPolygonAmoyWithRPC
} from './polygonConstants.js';

describe('Polygon Constants', () => {
  describe('USDC_CONTRACT_ADDRESS_POLYGON_MAINNET', () => {
    it('should be defined with the correct address', () => {
      expect(USDC_CONTRACT_ADDRESS_POLYGON_MAINNET).toBe('0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359');
    });
  });

  describe('USDC_CONTRACT_ADDRESS_POLYGON_AMOY', () => {
    it('should be defined with the correct address', () => {
      expect(USDC_CONTRACT_ADDRESS_POLYGON_AMOY).toBe('0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582');
    });
  });

  describe('POLYGON_MAINNET', () => {
    it('should have correct chain ID', () => {
      expect(POLYGON_MAINNET.id).toBe(137);
    });

    it('should have correct name', () => {
      expect(POLYGON_MAINNET.name).toBe('Polygon');
    });

    it('should have correct native currency', () => {
      expect(POLYGON_MAINNET.nativeCurrency).toEqual({
        name: 'MATIC',
        symbol: 'MATIC',
        decimals: 18
      });
    });

    it('should have RPC URLs configured', () => {
      expect(POLYGON_MAINNET.rpcUrls.default.http).toHaveLength(1);
      expect(POLYGON_MAINNET.rpcUrls.default.http[0]).toBe('https://polygon-rpc.com');
    });

    it('should have block explorer configured', () => {
      expect(POLYGON_MAINNET.blockExplorers.default.name).toBe('PolygonScan');
      expect(POLYGON_MAINNET.blockExplorers.default.url).toBe('https://polygonscan.com');
    });

    it('should not be marked as testnet', () => {
      expect(POLYGON_MAINNET.testnet).toBeUndefined();
    });
  });

  describe('POLYGON_AMOY', () => {
    it('should have correct chain ID', () => {
      expect(POLYGON_AMOY.id).toBe(80002);
    });

    it('should have correct name', () => {
      expect(POLYGON_AMOY.name).toBe('Polygon Amoy');
    });

    it('should have correct native currency', () => {
      expect(POLYGON_AMOY.nativeCurrency).toEqual({
        name: 'MATIC',
        symbol: 'MATIC',
        decimals: 18
      });
    });

    it('should have RPC URLs configured', () => {
      expect(POLYGON_AMOY.rpcUrls.default.http).toHaveLength(1);
      expect(POLYGON_AMOY.rpcUrls.default.http[0]).toBe('https://rpc-amoy.polygon.technology');
    });

    it('should have block explorer configured', () => {
      expect(POLYGON_AMOY.blockExplorers.default.name).toBe('PolygonScan Amoy');
      expect(POLYGON_AMOY.blockExplorers.default.url).toBe('https://amoy.polygonscan.com');
    });

    it('should be marked as testnet', () => {
      expect(POLYGON_AMOY.testnet).toBe(true);
    });
  });

  describe('getPolygonUSDCAddress', () => {
    it('should return correct USDC address for mainnet (137)', () => {
      const address = getPolygonUSDCAddress(137);
      expect(address).toBe('0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359');
    });

    it('should return correct USDC address for Amoy testnet (80002)', () => {
      const address = getPolygonUSDCAddress(80002);
      expect(address).toBe('0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582');
    });

    it('should throw error for unsupported chain ID', () => {
      expect(() => getPolygonUSDCAddress(999)).toThrow(
        'Unsupported Polygon Chain ID: 999. Supported chains: 137 (mainnet), 80002 (Amoy testnet)'
      );
    });

    it('should throw error for other EVM chain IDs', () => {
      expect(() => getPolygonUSDCAddress(1)).toThrow(); // Ethereum mainnet
      expect(() => getPolygonUSDCAddress(8453)).toThrow(); // Base mainnet
      expect(() => getPolygonUSDCAddress(480)).toThrow(); // World mainnet
    });
  });

  describe('getPolygonByChainId', () => {
    it('should return POLYGON_MAINNET for chain ID 137', () => {
      const chain = getPolygonByChainId(137);
      expect(chain).toEqual(POLYGON_MAINNET);
    });

    it('should return POLYGON_AMOY for chain ID 80002', () => {
      const chain = getPolygonByChainId(80002);
      expect(chain).toEqual(POLYGON_AMOY);
    });

    it('should throw error for unsupported chain ID', () => {
      expect(() => getPolygonByChainId(999)).toThrow(
        'Unsupported Polygon Chain ID: 999. Supported chains: 137 (mainnet), 80002 (Amoy testnet)'
      );
    });

    it('should throw error with helpful message for zero', () => {
      expect(() => getPolygonByChainId(0)).toThrow('Unsupported Polygon Chain ID');
    });
  });

  describe('getPolygonMainnetWithRPC', () => {
    it('should override RPC URL while preserving other properties', () => {
      const customRpcUrl = 'https://polygon-mainnet.g.alchemy.com/v2/YOUR_API_KEY';
      const customChain = getPolygonMainnetWithRPC(customRpcUrl);

      expect(customChain.id).toBe(137);
      expect(customChain.name).toBe('Polygon');
      expect(customChain.rpcUrls.default.http).toEqual([customRpcUrl]);
      expect(customChain.blockExplorers).toEqual(POLYGON_MAINNET.blockExplorers);
      expect(customChain.nativeCurrency).toEqual(POLYGON_MAINNET.nativeCurrency);
    });

    it('should work with different RPC providers', () => {
      const infuraUrl = 'https://polygon-mainnet.infura.io/v3/YOUR_PROJECT_ID';
      const customChain = getPolygonMainnetWithRPC(infuraUrl);

      expect(customChain.rpcUrls.default.http).toEqual([infuraUrl]);
    });

    it('should not mutate the original POLYGON_MAINNET constant', () => {
      const originalRpcUrl = POLYGON_MAINNET.rpcUrls.default.http[0];
      const customRpcUrl = 'https://custom-rpc.example.com';

      getPolygonMainnetWithRPC(customRpcUrl);

      // Original should remain unchanged
      expect(POLYGON_MAINNET.rpcUrls.default.http[0]).toBe(originalRpcUrl);
    });
  });

  describe('getPolygonAmoyWithRPC', () => {
    it('should override RPC URL while preserving other properties', () => {
      const customRpcUrl = 'https://polygon-amoy.g.alchemy.com/v2/YOUR_API_KEY';
      const customChain = getPolygonAmoyWithRPC(customRpcUrl);

      expect(customChain.id).toBe(80002);
      expect(customChain.name).toBe('Polygon Amoy');
      expect(customChain.rpcUrls.default.http).toEqual([customRpcUrl]);
      expect(customChain.blockExplorers).toEqual(POLYGON_AMOY.blockExplorers);
      expect(customChain.nativeCurrency).toEqual(POLYGON_AMOY.nativeCurrency);
      expect(customChain.testnet).toBe(true);
    });

    it('should work with different RPC providers', () => {
      const infuraUrl = 'https://polygon-amoy.infura.io/v3/YOUR_PROJECT_ID';
      const customChain = getPolygonAmoyWithRPC(infuraUrl);

      expect(customChain.rpcUrls.default.http).toEqual([infuraUrl]);
    });

    it('should not mutate the original POLYGON_AMOY constant', () => {
      const originalRpcUrl = POLYGON_AMOY.rpcUrls.default.http[0];
      const customRpcUrl = 'https://custom-rpc-amoy.example.com';

      getPolygonAmoyWithRPC(customRpcUrl);

      // Original should remain unchanged
      expect(POLYGON_AMOY.rpcUrls.default.http[0]).toBe(originalRpcUrl);
    });
  });
});
