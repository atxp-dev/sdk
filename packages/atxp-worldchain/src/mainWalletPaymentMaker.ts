import {
  USDC_CONTRACT_ADDRESS_WORLD_MAINNET,
  USDC_CONTRACT_ADDRESS_WORLD_SEPOLIA,
  WORLD_CHAIN_MAINNET,
  WORLD_CHAIN_SEPOLIA,
  getWorldChainMainnetWithRPC,
  getWorldChainSepoliaWithRPC,
  type PaymentMaker,
  type Hex
} from '@atxp/client';
import { Logger, Currency, ConsoleLogger } from '@atxp/common';
import BigNumber from 'bignumber.js';
import { createWalletClient, createPublicClient, custom, encodeFunctionData, http } from 'viem';

const USDC_DECIMALS = 6;

export type MainWalletProvider = {
  request: (params: { method: string; params?: unknown[] }) => Promise<unknown>;
};

// Minimal ERC20 ABI for transfer function
const ERC20_ABI = [
  {
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    name: 'transfer',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function'
  }
] as const;

export class MainWalletPaymentMaker implements PaymentMaker {
  private walletAddress: string;
  private provider: MainWalletProvider;
  private logger: Logger;
  private chainId: number;
  private customRpcUrl?: string;

  constructor(
    walletAddress: string,
    provider: MainWalletProvider,
    logger?: Logger,
    chainId: number = WORLD_CHAIN_MAINNET.id,
    customRpcUrl?: string
  ) {
    this.walletAddress = walletAddress;
    this.provider = provider;
    this.logger = logger ?? new ConsoleLogger();
    this.chainId = chainId;
    this.customRpcUrl = customRpcUrl;
  }

  async generateJWT({
    paymentRequestId,
    codeChallenge
  }: {
    paymentRequestId: string;
    codeChallenge: string;
  }): Promise<string> {
    const timestamp = Math.floor(Date.now() / 1000);

    // Create proper JWT header and payload for ES256K
    const header = {
      alg: 'ES256K',
      typ: 'JWT'
    };

    const payload = {
      sub: this.walletAddress,
      iss: 'accounts.atxp.ai',
      aud: 'https://auth.atxp.ai',
      iat: timestamp,
      exp: timestamp + 3600, // 1 hour expiration
      payment_request_id: paymentRequestId,
      code_challenge: codeChallenge,
      chain_id: this.chainId
    };

    // Encode header and payload to base64url
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');

    // Create the message that ES256K should actually sign (header.payload)
    const messageToSign = `${encodedHeader}.${encodedPayload}`;

    this.logger.info(`ES256K signing JWT message: ${messageToSign}`);

    // Sign the actual JWT header.payload string using personal_sign
    const signature = await this.provider.request({
      method: 'personal_sign',
      params: [messageToSign, this.walletAddress]
    });

    // Use the legacy format (base64url of hex string with 0x prefix)
    // This matches what the ES256K verification expects
    const encodedSignature = Buffer.from(signature as string).toString('base64url');

    const jwt = `${encodedHeader}.${encodedPayload}.${encodedSignature}`;

    this.logger.info(`Generated ES256K JWT for main wallet: ${this.walletAddress}`);
    this.logger.info(`JWT Debug - Original signature: ${signature}`);
    this.logger.info(`JWT Debug - Using LEGACY FORMAT (0x prefix as base64url)`);
    this.logger.info(`JWT Debug - Encoded signature (base64url): ${encodedSignature}`);
    this.logger.info(`JWT Debug - Final JWT: ${jwt}`);

    return jwt;
  }

