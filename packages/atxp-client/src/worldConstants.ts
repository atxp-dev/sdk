export const USDC_CONTRACT_ADDRESS_WORLD_MAINNET = "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1"; // USDC.e on World Chain mainnet
export const USDC_CONTRACT_ADDRESS_WORLD_SEPOLIA = "0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88"; // USDC on World Chain Sepolia testnet

// World Chain Mainnet (Chain ID: 480)
export const WORLD_CHAIN_MAINNET = {
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

// World Chain Sepolia Testnet (Chain ID: 4801)
export const WORLD_CHAIN_SEPOLIA = {
  id: 4801,
  name: 'World Chain Sepolia Testnet',
  nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://worldchain-sepolia.g.alchemy.com/public'] }
  },
  blockExplorers: {
    default: { name: 'WorldScan', url: 'https://sepolia.worldscan.org' }
  },
  testnet: true
} as const;