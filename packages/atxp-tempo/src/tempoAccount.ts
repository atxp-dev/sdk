import type { Account, PaymentMaker, Hex } from '@atxp/client';
import type { AccountId, Source } from '@atxp/common';
import { privateKeyToAccount, PrivateKeyAccount } from 'viem/accounts';
import { TempoPaymentMaker } from './tempoPaymentMaker.js';
import { createWalletClient, http, WalletClient, LocalAccount } from 'viem';
import { getTempoChain, TEMPO_MAINNET_CHAIN_ID } from './tempoConstants.js';

export class TempoAccount implements Account {
  private _accountId: AccountId;
  paymentMakers: PaymentMaker[];
  private walletClient: WalletClient;
  private account: PrivateKeyAccount;

  constructor(rpcUrl: string, sourceSecretKey: string, chainId?: number) {
    if (!rpcUrl) {
      throw new Error('Tempo RPC URL is required');
    }
    if (!sourceSecretKey) {
      throw new Error('Source secret key is required');
    }

    const resolvedChainId = chainId ?? TEMPO_MAINNET_CHAIN_ID;
    const chain = getTempoChain(resolvedChainId);

    this.account = privateKeyToAccount(sourceSecretKey as Hex);

    // Format accountId as network:address
    this._accountId = `tempo:${this.account.address}` as AccountId;
    this.walletClient = createWalletClient({
      account: this.account,
      chain,
      transport: http(rpcUrl),
    });
    this.paymentMakers = [
      new TempoPaymentMaker(rpcUrl, this.walletClient, resolvedChainId)
    ];
  }

  /**
   * Get the account ID
   */
  async getAccountId(): Promise<AccountId> {
    return this._accountId;
  }

  /**
   * Get the LocalAccount (signer) for this account.
   * This can be used for signing operations.
   */
  getLocalAccount(): LocalAccount {
    return this.account;
  }

  /**
   * Get sources for this account
   */
  async getSources(): Promise<Source[]> {
    return [{
      address: this.account.address,
      chain: 'tempo',
      walletType: 'eoa'
    }];
  }

  /**
   * Create a spend permission for the given resource URL.
   * Tempo accounts don't support spend permissions, so this returns null.
   */
  async createSpendPermission(_resourceUrl: string): Promise<string | null> {
    return null;
  }
}
