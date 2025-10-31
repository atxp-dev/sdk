export { PolygonAccount } from './polygonAccount.js';
export { PolygonPaymentMaker } from './polygonPaymentMaker.js';
export { MainWalletPaymentMaker, type MainWalletProvider } from './mainWalletPaymentMaker.js';
export type { SpendPermission } from './types.js';
export {
  type ICache,
  type Intermediary as CachedPermissionData,
  IntermediaryCache as PermissionCache,
  BrowserCache,
  MemoryCache
} from './cache.js';

// Re-export ATXP Account implementations from @atxp/common
export {
  ATXPAccount
} from '@atxp/common';
