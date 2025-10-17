import type { Account, PaymentMaker } from './types.js';
import { SolanaPaymentMaker } from './solanaPaymentMaker.js';
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

export class SolanaAccount implements Account {
  accountId: string;
  paymentMakers: PaymentMaker[];

  constructor(solanaEndpoint: string, sourceSecretKey: string) {
    if (!solanaEndpoint) {
      throw new Error('Solana endpoint is required');
    }
    if (!sourceSecretKey) {
      throw new Error('Source secret key is required');
    }
    const source = Keypair.fromSecretKey(bs58.decode(sourceSecretKey));

    this.accountId = source.publicKey.toBase58();
    this.paymentMakers = [
      new SolanaPaymentMaker(solanaEndpoint, sourceSecretKey),
    ];
  }
}