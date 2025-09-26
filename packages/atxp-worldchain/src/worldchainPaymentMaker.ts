import {
  USDC_CONTRACT_ADDRESS_WORLD_MAINNET,
  WORLD_CHAIN_MAINNET,
  type PaymentMaker
} from '@atxp/client';
import { Logger, Currency, ConsoleLogger } from '@atxp/common';
import BigNumber from 'bignumber.js';
import { Address, encodeFunctionData, Hex, parseEther } from 'viem';
import { SpendPermission } from './types.js';
import { type EphemeralSmartWallet } from './smartWalletHelpers.js';
import { prepareSpendCallData } from './spendPermissionShim.js';
import {
  createEIP1271JWT,
  createEIP1271AuthData,
  constructEIP1271Message
} from '@atxp/common';

const USDC_DECIMALS = 6;

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

/**
 * Configuration for transaction confirmation delays
 */
export interface ConfirmationDelays {
  /** Network propagation delay in milliseconds (must be >= 0) */
  networkPropagationMs: number;
  /** Confirmation failed delay in milliseconds (must be >= 0) */
  confirmationFailedMs: number;
}

/**
 * Options for configuring WorldchainPaymentMaker
 */
export interface WorldchainPaymentMakerOptions {
  /** Logger instance for debug output */
  logger?: Logger;
  /** Chain ID (defaults to World Chain Mainnet) */
  chainId?: number;
  /** Custom RPC URL for the chain */
  customRpcUrl?: string;
  /** Custom confirmation delays (defaults to production values) */
  confirmationDelays?: ConfirmationDelays;
}

/**
 * Validates confirmation delays configuration
 */
function validateConfirmationDelays(delays: ConfirmationDelays): void {
  if (delays.networkPropagationMs < 0) {
    throw new Error('networkPropagationMs must be non-negative');
  }
  if (delays.confirmationFailedMs < 0) {
    throw new Error('confirmationFailedMs must be non-negative');
  }
}

const DEFAULT_CONFIRMATION_DELAYS: ConfirmationDelays = {
  networkPropagationMs: 5000, // 5 seconds for production
  confirmationFailedMs: 15000  // 15 seconds for production
};

/**
 * Gets default confirmation delays based on environment
 */
export const getDefaultConfirmationDelays = (): ConfirmationDelays => {
  if (process.env.NODE_ENV === 'test') {
    return { networkPropagationMs: 10, confirmationFailedMs: 20 };
  }
  return DEFAULT_CONFIRMATION_DELAYS;
};

