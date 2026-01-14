import { describe, it, expect } from 'vitest';
import { ATXPPaymentServer } from './paymentServer.js';
import * as TH from './serverTestHelpers.js';
import fetchMock from 'fetch-mock';
import { MemoryOAuthDb, AuthorizationServerUrl } from '@atxp/common';

// Helper to create OAuthDb with credentials stored
async function createOAuthDbWithCredentials(server: AuthorizationServerUrl, clientId: string, clientSecret: string): Promise<MemoryOAuthDb> {
  const db = new MemoryOAuthDb();
  await db.saveClientCredentials(server, { clientId, clientSecret });
  return db;
}

describe('ATXPPaymentServer', () => {
  it('should call the charge endpoint with client credentials', async () => {
    const mock = fetchMock.createInstance();
    mock.post('https://auth.atxp.ai/charge', {
      status: 200,
      body: { success: true }
    });

    // Create OAuthDb with credentials
    const oAuthDb = await createOAuthDbWithCredentials('https://auth.atxp.ai', 'test-client-id', 'test-client-secret');

    // Create server instance with credentials
    const server = new ATXPPaymentServer('https://auth.atxp.ai', TH.logger(), mock.fetchHandler, oAuthDb);

    const chargeParams = TH.charge({
      sourceAccountId: 'solana:test-source',
      destinationAccountId: 'solana:test-destination'
    });

    const result = await server.charge(chargeParams);

    // Verify the result
    expect(result).toBe(true);

    // Verify fetch was called with correct parameters including auth header
    const call = mock.callHistory.lastCall('https://auth.atxp.ai/charge');
    expect(call).toBeDefined();
    expect(call?.options.method).toBe('post');

    // Verify Authorization header is present with Basic auth
    const expectedCredentials = Buffer.from('test-client-id:test-client-secret').toString('base64');
    expect((call?.options.headers as Record<string, string>)?.['authorization']).toBe(`Basic ${expectedCredentials}`);

    const parsedBody = JSON.parse(call?.options.body as string);
    expect(parsedBody.sourceAccountId).toEqual(chargeParams.sourceAccountId);
    expect(parsedBody.destinationAccountId).toEqual(chargeParams.destinationAccountId);
    expect(parsedBody.options).toBeDefined();
    expect(parsedBody.options[0].amount).toEqual(chargeParams.options[0].amount.toString());
  });

  it('should throw error when credentials are not configured', async () => {
    const mock = fetchMock.createInstance();
    mock.post('https://auth.atxp.ai/charge', {
      status: 200,
      body: { success: true }
    });

    // Create server instance WITHOUT credentials (empty MemoryOAuthDb)
    const server = new ATXPPaymentServer('https://auth.atxp.ai', TH.logger(), mock.fetchHandler);

    await expect(server.charge(TH.charge({
      sourceAccountId: 'solana:test-source',
      destinationAccountId: 'solana:test-destination'
    }))).rejects.toThrow('Missing client credentials');
  });

  it('should call the create payment request endpoint with credentials', async () => {
    const mock = fetchMock.createInstance();
    mock.post('https://auth.atxp.ai/payment-request', {
      status: 200,
      body: { id: 'test-payment-request-id' }
    });

    const oAuthDb = await createOAuthDbWithCredentials('https://auth.atxp.ai', 'test-client-id', 'test-client-secret');
    const server = new ATXPPaymentServer('https://auth.atxp.ai', TH.logger(), mock.fetchHandler, oAuthDb);

    const paymentRequestParams = TH.charge({
      sourceAccountId: 'solana:test-source',
      destinationAccountId: 'solana:test-destination'
    });

    const result = await server.createPaymentRequest(paymentRequestParams);

    // Verify the result
    expect(result).toBe('test-payment-request-id');

    // Verify fetch was called with correct parameters including auth header
    const call = mock.callHistory.lastCall('https://auth.atxp.ai/payment-request');
    expect(call).toBeDefined();
    expect(call?.options.method).toBe('post');

    // Verify Authorization header is present
    const expectedCredentials = Buffer.from('test-client-id:test-client-secret').toString('base64');
    expect((call?.options.headers as Record<string, string>)?.['authorization']).toBe(`Basic ${expectedCredentials}`);

    const parsedBody = JSON.parse(call?.options.body as string);
    expect(parsedBody.sourceAccountId).toEqual(paymentRequestParams.sourceAccountId);
    expect(parsedBody.destinationAccountId).toEqual(paymentRequestParams.destinationAccountId);
    expect(parsedBody.options).toBeDefined();
  });

  it('should handle charge endpoint returning 202 status (async payment accepted)', async () => {
    const mock = fetchMock.createInstance();
    mock.post('https://auth.atxp.ai/charge', {
      status: 202,
      body: {
        success: true,
        pending: true,
        paymentRequestId: 'async-payment-123'
      }
    });

    const oAuthDb = await createOAuthDbWithCredentials('https://auth.atxp.ai', 'test-client-id', 'test-client-secret');
    const server = new ATXPPaymentServer('https://auth.atxp.ai', TH.logger(), mock.fetchHandler, oAuthDb);

    const result = await server.charge(TH.charge({
      sourceAccountId: 'solana:test-source',
      destinationAccountId: 'solana:test-destination'
    }));

    // Verify the result indicates payment accepted (returns true)
    expect(result).toBe(true);
  });

  it('should handle charge endpoint returning 402 status (payment required)', async () => {
    const mock = fetchMock.createInstance();
    mock.post('https://auth.atxp.ai/charge', {
      status: 402,
      body: {
        sourceAccountId: 'solana:test-source',
        destinationAccountId: 'solana:test-destination',
        shortage: '0.01'
      }
    });

    const oAuthDb = await createOAuthDbWithCredentials('https://auth.atxp.ai', 'test-client-id', 'test-client-secret');
    const server = new ATXPPaymentServer('https://auth.atxp.ai', TH.logger(), mock.fetchHandler, oAuthDb);

    const result = await server.charge(TH.charge({
      sourceAccountId: 'solana:test-source',
      destinationAccountId: 'solana:test-destination'
    }));

    // Verify the result indicates payment required (returns false)
    expect(result).toBe(false);
  });

  it('should throw error for unexpected status codes from charge endpoint', async () => {
    const mock = fetchMock.createInstance();
    mock.post('https://auth.atxp.ai/charge', {
      status: 500,
      body: { error: 'server error' }
    });

    const oAuthDb = await createOAuthDbWithCredentials('https://auth.atxp.ai', 'test-client-id', 'test-client-secret');
    const server = new ATXPPaymentServer('https://auth.atxp.ai', TH.logger(), mock.fetchHandler, oAuthDb);

    await expect(server.charge(TH.charge({
      sourceAccountId: 'solana:test-source',
      destinationAccountId: 'solana:test-destination'
    }))).rejects.toThrow('Payment server returned 500 from /charge');
  });

  it('should throw error for non-200 status from payment request endpoint', async () => {
    const mock = fetchMock.createInstance();
    mock.post('https://auth.atxp.ai/payment-request', {
      status: 400,
      body: { error: 'bad request' }
    });

    const oAuthDb = await createOAuthDbWithCredentials('https://auth.atxp.ai', 'test-client-id', 'test-client-secret');
    const server = new ATXPPaymentServer('https://auth.atxp.ai', TH.logger(), mock.fetchHandler, oAuthDb);

    await expect(server.createPaymentRequest(TH.charge({
      sourceAccountId: 'solana:test-source',
      destinationAccountId: 'solana:test-destination'
    }))).rejects.toThrow('Payment server returned 400 from /payment-request');
  });

  it('should throw error if payment request response lacks id field', async () => {
    const mock = fetchMock.createInstance();
    mock.post('https://auth.atxp.ai/payment-request', {
      status: 200,
      body: { success: true } // Missing 'id' field
    });

    const oAuthDb = await createOAuthDbWithCredentials('https://auth.atxp.ai', 'test-client-id', 'test-client-secret');
    const server = new ATXPPaymentServer('https://auth.atxp.ai', TH.logger(), mock.fetchHandler, oAuthDb);

    await expect(server.createPaymentRequest(TH.charge({
      sourceAccountId: 'solana:test-source',
      destinationAccountId: 'solana:test-destination'
    }))).rejects.toThrow('POST /payment-request response did not contain an id');
  });
});