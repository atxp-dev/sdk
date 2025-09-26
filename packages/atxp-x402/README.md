# @atxp/x402

X402 protocol integration for ATXP SDK - enables automatic HTTP 402 payment handling using the X402 standard.

## Overview

The `@atxp/x402` package provides a fetch wrapper that automatically handles X402 payment challenges. When a server responds with a 402 Payment Required status and X402 headers, this wrapper will:

1. Parse the X402 payment requirements
2. Create and submit payments using your ATXP account
3. Retry the original request with payment proof
4. Handle payment failures and retries

## Installation

```bash
npm install @atxp/x402
```

## Prerequisites

- An ATXP account (ATXPAccount instance)
- Compatible with networks that support X402 payments
- Requires `x402` library for payment processing

## Usage

### Basic Usage

```typescript
import { wrapWithX402 } from '@atxp/x402';
import { ATXPAccount } from '@atxp/client';
import { ConsoleLogger } from '@atxp/common';

// Create your ATXP account
const account = new ATXPAccount({
  // your account configuration
});

// Wrap fetch with X402 payment handling
const paymentEnabledFetch = wrapWithX402({
  account,
  logger: new ConsoleLogger(),
  mcpServer: 'https://your-mcp-server.com'
});

// Use the wrapped fetch - payments will be handled automatically
const response = await paymentEnabledFetch('https://api.example.com/premium-data');
```

### With Payment Callbacks

```typescript
const paymentEnabledFetch = wrapWithX402({
  account,
  logger: new ConsoleLogger(),
  mcpServer: 'https://your-mcp-server.com',

  // Optional: Custom payment approval logic
  approvePayment: async (payment) => {
    console.log(`Approve payment of ${payment.amount} ${payment.currency}?`);
    return true; // or implement your approval logic
  },

  // Optional: Payment success callback
  onPayment: (payment) => {
    console.log(`Payment completed: ${payment.amount} ${payment.currency}`);
  },

  // Optional: Payment failure callback
  onPaymentFailure: (error, payment) => {
    console.error('Payment failed:', error);
  }
});
```

### Custom Fetch Function

```typescript
import fetch from 'node-fetch';

const paymentEnabledFetch = wrapWithX402({
  account,
  fetchFn: fetch, // Use custom fetch implementation
  logger: new ConsoleLogger(),
  mcpServer: 'https://your-mcp-server.com'
});
```

## API Reference

### `wrapWithX402(config: ClientArgs): FetchLike`

Creates a fetch wrapper that handles X402 payment challenges automatically.

#### Parameters

- `config.account`: ATXPAccount instance (required)
- `config.mcpServer`: MCP server URL (required)
- `config.logger`: Logger instance (optional, defaults to console)
- `config.fetchFn`: Custom fetch function (optional, defaults to global fetch)
- `config.approvePayment`: Payment approval callback (optional)
- `config.onPayment`: Payment success callback (optional)
- `config.onPaymentFailure`: Payment failure callback (optional)

#### Returns

A wrapped fetch function that automatically handles X402 payments.

## How It Works

1. **Request Interception**: The wrapper intercepts all HTTP requests
2. **402 Detection**: When a 402 Payment Required response is received, it checks for X402 headers
3. **Payment Processing**: Uses the x402 library to parse payment requirements and create payments
4. **Account Integration**: Leverages your ATXPAccount for payment submission
5. **Request Retry**: Automatically retries the original request with payment proof

## X402 Protocol Support

This package implements the X402 HTTP payment protocol, which standardizes how web services can request payments for access to resources. Key features:

- Automatic parsing of X402 payment headers
- Support for multiple payment methods and currencies
- Retry logic for failed payments
- Integration with ATXP's payment infrastructure

## Error Handling

The wrapper handles various error scenarios:

- **Invalid Account**: Throws error if non-ATXPAccount is provided
- **Payment Failures**: Calls `onPaymentFailure` callback and may retry
- **Network Errors**: Passes through non-payment related errors
- **Unsupported X402**: Gracefully handles servers with incomplete X402 implementation

## Dependencies

- `@atxp/client`: ATXP client library with ATXPAccount
- `@atxp/common`: Shared ATXP utilities and types
- `x402`: X402 protocol implementation
- `viem`: Ethereum utilities
- `bignumber.js`: Precise decimal arithmetic

## License

MIT