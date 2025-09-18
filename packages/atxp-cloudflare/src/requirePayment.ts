import { RequirePaymentConfig } from "@atxp/common";
import { requirePayment as requirePaymentSDK, withATXPContext } from "@atxp/server";
import { getATXPWorkerContext } from "./workerContext.js";

export async function requirePayment(paymentConfig: RequirePaymentConfig): Promise<void> {
  const workerContext = getATXPWorkerContext();

  // If no config and we have init params, initialize ATXP in this Durable Object
  if (!workerContext) {
    throw new Error('No ATXP config found - payments cannot be processed');
  }

  await withATXPContext(workerContext.config, workerContext.resource, workerContext.tokenCheck, async () => {
    await requirePaymentSDK(paymentConfig);
  });
}