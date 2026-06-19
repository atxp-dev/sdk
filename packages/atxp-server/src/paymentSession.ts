import { BigNumber } from "bignumber.js";
import { Logger, type PaymentProtocol } from "@atxp/common";
import { ProtocolSettlement, SettlementContext, parseCredentialBase64, isMppSessionCredential } from "./protocol.js";
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
  /**
   * Authorized amount derived from the credential — the ceiling for charges.
   *
   * "up-to" semantics: settlement settles the accumulated `spent` (≤ cap), not
   * the cap itself (see settlePaymentSession). The cap bounds local charges,
   * rejecting any that would exceed it. Each `requirePayment(price)` charges
   * `price`, so `spent` is the sum of prices (≤ cap) — note `spent < cap` even
   * for a single charge when the cap was inflated by the server's
   * `minimumPayment` (cap = max(minimumPayment, price)). For ATXP credentials
   * carrying no amount, the cap is Infinity so the single-charge path always
   * works. (streaming-payment-sessions design doc:
   * https://github.com/circuitandchisel/accounts/blob/main/docs/STREAMING_PAYMENT_SESSIONS.md)
   */
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
 * Best-effort: if the amount cannot be parsed reliably for a protocol, returns
 * Infinity and logs a warning so the single-charge path always works.
 * Settlement settles the accumulated `spent` (≤ cap); the cap is the ceiling
 * that bounds local charges, not directly the settled amount.
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
        // MPP amount encoding is chain-dependent (see protocol.ts MppChallengeData):
        //   - Solana: micro-units integer string (e.g. "1000" = 0.001 USDC) → /1e6
        //   - Tempo:  human-readable decimal string (e.g. "0.001")          → as-is
        // Branch on challenge.method (the chain). When method is unavailable,
        // prefer the decimal interpretation: dividing a decimal by 1e6 under-scales
        // the cap to ~1e-8, which would falsely re-challenge an already-paid request.
        const method = challenge?.method as string | undefined;
        if (method === 'solana') {
          return new BigNumber(amount).dividedBy(USDC_ATOMIC);
        }
        if (method !== 'tempo') {
          logger.debug(`PaymentSession: MPP credential has no recognized method ('${method ?? 'undefined'}'); treating amount as decimal to avoid under-scaling the cap`);
        }
        return new BigNumber(amount);
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
  /** Guards against re-entrant settle (e.g. res.end firing more than once). */
  settling = false;
  /**
   * True when settling tears down an on-chain resource that exists regardless of
   * spend — a TIP-1034 MPP session opens a channel (deposit locked) at authorize.
   * Such a session MUST settle even at `spent == 0` to refund the locked deposit,
   * and a failed settle must stay retryable. One-shot protocols have nothing to
   * tear down, so a zero-spend or failed settle is a no-op / fire-and-forget.
   */
  readonly requiresClose: boolean;

  constructor(
    readonly protocol: PaymentProtocol,
    readonly credential: string,
    readonly context: SettlementContext,
    logger: Logger,
  ) {
    this.cap = deriveCap(protocol, credential, context, logger);
    this.requiresClose = protocol === 'mpp' && isMppSessionCredential(credential);
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
 * Settle the session at response close. Idempotent and re-entrancy-safe:
 * concurrent or repeat calls (e.g. res.end firing more than once) settle at most
 * once. Builds the ProtocolSettlement from config exactly as the middleware did
 * previously.
 *
 * Two protocol-shape-dependent rules (see PaymentSessionState.requiresClose):
 * - A session that locked funds on-chain (MPP channel) settles even at
 *   `spent == 0` — that close refunds the locked deposit. One-shot protocols
 *   have nothing to settle at zero spend, so they short-circuit.
 * - On settle failure, a channel session stays unsettled so the locked deposit
 *   can be re-driven later (on-chain settle is idempotent). One-shot protocols
 *   have nothing to re-drive — the served request is marked settled to avoid a
 *   pointless re-attempt (reconcile via the logged marker; atxp-dev/sdk#178).
 */
export async function settlePaymentSession(
  session: PaymentSessionState,
  authServer: import("@atxp/common").AuthorizationServerUrl,
  destinationAccountId: string | undefined,
  appName: string | undefined,
  logger: Logger,
): Promise<void> {
  if (session.settled || session.settling) return;
  if (session.spent.isLessThanOrEqualTo(0) && !session.requiresClose) return;
  session.settling = true;

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
      // "up-to" semantics: settle the accumulated actual (the sum of charged
      // prices, ≤ cap), not the cap. For a single requirePayment(price), spent
      // is that price — which equals the cap only when the cap wasn't inflated
      // by the server's minimumPayment. For a channel session at zero spend this
      // is 0: auth closes the channel capturing nothing and refunds the deposit.
      session.spent,
    );
    session.settled = true;
    logger.info(`Settled ${session.protocol} at session close: txHash=${result.txHash ?? '<already-settled>'}, amount=${result.settledAmount}`);
  } catch (error) {
    // Log a greppable, metric-able marker carrying protocol + amount so an
    // unbilled served request can be reconciled later.
    logger.error(`settle_failed_at_close protocol=${session.protocol} amount=${session.spent.toFixed()}: ${error instanceof Error ? error.message : String(error)}`);
    // One-shot protocols: nothing to re-drive, mark settled. Channel sessions:
    // leave unsettled so the locked deposit can be closed on a later re-drive.
    if (!session.requiresClose) session.settled = true;
  } finally {
    session.settling = false;
  }
}
