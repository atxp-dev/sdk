// Polygon account implementations
export { PolygonBrowserAccount } from './polygonBrowserAccount.js';
export { PolygonServerAccount } from './polygonServerAccount.js';

// Payment makers
export { ServerPaymentMaker } from './serverPaymentMaker.js';
export { DirectWalletPaymentMaker, type MainWalletProvider } from './directWalletPaymentMaker.js';

// Legacy aliases for backward compatibility (deprecated)
export { PolygonBrowserAccount as PolygonAccount } from './polygonBrowserAccount.js';
export { PolygonServerAccount as SimplePolygonAccount } from './polygonServerAccount.js';
export { ServerPaymentMaker as SimplePolygonPaymentMaker } from './serverPaymentMaker.js';
export { DirectWalletPaymentMaker as MainWalletPaymentMaker } from './directWalletPaymentMaker.js';

// Types
export type { Eip1193Provider } from './types.js';

// Re-export ATXP Account implementations from @atxp/common
export {
  ATXPAccount
} from '@atxp/common';
