import { OAuthAuthenticationRequiredError, OAuthClient } from './oAuth.js';
import {
  PAYMENT_REQUIRED_ERROR_CODE,
  paymentRequiredError,
  AccessToken,
  AuthorizationServerUrl,
  FetchLike,
  OAuthDb,
  PaymentRequest,
  DEFAULT_AUTHORIZATION_SERVER,
  Logger,
  parsePaymentRequests,
  parseMcpMessages,
  ConsoleLogger,
  isSSEResponse,
  Network,
  DestinationMaker,
  Account,
  getErrorRecoveryHint
} from '@atxp/common';
import type { PaymentMaker, ProspectivePayment, ClientConfig, PaymentFailureContext } from './types.js';
import { InsufficientFundsError, ATXPPaymentError } from './errors.js';
import { getIsReactNative, createReactNativeSafeFetch, Destination } from '@atxp/common';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { BigNumber } from 'bignumber.js';

/**
 * Creates an ATXP fetch wrapper that handles OAuth authentication and payments.
 * This follows the wrapper pattern for fetch functions.
 *
 * @param config - The client configuration
 * @returns A wrapped fetch function that handles ATXP protocol
 */
export function atxpFetch(config: ClientConfig): FetchLike {
  const fetcher = new ATXPFetcher({
    account: config.account,
    db: config.oAuthDb,
    destinationMakers: config.destinationMakers,
    fetchFn: config.fetchFn,
    sideChannelFetch: config.oAuthChannelFetch,
    allowInsecureRequests: config.allowHttp,
    allowedAuthorizationServers: config.allowedAuthorizationServers,
    approvePayment: config.approvePayment,
    logger: config.logger,
    onAuthorize: config.onAuthorize,
    onAuthorizeFailure: config.onAuthorizeFailure,
    onPayment: config.onPayment,
    onPaymentFailure: config.onPaymentFailure,
    onPaymentAttemptFailed: config.onPaymentAttemptFailed
  });
  return fetcher.fetch;
}

export class ATXPFetcher {
  protected oauthClient: OAuthClient | null = null;
  protected account: Account;
  protected destinationMakers: Map<Network, DestinationMaker>;
  protected sideChannelFetch: FetchLike;
  protected safeFetchFn: FetchLike;
  protected db: OAuthDb;
  protected allowedAuthorizationServers: AuthorizationServerUrl[];
  protected approvePayment: (payment: ProspectivePayment) => Promise<boolean>;
  protected logger: Logger;
  protected onAuthorize: (args: { authorizationServer: AuthorizationServerUrl, userId: string }) => Promise<void>;
  protected onAuthorizeFailure: (args: { authorizationServer: AuthorizationServerUrl, userId: string, error: Error }) => Promise<void>;
  protected onPayment: (args: { payment: ProspectivePayment, transactionHash: string, network: string }) => Promise<void>;
  protected onPaymentFailure: (context: PaymentFailureContext) => Promise<void>;
  protected onPaymentAttemptFailed?: (args: { network: string, error: Error, remainingNetworks: string[] }) => Promise<void>;
  protected strict: boolean;
  protected allowInsecureRequests: boolean;
  constructor(config: {
    account: Account;
    db: OAuthDb;
    destinationMakers: Map<Network, DestinationMaker>;
    fetchFn?: FetchLike;
    sideChannelFetch?: FetchLike;
    strict?: boolean;
    allowInsecureRequests?: boolean;
    allowedAuthorizationServers?: AuthorizationServerUrl[];
    approvePayment?: (payment: ProspectivePayment) => Promise<boolean>;
    logger?: Logger;
    onAuthorize?: (args: { authorizationServer: AuthorizationServerUrl, userId: string }) => Promise<void>;
    onAuthorizeFailure?: (args: { authorizationServer: AuthorizationServerUrl, userId: string, error: Error }) => Promise<void>;
    onPayment?: (args: { payment: ProspectivePayment, transactionHash: string, network: string }) => Promise<void>;
    onPaymentFailure?: (context: PaymentFailureContext) => Promise<void>;
    onPaymentAttemptFailed?: (args: { network: string, error: Error, remainingNetworks: string[] }) => Promise<void>;
  }) {
    const {
      account,
      db,
      destinationMakers,
      fetchFn = fetch,
      sideChannelFetch = fetchFn,
      strict = true,
      allowInsecureRequests = process.env.NODE_ENV === 'development',
      allowedAuthorizationServers = [DEFAULT_AUTHORIZATION_SERVER],
      approvePayment = async (): Promise<boolean> => true,
      logger = new ConsoleLogger(),
      onAuthorize = async () => {},
      onAuthorizeFailure = async () => {},
      onPayment = async () => {},
      onPaymentFailure,
      onPaymentAttemptFailed
    } = config;
    // Use React Native safe fetch if in React Native environment
    this.safeFetchFn = getIsReactNative() ? createReactNativeSafeFetch(fetchFn) : fetchFn;
    const safeSideChannelFetch = getIsReactNative() ? createReactNativeSafeFetch(sideChannelFetch) : sideChannelFetch;

    // OAuthClient is initialized lazily in getOAuthClient() since it needs async accountId
    this.account = account;
    this.destinationMakers = destinationMakers;
    this.sideChannelFetch = safeSideChannelFetch;
    this.db = db;
    this.strict = strict;
    this.allowInsecureRequests = allowInsecureRequests;
    this.allowedAuthorizationServers = allowedAuthorizationServers;
    this.approvePayment = approvePayment;
    this.logger = logger;
    this.onAuthorize = onAuthorize;
    this.onAuthorizeFailure = onAuthorizeFailure;
    this.onPayment = onPayment;
    this.onPaymentFailure = onPaymentFailure || this.defaultPaymentFailureHandler;
    this.onPaymentAttemptFailed = onPaymentAttemptFailed;
  }

