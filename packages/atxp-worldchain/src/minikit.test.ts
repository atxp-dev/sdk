import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { parseUnits } from 'viem';
import { MiniKit } from '@worldcoin/minikit-js';
import { ConsoleLogger } from '@atxp/common';
import { createMiniKitWorldchainAccount, resolveTransactionHash, waitForTransactionConfirmation } from './minikit.js';
import { WorldchainAccount } from './worldchainAccount.js';

// Mock external dependencies
vi.mock('@worldcoin/minikit-js', () => ({
  MiniKit: {
    commandsAsync: {
      sendTransaction: vi.fn(),
      signMessage: vi.fn()
    }
  }
}));

vi.mock('./worldchainAccount.js', () => ({
  WorldchainAccount: {
    initialize: vi.fn()
  }
}));

vi.mock('viem', () => ({
  parseUnits: vi.fn()
}));

// Mock global fetch
global.fetch = vi.fn();

describe('createMiniKitWorldchainAccount', () => {
  let mockLogger: ConsoleLogger;
  let mockWorldchainAccount: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = new ConsoleLogger();
    mockWorldchainAccount = {
      address: '0x1234567890123456789012345678901234567890'
    };

    (parseUnits as Mock).mockReturnValue(BigInt('10000000')); // 10 USDC
    (WorldchainAccount.initialize as Mock).mockResolvedValue(mockWorldchainAccount);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create a MiniKit Worldchain account with default parameters', async () => {
    const walletAddress = '0x1234567890123456789012345678901234567890';

    const account = await createMiniKitWorldchainAccount({ walletAddress, miniKit: MiniKit });

    expect(WorldchainAccount.initialize).toHaveBeenCalledWith({
      walletAddress,
      provider: expect.any(Object),
      allowance: BigInt('10000000'),
      useEphemeralWallet: false,
      periodInDays: 30,
      customRpcUrl: 'https://worldchain-mainnet.g.alchemy.com/public'
    });
    expect(account).toBe(mockWorldchainAccount);
  });

  it('should create a MiniKit Worldchain account with custom logger and RPC URL', async () => {
    const walletAddress = '0x1234567890123456789012345678901234567890';
    const customRpcUrl = 'https://custom-rpc.example.com';

    const account = await createMiniKitWorldchainAccount({
      walletAddress,
      logger: mockLogger,
      customRpcUrl,
      miniKit: MiniKit
    });

    expect(WorldchainAccount.initialize).toHaveBeenCalledWith({
      walletAddress,
      provider: expect.any(Object),
      allowance: BigInt('10000000'),
      useEphemeralWallet: false,
      periodInDays: 30,
      customRpcUrl
    });
    expect(account).toBe(mockWorldchainAccount);
  });

  describe('provider methods', () => {
    let provider: any;

    beforeEach(async () => {
      const walletAddress = '0x1234567890123456789012345678901234567890';
      await createMiniKitWorldchainAccount({ walletAddress, logger: mockLogger, miniKit: MiniKit });

      const initializeCall = (WorldchainAccount.initialize as Mock).mock.calls[0];
      provider = initializeCall[0].provider;
    });

    it('should handle eth_accounts request', async () => {
      const result = await provider.request({ method: 'eth_accounts', params: [] });
      expect(result).toEqual(['0x1234567890123456789012345678901234567890']);
    });

    it('should handle eth_chainId request', async () => {
      const result = await provider.request({ method: 'eth_chainId', params: [] });
      expect(result).toBe('0x1e0'); // Worldchain chain ID (480)
    });

    it('should handle eth_requestAccounts request', async () => {
      const result = await provider.request({ method: 'eth_requestAccounts', params: [] });
      expect(result).toEqual(['0x1234567890123456789012345678901234567890']);
    });

    it('should handle personal_sign request', async () => {
      const mockSignResult = {
        finalPayload: {
          status: 'success',
          signature: '0xsignature123'
        }
      };
      (MiniKit.commandsAsync.signMessage as Mock).mockResolvedValue(mockSignResult);

      const result = await provider.request({
        method: 'personal_sign',
        params: ['test message']
      });

      expect(MiniKit.commandsAsync.signMessage).toHaveBeenCalledWith({
        message: 'test message'
      });
      expect(result).toBe('0xsignature123');
    });

    it('should throw error for personal_sign when signing fails', async () => {
      const mockSignResult = {
        finalPayload: {
          status: 'error',
          error_code: 'user_cancelled'
        }
      };
      (MiniKit.commandsAsync.signMessage as Mock).mockResolvedValue(mockSignResult);

      await expect(provider.request({
        method: 'personal_sign',
        params: ['test message']
      })).rejects.toThrow('MiniKit signing failed: user_cancelled');
    });

    it('should throw error for unsupported methods', async () => {
      await expect(provider.request({
        method: 'unsupported_method',
        params: []
      })).rejects.toThrow('Method unsupported_method not supported in MiniKit context');
    });
  });
});

