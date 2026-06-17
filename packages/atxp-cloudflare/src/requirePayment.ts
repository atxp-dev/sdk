import { RequirePaymentConfig } from "@atxp/common";
import { ATXPArgs, buildServerConfig, requirePayment as requirePaymentSDK, withATXPContext } from "@atxp/server";
import { ATXPMCPAgentProps } from "./types.js";

// TODO(#179): This Cloudflare path does NOT detect a payment credential, open
// an implicit PaymentSession, or call ProtocolSettlement.settle — it never has.
// With no session open, the SDK requirePayment() falls back to debiting the auth
// ledger via paymentServer.charge (its prior behavior), so this stays correct.
// Bringing this path onto the session / settle-at-close model used by
// @atxp/express is tracked in atxp-dev/sdk#179.
// Design: https://github.com/circuitandchisel/accounts/blob/main/docs/STREAMING_PAYMENT_SESSIONS.md
export async function requirePayment(paymentConfig: RequirePaymentConfig, configOpts: ATXPArgs, {resource, tokenCheck}: ATXPMCPAgentProps): Promise<void> {
  const config = buildServerConfig(configOpts);

  await withATXPContext(config, resource, tokenCheck, async () => {
    await requirePaymentSDK(paymentConfig);
  });
}