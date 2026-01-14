import type { Account, PaymentMaker } from '@atxp/client';
import type { AccountId, Source } from '@atxp/common';
import { SolanaPaymentMaker } from './solanaPaymentMaker.js';
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

export class SolanaAccount implements Account {
  private _accountId: AccountId;
  paymentMakers: PaymentMaker[];
  private sourcePublicKey: string;

  constructor(solanaEndpoint: string, sourceSecretKey: string) {
    if (!solanaEndpoint) {
      throw new Error('Solana endpoint is required');
    }
    if (!sourceSecretKey) {
      throw new Error('Source secret key is required');
    }
    const source = Keypair.fromSecretKey(bs58.decode(sourceSecretKey));
    this.sourcePublicKey = source.publicKey.toBase58();

    // Format accountId as network:address
    this._accountId = `solana:${this.sourcePublicKey}` as AccountId;
    this.paymentMakers = [
      new SolanaPaymentMaker(solanaEndpoint, sourceSecretKey)
    ];
  }

  /**
   * Get the account ID
   */
  async getAccountId(): Promise<AccountId> {
    return this._accountId;
  }

  /**
   * Get sources for this account
   */
  async getSources(): Promise<Source[]> {
    return [{
      address: this.sourcePublicKey,
      chain: 'solana',
      walletType: 'eoa'
    }];
  }

  /**
   * Create a spend permission for the given resource URL.
   * Solana accounts don't support spend permissions, so this returns null.
   */
  async createSpendPermission(_resourceUrl: string): Promise<string | null> {
    return null;
  }
}