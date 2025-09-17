# X402 Integration Guide

## Overview

The ATXP SDK now includes support for the X402 payment protocol, allowing ATXP clients to seamlessly interact with X402 servers. X402 is a micropayment protocol that uses HTTP 402 (Payment Required) status codes to enable pay-per-use web resources.

## Key Concepts

### X402 Protocol Flow

1. **Payment Challenge**: Server responds with HTTP 402 and payment requirements in `X-Payment` header
2. **Payment Signing**: Client creates and signs a payment message without submitting to blockchain
3. **Payment Verification**: Server's facilitator verifies the signed payment
4. **Payment Settlement**: Facilitator submits the payment to blockchain
5. **Resource Access**: Server grants access to the protected resource

### Architecture Components

- **Client**: Uses ATXP SDK with X402 wrapper to handle payment challenges
- **Resource Server**: Protects resources and issues payment challenges
- **Facilitator**: Verifies signatures and settles payments on-chain

## Implementation

### Refactored PaymentMaker Interface

The `PaymentMaker` interface has been extended to support separate signing and submission:

```typescript
interface PaymentMaker {
  // Original method (still supported)
  makePayment(amount: BigNumber, currency: Currency, receiver: string, memo: string): Promise<string>;

  // New methods for X402 support
  createSignedPaymentMessage(amount: BigNumber, currency: Currency, receiver: string, memo: string): Promise<SignedPaymentMessage>;
  submitPaymentMessage(signedMessage: SignedPaymentMessage): Promise<string>;

  generateJWT(params: {paymentRequestId: string, codeChallenge: string}): Promise<string>;
}
```

### SignedPaymentMessage Type

```typescript
type SignedPaymentMessage = {
  data: string;        // Transaction data
  signature: string;   // Signed transaction
  from: string;        // Sender address
  to: string;          // Recipient address
  amount: BigNumber;   // Payment amount
  currency: Currency;  // Payment currency
  network: Network;    // Blockchain network
}
```

## Usage

### Basic X402 Integration

```typescript
import { wrapWithX402, BaseAccount } from '@atxp/client';

// Create an account
const account = new BaseAccount(rpcUrl, privateKey);

// Wrap fetch with X402 support
const x402Fetch = wrapWithX402(fetch, {
  account,
  approvePayment: async (payment) => {
    console.log(`Approve payment of ${payment.amount} ${payment.currency}?`);
    return true; // or false to reject
  },
  onPayment: async ({ payment }) => {
    console.log('Payment successful:', payment);
  },
  onPaymentFailure: async ({ payment, error }) => {
    console.error('Payment failed:', error);
  },
  logger: new ConsoleLogger(),
  maxRetries: 1
});

// Use like regular fetch
const response = await x402Fetch('https://x402-server.com/protected-resource');
const data = await response.json();
```

### Advanced Configuration

```typescript
import { enableX402Support } from '@atxp/client';

const config = enableX402Support({
  account,
  approvePayment: async (payment) => {
    // Custom approval logic
    if (payment.amount.gt(new BigNumber(10))) {
      // Require user confirmation for payments > 10 USDC
      return await promptUser(payment);
    }
    return true;
  },
  onPayment: async ({ payment }) => {
    // Track successful payments
    await analytics.track('payment_success', {
      amount: payment.amount.toString(),
      currency: payment.currency,
      resource: payment.resourceUrl
    });
  },
  onPaymentFailure: async ({ payment, error }) => {
    // Handle payment failures
    await analytics.track('payment_failure', {
      error: error.message,
      resource: payment.resourceUrl
    });
  },
  logger: customLogger,
  maxRetries: 2
});

// Use the wrapped fetch
const response = await config.fetchFn(url);
```

### Integration with Existing ATXP Client

```typescript
import { atxpClient, wrapWithX402 } from '@atxp/client';

// Create ATXP client with X402 support
const clientConfig = buildClientConfig({
  account,
  // ... other config
  fetchFn: wrapWithX402(fetch, {
    account,
    approvePayment: async (payment) => true,
    // ... X402 config
  })
});

const client = await atxpClient(clientConfig);
```

## Supported Account Types

X402 support depends on the facilitator's capabilities. The following account types are expected to work:

| Account Type | Network | Currency | Status |
|-------------|---------|----------|--------|
| BaseAccount | Base | USDC | ✅ Supported |
| SolanaAccount | Solana | USDC | ✅ Supported |
| ATXPAccount | Base | USDC | ✅ Supported |

