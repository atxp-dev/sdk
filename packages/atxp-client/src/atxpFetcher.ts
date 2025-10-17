import { BigNumber } from 'bignumber.js';
import { OAuthAuthenticationRequiredError, OAuthClient } from './oAuth.js';
import { PAYMENT_REQUIRED_ERROR_CODE, paymentRequiredError, AccessToken, AuthorizationServerUrl, FetchLike, OAuthDb, PaymentRequestData, DEFAULT_AUTHORIZATION_SERVER, Logger, parsePaymentRequests, parseMcpMessages, ConsoleLogger, isSSEResponse, Network, Currency } from '@atxp/common';
import type { PaymentMaker, ProspectivePayment, ClientConfig, PaymentDestination, PaymentObject } from './types.js';
import { InsufficientFundsError, PaymentNetworkError } from './types.js';
import { getIsReactNative, createReactNativeSafeFetch } from '@atxp/common';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { DestinationMapper, ATXPDestinationMapper } from './destinationMapper.js';

/**
 * Creates an ATXP fetch wrapper that handles OAuth authentication and payments.
 * This follows the wrapper pattern for fetch functions.
 *
 * @param config - The client configuration
 * @returns A wrapped fetch function that handles ATXP protocol
 */
export function atxpFetch(config: ClientConfig): FetchLike {
  // Create default destination mappers
  const destinationMappers: DestinationMapper[] = [
    new ATXPDestinationMapper(config.fetchFn, config.logger)
  ];

  const fetcher = new ATXPFetcher({
    accountId: config.account.accountId,
    db: config.oAuthDb,
    paymentMakers: config.account.paymentMakers,
    destinationMappers,
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
  protected paymentMakers: PaymentMaker[];
  protected destinationMappers: DestinationMapper[];
  protected sideChannelFetch: FetchLike;
  protected db: OAuthDb;
  protected accountId: string;
  protected allowedAuthorizationServers: AuthorizationServerUrl[];
  protected approvePayment: (payment: ProspectivePayment) => Promise<boolean>;
  protected logger: Logger;
  protected onAuthorize: (args: { authorizationServer: AuthorizationServerUrl, userId: string }) => Promise<void>;
  protected onAuthorizeFailure: (args: { authorizationServer: AuthorizationServerUrl, userId: string, error: Error }) => Promise<void>;
  protected onPayment: (args: { payment: ProspectivePayment }) => Promise<void>;
  protected onPaymentFailure: (args: { payment: ProspectivePayment, error: Error }) => Promise<void>;
  constructor(config: {
    accountId: string;
    db: OAuthDb;
    paymentMakers: PaymentMaker[];
    destinationMappers?: DestinationMapper[];
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
      destinationMappers = [],
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
    if (!paymentMakers || paymentMakers.length === 0) {
      throw new Error('At least one payment maker is required');
    }
    this.paymentMakers = paymentMakers;
    this.destinationMappers = destinationMappers;
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
      this.logger.info(`PAYMENT FAILED: Insufficient ${error.currency} funds on ${payment.network}`);
      this.logger.info(`Required: ${error.required} ${error.currency}`);
      if (error.available) {
        this.logger.info(`Available: ${error.available} ${error.currency}`);
      }
      this.logger.info(`Account: ${payment.accountId}`);
    } else if (error instanceof PaymentNetworkError) {
      this.logger.info(`PAYMENT FAILED: Network error on ${payment.network}: ${error.message}`);
    } else {
      this.logger.info(`PAYMENT FAILED: ${error.message}`);
    }
  };

  /**
   * THREE-STAGE FLOW: Stage 1 - Collect source addresses from all payment makers
   */
  protected async collectSourceAddresses(
    amount: BigNumber,
    currency: Currency,
    receiver: string,
    memo: string
  ): Promise<Array<{network: Network, address: string}>> {
    const sourceAddresses: Array<{network: Network, address: string}> = [];

    for (const maker of this.paymentMakers) {
      try {
        const addresses = await maker.getSourceAddresses({
          amount,
          currency,
          receiver,
          memo
        });

        // Add all addresses, avoiding duplicates
        for (const addr of addresses) {
          if (!sourceAddresses.find(a => a.network === addr.network && a.address === addr.address)) {
            sourceAddresses.push(addr);
          }
        }
      } catch (error) {
        this.logger.debug(`Failed to get source addresses from maker: ${(error as Error).message}`);
        // Continue with other makers
      }
    }

    this.logger.info(`Collected ${sourceAddresses.length} source addresses from ${this.paymentMakers.length} payment makers`);
    return sourceAddresses;
  }

  /**
   * THREE-STAGE FLOW: Stage 2 - Apply destination mappers
   */
  protected async applyDestinationMappers(
    destinations: PaymentDestination[],
    sourceAddresses: Array<{network: Network, address: string}>
  ): Promise<PaymentDestination[]> {
    let mappedDestinations: PaymentDestination[] = [];

    for (const destination of destinations) {
      // Apply all mappers to this destination
      let destArray: PaymentDestination[] = [destination];

      for (const mapper of this.destinationMappers) {
        const newDestArray: PaymentDestination[] = [];

        for (const dest of destArray) {
          const mapped = await mapper.mapDestination(dest, sourceAddresses);
          newDestArray.push(...mapped);
        }

        destArray = newDestArray;
      }

      mappedDestinations.push(...destArray);
    }

    this.logger.info(`After mapping: ${mappedDestinations.length} destination(s) (from ${destinations.length} original)`);
    return mappedDestinations;
  }

  /**
   * THREE-STAGE FLOW: Stage 3 - Try payment makers with mapped destinations
   */
  protected async executePaymentWithMakers(
    destinations: PaymentDestination[],
    memo: string,
    paymentRequestId: string
  ): Promise<PaymentObject | null> {
    for (const maker of this.paymentMakers) {
      try {
        const result = await maker.makePayment(destinations, memo, paymentRequestId);

        if (result !== null) {
          this.logger.info(`Payment successful on network ${result.network}: ${result.transactionId}`);
          return result;
        }
      } catch (error) {
        this.logger.warn(`Payment maker failed: ${(error as Error).message}`);
        // Continue with next maker
      }
    }

    return null;
  }

  /**
   * Generate JWT for payment submission - tries to find a maker that can generate JWT
   */
  protected async generateJWTForPayment(network: Network, paymentRequestId: string): Promise<string> {
    // Try to use the first payment maker (they all should be able to generate JWTs)
    if (this.paymentMakers.length === 0) {
      throw new Error('No payment makers available to generate JWT');
    }

    const maker = this.paymentMakers[0];
    return await maker.generateJWT({ paymentRequestId, codeChallenge: '' });
  }

  protected handleMultiDestinationPayment = async (
    paymentRequestData: PaymentRequestData,
    paymentRequestUrl: string,
    paymentRequestId: string
  ): Promise<boolean> => {
    if (!paymentRequestData.destinations || paymentRequestData.destinations.length === 0) {
      return false;
    }

    // Convert PaymentRequestData destinations to PaymentDestination format
    const destinations: PaymentDestination[] = paymentRequestData.destinations.map(dest => ({
      network: dest.network,
      address: dest.address,
      amount: new BigNumber(dest.amount),
      currency: dest.currency,
      paymentRequestId,
      accountId: this.accountId
    }));

    // Check approval before making payment
    const prospectivePayment: ProspectivePayment = {
      accountId: this.accountId,
      resourceUrl: paymentRequestData.resource?.toString() ?? '',
      resourceName: paymentRequestData.resourceName ?? '',
      network: destinations[0].network,
      currency: destinations[0].currency,
      amount: destinations[0].amount,
      iss: paymentRequestData.iss ?? '',
    };

    if (!await this.approvePayment(prospectivePayment)) {
      this.logger.info(`ATXP: payment request denied by callback function`);
      return false;
    }

    try {
      // THREE-STAGE FLOW
      // Stage 1: Collect source addresses
      const sourceAddresses = await this.collectSourceAddresses(
        destinations[0].amount,
        destinations[0].currency,
        destinations[0].address,
        paymentRequestData.iss ?? ''
      );

      // Stage 2: Apply destination mappers
      const mappedDestinations = await this.applyDestinationMappers(destinations, sourceAddresses);

      // Stage 3: Execute payment with makers
      const paymentResult = await this.executePaymentWithMakers(
        mappedDestinations,
        paymentRequestData.iss ?? '',
        paymentRequestId
      );

      if (!paymentResult) {
        this.logger.info(`ATXP: no payment maker could handle the destinations`);
        return false;
      }

      this.logger.info(`ATXP: made payment of ${paymentResult.amount.toString()} ${paymentResult.currency} on ${paymentResult.network}: ${paymentResult.transactionId}`);

      // Update prospective payment with actual network used
      prospectivePayment.network = paymentResult.network;
      prospectivePayment.currency = paymentResult.currency;
      prospectivePayment.amount = paymentResult.amount;

      await this.onPayment({ payment: prospectivePayment });

      // Submit payment to the server
      // Find a payment maker that can generate JWT for this network
      const jwt = await this.generateJWTForPayment(paymentResult.network, paymentRequestId);

      const response = await this.sideChannelFetch(paymentRequestUrl.toString(), {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${jwt}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          transactionId: paymentResult.transactionId,
          network: paymentResult.network,
          currency: paymentResult.currency
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
      this.logger.warn(`ATXP: payment failed: ${typedError.message}`);
      await this.onPaymentFailure({ payment: prospectivePayment, error: typedError });
      return false;
    }
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

    // Handle legacy single destination format - convert to multi-destination
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

    // Convert to multi-destination format and use the new flow
    const legacyDestinations: PaymentDestination[] = [{
      network: requestedNetwork,
      address: destination,
      amount,
      currency,
      paymentRequestId,
      accountId: this.accountId
    }];

    const prospectivePayment: ProspectivePayment = {
      accountId: this.accountId,
      resourceUrl: paymentRequestData.resource?.toString() ?? '',
      resourceName: paymentRequestData.resourceName ?? '',
      network: requestedNetwork,
      currency,
      amount,
      iss: paymentRequestData.iss ?? '',
    };

    if (!await this.approvePayment(prospectivePayment)){
      this.logger.info(`ATXP: payment request denied by callback function`);
      return false;
    }

    try {
      // Use three-stage flow
      const sourceAddresses = await this.collectSourceAddresses(
        amount,
        currency,
        destination,
        paymentRequestData.iss ?? ''
      );

      const mappedDestinations = await this.applyDestinationMappers(legacyDestinations, sourceAddresses);

      const paymentResult = await this.executePaymentWithMakers(
        mappedDestinations,
        paymentRequestData.iss ?? '',
        paymentRequestId
      );

      if (!paymentResult) {
        this.logger.info(`ATXP: no payment maker could handle the destination`);
        return false;
      }

      this.logger.info(`ATXP: made payment of ${paymentResult.amount} ${paymentResult.currency} on ${paymentResult.network}: ${paymentResult.transactionId}`);

      // Update prospective payment with actual network used
      prospectivePayment.network = paymentResult.network;
      prospectivePayment.currency = paymentResult.currency;
      prospectivePayment.amount = paymentResult.amount;

      await this.onPayment({ payment: prospectivePayment });

      const jwt = await this.generateJWTForPayment(paymentResult.network, paymentRequestId);

      const response = await this.sideChannelFetch(paymentRequestUrl.toString(), {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${jwt}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          transactionId: paymentResult.transactionId,
          network: paymentResult.network,
          currency: paymentResult.currency
        })
      });

      this.logger.debug(`ATXP: payment was ${response.ok ? 'successfully' : 'not successfully'} PUT to ${paymentRequestUrl} : status ${response.status} ${response.statusText}`);

      if(!response.ok) {
        const msg = `ATXP: payment to ${paymentRequestUrl} failed: HTTP ${response.status} ${await response.text()}`;
        this.logger.info(msg);
        throw new Error(msg);
      }

      return true;
    } catch (paymentError) {
      await this.onPaymentFailure({
        payment: prospectivePayment,
        error: paymentError as Error
      });
      throw paymentError;
    }
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
      throw new Error(`Payment maker is null/undefined. Available payment makers: ${this.paymentMakers.length}. This usually indicates a payment maker object was not properly instantiated.`);
    }

    // TypeScript should prevent this, but add runtime check for edge cases (untyped JS, version mismatches, etc.)
    if (!paymentMaker.generateJWT) {
      throw new Error(`Payment maker is missing generateJWT method. This indicates the payment maker object does not implement the PaymentMaker interface. If using TypeScript, ensure your payment maker properly implements the PaymentMaker interface.`);
    }

    const authToken = await paymentMaker.generateJWT({paymentRequestId: '', codeChallenge: codeChallenge});

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
    // Use the first payment maker for auth flow
    if (this.paymentMakers.length > 1) {
      this.logger.warn(`ATXP: multiple payment makers found - using first one for auth`);
    }

    const paymentMaker: PaymentMaker | undefined = this.paymentMakers[0];
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