describe('handleSendTransaction (via provider)', () => {
  let provider: any;
  let loggerSpy: { debug: Mock, warn: Mock, error: Mock };

  beforeEach(async () => {
    loggerSpy = {
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    const mockLogger = { ...loggerSpy } as any;

    const walletAddress = '0x1234567890123456789012345678901234567890';
    await createMiniKitWorldchainAccount({ walletAddress, logger: mockLogger, miniKit: MiniKit });

    const initializeCall = (WorldchainAccount.initialize as Mock).mock.calls[0];
    provider = initializeCall[0].provider;
  });

  it('should handle USDC transfer transaction successfully', async () => {
    const mockSendResult = {
      finalPayload: {
        status: 'success',
        transaction_id: 'tx123'
      }
    };

    (MiniKit.commandsAsync.sendTransaction as Mock).mockResolvedValue(mockSendResult);
    (fetch as Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        transactionHash: '0xhash123',
        transactionStatus: 'success'
      })
    });

    const transaction = {
      to: '0xUSDC_CONTRACT_ADDRESS',
      data: '0xa9059cbb000000000000000000000000recipient12345678901234567890123400000000000000000000000000000000000000000000000000000000000000000989680', // transfer(recipient, 10000000)
      from: '0x1234567890123456789012345678901234567890'
    };

    const result = await provider.request({
      method: 'eth_sendTransaction',
      params: [transaction]
    });

    expect(MiniKit.commandsAsync.sendTransaction).toHaveBeenCalledWith({
      transaction: [{
        address: '0xUSDC_CONTRACT_ADDRESS',
        abi: expect.arrayContaining([
          expect.objectContaining({
            name: 'transfer',
            type: 'function'
          })
        ]),
        functionName: 'transfer',
        args: ['0xrecipient1234567890123456789012340000000', '10000000'],
        value: "0"
      }]
    });
    expect(result).toBe('0xhash123');
  });

  it('should handle USDC transfer with memo data', async () => {
    const mockSendResult = {
      finalPayload: {
        status: 'success',
        transaction_id: 'tx123'
      }
    };

    (MiniKit.commandsAsync.sendTransaction as Mock).mockResolvedValue(mockSendResult);
    (fetch as Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        transactionHash: '0xhash123',
        transactionStatus: 'success'
      })
    });

    const transaction = {
      to: '0xUSDC_CONTRACT_ADDRESS',
      data: '0xa9059cbb000000000000000000000000recipient123456789012345678901234000000000000000000000000000000000000000000000000000000000000000009896804d656d6f20646174612074657374', // transfer(recipient, 10000000) + memo (128 chars standard + memo)
      from: '0x1234567890123456789012345678901234567890'
    };

    const result = await provider.request({
      method: 'eth_sendTransaction',
      params: [transaction]
    });

    // Should complete successfully even with memo data (memo will be ignored by MiniKit)
    expect(result).toBe('0xhash123');
    expect(MiniKit.commandsAsync.sendTransaction).toHaveBeenCalled();
  });

  it('should handle insufficient balance error with user-friendly message', async () => {
    const mockSendResult = {
      finalPayload: {
        status: 'error',
        error_code: 'simulation_failed',
        details: {
          simulationError: 'transfer amount exceeds balance'
        }
      }
    };

    (MiniKit.commandsAsync.sendTransaction as Mock).mockResolvedValue(mockSendResult);

    const transaction = {
      to: '0xUSDC_CONTRACT_ADDRESS',
      data: '0xa9059cbb000000000000000000000000recipient1234567890123456789012340000000000000000000000000000000000000000000000000000000000000000989680',
      from: '0x1234567890123456789012345678901234567890'
    };

    await expect(provider.request({
      method: 'eth_sendTransaction',
      params: [transaction]
    })).rejects.toThrow(/💳 Insufficient USDC Balance/);
  });

  it('should throw error for ETH transfers', async () => {
    const transaction = {
      to: '0x1234567890123456789012345678901234567890',
      data: '0x',
      from: '0x1234567890123456789012345678901234567890'
    };

    await expect(provider.request({
      method: 'eth_sendTransaction',
      params: [transaction]
    })).rejects.toThrow('ETH transfers require Forward contract - not implemented yet');
  });

  it('should throw error for unsupported transaction types', async () => {
    const transaction = {
      to: '0x1234567890123456789012345678901234567890',
      data: '0x12345678', // unknown method
      from: '0x1234567890123456789012345678901234567890'
    };

    await expect(provider.request({
      method: 'eth_sendTransaction',
      params: [transaction]
    })).rejects.toThrow('Unsupported transaction type. Data: 0x12345678');
  });
});

