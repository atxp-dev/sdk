import * as oauth from 'oauth4webapi';
import { OAuthResourceClient } from '@atxp/common';
import { crypto } from '@atxp/common';
import { AccessToken, ClientCredentials, FetchLike, Logger, OAuthDb, PKCEValues } from '@atxp/common';
import { ConsoleLogger } from '@atxp/common';

export class OAuthAuthenticationRequiredError extends Error {
  constructor(
    public readonly url: string,
    public readonly resourceServerUrl: string,
    // TODO: Remove OAuthError idempotencyKey - these errors shouldn't need to be
    // de-duplicated anymore.
    public readonly idempotencyKey: string
  ) {
    super(`OAuth authentication required. Resource server url: ${resourceServerUrl}`);
    this.name = 'OAuthAuthenticationRequiredError';
    this.idempotencyKey = idempotencyKey;
  }

  static async create(url: string, resourceServerUrl: string, token?: string): Promise<OAuthAuthenticationRequiredError> {
    const baseUrl = OAuthClient.trimToPath(url);
    const source = `${baseUrl}|${resourceServerUrl}|${token}`;
    const hash = await crypto.digest(new TextEncoder().encode(source));
    const idempotencyKey = crypto.toHex(hash);
    return new OAuthAuthenticationRequiredError(url, resourceServerUrl, idempotencyKey);
  }
}

