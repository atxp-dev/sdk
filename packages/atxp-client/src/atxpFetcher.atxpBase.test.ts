import { MemoryOAuthDb } from '@atxp/common';
import { describe, it, expect, vi } from 'vitest';
import fetchMock from 'fetch-mock';
import { mockResourceServer, mockAuthorizationServer } from './clientTestHelpers.js';
import * as CTH from '@atxp/common/src/commonTestHelpers.js';
import { ATXPFetcher } from './atxpFetcher.js';
import { OAuthDb, FetchLike, AuthorizationServerUrl, DEFAULT_AUTHORIZATION_SERVER } from '@atxp/common';
import { PaymentMaker, ProspectivePayment } from './types.js';
import BigNumber from 'bignumber.js';

function mockBasePaymentMaker(sourceAddress = '0x1234567890123456789012345678901234567890'): PaymentMaker {
  return {
    makePayment: vi.fn().mockResolvedValue('testPaymentId'),
    generateJWT: vi.fn().mockResolvedValue('testJWT'),
    getSourceAddress: vi.fn().mockReturnValue(sourceAddress)
  };
}

function atxpFetcher(
  fetchFn: FetchLike,
  paymentMakers?: { [key: string]: PaymentMaker },
  db?: OAuthDb,
  allowedAuthorizationServers?: AuthorizationServerUrl[],
  approvePayment?: (payment: ProspectivePayment) => Promise<boolean>
) {
  return new ATXPFetcher({
    accountId: "test-account",
    db: db ?? new MemoryOAuthDb(),
    paymentMakers: paymentMakers ?? { base: mockBasePaymentMaker() },
    fetchFn,
    allowedAuthorizationServers: allowedAuthorizationServers ?? [DEFAULT_AUTHORIZATION_SERVER],
    approvePayment
  });
}

// Default test parameters for payment requests
const defaultTestParams = {
  amount: new BigNumber('10'),
  currency: 'USDC' as const,
  receiver: '0xTestReceiver123',
  memo: 'test-issuer'
};

