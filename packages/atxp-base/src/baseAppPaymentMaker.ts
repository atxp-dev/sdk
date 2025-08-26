import type { PaymentMaker } from '@atxp/client';
import { Logger, Currency, ConsoleLogger } from '@atxp/common';
import { BigNumber } from 'bignumber.js';
import { encodeFunctionData, Address, getAddress, Account, WalletClient, http, createWalletClient, parseEther } from 'viem';
import { SpendPermission } from './types.js';
import { type EphemeralSmartWallet } from './smartWalletHelpers.js';
import { base } from 'viem/chains';
import { prepareSpendCallData } from '@base-org/account/spend-permission';

// Helper function to convert to base64url that works in both Node.js and browsers
function toBase64Url(data: string): string {
  // Convert string to base64
  const base64 = typeof Buffer !== 'undefined' 
    ? Buffer.from(data).toString('base64')
    : btoa(data);
  // Convert base64 to base64url
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

const USDC_CONTRACT_ADDRESS_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC on Base mainnet
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

export class BaseAppPaymentMaker implements PaymentMaker {
  private logger: Logger;
  private baseRPCUrl: string;
  private spendPermission: SpendPermission;
  private smartWallet: EphemeralSmartWallet;

  constructor(
    baseRPCUrl: string, 
    spendPermission: SpendPermission,
    smartWallet: EphemeralSmartWallet,
    logger?: Logger
  ) {
    if (!spendPermission) {
      throw new Error('Spend permission is required');
    }
    if (!smartWallet) {
      throw new Error('Smart wallet is required');
    }
    this.baseRPCUrl = baseRPCUrl;
    this.logger = logger ?? new ConsoleLogger();
    this.spendPermission = spendPermission;
    this.smartWallet = smartWallet;
  }

  async generateJWT({paymentRequestId, codeChallenge}: {paymentRequestId: string, codeChallenge: string}): Promise<string> {
    const headerObj = { alg: 'ES256K' };
    
    const payloadObj = {
      sub: this.smartWallet.account.address,
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

    const messageBytes = typeof Buffer !== 'undefined'
      ? Buffer.from(message, 'utf8')
      : new TextEncoder().encode(message);
    
    const signResult = await this.smartWallet.account.signMessage({
      message: { raw: messageBytes },
    });

    // For ES256K, signature is typically 65 bytes (r,s,v)
    // Server expects the hex signature string (with 0x prefix) to be base64url encoded
    // This creates: base64url("0x6eb2565...") not base64url(rawBytes)
    // Pass the hex string directly to toBase64Url which will UTF-8 encode and base64url it
    const signature = toBase64Url(signResult);

    const jwt = `${header}.${payload}.${signature}`;
    this.logger.info(`Generated ES256K JWT: ${jwt}`);
    return jwt;
  }

  async makePayment(amount: BigNumber, currency: Currency, receiver: string): Promise<string> {
    if (currency !== 'USDC') {
      throw new Error('Only usdc currency is supported; received ' + currency);
    }

    this.logger.info(`Making spendPermission payment of ${amount} ${currency} to ephemeral wallet on Base`);

    const spendCalls = await prepareSpendCallData(this.spendPermission, BigInt(amount.toString()));
    const hash = await this.smartWallet.client.sendUserOperation({ 
      account: this.smartWallet.account, 
      calls: spendCalls.map(call => {
        return {
          chain: base,
          to: call.to,
          data: call.data,
          value: parseEther('0'),
          account: this.smartWallet.account
        }
      })
    }) 
     
    const receipt = await this.smartWallet.client.waitForUserOperationReceipt({ hash })
    if (!receipt) {
      throw new Error('User operation failed');
    }
    this.logger.info(`User operation successful: ${receipt.userOpHash}`);

    // now send the payment to the receiver
    this.logger.info(`Sending payment to receiver: ${receiver}`);
    // Convert amount to USDC units (6 decimals) as BigInt
    const amountInUSDCUnits = BigInt(amount.multipliedBy(10 ** USDC_DECIMALS).toFixed(0));
      
    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [receiver as Address, amountInUSDCUnits],
    });
    const txHash = await this.smartWallet.client.sendUserOperation({
      account: this.smartWallet.account,
      calls: [{
        to: USDC_CONTRACT_ADDRESS_BASE,
        data: data,
        value: parseEther('0'),
      }]
    });
    
    // Wait for transaction confirmation with more blocks to ensure propagation
    this.logger.info(`Waiting for transaction confirmation: ${txHash}`);
    const txReceipt = await this.smartWallet.client.waitForUserOperationReceipt({ hash});
    
    if (!txReceipt) {
      throw new Error('User operation failed');
    }
    this.logger.info(`User operation successful: ${txReceipt.userOpHash}`);
        
    return hash;
  }
}
