import { type WalletClient } from 'viem';

/**
 * Validates that a wallet client supports paymaster functionality via EIP-5792
 * @param walletClient - The wallet client to validate
 * @throws Error if the wallet client doesn't support required features
 */
export async function validatePaymasterCapabilities(
  walletClient: WalletClient
): Promise<void> {
  if (!walletClient.account) {
    throw new Error('Wallet client must have an account');
  }

  if (!('sendCalls' in walletClient)) {
    throw new Error(
      `WalletClient does not have sendCalls method (EIP-5792). ` +
      `Available methods: ${Object.keys(walletClient).join(', ')}`
    );
  }

  console.log('Validated EIP-5792 wallet with sendCalls support:', walletClient.account.address);
  
  // Check wallet capabilities for debugging
  if ('getCapabilities' in walletClient) {
    try {
      const capabilities = await walletClient.getCapabilities();
      console.log('Wallet capabilities:', capabilities);
    } catch (error) {
      console.log('Error getting capabilities:', error);
    }
  }
}

