/**
 * World Chain configuration type, compatible with viem's Chain interface
 */
export type WorldChain = {
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

export const USDC_CONTRACT_ADDRESS_WORLD_MAINNET = "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1"; // USDC.e on World Chain mainnet

// World Chain Mainnet (Chain ID: 480)
export const WORLD_CHAIN_MAINNET: WorldChain = {
  id: 480,
  name: 'World Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://worldchain-mainnet.g.alchemy.com/public'] }
  },
  blockExplorers: {
    default: { name: 'WorldScan', url: 'https://worldscan.org' }
  }
} as const;

/**
 * Get World Chain Mainnet configuration with custom RPC URL (e.g., with API key)
 * @param rpcUrl - Custom RPC URL, e.g., 'https://worldchain-mainnet.g.alchemy.com/v2/YOUR_API_KEY'
 */
export const getWorldChainMainnetWithRPC = (rpcUrl: string): WorldChain => ({
  ...WORLD_CHAIN_MAINNET,
  rpcUrls: {
    default: { http: [rpcUrl] }
  }
});