describe('atxpFetcher atxp_base resolution', () => {
  describe('resolveAtxpBaseDestination', () => {
    it('should resolve atxp_base network to base network with destination address', async () => {
      const f = fetchMock.createInstance();
      const sourceAddress = '0xBuyerAddress123';
      const destinationAddress = '0xDestinationAddress456';
      const paymentRequestId = 'pay_123';
      const paymentInfoUrl = `${DEFAULT_AUTHORIZATION_SERVER}/payment_info/acc_789`;

      // Mock payment_info endpoint
      f.post(paymentInfoUrl, {
        status: 'success',
        paymentRequestId,
        buyerAddress: sourceAddress,
        destinationAddress,
        network: 'base'
      });

      const basePaymentMaker = mockBasePaymentMaker(sourceAddress);
      const paymentMakers = { base: basePaymentMaker };
      const fetcher = atxpFetcher(f.fetchHandler, paymentMakers);

      // Access the protected method for testing
      const result = await (fetcher as any).resolveAtxpBaseDestination(
        'atxp_base',
        paymentInfoUrl,
        paymentRequestId,
        defaultTestParams.amount,
        defaultTestParams.currency,
        defaultTestParams.receiver,
        defaultTestParams.memo
      );

      expect(result).toBeDefined();
      expect(result?.destinationAddress).toBe(destinationAddress);
      expect(result?.network).toBe('base');

      // Verify payment_info was called with correct body
      const paymentInfoCall = f.callHistory.lastCall(paymentInfoUrl);
      expect(paymentInfoCall).toBeDefined();
      const requestBody = JSON.parse(paymentInfoCall!.args[1]!.body as string);
      expect(requestBody.paymentRequestId).toBe(paymentRequestId);
      expect(requestBody.buyerAddress).toBe(sourceAddress);
    });

    it('should resolve atxp_base_sepolia network to base_sepolia', async () => {
      const f = fetchMock.createInstance();
      const sourceAddress = '0xBuyerAddress123';
      const destinationAddress = '0xDestinationAddress456';
      const paymentRequestId = 'pay_123';
      const paymentInfoUrl = `${DEFAULT_AUTHORIZATION_SERVER}/payment_info/acc_789`;

      f.post(paymentInfoUrl, {
        status: 'success',
        paymentRequestId,
        buyerAddress: sourceAddress,
        destinationAddress,
        network: 'base_sepolia'
      });

      const baseSepoliaPaymentMaker = mockBasePaymentMaker(sourceAddress);
      const paymentMakers = { base_sepolia: baseSepoliaPaymentMaker };
      const fetcher = atxpFetcher(f.fetchHandler, paymentMakers);

      const result = await (fetcher as any).resolveAtxpBaseDestination(
        'atxp_base_sepolia',
        paymentInfoUrl,
        paymentRequestId,
        defaultTestParams.amount,
        defaultTestParams.currency,
        defaultTestParams.receiver,
        defaultTestParams.memo
      );

      expect(result).toBeDefined();
      expect(result?.destinationAddress).toBe(destinationAddress);
      expect(result?.network).toBe('base_sepolia');
    });

    it('should return null for non-atxp_base networks', async () => {
      const f = fetchMock.createInstance();
      const fetcher = atxpFetcher(f.fetchHandler);

      const result = await (fetcher as any).resolveAtxpBaseDestination(
        'base',
        'https://example.com/payment_info',
        'pay_123',
        defaultTestParams.amount,
        defaultTestParams.currency,
        defaultTestParams.receiver,
        defaultTestParams.memo
      );

      expect(result).toBeNull();
      // Should not make any API calls
      expect(f.callHistory.calls().length).toBe(0);
    });

    it('should return null if payment maker for real network is not available', async () => {
      const f = fetchMock.createInstance();
      const fetcher = atxpFetcher(f.fetchHandler, { solana: mockBasePaymentMaker() });

      const result = await (fetcher as any).resolveAtxpBaseDestination(
        'atxp_base',
        'https://example.com/payment_info',
        'pay_123',
        defaultTestParams.amount,
        defaultTestParams.currency,
        defaultTestParams.receiver,
        defaultTestParams.memo
      );

      expect(result).toBeNull();
      // Should not make any API calls since payment maker is not available
      expect(f.callHistory.calls().length).toBe(0);
    });

    it('should return null if payment_info endpoint returns non-success status', async () => {
      const f = fetchMock.createInstance();
      const paymentInfoUrl = `${DEFAULT_AUTHORIZATION_SERVER}/payment_info/acc_789`;

      f.post(paymentInfoUrl, {
        status: 'error',
        error: 'Invalid payment request'
      });

      const fetcher = atxpFetcher(f.fetchHandler);

      const result = await (fetcher as any).resolveAtxpBaseDestination(
        'atxp_base',
        paymentInfoUrl,
        'pay_123',
        defaultTestParams.amount,
        defaultTestParams.currency,
        defaultTestParams.receiver,
        defaultTestParams.memo
      );

      expect(result).toBeNull();
    });

    it('should return null if payment_info endpoint fails with HTTP error', async () => {
      const f = fetchMock.createInstance();
      const paymentInfoUrl = `${DEFAULT_AUTHORIZATION_SERVER}/payment_info/acc_789`;

      f.post(paymentInfoUrl, {
        status: 500,
        body: 'Internal Server Error'
      });

      const fetcher = atxpFetcher(f.fetchHandler);

      const result = await (fetcher as any).resolveAtxpBaseDestination(
        'atxp_base',
        paymentInfoUrl,
        'pay_123',
        defaultTestParams.amount,
        defaultTestParams.currency,
        defaultTestParams.receiver,
        defaultTestParams.memo
      );

      expect(result).toBeNull();
    });

    it('should return null if destinationAddress is missing from response', async () => {
      const f = fetchMock.createInstance();
      const paymentInfoUrl = `${DEFAULT_AUTHORIZATION_SERVER}/payment_info/acc_789`;

      f.post(paymentInfoUrl, {
        status: 'success',
        paymentRequestId: 'pay_123',
        buyerAddress: '0xBuyerAddress',
        network: 'base'
        // destinationAddress is missing
      });

      const fetcher = atxpFetcher(f.fetchHandler);

      const result = await (fetcher as any).resolveAtxpBaseDestination(
        'atxp_base',
        paymentInfoUrl,
        'pay_123',
        defaultTestParams.amount,
        defaultTestParams.currency,
        defaultTestParams.receiver,
        defaultTestParams.memo
      );

      expect(result).toBeNull();
    });

    it('should return null if network is missing from response', async () => {
      const f = fetchMock.createInstance();
      const paymentInfoUrl = `${DEFAULT_AUTHORIZATION_SERVER}/payment_info/acc_789`;

      f.post(paymentInfoUrl, {
        status: 'success',
        paymentRequestId: 'pay_123',
        buyerAddress: '0xBuyerAddress',
        destinationAddress: '0xDestination'
        // network is missing
      });

      const fetcher = atxpFetcher(f.fetchHandler);

      const result = await (fetcher as any).resolveAtxpBaseDestination(
        'atxp_base',
        paymentInfoUrl,
        'pay_123',
        defaultTestParams.amount,
        defaultTestParams.currency,
        defaultTestParams.receiver,
        defaultTestParams.memo
      );

      expect(result).toBeNull();
    });

    it('should return null if getSourceAddress throws an error', async () => {
      const f = fetchMock.createInstance();
      const paymentMaker = mockBasePaymentMaker();
      (paymentMaker.getSourceAddress as any).mockImplementation(() => {
        throw new Error('Cannot get source address');
      });

      const fetcher = atxpFetcher(f.fetchHandler, { base: paymentMaker });

      const result = await (fetcher as any).resolveAtxpBaseDestination(
        'atxp_base',
        'https://example.com/payment_info',
        'pay_123',
        defaultTestParams.amount,
        defaultTestParams.currency,
        defaultTestParams.receiver,
        defaultTestParams.memo
      );

      expect(result).toBeNull();
    });
  });

  describe('handleMultiDestinationPayment with atxp_base', () => {
    it('should resolve atxp_base destination and make payment to resolved address', async () => {
      const f = fetchMock.createInstance();
      const sourceAddress = '0xBuyerAddress123';
      const destinationAddress = '0xDestinationAddress456';
      const paymentRequestId = 'pay_123';
      const paymentInfoUrl = `${DEFAULT_AUTHORIZATION_SERVER}/payment_info/acc_789`;

      const errTxt = CTH.paymentRequiredMessage(DEFAULT_AUTHORIZATION_SERVER, paymentRequestId);
      const errMsg = CTH.mcpToolErrorResponse({ content: [{ type: 'text', text: errTxt }] });

      mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
        .postOnce('https://example.com/mcp', errMsg)
        .postOnce('https://example.com/mcp', { content: [{ type: 'text', text: 'success' }] });

      // Mock payment_info endpoint
      f.post(paymentInfoUrl, {
        status: 'success',
        paymentRequestId,
        buyerAddress: sourceAddress,
        destinationAddress,
        network: 'base'
      });

      // Mock authorization server basics
      mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER, {});

      // Override the GET payment-request endpoint with atxp_base destination
      f.get(`${DEFAULT_AUTHORIZATION_SERVER}/payment-request/${paymentRequestId}`, {
        destinations: [
          {
            network: 'atxp_base',
            address: paymentInfoUrl,
            currency: 'USDC',
            amount: '10'
          }
        ],
        resourceName: 'testResourceName',
        iss: 'test-issuer'
      }, { overwriteRoutes: true });

      // Mock the PUT payment-request endpoint
      f.put(`${DEFAULT_AUTHORIZATION_SERVER}/payment-request/${paymentRequestId}`, {
        status: 200
      }, { overwriteRoutes: true });

      const basePaymentMaker = mockBasePaymentMaker(sourceAddress);
      const fetcher = atxpFetcher(f.fetchHandler, { base: basePaymentMaker });

      await fetcher.fetch('https://example.com/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      // Verify payment_info was called
      const paymentInfoCall = f.callHistory.lastCall(paymentInfoUrl);
      expect(paymentInfoCall).toBeDefined();

      // Verify payment was made to the resolved destination address
      expect(basePaymentMaker.makePayment).toHaveBeenCalledWith(
        expect.objectContaining({ _isBigNumber: true }),
        'USDC',
        destinationAddress,
        expect.any(String)
      );
    });

    it('should fall back to next destination if atxp_base resolution fails', async () => {
      const f = fetchMock.createInstance();
      const paymentRequestId = 'pay_123';
      const paymentInfoUrl = `${DEFAULT_AUTHORIZATION_SERVER}/payment_info/acc_789`;
      const solanaDestination = 'SolanaAddress123';

      const errTxt = CTH.paymentRequiredMessage(DEFAULT_AUTHORIZATION_SERVER, paymentRequestId);
      const errMsg = CTH.mcpToolErrorResponse({ content: [{ type: 'text', text: errTxt }] });

      mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
        .postOnce('https://example.com/mcp', errMsg)
        .postOnce('https://example.com/mcp', { content: [{ type: 'text', text: 'success' }] });

      // Mock payment_info endpoint to fail with 500 error
      f.post(paymentInfoUrl, {
        status: 500
      });

      // Mock authorization server basics
      mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER, {});

      // Override the GET payment-request endpoint with atxp_base as first destination and solana as fallback
      f.get(`${DEFAULT_AUTHORIZATION_SERVER}/payment-request/${paymentRequestId}`, {
        destinations: [
          {
            network: 'atxp_base',
            address: paymentInfoUrl,
            currency: 'USDC',
            amount: '10'
          },
          {
            network: 'solana',
            address: solanaDestination,
            currency: 'USDC',
            amount: '10'
          }
        ],
        resourceName: 'testResourceName',
        iss: 'test-issuer'
      }, { overwriteRoutes: true });

      // Mock the PUT payment-request endpoint
      f.put(`${DEFAULT_AUTHORIZATION_SERVER}/payment-request/${paymentRequestId}`, {
        status: 200
      }, { overwriteRoutes: true });

      const solanaPaymentMaker: PaymentMaker = {
        makePayment: vi.fn().mockResolvedValue('solanaPaymentId'),
        generateJWT: vi.fn().mockResolvedValue('solanaJWT'),
        getSourceAddress: vi.fn().mockReturnValue('SolanaSourceAddress')
      };

      const fetcher = atxpFetcher(f.fetchHandler, { solana: solanaPaymentMaker });

      await fetcher.fetch('https://example.com/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      // Verify payment was made using Solana fallback
      // Note: payment_info endpoint was attempted but returned 500, so the code fell back to solana
      expect(solanaPaymentMaker.makePayment).toHaveBeenCalledWith(
        expect.objectContaining({ _isBigNumber: true }),
        'USDC',
        solanaDestination,
        expect.any(String)
      );
    });
  });

  describe('handlePaymentRequestError with atxp_base (legacy single destination)', () => {
    it('should resolve atxp_base destination and make payment to resolved address', async () => {
      const f = fetchMock.createInstance();
      const sourceAddress = '0xBuyerAddress123';
      const destinationAddress = '0xDestinationAddress456';
      const paymentRequestId = 'pay_legacy';
      const paymentInfoUrl = `${DEFAULT_AUTHORIZATION_SERVER}/payment_info/acc_789`;

      const errTxt = CTH.paymentRequiredMessage(DEFAULT_AUTHORIZATION_SERVER, paymentRequestId);
      const errMsg = CTH.mcpToolErrorResponse({ content: [{ type: 'text', text: errTxt }] });

      mockResourceServer(f, 'https://example.com', '/mcp', DEFAULT_AUTHORIZATION_SERVER)
        .postOnce('https://example.com/mcp', errMsg)
        .postOnce('https://example.com/mcp', { content: [{ type: 'text', text: 'success' }] });

      // Mock payment_info endpoint
      f.post(paymentInfoUrl, {
        status: 'success',
        paymentRequestId,
        buyerAddress: sourceAddress,
        destinationAddress,
        network: 'base'
      });

      // Mock authorization server basics
      mockAuthorizationServer(f, DEFAULT_AUTHORIZATION_SERVER, {});

      // Override the GET payment-request endpoint with legacy format (single destination with atxp_base)
      f.get(`${DEFAULT_AUTHORIZATION_SERVER}/payment-request/${paymentRequestId}`, {
        network: 'atxp_base',
        destination: paymentInfoUrl,
        currency: 'USDC',
        amount: '5',
        resourceName: 'testResourceName',
        iss: 'test-issuer'
      }, { overwriteRoutes: true });

      // Mock the PUT payment-request endpoint
      f.put(`${DEFAULT_AUTHORIZATION_SERVER}/payment-request/${paymentRequestId}`, {
        status: 200
      }, { overwriteRoutes: true });

      const basePaymentMaker = mockBasePaymentMaker(sourceAddress);
      const fetcher = atxpFetcher(f.fetchHandler, { base: basePaymentMaker });

      await fetcher.fetch('https://example.com/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      // Verify payment_info was called
      const paymentInfoCall = f.callHistory.lastCall(paymentInfoUrl);
      expect(paymentInfoCall).toBeDefined();

      // Verify payment was made to the resolved destination address
      expect(basePaymentMaker.makePayment).toHaveBeenCalledWith(
        expect.objectContaining({ _isBigNumber: true }),
        'USDC',
        destinationAddress,
        expect.any(String)
      );
    });
  });
});