const CHUNK_SIZE = 0x8000
function encodeBase64Url(input: Uint8Array | ArrayBuffer) {
  if (input instanceof ArrayBuffer) {
    input = new Uint8Array(input)
  }

  const arr = []
  for (let i = 0; i < input.byteLength; i += CHUNK_SIZE) {
    // @ts-expect-error - subarray is not defined on ArrayBuffer
    arr.push(String.fromCharCode.apply(null, input.subarray(i, i + CHUNK_SIZE)))
  }
  return btoa(arr.join('')).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

export interface OAuthClientConfig {
  userId: string;
  db: OAuthDb;
  callbackUrl: string;
  isPublic: boolean;
  fetchFn?: FetchLike;
  sideChannelFetch?: FetchLike;
  strict?: boolean;
  allowInsecureRequests?: boolean;
  clientName?: string;
  logger?: Logger;
}

export class OAuthClient extends OAuthResourceClient {
  protected db: OAuthDb;
  protected userId: string;
  protected fetchFn: FetchLike;

  constructor({
    userId,
    db,
    callbackUrl,
    clientName = callbackUrl,
    isPublic,
    fetchFn = fetch,
    sideChannelFetch = fetchFn,
    strict = false,
    allowInsecureRequests = process.env.NODE_ENV === 'development',
    logger = new ConsoleLogger()
  }: OAuthClientConfig) {
    super({
      db: db,
      callbackUrl,
      isPublic,
      sideChannelFetch,
      strict,
      allowInsecureRequests,
      clientName,
      logger,
      registrationType: 'client'
    });
    this.db = db;
    this.userId = userId;
    this.fetchFn = fetchFn;
  }

  protected extractResourceUrl = (response: Response): string | null => {
    if (response.status !== 401) {
      return null;
    }
    const header = response.headers.get('www-authenticate') || '';
    const match = header.match(/^Bearer resource_metadata="([^"]+)"$/);
    if (match) {
      return this.normalizeResourceServerUrl(match[1]);
    }
    // handle 'www-authenticate: https://mymcp.com/mcp'
    // This is NOT a valid www-authenticate header, and also doesn't conform with the updated 2025-06-18 version of
    // the MCP spec. However, it is what we were originally using for proxying requests, so we still support it.
    if (header.match(/^https?:\/\//)) {
      return this.normalizeResourceServerUrl(header);
    }
    return null;
  }

  fetch: FetchLike = async (url, init) => {
    let response = await this._doFetch(url, init);
    
    if (response.status === 401) {
      this.logger.info('Received 401 Unauthorized status');

      let resourceUrl = this.extractResourceUrl(response);
      const calledUrl = OAuthClient.trimToPath(url instanceof URL ? url.toString() : url);
      // If the response indicates an expired token, try to refresh it
      if (response.headers.get('www-authenticate')?.includes('error="invalid_grant"')) {
        this.logger.info(`Response includes invalid_grant error, attempting to refresh token for ${resourceUrl}`);
        let refreshUrl = resourceUrl;
        if (!refreshUrl) {
          this.logger.info(`Refresh: No resource url found in response www-authenticate header, falling back to the called url ${calledUrl} (this could be incorrect if the called server is just proxying back an oauth failure)`);
          refreshUrl = calledUrl;
        }
        const newToken = await this.tryRefreshToken(refreshUrl);
        if(newToken) {
          response = await this._doFetch(url, init);
          resourceUrl = this.extractResourceUrl(response);
        }
      }

      if (response.status === 401) /* still */ {
        // If we couldn't get a valid resourceServerUrl from wwwAuthenticate, use the original URL
        if (!resourceUrl) {
          this.logger.info(`No resource url found in response www-authenticate header, falling back to the called url ${calledUrl} (this could be incorrect if the called server is just proxying back an oauth failure)`);
          resourceUrl = calledUrl;
        }
        const token = await this.getAccessToken(calledUrl);
        this.logger.info(`Throwing OAuthAuthenticationRequiredError for ${calledUrl}, resource: ${resourceUrl}`);
        throw await OAuthAuthenticationRequiredError.create(calledUrl, resourceUrl, token?.accessToken);
      }
    }
  
    return response;
  }

  makeAuthorizationUrl = async (url: string, resourceUrl: string, options?: { spendPermissionToken?: string }): Promise<URL> => {
    resourceUrl = this.normalizeResourceServerUrl(resourceUrl);
    const authorizationServer = await this.getAuthorizationServer(resourceUrl);
    const credentials = await this.getClientCredentials(authorizationServer);
    const pkceValues = await this.generatePKCE(url, resourceUrl);
    const authorizationUrl = new URL(authorizationServer.authorization_endpoint || '');
    authorizationUrl.searchParams.set('client_id', credentials.clientId);
    authorizationUrl.searchParams.set('redirect_uri', credentials.redirectUri);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('code_challenge', pkceValues.codeChallenge);
    authorizationUrl.searchParams.set('code_challenge_method', 'S256');
    authorizationUrl.searchParams.set('state', pkceValues.state);
    // Add resource URL so auth server knows which MCP server this is for
    authorizationUrl.searchParams.set('resource', resourceUrl);
    // Add spend permission token if provided (for ATXP accounts with scoped spend permissions)
    if (options?.spendPermissionToken) {
      authorizationUrl.searchParams.set('spend_permission_token', options.spendPermissionToken);
    }
    return authorizationUrl;
  }

  handleCallback = async (url: string): Promise<void> => {
    this.logger.info(`Handling authorization code callback`)
    this.logger.debug(`Callback URL: ${url}`);

    const callbackUrl = new URL(url);
    const state = callbackUrl.searchParams.get('state');
    
    if (!state) {
      throw new Error('No state parameter found in callback URL');
    }

    // Get the PKCE values and resource server URL from the database using the state
    const pkceValues = await this.db.getPKCEValues(this.userId, state);
    if (!pkceValues) {
      throw new Error(`No PKCE values found for state: ${state}`);
    }
    
    // Get the authorization server configuration
    const authorizationServer = await this.getAuthorizationServer(pkceValues.resourceUrl);

    // Get the client credentials
    const credentials = await this.getClientCredentials(authorizationServer);
    
    // Create the client configuration
    const client: oauth.Client = { 
      client_id: credentials.clientId,
      token_endpoint_auth_method: 'client_secret_post'
    };
    
    // Validate the authorization response
    const authResponse = await oauth.validateAuthResponse(
      authorizationServer,
      client,
      callbackUrl,
      state
    );

    // Exchange the code for tokens
    await this.exchangeCodeForToken(authResponse, pkceValues, authorizationServer);
  }

  override getRegistrationMetadata = async (): Promise<Partial<oauth.OmitSymbolProperties<oauth.Client>>> => {
    const grantTypes = ['authorization_code', 'refresh_token'];
    if (!this.isPublic) {
      grantTypes.push('client_credentials');
    }

    let tokenEndpointAuthMethod = 'none';
    if (!this.isPublic) {
      tokenEndpointAuthMethod = 'client_secret_post';
    }
    
    // Create client metadata for registration
    const clientMetadata = {
      // Required fields for public client
      redirect_uris: [this.callbackUrl], 
      response_types: ['code'], 
      grant_types: grantTypes,
      token_endpoint_auth_method: tokenEndpointAuthMethod,
      client_name: `OAuth Client for ${this.callbackUrl}`,
    };
    return clientMetadata;
  }

  protected generatePKCE = async (url: string, resourceUrl: string): Promise<{
    codeVerifier: string;
    codeChallenge: string;
    state: string;
  }> => {
    resourceUrl = this.normalizeResourceServerUrl(resourceUrl);

    // Generate a random code verifier
    const codeVerifier = oauth.generateRandomCodeVerifier();
    // Calculate the code challenge
    // Use our platform-agnostic crypto implementation
    const codeChallenge = encodeBase64Url(await crypto.digest(
      new TextEncoder().encode(codeVerifier)
    ));
    // Generate a random state
    const state = oauth.generateRandomState();

    // Save the PKCE values in the database
    await this.db.savePKCEValues(this.userId, state, {
      url,
      codeVerifier,
      codeChallenge: codeChallenge!,
      resourceUrl
    });
    
    return { codeVerifier, codeChallenge: codeChallenge!, state };
  }

  protected makeTokenRequestAndClient = async (
    authorizationServer: oauth.AuthorizationServer,
    credentials: ClientCredentials,
    codeVerifier: string,
    authResponse: URLSearchParams
  ): Promise<[Response, oauth.Client]> => {
    const [client, clientAuth] = this.makeOAuthClientAndAuth(credentials);

    const options: oauth.TokenEndpointRequestOptions = {
      [oauth.customFetch]: this.sideChannelFetch,
      [oauth.allowInsecureRequests]: this.allowInsecureRequests
    };

    const response = await oauth.authorizationCodeGrantRequest(
      authorizationServer,
      client,
      clientAuth,
      authResponse,
      credentials.redirectUri,
      codeVerifier, 
      options
    );
    return [response, client];
  }

  protected exchangeCodeForToken = async (
    authResponse: URLSearchParams,
    pkceValues: PKCEValues,
    authorizationServer: oauth.AuthorizationServer
  ): Promise<string> => {
    const { codeVerifier, url, resourceUrl } = pkceValues;
    
    // Get the client credentials
    let credentials = await this.getClientCredentials(authorizationServer);
    let [response, client] = await this.makeTokenRequestAndClient(authorizationServer, credentials, codeVerifier, authResponse);
    if(response.status === 403 || response.status === 401) {
      this.logger.info(`Bad response status exchanging code for token: ${response.statusText}. Could be due to bad client credentials - trying to re-register`);
      credentials = await this.registerClient(authorizationServer);
      [response, client] = await this.makeTokenRequestAndClient(authorizationServer, credentials, codeVerifier, authResponse);
    }

    const result = await oauth.processAuthorizationCodeResponse(
      authorizationServer,
      client,
      response
    );
    
    // Save the access token in the database
    await this.db.saveAccessToken(this.userId, url, {
      resourceUrl,
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      expiresAt: result.expires_in 
        ? Date.now() + result.expires_in * 1000
        : undefined
    });
    
    return result.access_token;
  }

  protected getAccessToken = async (url: string): Promise<AccessToken | null> => {
    // Get the access token from the database
    url = OAuthClient.trimToPath(url);
    let parentPath = OAuthClient.getParentPath(url);
    let tokenData = await this.db.getAccessToken(this.userId, url);
    // If there's no token for the requested path, see if there's one for the parent
    while (!tokenData && parentPath){
      tokenData = await this.db.getAccessToken(this.userId, parentPath);
      parentPath = OAuthClient.getParentPath(parentPath);
    }
    return tokenData;
  }

  protected tryRefreshToken = async (url: string): Promise<AccessToken | null> => {
    url = OAuthClient.trimToPath(url);
    const token = await this.getAccessToken(url);
    if (!token) {
      this.logger.info('No token found, cannot refresh');
      return null;
    }
    if (!token.refreshToken) {
      this.logger.info('No refresh token found, cannot refresh');
      return null;
    }
    const authorizationServer = await this.getAuthorizationServer(token.resourceUrl);
    const credentials = await this.getClientCredentials(authorizationServer);
    const [client, clientAuth] = this.makeOAuthClientAndAuth(credentials);

    const response = await oauth.refreshTokenGrantRequest(
      authorizationServer,
      client,
      clientAuth,
      token.refreshToken,
      {
        [oauth.customFetch]: this.sideChannelFetch,
        [oauth.allowInsecureRequests]: this.allowInsecureRequests
      }
    );

    const result = await oauth.processRefreshTokenResponse(authorizationServer, client, response)
    const at = {
      resourceUrl: token.resourceUrl,
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      expiresAt: result.expires_in 
        ? Date.now() + result.expires_in * 1000
        : undefined
    };
    await this.db.saveAccessToken(this.userId, url, at);
    return at;
  }

  protected _doFetch: FetchLike = async (url, init) => {
    const stringUrl = url instanceof URL ? url.toString() : url;
    this.logger.info(`Making ${init?.method || 'GET'} request to ${stringUrl}`);
    
    const tokenData = await this.getAccessToken(stringUrl);
    if (!tokenData) {
      this.logger.info(`No access token found for resource server ${stringUrl}. Passing no authorization header.`);
    }

    // Create a new init object to avoid mutating the original
    const requestInit: RequestInit = { ...init };
    
    if (tokenData) {
      // Create a new Headers object from existing headers (if any)
      const headers = new Headers(requestInit.headers);
      headers.set('Authorization', `Bearer ${tokenData.accessToken}`);
      requestInit.headers = headers;
    }
    
    // Make the request with the access token
    const response = await this.fetchFn(url, requestInit);
    return response;
  }
}
