# X402 Server Example

This example demonstrates how to use ATXP SDK with X402 payment protocol support.

## What is X402?

X402 is a payment protocol that uses HTTP 402 (Payment Required) status codes with payment headers to enable micropayments for web resources. The protocol involves three parties:

1. **Client** - Makes payments to access resources
2. **Resource Server** - Serves protected content and requires payment
3. **Facilitator** - Verifies and settles payments on the blockchain

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

3. Configure your environment variables:
   - `BASE_RPC_URL`: Your Base network RPC endpoint
   - `BASE_PRIVATE_KEY`: Private key for a Base account with USDC funds

## Running the Example

### Start the X402 Server

```bash
npm run dev
```

This starts a mock X402 server on `http://localhost:3001` with the following endpoints:

- `GET /protected-resource/:id` - Protected resource requiring 1 USDC payment
- `GET /health` - Health check endpoint
- `GET /user/:address/resources` - List resources accessed by a user

### Test with the Client

In a separate terminal:

```bash
npm run test-client
```

This runs a test client that:
1. Attempts to access a protected resource with regular fetch (fails with 402)
2. Uses X402-wrapped fetch to automatically handle payment and access the resource
3. Accesses multiple resources and tracks them

## How It Works

### Server Flow

1. Client requests a protected resource
2. Server returns 402 status with `X-Payment` header containing payment requirements
3. Client signs a payment message and retries with `X-Payment` header
4. Server verifies the payment with facilitator
5. Facilitator settles payment on blockchain
6. Server returns the protected resource

### Client Flow

The ATXP SDK provides a `wrapWithX402` function that wraps the standard fetch API:

```typescript
const x402Fetch = wrapWithX402(fetch, {
  account,
  approvePayment: async (payment) => {
    // Approve or reject payment
    return true;
  },
  onPayment: async ({ payment }) => {
    // Payment successful
  },
  onPaymentFailure: async ({ payment, error }) => {
    // Payment failed
  }
});

// Use like regular fetch
const response = await x402Fetch('http://example.com/protected');
```

## Important Notes

⚠️ **This is a mock implementation for demonstration purposes**

- The facilitator is mocked and doesn't actually verify signatures or submit to blockchain
- In production, use a real X402 facilitator service
- Never commit real private keys to version control
- Always validate payment amounts and recipients on the server side

## Architecture

```
┌─────────┐     402 + Challenge     ┌────────────┐
│         │ ──────────────────────> │            │
│  Client │                          │   Server   │
│         │ <────────────────────── │            │
└─────────┘   Retry + Payment Msg   └────────────┘
     │                                      │
     │                                      │ Verify
     │                                      ▼
     │                               ┌────────────┐
     │                               │Facilitator │
     └─────────────────────────────> │            │
              Submit to Chain        └────────────┘
```

## Supported Networks and Currencies

Currently supports:
- **Base Network**: USDC
- **Solana**: USDC (when using SolanaAccount)

## Troubleshooting

### Insufficient Funds Error
Ensure your account has enough USDC on the Base network.

### Network Errors
Check that your RPC URL is correct and accessible.

### Payment Verification Fails
In production, ensure the facilitator service is properly configured.

## Next Steps

To integrate X402 support in your application:

1. Wrap your fetch calls with `wrapWithX402`
2. Implement payment approval logic
3. Handle payment events for user feedback
4. Deploy with a real X402 facilitator service