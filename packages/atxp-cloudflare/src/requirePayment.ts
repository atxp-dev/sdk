import { RequirePaymentConfig } from "@atxp/common";
import { ATXPArgs, buildServerConfig, requirePayment as requirePaymentSDK, withATXPContext } from "@atxp/server";
import { ATXPMCPAgentProps } from "./types.js";

export async function requirePayment(paymentConfig: RequirePaymentConfig, configOpts: ATXPArgs, {resource, tokenCheck}: ATXPMCPAgentProps): Promise<void> {
  const config = buildServerConfig(configOpts);

  await withATXPContext(config, resource, tokenCheck, async () => {
    await requirePaymentSDK(paymentConfig);
  });
}