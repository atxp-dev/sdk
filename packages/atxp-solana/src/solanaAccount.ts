import type { Account, PaymentMaker } from '@atxp/client';
import type { AccountId, Source } from '@atxp/common';
import { SolanaPaymentMaker } from './solanaPaymentMaker.js';
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

export class SolanaAccount implements Account {
  accountId: AccountId;
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
    this.accountId = `solana:${this.sourcePublicKey}` as AccountId;
    this.paymentMakers = [
      new SolanaPaymentMaker(solanaEndpoint, sourceSecretKey)
    ];
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
}