import { BigNumber } from 'bignumber.js';
import { OAuthAuthenticationRequiredError, OAuthClient } from './oAuth.js';
import { PAYMENT_REQUIRED_ERROR_CODE, paymentRequiredError, AccessToken, AuthorizationServerUrl, FetchLike, OAuthDb, PaymentRequestData, DEFAULT_AUTHORIZATION_SERVER, Logger, parsePaymentRequests, parseMcpMessages, ConsoleLogger, isSSEResponse, Currency, AccountId, Chain, Network, DestinationMaker } from '@atxp/common';
import type { PaymentMaker, ProspectivePayment, ClientConfig } from './types.js';
import { InsufficientFundsError, PaymentNetworkError } from './types.js';
import { getIsReactNative, createReactNativeSafeFetch, Destination } from '@atxp/common';
import { McpError } from '@modelcontextprotocol/sdk/types.js';

/**
 * Creates an ATXP fetch wrapper that handles OAuth authentication and payments.
 * This follows the wrapper pattern for fetch functions.
 *
 * @param config - The client configuration
 * @returns A wrapped fetch function that handles ATXP protocol
 */
export function atxpFetch(config: ClientConfig): FetchLike {
  const fetcher = new ATXPFetcher({
    accountId: config.account.accountId,
    db: config.oAuthDb,
    paymentMakers: new Map(Object.entries(config.account.paymentMakers) as [Chain, PaymentMaker][]),
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
    onPaymentFailure: config.onPaymentFailure
  });
  return fetcher.fetch;
}

export class ATXPFetcher {
  protected oauthClient: OAuthClient;
  protected paymentMakers: Map<Chain, PaymentMaker>;
  protected destinationMakers: Map<Network, DestinationMaker>;
  protected sideChannelFetch: FetchLike;
  protected db: OAuthDb;
  protected accountId: AccountId;
  protected allowedAuthorizationServers: AuthorizationServerUrl[];
  protected approvePayment: (payment: ProspectivePayment) => Promise<boolean>;
  protected logger: Logger;
  protected onAuthorize: (args: { authorizationServer: AuthorizationServerUrl, userId: string }) => Promise<void>;
  protected onAuthorizeFailure: (args: { authorizationServer: AuthorizationServerUrl, userId: string, error: Error }) => Promise<void>;
  protected onPayment: (args: { payment: ProspectivePayment }) => Promise<void>;
  protected onPaymentFailure: (args: { payment: ProspectivePayment, error: Error }) => Promise<void>;
  constructor(config: {
    accountId: AccountId;
    db: OAuthDb;
    paymentMakers: Map<Chain, PaymentMaker>;
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
    onPayment?: (args: { payment: ProspectivePayment }) => Promise<void>;
    onPaymentFailure?: (args: { payment: ProspectivePayment, error: Error }) => Promise<void>;
  }) {
    const {
      accountId,
      db,
      paymentMakers,
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
      onPaymentFailure = async () => {}
    } = config;
    // Use React Native safe fetch if in React Native environment
    const safeFetchFn = getIsReactNative() ? createReactNativeSafeFetch(fetchFn) : fetchFn;
    const safeSideChannelFetch = getIsReactNative() ? createReactNativeSafeFetch(sideChannelFetch) : sideChannelFetch;
    
    // ATXPClient should never actually use the callback url - instead of redirecting the user to 
    // an authorization url which redirects back to the callback url, ATXPClient posts the payment
    // directly to the authorization server, then does the token exchange itself
    this.oauthClient = new OAuthClient({
      userId: accountId,
      db,
      callbackUrl: 'http://localhost:3000/unused-dummy-atxp-callback',
      isPublic: false,
      fetchFn: safeFetchFn,
      sideChannelFetch: safeSideChannelFetch,
      strict,
      allowInsecureRequests,
      logger: logger
    });
    this.paymentMakers = paymentMakers;
    this.destinationMakers = destinationMakers;
    this.sideChannelFetch = safeSideChannelFetch;
    this.db = db;
    this.accountId = accountId;
    this.allowedAuthorizationServers = allowedAuthorizationServers;
    this.approvePayment = approvePayment;
    this.logger = logger;
    this.onAuthorize = onAuthorize;
    this.onAuthorizeFailure = onAuthorizeFailure;
    this.onPayment = onPayment;
    this.onPaymentFailure = onPaymentFailure || this.defaultPaymentFailureHandler;
  }

