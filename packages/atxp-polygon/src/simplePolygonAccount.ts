import type { Account, PaymentMaker, Source } from '@atxp/common';
import type { AccountId } from '@atxp/common';
import { ChainEnum, WalletTypeEnum } from '@atxp/common';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { SimplePolygonPaymentMaker } from './simplePolygonPaymentMaker.js';
import { createWalletClient, http, type WalletClient, type Hex } from 'viem';
import { polygon, polygonAmoy } from 'viem/chains';
import type { Chain } from 'viem/chains';

/**
 * Simple Polygon account for server-side/CLI usage
 *
 * This is a simplified version of PolygonAccount that works without browser providers.
 * It uses direct wallet signing (similar to BaseAccount) rather than ephemeral wallets
 * and spend permissions.
 *
 * For browser-based applications with wallet providers, use PolygonAccount.initialize() instead.
 *
 * @example
 * ```typescript
 * // Server-side usage
 * const account = new SimplePolygonAccount(
 *   'https://polygon-rpc.com',
 *   '0x_your_private_key',
 *   137  // Polygon mainnet
 * );
 * ```
 */
export class SimplePolygonAccount implements Account {
  accountId: AccountId;
  paymentMakers: PaymentMaker[];
  private walletClient: WalletClient;
  private account: PrivateKeyAccount;
  private chainId: number;

  constructor(polygonRPCUrl: string, sourceSecretKey: string, chainId: number = 137) {
    if (!polygonRPCUrl) {
      throw new Error('Polygon RPC URL is required');
    }
    if (!sourceSecretKey) {
      throw new Error('Source secret key is required');
    }
    if (!chainId) {
      throw new Error('Chain ID is required');
    }

    this.chainId = chainId;
    this.account = privateKeyToAccount(sourceSecretKey as Hex);

    // Determine network name for accountId
    const networkName = chainId === 137 ? 'polygon' : 'polygon_amoy';
    this.accountId = `${networkName}:${this.account.address}` as AccountId;

    // Get the appropriate chain configuration
    const chain = this.getChain(chainId);

    this.walletClient = createWalletClient({
      account: this.account,
      chain,
      transport: http(polygonRPCUrl),
    });

    this.paymentMakers = [
      new SimplePolygonPaymentMaker(polygonRPCUrl, this.walletClient, chainId)
    ];
  }

  private getChain(chainId: number): Chain {
    switch (chainId) {
      case 137:
        return polygon;
      case 80002:
        return polygonAmoy;
      default:
        throw new Error(`Unsupported Polygon chain ID: ${chainId}. Supported: 137 (mainnet), 80002 (Amoy testnet)`);
    }
  }

  /**
   * Get sources for this account
   */
  async getSources(): Promise<Source[]> {
    // Determine chain enum value
    const chain = this.chainId === 137 ? ChainEnum.Polygon : ChainEnum.PolygonAmoy;

    return [{
      address: this.account.address,
      chain,
      walletType: WalletTypeEnum.EOA
    }];
  }
}
