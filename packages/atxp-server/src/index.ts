// Core types and interfaces
export {
  McpMethodEnum,
  type McpMethod,
  type McpName,
  type McpNamePattern,
  type McpOperation,
  type McpOperationPattern,
  type RefundErrors,
  type Charge,
  type BalanceRequest,
  type PaymentServer,
  type ATXPConfig,
  TokenProblem,
  type TokenCheckPass,
  type TokenCheckFail,
  type TokenCheck,
  type ProtectedResourceMetadata
} from './types.js';

// Context management
export {
  getATXPConfig,
  getATXPResource,
  atxpAccountId,
  atxpToken,
  withATXPContext,
  getDetectedCredential,
  setDetectedCredential,
  type DetectedCredential,
} from './atxpContext.js';

// Core platform-agnostic business logic (no I/O dependencies)
export {
  checkTokenCore,
  createOAuthChallengeResponseCore,
  parseMcpRequestsCore
} from './core/index.js';

// Node.js HTTP implementations (for Express, Fastify, etc.)
export {
  checkToken as checkTokenNode,
  sendOAuthChallenge,
  parseMcpRequests as parseMcpRequestsNode,
  parseBody as parseBodyNode,
  sendProtectedResourceMetadata as sendProtectedResourceMetadataNode,
  sendOAuthMetadata as sendOAuthMetadataNode,
} from './node/index.js';

// Web API implementations (for Cloudflare Workers, Deno, browsers, etc.)
export {
  checkTokenWebApi,
  sendOAuthChallengeWebApi,
  sendProtectedResourceMetadataWebApi,
  sendOAuthMetadataWebApi,
  parseMcpRequestsWebApi
} from './webapi/index.js';

// Payment functionality
export { requirePayment } from './requirePayment.js';
export { getBalance } from './getBalance.js';

// Test utilities are available via separate export ./serverTestHelpers

// Server configuration utilities (needed for Express router)
export {
  type ATXPArgs,
  DEFAULT_CONFIG,
  buildServerConfig
} from './serverConfig.js';

// Additional utilities needed by express packages
export { getResource } from './getResource.js';
export { ATXPPaymentServer } from './paymentServer.js';
export {
  getOAuthMetadata,
} from './oAuthMetadata.js';
export {
  getProtectedResourceMetadata,
} from './protectedResourceMetadata.js';

// Protocol detection and settlement
export {
  type PaymentProtocol,
  type CredentialDetection,
  type X402PaymentRequirements,
  type X402PaymentOption,
  type AtxpMcpChallengeData,
  type MppChallengeData,
  type OmniChallenge,
  type SettlementContext,
  type VerifyResult,
  type SettleResult,
  detectProtocol,
  ProtocolSettlement,
} from './protocol.js';

// Omni-challenge builders
export {
  buildX402Requirements,
  buildAtxpMcpChallenge,
  buildMppChallenge,
  buildMppChallenges,
  serializeMppHeader,
  omniChallengeMcpError,
  omniChallengeHttpResponse,
  buildOmniChallenge,
  sourcesToOptions,
  buildPaymentOptions,
  buildAuthorizeParamsFromSources,
} from './omniChallenge.js';

// Opaque identity for MPP Authorization: Payment ↔ OAuth Bearer coexistence
export {
  signOpaqueIdentity,
  verifyOpaqueIdentity,
} from './opaqueIdentity.js';

// Re-export ATXP Account implementations from @atxp/common
export {
  ATXPAccount
} from '@atxp/common';

