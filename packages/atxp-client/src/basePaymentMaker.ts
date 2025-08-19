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
  private signingClient: WalletClient;
  private logger: Logger;

  constructor(baseRPCUrl: string, sourceSecretKey: `0x${string}`, logger?: Logger) {
    if (!baseRPCUrl) {
      throw new Error('Base RPC URL is required');
    }
    if (!sourceSecretKey) {
      throw new Error('Source secret key is required');
    }

    const sponsorWallet = privateKeyToAccount(sourceSecretKey);
    this.signingClient = createWalletClient({
      account: sponsorWallet,
      chain: base,
      transport: http(baseRPCUrl),
    }).extend(publicActions);
    this.logger = logger ?? new ConsoleLogger();
  }
  
  generateJWT = async({paymentRequestId, codeChallenge}: {paymentRequestId: string, codeChallenge: string}): Promise<string> => {
    const headerObj = { alg: 'ES256K' }; // this value is specific to Base
    const payloadObj = {
      sub: this.signingClient.account!.address,
      iss: 'accounts.atxp.ai',
      aud: 'auth.atxp.ai',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60 * 60,
      code_challenge: codeChallenge,
      payment_request_id: paymentRequestId,
    } as Record<string, unknown>;

    const header = Buffer.from(JSON.stringify(headerObj)).toString('base64');
    const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64');
    const message = `${header}.${payload}`;

    const messageBytes = Buffer.from(message, 'utf8');
    const signResult = await this.signingClient.signMessage({
      account: this.signingClient.account!,
      message: { raw: messageBytes },
    });
    const signature = Buffer.from(signResult, 'hex').toString('base64');

    return `${header}.${payload}.${signature}`;
  }

  makePayment = async (amount: BigNumber, currency: string, receiver: string): Promise<string> => {
    currency = currency.toLowerCase();
    if (currency !== 'usdc') {
      throw new Error('Only usdc currency is supported; received ' + currency);
    }

    this.logger.info(`Making payment of ${amount} ${currency} to ${receiver} on Base`);

    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [receiver as Address, amount.toNumber() * Math.pow(10, USDC_DECIMALS)],
    });
    const hash = await this.signingClient.sendTransaction({
      chain: base,
      account: this.signingClient.account!,
      to: USDC_CONTRACT_ADDRESS,
      data: data,
      value: parseEther('0'),
    });
    return hash;
  }
}
