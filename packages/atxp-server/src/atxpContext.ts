import { TokenData, AccountId, type PaymentProtocol } from "@atxp/common";
import { ATXPConfig, TokenCheck } from "./types.js";
import { AsyncLocalStorage } from "async_hooks";
import { SettlementContext } from "./protocol.js";
import {
  PaymentSession,
  PaymentSessionState,
  buildPaymentSession,
  settlePaymentSession,
} from "./paymentSession.js";

const contextStorage = new AsyncLocalStorage<ATXPContext | null>();

/**
 * Payment credential detected by the middleware from request headers.
 * Stored in context so requirePayment can settle it with full pricing context.
 */
export type DetectedCredential = {
  protocol: PaymentProtocol;
  credential: string;
  /** User identity resolved from OAuth token or credential source */
  sourceAccountId?: string;
  /** Payment request id carried from the 402 challenge retry, when available. */
  paymentRequestId?: string;
};

/**
 * Payment challenge stored in context by omniChallengeMcpError.
 * The atxpExpress middleware reads this to rewrite wrapped tool errors
 * back into proper JSON-RPC errors with full challenge data.
 */
export type PendingPaymentChallenge = {
  code: number;
  message: string;
  data: Record<string, unknown>;
};

type ATXPContext = {
  token: string | null;
  tokenData: TokenData | null;
  config: ATXPConfig;
  resource: URL;
  /** Payment credential from retry request (X-PAYMENT, X-ATXP-PAYMENT, etc.) */
  detectedCredential?: DetectedCredential;
  /** Stable lifecycle id for the current paid retry, shared by settle and charge. */
  paymentRequestId?: string;
  /** Payment challenge pending response rewrite (set by omniChallengeMcpError) */
  pendingPaymentChallenge?: PendingPaymentChallenge;
  /** Implicit request-scoped payment session, opened by the middleware when a
   *  credential is detected. requirePayment() charges it; it settles at close. */
  paymentSession?: PaymentSessionState;
}

export function getATXPConfig(): ATXPConfig | null {
  const context = contextStorage.getStore();
  return context?.config ?? null;
}

export function getATXPResource(): URL | null {
  const context = contextStorage.getStore();
  return context?.resource ?? null;
}

// Helper function to get the current request's user
export function atxpAccountId(): AccountId | null {
  const context = contextStorage.getStore();
  return context?.tokenData?.sub as AccountId | null ?? null;
}

// Helper function to get the current request's token (for on-demand charging)
export function atxpToken(): string | null {
  const context = contextStorage.getStore();
  return context?.token ?? null;
}

/**
 * Get the payment credential detected by middleware on this request.
 * Returns null if this is not a retry with a payment credential.
 */
export function getDetectedCredential(): DetectedCredential | null {
  const context = contextStorage.getStore();
  return context?.detectedCredential ?? null;
}

/**
 * Store a payment credential in the ATXP context (called by middleware).
 */
export function setDetectedCredential(credential: DetectedCredential): void {
  const context = contextStorage.getStore();
  if (context) {
    context.detectedCredential = credential;
    if (credential.paymentRequestId) {
      context.paymentRequestId = credential.paymentRequestId;
    }
  }
}

/**
 * Open an implicit payment session for the detected credential (called by
 * middleware). Derives the authorized cap from the credential and stores the
 * session + settlement context in the ALS context.
 */
export function openPaymentSession(credential: DetectedCredential, context: SettlementContext): void {
  const ctx = contextStorage.getStore();
  if (ctx) {
    ctx.paymentSession = buildPaymentSession(credential, context, ctx.config.logger);
  }
}

/**
 * Get the current request's payment session, if one was opened.
 */
export function paymentSession(): PaymentSession | null {
  const context = contextStorage.getStore();
  return context?.paymentSession ?? null;
}

/**
 * Settle the current request's payment session if it was charged. Idempotent.
 * Called at response close (by the express response interceptor).
 */
export async function closePaymentSession(): Promise<void> {
  const context = contextStorage.getStore();
  const session = context?.paymentSession;
  if (!context || !session) return;
  const config = context.config;
  const destinationAccountId = await config.destination.getAccountId();
  await settlePaymentSession(
    session,
    config.server,
    destinationAccountId,
    config.appName,
    config.logger,
  );
}

export function getPaymentRequestId(): string | null {
  const context = contextStorage.getStore();
  return context?.paymentRequestId ?? null;
}

export function setPaymentRequestId(paymentRequestId: string): void {
  const context = contextStorage.getStore();
  if (context) {
    context.paymentRequestId = paymentRequestId;
  }
}

/**
 * Get the pending payment challenge (set by omniChallengeMcpError).
 * Used by atxpExpress to rewrite wrapped tool errors into JSON-RPC errors.
 */
export function getPendingPaymentChallenge(): PendingPaymentChallenge | null {
  const context = contextStorage.getStore();
  return context?.pendingPaymentChallenge ?? null;
}

/**
 * Store a payment challenge in context before throwing McpError.
 * The middleware will read this to reconstruct the JSON-RPC error
 * that McpServer's wrapping discards.
 */
export function setPendingPaymentChallenge(challenge: PendingPaymentChallenge): void {
  const context = contextStorage.getStore();
  if (context) {
    context.pendingPaymentChallenge = challenge;
  }
}

// Helper function to run code within a user context
export async function withATXPContext(config: ATXPConfig, resource: URL, tokenInfo: Pick<TokenCheck, 'token' | 'data'> | null, next: () => void): Promise<void> {
  config.logger.debug(`Setting user context to ${tokenInfo?.data?.sub ?? 'null'}`);
  
  if(tokenInfo && tokenInfo.data?.sub) {
    if(tokenInfo.token) {
      const dbData = {
        accessToken: tokenInfo.token!,
        resourceUrl: '',
        // Bound the cached token to the introspected token's lifetime (epoch seconds).
        // Without this the OAuthDb backends store it with no expiry and accumulate
        // forever (and could hand back an already-expired token).
        expiresAt: tokenInfo.data.exp
      };
      // Save the token to the oAuthDB so that other users of the DB can access it
      // if needed (ie, for token-exchange for downstream services)
      await config.oAuthDb.saveAccessToken(tokenInfo.data.sub, '', dbData);
    } else {
      config.logger.warn(`Setting user context with token data, but there was no token provided. This probably indicates a bug, since the data should be derived from the token`);
      config.logger.debug(`Token data: ${JSON.stringify(tokenInfo.data)}`);
    }
  }

  const ctx = {
    token: tokenInfo?.token || null,
    tokenData: tokenInfo?.data || null,
    config,
    resource
  };
  return contextStorage.run(ctx, next);
} 
