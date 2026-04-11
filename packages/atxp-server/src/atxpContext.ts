import { TokenData, AccountId, type PaymentProtocol } from "@atxp/common";
import { ATXPConfig, TokenCheck } from "./types.js";
import { AsyncLocalStorage } from "async_hooks";

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
  /** Payment challenge pending response rewrite (set by omniChallengeMcpError) */
  pendingPaymentChallenge?: PendingPaymentChallenge;
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
        resourceUrl: ''
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
