import type { Account, PaymentMaker, Hex } from './types.js';
import { privateKeyToAccount, PrivateKeyAccount } from 'viem/accounts';
import { BasePaymentMaker } from './basePaymentMaker.js';
import { createWalletClient, http, WalletClient } from 'viem';
import { base } from 'viem/chains';
import { LocalSigner } from './localSigner.js';
import { LocalAccount } from 'viem';

export class BaseAccount implements Account {
  accountId: string;
  paymentMakers: { [key: string]: PaymentMaker };
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

    this.accountId = this.account.address;
    this.walletClient = createWalletClient({
      account: this.account,
      chain: base,
      transport: http(baseRPCUrl),
    });
    this.paymentMakers = {
      'base': new BasePaymentMaker(baseRPCUrl, this.walletClient),
    }
  }

  /**
   * Get a signer that can be used with the x402 library
   * This is only available for EVM-based accounts
   */
  getSigner(): LocalAccount {
    // Return the viem account directly - it implements LocalAccount interface
    return this.account;
  }
}