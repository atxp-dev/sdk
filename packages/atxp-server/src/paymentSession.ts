import { BigNumber } from "bignumber.js";
import { Logger, type PaymentProtocol } from "@atxp/common";
import { ProtocolSettlement, SettlementContext, parseCredentialBase64 } from "./protocol.js";
import type { DetectedCredential } from "./atxpContext.js";

/**
 * Request-scoped payment session.
 *
 * Opened implicitly by the middleware when a payment credential is detected,
 * charged locally by requirePayment(), and settled once at response close.
 * Replaces the prior flow where the middleware settled eagerly on the inbound
 * request and requirePayment() debited the auth ledger via paymentServer.charge.
 */
export interface PaymentSession {
  /** Authorized amount derived from the credential. */
  readonly cap: BigNumber;
  /** Accumulated charges recorded against this session. */
  readonly spent: BigNumber;
  /** Record a charge locally. Returns false if it would exceed the cap or there is no credential. */
  charge(cost: BigNumber): boolean;
}

/** Atomic-unit divisor for USDC (6 decimals). */
const USDC_ATOMIC = 1e6;

/**
 * Derive the authorized cap from a detected credential.
 *
 * Best-effort for Phase 1 (fixed amounts): if the amount cannot be parsed
 * reliably for a protocol, returns Infinity and logs a warning so the
 * single-charge path always works. Settlement still settles the credential in
 * full; cap enforcement is a guard, not the source of the settled amount.
 */
function deriveCap(
  protocol: PaymentProtocol,
  credential: string,
  context: SettlementContext,
  logger: Logger,
): BigNumber {
  try {
    if (protocol === 'x402') {
      // context.paymentRequirements is the parsed `accepted` object the client
      // signed. Its `amount` is atomic USDC units (6 decimals).
      const reqs = context.paymentRequirements as { amount?: string | number } | undefined;
      if (reqs?.amount != null) {
        return new BigNumber(reqs.amount).dividedBy(USDC_ATOMIC);
      }
    } else if (protocol === 'mpp') {
      const parsed = parseCredentialBase64(credential);
      const challenge = parsed?.challenge as Record<string, unknown> | undefined;
      // mppx reads amount from challenge.request.amount; fall back to challenge.amount.
      const request = challenge?.request as Record<string, unknown> | undefined;
      const amount = (request?.amount ?? challenge?.amount) as string | number | undefined;
      if (amount != null) {
        return new BigNumber(amount).dividedBy(USDC_ATOMIC);
      }
    } else if (protocol === 'atxp') {
      const parsed = parseCredentialBase64(credential);
      // ATXP credentials carry authorized amounts as human-readable USDC.
      const options = parsed?.options as Array<{ amount?: string | number }> | undefined;
      const optionAmount = options?.find(o => o.amount != null)?.amount;
      const amount = optionAmount ?? (parsed?.amount as string | number | undefined);
      if (amount != null) {
        return new BigNumber(amount);
      }
    }
  } catch (error) {
    logger.warn(`PaymentSession: failed to derive cap for ${protocol}: ${error instanceof Error ? error.message : String(error)}`);
  }

  logger.warn(`PaymentSession: could not derive cap for ${protocol} credential, defaulting to no limit`);
  return new BigNumber(Infinity);
}

/**
 * Internal session state. Holds the detected credential and settlement context
 * so closePaymentSession() can settle exactly the credential the client signed.
 */
export class PaymentSessionState implements PaymentSession {
  cap: BigNumber;
  spent: BigNumber = new BigNumber(0);
  settled = false;

  constructor(
    readonly protocol: PaymentProtocol,
    readonly credential: string,
    readonly context: SettlementContext,
    logger: Logger,
  ) {
    this.cap = deriveCap(protocol, credential, context, logger);
  }

  charge(cost: BigNumber): boolean {
    const next = this.spent.plus(cost);
    if (next.isGreaterThan(this.cap)) {
      return false;
    }
    this.spent = next;
    return true;
  }
}

/**
 * Open a payment session for a detected credential.
 * Returns the session state; the caller stores it in the ALS context.
 */
export function buildPaymentSession(
  detected: DetectedCredential,
  context: SettlementContext,
  logger: Logger,
): PaymentSessionState {
  return new PaymentSessionState(detected.protocol, detected.credential, context, logger);
}

/**
 * Settle the session if it was charged and not already settled. Idempotent:
 * subsequent calls (e.g. if res.end fires more than once) are no-ops. Builds
 * the ProtocolSettlement from config exactly as the middleware did previously.
 */
export async function settlePaymentSession(
  session: PaymentSessionState,
  authServer: import("@atxp/common").AuthorizationServerUrl,
  destinationAccountId: string | undefined,
  appName: string | undefined,
  logger: Logger,
): Promise<void> {
  if (session.settled) return;
  if (session.spent.isLessThanOrEqualTo(0)) return;
  session.settled = true;

  const settlement = new ProtocolSettlement(
    authServer,
    logger,
    fetch.bind(globalThis),
    destinationAccountId,
    { appName },
  );

  try {
    const result = await settlement.settle(
      session.protocol,
      session.credential,
      session.context,
    );
    logger.info(`Settled ${session.protocol} at session close: txHash=${result.txHash ?? '<already-settled>'}, amount=${result.settledAmount}`);
  } catch (error) {
    logger.error(`Session close settlement failed for ${session.protocol}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
