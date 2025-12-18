/* eslint-disable @typescript-eslint/no-explicit-any */
import * as oauth from 'oauth4webapi';
import { ClientCredentials, FetchLike, OAuthResourceDb, OAuthDb, TokenData, Logger } from './types.js';
import { ConsoleLogger } from './logger.js';

export interface OAuthResourceClientConfig {
  db: OAuthDb;
  callbackUrl?: string;
  isPublic?: boolean;
  sideChannelFetch?: FetchLike;
  strict?: boolean;
  allowInsecureRequests?: boolean;
  clientName?: string;
  logger?: Logger;
  atxpConnectionToken?: string;
  registrationType?: 'server' | 'client';
}

export class OAuthResourceClient {
  // Deliberately using OAuthResourceDb (a subset of OAuthDb) here, because no
  // internal functionality of this class should rely on OAuthDb methods.
  // However, it's useful to use this class to pass around the DB for other clients,
  // since it's part of the global server context
  protected db: OAuthResourceDb;
  protected allowInsecureRequests: boolean;
  protected callbackUrl: string;
  protected sideChannelFetch: FetchLike;
  protected strict: boolean;
  protected clientName: string;
  // Whether this is a public client, which is incapable of keeping a client secret
  // safe, or a confidential client, which can.
  protected isPublic: boolean;
  protected logger: Logger;
  // In-memory lock to prevent concurrent client registrations
  private registrationLocks = new Map<string, Promise<ClientCredentials>>();
  protected atxpConnectionToken?: string;
  protected registrationType: 'server' | 'client';

  constructor({
    db,
    callbackUrl = 'http://localhost:3000/unused-dummy-global-callback',
    isPublic = false,
    sideChannelFetch = fetch,
    strict = false,
    allowInsecureRequests = process.env.NODE_ENV === 'development',
    clientName = 'Token Introspection Client',
    logger = new ConsoleLogger(),
    atxpConnectionToken,
    registrationType = 'server'
  }: OAuthResourceClientConfig) {
    // Default values above are appropriate for a global client used directly. Subclasses should override these,
    // because things like the callbackUrl will actually be important for them
    this.db = db;
    this.callbackUrl = callbackUrl;
    this.isPublic = isPublic;
    this.sideChannelFetch = sideChannelFetch;
    this.strict = strict;
    this.allowInsecureRequests = allowInsecureRequests;
    this.clientName = clientName;
    this.logger = logger;
    this.atxpConnectionToken = atxpConnectionToken;
    this.registrationType = registrationType;
  }

