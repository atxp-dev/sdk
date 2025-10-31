import type { PaymentMaker } from '@atxp/common';
import { Logger, Currency, AccountId, PaymentIdentifier, Destination } from '@atxp/common';
import { ConsoleLogger } from '@atxp/common';
import { getPolygonUSDCAddress } from '@atxp/client';
import {
  Address,
  encodeFunctionData,
  WalletClient,
  PublicActions,
  publicActions,
  type Hex,
} from "viem";
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

/**
 * Simple Polygon payment maker for server-side/CLI usage
 * Similar to BasePaymentMaker but for Polygon network
 */
export class SimplePolygonPaymentMaker implements PaymentMaker {
  protected signingClient: ExtendedWalletClient;
  protected logger: Logger;
  protected chainId: number;

  constructor(polygonRPCUrl: string, walletClient: WalletClient, chainId: number, logger?: Logger) {
    if (!polygonRPCUrl) {
      throw new Error('polygonRPCUrl was empty');
    }
    if (!walletClient) {
      throw new Error('walletClient was empty');
    }
    if(!walletClient.account) {
      throw new Error('walletClient.account was empty');
    }
    if (!chainId) {
      throw new Error('chainId was empty');
    }

    this.signingClient = walletClient.extend(publicActions) as ExtendedWalletClient;
    this.logger = logger ?? new ConsoleLogger();
    this.chainId = chainId;
  }

  getSourceAddress(_params: {amount: BigNumber, currency: Currency, receiver: string, memo: string}): string {
    return this.signingClient.account!.address;
  }

  async generateJWT({paymentRequestId, codeChallenge, accountId}: {paymentRequestId: string, codeChallenge: string, accountId?: AccountId | null}): Promise<string> {
    const headerObj = { alg: 'ES256K' };

    const payloadObj = {
      sub: this.signingClient.account!.address,
      iss: 'accounts.atxp.ai',
      aud: 'https://auth.atxp.ai',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60 * 60,
      ...(codeChallenge ? { code_challenge: codeChallenge } : {}),
      ...(paymentRequestId ? { payment_request_id: paymentRequestId } : {}),
      ...(accountId ? { account_id: accountId } : {}),
    } as Record<string, unknown>;

    const header = toBase64Url(JSON.stringify(headerObj));
    const payload = toBase64Url(JSON.stringify(payloadObj));
    const message = `${header}.${payload}`;

    // Sign the message
    const signature = await this.signingClient.signMessage({
      account: this.signingClient.account,
      message
    });

    // Convert signature to base64url (remove 0x prefix first)
    const signatureBase64Url = toBase64Url(signature.slice(2));

    return `${message}.${signatureBase64Url}`;
  }

  async makePayment(destinations: Destination[], memo: string, paymentRequestId?: string): Promise<PaymentIdentifier | null> {
    this.logger.info(`Making payment with ${destinations.length} destination(s)`);

    if (destinations.length === 0) {
      this.logger.warn('No destinations provided');
      return null;
    }

    // For now, we only support single destination payments
    // Multi-destination batching could be added in the future
    if (destinations.length > 1) {
      throw new Error('Multiple destinations not yet supported for Polygon payments');
    }

    const destination = destinations[0];

    // Validate currency
    if (destination.currency !== 'USDC') {
      throw new Error(`Unsupported currency: ${destination.currency}. Only USDC is supported on Polygon.`);
    }

    // Get USDC contract address for this chain
    const usdcAddress = getPolygonUSDCAddress(this.chainId);

    // Convert amount to smallest unit (USDC has 6 decimals)
    const amountInSmallestUnit = destination.amount.multipliedBy(10 ** USDC_DECIMALS);

    this.logger.info(`Transferring ${destination.amount.toString()} USDC to ${destination.address}`);
    this.logger.info(`Amount in smallest unit: ${amountInSmallestUnit.toString()}`);

    try {
      // Check balance first
      const balance = await this.signingClient.readContract({
        address: usdcAddress as Address,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [this.signingClient.account!.address],
      }) as bigint;

      this.logger.info(`Current USDC balance: ${balance.toString()}`);

      if (balance < BigInt(amountInSmallestUnit.toFixed(0))) {
        throw new Error(`Insufficient USDC balance. Have: ${balance.toString()}, Need: ${amountInSmallestUnit.toString()}`);
      }

      // Encode the transfer function call
      const data = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [destination.address as Address, BigInt(amountInSmallestUnit.toFixed(0))],
      });

      // Send the transaction
      const hash = await this.signingClient.sendTransaction({
        account: this.signingClient.account,
        to: usdcAddress as Address,
        data,
        chain: this.signingClient.chain,
      });

      this.logger.info(`Transaction sent: ${hash}`);

      // Wait for confirmation
      const receipt = await this.signingClient.waitForTransactionReceipt({ hash });

      if (receipt.status === 'success') {
        this.logger.info(`Payment successful! Transaction: ${hash}`);
        return {
          transactionId: hash,
          chain: 'polygon',
          currency: 'USDC',
        };
      } else {
        throw new Error(`Transaction failed: ${hash}`);
      }
    } catch (error) {
      this.logger.error(`Payment failed: ${error}`);
      throw error;
    }
  }
}
