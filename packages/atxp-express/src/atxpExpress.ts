import { Request, Response, NextFunction, Router } from "express";
import {
  ATXPArgs,
  buildServerConfig,
  checkTokenNode,
  sendOAuthChallenge,
  withATXPContext,
  parseMcpRequestsNode,
  getProtectedResourceMetadata as getPRMResponse,
  getResource,
  getOAuthMetadata,
  sendProtectedResourceMetadataNode,
  sendOAuthMetadataNode,
  detectProtocol,
  setDetectedCredential,
  getPendingPaymentChallenge,
  type PaymentProtocol,
  type ATXPConfig,
  type TokenCheck,
  type PendingPaymentChallenge,
  verifyOpaqueIdentity,
  parseCredentialBase64,
} from "@atxp/server";

export function atxpExpress(args: ATXPArgs): Router {
  const config = buildServerConfig(args);
  const router = Router();

  const atxpMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const logger = config.logger;
      const requestUrl = new URL(req.url, req.protocol + '://' + req.host);
      logger.debug(`Handling ${req.method} ${requestUrl.toString()}`);

      const resource = getResource(config, requestUrl, req.headers);
      const prmResponse = getPRMResponse(config, requestUrl, req.headers);
      if (sendProtectedResourceMetadataNode(res, prmResponse)) {
        return;
      }

      const oAuthMetadata = await getOAuthMetadata(config, requestUrl);
      if(sendOAuthMetadataNode(res, oAuthMetadata)) {
        return;
      }

      const mcpRequests = await parseMcpRequestsNode(config, requestUrl, req, req.body);
      logger.debug(`${mcpRequests.length} MCP requests found in request`);

      // Detect payment credentials from request headers.
      // The credential is stored in ATXP context for requirePayment() to settle
      // with full pricing context (amount, options, destination).
      const detected = detectProtocol({
        'x-atxp-payment': req.headers['x-atxp-payment'] as string | undefined,
        'payment-signature': req.headers['payment-signature'] as string | undefined,
        'x-payment': req.headers['x-payment'] as string | undefined,
        'authorization': req.headers['authorization'] as string | undefined,
      });

      if (mcpRequests.length === 0) {
        // Non-MCP request with credential: for REST APIs, the route handler
        // is responsible for checking payment (not requirePayment).
        // TODO: Support settle-in-handler for non-MCP REST APIs.
        next();
        return;
      }

      logger.debug(`Request started - ${req.method} ${req.path}`);
      let tokenCheck: TokenCheck = await checkTokenNode(config, resource, req);
      let user = tokenCheck.data?.sub ?? null;

      // When Authorization: Payment replaces Authorization: Bearer (MPP retry),
      // the OAuth token check fails. Recover identity from the credential's
      // opaque field (signed by the server at challenge time).
      if (detected && detected.protocol === 'mpp' && !tokenCheck.passes) {
        const parsed = parseCredentialBase64(detected.credential);
        if (parsed) {
          const challenge = parsed.challenge as Record<string, unknown> | undefined;
          const opaque = challenge?.opaque as Record<string, unknown> | undefined;
          const challengeId = challenge?.id as string | undefined;
          if (opaque && challengeId) {
            const recoveredSub = verifyOpaqueIdentity(opaque, challengeId);
            if (recoveredSub) {
              logger.info(`Recovered identity from MPP opaque: ${recoveredSub}`);
              user = recoveredSub;
              // Synthesize a passing tokenCheck so withATXPContext sets the user
              tokenCheck = { passes: true, data: { sub: recoveredSub }, token: null } as unknown as TokenCheck;
            }
          }
        }
      }

      res.on('finish', async () => {
        logger.debug(`Request finished ${user ? `for user ${user} ` : ''}- ${req.method} ${req.path}`);
      });

      // OAuth challenge logic:
      // - ATXP/X402: use separate headers (X-ATXP-PAYMENT, PAYMENT-SIGNATURE, X-PAYMENT),
      //   so Bearer is still present — skip OAuth challenge.
      // - MPP: replaces Authorization: Bearer with Authorization: Payment, so OAuth
      //   token check fails. Only skip OAuth if opaque identity was recovered above.
      //   If opaque verification failed/missing, the client should have included Bearer too.
      // - No credential: normal OAuth challenge.
      const shouldChallengeOAuth = !detected || (detected.protocol === 'mpp' && !user);
      if (shouldChallengeOAuth && sendOAuthChallenge(res, tokenCheck)) {
        return;
      }

      // Set up ATXP context, then store detected credential if present.
      // requirePayment() will find it via getDetectedCredential() and settle
      // before charging, using the pricing context it has (amount, options).
      return withATXPContext(config, resource, tokenCheck, () => {
        if (detected) {
          // Resolve identity for the settlement ledger credit.
          // The settle must use the same sourceAccountId as the charge
          // (atxpAccountId() = OAuth sub) so the ledger entries match.
          // For MPP: prefer the OAuth user (recovered from opaque) over the
          // wallet address from the credential's `source` field — the ledger
          // is keyed by OAuth identity, not wallet address.
          // For ATXP: use the sourceAccountId embedded in the credential.
          // For X402: falls back to OAuth sub (credential has no identity).
          const sourceAccountId = (detected.protocol === 'mpp' && user)
            ? user
            : resolveIdentitySync(config, req, detected.protocol, detected.credential) || user || undefined;
          setDetectedCredential({
            protocol: detected.protocol,
            credential: detected.credential,
            sourceAccountId,
          });
          logger.info(`Stored ${detected.protocol} credential in context for requirePayment (sourceAccountId=${sourceAccountId})`);
        }

        // Intercept the response to rewrite McpServer's wrapped payment errors
        // back into proper JSON-RPC errors with full challenge data.
        // McpServer catches McpError(-30402) and wraps it into a CallToolResult,
        // discarding error.data (which contains x402/mpp challenge data).
        // We detect the wrapped error and reconstruct the JSON-RPC error using
        // challenge data stored in AsyncLocalStorage by omniChallengeMcpError.
        try {
          installPaymentResponseRewriter(res, logger);
        } catch (e) {
          logger.warn(`Failed to install payment response rewriter: ${e}`);
        }

        return next();
      });
    } catch (error) {
      config.logger.error(`Critical error in atxp middleware - returning HTTP 500. Error: ${error instanceof Error ? error.message : String(error)}`);
      config.logger.debug(JSON.stringify(error, null, 2));
      res.status(500).json({ error: 'server_error', error_description: 'An internal server error occurred' });
    }
  };

  router.use(atxpMiddleware);
  return router;
}

