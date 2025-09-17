# X402 Server Example

This example demonstrates X402 payment protocol with ATXP SDK. You can test it immediately using the **public test facilitator** - no API keys required!

## Quick Start (Testnet - No API Keys!)

### 1. Install and Configure
```bash
npm install
cp .env.example .env
# Edit .env - set your RECIPIENT_ADDRESS
```

### 2. Get Test USDC
Get free test USDC on Base Sepolia from:
- [Circle USDC Faucet](https://faucet.circle.com/) (recommended)
- Or any Base Sepolia faucet for ETH

### 3. Run Server
```bash
npm run dev
```

The server automatically uses the **public test facilitator** at `https://x402.org/facilitator` - no login or API keys needed!

### 4. Test Client
```bash
# In another terminal
npm run test-client
```

## Configuration Options

### Testnet Mode (Default - No API Keys!)
```env
NETWORK=base-sepolia
RECIPIENT_ADDRESS=0xYourWalletAddress
# No CDP keys needed! Uses public facilitator
```

### Production Mode (Real Money)
```env
NETWORK=base
CDP_API_KEY_ID=your_key_id         # Get from cdp.coinbase.com
CDP_API_KEY_SECRET=your_key_secret # Get from cdp.coinbase.com
RECIPIENT_ADDRESS=0xYourWalletAddress
```

## How It Works

1. Server uses X402 middleware to protect endpoints
2. Client requests protected resource
3. Server returns 402 Payment Required
4. Client signs payment and retries
5. Facilitator verifies and settles on blockchain
6. Server returns protected resource

## Facilitator Options

| Mode | Network | Facilitator | API Keys | Real Money |
|------|---------|------------|----------|------------|
| **Test** (default) | Base Sepolia | `https://x402.org/facilitator` | ❌ None | ❌ Test USDC |
| Production | Base Mainnet | Coinbase CDP | ✅ Required | ✅ Real USDC |

## Server Code

The entire X402 integration is just one middleware line:

```typescript
app.use(paymentMiddleware(
  recipientAddress,
  { '/api/resource': { price: '$0.01', network: 'base-sepolia' } },
  { url: 'https://x402.org/facilitator' }  // Public test facilitator
));
```

## Client Code

The ATXP SDK handles X402 automatically:

```typescript
const x402Fetch = wrapWithX402(fetch, account);
const response = await x402Fetch('http://localhost:3001/api/resource');
```

## Cost Structure

- **Testnet**: Free (test USDC)
- **Mainnet**: Resource price + ~$0.001 gas (Base has very low fees)

## Troubleshooting

### "No payment maker found"
Ensure your account is configured for the correct network (base-sepolia for testnet).

### "Insufficient balance"
Get test USDC from the Circle faucet for Base Sepolia.

### View Transactions
- **Testnet**: [Base Sepolia Explorer](https://sepolia.basescan.org)
- **Mainnet**: [BaseScan](https://basescan.org)

## Resources

- [X402 Protocol](https://github.com/coinbase/x402)
- [Circle USDC Faucet](https://faucet.circle.com/)
- [Base Sepolia Info](https://docs.base.org/network-information)
- [ATXP Documentation](https://docs.atxp.ai/)