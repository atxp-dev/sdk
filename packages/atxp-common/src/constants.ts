/**
 * USDC contract addresses by network.
 *
 * Source: https://developers.circle.com/stablecoins/usdc-on-main-networks
 *
 * Includes both human-readable network names (e.g. "base") and CAIP-2
 * identifiers (e.g. "eip155:8453") for convenience.
 */
export const USDC_ADDRESSES: Record<string, string> = {
  'base': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'base_sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  'eip155:8453': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'eip155:84532': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  'solana': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'solana_devnet': '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1': '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
};

/**
 * CAIP-2 network identifiers for EVM chains supported by the CDP facilitator.
 *
 * Source: https://docs.cdp.coinbase.com/x402/network-support
 */
export const CAIP2_NETWORKS: Record<string, string> = {
  base: 'eip155:8453',
  base_sepolia: 'eip155:84532',
  solana: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  solana_devnet: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
};
