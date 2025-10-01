import { parseUnits } from "viem";
import { SendTransactionInput } from "@worldcoin/minikit-js";
import type { MiniKit as MiniKitType } from "@worldcoin/minikit-js";
import { ConsoleLogger, Logger } from "@atxp/common";
import { WorldchainAccount } from "./worldchainAccount.js";
import { getDefaultWorldChainRPC } from "./smartWalletHelpers.js";
import { WORLD_CHAIN_MAINNET } from "@atxp/client";

/**
 * Loads and initializes a Worldchain account with MiniKit integration
 * 
 * This function creates a Worldchain account that can interact with the World Chain network
 * using MiniKit for transaction signing and wallet operations. It sets up a custom provider
 * that handles various Ethereum JSON-RPC methods through MiniKit's interface.
 * 
 * @param walletAddress - The wallet address to use for the account
 * @param logger - Optional logger instance for debugging and monitoring
 * @param customRpcUrl - Optional custom RPC URL for Worldchain. If not provided, uses the public RPC endpoint
 * @param chainId - Optional chain ID (defaults to 480 for mainnet, can be 4801 for sepolia)
 * @param miniKit - The MiniKit instance to use for transactions and signing
 * @returns Promise that resolves to an initialized WorldchainAccount instance
 *
 * @example
 * ```typescript
 * // Using public RPC endpoint (mainnet)
 * const account = await createMiniKitWorldchainAccount({
 *   walletAddress: "0x1234...",
 *   logger: new ConsoleLogger(),
 *   miniKit: MiniKit
 * });
 *
 * // Using sepolia testnet
 * const account = await createMiniKitWorldchainAccount({
 *   walletAddress: "0x1234...",
 *   logger: new ConsoleLogger(),
 *   chainId: 4801,
 *   miniKit: MiniKit
 * });
 * ```
 *
 * @remarks
 * The function creates a custom provider that supports:
 * - `eth_accounts`: Returns the wallet address
 * - `eth_chainId`: Returns Worldchain chain ID (configurable)
 * - `eth_requestAccounts`: Returns the wallet address
 * - `eth_sendTransaction`: Handles USDC transfers and other transactions via MiniKit
 * - `personal_sign`: Signs messages using MiniKit
 *
 * The account is configured with:
 * - 10 USDC allowance
 * - 30-day period for permissions
 * - Worldchain RPC endpoint (public or custom)
 * - Regular wallet mode (no ephemeral wallet)
 *
 * @throws {Error} When MiniKit operations fail or unsupported transaction types are encountered
 */
export const createMiniKitWorldchainAccount = async ({walletAddress, logger: loggerParam, customRpcUrl, chainId, miniKit}: {walletAddress: string, logger?: Logger, customRpcUrl?: string, chainId?: number, miniKit: typeof MiniKitType}) => {
  const logger = loggerParam || new ConsoleLogger();
  const effectiveChainId = chainId || WORLD_CHAIN_MAINNET.id;
  const chainIdHex = '0x' + effectiveChainId.toString(16);

  // If no connector client from wagmi, create a simple MiniKit provider
  const provider = {
      request: async (args: { method: string; params: unknown[] }) => {
        const { method, params } = args;
        switch (method) {
          case 'eth_accounts':
            return [walletAddress];
          case 'eth_chainId':
            return chainIdHex;
          case 'eth_requestAccounts':
            return [walletAddress];
          case 'eth_sendTransaction':
            return await handleSendTransaction(params, logger, miniKit);

          case 'personal_sign':
            return await signMessageWithMiniKit(params, miniKit);
          default:
            throw new Error(`Method ${method} not supported in MiniKit context`);
        }
      },
    };

  const worldchainAccount = await WorldchainAccount.initialize({
    walletAddress,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provider: provider as any, // Type cast needed for client compatibility
    allowance: parseUnits("10", 6), // 10 USDC
    useEphemeralWallet: false, // Regular wallet mode (smart wallet infrastructure not available on World Chain)
    periodInDays: 30,
    chainId: effectiveChainId,
    customRpcUrl: customRpcUrl || getDefaultWorldChainRPC(effectiveChainId)  // Use appropriate default RPC URL
  });

  return worldchainAccount;
}

/**
 * Handles eth_sendTransaction requests by processing different transaction types
 * @param params Array containing the transaction object
 * @param logger Logger instance for debugging
 * @returns Transaction hash or throws error
 */
