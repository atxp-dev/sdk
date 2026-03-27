// pathUSD on Tempo (TIP-20 token, 6 decimals)
export const PATHUSD_CONTRACT_ADDRESS_TEMPO = "0x20c0000000000000000000000000000000000000";

// Chain IDs
export const TEMPO_MAINNET_CHAIN_ID = 4217;
export const TEMPO_TESTNET_CHAIN_ID = 42431;

/**
 * Get pathUSD contract address for Tempo chain by chain ID.
 * pathUSD is the same address on both mainnet and testnet.
 * @param chainId - Chain ID (4217 for mainnet, 42431 for testnet)
 * @returns pathUSD contract address
 * @throws Error if chain ID is not supported
 */
export const getTempoPathUSDAddress = (chainId: number): string => {
  switch (chainId) {
    case TEMPO_MAINNET_CHAIN_ID:
    case TEMPO_TESTNET_CHAIN_ID:
      return PATHUSD_CONTRACT_ADDRESS_TEMPO;
    default:
      throw new Error(`Unsupported Tempo Chain ID: ${chainId}. Supported chains: ${TEMPO_MAINNET_CHAIN_ID} (mainnet), ${TEMPO_TESTNET_CHAIN_ID} (testnet)`);
  }
};

/**
 * Tempo chain definitions for viem.
 */
export const tempoMainnet = {
  id: TEMPO_MAINNET_CHAIN_ID,
  name: 'Tempo',
  nativeCurrency: { name: 'TEMPO', symbol: 'TEMPO', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.tempo.xyz'] },
  },
  blockExplorers: {
    default: { name: 'Tempo Explorer', url: 'https://explore.tempo.xyz' },
  },
} as const;

export const tempoTestnet = {
  id: TEMPO_TESTNET_CHAIN_ID,
  name: 'Tempo Moderato',
  nativeCurrency: { name: 'TEMPO', symbol: 'TEMPO', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.moderato.tempo.xyz'] },
  },
  blockExplorers: {
    default: { name: 'Tempo Moderato Explorer', url: 'https://explore.moderato.tempo.xyz' },
  },
} as const;

/**
 * Get the Tempo chain config by chain ID.
 */
export const getTempoChain = (chainId: number) => {
  switch (chainId) {
    case TEMPO_MAINNET_CHAIN_ID:
      return tempoMainnet;
    case TEMPO_TESTNET_CHAIN_ID:
      return tempoTestnet;
    default:
      throw new Error(`Unsupported Tempo Chain ID: ${chainId}`);
  }
};
