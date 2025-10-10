import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OAuthResourceClient } from './oAuthResource.js';
import { MemoryOAuthDb } from './memoryOAuthDb.js';
import { ClientCredentials, Logger } from './types.js';

// Mock fetch to avoid actual network calls
const mockFetch = vi.fn();

// Mock authorization server
const mockAuthServer = {
  issuer: 'https://auth.atxp.ai',
  authorization_endpoint: 'https://auth.atxp.ai/authorize',
  token_endpoint: 'https://auth.atxp.ai/token',
  introspection_endpoint: 'https://auth.atxp.ai/introspect',
  registration_endpoint: 'https://auth.atxp.ai/register'
};

// Mock client credentials response
const mockClientCredentials: ClientCredentials = {
  clientId: 'test-client-id-123',
  clientSecret: 'test-client-secret-456',
  redirectUri: 'http://localhost:3000/unused-dummy-global-callback'
};

// Mock logger to capture logs
const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
};

describe('OAuthResourceClient Race Condition Fix', () => {
  let db: MemoryOAuthDb;
  let client: OAuthResourceClient;
  let registrationCallCount: number;

  beforeEach(() => {
    vi.clearAllMocks();
    registrationCallCount = 0;
    
    db = new MemoryOAuthDb({ logger: mockLogger });
    client = new OAuthResourceClient({
      db,
      sideChannelFetch: mockFetch,
      logger: mockLogger,
      allowInsecureRequests: true
    });

    // Mock the registerClient method to track calls
    (client as any).registerClient = vi.fn().mockImplementation(async (authServer) => {
      registrationCallCount++;
      mockLogger.info(`Registration call #${registrationCallCount} for ${authServer.issuer}`);
      
      // Simulate some async work (like a real HTTP request)
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Return mock credentials and save them to DB
      await db.saveClientCredentials(authServer.issuer, mockClientCredentials);
      return mockClientCredentials;
    });
  });

  it('should prevent concurrent client registrations for the same issuer', async () => {
    // Ensure no client credentials exist initially
    const initialCredentials = await db.getClientCredentials(mockAuthServer.issuer);
    expect(initialCredentials).toBeNull();

    // Simulate 5 concurrent requests for client credentials
    const concurrentRequests = Array.from({ length: 5 }, () =>
      (client as any).getClientCredentials(mockAuthServer)
    );

    // Wait for all requests to complete
    const results = await Promise.all(concurrentRequests);

    // All requests should return the same credentials
    results.forEach(credentials => {
      expect(credentials).toEqual(mockClientCredentials);
    });

    // Most importantly: registerClient should only be called ONCE despite 5 concurrent requests
    expect(registrationCallCount).toBe(1);
    expect((client as any).registerClient).toHaveBeenCalledTimes(1);

    // Verify that the "waiting for existing registration" log was called
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining('Waiting for existing client registration for issuer: https://auth.atxp.ai')
    );

    // Verify credentials are properly stored in database
    const storedCredentials = await db.getClientCredentials(mockAuthServer.issuer);
    expect(storedCredentials).toEqual(mockClientCredentials);
  });

  it('should handle multiple different issuers correctly', async () => {
    const authServer1 = { ...mockAuthServer, issuer: 'https://auth1.example.com' };
    const authServer2 = { ...mockAuthServer, issuer: 'https://auth2.example.com' };

    // Concurrent requests for different issuers should each register once
    const requests = [
      (client as any).getClientCredentials(authServer1),
      (client as any).getClientCredentials(authServer1), // Duplicate for auth1
      (client as any).getClientCredentials(authServer2),
      (client as any).getClientCredentials(authServer2)  // Duplicate for auth2
    ];

    await Promise.all(requests);

    // Should register exactly twice (once per unique issuer)
    expect(registrationCallCount).toBe(2);
    expect((client as any).registerClient).toHaveBeenCalledTimes(2);
  });

  it('should reuse existing credentials without registration', async () => {
    // Pre-populate credentials in the database
    await db.saveClientCredentials(mockAuthServer.issuer, mockClientCredentials);

    // Multiple concurrent requests
    const concurrentRequests = Array.from({ length: 3 }, () =>
      (client as any).getClientCredentials(mockAuthServer)
    );

    const results = await Promise.all(concurrentRequests);

    // All should return existing credentials
    results.forEach(credentials => {
      expect(credentials).toEqual(mockClientCredentials);
    });

    // registerClient should never be called since credentials already exist
    expect(registrationCallCount).toBe(0);
    expect((client as any).registerClient).not.toHaveBeenCalled();
  });

  it('should clean up registration locks after completion', async () => {
    // Get credentials (which should trigger registration)
    const credentials = await (client as any).getClientCredentials(mockAuthServer);
    expect(credentials).toEqual(mockClientCredentials);

    // Verify the lock is cleaned up by checking that the map is empty
    const locks = (client as any).registrationLocks;
    expect(locks.size).toBe(0);

    // Subsequent request should reuse stored credentials
    const credentials2 = await (client as any).getClientCredentials(mockAuthServer);
    expect(credentials2).toEqual(mockClientCredentials);
    expect(registrationCallCount).toBe(1); // Should still be only 1
  });

  it('should clean up locks even if registration fails', async () => {
    // Mock registerClient to throw an error
    (client as any).registerClient = vi.fn().mockRejectedValue(new Error('Registration failed'));

    // Try to get credentials
    await expect(
      (client as any).getClientCredentials(mockAuthServer)
    ).rejects.toThrow('Registration failed');

    // Verify the lock is still cleaned up even after failure
    const locks = (client as any).registrationLocks;
    expect(locks.size).toBe(0);
  });
});

