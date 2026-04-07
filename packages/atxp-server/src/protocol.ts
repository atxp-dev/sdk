import { AuthorizationServerUrl, FetchLike, Logger, type PaymentProtocol } from "@atxp/common";
// Re-export from common so consumers of @atxp/server get the same type
export type { PaymentProtocol } from "@atxp/common";

/**
 * MPP challenge data included in omni-challenge.
 * Mirrors the MPPChallenge interface from @atxp/mpp to avoid cross-package
 * type resolution issues in CI (rollup dts + tsc project references).
 */
export type MppChallengeData = {
  id: string;
  method: string;
  intent: string;
  amount: string;
  currency: string;
  network: string;
  recipient: string;
};

/**
 * Result of detecting which protocol a client used from its credential.
 */
export type CredentialDetection = {
  protocol: PaymentProtocol;
  credential: string;
};

/**
 * X402 payment requirements included in omni-challenge.
 * This is the standard X402 challenge body format.
 */
export type X402PaymentRequirements = {
  x402Version: number;
  accepts: X402PaymentOption[];
};

export type X402PaymentOption = {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType?: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  asset?: string;
  extra?: Record<string, unknown>;
};

/**
 * ATXP-MCP challenge data included in omni-challenge.
 */
export type AtxpMcpChallengeData = {
  paymentRequestId: string;
  paymentRequestUrl: string;
  chargeAmount?: string;
};


/**
 * Omni-challenge data combining all three protocols.
 * Used to build responses across different transports.
 */
export type OmniChallenge = {
  atxpMcp: AtxpMcpChallengeData;
  x402: X402PaymentRequirements;
  mpp?: MppChallengeData;
};

/**
 * Context data needed by verify/settle to build protocol-specific request bodies.
 */
export type SettlementContext = {
  /** X402: the original payment requirements from the challenge */
  paymentRequirements?: unknown;
  /** Source account identifier (e.g., "base:0xABC..." from OAuth sub or wallet address).
   *  When present, auth records the payment for this identity. */
  sourceAccountId?: string;
  /** ATXP: destination account identifier */
  destinationAccountId?: string;
  /** ATXP: payment options with network, currency, address, amount */
  options?: unknown[];
};

/**
 * Result of verifying a payment credential.
 */
export type VerifyResult = {
  valid: boolean;
};

/**
 * Result of settling a payment.
 */
export type SettleResult = {
  txHash: string;
  settledAmount: string;
};

/**
 * Detect the payment protocol from inbound credentials on a retry request.
 *
 * Detects:
 * - ATXP via `X-ATXP-PAYMENT` header
 * - X402 via `X-PAYMENT` header
 * - MPP via `Authorization: Payment <credential>` header
 *
 * Returns null if no payment credential is detected.
 */
export function detectProtocol(headers: {
  'x-atxp-payment'?: string;
  'x-payment'?: string;
  'authorization'?: string;
}): CredentialDetection | null {
  // X-ATXP-PAYMENT header indicates ATXP protocol (pull mode credential)
  const atxpPayment = headers['x-atxp-payment'];
  if (atxpPayment) {
    return { protocol: 'atxp', credential: atxpPayment };
  }

  // X-PAYMENT header indicates X402 protocol
  const xPayment = headers['x-payment'];
  if (xPayment) {
    return { protocol: 'x402', credential: xPayment };
  }

  // Authorization: Payment <credential> indicates MPP protocol
  const authHeader = headers['authorization'];
  if (authHeader?.startsWith('Payment ')) {
    return { protocol: 'mpp', credential: authHeader.slice('Payment '.length) };
  }

  return null;
}

/**
 * Client for calling auth service verify/settle endpoints.
 * Routes to the appropriate protocol-specific endpoint.
 */
export class ProtocolSettlement {
  constructor(
    private readonly authServer: AuthorizationServerUrl,
    private readonly logger: Logger,
    private readonly fetchFn: FetchLike = fetch.bind(globalThis),
    /** Destination account ID for ATXP settle (the server/LLM's own account) */
    private readonly destinationAccountId?: string,
  ) {}

