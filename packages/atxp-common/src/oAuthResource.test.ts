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