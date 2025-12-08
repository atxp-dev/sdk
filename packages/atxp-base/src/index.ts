// Base Mini App implementations
export { BaseAppAccount } from './baseAppAccount.js';
export { BaseAppPaymentMaker } from './baseAppPaymentMaker.js';
export { MainWalletPaymentMaker, type MainWalletProvider } from './mainWalletPaymentMaker.js';
export type { SpendPermission } from './types.js';
export {
  type ICache,
  type Intermediary as CachedPermissionData,
  IntermediaryCache as PermissionCache,
  BrowserCache,
  MemoryCache
} from './cache.js';

// Generic Base implementations (moved from @atxp/client)
export { BaseAccount } from './baseAccount.js';
export { BasePaymentMaker } from './basePaymentMaker.js';
export { USDC_CONTRACT_ADDRESS_BASE, USDC_CONTRACT_ADDRESS_BASE_SEPOLIA, getBaseUSDCAddress } from './baseConstants.js';

// Re-export ATXP Account implementations from @atxp/common
export {
  ATXPAccount
} from '@atxp/common';
