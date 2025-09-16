// Main server functionality
export {
  type ATXPArgs,
  DEFAULT_CONFIG,
  buildServerConfig,
  atxpServer
} from './atxpServer.js';

// Core types and interfaces
export {
  type McpMethod,
  type McpName,
  type McpNamePattern,
  type McpOperation,
  type McpOperationPattern,
  type RefundErrors,
  type Charge,
  type ChargeResponse,
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
  withATXPContext
} from './atxpContext.js';

// Core platform-agnostic business logic (no I/O dependencies)
export {
  checkTokenCore,
  createOAuthChallengeResponseCore,
  parseMcpRequestsCore
} from './core/index.js';

// Node.js HTTP implementations (for Express, Fastify, etc.)
export {
  checkToken,
  sendOAuthChallenge,
  parseMcpRequests,
  parseBody
} from './node/index.js';

// Web API implementations (for Cloudflare Workers, Deno, browsers, etc.)
export {
  checkTokenWebApi,
  sendOAuthChallengeWebApi,
  parseMcpRequestsWebApi
} from './webapi/index.js';

// Payment functionality
export { requirePayment } from './requirePayment.js';