  async makePayment(
    amount: BigNumber,
    currency: Currency,
    receiver: string,
    memo: string
  ): Promise<string> {
    if (currency !== 'USDC') {
      throw new Error('Only USDC currency is supported; received ' + currency);
    }

    // Determine USDC contract address and chain config based on chain
    const usdcAddress = this.chainId === WORLD_CHAIN_SEPOLIA.id
      ? USDC_CONTRACT_ADDRESS_WORLD_SEPOLIA
      : USDC_CONTRACT_ADDRESS_WORLD_MAINNET;

    const chainConfig = this.customRpcUrl
      ? (this.chainId === WORLD_CHAIN_SEPOLIA.id
          ? getWorldChainSepoliaWithRPC(this.customRpcUrl)
          : getWorldChainMainnetWithRPC(this.customRpcUrl))
      : (this.chainId === WORLD_CHAIN_SEPOLIA.id
          ? WORLD_CHAIN_SEPOLIA
          : WORLD_CHAIN_MAINNET);

    const chainName = chainConfig.name;

    this.logger.info(
      `Making direct wallet payment of ${amount} ${currency} to ${receiver} on ${chainName} with memo: ${memo}`
    );

    // Convert amount to USDC units (6 decimals)
    const amountInUSDCUnits = BigInt(amount.multipliedBy(10 ** USDC_DECIMALS).toFixed(0));

    // Prepare transfer call data
    let transferCallData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [receiver as `0x${string}`, amountInUSDCUnits]
    });

    // Append memo to call data if present
    if (memo && memo.trim()) {
      const memoHex = Buffer.from(memo.trim(), 'utf8').toString('hex');
      transferCallData = (transferCallData + memoHex) as Hex;
      this.logger.info(`Added memo "${memo.trim()}" to transfer call`);
    }

    // Create wallet client
    const walletClient = createWalletClient({
      chain: chainConfig,
      transport: custom(this.provider)
    });

    // Send transaction directly from main wallet
    const txHash = await walletClient.sendTransaction({
      account: this.walletAddress as `0x${string}`,
      to: usdcAddress,
      data: transferCallData,
      value: 0n,
      chain: chainConfig
    });

    this.logger.info(`Payment sent successfully. TxHash: ${txHash}`);
    this.logger.info(`🌐 Transaction URL: https://worldscan.org/tx/${txHash}`);
    this.logger.info(`🔗 Using custom RPC: ${this.customRpcUrl ? 'YES' : 'NO'} - ${this.customRpcUrl || 'default public endpoint'}`);

    // Log the transaction details immediately after sending
    this.logger.info('🕐 Checking transaction status immediately after sending...');
    try {
      const immediateRpcUrl = this.customRpcUrl || chainConfig.rpcUrls.default.http[0];
      const publicClient = createPublicClient({
        chain: chainConfig,
        transport: http(immediateRpcUrl, {
          timeout: 10000, // Short timeout for immediate check
          retryCount: 1
        })
      });

      const tx = await publicClient.getTransaction({ hash: txHash });
      this.logger.info(`📋 Transaction found immediately: ${tx ? 'YES' : 'NO'}`);
      if (tx) {
        this.logger.info(`📦 Block number: ${tx.blockNumber || 'pending'}`);
      }
    } catch (immediateError) {
      this.logger.warn(`🔍 Immediate transaction lookup failed: ${immediateError}`);
    }

    // Wait for transaction confirmation to ensure it's mined
    // This prevents "Transaction receipt could not be found" errors
    try {
      this.logger.info(`Waiting for transaction confirmation...`);

      // Create a public client to wait for the transaction receipt
      // Use custom RPC URL if provided for better consistency with auth server
      const rpcUrl = this.customRpcUrl || chainConfig.rpcUrls.default.http[0];
      this.logger.info(`Using RPC URL for transaction confirmation: ${rpcUrl}`);

      const publicClient = createPublicClient({
        chain: chainConfig,
        transport: http(rpcUrl, {
          timeout: 30000, // 30 second timeout for individual RPC calls
          retryCount: 3,  // Retry failed requests
          retryDelay: 1000 // 1 second delay between retries
        })
      });

      await publicClient.waitForTransactionReceipt({
        hash: txHash,
        confirmations: 1, // Reduce to 1 confirmation to speed up
        timeout: 120000 // 2 minute timeout - World Chain can be slow
      });
      this.logger.info(`Transaction confirmed with 1 confirmation`);

      // Add extra delay to ensure the transaction is well propagated across network
      this.logger.info('Adding 5 second delay for network propagation...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (error) {
      this.logger.warn(`Could not wait for confirmations: ${error}`);
      // Add a much longer delay if confirmation failed - World Chain can be slow
      this.logger.info('Confirmation failed, adding 30 second delay for transaction to propagate across World Chain network...');
      await new Promise(resolve => setTimeout(resolve, 30000));

      // Also try to manually check if transaction exists using a different method
      this.logger.info('Attempting manual transaction verification...');
      try {
        const manualRpcUrl = this.customRpcUrl || chainConfig.rpcUrls.default.http[0];
        const publicClient = createPublicClient({
          chain: chainConfig,
          transport: http(manualRpcUrl, {
            timeout: 45000, // Even longer timeout for manual check
            retryCount: 5,
            retryDelay: 2000
          })
        });

        const tx = await publicClient.getTransaction({ hash: txHash });
        if (tx) {
          this.logger.info(`Manual verification successful - transaction found: ${tx.blockNumber ? 'mined' : 'pending'}`);
        }
      } catch (manualError) {
        this.logger.warn(`Manual verification also failed: ${manualError}`);
      }
    }

    return txHash;
  }
}