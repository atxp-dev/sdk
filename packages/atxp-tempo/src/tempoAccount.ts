import type { Account, PaymentMaker, Hex } from '@atxp/client';
import type { AccountId, Source, AuthorizeParams, AuthorizeResult, Destination, PaymentProtocol } from '@atxp/common';
import { BigNumber } from 'bignumber.js';
import { privateKeyToAccount, PrivateKeyAccount } from 'viem/accounts';
import { TempoPaymentMaker } from './tempoPaymentMaker.js';
import { createWalletClient, http, WalletClient, LocalAccount } from 'viem';
import { getTempoChain, TEMPO_MAINNET_CHAIN_ID, TEMPO_TESTNET_CHAIN_ID } from './tempoConstants.js';

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

    // Format accountId as network:address (tempo for mainnet, tempo_moderato for testnet)
    const network = resolvedChainId === TEMPO_TESTNET_CHAIN_ID ? 'tempo_moderato' : 'tempo';
    this._accountId = `${network}:${this.account.address}` as AccountId;
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

  /**
   * Authorize a payment through the appropriate channel for Tempo accounts.
   */
  async authorize(params: AuthorizeParams): Promise<AuthorizeResult> {
    if (!params.protocols || params.protocols.length === 0) {
      throw new Error('TempoAccount: protocols array must not be empty');
    }
    const supported: PaymentProtocol[] = ['mpp'];
    const protocol = params.protocols.find(p => supported.includes(p));
    if (!protocol) {
      throw new Error(`TempoAccount does not support any of: ${params.protocols.join(', ')}`);
    }

    if (!params.amount) {
      throw new Error('TempoAccount: amount is required for mpp authorize');
    }
    if (!params.destination) {
      throw new Error('TempoAccount: destination is required for mpp authorize');
    }
    const destination: Destination = {
      chain: 'tempo',
      currency: 'USDC',
      address: params.destination,
      amount: new BigNumber(params.amount),
    };
    const result = await this.paymentMakers[0].makePayment([destination], params.memo || '');
    if (!result) {
      throw new Error('TempoAccount: payment execution returned no result');
    }
    return { protocol, credential: JSON.stringify(result) };
  }
}
