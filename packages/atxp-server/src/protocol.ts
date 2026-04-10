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
  /**
   * Payment amount. Format depends on the chain (check `method`):
   * - `"solana"`: micro-units as an integer string (e.g., `"10000"` = 0.01 USDC)
   * - `"tempo"`: human-readable decimal string (e.g., `"0.01"`)
   *
   * This asymmetry exists because each chain's MPP library expects a different
   * input format: @solana/mpp uses micro-units, mppx uses human-readable with
   * a `decimals` field and internally calls `parseUnits(amount, decimals)`.
   */
  amount: string;
  currency: string;
  network: string;
  recipient: string;
  /** ISO 8601 expiry timestamp. Required by mppx's verify() for Tempo challenges. */
  expires?: string;
  /** Server-defined opaque data echoed by clients. Used to carry signed
   *  identity when Authorization: Payment replaces Authorization: Bearer. */
  opaque?: Record<string, unknown>;
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
  amount: string;
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
  /** MPP challenges — one per supported chain (e.g., Solana + Tempo). */
  mpp?: MppChallengeData[];
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
 * - X402 via `PAYMENT-SIGNATURE` (v2) or `X-PAYMENT` (v1) header
 * - MPP via `Authorization: Payment <credential>` header
 *
 * Returns null if no payment credential is detected.
 */
export function detectProtocol(headers: {
  'x-atxp-payment'?: string;
  'payment-signature'?: string;
  'x-payment'?: string;
  'authorization'?: string;
}): CredentialDetection | null {
  // X-ATXP-PAYMENT header indicates ATXP protocol (pull mode credential)
  const atxpPayment = headers['x-atxp-payment'];
  if (atxpPayment) {
    return { protocol: 'atxp', credential: atxpPayment };
  }

  // PAYMENT-SIGNATURE (v2) or X-PAYMENT (v1) header indicates X402 protocol
  const paymentSig = headers['payment-signature'] || headers['x-payment'];
  if (paymentSig) {
    return { protocol: 'x402', credential: paymentSig };
  }

  // Authorization: Payment <credential> indicates standard MPP protocol
  const authHeader = headers['authorization'];
  if (authHeader?.startsWith('Payment ')) {
    return { protocol: 'mpp', credential: authHeader.slice('Payment '.length) };
  }

  return null;
}

/**
 * Parse a credential string that may be base64-encoded JSON or raw JSON.
 * Returns the parsed object, or null if neither decoding succeeds.
 */
export function parseCredentialBase64(credential: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(credential, 'base64').toString()) as Record<string, unknown>;
  } catch {
    try {
      return JSON.parse(credential) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
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
   * For X402: sends { payload, paymentRequirements } (credential is the PAYMENT-SIGNATURE / X-PAYMENT header).
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
      // The credential is the base64-encoded PAYMENT-SIGNATURE header containing the payload.
      // paymentRequirements come from context (MCP server: from pricing config; LLM: from authorize response).
      const payload: unknown = parseCredentialBase64(credential) ?? { raw: credential };

      // paymentRequirements from context may be a full X402PaymentRequirements object
      // ({x402Version, accepts: [...]}) from buildX402Requirements. Auth expects a single
      // requirement object. Select the accept matching the credential's chain.
      let requirements = context?.paymentRequirements;
      if (requirements && typeof requirements === 'object' && 'accepts' in (requirements as Record<string, unknown>)) {
        const x402Reqs = requirements as { accepts?: Array<{ network?: string; [k: string]: unknown }> };
        const accepts = x402Reqs.accepts ?? [];

        // Detect chain from the credential's accepted.network field (set by the accounts
        // authorize route — SVM payloads have solana: network, EVM have eip155:).
        // If the parsed payload includes an accepted object, use its network directly.
        const payloadObj = payload as Record<string, unknown> | null;
        const acceptedNetwork = (payloadObj?.accepted as Record<string, unknown> | undefined)?.network as string | undefined;

        if (acceptedNetwork) {
          const match = accepts.find(a => a.network === acceptedNetwork);
          if (!match) {
            this.logger.warn(`ProtocolSettlement: credential network ${acceptedNetwork} not in accepts [${accepts.map(a => a.network).join(', ')}], using first accept`);
          }
          requirements = match ?? accepts[0];
        } else {
          // Fallback for EVM payloads which don't embed accepted (x402HTTPClient format)
          requirements = accepts.find(a => a.network?.startsWith('eip155')) ?? accepts[0];
        }
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
      const parsedCredential = parseCredentialBase64(credential);
      if (!parsedCredential) {
        throw new Error('MPP credential is not valid base64 JSON or raw JSON');
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
