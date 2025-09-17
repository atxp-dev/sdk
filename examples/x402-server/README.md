# X402 Server Example with Coinbase Facilitator

This example demonstrates how to use ATXP SDK with the real Coinbase X402 facilitator for processing USDC payments on Base.

## What is X402?

X402 is a payment protocol that uses HTTP 402 (Payment Required) status codes with payment headers to enable micropayments for web resources. This example uses the **official Coinbase X402 facilitator** to process real USDC payments on the Base blockchain.

## Prerequisites

### 1. Coinbase Developer Platform (CDP) Account
You need CDP API keys to use the Coinbase facilitator:
1. Go to [https://portal.cdp.coinbase.com/](https://portal.cdp.coinbase.com/)
2. Create an account or sign in
3. Generate API keys (API Key ID and Secret)

### 2. Base Wallet with USDC
For the test client, you need:
- A wallet on Base network with some USDC
- The wallet's private key (for signing payments)
- An RPC endpoint (from Alchemy, Infura, or similar)

### 3. Recipient Wallet
A Base wallet address where you want to receive payments (for the server)

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file:
```bash
cp .env.example .env
```

3. Configure your environment variables:

```env
# CDP API Keys (required for real payments)
CDP_API_KEY_ID=your_cdp_api_key_id
CDP_API_KEY_SECRET=your_cdp_api_key_secret

# Network: "base" for mainnet or "base-sepolia" for testnet
NETWORK=base

# Your wallet to receive payments
RECIPIENT_ADDRESS=0xYourWalletAddressHere

# For the test client
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/your-api-key
BASE_PRIVATE_KEY=your_private_key_here
```

## Running the Example

### Start the X402 Server

```bash
npm run dev
```

The server will start with either:
- **Production Mode**: If CDP API keys are configured (real payments)
- **Demo Mode**: If no CDP API keys (no actual payments)

### Test with the Client

In a separate terminal:

```bash
npm run test-client
```

The test client will:
1. Check server configuration
2. Attempt to access protected resources
3. Handle X402 payment challenges automatically
4. Make real USDC payments on Base
5. Display transaction details

## How It Works

### Server Flow (with Coinbase Facilitator)

1. Client requests a protected resource
2. Coinbase middleware returns 402 with payment requirements
3. Client signs and sends payment in X-Payment header
4. Coinbase facilitator:
   - Verifies the payment signature
   - Checks account balance
   - Submits transaction to Base blockchain
   - Waits for confirmation
5. Server returns the protected resource

### Client Flow (ATXP SDK)

```typescript
// Wrap fetch with X402 support
const x402Fetch = wrapWithX402(fetch, {
  account: baseAccount,
  approvePayment: async (payment) => {
    // Approve payments under 10 cents
    return payment.amount.lte(new BigNumber('0.10'));
  },
  onPayment: async ({ payment }) => {
    console.log('Payment successful:', payment);
  }
});

// Use like regular fetch - payments handled automatically
const response = await x402Fetch('http://localhost:3001/api/protected-resource');
```

## Pricing Structure

The example server has three tiers:

| Endpoint | Price | Description |
|----------|-------|-------------|
| `/api/protected-resource/:id` | $0.01 | Basic protected content |
| `/api/premium-resource` | $0.10 | Premium features |
| `/api/expensive-resource` | $1.00 | High-value content |

## Testing on Different Networks

### Base Mainnet (Production)
```env
NETWORK=base
```
- Real USDC payments
- Real money involved
- Transactions visible on [BaseScan](https://basescan.org)

### Base Sepolia (Testnet)
```env
NETWORK=base-sepolia
```
- Test USDC tokens
- No real money
- Get test USDC from faucets
- Transactions visible on [Base Sepolia Explorer](https://sepolia.basescan.org)

## Important Security Notes

⚠️ **NEVER commit real private keys or API secrets to version control**

- Use environment variables for sensitive data
- Keep your `.env` file in `.gitignore`
- Use separate wallets for testing
- Start with small amounts when testing on mainnet

## Cost Breakdown

When using Base mainnet:
- **Gas fees**: ~$0.001 per transaction (Base has very low fees)
- **Facilitator fee**: 0% (Coinbase doesn't charge fees)
- **Total cost**: Resource price + minimal gas

## Monitoring Transactions

View your transactions on:
- **Base Mainnet**: [https://basescan.org](https://basescan.org)
- **Base Sepolia**: [https://sepolia.basescan.org](https://sepolia.basescan.org)

Search by your wallet address or transaction hash.

## Troubleshooting

### "CDP API keys not configured"
Set `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` in your `.env` file.

### "Insufficient USDC balance"
Ensure your wallet has enough USDC on the correct network.

### "Transaction failed"
Check:
1. Network configuration matches between client and server
2. Wallet has enough USDC and ETH for gas
3. RPC endpoint is working

### "Payment not approved"
The test client auto-approves payments under $0.10. Adjust the limit in `test-client.ts` if needed.

## Architecture

```
┌─────────┐      402 Challenge      ┌─────────┐
│ Client  │ ─────────────────────> │ Server  │
│ (ATXP)  │                         │(Express)│
│         │ <───────────────────── │ + X402  │
└─────────┘   Retry with Payment    └─────────┘
     │                                    │
     │                                    ▼
     │                            ┌──────────────┐
     │                            │  Coinbase    │
     │                            │ Facilitator  │
     │                            └──────────────┘
     │                                    │
     └────────────────────────────────────┘
            Submit to Base Blockchain
```

## Next Steps

1. **Customize pricing**: Edit the `pricing` object in `server.ts`
2. **Add more endpoints**: Create new protected routes
3. **Implement business logic**: Add real functionality to protected endpoints
4. **Deploy to production**: Use proper hosting with HTTPS
5. **Monitor usage**: Track payments and API usage

## Resources

- [X402 Protocol Specification](https://github.com/coinbase/x402)
- [Coinbase Developer Platform](https://portal.cdp.coinbase.com/)
- [Base Documentation](https://docs.base.org/)
- [ATXP Documentation](https://docs.atxp.ai/)