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
export const USDC_CONTRACT_ADDRESS_POLYGON_AMOY = "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582"; // USDC on Polygon Amoy testnet

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

// Polygon Amoy Testnet (Chain ID: 80002)
export const POLYGON_AMOY: PolygonChain = {
  id: 80002,
  name: 'Polygon Amoy',
  nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc-amoy.polygon.technology'] }
  },
  blockExplorers: {
    default: { name: 'PolygonScan Amoy', url: 'https://amoy.polygonscan.com' }
  },
  testnet: true
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
 * Get Polygon Amoy Testnet configuration with custom RPC URL (e.g., with API key)
 * @param rpcUrl - Custom RPC URL, e.g., 'https://polygon-amoy.g.alchemy.com/v2/YOUR_API_KEY'
 */
export const getPolygonAmoyWithRPC = (rpcUrl: string): PolygonChain => ({
  ...POLYGON_AMOY,
  rpcUrls: {
    default: { http: [rpcUrl] }
  }
});

/**
 * Get Polygon Chain configuration by chain ID
 * @param chainId - Chain ID (137 for mainnet, 80002 for Amoy testnet)
 * @returns Polygon Chain configuration
 * @throws Error if chain ID is not supported
 */
export const getPolygonByChainId = (chainId: number): PolygonChain => {
  switch (chainId) {
    case 137:
      return POLYGON_MAINNET;
    case 80002:
      return POLYGON_AMOY;
    default:
      throw new Error(`Unsupported Polygon Chain ID: ${chainId}. Supported chains: 137 (mainnet), 80002 (Amoy testnet)`);
  }
};

/**
 * Get USDC contract address for Polygon by chain ID
 * @param chainId - Chain ID (137 for mainnet, 80002 for Amoy testnet)
 * @returns USDC contract address
 * @throws Error if chain ID is not supported
 */
export const getPolygonUSDCAddress = (chainId: number): string => {
  switch (chainId) {
    case 137:
      return USDC_CONTRACT_ADDRESS_POLYGON_MAINNET;
    case 80002:
      return USDC_CONTRACT_ADDRESS_POLYGON_AMOY;
    default:
      throw new Error(`Unsupported Polygon Chain ID: ${chainId}. Supported chains: 137 (mainnet), 80002 (Amoy testnet)`);
  }
};
