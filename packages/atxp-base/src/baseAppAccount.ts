import type { Account, PaymentMaker } from '@atxp/client';
import { BaseAppPaymentMaker } from './baseAppPaymentMaker.js';
import type { WalletClient } from 'viem';
import { IStorage, BrowserStorage } from './storage.js';
// import { toEphemeralSmartWallet, type EphemeralSmartWallet } from './smartWalletHelpers.js';
import { validatePaymasterCapabilities } from './paymasterHelpers.js';
import { ConsoleLogger, Logger } from '@atxp/common';
import { getAddress, createPublicClient, http, Account as ViemAccount } from 'viem';
import { base } from 'viem/chains';
import { SpendPermission } from './types.js';
import { IStorage, BrowserStorage, IntermediaryStorage, type Intermediary } from './storage.js';
import { toEphemeralSmartWallet, type EphemeralSmartWallet } from './smartWalletHelpers.js';
import { Logger } from '@atxp/common';
import { createBaseAccountSDK } from "@base-org/account";
import { requestSpendPermission } from "@base-org/account/spend-permission";

// const DEFAULT_ALLOWANCE = 10n;
// const DEFAULT_PERIOD_IN_DAYS = 7;

export class BaseAppAccount implements Account {
  accountId: string;
  paymentMakers: { [key: string]: PaymentMaker };

  private static toStorageKey(userWalletAddress: string): string {
    return `atxp-base-permission-${userWalletAddress}`;
  }

  static async initialize(
    baseRPCUrl: string, 
    userWalletAddress: string, 
    walletClient: WalletClient,
    config: {
      appName: string;
      allowance?: bigint;
      periodInDays?: number;
      storage?: IStorage<string>;
      apiKey: string;
      usePaymaster?: boolean; // Defaults to true - set to false to disable paymaster sponsorship
    },
    logger?: Logger,
  ): Promise<BaseAppAccount> {
    logger = logger || new ConsoleLogger();

    // Validate smart wallet configuration
    if (!config.apiKey) {
      throw new Error(
        'Smart wallet API key is required. ' +
        'Get your API key from https://portal.cdp.coinbase.com/'
      );
    }

    // Initialize storage
    const baseStorage = config?.storage || new BrowserStorage();
    const storage = new IntermediaryStorage(baseStorage);
    const storageKey = this.toStorageKey(userWalletAddress);

    // Try to load existing permission
    const existingData = this.loadSavedWalletAndPermission(storage, storageKey);
    if (existingData) {
      const smartWallet = await toEphemeralSmartWallet(existingData.privateKey, config.apiKey);
      const account = privateKeyToAccount(existingData.privateKey);
      return new BaseAppAccount(baseRPCUrl, existingData.permission, account, smartWallet, logger);
    }

    const sdk = createBaseAccountSDK({
      appName: config?.appName,
      appChainIds: [base.id],
      paymasterUrls: {
        [base.id]: 'https://api.developer.coinbase.com/rpc/v1/base/snPdXqIzOGhRkGNJvEHM5bl9Hm3yRO3m',
      }
    });
    const provider = sdk.getProvider();
    await sdk.getProvider().request({ method: 'wallet_connect' });

    const privateKey = generatePrivateKey();
    const smartWallet = await toEphemeralSmartWallet(privateKey, config.apiKey);
    console.log('Generated ephemeral wallet:', smartWallet.address);
    await this.deploySmartWallet(smartWallet, config.apiKey);

    const permission = await requestSpendPermission({
      account: userWalletAddress,
      spender: smartWallet.address,
      token: USDC_CONTRACT_ADDRESS_BASE,
      chainId: base.id,
      allowance: config?.allowance ?? DEFAULT_ALLOWANCE,
      periodInDays: config?.periodInDays ?? DEFAULT_PERIOD_IN_DAYS,
      provider,
    });
    
    console.log('Permission:', permission);

    // Save wallet and permission
    storage.set(storageKey, {privateKey, permission});

    */

    // Validate paymaster capabilities if enabled (defaults to true)
    if (config.usePaymaster !== false) {
      await validatePaymasterCapabilities(walletClient);
      logger?.info(`Validated paymaster capabilities for wallet: ${walletClient.account!.address}`);
    }
    
    return new BaseAppAccount(baseRPCUrl, walletClient, config.apiKey, logger);
    return new BaseAppAccount(baseRPCUrl, smartWallet.account, logger);
  }

  private static loadSavedWalletAndPermission(
    permissionStorage: IntermediaryStorage,
    storageKey: string
  ): Intermediary | null {
    const storedData = permissionStorage.get(storageKey);
    if (!storedData) return null;
    
    // Check if permission is not expired
    const now = Math.floor(Date.now() / 1000);
    const permissionEnd = parseInt(storedData.permission.permission.end.toString());
    if (permissionEnd <= now) {
      permissionStorage.delete(storageKey);
      return null;
    }

    return storedData;
  }

