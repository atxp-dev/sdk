// Express middleware for ATXP
export {
  type ATXPArgs,
  DEFAULT_CONFIG,
  buildServerConfig,
  atxpExpressMiddleware
} from './atxpExpressMiddleware.js';

// Re-export commonly used types from @atxp/server for convenience
export type {
  ATXPConfig,
  McpMethod,
  McpName,
  McpNamePattern,
  McpOperation,
  McpOperationPattern,
  TokenProblem,
  TokenCheckPass,
  TokenCheckFail,
  TokenCheck,
  ProtectedResourceMetadata
} from '@atxp/server';

export {
  requirePayment
} from '@atxp/server';