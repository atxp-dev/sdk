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
  getPendingPaymentChallenge,
  type PaymentProtocol,
  type ATXPConfig,
  type TokenCheck,
  type PendingPaymentChallenge,
  verifyOpaqueIdentity,
  parseCredentialBase64,
  ProtocolSettlement,
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

      // Set up ATXP context, settle any payment credential, then run route.
      // Settlement happens HERE (in middleware) rather than in requirePayment()
      // so the ledger is credited before any route code runs. This avoids
      // footguns where tool handlers call requirePayment() multiple times
      // (e.g., pre-flight balance check + post-generation charge) and the
      // first call consumes the credential, leaving nothing for the second.
      return withATXPContext(config, resource, tokenCheck, async () => {
        if (detected) {
          // Resolve identity for the settlement ledger credit.
          const sourceAccountId = (detected.protocol === 'mpp' && user)
            ? user
            : resolveIdentitySync(config, req, detected.protocol, detected.credential) || user || undefined;

          // Settle the credential immediately — credits the auth server's
          // ledger so subsequent charge() calls in requirePayment() succeed.
          const destinationAccountId = await config.destination.getAccountId();
          const settlement = new ProtocolSettlement(
            config.server,
            logger,
            fetch.bind(globalThis),
            destinationAccountId,
          );

          // For X402: the credential's parsed payload contains `accepted` — the
          // exact payment requirement the client signed off on. Pass it directly
          // as paymentRequirements instead of regenerating from server config.
          // For MPP/ATXP: credentials are self-contained, no extra context needed.
          const context: Record<string, unknown> = {
            ...(sourceAccountId && { sourceAccountId }),
            destinationAccountId,
          };

          if (detected.protocol === 'x402') {
            const parsed = parseCredentialBase64(detected.credential);
            if (parsed?.accepted) {
              context.paymentRequirements = parsed.accepted;
            }
          }

          try {
            const result = await settlement.settle(
              detected.protocol,
              detected.credential,
              context as Parameters<typeof settlement.settle>[2],
            );
            logger.info(`Settled ${detected.protocol} in middleware: txHash=${result.txHash}, amount=${result.settledAmount}`);
          } catch (error) {
            logger.error(`Middleware settlement failed for ${detected.protocol}: ${error instanceof Error ? error.message : String(error)}`);
            // Don't store the credential — it's already consumed/invalid.
            // requirePayment() will see no credential, charge will fail,
            // and a fresh payment challenge will be issued.
          }
        }

        // Intercept the response to rewrite McpServer's wrapped payment errors
        // back into proper JSON-RPC errors with full challenge data.
        installPaymentResponseRewriter(res, logger);

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
/** @internal Exported for testing only. */
export function installPaymentResponseRewriter(res: Response, logger: import("@atxp/common").Logger): void {
  const origEnd = res.end;
  const origWrite = res.write;
  const origWriteHead = res.writeHead;

  // Rewrite helper shared by both res.write and res.end hooks.
  // tryRewritePaymentResponse handles both SSE (data: lines) and plain JSON.
  function rewriteChunk(chunk: unknown): unknown {
    const challenge = getPendingPaymentChallenge();
    if (!challenge) return chunk;

    const body = chunk
      ? (typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : null)
      : null;
    if (!body) return chunk;

    return tryRewritePaymentResponse(body, challenge, logger) ?? chunk;
  }

  // Defer writeHead until res.end so we can update Content-Length after
  // rewriting the body. @hono/node-server's responseViaCache sets
  // Content-Length from the original (pre-rewrite) body size, then calls
  // writeHead before end. Without deferring, the client receives the
  // original Content-Length but the rewritten (larger) body, causing
  // JSON truncation.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let deferredWriteHead: any[] | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res.writeHead = function writeHeadDeferred(this: Response, ...args: any[]): any {
    deferredWriteHead = args;
    return this;
  } as any;

  function flushWriteHead(self: Response): void {
    if (!deferredWriteHead) return;
    (origWriteHead as any).apply(self, deferredWriteHead);
    deferredWriteHead = null;
  }

  // Hook res.write for SSE streaming responses.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res.write = function writeWithPaymentRewrite(this: Response, ...args: any[]): any {
    flushWriteHead(this);
    args[0] = rewriteChunk(args[0]);
    return (origWrite as any).apply(this, args);
  } as any;

  // Hook res.end for non-SSE (enableJsonResponse) responses.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res.end = function endWithPaymentRewrite(this: Response, ...args: any[]): any {
    res.end = origEnd;
    res.write = origWrite;
    res.writeHead = origWriteHead;
    args[0] = rewriteChunk(args[0]);

    // Update Content-Length in deferred writeHead to match the rewritten body.
    if (deferredWriteHead) {
      const newBody = args[0];
      if (newBody != null) {
        const newLength = typeof newBody === 'string'
          ? Buffer.byteLength(newBody)
          : Buffer.isBuffer(newBody)
            ? newBody.length
            : undefined;
        if (newLength !== undefined) {
          // writeHead(statusCode, headers) or writeHead(statusCode, statusMessage, headers)
          const headersIdx = typeof deferredWriteHead[1] === 'string' ? 2 : 1;
          const headers = deferredWriteHead[headersIdx];
          if (headers && typeof headers === 'object') {
            headers['Content-Length'] = newLength;
          }
        }
      }
      (origWriteHead as any).apply(this, deferredWriteHead);
      deferredWriteHead = null;
    }

    return (origEnd as any).apply(this, args);
  } as any;
}

