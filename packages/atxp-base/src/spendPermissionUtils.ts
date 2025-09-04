/**
 * Loads the browser-only spend permission module.
 * Throws an error if called in a server environment.
 * 
 * Both BaseAppAccount and BaseAppPaymentMaker should only run in browser environments
 * since they require wallet interaction and browser APIs.
 */
export async function getSpendPermissionModule() {
  // Check if we're in a browser environment
  if (typeof window === 'undefined') {
    throw new Error(
      'Spend permission operations require browser environment. ' +
      'BaseAppAccount and BaseAppPaymentMaker should only be used client-side in Next.js apps.'
    );
  }

  // Use browser version since both classes require browser environment
  return await import('@base-org/account/spend-permission/browser');
}