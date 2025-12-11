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

// Account implementations - re-export from @atxp/common
export {
  ATXPAccount
} from '@atxp/common';

// World chain constants (still in client for now)
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

// Polygon chain constants (still in client for now)
export {
  USDC_CONTRACT_ADDRESS_POLYGON_MAINNET,
  USDC_CONTRACT_ADDRESS_POLYGON_AMOY,
  POLYGON_MAINNET,
  POLYGON_AMOY,
  getPolygonMainnetWithRPC,
  getPolygonAmoyWithRPC,
  getPolygonByChainId,
  getPolygonUSDCAddress,
  type PolygonChain
} from './polygonConstants.js';

// Core types and interfaces
export {
  type Hex,
  type AccountIdString,
  type Account,
  type ProspectivePayment,
  type PaymentFailureContext,
  type ClientConfig,
  type ClientArgs,
  type FetchWrapper,
  ATXPPaymentError,
  InsufficientFundsError,
  TransactionRevertedError,
  UnsupportedCurrencyError,
  GasEstimationError,
  RpcError,
  UserRejectedError,
  PaymentServerError,
  PaymentExpiredError,
  PaymentNetworkError,
  type PaymentMaker
} from './types.js';

// ATXPLocalAccount - generic EVM account helper (used by x402 and other packages)
export {
  ATXPLocalAccount
} from './atxpLocalAccount.js';

// Destination makers
export {
  ATXPDestinationMaker,
  PassthroughDestinationMaker,
} from './destinationMakers/index.js';