  /**
   * Verify a payment credential at request start.
   * Calls auth `/verify/{protocol}` to check if the credential is valid.
   *
   * For X402: sends { payload, paymentRequirements } (credential is the X-PAYMENT header).
   * For ATXP: sends { sourceAccountId, destinationAccountId, sourceAccountToken, options }.
   */
  async verify(protocol: PaymentProtocol, credential: string, context?: SettlementContext): Promise<VerifyResult> {
    const url = new URL(`/verify/${protocol}`, this.authServer);
    this.logger.debug(`Verifying ${protocol} credential at ${url}`);

    const body = this.buildRequestBody(protocol, credential, context);

    const response = await this.fetchFn(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      this.logger.warn(`Verify ${protocol} failed with status ${response.status}`);
      return { valid: false };
    }

    const result = await response.json() as VerifyResult;
    this.logger.debug(`Verify ${protocol} result: valid=${result.valid}`);
    return result;
  }

  /**
   * Settle a payment at request end.
   * Calls auth `/settle/{protocol}` to finalize the payment.
   */
  async settle(protocol: PaymentProtocol, credential: string, context?: SettlementContext): Promise<SettleResult> {
    const url = new URL(`/settle/${protocol}`, this.authServer);
    this.logger.debug(`Settling ${protocol} credential at ${url}`);

    const body = this.buildRequestBody(protocol, credential, context);

    const response = await this.fetchFn(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`Settle ${protocol} failed with status ${response.status}: ${errorText}`);
      throw new Error(`Settlement failed for ${protocol}: ${response.status}`);
    }

    const result = await response.json() as SettleResult;
    this.logger.info(`Settled ${protocol}: txHash=${result.txHash}, amount=${result.settledAmount}`);
    return result;
  }

  /**
   * Build the protocol-specific request body for verify/settle calls.
   */
  private buildRequestBody(protocol: PaymentProtocol, credential: string, context?: SettlementContext): unknown {
    if (protocol === 'x402') {
      // X402: auth expects { payload, paymentRequirements }
      // The credential is the base64-encoded X-PAYMENT header containing the payload
      let payload: unknown;
      try {
        payload = JSON.parse(Buffer.from(credential, 'base64').toString());
      } catch {
        // If not valid base64 JSON, pass as-is (auth will validate)
        payload = { raw: credential };
      }

      // paymentRequirements from context may be a full X402PaymentRequirements object
      // ({x402Version, accepts: [...]}) from buildX402Requirements. Auth expects a single
      // requirement object. Extract the first accept if it's the full format.
      let requirements = context?.paymentRequirements;
      if (requirements && typeof requirements === 'object' && 'accepts' in (requirements as Record<string, unknown>)) {
        const x402Reqs = requirements as { accepts?: unknown[] };
        requirements = x402Reqs.accepts?.[0] ?? requirements;
      }

      return {
        payload,
        paymentRequirements: requirements,
        ...(context?.sourceAccountId && { sourceAccountId: context.sourceAccountId }),
        ...(this.destinationAccountId && { destinationAccountId: this.destinationAccountId }),
      };
    }

    if (protocol === 'mpp') {
      // MPP: auth expects { credential: <standard MPP credential>, sourceAccountId? }.
      // The credential is base64url-encoded JSON containing { challenge, payload, source }.
      // Auth uses mppx internally to verify + settle (broadcast pre-signed tx or check txHash).
      let parsedCredential: unknown;
      try {
        parsedCredential = JSON.parse(Buffer.from(credential, 'base64').toString());
      } catch {
        parsedCredential = JSON.parse(credential);
        // If this throws, the credential is genuinely malformed — let it propagate.
      }
      return {
        credential: parsedCredential,
        ...(context?.sourceAccountId && { sourceAccountId: context.sourceAccountId }),
        ...(this.destinationAccountId && { destinationAccountId: this.destinationAccountId }),
      };
    }

    // ATXP: auth expects { sourceAccountId, destinationAccountId, sourceAccountToken, options }
    // The credential is a self-contained JSON string from ATXPAccount.authorize()
    // containing sourceAccountId, sourceAccountToken, and options.
    // destinationAccountId comes from this instance's config (it's the server's own account).
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(credential);
    } catch {
      this.logger.warn('ProtocolSettlement: ATXP credential is not valid JSON, using context fallback');
    }

    return {
      sourceAccountId: parsed.sourceAccountId ?? context?.sourceAccountId,
      destinationAccountId: this.destinationAccountId ?? context?.destinationAccountId,
      sourceAccountToken: parsed.sourceAccountToken ?? credential,
      options: parsed.options ?? context?.options ?? [],
    };
  }
}