async function handleSendTransaction(params: unknown[], logger: Logger, miniKit: typeof MiniKitType): Promise<string> {
  const transaction = params[0] as {data: string, to: string, value?: string, from: string};

  // Handle USDC transfer (ERC20 transfer function)
  if (transaction.data && transaction.data.startsWith('0xa9059cbb')) {
    // This is a transfer(address,uint256) call - decode the parameters
    const data = transaction.data.slice(10); // Remove function selector

    // Extract recipient address (first 32 bytes, last 20 bytes are the address)
    const recipientHex = '0x' + data.slice(24, 64);

    // Extract amount (next 32 bytes)
    const amountHex = '0x' + data.slice(64, 128);
    const amount = BigInt(amountHex).toString();

    // Validate transaction parameter

    // Check for memo data (any data after the standard 128 characters)
    let memo = '';
    if (data.length > 128) {
      const memoHex = data.slice(128);
      try {
        memo = Buffer.from(memoHex, 'hex').toString('utf8');
      } catch (e) {
        logger.warn(`[MiniKit] Failed to decode memo data: ${e}`);
      }
    }

    // ERC20 ABI for transfer function
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

    const input: SendTransactionInput = {
      transaction: [
        {
          address: transaction.to, // USDC contract address
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [recipientHex, amount],
          value: transaction.value || "0"
        }
      ]
    };

    // TODO: MiniKit doesn't have a standard way to include memo data in ERC20 transfers
    // The memo is extracted and logged but not included in the transaction
    if (memo) {
      logger.debug(`[MiniKit] Memo "${memo}" will be lost in MiniKit transaction - consider alternative approach`);
    }

    const sentResult = await miniKit.commandsAsync.sendTransaction(input);

    if (sentResult.finalPayload?.status === 'success') {
      const transactionId = sentResult.finalPayload.transaction_id;

      // Wait for the transaction to be confirmed and get the actual transaction hash
      const confirmed = await waitForTransactionConfirmation(transactionId, logger, 120000); // 2 minute timeout

      if (confirmed && confirmed.transactionHash) {
        logger.debug(`[MiniKit] Transaction confirmed with hash: ${confirmed.transactionHash}`);
        return confirmed.transactionHash; // Return the actual blockchain transaction hash
      } else {
        logger.error(`[MiniKit] Transaction confirmation failed for ID: ${transactionId}`);
        throw new Error(`Transaction confirmation failed. Transaction may still be pending.`);
      }
    }

    // Enhanced error logging for debugging
    const errorCode = sentResult.finalPayload?.error_code;
    const simulationError = sentResult.finalPayload?.details?.simulationError;

    logger.error(`[MiniKit] Transaction failed: ${JSON.stringify({
      errorCode,
      simulationError,
      fullPayload: sentResult.finalPayload
    })}`);

    // Provide more user-friendly error messages
    let userFriendlyError = `MiniKit sendTransaction failed: ${errorCode}`;

    if (simulationError?.includes('transfer amount exceeds balance')) {
      const amountUSDC = (Number(amount) / 1000000).toFixed(6);
      userFriendlyError = `💳 Insufficient USDC Balance\n\n` +
        `You're trying to send ${amountUSDC} USDC, but your wallet doesn't have enough funds.\n\n` +
        `To complete this payment:\n` +
        `• Add USDC to your World App wallet\n` +
        `• Bridge USDC from another chain\n` +
        `• Buy USDC directly in World App\n\n` +
        `Wallet: ${transaction.from?.slice(0, 6)}...${transaction.from?.slice(-4)}`;
    } else if (simulationError) {
      userFriendlyError += ` - ${simulationError}`;
    }

    throw new Error(userFriendlyError);
  }

  // Handle simple ETH transfers (no data or empty data)
  if (!transaction.data || transaction.data === '0x') {
    // For ETH transfers, you'd need to use the Forward contract
    throw new Error('ETH transfers require Forward contract - not implemented yet');
  }

  // For other transaction types
  throw new Error(`Unsupported transaction type. Data: ${transaction.data.slice(0, 10)}`);
}

/**
 * Signs a message using MiniKit
 * @param params Array containing the message to sign
 * @returns The signature string
 * @throws Error if signing fails
 */
async function signMessageWithMiniKit(params: unknown[], miniKit: typeof MiniKitType): Promise<string> {
  const [message] = params;
  const signResult = await miniKit.commandsAsync.signMessage({ message: message as string });
  if (signResult?.finalPayload?.status === 'success') {
    return signResult.finalPayload.signature;
  }
  throw new Error(`MiniKit signing failed: ${signResult?.finalPayload?.error_code}`);
}

interface WorldTransaction {
  transactionId: string;
  transactionHash: string;
  transactionStatus: 'pending' | 'success' | 'failed';
  network: string;
  fromWalletAddress: string;
  toContractAddress: string;
}

/**
 * Resolves a MiniKit transaction ID to the actual blockchain transaction hash
 * using the World API
 */
export async function resolveTransactionHash(transactionId: string, logger: Logger): Promise<{
  transactionHash: string;
  status: string;
} | null> {
  try {
    const response = await fetch('/api/resolve-transaction', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ transactionId })
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error(`[WorldTransaction] API error: ${response.status} ${error}`);
      return null;
    }

    const transaction: WorldTransaction = await response.json();

    return {
      transactionHash: transaction.transactionHash,
      status: transaction.transactionStatus
    };

  } catch (error) {
    logger.error(`[WorldTransaction] Error resolving transaction: ${error}`);
    return null;
  }
}

/**
 * Waits for a MiniKit transaction to be confirmed and returns the transaction hash
 * Polls the World API until the transaction is confirmed or times out
 */
export async function waitForTransactionConfirmation(
  transactionId: string,
  logger: Logger,
  timeoutMs: number = 120000, // 2 minutes
  pollIntervalMs: number = 2000, // 2 seconds
): Promise<{
  transactionHash: string;
  status: string;
} | null> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const result = await resolveTransactionHash(transactionId, logger);

    if (result && result.transactionHash && result.status !== 'pending') {
      return result;
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  logger.warn(`[WorldTransaction] Timeout waiting for transaction confirmation: ${transactionId}`);
  return null;
}