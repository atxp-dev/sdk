import type { Account, PaymentMaker, AccountId, Source } from '@atxp/common';
import { WalletTypeEnum, ChainEnum } from '@atxp/common';
import { DirectWalletPaymentMaker, type MainWalletProvider } from './directWalletPaymentMaker.js';
import { polygon } from 'viem/chains';
import { Eip1193Provider } from './types.js';
import { ConsoleLogger, Logger } from '@atxp/common';

/**
 * Polygon browser account implementation using Direct Wallet mode.
 *
 * Direct Wallet mode:
 * - User signs each transaction with their wallet
 * - User pays gas fees in POL
 * - No smart wallet or gasless transactions
 *
 * Note: Smart Wallet mode is not supported on Polygon because Coinbase CDP
 * does not provide Paymaster services for Polygon mainnet.
 */
export class PolygonBrowserAccount implements Account {
  private _accountId: AccountId;
  paymentMakers: PaymentMaker[];
  private walletAddress: string;
  private chainId: number;

  static async initialize(config: {
      walletAddress: string,
      provider: Eip1193Provider,
      logger?: Logger;
      chainId?: number; // 137 for mainnet, 80002 for Amoy testnet
      // Deprecated parameters (kept for backward compatibility but ignored):
      useEphemeralWallet?: boolean;
      allowance?: bigint;
      periodInDays?: number;
      cache?: unknown;
      coinbaseCdpApiKey?: string;
    },
  ): Promise<PolygonBrowserAccount> {
    const logger = config.logger || new ConsoleLogger();
    const chainId = config.chainId || polygon.id; // Default to Polygon mainnet

    // Warn if deprecated smart wallet parameters are provided
    if (config.useEphemeralWallet === true) {
      logger.warn('Smart Wallet mode (useEphemeralWallet=true) is not supported on Polygon. Using Direct Wallet mode instead.');
    }
    if (config.allowance !== undefined || config.periodInDays !== undefined) {
      logger.warn('allowance and periodInDays parameters are ignored in Direct Wallet mode.');
    }
    if (config.coinbaseCdpApiKey !== undefined) {
      logger.warn('coinbaseCdpApiKey parameter is ignored in Direct Wallet mode.');
    }

    // Some wallets don't support wallet_connect, so
    // will just continue if it fails
    try {
      await config.provider.request({ method: 'wallet_connect' });
    } catch (error) {
      // Continue if wallet_connect is not supported
      logger.warn(`wallet_connect not supported, continuing with initialization. ${error}`);
    }

    logger.info(`Initializing Polygon account in Direct Wallet mode for address: ${config.walletAddress}`);

    return new PolygonBrowserAccount(
      config.walletAddress,
      config.provider,
      logger,
      chainId
    );
  }

  constructor(
    walletAddress: string,
    provider: MainWalletProvider,
    logger: Logger,
    chainId: number = polygon.id
  ) {
    this.walletAddress = walletAddress;
    this.chainId = chainId;

    // Format accountId as network:address
    this._accountId = `polygon:${walletAddress}` as AccountId;

    this.paymentMakers = [
      new DirectWalletPaymentMaker(walletAddress, provider, logger, chainId)
    ];
  }

  /**
   * Get the account ID
   */
  async getAccountId(): Promise<AccountId> {
    return this._accountId;
  }

  async getSources(): Promise<Source[]> {
    // For Polygon, we support both mainnet (137) and Amoy testnet (80002)
    const chain = ChainEnum.Polygon;

    return [{
      address: this.walletAddress,
      chain,
      walletType: WalletTypeEnum.EOA
    }];
  }

  /**
   * Clear cached data (no-op in Direct Wallet mode, kept for backward compatibility)
   * @deprecated This method is a no-op in Direct Wallet mode
   */
  static clearAllCachedData(_userWalletAddress: string, _cache?: unknown): void {
    // No-op: Direct Wallet mode doesn't cache any data
  }
}
