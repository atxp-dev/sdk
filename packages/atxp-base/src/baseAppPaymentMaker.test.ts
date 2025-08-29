import { describe, it, expect, vi } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { BaseAppPaymentMaker } from './baseAppPaymentMaker.js';
import type { SpendPermission } from './types.js';
import type { EphemeralSmartWallet } from './smartWalletHelpers.js';
import { USDC_CONTRACT_ADDRESS_BASE } from '@atxp/client';
import BigNumber from 'bignumber.js';

// Mock for prepareSpendCallData
vi.mock('@base-org/account/spend-permission', () => ({
  prepareSpendCallData: vi.fn()
}));

// Mock viem to avoid address validation
vi.mock('viem', async () => {
  const actual = await vi.importActual('viem');
  return {
    ...actual,
    encodeFunctionData: vi.fn(() => '0xmockencodeddata')
  };
});

describe('basePaymentMaker.generateJWT', () => {
  it('should generate EIP-1271 auth data with default payload', async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    
    // Create mock SpendPermission
    const mockSpendPermission: SpendPermission = {
      signature: '0xmocksignature',
      permission: {
        account: account.address,
        spender: '0xspender',
        token: '0xtoken',
        allowance: '1000000',
        period: 86400,
        start: Math.floor(Date.now() / 1000),
        end: Math.floor(Date.now() / 1000) + 86400,
        salt: '1',
        extraData: '0x'
      }
    };
    
    // Create mock EphemeralSmartWallet
    const mockSmartWallet: EphemeralSmartWallet = {
      address: account.address,
      account: {
        address: account.address,
        signMessage: async (_message: any) => '0xmocksignature'
      },
      signer: {
        address: account.address,
        signMessage: async (_message: any) => '0xmocksignature',
        signTypedData: async (_params: any) => '0xmocksignature',
        signTransaction: async (_tx: any) => '0xmocksignature',
        getAddress: async () => account.address
      }
    } as any;
    
    const paymentMaker = new BaseAppPaymentMaker(mockSpendPermission, mockSmartWallet);
    const authData = await paymentMaker.generateJWT({paymentRequestId: '', codeChallenge: 'testCodeChallenge'});

    // Should return base64-encoded EIP-1271 auth data
    expect(authData).toBeDefined();
    expect(typeof authData).toBe('string');
    
    // Decode and verify the auth data
    const decoded = JSON.parse(Buffer.from(authData, 'base64').toString('utf-8'));
    expect(decoded.type).toBe('EIP1271_AUTH');
    expect(decoded.walletAddress).toBe(account.address);
    expect(decoded.message).toContain('PayMCP Authorization Request');
    expect(decoded.signature).toBeDefined();
    expect(decoded.timestamp).toBeDefined();
    expect(decoded.nonce).toBeDefined();
    expect(decoded.code_challenge).toBe('testCodeChallenge');


  });

  it('should include payment request id if provided', async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    
    // Create mock SpendPermission
    const mockSpendPermission: SpendPermission = {
      signature: '0xmocksignature',
      permission: {
        account: account.address,
        spender: '0xspender',
        token: '0xtoken',
        allowance: '1000000',
        period: 86400,
        start: Math.floor(Date.now() / 1000),
        end: Math.floor(Date.now() / 1000) + 86400,
        salt: '1',
        extraData: '0x'
      }
    };
    
    // Create mock EphemeralSmartWallet
    const mockSmartWallet: EphemeralSmartWallet = {
      address: account.address,
      account: {
        address: account.address,
        signMessage: async (_message: any) => '0xmocksignature'
      },
      signer: {
        address: account.address,
        signMessage: async (_message: any) => '0xmocksignature',
        signTypedData: async (_params: any) => '0xmocksignature',
        signTransaction: async (_tx: any) => '0xmocksignature',
        getAddress: async () => account.address
      }
    } as any;
    
    const paymentMaker = new BaseAppPaymentMaker(mockSpendPermission, mockSmartWallet);
    const paymentRequestId = 'id1';
    const authData = await paymentMaker.generateJWT({paymentRequestId, codeChallenge: ''});
    
    // Decode and verify the auth data includes payment request ID
    const decoded = JSON.parse(Buffer.from(authData, 'base64').toString('utf-8'));
    expect(decoded.payment_request_id).toEqual(paymentRequestId);
    expect(decoded.message).toContain(`Payment Request ID: ${paymentRequestId}`);
  });
});