  /**
   * Get or create the OAuthClient (lazy initialization to support async accountId)
   */
  protected async getOAuthClient(): Promise<OAuthClient> {
    if (this.oauthClient) {
      return this.oauthClient;
    }

    const accountId = await this.account.getAccountId();
    this.oauthClient = new OAuthClient({
      userId: accountId,
      db: this.db,
      callbackUrl: 'http://localhost:3000/unused-dummy-atxp-callback',
      isPublic: false,
      fetchFn: this.safeFetchFn,
      sideChannelFetch: this.sideChannelFetch,
      strict: this.strict,
      allowInsecureRequests: this.allowInsecureRequests,
      logger: this.logger
    });
    return this.oauthClient;
  }

  private defaultPaymentFailureHandler = async (context: PaymentFailureContext) => {
    const { payment, error, attemptedNetworks, retryable } = context;
    const recoveryHint = getErrorRecoveryHint(error);

    this.logger.info(`PAYMENT FAILED: ${recoveryHint.title}`);
    this.logger.info(`Description: ${recoveryHint.description}`);

    if (attemptedNetworks.length > 0) {
      this.logger.info(`Attempted networks: ${attemptedNetworks.join(', ')}`);
    }

    this.logger.info(`Account: ${payment.accountId}`);

    // Log actionable guidance
    if (recoveryHint.actions.length > 0) {
      this.logger.info(`What to do:`);
      recoveryHint.actions.forEach((action, index) => {
        this.logger.info(`  ${index + 1}. ${action}`);
      });
    }

    if (retryable) {
      this.logger.info(`This payment can be retried.`);
    }

    // Log additional context for specific error types
    if (error instanceof InsufficientFundsError) {
      this.logger.info(`Required: ${error.required} ${error.currency}`);
      if (error.available) {
        this.logger.info(`Available: ${error.available} ${error.currency}`);
      }
    } else if (error instanceof ATXPPaymentError && error.context) {
      this.logger.debug(`Error context: ${JSON.stringify(error.context)}`);
    }
  };


