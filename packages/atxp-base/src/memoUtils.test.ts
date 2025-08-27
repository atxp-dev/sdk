import { describe, it, expect } from 'vitest';
import { createMemoCall, decodeMemoData } from './memoUtils.js';

describe('memoUtils', () => {
  describe('createMemoCall', () => {
    it('should create a valid memo call for a simple memo', () => {
      const memo = 'test memo';
      const result = createMemoCall(memo);
      
      expect(result).not.toBeNull();
      expect(result!.to).toBe('0x0000000000000000000000000000000000000000');
      expect(result!.value).toBe('0x0');
      expect(result!.data).toBe('0x74657374206d656d6f'); // 'test memo' in hex
    });

    it('should create a valid memo call for a memo with special characters', () => {
      const memo = 'Hello, 世界! 🌍';
      const result = createMemoCall(memo);
      
      expect(result).not.toBeNull();
      expect(result!.to).toBe('0x0000000000000000000000000000000000000000');
      expect(result!.value).toBe('0x0');
      // UTF-8 encoded hex for 'Hello, 世界! 🌍'
      expect(result!.data).toMatch(/^0x[0-9a-f]+$/);
      
      // Verify the memo can be decoded back
      const decoded = decodeMemoData(result!.data);
      expect(decoded).toBe(memo);
    });

    it('should return null for empty memo', () => {
      const result = createMemoCall('');
      expect(result).toBeNull();
    });

    it('should return null for whitespace-only memo', () => {
      const result = createMemoCall('   ');
      expect(result).toBeNull();
    });

    it('should trim whitespace from memo', () => {
      const memo = '  test memo  ';
      const result = createMemoCall(memo);
      
      expect(result).not.toBeNull();
      expect(result!.data).toBe('0x74657374206d656d6f'); // 'test memo' in hex (trimmed)
    });

    it('should handle long memos', () => {
      const memo = 'a'.repeat(1000);
      const result = createMemoCall(memo);
      
      expect(result).not.toBeNull();
      expect(result!.data).toMatch(/^0x[0-9a-f]+$/);
      expect(result!.data.length).toBe(2 + memo.length * 2); // '0x' + hex chars
    });
  });

  describe('decodeMemoData', () => {
    it('should decode valid hex memo data', () => {
      const hexData = '0x74657374206d656d6f'; // 'test memo' in hex
      const result = decodeMemoData(hexData);
      
      expect(result).toBe('test memo');
    });

    it('should decode memo data without 0x prefix', () => {
      const hexData = '74657374206d656d6f' as `0x${string}`; // 'test memo' in hex
      const result = decodeMemoData(hexData);
      
      expect(result).toBe('test memo');
    });

    it('should decode memo with special characters', () => {
      const memo = 'Hello, 世界! 🌍';
      const memoCall = createMemoCall(memo);
      const result = decodeMemoData(memoCall!.data);
      
      expect(result).toBe(memo);
    });

    it('should return null for empty hex string', () => {
      const result = decodeMemoData('0x' as `0x${string}`);
      expect(result).toBeNull();
    });

    it('should return null for invalid hex string (odd length)', () => {
      const result = decodeMemoData('0x123' as `0x${string}`);
      expect(result).toBeNull();
    });

    it('should return null for non-hex characters', () => {
      const result = decodeMemoData('0x123g456' as `0x${string}`);
      expect(result).toBeNull();
    });

    it('should handle round-trip encoding/decoding', () => {
      const testCases = [
        'simple memo',
        'memo with numbers 12345',
        'special chars !@#$%^&*()',
        'unicode: 你好世界',
        'emoji: 🎉🚀⭐',
        'mixed: Hello 世界 123 🎉'
      ];

      testCases.forEach(memo => {
        const memoCall = createMemoCall(memo);
        const decoded = decodeMemoData(memoCall!.data);
        expect(decoded).toBe(memo);
      });
    });
  });

  describe('integration tests', () => {
    it('should create consistent memo calls', () => {
      const memo = 'consistent test';
      const call1 = createMemoCall(memo);
      const call2 = createMemoCall(memo);
      
      expect(call1).toEqual(call2);
    });

    it('should produce different data for different memos', () => {
      const call1 = createMemoCall('memo1');
      const call2 = createMemoCall('memo2');
      
      expect(call1!.data).not.toBe(call2!.data);
    });

    it('should maintain type safety', () => {
      const result = createMemoCall('test');
      expect(result!.to).toMatch(/^0x[0-9a-fA-F]{40}$/); // Valid Ethereum address
      expect(result!.data).toMatch(/^0x[0-9a-fA-F]*$/); // Valid hex string
      expect(result!.value).toMatch(/^0x[0-9a-fA-F]*$/); // Valid hex string
    });
  });
});