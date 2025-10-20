import type { Account, PaymentMaker } from './types.js';
import type { AccountId } from '@atxp/common';
import { SolanaPaymentMaker } from './solanaPaymentMaker.js';
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

export class SolanaAccount implements Account {
  accountId: AccountId;
  paymentMakers: { [key: string]: PaymentMaker };

  constructor(solanaEndpoint: string, sourceSecretKey: string) {
    if (!solanaEndpoint) {
      throw new Error('Solana endpoint is required');
    }
    if (!sourceSecretKey) {
      throw new Error('Source secret key is required');
    }
    const source = Keypair.fromSecretKey(bs58.decode(sourceSecretKey));

    // Format accountId as network:address
    this.accountId = `solana:${source.publicKey.toBase58()}` as AccountId;
    this.paymentMakers = {
      'solana': new SolanaPaymentMaker(solanaEndpoint, sourceSecretKey),
    }
  }
}