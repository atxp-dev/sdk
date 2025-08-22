import type { PaymentMaker, Hex } from './types.js';
import { InsufficientFundsError as InsufficientFundsErrorClass, PaymentNetworkError as PaymentNetworkErrorClass } from './types.js';
import { Logger, Currency } from '@atxp/common';
import { ConsoleLogger } from '@atxp/common';
import {
  Address,
  createWalletClient,
  http,
  parseEther,
  publicActions,
  encodeFunctionData,
  WalletClient,
  PublicActions,
  Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { BigNumber } from "bignumber.js";

// Type for the extended wallet client with public actions
type ExtendedWalletClient = WalletClient & PublicActions;

// Helper function to convert to base64url that works in both Node.js and browsers
function toBase64Url(data: string): string {
  // Convert string to base64
  const base64 = typeof Buffer !== 'undefined' 
    ? Buffer.from(data).toString('base64')
    : btoa(data);
  // Convert base64 to base64url
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export const USDC_CONTRACT_ADDRESS_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC on Base mainnet
const USDC_DECIMALS = 6;
const ERC20_ABI = [
  {
    constant: false,
    inputs: [
      { name: "_to", type: "address" },
      { name: "_value", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ name: "", type: "bool" }],
    type: "function",
  },
  {
      "constant": true,
      "inputs": [
          {
              "name": "_owner",
              "type": "address"
          }
      ],
      "name": "balanceOf",
      "outputs": [
          {
              "name": "balance",
              "type": "uint256"
          }
      ],
      "payable": false,
      "stateMutability": "view",
      "type": "function"
  }
];

export class BasePaymentMaker implements PaymentMaker {
  protected signingClient: ExtendedWalletClient;
  protected account: Account;
  protected logger: Logger;

  static fromSecretKey(baseRPCUrl: string, sourceSecretKey: Hex, logger?: Logger): BasePaymentMaker {
    const account = privateKeyToAccount(sourceSecretKey);
    return new BasePaymentMaker(baseRPCUrl, account, logger);
  }

  constructor(baseRPCUrl: string, account: Account, logger?: Logger) {
    if (!baseRPCUrl) {
      throw new Error('Base RPC URL is required');
    }
    if (!account) {
      throw new Error('Account is required');
    }

    this.account = account;
    this.signingClient = createWalletClient({
      account: this.account,
      chain: base,
      transport: http(baseRPCUrl),
    }).extend(publicActions) as ExtendedWalletClient;
    this.logger = logger ?? new ConsoleLogger();
  }

  async generateJWT({paymentRequestId, codeChallenge}: {paymentRequestId: string, codeChallenge: string}): Promise<string> {
    const headerObj = { alg: 'ES256K' }; // this value is specific to Base
    const payloadObj = {
      sub: this.account.address,
      iss: 'accounts.atxp.ai',
      aud: 'https://auth.atxp.ai',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60 * 60,
      ...(codeChallenge ? { code_challenge: codeChallenge } : {}),
      ...(paymentRequestId ? { payment_request_id: paymentRequestId } : {}),
    } as Record<string, unknown>;

    const header = toBase64Url(JSON.stringify(headerObj));
    const payload = toBase64Url(JSON.stringify(payloadObj));
    const message = `${header}.${payload}`;

    // For Ethereum wallets, we need to use personal_sign format
    const messageBytes = typeof Buffer !== 'undefined'
      ? Buffer.from(message, 'utf8')
      : new TextEncoder().encode(message);
    const signResult = await this.signingClient.signMessage({
      account: this.account,
      message: { raw: messageBytes },
    });
    
    // The paymcp server expects ES256K signatures as hex strings with 0x prefix
    // The signResult from viem is already in hex format with 0x prefix (65 bytes)
    // We encode the hex string itself (including 0x) as base64url
    const signature = toBase64Url(signResult);

    return `${header}.${payload}.${signature}`;
  }

  async makePayment(amount: BigNumber, currency: Currency, receiver: string): Promise<string> {
    if (currency.toUpperCase() !== 'USDC') {
      throw new PaymentNetworkErrorClass('Only USDC currency is supported; received ' + currency);
    }

    this.logger.info(`Making payment of ${amount} ${currency} to ${receiver} on Base`);

    try {
      // Check balance before attempting payment
      const balanceRaw = await this.signingClient.readContract({
        address: USDC_CONTRACT_ADDRESS_BASE as Address,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [this.account.address],
      }) as bigint;
      
      const balance = new BigNumber(balanceRaw.toString()).dividedBy(10 ** USDC_DECIMALS);
      
      if (balance.lt(amount)) {
        this.logger.warn(`Insufficient ${currency} balance for payment. Required: ${amount}, Available: ${balance}`);
        throw new InsufficientFundsErrorClass(currency, amount, balance, 'base');
      }

      // Convert amount to USDC units (6 decimals) as BigInt
      const amountInUSDCUnits = BigInt(amount.multipliedBy(10 ** USDC_DECIMALS).toFixed(0));
      
      const data = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [receiver as Address, amountInUSDCUnits],
      });
      const hash = await this.signingClient.sendTransaction({
        chain: base,
        account: this.account,
        to: USDC_CONTRACT_ADDRESS_BASE,
        data: data,
        value: parseEther('0'),
      });
      
      // Wait for transaction confirmation with more blocks to ensure propagation
      this.logger.info(`Waiting for transaction confirmation: ${hash}`);
      const receipt = await this.signingClient.waitForTransactionReceipt({ 
        hash: hash as Hex,
        confirmations: 3  // Wait for 3 confirmations to ensure better propagation
      });
      
      if (receipt.status === 'reverted') {
        throw new PaymentNetworkErrorClass(`Transaction reverted: ${hash}`, new Error('Transaction reverted on chain'));
      }
      
      this.logger.info(`Transaction confirmed: ${hash} in block ${receipt.blockNumber}`);
      
      return hash;
    } catch (error) {
      if (error instanceof InsufficientFundsErrorClass || error instanceof PaymentNetworkErrorClass) {
        throw error;
      }
      
      // Wrap other errors in PaymentNetworkError
      throw new PaymentNetworkErrorClass(`Payment failed on Base network: ${(error as Error).message}`, error as Error);
    }
  }
}
