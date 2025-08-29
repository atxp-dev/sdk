import type { Account, PaymentMaker } from '@atxp/client';
import { USDC_CONTRACT_ADDRESS_BASE } from '@atxp/client';
import { BaseAppPaymentMaker } from './baseAppPaymentMaker.js';
import { generatePrivateKey } from 'viem/accounts';
import { base } from 'viem/chains';
import { Hex } from '@atxp/client';
import { SpendPermission } from './types.js';
import { IStorage, BrowserStorage, IntermediaryStorage, type Intermediary } from './storage.js';
import { toEphemeralSmartWallet, type EphemeralSmartWallet } from './smartWalletHelpers.js';
import { ConsoleLogger, Logger } from '@atxp/common';
import { createBaseAccountSDK } from "@base-org/account";
import { requestSpendPermission } from "@base-org/account/spend-permission";

const DEFAULT_ALLOWANCE = 10n;
const DEFAULT_PERIOD_IN_DAYS = 7;
const PAYMASTER_URL = 'https://api.developer.coinbase.com/rpc/v1/base/snPdXqIzOGhRkGNJvEHM5bl9Hm3yRO3m';

export class BaseAppAccount implements Account {
  accountId: string;
  paymentMakers: { [key: string]: PaymentMaker };

  private static toStorageKey(userWalletAddress: string): string {
    return `atxp-base-permission-${userWalletAddress}`;
  }

  static async initialize(config: {
      walletAddress: string, 
      apiKey: string;
      appName: string;
      allowance?: bigint;
      periodInDays?: number;
      storage?: IStorage<string>;
      logger?: Logger
    },
  ): Promise<BaseAppAccount> {
    const logger = config.logger || new ConsoleLogger();
    // Validate smart wallet configuration
    if (!config.apiKey) {
      throw new Error(
        'Smart wallet API key is required. ' +
        'Get your API key from https://portal.cdp.coinbase.com/'
      );
    }

    // Initialize Base SDK - this must happen before any spend permission operations
    const sdk = createBaseAccountSDK({
      appName: config?.appName,
      appChainIds: [base.id],
      paymasterUrls: {
        [base.id]: PAYMASTER_URL
      }
    });
    const provider = sdk.getProvider();
    // Some wallets don't support wallet_connect, so 
    // will just continue if it fails
    try {
      await provider.request({ method: 'wallet_connect' });
    } catch (error) {
      // Continue if wallet_connect is not supported
      logger.warn(`wallet_connect not supported, continuing with initialization. ${error}`);
    }

    // Initialize storage
    const baseStorage = config?.storage || new BrowserStorage();
    const storage = new IntermediaryStorage(baseStorage);
    const storageKey = this.toStorageKey(config.walletAddress);

    // Try to load existing permission
    const existingData = this.loadSavedWalletAndPermission(storage, storageKey);
    if (existingData) {
      const ephemeralSmartWallet = await toEphemeralSmartWallet(existingData.privateKey, config.apiKey);
      return new BaseAppAccount(existingData.permission, ephemeralSmartWallet, logger);
    }

    const privateKey = generatePrivateKey();
    const smartWallet = await toEphemeralSmartWallet(privateKey, config.apiKey);
    logger.info(`Generated ephemeral wallet: ${smartWallet.address}`);
    await this.deploySmartWallet(smartWallet);
    logger.info(`Deployed smart wallet: ${smartWallet.address}`);

    const permission = await requestSpendPermission({
      account: config.walletAddress,
      spender: smartWallet.address,
      token: USDC_CONTRACT_ADDRESS_BASE,
      chainId: base.id,
      allowance: config?.allowance ?? DEFAULT_ALLOWANCE,
      periodInDays: config?.periodInDays ?? DEFAULT_PERIOD_IN_DAYS,
      provider,
    });
    
    // Save wallet and permission
    storage.set(storageKey, {privateKey, permission});

    return new BaseAppAccount(permission, smartWallet, logger);
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

  private static async deploySmartWallet(
    smartWallet: EphemeralSmartWallet,
  ): Promise<void> {
    const deployTx = await smartWallet.client.sendUserOperation({
      calls: [{
        to: smartWallet.address,
        value: 0n,
        data: '0x' as Hex
      }],
      paymaster: true
    });
    
    const receipt = await smartWallet.client.waitForUserOperationReceipt({
      hash: deployTx
    });
    
    if (!receipt.success) {
      throw new Error(`Smart wallet deployment failed. Receipt: ${JSON.stringify(receipt)}`);
    }
  }

  constructor(
    spendPermission: SpendPermission,
    ephemeralSmartWallet: EphemeralSmartWallet,
    logger?: Logger
  ) {
    if (!ephemeralSmartWallet) {
      throw new Error('Wallet client is required');
    }

    this.accountId = ephemeralSmartWallet.address;

    this.paymentMakers = {
      'base': new BaseAppPaymentMaker(spendPermission, ephemeralSmartWallet, logger),
    }
  }

  static clearAllStoredData(userWalletAddress: string, storage?: IStorage<string>): void {
    // In non-browser environments, require an explicit storage parameter
    if (!storage) {
      const browserStorage = new BrowserStorage();
      // Check if BrowserStorage would work (i.e., we're in a browser)
      if (typeof window === 'undefined') {
        throw new Error('clearAllStoredData requires a storage to be provided outside of browser environments');
      }
      storage = browserStorage;
    }

    storage.delete(this.toStorageKey(userWalletAddress));
  }
}