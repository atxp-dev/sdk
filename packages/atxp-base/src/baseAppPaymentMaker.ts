import { USDC_CONTRACT_ADDRESS_BASE, type PaymentMaker } from '@atxp/client';
import { Logger, Currency, ConsoleLogger } from '@atxp/common';
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

async function waitForTransactionConfirmations(
  smartWallet: EphemeralSmartWallet,
  txHash: string,
  confirmations: number,
  logger: Logger
): Promise<void> {
  try {
    const publicClient = smartWallet.client.account?.client;
    if (publicClient && 'waitForTransactionReceipt' in publicClient) {
      logger.info(`Waiting for ${confirmations} confirmations...`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (publicClient as any).waitForTransactionReceipt({
        hash: txHash,
        confirmations: confirmations
      });
      logger.info(`Transaction confirmed with ${confirmations} confirmations`);
    } else {
      logger.warn('Unable to wait for confirmations: client does not support waitForTransactionReceipt');
    }
  } catch (error) {
    logger.warn(`Could not wait for additional confirmations: ${error}`);
    // Continue anyway - the transaction is already mined
  }
}

export class BaseAppPaymentMaker implements PaymentMaker {
  private logger: Logger;
  private spendPermission: SpendPermission;
  private smartWallet: EphemeralSmartWallet;

  constructor(
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
    this.logger = logger ?? new ConsoleLogger();
    this.spendPermission = spendPermission;
    this.smartWallet = smartWallet;
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
    
    const jwtToken = createEIP1271JWT(authData);
    
    this.logger.info(`codeChallenge: ${codeChallenge}`);
    this.logger.info(`paymentRequestId: ${paymentRequestId}`);
    this.logger.info(`walletAddress: ${this.smartWallet.account.address}`);
    this.logger.info(`Generated EIP-1271 JWT: ${jwtToken}`);
    
    return jwtToken;
  }

  async makePayment(amount: BigNumber, currency: Currency, receiver: string, memo: string): Promise<string> {
    if (currency !== 'USDC') {
      throw new Error('Only usdc currency is supported; received ' + currency);
    }

    this.logger.info(`Making spendPermission payment of ${amount} ${currency} to ${receiver} on Base with memo: ${memo}`);

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
      to: USDC_CONTRACT_ADDRESS_BASE as Hex,
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
    await waitForTransactionConfirmations(this.smartWallet, txHash, 2, this.logger);
    
    // Return the actual transaction hash, not the user operation hash
    // The payment verification system needs the on-chain transaction hash
    return txHash;
  }

  /**
   * Dynamically import the appropriate spend-permission module based on environment.
   * Uses browser or node version as appropriate since prepareSpendCallData exists in both.
   */
}