  protected handleMultiDestinationPayment = async (
    paymentRequest: PaymentRequest,
    paymentRequestUrl: string,
    paymentRequestId: string
  ): Promise<boolean> => {
    if (!paymentRequest.options || paymentRequest.options.length === 0) {
      return false;
    }

    // Get sources from the account
    const sources = await this.account.getSources();

    // Apply destination mappers to transform options
    // Convert PaymentRequestOption[] to Destination[] for mapper compatibility
    const mappedDestinations: Destination[] = [];
    for (const option of paymentRequest.options) {
      const destinationMaker = this.destinationMakers.get(option.network);
      if (!destinationMaker) {
        this.logger.debug(`ATXP: destination maker for network '${option.network}' not available, trying next destination`);
        continue;
      }
      mappedDestinations.push(...(await destinationMaker.makeDestinations(option, this.logger, paymentRequestId, sources)));
    }

    if (mappedDestinations.length === 0) {
      this.logger.info(`ATXP: no destinations found after mapping`);
      return false;
    }

    // Validate amounts are not negative
    for (const dest of mappedDestinations) {
      if (dest.amount.isLessThan(0)) {
        throw new Error(`ATXP: payment amount cannot be negative: ${dest.amount.toString()} ${dest.currency}`);
      }
    }

    // Create prospective payment for approval (using first destination for display)
    const firstDest = mappedDestinations[0];
    const accountId = await this.account.getAccountId();
    const prospectivePayment: ProspectivePayment = {
      accountId,
      resourceUrl: paymentRequest.resource?.toString() ?? '',
      resourceName: paymentRequest.payeeName ?? '',
      currency: firstDest.currency,
      amount: firstDest.amount,
      iss: paymentRequest.iss ?? paymentRequest.payeeName ?? '',
    };

    // Ask for approval once for all payment attempts
    if (!await this.approvePayment(prospectivePayment)) {
      this.logger.info(`ATXP: payment request denied by callback function`);
      return false;
    }

    // Try each payment maker in order, tracking attempts
    let lastPaymentError: Error | null = null;
    let paymentAttempted = false;
    const attemptedNetworks: string[] = [];
    const failureReasons = new Map<string, Error>();

    for (const paymentMaker of this.account.paymentMakers) {
      try {
        // Pass all destinations to payment maker - it will filter and pick the one it can handle
        const memo = paymentRequest.iss ?? paymentRequest.payeeName ?? '';
        const result = await paymentMaker.makePayment(mappedDestinations, memo, paymentRequestId);

        if (result === null) {
          this.logger.debug(`ATXP: payment maker cannot handle these destinations, trying next`);
          continue; // Try next payment maker
        }

        paymentAttempted = true;

        // Payment was successful
        this.logger.info(`ATXP: made payment of ${firstDest.amount.toString()} ${firstDest.currency} on ${result.chain}: ${result.transactionId}`);

        await this.onPayment({
          payment: prospectivePayment,
          transactionHash: result.transactionId,
          network: result.chain
        });

        // Submit payment to the server
        const jwt = await paymentMaker.generateJWT({paymentRequestId, codeChallenge: '', accountId});
        const response = await this.sideChannelFetch(paymentRequestUrl.toString(), {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${jwt}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            transactionId: result.transactionId,
            ...(result.transactionSubId ? { transactionSubId: result.transactionSubId } : {}),
            chain: result.chain,
            currency: result.currency
          })
        });

        this.logger.debug(`ATXP: payment was ${response.ok ? 'successfully' : 'not successfully'} PUT to ${paymentRequestUrl} : status ${response.status} ${response.statusText}`);

        if (!response.ok) {
          const msg = `ATXP: payment to ${paymentRequestUrl} failed: HTTP ${response.status} ${await response.text()}`;
          this.logger.info(msg);
          throw new Error(msg);
        }

        return true;
      } catch (error: unknown) {
        const typedError = error as Error;
        paymentAttempted = true;
        lastPaymentError = typedError;

        // Extract network from error context if available
        let network = 'unknown';
        if (typedError instanceof ATXPPaymentError && typedError.context?.network) {
          network = typeof typedError.context.network === 'string' ? typedError.context.network : 'unknown';
        }

        attemptedNetworks.push(network);
        failureReasons.set(network, typedError);

        this.logger.warn(`ATXP: payment maker failed on ${network}: ${typedError.message}`);

        // Call optional per-attempt failure callback
        if (this.onPaymentAttemptFailed) {
          const remainingMakers = this.account.paymentMakers.length - (attemptedNetworks.length);
          const remainingNetworks = remainingMakers > 0 ? ['next available'] : [];
          await this.onPaymentAttemptFailed({
            network,
            error: typedError,
            remainingNetworks
          });
        }

        // Continue to next payment maker
      }
    }

    // If payment was attempted but all failed, create full context and call onPaymentFailure
    if (paymentAttempted && lastPaymentError) {
      const isRetryable = lastPaymentError instanceof ATXPPaymentError
        ? lastPaymentError.retryable
        : true; // Default to retryable for unknown errors

      const failureContext: PaymentFailureContext = {
        payment: prospectivePayment,
        error: lastPaymentError,
        attemptedNetworks,
        failureReasons,
        retryable: isRetryable,
        timestamp: new Date()
      };

      await this.onPaymentFailure(failureContext);
      throw lastPaymentError;
    }

    this.logger.info(`ATXP: no payment maker could handle these destinations`);
    return false;
  }

  protected handlePaymentRequestError = async (paymentRequestError: McpError): Promise<boolean> => {
    if (paymentRequestError.code !== PAYMENT_REQUIRED_ERROR_CODE) {
      throw new Error(`ATXP: expected payment required error (code ${PAYMENT_REQUIRED_ERROR_CODE}); got code ${paymentRequestError.code}`);
    }
    const paymentRequestUrl = (paymentRequestError.data as {paymentRequestUrl: string}|undefined)?.paymentRequestUrl;
    if (!paymentRequestUrl) {
      throw new Error(`ATXP: payment requirement error does not contain a payment requirement URL`);
    }
    const paymentRequestId = (paymentRequestError.data as {paymentRequestId: string}|undefined)?.paymentRequestId;
    if (!paymentRequestId) {
      throw new Error(`ATXP: payment requirement error does not contain a payment request ID`);
    }
    if (!this.isAllowedAuthServer(paymentRequestUrl)) {
      this.logger.info(`ATXP: payment requirement is not allowed on this server`);
      return false;
    }

    const paymentRequest = await this.getPaymentRequest(paymentRequestUrl);
    if (!paymentRequest) {
      throw new Error(`ATXP: payment request ${paymentRequestId} not found on server ${paymentRequestUrl}`);
    }

    // Handle multi-option format
    if (paymentRequest.options && paymentRequest.options.length > 0) {
      return this.handleMultiDestinationPayment(paymentRequest, paymentRequestUrl, paymentRequestId);
    }

    // Payment request doesn't have options - this shouldn't happen with new SDK
    throw new Error(`ATXP: payment request does not contain options array`);
  }

  protected getPaymentRequest = async (paymentRequestUrl: string): Promise<PaymentRequest | null> => {
    const prRequest = await this.sideChannelFetch(paymentRequestUrl);
    if (!prRequest.ok) {
      throw new Error(`ATXP: GET ${paymentRequestUrl} failed: ${prRequest.status} ${prRequest.statusText}`);
    }
    const paymentRequest = await prRequest.json() as PaymentRequest;

    // Parse amount strings to BigNumber objects
    if (paymentRequest.options) {
      for (const option of paymentRequest.options) {
        if (typeof option.amount === 'string' || typeof option.amount === 'number') {
          option.amount = new BigNumber(option.amount);
        }
      }
    }

    return paymentRequest;
  }

  protected isAllowedAuthServer = (url: string | URL): boolean => {
    const urlObj = typeof url === 'string' ? new URL(url) : url;
    const baseUrl = urlObj.origin as AuthorizationServerUrl;
    return this.allowedAuthorizationServers.includes(baseUrl);
  }

  protected makeAuthRequestWithPaymentMaker = async (authorizationUrl: URL, paymentMaker: PaymentMaker): Promise<string> => {
    const codeChallenge = authorizationUrl.searchParams.get('code_challenge');
    if (!codeChallenge) {
      throw new Error(`Code challenge not provided`);
    }

    if (!paymentMaker) {
      const paymentMakerCount = this.account.paymentMakers.length;
      throw new Error(`Payment maker is null/undefined. Available payment maker count: ${paymentMakerCount}. This usually indicates a payment maker object was not properly instantiated.`);
    }

    // TypeScript should prevent this, but add runtime check for edge cases (untyped JS, version mismatches, etc.)
    if (!paymentMaker.generateJWT) {
      const paymentMakerCount = this.account.paymentMakers.length;
      throw new Error(`Payment maker is missing generateJWT method. Available payment maker count: ${paymentMakerCount}. This indicates the payment maker object does not implement the PaymentMaker interface. If using TypeScript, ensure your payment maker properly implements the PaymentMaker interface.`);
    }

    const accountId = await this.account.getAccountId();
    const authToken = await paymentMaker.generateJWT({paymentRequestId: '', codeChallenge: codeChallenge, accountId});

    // Make a fetch call to the authorization URL with the payment ID
    // redirect=false is a hack
    // The OAuth spec calls for the authorization url to return with a redirect, but fetch
    // on mobile will automatically follow the redirect (it doesn't support the redirect=manual option)
    // We want the redirect URL so we can extract the code from it, not the contents of the 
    // redirect URL (which might not even exist for agentic ATXP clients)
    //   So ATXP servers are set up to instead return a 200 with the redirect URL in the body
    // if we pass redirect=false.
    // TODO: Remove the redirect=false hack once we have a way to handle the redirect on mobile
    const response = await this.sideChannelFetch(authorizationUrl.toString()+'&redirect=false', {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });
    // Check if we got a redirect response (301, 302, etc.) in case the server follows 
    // the OAuth spec
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('Location');
      if (location) {
        this.logger.debug(`ATXP: got redirect authorization code response - redirect to ${location}`);
        return location;
      } else {
        this.logger.info(`ATXP: got redirect authorization code response, but no redirect URL in Location header`);
      }
    }
    // Handle the non-standard ATXP redirect=false hack
    if (response.ok) {
      // Handle the redirect manually
      const body = await response.json();
      const redirectUrl = body.redirect;
      if (redirectUrl) {
        this.logger.debug(`ATXP: got response.ok authorization code response - redirect to ${redirectUrl}`);
        return redirectUrl;
      } else {
        this.logger.info(`ATXP: got authorization code response with response.ok, but no redirect URL in body`);
      }
    }

    // If we didn't get a redirect, throw an error
    throw new Error(`Expected redirect response from authorization URL, got ${response.status}`);
  }

  protected authToService = async (error: OAuthAuthenticationRequiredError): Promise<void> => {
    // TODO: We need to generalize this - we can't assume that there's a single paymentMaker for the auth flow.
    if (this.account.paymentMakers.length > 1) {
      throw new Error(`ATXP: multiple payment makers found - cannot determine which one to use for auth`);
    }

    const paymentMaker: PaymentMaker | undefined = this.account.paymentMakers[0];
    if (paymentMaker) {
      // We can do the full OAuth flow - we'll generate a signed JWT and call /authorize on the
      // AS to get a code, then exchange the code for an access token
      const oauthClient = await this.getOAuthClient();

      // Try to create a spend permission before authorization
      // This allows pre-authorizing spending for MCP servers (returns null for account types that don't support it)
      let spendPermissionToken: string | null = null;
      try {
        const result = await this.account.createSpendPermission(error.resourceServerUrl);
        if (result) {
          this.logger.info(`Created spend permission for resource ${error.resourceServerUrl}`);
          this.logger.debug(`Created spend permission token: ${result.substring(0, 8)}...`);
          spendPermissionToken = result;
        }
      } catch (spendPermissionError) {
        // Log but don't fail - authorization can still proceed without spend permission
        this.logger.warn(`Failed to create spend permission: ${(spendPermissionError as Error).message}`);
      }

      const authorizationUrl = await oauthClient.makeAuthorizationUrl(
        error.url,
        error.resourceServerUrl,
        spendPermissionToken ? { spendPermissionToken } : undefined
      );

      if (!this.isAllowedAuthServer(authorizationUrl)) {
        throw new Error(`ATXP: resource server ${error.url} is requesting to use ${authorizationUrl} which is not in the allowed list of authorization servers ${this.allowedAuthorizationServers.join(', ')}`);
      }

      try {
        const redirectUrl = await this.makeAuthRequestWithPaymentMaker(authorizationUrl, paymentMaker);
        // Handle the OAuth callback
        const oauthClient = await this.getOAuthClient();
        await oauthClient.handleCallback(redirectUrl);

        // Call onAuthorize callback after successful authorization
        const accountId = await this.account.getAccountId();
        await this.onAuthorize({
          authorizationServer: authorizationUrl.origin as AuthorizationServerUrl,
          userId: accountId
        });
      } catch (authError) {
        // Call onAuthorizeFailure callback if authorization fails
        const accountId = await this.account.getAccountId();
        await this.onAuthorizeFailure({
          authorizationServer: authorizationUrl.origin as AuthorizationServerUrl,
          userId: accountId,
          error: authError as Error
        });
        throw authError;
      }
    } else {
      // Else, we'll see if we've already got an OAuth token from OUR caller (if any).
      // If we do, we'll use it to auth to the downstream resource
      // (In pass-through scenarios, the atxpServer() middleware stores the incoming
      // token in the DB under the '' resource URL).
      const accountId = await this.account.getAccountId();
      const existingToken = await this.db.getAccessToken(accountId, '');
      if (!existingToken) {
        this.logger.info(`ATXP: no token found for the current server - we can't exchange a token if we don't have one`);
        throw error;
      }
      const newToken = await this.exchangeToken(existingToken, error.resourceServerUrl);
      this.db.saveAccessToken(accountId, error.resourceServerUrl, newToken);
    }
  }

  protected exchangeToken = async (myToken: AccessToken, newResourceUrl: string): Promise<AccessToken> => {
    // TODO: Do token-exchange rather than passing through our own token
    const token = Object.assign({}, myToken);
    token.resourceUrl = newResourceUrl;
    return token;
  }

  protected checkForATXPResponse = async (response: Response): Promise<void> => {
    const clonedResponse = response.clone();
    const body = await clonedResponse.text();
    if (body.length === 0) {
      return;
    }

    let paymentRequests: {url: AuthorizationServerUrl, id: string}[] = [];
    try {
      // Check if the response is SSE formatted
      if (isSSEResponse(body)) {
        this.logger.debug('Detected SSE-formatted response, parsing SSE messages for payment requirements');
        const messages = await parseMcpMessages(body);
        paymentRequests = messages.flatMap(message => parsePaymentRequests(message)).filter(pr => pr !== null);
      } else {
        const json = JSON.parse(body);
        const messages = await parseMcpMessages(json);
        paymentRequests = messages.flatMap(message => parsePaymentRequests(message)).filter(pr => pr !== null);
      }
    } catch (error) {
      this.logger.error(`ATXP: error checking for payment requirements in MCP response: ${error}`);
      this.logger.debug(body);
    }

    if(paymentRequests.length > 1) {
      throw new Error(`ATXP: multiple payment requirements found in MCP response. The client does not support multiple payment requirements. ${paymentRequests.map(pr => pr.url).join(', ')}`);
    }
    for (const {url, id} of paymentRequests) {
      this.logger.info(`ATXP: payment requirement found in MCP response - ${url} - throwing payment required error`);
      throw paymentRequiredError(url, id);
    }
  }

  fetch: FetchLike = async (url, init) => {
    let response: Response | null = null;
    let fetchError: Error | null = null;
    const oauthClient = await this.getOAuthClient();
    try {
      // Try to fetch the resource
      response = await oauthClient.fetch(url, init);
      await this.checkForATXPResponse(response);
      return response;
    } catch (error: unknown) {
      fetchError = error as Error;

      // If we get an OAuth authentication required error, handle it
      if (error instanceof OAuthAuthenticationRequiredError) {
        this.logger.info(`OAuth authentication required - ATXP client starting oauth flow for resource metadata ${error.resourceServerUrl}`);
        await this.authToService(error);

        try {
          // Retry the request once - we should be auth'd now
          response = await oauthClient.fetch(url, init);
          await this.checkForATXPResponse(response);
          return response;
        } catch (eTwo) {
          // If we throw an error again, it could be a payment error - don't just fail, see
          // if we can handle it in the payment flow below
          fetchError = eTwo as Error;
        }
      }

      // Check for MCP error with payment required code - use duck typing since instanceof may fail with bundling
      const mcpError = (fetchError as Error & { code?: number })?.code === PAYMENT_REQUIRED_ERROR_CODE ? fetchError as McpError : null;

      if (mcpError) {
        this.logger.info(`Payment required - ATXP client starting payment flow ${(mcpError?.data as {paymentRequestUrl: string}|undefined)?.paymentRequestUrl}`);
        if(await this.handlePaymentRequestError(mcpError)) {
          // Retry the request once - we should be auth'd now
          response = await oauthClient.fetch(url, init);
          await this.checkForATXPResponse(response);
        } else {
          this.logger.info(`ATXP: payment request was not completed successfully`);
        }
        if(response) {
          return response;
        } else {
          throw new Error(`ATXP: no response was generated by the fetch`);
        }
      }

      // If it's not an authentication or payment error, rethrow
      throw error;
    }
  }
}
