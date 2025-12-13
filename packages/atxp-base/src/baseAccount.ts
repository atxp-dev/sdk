import type { Account, PaymentMaker, Hex } from '@atxp/client';
import type { AccountId, Source } from '@atxp/common';
import { privateKeyToAccount, PrivateKeyAccount } from 'viem/accounts';
import { BasePaymentMaker } from './basePaymentMaker.js';
import { createWalletClient, http, WalletClient, LocalAccount } from 'viem';
import { base } from 'viem/chains';

export class BaseAccount implements Account {
  private _accountId: AccountId;
  paymentMakers: PaymentMaker[];
  private walletClient: WalletClient;
  private account: PrivateKeyAccount;

  constructor(baseRPCUrl: string, sourceSecretKey: string) {
    if (!baseRPCUrl) {
      throw new Error('Base RPC URL is required');
    }
    if (!sourceSecretKey) {
      throw new Error('Source secret key is required');
    }

    this.account = privateKeyToAccount(sourceSecretKey as Hex);

    // Format accountId as network:address
    this._accountId = `base:${this.account.address}` as AccountId;
    this.walletClient = createWalletClient({
      account: this.account,
      chain: base,
      transport: http(baseRPCUrl),
    });
    this.paymentMakers = [
      new BasePaymentMaker(baseRPCUrl, this.walletClient)
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
   * This can be used with the x402 library or other signing operations.
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
      chain: 'base',
      walletType: 'eoa'
    }];
  }
}