  private defaultPaymentFailureHandler = async ({ payment, error }: { payment: ProspectivePayment, error: Error }) => {
    if (error instanceof InsufficientFundsError) {
      this.logger.info(`PAYMENT FAILED: Insufficient ${error.currency} funds on ${payment.chain}`);
      this.logger.info(`Required: ${error.required} ${error.currency}`);
      if (error.available) {
        this.logger.info(`Available: ${error.available} ${error.currency}`);
      }
      this.logger.info(`Account: ${payment.accountId}`);
    } else if (error instanceof PaymentNetworkError) {
      this.logger.info(`PAYMENT FAILED: Network error on ${payment.chain}: ${error.message}`);
    } else {
      this.logger.info(`PAYMENT FAILED: ${error.message}`);
    }
  };


  protected handleMultiDestinationPayment = async (
    paymentRequestData: PaymentRequestData,
    paymentRequestUrl: string,
    paymentRequestId: string
  ): Promise<boolean> => {
    if (!paymentRequestData.destinations || paymentRequestData.destinations.length === 0) {
      return false;
    }

    // Apply destination mappers to transform destinations
    // Convert PaymentRequestDestination[] to Destination[] for mapper compatibility
    let mappedDestinations: Destination[] = [];
    for (const option of paymentRequestData.destinations) {
      const destinationMaker = this.destinationMakers.get(option.network);
      if (!destinationMaker) {
        this.logger.debug(`ATXP: destination maker for network '${option.network}' not available, trying next destination`);
        continue;
      }
      mappedDestinations = await destinationMaker.makeDestinations(option, this.logger);
    }

    // Try each destination in order
    for (const dest of mappedDestinations) {
      // Convert amount to BigNumber since it comes as a string from JSON
      const amount = new BigNumber(dest.amount);

      // Use destination directly without any resolution
      const destinationAddress = dest.address;
      const destinationChain = dest.chain;

      const paymentMaker = this.paymentMakers.get(destinationChain);
      if (!paymentMaker) {
        this.logger.debug(`ATXP: payment chain '${destinationChain}' not available, trying next destination`);
        continue;
      }

      const prospectivePayment : ProspectivePayment = {
        accountId: this.accountId,
        resourceUrl: paymentRequestData.resource?.toString() ?? '',
        resourceName: paymentRequestData.resourceName ?? '',
        chain: destinationChain,
        currency: dest.currency,
        amount: amount,
        iss: paymentRequestData.iss ?? '',
      };

      if (!await this.approvePayment(prospectivePayment)){
        this.logger.info(`ATXP: payment request denied by callback function for destination on ${destinationChain}`);
        continue;
      }

      let paymentId: string;
      try {
        paymentId = await paymentMaker.makePayment(amount, dest.currency as Currency, destinationAddress, paymentRequestData.iss, paymentRequestId);
        this.logger.info(`ATXP: made payment of ${amount.toString()} ${dest.currency} on ${destinationChain}: ${paymentId}`);
        await this.onPayment({ payment: prospectivePayment });

        // Submit payment to the server
        const jwt = await paymentMaker.generateJWT({paymentRequestId, codeChallenge: '', accountId: this.accountId});
        const response = await this.sideChannelFetch(paymentRequestUrl.toString(), {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${jwt}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            transactionId: paymentId,
            chain: destinationChain,
            currency: dest.currency
          })
        });

        this.logger.debug(`ATXP: payment was ${response.ok ? 'successfully' : 'not successfully'} PUT to ${paymentRequestUrl} : status ${response.status} ${response.statusText}`);

        if(!response.ok) {
          const msg = `ATXP: payment to ${paymentRequestUrl} failed: HTTP ${response.status} ${await response.text()}`;
          this.logger.info(msg);
          throw new Error(msg);
        }

        return true;
      } catch (error: unknown) {
        const typedError = error as Error;
        this.logger.warn(`ATXP: payment failed on ${destinationChain}: ${typedError.message}`);
        await this.onPaymentFailure({ payment: prospectivePayment, error: typedError });
        // Try next destination
        continue;
      }
    }

    this.logger.info(`ATXP: no suitable payment destination found among ${paymentRequestData.destinations.length} options`);
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

    const paymentRequestData = await this.getPaymentRequestData(paymentRequestUrl);
    if (!paymentRequestData) {
      throw new Error(`ATXP: payment request ${paymentRequestId} not found on server ${paymentRequestUrl}`);
    }

    // Handle multi-destination format
    if (paymentRequestData.destinations && paymentRequestData.destinations.length > 0) {
      return this.handleMultiDestinationPayment(paymentRequestData, paymentRequestUrl, paymentRequestId);
    }

    // TODO: Remove the legacy payment request format handling once we've fully migrated to multi-destination PRs
    // Handle legacy single destination format
    const requestedNetwork = paymentRequestData.network;
    if (!requestedNetwork) {
      throw new Error(`Payment network not provided`);
    }

    const destination = paymentRequestData.destination;
    if (!destination) {
      throw new Error(`destination not provided`);
    }

    let amount = new BigNumber(0);
    if (!paymentRequestData.amount) {
      throw new Error(`amount not provided`);
    }
    try{
      amount = new BigNumber(paymentRequestData.amount);
    } catch {
      throw new Error(`Invalid amount ${paymentRequestData.amount}`);
    }
    if(amount.lte(0)) {
      throw new Error(`Invalid amount ${paymentRequestData.amount}`);
    }

    const currency = paymentRequestData.currency;
    if (!currency) {
      throw new Error(`Currency not provided`);
    }

    // Use destination directly without any resolution
    const destinationAddress = destination;
    const destinationNetwork = requestedNetwork;

    // Temporarily assume network is a chain to support back-compatibility
    const paymentMaker = this.paymentMakers.get(destinationNetwork as Chain);
    if (!paymentMaker) {
      this.logger.info(`ATXP: payment network '${destinationNetwork}' not set up for this client (available networks: ${Array.from(this.paymentMakers.keys()).join(', ')})`);
      return false;
    }

    const prospectivePayment : ProspectivePayment = {
      accountId: this.accountId,
      resourceUrl: paymentRequestData.resource?.toString() ?? '',
      resourceName: paymentRequestData.resourceName ?? '',
      chain: destinationNetwork as Chain,
      currency,
      amount,
      iss: paymentRequestData.iss ?? '',
    };
    if (!await this.approvePayment(prospectivePayment)){
      this.logger.info(`ATXP: payment request denied by callback function`);
      return false;
    }

    let paymentId: string;
    try {
      paymentId = await paymentMaker.makePayment(amount, currency, destinationAddress, paymentRequestData.iss, paymentRequestId);
      this.logger.info(`ATXP: made payment of ${amount} ${currency} on ${destinationNetwork}: ${paymentId}`);

      // Call onPayment callback after successful payment
      await this.onPayment({ payment: prospectivePayment });
    } catch (paymentError) {
      // Call onPaymentFailure callback if payment fails
      await this.onPaymentFailure({
        payment: prospectivePayment,
        error: paymentError as Error
      });
      throw paymentError;
    }

    const jwt = await paymentMaker.generateJWT({paymentRequestId, codeChallenge: '', accountId: this.accountId});

    // Make a fetch call to the authorization URL with the payment ID
    // redirect=false is a hack
    // The OAuth spec calls for the authorization url to return with a redirect, but fetch
    // on mobile will automatically follow the redirect (it doesn't support the redirect=manual option)
    // We want the redirect URL so we can extract the code from it, not the contents of the 
    // redirect URL (which might not even exist for agentic ATXP clients)
    //   So ATXP servers are set up to instead return a 200 with the redirect URL in the body
    // if we pass redirect=false.
    // TODO: Remove the redirect=false hack once we have a way to handle the redirect on mobile
    const response = await this.sideChannelFetch(paymentRequestUrl.toString(), {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        transactionId: paymentId,
        chain: destinationNetwork,
        currency: currency
      })
    });

    this.logger.debug(`ATXP: payment was ${response.ok ? 'successfully' : 'not successfully'} PUT to ${paymentRequestUrl} : status ${response.status} ${response.statusText}`);

    if(!response.ok) {
      const msg = `ATXP: payment to ${paymentRequestUrl} failed: HTTP ${response.status} ${await response.text()}`;
      this.logger.info(msg);
      throw new Error(msg);
    }

    return true;
  }

  protected getPaymentRequestData = async (paymentRequestUrl: string): Promise<PaymentRequestData | null> => {
    const prRequest = await this.sideChannelFetch(paymentRequestUrl);
    if (!prRequest.ok) {
      throw new Error(`ATXP: GET ${paymentRequestUrl} failed: ${prRequest.status} ${prRequest.statusText}`);
    }
    const paymentRequest = await prRequest.json() as PaymentRequestData;
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
      const availableNetworks = Array.from(this.paymentMakers.keys()).join(', ');
      throw new Error(`Payment maker is null/undefined. Available payment makers: [${availableNetworks}]. This usually indicates a payment maker object was not properly instantiated.`);
    }

    // TypeScript should prevent this, but add runtime check for edge cases (untyped JS, version mismatches, etc.)
    if (!paymentMaker.generateJWT) {
      const availableNetworks = Array.from(this.paymentMakers.keys()).join(', ');
      throw new Error(`Payment maker is missing generateJWT method. Available payment makers: [${availableNetworks}]. This indicates the payment maker object does not implement the PaymentMaker interface. If using TypeScript, ensure your payment maker properly implements the PaymentMaker interface.`);
    }

    const authToken = await paymentMaker.generateJWT({paymentRequestId: '', codeChallenge: codeChallenge, accountId: this.accountId});

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
    if (this.paymentMakers.size > 1) {
      throw new Error(`ATXP: multiple payment makers found - cannot determine which one to use for auth`);
    }

    const paymentMaker: PaymentMaker | undefined = Array.from(this.paymentMakers.values())[0];
    if (paymentMaker) {
      // We can do the full OAuth flow - we'll generate a signed JWT and call /authorize on the
      // AS to get a code, then exchange the code for an access token
      const authorizationUrl = await this.oauthClient.makeAuthorizationUrl(
        error.url, 
        error.resourceServerUrl
      );

      if (!this.isAllowedAuthServer(authorizationUrl)) {
        throw new Error(`ATXP: resource server ${error.url} is requesting to use ${authorizationUrl} which is not in the allowed list of authorization servers ${this.allowedAuthorizationServers.join(', ')}`);
      }

      try {
        const redirectUrl = await this.makeAuthRequestWithPaymentMaker(authorizationUrl, paymentMaker);
        // Handle the OAuth callback
        await this.oauthClient.handleCallback(redirectUrl);
        
        // Call onAuthorize callback after successful authorization
        await this.onAuthorize({ 
          authorizationServer: authorizationUrl.origin as AuthorizationServerUrl, 
          userId: this.accountId 
        });
      } catch (authError) {
        // Call onAuthorizeFailure callback if authorization fails
        await this.onAuthorizeFailure({ 
          authorizationServer: authorizationUrl.origin as AuthorizationServerUrl, 
          userId: this.accountId,
          error: authError as Error
        });
        throw authError;
      }
    } else {
      // Else, we'll see if we've already got an OAuth token from OUR caller (if any). 
      // If we do, we'll use it to auth to the downstream resource
      // (In pass-through scenarios, the atxpServer() middleware stores the incoming
      // token in the DB under the '' resource URL).
      const existingToken = await this.db.getAccessToken(this.accountId, '');
      if (!existingToken) {
        this.logger.info(`ATXP: no token found for the current server - we can't exchange a token if we don't have one`);
        throw error;
      }
      const newToken = await this.exchangeToken(existingToken, error.resourceServerUrl);
      this.db.saveAccessToken(this.accountId, error.resourceServerUrl, newToken);
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
    try {
      // Try to fetch the resource
      response = await this.oauthClient.fetch(url, init);
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
          response = await this.oauthClient.fetch(url, init);
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
          response = await this.oauthClient.fetch(url, init);
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
