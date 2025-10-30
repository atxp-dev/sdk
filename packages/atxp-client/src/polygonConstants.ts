/**
 * Polygon Chain configuration type, compatible with viem's Chain interface
 */
export type PolygonChain = {
  readonly id: number;
  readonly name: string;
  readonly nativeCurrency: {
    readonly name: string;
    readonly symbol: string;
    readonly decimals: number;
  };
  readonly rpcUrls: {
    readonly default: { readonly http: readonly string[] };
  };
  readonly blockExplorers: {
    readonly default: { readonly name: string; readonly url: string };
  };
  readonly testnet?: boolean;
};

export const USDC_CONTRACT_ADDRESS_POLYGON_MAINNET = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"; // Native USDC on Polygon mainnet

// Polygon Mainnet (Chain ID: 137)
export const POLYGON_MAINNET: PolygonChain = {
  id: 137,
  name: 'Polygon',
  nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://polygon-rpc.com'] }
  },
  blockExplorers: {
    default: { name: 'PolygonScan', url: 'https://polygonscan.com' }
  }
} as const;

/**
 * Get Polygon Mainnet configuration with custom RPC URL (e.g., with API key)
 * @param rpcUrl - Custom RPC URL, e.g., 'https://polygon-mainnet.g.alchemy.com/v2/YOUR_API_KEY'
 */
export const getPolygonMainnetWithRPC = (rpcUrl: string): PolygonChain => ({
  ...POLYGON_MAINNET,
  rpcUrls: {
    default: { http: [rpcUrl] }
  }
});

/**
 * Get Polygon Chain configuration by chain ID
 * @param chainId - Chain ID (137 for mainnet)
 * @returns Polygon Chain configuration
 * @throws Error if chain ID is not supported
 */
export const getPolygonByChainId = (chainId: number): PolygonChain => {
  switch (chainId) {
    case 137:
      return POLYGON_MAINNET;
    default:
      throw new Error(`Unsupported Polygon Chain ID: ${chainId}. Supported chains: 137 (mainnet)`);
  }
};

/**
 * Get USDC contract address for Polygon by chain ID
 * @param chainId - Chain ID (137 for mainnet)
 * @returns USDC contract address
 * @throws Error if chain ID is not supported
 */
export const getPolygonUSDCAddress = (chainId: number): string => {
  switch (chainId) {
    case 137:
      return USDC_CONTRACT_ADDRESS_POLYGON_MAINNET;
    default:
      throw new Error(`Unsupported Polygon Chain ID: ${chainId}. Supported chains: 137 (mainnet)`);
  }
};
