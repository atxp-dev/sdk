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

  constructor({
    db,
    callbackUrl = 'http://localhost:3000/unused-dummy-global-callback',
    isPublic = false,
    sideChannelFetch = fetch,
    strict = false,
    allowInsecureRequests = process.env.NODE_ENV === 'development',
    clientName = 'Token Introspection Client',
    logger = new ConsoleLogger()
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
    const originalUrl = resourceServerUrl;
    resourceServerUrl = this.normalizeResourceServerUrl(resourceServerUrl);

    this.logger.info(`[DEBUG] getAuthorizationServer called with originalUrl: ${originalUrl}`);
    this.logger.info(`[DEBUG] normalized resourceServerUrl: ${resourceServerUrl}`);

    try {
      const resourceUrl = new URL(resourceServerUrl);
      this.logger.info(`[DEBUG] constructed resourceUrl: ${resourceUrl.toString()}`);

      const fullPrmUrl = `${resourceUrl.toString()}/.well-known/oauth-protected-resource`;
      this.logger.info(`[DEBUG] making resourceDiscoveryRequest to: ${fullPrmUrl}`);
      this.logger.info(`[DEBUG] sideChannelFetch type: ${typeof this.sideChannelFetch}`);
      this.logger.info(`[DEBUG] allowInsecureRequests: ${this.allowInsecureRequests}`);

      // Test direct fetch call to see if it's blocked
      try {
        this.logger.info(`[DEBUG] Testing direct fetch call to: ${fullPrmUrl}`);
        const testResponse = await this.sideChannelFetch(fullPrmUrl);
        this.logger.info(`[DEBUG] Direct fetch test succeeded with status: ${testResponse.status}`);
      } catch (testError) {
        this.logger.warn(`[DEBUG] Direct fetch test failed: ${testError}`);
        this.logger.warn(`[DEBUG] Direct fetch error type: ${testError?.constructor?.name}`);
        this.logger.warn(`[DEBUG] Direct fetch error message: ${(testError as Error)?.message}`);
        if (testError instanceof TypeError && (testError as Error).message.includes('Load failed')) {
          this.logger.warn(`[DEBUG] Direct fetch got "Load failed" - this confirms network blocking`);
        }
      }

      let prmResponse;
      try {
        this.logger.info(`[DEBUG] About to call oauth.resourceDiscoveryRequest with customFetch`);
        prmResponse = await oauth.resourceDiscoveryRequest(resourceUrl, {
          [oauth.customFetch]: this.sideChannelFetch,
          [oauth.allowInsecureRequests]: this.allowInsecureRequests
        });
        this.logger.info(`[DEBUG] resourceDiscoveryRequest response status: ${prmResponse.status}`);
      } catch (prmError) {
        this.logger.warn(`[DEBUG] oauth.resourceDiscoveryRequest failed: ${prmError}`);
        this.logger.warn(`[DEBUG] prmError type: ${prmError?.constructor?.name}`);
        this.logger.warn(`[DEBUG] prmError message: ${(prmError as Error)?.message}`);

        // If oauth4webapi request fails, fall back to our working direct fetch approach
        if ((prmError as Error)?.message?.includes('interrupted by user') ||
            (prmError as Error)?.message?.includes('Load failed')) {
          this.logger.warn(`[DEBUG] oauth4webapi request was blocked, trying direct fetch fallback`);
          try {
            const directResponse = await this.sideChannelFetch(fullPrmUrl);
            this.logger.info(`[DEBUG] Direct fetch fallback status: ${directResponse.status}`);

            // If direct fetch also returns 404, skip processing and go straight to OAuth AS fallback
            if (directResponse.status === 404) {
              this.logger.info(`[DEBUG] Direct fetch returned 404, skipping PRM processing and jumping to OAuth AS fallback`);
              // Skip all processing and go directly to the OAuth AS fallback logic
              const rsUrl = new URL(resourceServerUrl);
              const rsAsUrl = rsUrl.protocol + '//' + rsUrl.host + '/.well-known/oauth-authorization-server';
              this.logger.info(`[DEBUG] Direct fallback: making request to ${rsAsUrl}`);

              try {
                const rsAsResponse = await this.sideChannelFetch(rsAsUrl);
                this.logger.info(`[DEBUG] Direct fallback response status: ${rsAsResponse.status}`);

                if (rsAsResponse.status === 200) {
                  const rsAsBody = await rsAsResponse.json();
                  const authServer = rsAsBody.issuer;
                  this.logger.info(`[DEBUG] Found authServer from direct fallback: ${authServer}`);

                  if (authServer) {
                    const authServerUrl = new URL(authServer);
                    const res = await this.authorizationServerFromUrl(authServerUrl);
                    return res;
                  }
                }

                throw new Error('No authorization_servers found in protected resource metadata');
              } catch (fallbackError) {
                this.logger.warn(`[DEBUG] Direct OAuth AS fallback failed: ${fallbackError}`);
                throw fallbackError;
              }
            } else {
              prmResponse = directResponse;
            }
          } catch (directError) {
            this.logger.warn(`[DEBUG] Direct fetch fallback also failed: ${directError}`);
            throw prmError; // throw original error
          }
        } else {
          throw prmError;
        }
      }

      const fallbackToRsAs = !this.strict && prmResponse.status === 404;
      this.logger.info(`[DEBUG] fallbackToRsAs: ${fallbackToRsAs}, strict: ${this.strict}`);

      let authServer: string | undefined = undefined;
      if (!fallbackToRsAs) {
        this.logger.info('[DEBUG] processing resource discovery response');
        try {
          const resourceServer = await oauth.processResourceDiscoveryResponse(resourceUrl, prmResponse);
          authServer = resourceServer.authorization_servers?.[0];
          this.logger.info(`[DEBUG] found authServer from PRM: ${authServer}`);
        } catch (processError) {
          this.logger.warn(`[DEBUG] processResourceDiscoveryResponse failed: ${processError}`);
          throw processError;
        }
      } else {
        // Some older servers serve OAuth metadata from the MCP server instead of PRM data,
        // so if the PRM data isn't found, we'll try to get the AS metadata from the MCP server
        this.logger.info('Protected Resource Metadata document not found, looking for OAuth metadata on resource server');
        // Trim off the path - OAuth metadata is also singular for a server and served from the root
        const rsUrl = new URL(resourceServerUrl);
        const rsAsUrl = rsUrl.protocol + '//' + rsUrl.host + '/.well-known/oauth-authorization-server';
        this.logger.info(`[DEBUG] fallback: making request to ${rsAsUrl}`);
        // Don't use oauth4webapi for this, because these servers might be specifiying an issuer that is not
        // themselves (in order to use a separate AS by just hosting the OAuth metadata on the MCP server)
        //   This is against the OAuth spec, but some servers do it anyway
        try {
          const rsAsResponse = await this.sideChannelFetch(rsAsUrl);
          this.logger.info(`[DEBUG] fallback response status: ${rsAsResponse.status}`);
          if (rsAsResponse.status === 200) {
            const rsAsBody = await rsAsResponse.json();
            authServer = rsAsBody.issuer;
            this.logger.info(`[DEBUG] found authServer from fallback: ${authServer}`);
          } else {
            this.logger.info(`[DEBUG] fallback request failed with status ${rsAsResponse.status}: ${rsAsResponse.statusText}`);
          }
        } catch (fallbackError) {
          this.logger.warn(`[DEBUG] fallback request threw error: ${fallbackError}`);
          this.logger.warn(`[DEBUG] fallback error type: ${fallbackError?.constructor?.name}`);
          this.logger.warn(`[DEBUG] fallback error message: ${(fallbackError as Error)?.message}`);
          if (fallbackError instanceof TypeError && (fallbackError as Error).message.includes('Load failed')) {
            this.logger.warn(`[DEBUG] This is the "Load failed" error we're debugging - URL was: ${rsAsUrl}`);
          }
        }
      }

      if (!authServer) {
        this.logger.warn(`[DEBUG] No authorization server found. PRM response status: ${prmResponse.status}, fallback attempted: ${fallbackToRsAs}`);
        throw new Error('No authorization_servers found in protected resource metadata');
      }

      this.logger.info(`[DEBUG] proceeding with authServer: ${authServer}`);
      const authServerUrl = new URL(authServer);
      const res = await this.authorizationServerFromUrl(authServerUrl);
      return res;
    } catch (error) {
      this.logger.warn(`Error fetching authorization server configuration: ${error}`);
      this.logger.warn(`[DEBUG] Error type: ${error?.constructor?.name}`);
      this.logger.warn(`[DEBUG] Error message: ${(error as Error)?.message}`);
      this.logger.warn(`[DEBUG] Original resourceServerUrl: ${originalUrl}`);
      this.logger.warn(`[DEBUG] Normalized resourceServerUrl: ${resourceServerUrl}`);
      if (error instanceof TypeError && (error as Error).message.includes('Load failed')) {
        this.logger.warn(`[DEBUG] This is the "Load failed" TypeError we're debugging!`);
      }
      this.logger.warn((error as Error).stack || '');
      throw error;
    }
  }

  authorizationServerFromUrl = async (authServerUrl: URL): Promise<oauth.AuthorizationServer> => {
    this.logger.info(`[DEBUG] authorizationServerFromUrl called with: ${authServerUrl.toString()}`);

    try {
      // Explicitly throw for a tricky edge case to trigger tests
      if (authServerUrl.toString().includes('/.well-known/oauth-protected-resource')) {
        throw new Error('Authorization server URL is a PRM URL, which is not supported. It must be an AS URL.');
      }

      // Construct the discovery URL
      const discoveryUrl = `${authServerUrl.toString()}/.well-known/oauth-authorization-server`;
      this.logger.info(`[DEBUG] making OAuth discovery request to: ${discoveryUrl}`);

      // Now, get the authorization server metadata
      try {
        const response = await oauth.discoveryRequest(authServerUrl, {
          algorithm: 'oauth2',
          [oauth.customFetch]: this.sideChannelFetch,
          [oauth.allowInsecureRequests]: this.allowInsecureRequests
        });
        this.logger.info(`[DEBUG] OAuth discovery response status: ${response.status}`);
        if (response.status !== 200) {
          this.logger.warn(`[DEBUG] OAuth discovery failed with status ${response.status}: ${response.statusText}`);
        }

        const authorizationServer = await oauth.processDiscoveryResponse(authServerUrl, response);
        this.logger.info(`[DEBUG] successfully processed discovery response, issuer: ${authorizationServer.issuer}`);
        return authorizationServer;
      } catch (discoveryError) {
        this.logger.warn(`[DEBUG] OAuth discovery request threw error: ${discoveryError}`);
        this.logger.warn(`[DEBUG] discovery error type: ${discoveryError?.constructor?.name}`);
        this.logger.warn(`[DEBUG] discovery error message: ${(discoveryError as Error)?.message}`);
        if (discoveryError instanceof TypeError && (discoveryError as Error).message.includes('Load failed')) {
          this.logger.warn(`[DEBUG] This is the "Load failed" error in OAuth discovery - URL was: ${discoveryUrl}`);
        }
        throw discoveryError;
      }
    } catch (error: any) {
      this.logger.warn(`Error fetching authorization server configuration: ${error}`);
      this.logger.warn(`[DEBUG] authServerUrl was: ${authServerUrl.toString()}`);
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

    const clientMetadata = await this.getRegistrationMetadata();
    
    let registeredClient: oauth.Client;
    try {
      // Make the registration request
      const response = await oauth.dynamicClientRegistrationRequest(
        authorizationServer,
        clientMetadata,
        {
          [oauth.customFetch]: this.sideChannelFetch,
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