/**
 * Attempt to rewrite a wrapped payment tool error into a JSON-RPC error.
 * Returns the rewritten JSON string, or null if the body isn't a wrapped payment error.
 * Exported for testing.
 */
export function tryRewritePaymentResponse(
  body: string,
  challenge: PendingPaymentChallenge,
  logger: import("@atxp/common").Logger,
): string | null {
  // SSE transports send JSON-RPC messages as "data: {...}\n\n" lines.
  // Rewrite each SSE data line that contains a payment error.
  if (body.includes('data: {')) {
    let didRewrite = false;
    const rewritten = body.replace(/^(data: )(.+)$/gm, (_match, prefix: string, json: string) => {
      const result = tryRewritePaymentResponse(json, challenge, logger);
      if (result) { didRewrite = true; return prefix + result; }
      return _match;
    });
    if (didRewrite) return rewritten;
  }

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
    // Not valid JSON — skip
  }
  return null;
}

/**
 * Check if a single JSON-RPC response is a wrapped payment tool error.
 * If so, return a JSON-RPC error object with the full challenge data.
 * Exported for testing.
 */
export function rewriteSingleResponse(
  msg: unknown,
  challenge: PendingPaymentChallenge,
): Record<string, unknown> | null {
  if (!msg || typeof msg !== 'object') return null;
  const obj = msg as Record<string, unknown>;

  // Must be a JSON-RPC response (has "result", not "error")
  if (obj.jsonrpc !== '2.0' || !obj.result || obj.error) return null;

  const result = obj.result as Record<string, unknown>;
  if (!result.isError) return null;

  // Verify this is OUR payment error by checking the text contains the
  // payment request URL from the stored challenge. This is more robust than
  // matching the full message text — immune to McpError message formatting
  // changes (prefixes, truncation, escaping).
  const content = result.content;
  if (!Array.isArray(content)) return null;

  const paymentUrl = (challenge.data as Record<string, unknown>).paymentRequestUrl;
  if (!paymentUrl || typeof paymentUrl !== 'string') return null;

  const matchesChallenge = content.some(
    (c: unknown) => c && typeof c === 'object' &&
      (c as Record<string, unknown>).type === 'text' &&
      typeof (c as Record<string, unknown>).text === 'string' &&
      ((c as Record<string, unknown>).text as string).includes(paymentUrl)
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
