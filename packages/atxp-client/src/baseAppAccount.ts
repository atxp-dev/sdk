import type { Account, PaymentMaker } from './types.js';
import { ConsoleLogger, Logger } from '@atxp/common';
import { requestSpendPermission } from "@base-org/account/spend-permission";
import { createBaseAccountSDK, getCryptoKeyAccount } from "@base-org/account";
import { base } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  Address,
  createWalletClient,
  http,
  parseEther,
  publicActions,
  encodeFunctionData,
} from "viem";

const USDC_CONTRACT_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC on Base mainnet
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

type UserConsent = {
  privateKey: `0x${string}`,
  userAddress: `0x${string}`,
  permission: any,
  appName: string,
  appLogoUrl: string
}

class BaseAppPaymentMaker implements PaymentMaker {
  private userAddress: `0x${string}`;
  private logger: Logger;

  constructor(baseRPCUrl: string, userAddress: `0x${string}`, logger?: Logger) {
    if (!baseRPCUrl) {
      throw new Error('Base RPC URL is required');
    }
    if (!userAddress) {
      throw new Error('User address is required');
    }
    this.userAddress = userAddress;
    this.logger = logger ?? new ConsoleLogger();
  }

  private async ensureSpendPermission(appName: string): Promise<UserConsent> {
    const sdk = createBaseAccountSDK({
      appName: appName,
      appChainIds: [base.id],
    });
    const provider = sdk.getProvider();

    const privateKey = generatePrivateKey();
    const spender = privateKeyToAccount(privateKey);
    
    const permission = await requestSpendPermission({
      account: account.account.address,
      spender: spender.address,
      token: USDC_CONTRACT_ADDRESS,
      chainId: base.id,
      allowance: 10n,
      periodInDays: 7,
      provider,
    });

    return {privateKey, userAddress: account.account.address, permission, appName, appLogoUrl};
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

export class BaseAppAccount implements Account {
  accountId: string;
  paymentMakers: { [key: string]: PaymentMaker };

  static async create(baseRPCUrl: string) {
    const account = await getCryptoKeyAccount();

    if (!account.account?.address) {
      throw new Error('No account address found—please ensure that wallet is connected');
    }
    return new BaseAppAccount(baseRPCUrl, account.account.address);
  }

  constructor(baseRPCUrl: string, userAddress: `0x${string}`) {
    this.accountId = userAddress;
    this.paymentMakers = {
      'base': new BaseAppPaymentMaker(baseRPCUrl, userAddress),
    };
  }
}