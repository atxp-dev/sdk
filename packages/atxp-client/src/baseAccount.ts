import type { Account, PaymentMaker, Hex } from './types.js';
import { privateKeyToAccount } from 'viem/accounts';
import { BasePaymentMaker } from './basePaymentMaker.js';
import { createWalletClient, http } from 'viem';
import { base } from 'viem/chains';

export const USDC_CONTRACT_ADDRESS_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC on Base mainnet

export class BaseAccount implements Account {
  accountId: string;
  paymentMakers: { [key: string]: PaymentMaker };

  constructor(baseRPCUrl: string, sourceSecretKey: Hex) {
    if (!baseRPCUrl) {
      throw new Error('Base RPC URL is required');
    }
    if (!sourceSecretKey) {
      throw new Error('Source secret key is required');
    }

    const account = privateKeyToAccount(sourceSecretKey);

    this.accountId = account.address;
    const walletClient = createWalletClient({
      account: account,
      chain: base,
      transport: http(baseRPCUrl),
    });
    this.paymentMakers = {
      'base': new BasePaymentMaker(baseRPCUrl, walletClient),
    }
  }
}