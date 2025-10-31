// Express router for ATXP
export {
  atxpExpress
} from './atxpExpress.js';

// Re-export configuration utilities from @atxp/server for convenience
export {
  type ATXPArgs,
  DEFAULT_CONFIG,
  buildServerConfig
} from '@atxp/server';

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
  requirePayment,
  atxpAccountId
} from '@atxp/server';

// Re-export ATXP Account implementations from @atxp/common
export {
  ATXPAccount
} from '@atxp/common';