async function waitForTransactionConfirmations(
  smartWallet: EphemeralSmartWallet,
  txHash: string,
  confirmations: number,
  logger: Logger,
  delays: ConfirmationDelays = DEFAULT_CONFIRMATION_DELAYS
): Promise<void> {
  try {
    const publicClient = smartWallet.client.account?.client;
    if (publicClient && 'waitForTransactionReceipt' in publicClient) {
      logger.info(`Waiting for ${confirmations} confirmations...`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (publicClient as any).waitForTransactionReceipt({
        hash: txHash,
        confirmations: 1, // Reduce confirmations to speed up
        timeout: 60000 // 60 second timeout
      });
      logger.info(`Transaction confirmed with 1 confirmation`);

      // Add extra delay for network propagation
      logger.info(`Adding ${delays.networkPropagationMs}ms delay for network propagation...`);
      await new Promise(resolve => setTimeout(resolve, delays.networkPropagationMs));
    } else {
      logger.warn('Unable to wait for confirmations: client does not support waitForTransactionReceipt');
    }
  } catch (error) {
    logger.warn(`Could not wait for additional confirmations: ${error}`);
    // Add longer delay if confirmation failed
    logger.info(`Confirmation failed, adding ${delays.confirmationFailedMs}ms delay for transaction to propagate...`);
    await new Promise(resolve => setTimeout(resolve, delays.confirmationFailedMs));
  }
}

/**
 * Payment maker for World Chain transactions using smart wallets and spend permissions
 *
 * @example
 * ```typescript
 * // For production use (default delays)
 * const paymentMaker = new WorldchainPaymentMaker(permission, wallet);
 *
 * // For testing (fast delays)
 * const paymentMaker = new WorldchainPaymentMaker(permission, wallet, {
 *   confirmationDelays: { networkPropagationMs: 10, confirmationFailedMs: 20 }
 * });
 *
 * // With custom configuration
 * const paymentMaker = new WorldchainPaymentMaker(permission, wallet, {
 *   chainId: 480, // World Chain Mainnet
 *   customRpcUrl: 'https://my-rpc.com',
 *   logger: myLogger
 * });
 * ```
 */
export class WorldchainPaymentMaker implements PaymentMaker {
  private logger: Logger;
  private spendPermission: SpendPermission;
  private smartWallet: EphemeralSmartWallet;
  private chainId: number;
  private customRpcUrl?: string;
  private confirmationDelays: ConfirmationDelays;

  /**
   * Creates a new WorldchainPaymentMaker instance
   *
   * @param spendPermission - The spend permission for transactions
   * @param smartWallet - The smart wallet instance to use
   * @param options - Optional configuration
   */
  constructor(
    spendPermission: SpendPermission,
    smartWallet: EphemeralSmartWallet,
    options: WorldchainPaymentMakerOptions = {}
  ) {
    if (!spendPermission) {
      throw new Error('Spend permission is required');
    }
    if (!smartWallet) {
      throw new Error('Smart wallet is required');
    }

    // Extract and validate options
    const {
      logger,
      chainId = WORLD_CHAIN_MAINNET.id,
      customRpcUrl,
      confirmationDelays
    } = options;

    const finalDelays = confirmationDelays ?? getDefaultConfirmationDelays();
    validateConfirmationDelays(finalDelays);

    this.logger = logger ?? new ConsoleLogger();
    this.spendPermission = spendPermission;
    this.smartWallet = smartWallet;
    this.chainId = chainId;
    this.customRpcUrl = customRpcUrl;
    this.confirmationDelays = finalDelays;
  }

  async generateJWT({paymentRequestId, codeChallenge}: {paymentRequestId: string, codeChallenge: string}): Promise<string> {
    // Generate EIP-1271 auth data for smart wallet authentication
    const timestamp = Math.floor(Date.now() / 1000);

    const message = constructEIP1271Message({
      walletAddress: this.smartWallet.account.address,
      timestamp,
      codeChallenge,
      paymentRequestId
    });

    // Sign the message - this will return an ABI-encoded signature from the smart wallet
    const signature = await this.smartWallet.account.signMessage({
      message: message
    });

    const authData = createEIP1271AuthData({
      walletAddress: this.smartWallet.account.address,
      message,
      signature,
      timestamp,
      codeChallenge,
      paymentRequestId
    });

    return createEIP1271JWT(authData);
  }

  async makePayment(amount: BigNumber, currency: Currency, receiver: string, memo: string): Promise<string> {
    if (currency !== 'USDC') {
      throw new Error('Only usdc currency is supported; received ' + currency);
    }

    // Use World Chain Mainnet configuration
    const usdcAddress = USDC_CONTRACT_ADDRESS_WORLD_MAINNET;
    // Convert amount to USDC units (6 decimals) as BigInt for spendPermission
    const amountInUSDCUnits = BigInt(amount.multipliedBy(10 ** USDC_DECIMALS).toFixed(0));
    const spendCalls = await prepareSpendCallData({ permission: this.spendPermission, amount: amountInUSDCUnits });

    // Add a second call to transfer USDC from the smart wallet to the receiver
    let transferCallData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [receiver as Address, amountInUSDCUnits],
    });

    // Append memo to transfer call data if present
    // This works because the EVM ignores extra calldata beyond what a function expects.
    // The ERC20 transfer() function only reads the first 68 bytes (4-byte selector + 32-byte address + 32-byte amount).
    // Any additional data appended after those 68 bytes is safely ignored by the USDC contract
    // but remains accessible in the transaction data for payment verification.
    // This is a well-established pattern used by OpenSea, Uniswap, and other major protocols.
    if (memo && memo.trim()) {
      const memoHex = Buffer.from(memo.trim(), 'utf8').toString('hex');
      transferCallData = (transferCallData + memoHex) as Hex;
      this.logger.info(`Added memo "${memo.trim()}" to transfer call`);
    }

    const transferCall = {
      to: usdcAddress as Hex,
      data: transferCallData,
      value: '0x0' as Hex
    };

    // Combine spend permission calls with the transfer call
    const allCalls = [...spendCalls, transferCall];

    this.logger.info(`Executing ${allCalls.length} calls (${spendCalls.length} spend permission + 1 transfer)`);
    const hash = await this.smartWallet.client.sendUserOperation({
      account: this.smartWallet.account,
      calls: allCalls.map(call => {
        return {
          to: call.to as Hex,
          data: call.data as Hex,
          value: BigInt(call.value || '0x0')
        }
      }),
      maxPriorityFeePerGas: parseEther('0.000000001')
    })

    const receipt = await this.smartWallet.client.waitForUserOperationReceipt({ hash })
    if (!receipt) {
      throw new Error('User operation failed');
    }

    // The receipt contains the actual transaction hash that was mined on chain
    const txHash = receipt.receipt.transactionHash;

    if (!txHash) {
      throw new Error('User operation was executed but no transaction hash was returned. This should not happen.');
    }

    this.logger.info(`Spend permission executed successfully. UserOp: ${receipt.userOpHash}, TxHash: ${txHash}`);

    // Wait for additional confirmations to ensure the transaction is well-propagated
    // This helps avoid the "Transaction receipt could not be found" error
    await waitForTransactionConfirmations(this.smartWallet, txHash, 2, this.logger, this.confirmationDelays);

    // Return the actual transaction hash, not the user operation hash
    // The payment verification system needs the on-chain transaction hash
    return txHash;
  }
}