  /*
  private static async checkAndRequestUSDCApproval(
    baseRPCUrl: string,
    userWalletAddress: string,
    walletClient: WalletClient
  ): Promise<void> {
    const USDC_CONTRACT = getAddress(USDC_CONTRACT_ADDRESS_BASE);
    const SPEND_PERMISSION_MANAGER = getAddress('0xf85210B21cC50302F477BA56686d2019dC9b67Ad');
    
    const publicClient = createPublicClient({
      chain: base,
      transport: http(baseRPCUrl)
    });
    
    const allowance = await publicClient.readContract({
      address: USDC_CONTRACT,
      abi: [{
        name: 'allowance',
        type: 'function',
        stateMutability: 'view',
        inputs: [
          { name: 'owner', type: 'address' },
          { name: 'spender', type: 'address' }
        ],
        outputs: [{ name: '', type: 'uint256' }],
      }],
      functionName: 'allowance',
      args: [userWalletAddress as `0x${string}`, SPEND_PERMISSION_MANAGER],
    });
    
    console.log('USDC allowance for SpendPermissionManager:', allowance);
    
    if (allowance === 0n) {
      try {
        const hash = await walletClient.writeContract({
          address: USDC_CONTRACT,
          abi: [{
            name: 'approve',
            type: 'function',
            stateMutability: 'nonpayable',
            inputs: [
              { name: 'spender', type: 'address' },
              { name: 'amount', type: 'uint256' }
            ],
            outputs: [{ name: '', type: 'bool' }],
          }],
          functionName: 'approve',
          args: [SPEND_PERMISSION_MANAGER, BigInt(10 ** 9)], // Approve 1000 USDC
          chain: base,
          account: userWalletAddress as `0x${string}`,
        });
        
        console.log('Approval transaction sent:', hash);
        
        // Wait for approval
        await publicClient.waitForTransactionReceipt({ hash });
        console.log('SpendPermissionManager approved successfully');
      } catch (approveError) {
        console.error('Failed to approve SpendPermissionManager:', approveError);
        throw new Error('SpendPermissionManager must be approved to spend USDC. Please approve the contract at 0xf85210B21cC50302F477BA56686d2019dC9b67Ad');
      }
    }
  }

  private static async createSpendPermission(
    userWalletAddress: string,
    walletClient: WalletClient,
    //privateKey: `0x${string}`,
    spenderAddress: string,
    config: {
      appName: string;
      allowance?: bigint;
      periodInDays?: number;
      apiKey: string;
    }
  ): Promise<SpendPermission> {
    //const spenderAddress = await getSmartWalletAddress(privateKey, config.apiKey);

    const now = Math.floor(Date.now() / 1000);
    const period = (config?.periodInDays ?? DEFAULT_PERIOD_IN_DAYS) * 24 * 60 * 60;
    const end = now + period;
    
    const domain = {
      name: 'SpendPermissionManager',
      version: '1',
      chainId: base.id,
      verifyingContract: getAddress('0xf85210B21cC50302F477BA56686d2019dC9b67Ad'),
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
    console.log('Requesting signature from wallet for address:', userWalletAddress);
    const signature = await walletClient.signTypedData({
      account: userWalletAddress as `0x${string}`,
      domain,
      types,
      primaryType: 'SpendPermission',
      message: permissionData,
    });

    console.log(`Signed SpendPermission for ${userWalletAddress} with spender ${spenderAddress}`);

    return {
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
  }
    */

  private static async deploySmartWallet(
    smartWallet: EphemeralSmartWallet,
    apiKey: string
  ): Promise<void> {
    console.log('Deploying smart wallet to enable spend permissions...');
    
    const deployTx = await smartWallet.client.sendUserOperation({
      calls: [{
        to: smartWallet.address,
        value: 0n,
        data: '0x' as `0x${string}`
      }],
      paymaster: true
    });
    
    const receipt = await smartWallet.client.waitForUserOperationReceipt({
      hash: deployTx
    });
    
    if (!receipt.success) {
      throw new Error(`Smart wallet deployment failed. Receipt: ${JSON.stringify(receipt)}`);
    }
    
    console.log('✅ Smart wallet deployed successfully at:', smartWallet.address);
  }

  /*

  constructor(
    baseRPCUrl: string, 
    spendPermission: SpendPermission, 
    account: ViemAccount, 
    smartWallet: EphemeralSmartWallet,
    logger?: Logger
  ) {
    if (!baseRPCUrl) {
      throw new Error('Base RPC URL is required');
    }
    if (!account) {
      throw new Error('Account is required');
    }
    if (!spendPermission) {
      throw new Error('Spend permission is required');
    }
    if (!smartWallet) {
      throw new Error('Smart wallet required');
    }

    this.accountId = spendPermission.permission.spender;

    this.paymentMakers = {
      'base': new BaseAppPaymentMaker(baseRPCUrl, spendPermission, account, smartWallet, logger),
    }
  }*/

  constructor(
    baseRPCUrl: string, 
    //account: ViemAccount, 
    walletClient: WalletClient,
    apiKey: string,
    logger?: Logger
  ) {
    if (!baseRPCUrl) {
      throw new Error('Base RPC URL is required');
    }
    if (!walletClient) {
      throw new Error('Wallet client is required');
    }

    this.accountId = walletClient.account!.address;

    this.paymentMakers = {
      'base': new BaseAppPaymentMaker(baseRPCUrl, walletClient, logger),
    }
  }

  /**
   * Clear all ATXP-related data from storage
   * This includes spend permissions and any OAuth tokens
   * @param storage Optional storage implementation (defaults to browser localStorage)
   */
  static clearAllStoredData(userWalletAddress: string, storage?: IStorage<string>): void {
    if (typeof window === 'undefined' && !storage) {
      throw new Error('clearAllStoredData requires a storage to be provided outside of browser environments');
    }
    storage = storage || new BrowserStorage();

    storage.delete(this.toStorageKey(userWalletAddress));
    // Data cleared from storage
  }
}
