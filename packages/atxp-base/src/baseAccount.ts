import type { Account, PaymentMaker, Hex } from '@atxp/client';
import type { AccountId, Source, AuthorizeParams, AuthorizeResult, Destination, PaymentProtocol } from '@atxp/common';
import { BigNumber } from 'bignumber.js';
import { privateKeyToAccount, PrivateKeyAccount } from 'viem/accounts';
import { BasePaymentMaker } from './basePaymentMaker.js';
import { createWalletClient, http, WalletClient, LocalAccount } from 'viem';
import { base } from 'viem/chains';
import { createPaymentHeader } from 'x402/client';

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

  /**
   * Create a spend permission for the given resource URL.
   * Base accounts don't support spend permissions, so this returns null.
   */
  async createSpendPermission(_resourceUrl: string): Promise<string | null> {
    return null;
  }

  /**
   * Authorize a payment through the appropriate channel for Base accounts.
   */
  async authorize(params: AuthorizeParams): Promise<AuthorizeResult> {
    if (!params.protocols || params.protocols.length === 0) {
      throw new Error('BaseAccount: protocols array must not be empty');
    }
    const supported: PaymentProtocol[] = ['x402', 'atxp'];
    const protocol = params.protocols.find(p => supported.includes(p));
    if (!protocol) {
      throw new Error(`BaseAccount does not support any of: ${params.protocols.join(', ')}`);
    }

    switch (protocol) {
      case 'x402': {
        if (!params.paymentRequirements) {
          throw new Error('BaseAccount: x402 authorize requires paymentRequirements');
        }
        const reqs = params.paymentRequirements as Record<string, unknown>;
        const x402Version = (reqs.x402Version as number) || 1;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const paymentHeader = await createPaymentHeader(
          this.getLocalAccount(),
          x402Version,
          reqs as any,
        );
        return { protocol, credential: paymentHeader as string };
      }
      case 'atxp': {
        if (!params.amount) {
          throw new Error('BaseAccount: amount is required for atxp authorize');
        }
        if (!params.destination) {
          throw new Error('BaseAccount: destination is required for atxp authorize');
        }
        const destination: Destination = {
          chain: 'base',
          currency: 'USDC',
          address: params.destination,
          amount: new BigNumber(params.amount),
        };
        const result = await this.paymentMakers[0].makePayment([destination], params.memo || '');
        if (!result) {
          throw new Error('BaseAccount: payment execution returned no result');
        }
        return { protocol, credential: JSON.stringify({ transactionId: result.transactionId, chain: result.chain, currency: result.currency }) };
      }
      default:
        throw new Error(`BaseAccount: unsupported protocol '${protocol}'`);
    }
  }
}