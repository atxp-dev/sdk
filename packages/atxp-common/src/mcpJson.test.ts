import { describe, it, expect } from 'vitest';
import { PAYMENT_REQUIRED_ERROR_CODE } from './paymentRequiredError.js';
import { parsePaymentRequests } from './mcpJson.js';
import * as TH from './commonTestHelpers.js';

describe('mcpJson', () => {
  describe('parsePaymentRequest', () => {
    it('should find a payment request in a tool error', async () => {
      const errMsg = TH.paymentRequiredMessage('https://auth.atxp.ai', '123');
      const msg = TH.mcpToolErrorResponse({content: [{type: 'text', text: errMsg}]});
      const res = await parsePaymentRequests(msg);
      expect(res).toMatchObject([{
        url: 'https://auth.atxp.ai/payment-request/123',
        id: '123'
      }]);
    });

    it('should ignore a tool error that contains a non-payment request url', async () => {
      const errMsg = 'A non-payment error: https://example.com/payment-request/123'
      const msg = TH.mcpToolErrorResponse({content: [{type: 'text', text: errMsg}]});
      const res = await parsePaymentRequests(msg);
      expect(res).toMatchObject([]);
    });

    it('should find a payment request in an MCP error', async () => {
      const errMsg = TH.paymentRequiredMessage('https://auth.atxp.ai', '123');
      const msg = TH.mcpErrorResponse({code: PAYMENT_REQUIRED_ERROR_CODE, message: errMsg, data: {paymentRequestUrl: 'https://auth.atxp.ai/payment-request/123'}});
      const res = await parsePaymentRequests(msg);
      expect(res).toMatchObject([{
        url: 'https://auth.atxp.ai/payment-request/123',
        id: '123'
      }]);
    });

    it('should find a payment request in an MCP error that does not have a payment request url', async () => {
      const errMsg = TH.paymentRequiredMessage('https://auth.atxp.ai', '123');
      const msg = TH.mcpErrorResponse({code: PAYMENT_REQUIRED_ERROR_CODE, message: errMsg});
      const res = await parsePaymentRequests(msg);
      expect(res).toMatchObject([{
        url: 'https://auth.atxp.ai/payment-request/123',
        id: '123'
      }]);
    });

    it('should ignore an MCP error that contains a non-payment request url', async () => {
      const errMsg = 'A non-payment error: https://example.com/not-a-payment-request/123'
      const msg = TH.mcpErrorResponse({code: PAYMENT_REQUIRED_ERROR_CODE, message: errMsg});
      const res = await parsePaymentRequests(msg);
      expect(res).toMatchObject([]);
    });

    it('should find a payment request in an elicitation response', async () => {  
      const msg = TH.mcpElicitationRequiredErrorResponse({url: 'https://auth.atxp.ai/payment-request/123', elicitationId: '123'});
      const res = await parsePaymentRequests(msg);
      expect(res).toMatchObject([{ 
        url: 'https://auth.atxp.ai/payment-request/123',
        id: '123'
      }]);
    });

    it('should ignore an elicitation response that contains a non-payment request url', async () => {
      const msg = TH.mcpElicitationRequiredErrorResponse({url: 'https://example.com/some-path/123', elicitationId: '123'});
      const res = await parsePaymentRequests(msg);
      expect(res).toMatchObject([]);
    });
  });
});