  static trimToPath = (url: string): string => {
    try {
      const urlObj = new URL(url);
      return `${urlObj.origin}${urlObj.pathname}`;
    } catch (error) {
      // If the URL is invalid, try to construct a valid one
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return `https://${url}`;
      }
      throw error;
    }
  }

  static getParentPath = (url: string): string | null => {
    const urlObj = new URL(url);
    urlObj.pathname = urlObj.pathname.replace(/\/[^/]+$/, '');
    const res = urlObj.toString();
    return res === url ? null : res;
  }

  introspectToken = async (authorizationServerUrl: string, token: string, additionalParameters?: Record<string, string>): Promise<TokenData> => {
    // Don't use getAuthorizationServer here, because we're not using the resource server url
    const authorizationServer = await this.authorizationServerFromUrl(new URL(authorizationServerUrl));
    // When introspecting a token, the "resource" server that we want credentials for is the auth server
    let clientCredentials = await this.getClientCredentials(authorizationServer);

    // Create a client for token introspection
    let client: oauth.Client = {
      client_id: clientCredentials.clientId,
      token_endpoint_auth_method: 'client_secret_basic'
    };
    
    // Create client authentication method
    let clientAuth = oauth.ClientSecretBasic(clientCredentials.clientSecret);
    
    // Use oauth4webapi's built-in token introspection
    let introspectionResponse = await oauth.introspectionRequest(
      authorizationServer,
      client,
      clientAuth,
      token,
      {
        additionalParameters,
        [oauth.customFetch]: this.sideChannelFetch,
        [oauth.allowInsecureRequests]: this.allowInsecureRequests
      }
    );

    if(introspectionResponse.status === 403 || introspectionResponse.status === 401) {
      this.logger.info(`Bad response status doing token introspection: ${introspectionResponse.statusText}. Could be due to bad client credentials - trying to re-register`);
      clientCredentials = await this.registerClient(authorizationServer);
      client = {
        client_id: clientCredentials.clientId,
        token_endpoint_auth_method: 'client_secret_basic'
      };
      clientAuth = oauth.ClientSecretBasic(clientCredentials.clientSecret);
      introspectionResponse = await oauth.introspectionRequest(
        authorizationServer,
        client,
        clientAuth,
        token,
        { 
          additionalParameters, 
          [oauth.customFetch]: this.sideChannelFetch, 
          [oauth.allowInsecureRequests]: this.allowInsecureRequests
        }
      );
    }
    
    if(introspectionResponse.status !== 200) {
      throw new Error(`Token introspection failed with status ${introspectionResponse.status}: ${introspectionResponse.statusText}`);
    }
    
    // Process the introspection response
    const tokenData = await oauth.processIntrospectionResponse(
      authorizationServer,
      client,
      introspectionResponse
    );

    return {
      active: tokenData.active,
      scope: tokenData.scope,
      sub: tokenData.sub,
      aud: tokenData.aud
    };
  }

  getAuthorizationServer = async (resourceServerUrl: string): Promise<oauth.AuthorizationServer> => {
    resourceServerUrl = this.normalizeResourceServerUrl(resourceServerUrl);

    const resourceUrl = new URL(resourceServerUrl);
    let fetchedUrl: string|undefined = undefined;

    const fullPrmUrl = new URL(resourceServerUrl).toString().replace(/\/+$/, '') + '/.well-known/oauth-protected-resource';
    fetchedUrl = fullPrmUrl;
    const prmResponse = await this.sideChannelFetch(fullPrmUrl);

    let authServer: string | undefined = undefined;
    try {
      const fallbackToRsAs = !this.strict && prmResponse.status === 404;

      if (!fallbackToRsAs) {
        const resourceServer = await oauth.processResourceDiscoveryResponse(resourceUrl, prmResponse);
        authServer = resourceServer.authorization_servers?.[0];
      } else {
        // Some older servers serve OAuth metadata from the MCP server instead of PRM data,
        // so if the PRM data isn't found, we'll try to get the AS metadata from the MCP server
        this.logger.info('Protected Resource Metadata document not found, looking for OAuth metadata on resource server');
        // Trim off the path - OAuth metadata is also singular for a server and served from the root
        const rsUrl = new URL(resourceServerUrl);
        const rsAsUrl = rsUrl.origin + '/.well-known/oauth-authorization-server';
        fetchedUrl = rsAsUrl;
        // Don't use oauth4webapi for this, because these servers might be specifiying an issuer that is not
        // themselves (in order to use a separate AS by just hosting the OAuth metadata on the MCP server)
        //   This is against the OAuth spec, but some servers do it anyway
        const rsAsResponse = await this.sideChannelFetch(rsAsUrl);
        if (rsAsResponse.status === 200) {
          const rsAsBody = await rsAsResponse.json();
          authServer = rsAsBody.issuer;
        }
      }

      if (!authServer) {
        throw new Error('No authorization_servers found in protected resource metadata');
      }
    } catch (error) {
      this.logger.warn(`Error fetching authorization server url from PRM doc from ${fetchedUrl}: ${error}`);
      this.logger.warn((error as Error).stack || '');
      throw error;
    }

    const authServerUrl = new URL(authServer);
    const res = await this.authorizationServerFromUrl(authServerUrl);
    return res;
  }

  authorizationServerFromUrl = async (authServerUrl: URL): Promise<oauth.AuthorizationServer> => {
    try {
      // Explicitly throw for a tricky edge case to trigger tests
      if (authServerUrl.toString().includes('/.well-known/oauth-protected-resource')) {
        throw new Error('Authorization server URL is a PRM URL, which is not supported. It must be an AS URL.');
      }

      // Now, get the authorization server metadata
      const response = await oauth.discoveryRequest(authServerUrl, {
        algorithm: 'oauth2',
        [oauth.customFetch]: this.sideChannelFetch,
        [oauth.allowInsecureRequests]: this.allowInsecureRequests
      });
      const authorizationServer = await oauth.processDiscoveryResponse(authServerUrl, response);
      return authorizationServer;
    } catch (error: any) {
      this.logger.warn(`Error fetching authorization server url from ${authServerUrl.toString()}: ${error}`);
      throw error;
    }
  }

  protected normalizeResourceServerUrl = (resourceServerUrl: string): string => {
    // the url might be EITHER:
    // 1. the PRM URL (when it's received from the www-authenticate header or a PRM response conforming to RFC 9728)
    // 2. the resource url itself (when we're using the resource url itself)
    // We standardize on the resource url itself, so that we can store it in the DB and all the rest of the plumbing 
    // doesn't have to worry about the difference between the two.
    const res = resourceServerUrl.replace('/.well-known/oauth-protected-resource', '');
    return res;
  }

  protected getRegistrationMetadata = async (): Promise<Partial<oauth.OmitSymbolProperties<oauth.Client>>> => {
    // Create client metadata for registration
    const clientMetadata = {
      redirect_uris: [this.callbackUrl],
      // We shouldn't actually need any response_types for this client either, but
      // the OAuth spec requires us to provide a response_type
      response_types: ['code'],
      grant_types: ['authorization_code', 'client_credentials'], 
      token_endpoint_auth_method: 'client_secret_basic',
      client_name: this.clientName,
    }; 
    return clientMetadata;
  }

  protected registerClient = async (authorizationServer: oauth.AuthorizationServer): Promise<ClientCredentials> => {
    this.logger.info(`Registering client with authorization server for ${this.callbackUrl}`);
    
    if (!authorizationServer.registration_endpoint) {
      throw new Error('Authorization server does not support dynamic client registration');
    }

    const baseClientMetadata = await this.getRegistrationMetadata();
    const clientMetadata = this.withRegistrationCredentials(baseClientMetadata);
    
    let registeredClient: oauth.Client;
    const withRegistrationHeader: FetchLike = (input, init) => {
      const headers = new Headers(init?.headers ?? undefined);
      headers.set('X-ATXP-Registration-Type', this.registrationType);
      if (this.atxpConnectionToken) {
        headers.set('X-ATXP-TOKEN', this.atxpConnectionToken);
      }
      return this.sideChannelFetch(input, { ...init, headers });
    };

    try {
      // Make the registration request
      const response = await oauth.dynamicClientRegistrationRequest(
        authorizationServer,
        clientMetadata,
        {
          [oauth.customFetch]: withRegistrationHeader,
          [oauth.allowInsecureRequests]: this.allowInsecureRequests
        }
      );

      // Process the registration response
      registeredClient = await oauth.processDynamicClientRegistrationResponse(response);
    } catch (error: any) {
      this.logger.warn(`Client registration failure error_details: ${JSON.stringify(error.cause?.error_details)}`);
      throw error;
    }
    
    this.logger.info(`Successfully registered client with ID: ${registeredClient.client_id}`);
    
    // Create client credentials from the registration response
    const credentials: ClientCredentials = {
      clientId: registeredClient.client_id,
      clientSecret: registeredClient.client_secret?.toString() || '', // Public client has no secret
      redirectUri: this.callbackUrl
    };
    
    // Save the credentials in the database
    await this.db.saveClientCredentials(authorizationServer.issuer, credentials);
    
    return credentials;
  }

  protected withRegistrationCredentials = (
    metadata: Partial<oauth.OmitSymbolProperties<oauth.Client>>
  ): Partial<oauth.OmitSymbolProperties<oauth.Client>> => {
    // Connection tokens are now transmitted via the X-ATXP-TOKEN header
    return metadata;
  }

  protected getClientCredentials = async (authorizationServer: oauth.AuthorizationServer): Promise<ClientCredentials> => {
    let credentials = await this.db.getClientCredentials(authorizationServer.issuer);
    // If no credentials found, register a new client
    if (!credentials) {
      // Check if there's already a registration in progress for this issuer
      const lockKey = authorizationServer.issuer;
      const existingLock = this.registrationLocks.get(lockKey);
      if (existingLock) {
        this.logger.debug(`Waiting for existing client registration for issuer: ${lockKey}`);
        return await existingLock;
      }

      // Create a new registration promise and store it as a lock      
      try {
        const registrationPromise = this.registerClient(authorizationServer);
        this.registrationLocks.set(lockKey, registrationPromise);
  
        credentials = await registrationPromise;
        return credentials;
      } finally {
        // Always clean up the lock when done
        this.registrationLocks.delete(lockKey);
      }
    }
    return credentials;
  }

  protected makeOAuthClientAndAuth = (
    credentials: ClientCredentials
  ): [oauth.Client, oauth.ClientAuth] => {
    // Create the client configuration
    const client: oauth.Client = { 
      client_id: credentials.clientId,
      token_endpoint_auth_method: 'none'
    };
    let clientAuth = oauth.None();
    
    // If the client has a secret, that means it was registered as a confidential client
    // In that case, we should auth to the token endpoint using the client secret as well.
    // In either case (public or confidential), we're also using PKCE
    if (credentials.clientSecret) {
      client.token_endpoint_auth_method = 'client_secret_post';
      // Create the client authentication method
      clientAuth = oauth.ClientSecretPost(credentials.clientSecret);
    }

    return [client, clientAuth];
  }
}