/**
 * Intercept res.end to rewrite wrapped payment errors into JSON-RPC errors.
 *
 * McpServer catches McpError(-30402) thrown by requirePayment and wraps it
 * into a CallToolResult: {result: {isError: true, content: [{text: "..."}]}}.
 * This discards error.data which carries x402 accepts and mpp challenges.
 *
 * This function intercepts the response before it's sent. If a payment
 * challenge was stored in AsyncLocalStorage (by omniChallengeMcpError), and
 * the response body is a wrapped tool error containing the payment preamble,
 * we rewrite it into a proper JSON-RPC error with the full challenge data.
 *
 * Old clients: see JSON-RPC error with code -30402 → Branch 1 matches
 * New clients: see JSON-RPC error with code -30402 + full error.data → x402/mpp works
 */
function installPaymentResponseRewriter(res: Response, logger: import("@atxp/common").Logger): void {
  // Save original res.end (may be patched by supertest or other middleware)
  const origEnd = res.end;

  res.end = function endWithPaymentRewrite(this: Response, ...args: any[]): any {
    // Restore original immediately to avoid any re-entry issues
    res.end = origEnd;

    const challenge = getPendingPaymentChallenge();
    if (!challenge) {
      return origEnd.apply(this, args);
    }

    const chunk = args[0];
    if (!chunk) {
      return origEnd.apply(this, args);
    }

    const body = typeof chunk === 'string'
      ? chunk
      : Buffer.isBuffer(chunk)
        ? chunk.toString('utf-8')
        : null;

    if (!body) {
      return origEnd.apply(this, args);
    }

    const rewritten = tryRewritePaymentResponse(body, challenge, logger);
    if (!rewritten) {
      return origEnd.apply(this, args);
    }

    // Replace the body with the rewritten JSON-RPC error
    const buf = Buffer.from(rewritten, 'utf-8');
    this.setHeader('Content-Length', buf.byteLength);
    return origEnd.call(this, buf, args[1] || 'utf-8', args[2]);
  } as any;
}

