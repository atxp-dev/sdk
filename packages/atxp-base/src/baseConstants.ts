export const USDC_CONTRACT_ADDRESS_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC on Base mainnet
export const USDC_CONTRACT_ADDRESS_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // USDC on Base Sepolia testnet

/**
 * Get USDC contract address for Base chain by chain ID
 * @param chainId - Chain ID (8453 for mainnet, 84532 for sepolia)
 * @returns USDC contract address
 * @throws Error if chain ID is not supported
 */
export const getBaseUSDCAddress = (chainId: number): string => {
  switch (chainId) {
    case 8453: // Base mainnet
      return USDC_CONTRACT_ADDRESS_BASE;
    case 84532: // Base Sepolia
      return USDC_CONTRACT_ADDRESS_BASE_SEPOLIA;
    default:
      throw new Error(`Unsupported Base Chain ID: ${chainId}. Supported chains: 8453 (mainnet), 84532 (sepolia)`);
  }
};
