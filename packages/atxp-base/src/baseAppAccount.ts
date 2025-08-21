import type { Account, PaymentMaker } from '@atxp/client';
import { USDC_CONTRACT_ADDRESS_BASE } from '@atxp/client';
import { BaseAppPaymentMaker } from './baseAppPaymentMaker.js';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import type { WalletClient } from 'viem';
import { getAddress } from 'viem';
import { base } from 'viem/chains';
import { SpendPermission } from './types.js';
import { IStorage, BrowserStorage, PermissionStorage } from './storage.js';
import { createEphemeralSmartWallet, getSmartWalletAddress, type SmartWalletConfig, type EphemeralSmartWallet } from './smartWalletHelpers.js';

const DEFAULT_ALLOWANCE = 10n;
const DEFAULT_PERIOD_IN_DAYS = 7;

export class BaseAppAccount implements Account {
  accountId: string;
  paymentMakers: { [key: string]: PaymentMaker };

  static async initialize(
    baseRPCUrl: string, 
    userWalletAddress: string, 
    walletClient: WalletClient,
    config: {
      appName: string;
      allowance?: bigint;
      periodInDays?: number;
      storage?: IStorage<string>;
      smartWallet: SmartWalletConfig;
    }
  ): Promise<BaseAppAccount> {
    // Initialize storage with type-safe wrapper
    const baseStorage = config?.storage || new BrowserStorage();
    const permissionStorage = new PermissionStorage(baseStorage);
    const storageKey = `atxp-base-permission-${userWalletAddress}`;
    
    // Try to load existing permission
    const storedData = permissionStorage.getPermission(storageKey);
    if (storedData) {
      // Check if permission is not expired
      const now = Math.floor(Date.now() / 1000);
      const permissionEnd = parseInt(storedData.permission.permission.end.toString());
      if (permissionEnd > now) {
        try {
          // Attempt to create account with stored permission
          return new BaseAppAccount(baseRPCUrl, storedData.permission, storedData.privateKey, config.smartWallet);
        } catch {
          // Failed to initialize with stored permission, will request new one
          // Permission might be invalid, remove it
          permissionStorage.removePermission(storageKey);
        }
      } else {
        // Permission expired, remove it and request new one
        permissionStorage.removePermission(storageKey);
      }
    }

    // this is an "ephemeral" wallet that only ever lives client-side
    // BaseAppPayementMaker uses it to pull funds from the user's wallet
    // and pass them along to the MCP server
    const privateKey = generatePrivateKey();
    
    // For smart wallets, we need to get the counterfactual address
    const signerAddress = privateKeyToAccount(privateKey).address;
    const spenderAddress = await getSmartWalletAddress(signerAddress, config.smartWallet);

    // Create spend permission using wagmi's signTypedData
    const now = Math.floor(Date.now() / 1000);
    const period = (config?.periodInDays ?? DEFAULT_PERIOD_IN_DAYS) * 24 * 60 * 60;
    const end = now + period;
    
    // EIP-712 domain and types for spend permission
    const domain = {
      name: 'SpendPermissionManager',
      version: '1',
      chainId: base.id,
      verifyingContract: getAddress('0x4b22970FBf7Bb7F3FBe4fD8D68b53e5d497c6E4D'), // SpendPermissionManager on Base
    };

    const types = {
      SpendPermission: [
        { name: 'account', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'token', type: 'address' },
        { name: 'allowance', type: 'uint160' },
        { name: 'period', type: 'uint48' },
        { name: 'start', type: 'uint48' },
        { name: 'end', type: 'uint48' },
        { name: 'salt', type: 'uint256' },
        { name: 'extraData', type: 'bytes' },
      ],
    };

    const permissionData = {
      account: userWalletAddress,
      spender: spenderAddress,
      token: USDC_CONTRACT_ADDRESS_BASE,
      allowance: (config?.allowance ?? DEFAULT_ALLOWANCE).toString(),
      period: period,
      start: now,
      end: end,
      salt: BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)).toString(),
      extraData: '0x',
    };

    // Sign the permission using wagmi wallet client
    const signature = await walletClient.signTypedData({
      account: userWalletAddress as `0x${string}`,
      domain,
      types,
      primaryType: 'SpendPermission',
      message: permissionData,
    });

    const permission: SpendPermission = {
      signature,
      permission: {
        ...permissionData,
        allowance: permissionData.allowance.toString(),
        period: permissionData.period,
        start: permissionData.start,
        end: permissionData.end,
        salt: permissionData.salt.toString(),
      },
      chainId: base.id,
      createdAt: now,
    };

    // store the permission using type-safe storage
    permissionStorage.setPermission(storageKey, {
      privateKey,
      permission,
    });

    // construct account with the permission
    return new BaseAppAccount(baseRPCUrl, permission, privateKey, config.smartWallet);
  }

  constructor(baseRPCUrl: string, spendPermission: SpendPermission, privateKey: `0x${string}`, smartWalletConfig: SmartWalletConfig) {
    if (!baseRPCUrl) {
      throw new Error('Base RPC URL is required');
    }
    if (!privateKey) {
      throw new Error('Private key (for ephemeral wallet) is required');
    }
    if (!spendPermission) {
      throw new Error('Spend permission is required');
    }
    if (!smartWalletConfig) {
      throw new Error('Smart wallet configuration is required');
    }

    // The accountId is the smart wallet address
    this.accountId = spendPermission.permission.spender;

    this.paymentMakers = {
      'base': new BaseAppPaymentMaker(baseRPCUrl, spendPermission, privateKey, smartWalletConfig),
    }
  }
}