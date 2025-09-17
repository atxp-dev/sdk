import { RequirePaymentConfig } from "@atxp/common";
import { ATXPArgs, requirePayment as requirePaymentSDK, withATXPContext } from "@atxp/server";
import { getATXPConfig } from "./workerContext.js";
import { ATXPMcpApi } from "./mcpApi.js";

// Extended config to support authenticated user override and ATXP init params
interface ExtendedPaymentConfig extends RequirePaymentConfig {
  authenticatedUser?: string;
  userToken?: string;
  atxpInitParams?: ATXPArgs;  // Allow passing ATXP initialization params
}

export async function requirePayment(paymentConfig: ExtendedPaymentConfig): Promise<void> {
  // Get ATXP config: try request context first, then initialize from params if needed
  let config = getATXPConfig();

  // If no config and we have init params, initialize ATXP in this Durable Object
  if (!config && paymentConfig.atxpInitParams) {
    try {
      ATXPMcpApi.init(paymentConfig.atxpInitParams);
      config = ATXPMcpApi.getConfig();
    } catch (error) {
      config?.logger?.error(`ATXP initialization failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!config) {
    throw new Error('No ATXP config found - payments cannot be processed');
  }

  // Use authenticated user from props (preferred) or fallback to context
  const {authenticatedUser, userToken} = paymentConfig

  if (!authenticatedUser || !userToken) {
    throw new Error('No authenticated user and/or user token found - payment required');
  }

  // Use the SDK's requirePayment function with temporary context
  const resourceUrl = paymentConfig.atxpInitParams?.resource;
  if (!resourceUrl) {
    throw new Error('Resource URL not provided in ATXP init params');
  }
  const resource = new URL(resourceUrl);
  const tokenInfo = { token: userToken, data: { active: true, sub: authenticatedUser } };
  await withATXPContext(config, resource, tokenInfo, async () => {
    await requirePaymentSDK(paymentConfig);
  });
}