// Mock oauth4webapi at the top level
vi.mock('oauth4webapi', () => ({
  resourceDiscoveryRequest: vi.fn(),
  processResourceDiscoveryResponse: vi.fn(),
  discoveryRequest: vi.fn(),
  processDiscoveryResponse: vi.fn(),
  customFetch: Symbol('customFetch'),
  allowInsecureRequests: Symbol('allowInsecureRequests'),
}));

describe('OAuthResourceClient URL normalization and fallback', () => {
  let client: OAuthResourceClient;
  let db: MemoryOAuthDb;
  let mockFetch: any;
  let mockOAuth: any;

  beforeEach(async () => {
    mockFetch = vi.fn();
    db = new MemoryOAuthDb();
    client = new OAuthResourceClient({
      db,
      sideChannelFetch: mockFetch,
      allowInsecureRequests: true,
      logger: mockLogger
    });

    // Get the mocked oauth4webapi module
    mockOAuth = await import('oauth4webapi');
    vi.clearAllMocks();
  });

  describe('URL normalization', () => {
    it('should remove trailing slashes to prevent double slashes', async () => {
      const resourceServerUrl = 'https://image.mcp.atxp.ai/';

      // Mock oauth4webapi call to be interrupted (simulate mobile blocking)
      mockOAuth.resourceDiscoveryRequest.mockRejectedValue(
        new Error('Request interrupted by user')
      );

      // Mock successful direct fetch fallback returning 404 to trigger OAuth AS fallback
      mockFetch
        .mockResolvedValueOnce({
          status: 404,
          json: async () => ({}),
        }) // Direct PRM fetch
        .mockResolvedValueOnce({
          status: 200,
          json: async () => ({
            issuer: 'https://auth.atxp.ai'
          }),
        }); // OAuth AS fallback

      // Mock authorizationServerFromUrl
      vi.spyOn(client, 'authorizationServerFromUrl').mockResolvedValue(mockAuthServer);

      await client.getAuthorizationServer(resourceServerUrl);

      // Verify URLs called don't have double slashes
      const fetchCalls = mockFetch.mock.calls;

      // Direct PRM fetch call
      expect(fetchCalls[0][0]).toBe('https://image.mcp.atxp.ai/.well-known/oauth-protected-resource');

      // OAuth AS fallback call
      expect(fetchCalls[1][0]).toBe('https://image.mcp.atxp.ai/.well-known/oauth-authorization-server');
    });

    it('should handle multiple trailing slashes correctly', async () => {
      const resourceServerUrl = 'https://image.mcp.atxp.ai////';

      mockOAuth.resourceDiscoveryRequest.mockRejectedValue(
        new Error('Request interrupted by user')
      );

      mockFetch
        .mockResolvedValueOnce({ status: 404, json: async () => ({}) }) // Direct PRM fetch
        .mockResolvedValueOnce({
          status: 200,
          json: async () => ({ issuer: 'https://auth.atxp.ai' })
        }); // OAuth AS

      vi.spyOn(client, 'authorizationServerFromUrl').mockResolvedValue(mockAuthServer);

      await client.getAuthorizationServer(resourceServerUrl);

      // Should normalize multiple trailing slashes
      expect(mockFetch.mock.calls[0][0]).toBe('https://image.mcp.atxp.ai/.well-known/oauth-protected-resource');
      expect(mockFetch.mock.calls[1][0]).toBe('https://image.mcp.atxp.ai/.well-known/oauth-authorization-server');
    });

    it('should handle URLs without trailing slashes correctly', async () => {
      const resourceServerUrl = 'https://image.mcp.atxp.ai';

      mockOAuth.resourceDiscoveryRequest.mockRejectedValue(
        new Error('Request interrupted by user')
      );

      mockFetch
        .mockResolvedValueOnce({ status: 404, json: async () => ({}) })
        .mockResolvedValueOnce({
          status: 200,
          json: async () => ({ issuer: 'https://auth.atxp.ai' })
        });

      vi.spyOn(client, 'authorizationServerFromUrl').mockResolvedValue(mockAuthServer);

      await client.getAuthorizationServer(resourceServerUrl);

      // Should add single slash correctly
      expect(mockFetch.mock.calls[0][0]).toBe('https://image.mcp.atxp.ai/.well-known/oauth-protected-resource');
      expect(mockFetch.mock.calls[1][0]).toBe('https://image.mcp.atxp.ai/.well-known/oauth-authorization-server');
    });
  });

  describe('Farcaster mobile fallback', () => {
    it('should handle "Request interrupted by user" error', async () => {
      const resourceServerUrl = 'https://image.mcp.atxp.ai';

      mockOAuth.resourceDiscoveryRequest.mockRejectedValue(
        new Error('Request interrupted by user')
      );

      mockFetch
        .mockResolvedValueOnce({ status: 404, json: async () => ({}) }) // Direct PRM fetch
        .mockResolvedValueOnce({
          status: 200,
          json: async () => ({ issuer: 'https://auth.atxp.ai' })
        }); // OAuth AS success

      vi.spyOn(client, 'authorizationServerFromUrl').mockResolvedValue(mockAuthServer);

      const result = await client.getAuthorizationServer(resourceServerUrl);

      expect(result).toEqual(mockAuthServer);
    });

    it('should handle "Load failed" error', async () => {
      const resourceServerUrl = 'https://image.mcp.atxp.ai';

      mockOAuth.resourceDiscoveryRequest.mockRejectedValue(
        new TypeError('Load failed')
      );

      mockFetch
        .mockResolvedValueOnce({ status: 404, json: async () => ({}) })
        .mockResolvedValueOnce({
          status: 200,
          json: async () => ({ issuer: 'https://auth.atxp.ai' })
        });

      vi.spyOn(client, 'authorizationServerFromUrl').mockResolvedValue(mockAuthServer);

      const result = await client.getAuthorizationServer(resourceServerUrl);

      expect(result).toEqual(mockAuthServer);
    });

    it('should fall through when oauth4webapi succeeds', async () => {
      const resourceServerUrl = 'https://image.mcp.atxp.ai';

      // Mock oauth4webapi succeeding with a 404 (triggering normal fallback path)
      const mockResponse = { status: 404, json: async () => ({}) };
      mockOAuth.resourceDiscoveryRequest.mockResolvedValue(mockResponse as any);

      // Mock the normal OAuth AS fallback path
      mockFetch.mockResolvedValueOnce({
        status: 200,
        json: async () => ({ issuer: 'https://auth.atxp.ai' })
      });

      vi.spyOn(client, 'authorizationServerFromUrl').mockResolvedValue(mockAuthServer);

      const result = await client.getAuthorizationServer(resourceServerUrl);

      expect(result).toEqual(mockAuthServer);
    });

    it('should throw error when both oauth4webapi and direct fetch fail', async () => {
      const resourceServerUrl = 'https://image.mcp.atxp.ai';

      const originalError = new Error('Request interrupted by user');
      mockOAuth.resourceDiscoveryRequest.mockRejectedValue(originalError);

      mockFetch.mockRejectedValue(new Error('Direct fetch also failed'));

      await expect(client.getAuthorizationServer(resourceServerUrl)).rejects.toThrow('Request interrupted by user');
    });
  });

  describe('OAuth AS fallback success scenarios', () => {
    it('should successfully discover authorization server via fallback', async () => {
      const resourceServerUrl = 'https://image.mcp.atxp.ai';

      mockOAuth.resourceDiscoveryRequest.mockRejectedValue(
        new Error('Request interrupted by user')
      );

      mockFetch
        .mockResolvedValueOnce({ status: 404, json: async () => ({}) }) // Direct PRM fetch
        .mockResolvedValueOnce({
          status: 200,
          json: async () => ({
            issuer: 'https://auth.atxp.ai',
            authorization_endpoint: 'https://auth.atxp.ai/authorize'
          })
        }); // OAuth AS success

      vi.spyOn(client, 'authorizationServerFromUrl').mockResolvedValue(mockAuthServer);

      const result = await client.getAuthorizationServer(resourceServerUrl);

      expect(result).toEqual(mockAuthServer);
    });
  });
});

