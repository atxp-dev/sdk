// Main client functionality
export {
  DEFAULT_CLIENT_CONFIG,
  buildClientConfig,
  buildStreamableTransport,
  atxpClient
} from './atxpClient.js';

// OAuth client
export {
  OAuthAuthenticationRequiredError,
  type OAuthClientConfig,
  OAuthClient
} from './oAuth.js';

// HTTP fetcher with ATXP support
export {
  atxpFetch
} from './atxpFetcher.js';

// Payment makers for different networks
export {
  ValidateTransferError,
  SolanaPaymentMaker
} from './solanaPaymentMaker.js';

export {
  BasePaymentMaker
} from './basePaymentMaker.js';

// Account implementations
export {
  SolanaAccount
} from './solanaAccount.js';

export {
  ATXPAccount
} from '@atxp/common';

export {
  USDC_CONTRACT_ADDRESS_BASE,
  USDC_CONTRACT_ADDRESS_BASE_SEPOLIA,
  getBaseUSDCAddress
} from './baseConstants.js';

export {
  USDC_CONTRACT_ADDRESS_WORLD_MAINNET,
  USDC_CONTRACT_ADDRESS_WORLD_SEPOLIA,
  WORLD_CHAIN_MAINNET,
  WORLD_CHAIN_SEPOLIA,
  getWorldChainMainnetWithRPC,
  getWorldChainSepoliaWithRPC,
  getWorldChainByChainId,
  getWorldChainUSDCAddress,
  type WorldChain
} from './worldConstants.js';

export {
  USDC_CONTRACT_ADDRESS_POLYGON_MAINNET,
  POLYGON_MAINNET,
  getPolygonMainnetWithRPC,
  getPolygonByChainId,
  getPolygonUSDCAddress,
  type PolygonChain
} from './polygonConstants.js';

export {
  BaseAccount
} from './baseAccount.js';

// Core types and interfaces
export {
  type Hex,
  type AccountIdString,
  type Account,
  type ProspectivePayment,
  type ClientConfig,
  type ClientArgs,
  type FetchWrapper,
  InsufficientFundsError,
  PaymentNetworkError,
  type PaymentMaker
} from './types.js';

export {
  ATXPLocalAccount
} from './atxpLocalAccount.js';

// Destination makers
export {
  ATXPDestinationMaker,
  PassthroughDestinationMaker,
} from './destinationMakers/index.js';

