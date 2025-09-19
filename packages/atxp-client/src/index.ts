// Main client functionality
export {
  type ClientArgs,
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
  type ATXPFetcherConfig,
  atxpFetch,
  ATXPFetcher
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
} from './atxpAccount.js';

export {
  USDC_CONTRACT_ADDRESS_BASE
} from './baseConstants.js';

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
  InsufficientFundsError,
  PaymentNetworkError,
  type PaymentMaker
} from './types.js';

export {
  RemoteSigner,
  createRemoteSigner
} from './remoteSigner.js';
