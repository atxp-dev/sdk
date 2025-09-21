import { describe, it, expect } from 'vitest';
import { ATXPPaymentServer } from './paymentServer.js';
import * as TH from './serverTestHelpers.js';
import fetchMock from 'fetch-mock';

describe('ATXPPaymentServer', () => {
  it('should call the charge endpoint', async () => {
    const mock = fetchMock.createInstance();
    mock.post('https://auth.atxp.ai/charge', {
      status: 200,
      body: { success: true }
    });

    // Create server instance
    const server = new ATXPPaymentServer('https://auth.atxp.ai', TH.logger(), mock.fetchHandler);
    
    const chargeParams = TH.charge({
      source: 'test-source',
      destination: 'test-destination'
    });

    const result = await server.charge(chargeParams);

    // Verify the result
    expect(result).toEqual({ success: true, requiredPayment: null });

    // Verify fetch was called with correct parameters
    const call = mock.callHistory.lastCall('https://auth.atxp.ai/charge');
    expect(call).toBeDefined();
    expect(call?.options.method).toBe('post');
    expect(call?.options.headers).toEqual({
      'content-type': 'application/json'
    });
    const parsedBody = JSON.parse(call?.options.body as string);
    expect(parsedBody).toEqual({
      ...chargeParams,
      amount: chargeParams?.amount?.toString()
    });

    // Credentials were fetched from the real database
  });

  it('should make requests without authorization headers', async () => {
    const mock = fetchMock.createInstance();
    mock.post('https://auth.atxp.ai/charge', {
      status: 200,
      body: { success: true }
    });

    const server = new ATXPPaymentServer('https://auth.atxp.ai', TH.logger(), mock.fetchHandler);
    
    await server.charge(TH.charge({
      source: 'test-source',
      destination: 'test-destination'
    }));

    // Verify no authorization header is included
    const call = mock.callHistory.lastCall('https://auth.atxp.ai/charge');
    expect((call?.options?.headers as any)?.['authorization']).toBeUndefined();
  });

  it('should call the create payment request endpoint', async () => {
    const mock = fetchMock.createInstance();
    mock.post('https://auth.atxp.ai/payment-request', {
      status: 200,
      body: { id: 'test-payment-request-id' }
    });

    const server = new ATXPPaymentServer('https://auth.atxp.ai', TH.logger(), mock.fetchHandler);
    
    const paymentRequestParams = {
      ...TH.charge({
        source: 'test-source',
        destination: 'test-destination'
      })
    };

    const result = await server.createPaymentRequest(paymentRequestParams);

    // Verify the result
    expect(result).toBe('test-payment-request-id');

    // Verify fetch was called with correct parameters
    const call = mock.callHistory.lastCall('https://auth.atxp.ai/payment-request');
    expect(call).toBeDefined();
    expect(call?.options.method).toBe('post');
    expect(call?.options.headers).toEqual({
      'content-type': 'application/json'
    });
    const parsedBody = JSON.parse(call?.options.body as string);
    expect(parsedBody).toMatchObject({
      ...paymentRequestParams,
      amount: paymentRequestParams.amount?.toString()
    });
  });

  it('should make payment request without authorization headers', async () => {
    const mock = fetchMock.createInstance();
    mock.post('https://auth.atxp.ai/payment-request', {
      status: 200,
      body: { id: 'test-payment-request-id' }
    });

    const server = new ATXPPaymentServer('https://auth.atxp.ai', TH.logger(), mock.fetchHandler);
    
    await server.createPaymentRequest({
      ...TH.charge({
        source: 'test-source',
        destination: 'test-destination'
      })
    });

    // Verify no authorization header is included
    const call = mock.callHistory.lastCall('https://auth.atxp.ai/payment-request');
    expect((call?.options?.headers as any)?.['authorization']).toBeUndefined();
  });

  it('should handle charge endpoint returning 402 status (payment required)', async () => {
    const mock = fetchMock.createInstance();
    mock.post('https://auth.atxp.ai/charge', {
      status: 402,
      body: { 
        id: 'payment-request-id',
        url: 'https://auth.atxp.ai/payment/payment-request-id'
      }
    });

    const server = new ATXPPaymentServer('https://auth.atxp.ai', TH.logger(), mock.fetchHandler);
    
    const result = await server.charge(TH.charge({
      source: 'test-source',
      destination: 'test-destination'
    }));

    // Verify the result indicates payment required
    expect(result).toEqual({ 
      success: false, 
      requiredPayment: { 
        id: 'payment-request-id',
        url: 'https://auth.atxp.ai/payment/payment-request-id'
      }
    });
  });

  it('should throw error for unexpected status codes from charge endpoint', async () => {
    const mock = fetchMock.createInstance();
    mock.post('https://auth.atxp.ai/charge', {
      status: 500,
      body: { error: 'server error' }
    });

    const server = new ATXPPaymentServer('https://auth.atxp.ai', TH.logger(), mock.fetchHandler);
    
    await expect(server.charge(TH.charge({
      source: 'test-source',
      destination: 'test-destination'
    }))).rejects.toThrow('Unexpected status code 500 from payment server POST /charge endpoint');
  });

  it('should throw error for non-200 status from payment request endpoint', async () => {
    const mock = fetchMock.createInstance();
    mock.post('https://auth.atxp.ai/payment-request', {
      status: 400,
      body: { error: 'bad request' }
    });

    const server = new ATXPPaymentServer('https://auth.atxp.ai', TH.logger(), mock.fetchHandler);
    
    await expect(server.createPaymentRequest({
      ...TH.charge({
        source: 'test-source',
        destination: 'test-destination'
      })
    })).rejects.toThrow('POST /payment-request responded with unexpected HTTP status 400');
  });

  it('should throw error if payment request response lacks id field', async () => {
    const mock = fetchMock.createInstance();
    mock.post('https://auth.atxp.ai/payment-request', {
      status: 200,
      body: { success: true } // Missing 'id' field
    });

    const server = new ATXPPaymentServer('https://auth.atxp.ai', TH.logger(), mock.fetchHandler);
    
    await expect(server.createPaymentRequest({
      ...TH.charge({
        source: 'test-source',
        destination: 'test-destination'
      })
    })).rejects.toThrow('POST /payment-request response did not contain an id');
  });
});