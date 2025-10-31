// JWT utilities
export { generateJWT } from './jwt.js';

// Logging
export { ConsoleLogger } from './logger.js';

// OAuth database implementations
export { 
  MemoryOAuthDb,
  type MemoryOAuthDbConfig 
} from './memoryOAuthDb.js';

// OAuth resource client
export { 
  OAuthResourceClient,
  type OAuthResourceClientConfig 
} from './oAuthResource.js';

// Payment error handling
export { 
  PAYMENT_REQUIRED_ERROR_CODE,
  PAYMENT_REQUIRED_PREAMBLE,
  paymentRequiredError 
} from './paymentRequiredError.js';

// Server configurations
export { Servers } from './servers.js';

// Core types
export {
  DEFAULT_AUTHORIZATION_SERVER,
  DEFAULT_ATXP_ACCOUNTS_SERVER,
  LogLevel,
  type Logger,
  type UrlString,
  type AuthorizationServerUrl,
  CurrencyEnum,
  type Currency,
  NetworkEnum,
  type Network,
  ChainEnum,
  type Chain,
  WalletTypeEnum,
  type WalletType,
  type AccountId,
  type PaymentRequestOption,
  type Destination,
  type PaymentRequestData,
  type CustomJWTPayload,
  type ClientCredentials,
  type PKCEValues,
  type AccessToken,
  type OAuthResourceDb,
  type OAuthDb,
  type TokenData,
  type FetchLike,
  type RequirePaymentConfig,
  type PaymentIdentifier,
  type PaymentMaker,
  type DestinationMaker,
  type Account,
  type Source,
  extractAddressFromAccountId,
  extractNetworkFromAccountId
} from './types.js';

// Utility functions
export {
  assertNever,
  isEnumValue
} from './utils.js';

// MCP JSON parsing
export { 
  parsePaymentRequests,
  parseMcpMessages 
} from './mcpJson.js';

// SSE parsing utilities
export {
  type SSEMessage,
  parseSSEMessages,
  extractJSONFromSSE,
  isSSEResponse
} from './sseParser.js';

// Platform abstraction layer
export {
  type PlatformCrypto,
  getIsReactNative,
  isNode,
  isBrowser,
  isNextJS,
  isWebEnvironment,
  createReactNativeSafeFetch,
  crypto
} from './platform/index.js';

// EIP-1271 JWT utilities
export {
  createEIP1271JWT,
  createLegacyEIP1271Auth,
  createEIP1271AuthData,
  constructEIP1271Message
} from './eip1271JwtHelper.js';

// ES256K JWT utilities for browser wallets
export {
  buildES256KJWTMessage,
  completeES256KJWT,
  type ES256KJWTPayload
} from './es256kJwtHelper.js';

// Cache abstractions
export {
  type ICache,
  JsonCache,
  BrowserCache,
  MemoryCache
} from './cache.js';

// ATXP Account implementations
export {
  ATXPAccount
} from './atxpAccount.js';