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
  LogLevel,
  type Logger,
  type UrlString,
  type AuthorizationServerUrl,
  type Currency,
  type Network,
  type PaymentRequestDestination,
  type PaymentRequestData,
  type CustomJWTPayload,
  type ClientCredentials,
  type PKCEValues,
  type AccessToken,
  type OAuthResourceDb,
  type OAuthDb,
  type TokenData,
  type FetchLike,
  type RequirePaymentConfig
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