Note: Actual compatibility depends on the X402 facilitator implementation.

## Payment Approval Strategies

### Automatic Approval

```typescript
approvePayment: async (payment) => {
  // Auto-approve small payments
  const threshold = new BigNumber(1); // 1 USDC
  return payment.amount.lte(threshold);
}
```

### User Confirmation

```typescript
approvePayment: async (payment) => {
  // Show confirmation dialog
  const message = `Approve ${payment.amount} ${payment.currency} payment to access ${payment.resourceName}?`;
  return await showConfirmDialog(message);
}
```

### Whitelist-based

```typescript
const trustedServers = ['https://trusted1.com', 'https://trusted2.com'];

approvePayment: async (payment) => {
  const url = new URL(payment.resourceUrl);
  return trustedServers.includes(url.origin);
}
```

## Error Handling

The X402 wrapper handles various error scenarios:

```typescript
onPaymentFailure: async ({ payment, error }) => {
  if (error.message.includes('No payment maker')) {
    console.error('Unsupported network/currency combination');
  } else if (error.message.includes('Payment not approved')) {
    console.log('User rejected payment');
  } else if (error.message.includes('Insufficient funds')) {
    console.error('Not enough balance');
  } else {
    console.error('Payment failed:', error);
  }
}
```

## Security Considerations

1. **Payment Approval**: Always implement proper payment approval logic
2. **Amount Validation**: Verify payment amounts match expected values
3. **Recipient Validation**: Ensure payments go to legitimate recipients
4. **Replay Protection**: Facilitators should prevent payment replay attacks
5. **Private Keys**: Never expose private keys in client-side code

## Testing

### Mock X402 Server

Use the provided example server for testing:

```bash
cd examples/x402-server
npm install
npm run dev
```

### Test Client

```bash
cd examples/x402-server
npm run test-client
```

### Unit Testing

```typescript
import { wrapWithX402 } from '@atxp/client';
import { MockAccount } from '@atxp/client/testing';

describe('X402 Integration', () => {
  it('handles payment challenges', async () => {
    const mockAccount = new MockAccount();
    const mockFetch = jest.fn()
      .mockReturnValueOnce({
        status: 402,
        headers: new Headers({
          'X-Payment': JSON.stringify({
            network: 'base',
            currency: 'USDC',
            amount: '1',
            recipient: '0x...'
          })
        })
      })
      .mockReturnValueOnce({
        ok: true,
        json: async () => ({ data: 'protected' })
      });

    const x402Fetch = wrapWithX402(mockFetch, {
      account: mockAccount,
      approvePayment: async () => true
    });

    const response = await x402Fetch('https://example.com/protected');
    const data = await response.json();

    expect(data).toEqual({ data: 'protected' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
```

## Migration Guide

### For Existing ATXP Users

1. Update your PaymentMaker implementations if you have custom ones
2. Add X402 wrapper to your fetch configuration if needed
3. No changes required if not using X402 servers

### For X402 Server Operators

1. Implement standard X402 challenge/response flow
2. Use a compatible facilitator that supports Base/Solana
3. Follow the example server implementation

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| "No payment maker found" | Ensure account has payment maker for required network/currency |
| "Payment not approved" | Check approvePayment callback logic |
| "Insufficient funds" | Ensure account has enough balance |
| "Invalid signature" | Verify facilitator supports your account type |
| "Transaction reverted" | Check recipient address and amount |

### Debug Logging

Enable detailed logging for troubleshooting:

```typescript
import { ConsoleLogger } from '@atxp/common';

const logger = new ConsoleLogger();
logger.level = 'debug';

const x402Fetch = wrapWithX402(fetch, {
  account,
  logger,
  // ... other config
});
```

## FAQ

**Q: Can I use X402 with existing ATXP servers?**
A: No, X402 and ATXP are different protocols. X402 servers specifically implement the X402 payment challenge flow.

**Q: What happens if payment fails?**
A: The original 402 response is returned, and the `onPaymentFailure` callback is triggered.

**Q: Can I retry failed payments?**
A: Yes, configure `maxRetries` in the X402 config.

**Q: Is the payment submitted immediately?**
A: With X402, the client only signs the payment. The facilitator submits it to the blockchain.

**Q: Can I use custom facilitators?**
A: Yes, as long as they follow the X402 protocol specification.

## References

- [X402 Protocol Specification](https://x402.org/spec)
- [ATXP Documentation](https://atxp.ai/docs)
- [Example Implementation](../examples/x402-server)
- [Design Document](./x402-design.md)