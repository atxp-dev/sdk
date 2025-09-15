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
  atxpAccountId
} from './atxpContext.js';

// Payment functionality
export { requirePayment } from './requirePayment.js';