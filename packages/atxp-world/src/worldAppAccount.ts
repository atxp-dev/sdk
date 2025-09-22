import type { Account, PaymentMaker } from '@atxp/client';
import {
  USDC_CONTRACT_ADDRESS_WORLD_MAINNET,
  USDC_CONTRACT_ADDRESS_WORLD_SEPOLIA,
  WORLD_CHAIN_MAINNET,
  WORLD_CHAIN_SEPOLIA
} from '@atxp/client';
import { WorldAppPaymentMaker } from './worldAppPaymentMaker.js';
import { MainWalletPaymentMaker, type MainWalletProvider } from './mainWalletPaymentMaker.js';
import { generatePrivateKey } from 'viem/accounts';
import { Hex } from '@atxp/client';
import { SpendPermission, Eip1193Provider } from './types.js';
import { requestSpendPermission } from './spendPermissionShim.js';
import { IStorage, BrowserStorage, IntermediaryStorage, type Intermediary } from './storage.js';
import { toEphemeralSmartWallet, type EphemeralSmartWallet } from './smartWalletHelpers.js';
import { ConsoleLogger, Logger } from '@atxp/common';

const DEFAULT_ALLOWANCE = 10n;
const DEFAULT_PERIOD_IN_DAYS = 7;

export class WorldAppAccount implements Account {
  accountId: string;
  paymentMakers: { [key: string]: PaymentMaker };

  private static toStorageKey(userWalletAddress: string): string {
    return `atxp-world-permission-${userWalletAddress}`;
  }

  static async initialize(config: {
      walletAddress: string,
      provider: Eip1193Provider,
      useEphemeralWallet?: boolean;
      allowance?: bigint;
      periodInDays?: number;
      storage?: IStorage<string>;
      logger?: Logger;
      chainId?: number; // 480 for mainnet, 4801 for testnet
    },
  ): Promise<WorldAppAccount> {
    const logger = config.logger || new ConsoleLogger();
    const useEphemeralWallet = config.useEphemeralWallet ?? true;
    const chainId = config.chainId || WORLD_CHAIN_MAINNET.id;

    // Determine USDC contract address based on chain
    const usdcAddress = chainId === WORLD_CHAIN_SEPOLIA.id
      ? USDC_CONTRACT_ADDRESS_WORLD_SEPOLIA
      : USDC_CONTRACT_ADDRESS_WORLD_MAINNET;

    // Some wallets don't support wallet_connect, so
    // will just continue if it fails
    try {
      await config.provider.request({ method: 'wallet_connect' });
    } catch (error) {
      logger.warn(`wallet_connect not supported, continuing with initialization. ${error}`);
    }

    // If using main wallet mode, return early with main wallet payment maker
    if (!useEphemeralWallet) {
      logger.info(`Using main wallet mode for address: ${config.walletAddress}`);
      return new WorldAppAccount(
        null, // No spend permission in main wallet mode
        null, // No ephemeral wallet in main wallet mode
        logger,
        config.walletAddress,
        config.provider,
        chainId
      );
    }

    // Initialize storage
    const baseStorage = config?.storage || new BrowserStorage();
    const storage = new IntermediaryStorage(baseStorage);
    const storageKey = this.toStorageKey(config.walletAddress);

    // Try to load existing permission
    const existingData = this.loadSavedWalletAndPermission(storage, storageKey);
    if (existingData) {
      const ephemeralSmartWallet = await toEphemeralSmartWallet(existingData.privateKey);
      return new WorldAppAccount(existingData.permission, ephemeralSmartWallet, logger, undefined, undefined, chainId);
    }

    const privateKey = generatePrivateKey();
    const smartWallet = await toEphemeralSmartWallet(privateKey);
    logger.info(`Generated ephemeral wallet: ${smartWallet.address}`);
    await this.deploySmartWallet(smartWallet);
    logger.info(`Deployed smart wallet: ${smartWallet.address}`);

    const permission = await requestSpendPermission({
      account: config.walletAddress,
      spender: smartWallet.address,
      token: usdcAddress,
      chainId: chainId as 480 | 4801,
      allowance: config?.allowance ?? DEFAULT_ALLOWANCE,
      periodInDays: config?.periodInDays ?? DEFAULT_PERIOD_IN_DAYS,
      provider: config.provider,
    });

    // Save wallet and permission
    storage.set(storageKey, {privateKey, permission});

    return new WorldAppAccount(permission, smartWallet, logger, undefined, undefined, chainId);
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
      }]
      // Note: World Chain may not have paymaster support initially
      // paymaster omitted
    });

    const receipt = await smartWallet.client.waitForUserOperationReceipt({
      hash: deployTx
    });

    if (!receipt.success) {
      throw new Error(`Smart wallet deployment failed. Receipt: ${JSON.stringify(receipt)}`);
    }
  }

  constructor(
    spendPermission: SpendPermission | null,
    ephemeralSmartWallet: EphemeralSmartWallet | null,
    logger?: Logger,
    mainWalletAddress?: string,
    provider?: MainWalletProvider,
    chainId: number = WORLD_CHAIN_MAINNET.id
  ) {
    if (ephemeralSmartWallet) {
      // Ephemeral wallet mode
      if (!spendPermission) {
        throw new Error('Spend permission is required for ephemeral wallet mode');
      }
      this.accountId = ephemeralSmartWallet.address;
      this.paymentMakers = {
        'world': new WorldAppPaymentMaker(spendPermission, ephemeralSmartWallet, logger, chainId),
      };
    } else {
      // Main wallet mode
      if (!mainWalletAddress || !provider) {
        throw new Error('Main wallet address and provider are required for main wallet mode');
      }
      this.accountId = mainWalletAddress;
      this.paymentMakers = {
        'world': new MainWalletPaymentMaker(mainWalletAddress, provider, logger, chainId),
      };
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