import type { PaymentMaker } from './types.js';
import { Logger } from '@atxp/common';
import { ConsoleLogger } from '@atxp/common';
import {
  Address,
  createWalletClient,
  http,
  parseEther,
  publicActions,
  encodeFunctionData,
  createPublicClient,
  PublicClient,
  WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const USDC_CONTRACT_ADDRESS = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
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
  private signingClient: any; // Extended wallet client with public actions
  private account: ReturnType<typeof privateKeyToAccount>;
  private logger: Logger;

  constructor(baseRPCUrl: string, sourceSecretKey: `0x${string}`, logger?: Logger) {
    if (!baseRPCUrl) {
      throw new Error('Base RPC URL is required');
    }
    if (!sourceSecretKey) {
      throw new Error('Source secret key is required');
    }

    this.account = privateKeyToAccount(sourceSecretKey);
    this.signingClient = createWalletClient({
      account: this.account,
      chain: base,
      transport: http(baseRPCUrl),
    }).extend(publicActions);
    this.logger = logger ?? new ConsoleLogger();
  }
  
  generateJWT = async({paymentRequestId, codeChallenge}: {paymentRequestId: string, codeChallenge: string}): Promise<string> => {
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

    const header = Buffer.from(JSON.stringify(headerObj)).toString('base64url');
    const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
    const message = `${header}.${payload}`;

    // For Ethereum wallets, we need to use personal_sign format
    const messageBytes = Buffer.from(message, 'utf8');
    const signResult = await this.signingClient.signMessage({
      account: this.account,
      message: { raw: messageBytes },
    });
    
    // The paymcp server expects ES256K signatures as hex strings with 0x prefix
    // The signResult from viem is already in hex format with 0x prefix (65 bytes)
    // We encode the hex string itself (including 0x) as base64url
    const signature = Buffer.from(signResult, 'utf8').toString('base64url');

    return `${header}.${payload}.${signature}`;
  }

  makePayment = async (amount: BigNumber, currency: string, receiver: string): Promise<string> => {
    currency = currency.toLowerCase();
    if (currency !== 'usdc') {
      throw new Error('Only usdc currency is supported; received ' + currency);
    }

    this.logger.info(`Making payment of ${amount} ${currency} to ${receiver} on Base`);

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
      to: USDC_CONTRACT_ADDRESS,
      data: data,
      value: parseEther('0'),
    });
    
    // Wait for transaction confirmation with more blocks to ensure propagation
    this.logger.info(`Waiting for transaction confirmation: ${hash}`);
    const receipt = await this.signingClient.waitForTransactionReceipt({ 
      hash: hash as `0x${string}`,
      confirmations: 3  // Wait for 3 confirmations to ensure better propagation
    });
    
    if (receipt.status === 'reverted') {
      throw new Error(`Transaction reverted: ${hash}`);
    }
    
    this.logger.info(`Transaction confirmed: ${hash} in block ${receipt.blockNumber}`);
    
    return hash;
  }
}
