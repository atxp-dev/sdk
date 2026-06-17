import { RequirePaymentConfig } from "@atxp/common";
import { ATXPArgs, buildServerConfig, requirePayment as requirePaymentSDK, withATXPContext } from "@atxp/server";
import { ATXPMCPAgentProps } from "./types.js";

// TODO(phase-1): This Cloudflare path does NOT detect a payment credential,
// does NOT open an implicit PaymentSession, and does NOT call
// ProtocolSettlement.settle — it never has. With no session open, the SDK
// requirePayment() falls back to debiting the auth ledger via
// paymentServer.charge (its prior behavior), so this remains correct and
// unchanged by Phase 1. Settle-at-close is wired only into @atxp/express for
// now; bringing this path onto the session model (credential detection +
// settle at response close) is deferred to a later phase.
export async function requirePayment(paymentConfig: RequirePaymentConfig, configOpts: ATXPArgs, {resource, tokenCheck}: ATXPMCPAgentProps): Promise<void> {
  const config = buildServerConfig(configOpts);

  await withATXPContext(config, resource, tokenCheck, async () => {
    await requirePaymentSDK(paymentConfig);
  });
}