describe('Developer Token in Registration Metadata', () => {
  let db: MemoryOAuthDb;
  let client: OAuthResourceClient;
  let mockFetch: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    db = new MemoryOAuthDb({ logger: mockLogger });
  });

  it('should include developer token in registration metadata when provided', async () => {
    const atxpDeveloperToken = 'atxp_dev_test123456789';

    client = new OAuthResourceClient({
      db,
      sideChannelFetch: mockFetch,
      logger: mockLogger,
      allowInsecureRequests: true,
      atxpDeveloperToken: atxpDeveloperToken
    });

    // Access the protected method to get registration metadata
    const metadata = await (client as any).getRegistrationMetadata();

    // Verify developer token is included
    expect(metadata.atxp_developer_token).toBe(atxpDeveloperToken);

    // Verify other required fields are still present
    expect(metadata.client_name).toBeDefined();
    expect(metadata.redirect_uris).toBeDefined();
    expect(metadata.response_types).toContain('code');
    expect(metadata.grant_types).toContain('authorization_code');
  });

  it('should not include developer token when not provided', async () => {
    client = new OAuthResourceClient({
      db,
      sideChannelFetch: mockFetch,
      logger: mockLogger,
      allowInsecureRequests: true
      // No developer token provided
    });

    const metadata = await (client as any).getRegistrationMetadata();

    // Verify developer token is NOT included
    expect(metadata.atxp_developer_token).toBeUndefined();

    // Verify other fields are still present
    expect(metadata.client_name).toBeDefined();
    expect(metadata.redirect_uris).toBeDefined();
  });

  it('should consistently include developer token across multiple registrations', async () => {
    const atxpDeveloperToken = 'atxp_dev_consistent_token';

    client = new OAuthResourceClient({
      db,
      sideChannelFetch: mockFetch,
      logger: mockLogger,
      allowInsecureRequests: true,
      atxpDeveloperToken: atxpDeveloperToken
    });

    // Get metadata multiple times
    const metadata1 = await (client as any).getRegistrationMetadata();
    const metadata2 = await (client as any).getRegistrationMetadata();
    const metadata3 = await (client as any).getRegistrationMetadata();

    // Verify token is consistently included
    expect(metadata1.atxp_developer_token).toBe(atxpDeveloperToken);
    expect(metadata2.atxp_developer_token).toBe(atxpDeveloperToken);
    expect(metadata3.atxp_developer_token).toBe(atxpDeveloperToken);

    // Verify it's the same token each time
    expect(metadata1.atxp_developer_token).toBe(metadata2.atxp_developer_token);
    expect(metadata2.atxp_developer_token).toBe(metadata3.atxp_developer_token);
  });

  // Note: Logging tests removed as logging is not currently implemented in the source code
  // These can be added back once logging functionality is added to getRegistrationMetadata()
});