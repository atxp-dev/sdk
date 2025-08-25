import type { PaymentMaker, Hex } from './types.js';
import { InsufficientFundsError as InsufficientFundsErrorClass, PaymentNetworkError as PaymentNetworkErrorClass } from './types.js';
import { Logger, Currency } from '@atxp/common';
import { ConsoleLogger } from '@atxp/common';
import {
  Address,
  //createWalletClient,
  //http,
  parseEther,
  publicActions,
  encodeFunctionData,
  WalletClient,
  PublicActions,
  //Account,
  //decodeAbiParameters,
  //parseSignature,
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
/*
// Helper function to convert P-256 public key bytes to PEM format
function p256PublicKeyToPEM(publicKeyBytes: string): string {
  // Remove 0x prefix if present
  const hex = publicKeyBytes.startsWith('0x') ? publicKeyBytes.slice(2) : publicKeyBytes;
  
  // P-256 public key should be 64 bytes (128 hex chars) - x and y coordinates
  if (hex.length !== 128) {
    throw new Error(`Invalid P-256 public key length: expected 128 hex chars, got ${hex.length}`);
  }
  
  // Create the DER encoding for a P-256 public key
  // This includes the algorithm identifier and the public key point
  const algorithmIdentifier = '3059301306072a8648ce3d020106082a8648ce3d030107034200';
  const fullKey = algorithmIdentifier + '04' + hex; // 04 prefix for uncompressed point
  
  // Convert to base64
  const keyBytes = Buffer.from(fullKey, 'hex');
  const base64 = keyBytes.toString('base64');
  
  // Format as PEM
  return `-----BEGIN PUBLIC KEY-----\n${base64.match(/.{1,64}/g)?.join('\n')}\n-----END PUBLIC KEY-----`;
}

// Helper function to validate extracted signature components
function validateSignatureComponents(r: string, s: string): void {
  // Check if r or s are all zeros or have too many leading zeros
  const rBigInt = BigInt('0x' + r);
  const sBigInt = BigInt('0x' + s);
  
  if (rBigInt === 0n) {
    throw new Error('Invalid signature: r component is zero');
  }
  
  if (sBigInt === 0n) {
    throw new Error('Invalid signature: s component is zero');
  }
  
  // Check if values are suspiciously small (too many leading zeros)
  // A valid signature component should use most of its 32 bytes
  const rHex = rBigInt.toString(16);
  const sHex = sBigInt.toString(16);
  
  // If the actual value is less than 16 bytes (32 hex chars), it's suspicious
  if (rHex.length < 32) {
    throw new Error(`Invalid signature: r component suspiciously small (${rHex.length} hex digits)`);
  }
  
  if (sHex.length < 32) {
    throw new Error(`Invalid signature: s component suspiciously small (${sHex.length} hex digits)`);
  }
  
  // Check if r and s are within valid range for P-256 curve
  const P256_ORDER = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
  
  if (rBigInt >= P256_ORDER) {
    throw new Error('Invalid signature: r component exceeds P-256 curve order');
  }
  
  if (sBigInt >= P256_ORDER) {
    throw new Error('Invalid signature: s component exceeds P-256 curve order');
  }
  
  // Check for suspicious patterns (e.g., repeated bytes)
  const rPattern = r.match(/(.)\1{15,}/);  // 16 or more repeated chars
  const sPattern = s.match(/(.)\1{15,}/);
  
  if (rPattern) {
    throw new Error(`Invalid signature: r component has suspicious repeated pattern`);
  }
  
  if (sPattern) {
    throw new Error(`Invalid signature: s component has suspicious repeated pattern`);
  }
}

// Helper function to extract ES256 signature from WebAuthn data
function extractSignatureFromWebAuthn(webAuthnSignature: string): string {
  console.log('\n=== WebAuthn Signature Extraction ===');
  
  const hexData = webAuthnSignature.slice(2); // Remove 0x prefix
  console.log('Hex data length (without 0x):', hexData.length);
  
  // Based on analysis of Coinbase Smart Wallet WebAuthn responses,
  // the signature r,s values are consistently at these positions:
  const R_OFFSET = 576;  // Position where r value starts
  const S_OFFSET = 640;  // Position where s value starts
  const SIGNATURE_COMPONENT_LENGTH = 64; // 32 bytes = 64 hex chars
  
  // Validate that we have enough data
  if (hexData.length < S_OFFSET + SIGNATURE_COMPONENT_LENGTH) {
    throw new Error(`WebAuthn response too short: expected at least ${S_OFFSET + SIGNATURE_COMPONENT_LENGTH} chars, got ${hexData.length}`);
  }
  
  // Extract r and s values
  const r = hexData.substring(R_OFFSET, R_OFFSET + SIGNATURE_COMPONENT_LENGTH);
  const s = hexData.substring(S_OFFSET, S_OFFSET + SIGNATURE_COMPONENT_LENGTH);
  
  console.log('Extracted signature components:');
  console.log('- r:', r);
  console.log('- s:', s);
  
  // Validate the extracted components with the separate validation function
  try {
    validateSignatureComponents(r, s);
    console.log('Signature validation passed');
  } catch (error) {
    console.error('Signature validation failed:', error);
    throw error;
  }
  
  return `0x${r}${s}`;
}
  */

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
  //protected account: Account;
  protected logger: Logger;

  /*
  static fromSecretKey(baseRPCUrl: string, sourceSecretKey: Hex, logger?: Logger): BasePaymentMaker {
    const account = privateKeyToAccount(sourceSecretKey);
    return new BasePaymentMaker(baseRPCUrl, account, logger);
  }*/

  constructor(baseRPCUrl: string, walletClient: WalletClient, logger?: Logger) {
    if (!baseRPCUrl) {
      throw new Error('baseRPCUrl was empty');
    }
    if (!walletClient) {
      throw new Error('walletClient was empty');
    }
    if(!walletClient.account) {
      throw new Error('walletClient.account was empty');
    }

    this.signingClient = walletClient.extend(publicActions) as ExtendedWalletClient;
    //this.publicClient = createWalletClient({
      //account: this.account,
      //chain: base,
      //transport: http(baseRPCUrl),
    //}).extend(publicActions) as ExtendedWalletClient;
    this.logger = logger ?? new ConsoleLogger();
  }

  async generateJWT({paymentRequestId, codeChallenge}: {paymentRequestId: string, codeChallenge: string}): Promise<string> {
    // TODO: Detect wallet type properly
    const isWebAuthn = true; // TODO: Detect if using WebAuthn/Coinbase Smart Wallet
    
    if (isWebAuthn) {
      // For WebAuthn/Coinbase Smart Wallets, use EIP-1271 instead of JWT
      console.log('\n=== EIP-1271 Authentication Mode ===');
      console.log('Using EIP-1271 signature verification for smart wallet');
      
      // Create a structured message for signing
      const timestamp = Math.floor(Date.now() / 1000);
      const nonce = Math.random().toString(36).substring(2, 15);
      
      const messageParts = [
        'PayMCP Authorization Request',
        '',
        `Wallet: ${this.signingClient.account!.address}`,
        `Timestamp: ${timestamp}`,
        `Nonce: ${nonce}`
      ];
      
      if (codeChallenge) {
        messageParts.push(`Code Challenge: ${codeChallenge}`);
      }
      
      if (paymentRequestId) {
        messageParts.push(`Payment Request ID: ${paymentRequestId}`);
      }
      
      messageParts.push('', '', 'Sign this message to prove you control this wallet.');
      
      const message = messageParts.join('\n');

      console.log('Message to sign:', message);

      // Sign the message with the wallet (triggers WebAuthn/fingerprint)
      const signature = await this.signingClient.signMessage({
        account: this.signingClient.account!,
        message: message,
      });
      
      console.log('Signature (WebAuthn response):', signature.substring(0, 100) + '...');

      // Create the auth data object
      const authData = {
        type: 'EIP1271_AUTH',
        walletAddress: this.signingClient.account!.address,
        message: message,
        signature: signature,
        timestamp: timestamp,
        nonce: nonce,
        ...(codeChallenge ? { code_challenge: codeChallenge } : {}),
        ...(paymentRequestId ? { payment_request_id: paymentRequestId } : {}),
      };

      // Serialize as base64url for transmission (similar to JWT format)
      const serialized = toBase64Url(JSON.stringify(authData));
      console.log('Serialized auth data length:', serialized.length);
      console.log('Serialized auth data:', serialized);
      
      return serialized;
    } else {
      // Original JWT logic for regular wallets
      const headerObj = { alg: 'ES256K' };
      
      const payloadObj = {
        sub: this.signingClient.account!.address,
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
      
      const signResult = await this.signingClient.signMessage({
        account: this.signingClient.account!,
        message: { raw: messageBytes },
      });

      // For ES256K, signature is typically 65 bytes (r,s,v)
      let signature: string;
      if (typeof Buffer !== 'undefined') {
        signature = Buffer.from(signResult.slice(2), 'hex').toString('base64url');
      } else {
        // Browser environment
        const hexStr = signResult.slice(2);
        const bytes = new Uint8Array(hexStr.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
        const base64 = btoa(String.fromCharCode(...bytes));
        signature = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
      }

      const jwt = `${header}.${payload}.${signature}`;
      console.log('Generated ES256K JWT:', jwt);
      return jwt;
    }
  }

  async makePayment(amount: BigNumber, currency: Currency, receiver: string): Promise<string> {
    if (currency.toUpperCase() !== 'USDC') {
      throw new PaymentNetworkErrorClass('Only USDC currency is supported; received ' + currency);
    }

    this.logger.info(`Making payment of ${amount} ${currency} to ${receiver} on Base from ${this.signingClient.account!.address}`);

    try {
      // Check balance before attempting payment
      const balanceRaw = await this.signingClient.readContract({
        address: USDC_CONTRACT_ADDRESS_BASE as Address,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [this.signingClient.account!.address],
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
        account: this.signingClient.account!,
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
