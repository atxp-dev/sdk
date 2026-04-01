import { AuthorizationServerUrl, FetchLike, Logger, type PaymentProtocol } from "@atxp/common";
// Re-export from common so consumers of @atxp/server get the same type
export type { PaymentProtocol } from "@atxp/common";

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
 * MPP challenge data included in omni-challenge.
 * Follows the Tempo MPP spec for WWW-Authenticate: Payment header.
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
  /** ATXP: source account identifier */
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
 * Only detects X402 via the X-PAYMENT header. ATXP-MCP payments flow through
 * the MCP token check + requirePayment() path, not through HTTP header
 * detection. Bearer JWTs in non-MCP requests are OAuth access tokens, not
 * payment credentials — detecting them here would misidentify normal auth.
 *
 * Returns null if no payment credential is detected.
 */
export function detectProtocol(headers: {
  'x-payment'?: string;
  'authorization'?: string;
}): CredentialDetection | null {
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
      return { payload, paymentRequirements: context?.paymentRequirements };
    }

    if (protocol === 'mpp') {
      // MPP: auth expects { credential: MppCredential } for verify,
      // and { credential: MppCredential, amount: string } for settle.
      // The credential is base64-encoded or raw JSON MppCredential.
      // Settle Zod schema strips unknown keys, so always including amount is safe for verify.
      let parsedCredential: unknown;
      try {
        parsedCredential = JSON.parse(Buffer.from(credential, 'base64').toString());
      } catch {
        try {
          parsedCredential = JSON.parse(credential);
        } catch {
          this.logger.warn('ProtocolSettlement: MPP credential is not valid JSON');
          parsedCredential = { raw: credential };
        }
      }
      const amount = (parsedCredential as Record<string, unknown>)?.payload
        ? ((parsedCredential as Record<string, Record<string, string>>).payload.amount)
        : undefined;
      return { credential: parsedCredential, ...(amount && { amount }) };
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
