import type { Account, PaymentMaker } from './types.js';
import { privateKeyToAccount } from 'viem/accounts';
import { BasePaymentMaker } from './basePaymentMaker.js';

export class BaseAccount implements Account {
  accountId: string;
  paymentMakers: { [key: string]: PaymentMaker };

  constructor(baseRPCUrl: string, sourceSecretKey: `0x${string}`) {
    if (!baseRPCUrl) {
      throw new Error('Base RPC URL is required');
    }
    if (!sourceSecretKey) {
      throw new Error('Source secret key is required');
    }

    const account = privateKeyToAccount(sourceSecretKey);

    this.accountId = account.address;
    this.paymentMakers = {
      'base': new BasePaymentMaker(baseRPCUrl, sourceSecretKey),
    }
  }
}