describe('resolveTransactionHash', () => {
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn()
    };
    vi.clearAllMocks();
  });

  it('should resolve transaction hash successfully', async () => {
    const mockResponse = {
      transactionHash: '0xhash123',
      transactionStatus: 'success',
      transactionId: 'tx123',
      network: 'worldchain',
      fromWalletAddress: '0x123',
      toContractAddress: '0x456'
    };

    (fetch as Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse)
    });

    const result = await resolveTransactionHash('tx123', mockLogger);

    expect(fetch).toHaveBeenCalledWith('/api/resolve-transaction', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ transactionId: 'tx123' })
    });

    expect(result).toEqual({
      transactionHash: '0xhash123',
      status: 'success'
    });
  });

  it('should return null when API request fails', async () => {
    (fetch as Mock).mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not found')
    });

    const result = await resolveTransactionHash('tx123', mockLogger);

    expect(result).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledWith('[WorldTransaction] API error: 404 Not found');
  });

  it('should return null when fetch throws error', async () => {
    (fetch as Mock).mockRejectedValue(new Error('Network error'));

    const result = await resolveTransactionHash('tx123', mockLogger);

    expect(result).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('[WorldTransaction] Error resolving transaction: Error: Network error')
    );
  });
});

describe('waitForTransactionConfirmation', () => {
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    };
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should wait for transaction confirmation and return result', async () => {
    let callCount = 0;
    (fetch as Mock).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First call - pending
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            transactionHash: '0xhash123',
            transactionStatus: 'pending'
          })
        });
      } else {
        // Second call - success
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            transactionHash: '0xhash123',
            transactionStatus: 'success'
          })
        });
      }
    });

    const resultPromise = waitForTransactionConfirmation('tx123', mockLogger, 10000, 1000);

    // Wait for the first call
    await vi.runOnlyPendingTimersAsync();

    // Fast forward time to trigger the second poll
    vi.advanceTimersByTime(1000);
    await vi.runOnlyPendingTimersAsync();

    const result = await resultPromise;

    expect(result).toEqual({
      transactionHash: '0xhash123',
      status: 'success'
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  }, 10000);

  it('should timeout and return null when transaction is not confirmed in time', async () => {
    (fetch as Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        transactionHash: '0xhash123',
        transactionStatus: 'pending'
      })
    });

    const resultPromise = waitForTransactionConfirmation('tx123', mockLogger, 3000, 1000);

    // Fast forward past the timeout
    vi.advanceTimersByTime(4000);
    await vi.runOnlyPendingTimersAsync();

    const result = await resultPromise;

    expect(result).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      '[WorldTransaction] Timeout waiting for transaction confirmation: tx123'
    );
  }, 10000);

  it('should return immediately when transaction hash is not available', async () => {
    (fetch as Mock).mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not found')
    });

    const resultPromise = waitForTransactionConfirmation('tx123', mockLogger, 10000, 1000);

    // Fast forward past the timeout
    vi.advanceTimersByTime(11000);
    await vi.runOnlyPendingTimersAsync();

    const result = await resultPromise;

    expect(result).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      '[WorldTransaction] Timeout waiting for transaction confirmation: tx123'
    );
  }, 10000);
});