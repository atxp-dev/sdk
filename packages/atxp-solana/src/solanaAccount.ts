import type { Account, PaymentMaker } from '@atxp/client';
import type { AccountId, Source, AuthorizeParams, AuthorizeResult, Destination } from '@atxp/common';
import { BigNumber } from 'bignumber.js';
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

  /**
   * Authorize a payment through the appropriate channel for Solana accounts.
   */
  async authorize(params: AuthorizeParams): Promise<AuthorizeResult> {
    const { protocol } = params;

    switch (protocol) {
      case 'atxp': {
        const destination: Destination = {
          chain: 'solana',
          currency: 'USDC',
          address: params.destination,
          amount: new BigNumber(params.amount),
        };
        const result = await this.paymentMakers[0].makePayment([destination], params.memo || '');
        if (!result) {
          throw new Error('SolanaAccount: payment execution returned no result');
        }
        return { protocol, credential: JSON.stringify(result) };
      }
      case 'x402':
        throw new Error('SolanaAccount does not support x402 protocol');
      case 'mpp':
        throw new Error('SolanaAccount does not support MPP protocol');
      default:
        throw new Error(`SolanaAccount: unsupported protocol '${protocol}'`);
    }
  }
}