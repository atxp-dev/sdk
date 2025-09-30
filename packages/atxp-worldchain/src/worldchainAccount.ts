import type { Account, PaymentMaker } from '@atxp/client';
import {
  getWorldChainUSDCAddress,
  WORLD_CHAIN_MAINNET
} from '@atxp/client';
import { WorldchainPaymentMaker } from './worldchainPaymentMaker.js';
import { MainWalletPaymentMaker, type MainWalletProvider } from './mainWalletPaymentMaker.js';
import { generatePrivateKey } from 'viem/accounts';
import { Hex } from '@atxp/client';
import { SpendPermission, Eip1193Provider } from './types.js';
import { requestSpendPermission } from './spendPermissionShim.js';
import { ICache, BrowserCache, IntermediaryCache, type Intermediary } from './cache.js';
import { toEphemeralSmartWallet, type EphemeralSmartWallet } from './smartWalletHelpers.js';
import { ConsoleLogger, Logger } from '@atxp/common';

const DEFAULT_ALLOWANCE = 10n;
const DEFAULT_PERIOD_IN_DAYS = 7;

export class WorldchainAccount implements Account {
  accountId: string;
  paymentMakers: { [key: string]: PaymentMaker };

  private static toCacheKey(userWalletAddress: string): string {
    return `atxp-world-permission-${userWalletAddress}`;
  }

  static async initialize(config: {
      walletAddress: string,
      provider: Eip1193Provider,
      useEphemeralWallet?: boolean;
      allowance?: bigint;
      periodInDays?: number;
      cache?: ICache<string>;
      logger?: Logger;
      chainId?: number; // 480 for mainnet
      customRpcUrl?: string; // Custom RPC URL (e.g., with API key)
    },
  ): Promise<WorldchainAccount> {
    const logger = config.logger || new ConsoleLogger();
    const useEphemeralWallet = config.useEphemeralWallet ?? true;
    const chainId = config.chainId || WORLD_CHAIN_MAINNET.id;

    // Get USDC address for the specified chain
    const usdcAddress = getWorldChainUSDCAddress(chainId);

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
      return new WorldchainAccount(
        null, // No spend permission in main wallet mode
        null, // No ephemeral wallet in main wallet mode
        logger,
        config.walletAddress,
        config.provider,
        chainId,
        config.customRpcUrl
      );
    }

    // Initialize cache
    const baseCache = config?.cache || new BrowserCache();
    const cache = new IntermediaryCache(baseCache);
    const cacheKey = this.toCacheKey(config.walletAddress);

    // Try to load existing permission
    const existingData = this.loadSavedWalletAndPermission(cache, cacheKey);
    if (existingData) {
      const ephemeralSmartWallet = await toEphemeralSmartWallet(existingData.privateKey, config.customRpcUrl, chainId);
      return new WorldchainAccount(existingData.permission, ephemeralSmartWallet, logger, undefined, undefined, chainId, config.customRpcUrl);
    }

    const privateKey = generatePrivateKey();
    const smartWallet = await toEphemeralSmartWallet(privateKey, config.customRpcUrl, chainId);
    logger.info(`Generated ephemeral wallet: ${smartWallet.address}`);
    await this.deploySmartWallet(smartWallet);
    logger.info(`Deployed smart wallet: ${smartWallet.address}`);

    const permission = await requestSpendPermission({
      account: config.walletAddress,
      spender: smartWallet.address,
      token: usdcAddress,
      chainId: chainId,
      allowance: config?.allowance ?? DEFAULT_ALLOWANCE,
      periodInDays: config?.periodInDays ?? DEFAULT_PERIOD_IN_DAYS,
      provider: config.provider,
    });

    // Save wallet and permission
    cache.set(cacheKey, {privateKey, permission});

    return new WorldchainAccount(permission, smartWallet, logger, undefined, undefined, chainId, config.customRpcUrl);
  }

  private static loadSavedWalletAndPermission(
    permissionCache: IntermediaryCache,
    cacheKey: string
  ): Intermediary | null {
    const cachedData = permissionCache.get(cacheKey);
    if (!cachedData) return null;

    // Check if permission is not expired
    const now = Math.floor(Date.now() / 1000);
    const permissionEnd = parseInt(cachedData.permission.permission.end.toString());
    if (permissionEnd <= now) {
      permissionCache.delete(cacheKey);
      return null;
    }

    return cachedData;
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
    chainId: number = WORLD_CHAIN_MAINNET.id,
    customRpcUrl?: string
  ) {
    if (ephemeralSmartWallet) {
      // Ephemeral wallet mode
      if (!spendPermission) {
        throw new Error('Spend permission is required for ephemeral wallet mode');
      }
      this.accountId = ephemeralSmartWallet.address;
      this.paymentMakers = {
        'world': new WorldchainPaymentMaker(spendPermission, ephemeralSmartWallet, {
          logger,
          chainId,
          customRpcUrl
        }),
      };
    } else {
      // Main wallet mode
      if (!mainWalletAddress || !provider) {
        throw new Error('Main wallet address and provider are required for main wallet mode');
      }
      this.accountId = mainWalletAddress;
      this.paymentMakers = {
        'world': new MainWalletPaymentMaker(mainWalletAddress, provider, logger, chainId, customRpcUrl),
      };
    }
  }

  static clearAllCachedData(userWalletAddress: string, cache?: ICache<string>): void {
    // In non-browser environments, require an explicit cache parameter
    if (!cache) {
      const browserCache = new BrowserCache();
      // Check if BrowserCache would work (i.e., we're in a browser)
      if (typeof window === 'undefined') {
        throw new Error('clearAllCachedData requires a cache to be provided outside of browser environments');
      }
      cache = browserCache;
    }

    cache.delete(this.toCacheKey(userWalletAddress));
  }
}