describe('baseAppPaymentMaker.makePayment', () => {
  it('should successfully make a USDC payment', async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    
    // Import mocked modules
    const { prepareSpendCallData } = await import('@base-org/account/spend-permission');
    
    // Create mock SpendPermission
    const mockSpendPermission: SpendPermission = {
      signature: '0xmocksignature',
      permission: {
        account: account.address,
        spender: '0xspender',
        token: USDC_CONTRACT_ADDRESS_BASE,
        allowance: '10000000', // 10 USDC
        period: 86400,
        start: Math.floor(Date.now() / 1000),
        end: Math.floor(Date.now() / 1000) + 86400,
        salt: '1',
        extraData: '0x'
      }
    };
    
    // Mock spend permission calls
    const mockSpendCalls = [
      { to: '0xcontract1', data: '0xdata1', value: '0x0' },
      { to: '0xcontract2', data: '0xdata2', value: '0x0' }
    ];
    (prepareSpendCallData as any).mockResolvedValue(mockSpendCalls);
    
    // Create mock bundler client
    const mockBundlerClient = {
      sendUserOperation: vi.fn().mockResolvedValue('0xoperationhash'),
      waitForUserOperationReceipt: vi.fn().mockResolvedValue({
        success: true,
        userOpHash: '0xoperationhash',
        receipt: { transactionHash: '0xtxhash' }
      }),
      account: {
        client: {
          waitForTransactionReceipt: vi.fn().mockResolvedValue({})
        }
      }
    };
    
    // Create mock EphemeralSmartWallet
    const mockSmartWallet: EphemeralSmartWallet = {
      address: account.address,
      account: {
        address: account.address,
        signMessage: async (_message: any) => '0xmocksignature'
      },
      client: mockBundlerClient,
      signer: {
        address: account.address,
        signMessage: async (_message: any) => '0xmocksignature',
        signTypedData: async (_params: any) => '0xmocksignature',
        signTransaction: async (_tx: any) => '0xmocksignature',
        getAddress: async () => account.address
      }
    } as any;
    
    const paymentMaker = new BaseAppPaymentMaker(mockSpendPermission, mockSmartWallet);
    const amount = new BigNumber(1.5); // 1.5 USDC
    const receiver = '0x1234567890123456789012345678901234567890';
    
    const txHash = await paymentMaker.makePayment(amount, 'USDC', receiver, 'test payment');
    
    // Verify the transaction hash
    expect(txHash).toBe('0xtxhash');
    
    // Verify prepareSpendCallData was called with correct amount
    expect(prepareSpendCallData).toHaveBeenCalledWith(mockSpendPermission, 1500000n); // 1.5 USDC = 1,500,000 in smallest units
    
    // Verify sendUserOperation was called with correct parameters
    expect(mockBundlerClient.sendUserOperation).toHaveBeenCalledWith({
      account: mockSmartWallet.account,
      calls: [
        // Spend permission calls
        { to: '0xcontract1', data: '0xdata1', value: 0n },
        { to: '0xcontract2', data: '0xdata2', value: 0n },
        // Transfer call
        {
          to: USDC_CONTRACT_ADDRESS_BASE,
          data: expect.any(String), // Encoded transfer function
          value: 0n
        }
      ],
      maxPriorityFeePerGas: expect.any(BigInt)
    });
    
    // Verify waitForUserOperationReceipt was called
    expect(mockBundlerClient.waitForUserOperationReceipt).toHaveBeenCalledWith({ hash: '0xoperationhash' });
  });

  it('should throw error for non-USDC currency', async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    
    // Create mock SpendPermission
    const mockSpendPermission: SpendPermission = {
      signature: '0xmocksignature',
      permission: {
        account: account.address,
        spender: '0xspender',
        token: USDC_CONTRACT_ADDRESS_BASE,
        allowance: '10000000',
        period: 86400,
        start: Math.floor(Date.now() / 1000),
        end: Math.floor(Date.now() / 1000) + 86400,
        salt: '1',
        extraData: '0x'
      }
    };
    
    // Create mock EphemeralSmartWallet
    const mockSmartWallet: EphemeralSmartWallet = {
      address: account.address,
      account: {
        address: account.address,
        signMessage: async (_message: any) => '0xmocksignature'
      },
      signer: {
        address: account.address,
        signMessage: async (_message: any) => '0xmocksignature',
        signTypedData: async (_params: any) => '0xmocksignature',
        signTransaction: async (_tx: any) => '0xmocksignature',
        getAddress: async () => account.address
      }
    } as any;
    
    const paymentMaker = new BaseAppPaymentMaker(mockSpendPermission, mockSmartWallet);
    const amount = new BigNumber(1.5);
    const receiver = '0x1234567890123456789012345678901234567890';
    
    await expect(
      paymentMaker.makePayment(amount, 'ETH' as any, receiver, 'test payment')
    ).rejects.toThrow('Only usdc currency is supported');
  });

  it('should throw error if user operation fails', async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    
    // Import mocked modules
    const { prepareSpendCallData } = await import('@base-org/account/spend-permission');
    
    // Create mock SpendPermission
    const mockSpendPermission: SpendPermission = {
      signature: '0xmocksignature',
      permission: {
        account: account.address,
        spender: '0xspender',
        token: USDC_CONTRACT_ADDRESS_BASE,
        allowance: '10000000',
        period: 86400,
        start: Math.floor(Date.now() / 1000),
        end: Math.floor(Date.now() / 1000) + 86400,
        salt: '1',
        extraData: '0x'
      }
    };
    
    // Mock spend permission calls
    (prepareSpendCallData as any).mockResolvedValue([]);
    
    // Create mock bundler client that returns failed receipt
    const mockBundlerClient = {
      sendUserOperation: vi.fn().mockResolvedValue('0xoperationhash'),
      waitForUserOperationReceipt: vi.fn().mockResolvedValue(null) // No receipt = failure
    };
    
    // Create mock EphemeralSmartWallet
    const mockSmartWallet: EphemeralSmartWallet = {
      address: account.address,
      account: {
        address: account.address,
        signMessage: async (_message: any) => '0xmocksignature'
      },
      client: mockBundlerClient,
      signer: {
        address: account.address,
        signMessage: async (_message: any) => '0xmocksignature',
        signTypedData: async (_params: any) => '0xmocksignature',
        signTransaction: async (_tx: any) => '0xmocksignature',
        getAddress: async () => account.address
      }
    } as any;
    
    const paymentMaker = new BaseAppPaymentMaker(mockSpendPermission, mockSmartWallet);
    const amount = new BigNumber(1.5);
    const receiver = '0x1234567890123456789012345678901234567890';
    
    await expect(
      paymentMaker.makePayment(amount, 'USDC', receiver, 'test payment')
    ).rejects.toThrow('User operation failed');
  });

  it('should throw error if transaction hash is not returned', async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    
    // Import mocked modules
    const { prepareSpendCallData } = await import('@base-org/account/spend-permission');
    
    // Create mock SpendPermission
    const mockSpendPermission: SpendPermission = {
      signature: '0xmocksignature',
      permission: {
        account: account.address,
        spender: '0xspender',
        token: USDC_CONTRACT_ADDRESS_BASE,
        allowance: '10000000',
        period: 86400,
        start: Math.floor(Date.now() / 1000),
        end: Math.floor(Date.now() / 1000) + 86400,
        salt: '1',
        extraData: '0x'
      }
    };
    
    // Mock spend permission calls
    (prepareSpendCallData as any).mockResolvedValue([]);
    
    // Create mock bundler client with receipt but no transaction hash
    const mockBundlerClient = {
      sendUserOperation: vi.fn().mockResolvedValue('0xoperationhash'),
      waitForUserOperationReceipt: vi.fn().mockResolvedValue({
        success: true,
        userOpHash: '0xoperationhash',
        receipt: {} // No transactionHash
      })
    };
    
    // Create mock EphemeralSmartWallet
    const mockSmartWallet: EphemeralSmartWallet = {
      address: account.address,
      account: {
        address: account.address,
        signMessage: async (_message: any) => '0xmocksignature'
      },
      client: mockBundlerClient,
      signer: {
        address: account.address,
        signMessage: async (_message: any) => '0xmocksignature',
        signTypedData: async (_params: any) => '0xmocksignature',
        signTransaction: async (_tx: any) => '0xmocksignature',
        getAddress: async () => account.address
      }
    } as any;
    
    const paymentMaker = new BaseAppPaymentMaker(mockSpendPermission, mockSmartWallet);
    const amount = new BigNumber(1.5);
    const receiver = '0x1234567890123456789012345678901234567890';
    
    await expect(
      paymentMaker.makePayment(amount, 'USDC', receiver, 'test payment')
    ).rejects.toThrow('User operation was executed but no transaction hash was returned');
  });
});