/**
 * Attempt to rewrite a wrapped payment tool error into a JSON-RPC error.
 * Returns the rewritten JSON string, or null if the body isn't a wrapped payment error.
 */
function tryRewritePaymentResponse(
  body: string,
  challenge: PendingPaymentChallenge,
  logger: import("@atxp/common").Logger,
): string | null {
  try {
    const json = JSON.parse(body);

    // Handle single JSON-RPC response (enableJsonResponse: true)
    const rewritten = rewriteSingleResponse(json, challenge);
    if (rewritten) {
      logger.debug('Rewrote wrapped payment tool error → JSON-RPC error with challenge data');
      return JSON.stringify(rewritten);
    }

    // Handle batch JSON-RPC response (array)
    if (Array.isArray(json)) {
      let didRewrite = false;
      const results = json.map((item: unknown) => {
        const r = rewriteSingleResponse(item, challenge);
        if (r) { didRewrite = true; return r; }
        return item;
      });
      if (didRewrite) {
        logger.debug('Rewrote wrapped payment tool error in batch → JSON-RPC error with challenge data');
        return JSON.stringify(results);
      }
    }
  } catch {
    // Not valid JSON — SSE or non-MCP response, skip rewriting
  }
  return null;
}

/**
 * Check if a single JSON-RPC response is a wrapped payment tool error.
 * If so, return a JSON-RPC error object with the full challenge data.
 */
function rewriteSingleResponse(
  msg: unknown,
  challenge: PendingPaymentChallenge,
): Record<string, unknown> | null {
  if (!msg || typeof msg !== 'object') return null;
  const obj = msg as Record<string, unknown>;

  // Must be a JSON-RPC response (has "result", not "error")
  if (obj.jsonrpc !== '2.0' || !obj.result || obj.error) return null;

  const result = obj.result as Record<string, unknown>;
  if (!result.isError) return null;

  // Verify the tool error text matches the stored challenge message.
  // McpError formats .message as "MCP error <code>: <original>", so the
  // wrapped text will contain the challenge message as a substring.
  const content = result.content;
  if (!Array.isArray(content)) return null;

  const matchesChallenge = content.some(
    (c: unknown) => c && typeof c === 'object' &&
      (c as Record<string, unknown>).type === 'text' &&
      typeof (c as Record<string, unknown>).text === 'string' &&
      ((c as Record<string, unknown>).text as string).includes(challenge.message)
  );
  if (!matchesChallenge) return null;

  // Rewrite: replace tool result with JSON-RPC error
  return {
    jsonrpc: '2.0',
    id: obj.id,
    error: {
      code: challenge.code,
      message: challenge.message,
      data: challenge.data,
    },
  };
}

/**
 * Synchronous identity resolution from request headers/credential.
 *
 * Priority:
 * 1. ATXP credential sourceAccountId
 * 2. MPP credential source DID
 * 3. X402: not available until after settlement
 */
function resolveIdentitySync(
  config: ATXPConfig,
  req: Request,
  protocol: PaymentProtocol,
  credential: string,
): string | undefined {
  if (protocol === 'atxp') {
    const parsed = parseCredentialBase64(credential);
    if (parsed?.sourceAccountId) return parsed.sourceAccountId as string;
  }

  if (protocol === 'mpp') {
    const parsed = parseCredentialBase64(credential);
    if (parsed) {
      const source = parsed.source;
      if (typeof source === 'string' && source.startsWith('did:pkh:eip155:')) {
        const parts = source.split(':');
        const chainId = parts[3];
        const address = parts[4];
        if (chainId && address) {
          const network = chainId === '4217' ? 'tempo' : chainId === '42431' ? 'tempo_moderato' : `eip155:${chainId}`;
          return `${network}:${address}`;
        }
      }
    }
  }

  return undefined;
}
