// New names (recommended)
export { PolygonBrowserAccount } from './polygonBrowserAccount.js';
export { PolygonServerAccount } from './polygonServerAccount.js';
export { SmartWalletPaymentMaker } from './smartWalletPaymentMaker.js';
export { ServerPaymentMaker } from './serverPaymentMaker.js';
export { DirectWalletPaymentMaker, type MainWalletProvider } from './directWalletPaymentMaker.js';

// Legacy aliases for backward compatibility (deprecated)
export { PolygonBrowserAccount as PolygonAccount } from './polygonBrowserAccount.js';
export { PolygonServerAccount as SimplePolygonAccount } from './polygonServerAccount.js';
export { SmartWalletPaymentMaker as PolygonPaymentMaker } from './smartWalletPaymentMaker.js';
export { ServerPaymentMaker as SimplePolygonPaymentMaker } from './serverPaymentMaker.js';
export { DirectWalletPaymentMaker as MainWalletPaymentMaker } from './directWalletPaymentMaker.js';
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
