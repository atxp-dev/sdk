# Browser Testing for @atxp/polygon

This directory contains browser testing tools for the `@atxp/polygon` package with integrated payment testing using the ATXP Image MCP server.

## Files

- **manual-test.html** - Standalone HTML page for manual browser testing with image generation
- **PolygonTestComponent.tsx** - React component for testing in React applications with payment integration
- **README.md** - This file

## Manual HTML Testing

The `manual-test.html` file is a self-contained test page that can be opened in a browser to test the Polygon integration.

### Setup

**Important:** These tests must be run from the **top level of the monorepo** (not from within `packages/atxp-polygon`). The test server needs to serve all packages to resolve the import map correctly.

1. Build the package:
```bash
# From the monorepo root
cd packages/atxp-polygon
npm run build
cd ../..
```

2. Start the test server from the monorepo root:
```bash
# From the monorepo root (e.g., atxp-dev-sdk/)
npx -y http-server -p 8000 -c-1 --cors
```

3. Open your browser to:
```
http://localhost:8000/packages/atxp-polygon/test/browser/manual-test.html
```

**Note:** The test page uses import maps to load modules. It must be served from the monorepo root so it can access:
- `/packages/atxp-polygon/dist/` - The built Polygon package
- `/packages/atxp-client/dist/` - The ATXP client package
- `/packages/atxp-common/dist/` - Common utilities

If you run the server from a subdirectory, the import paths will not resolve correctly.

### Using the Test Page

1. **Connect Wallet**
   - Click "Connect Wallet" button
   - Approve the connection in your wallet (MetaMask, Coinbase Wallet, etc.)

2. **Configure Account**
   - Choose Smart Wallet Mode (gasless) or Direct Wallet Mode
   - Select network (Polygon Mainnet or Amoy Testnet)
   - Set allowance and period
   - Click "Initialize Account"
   - ATXP client will automatically initialize with the Image MCP server

3. **View Account Info**
   - After initialization, account details will be displayed
   - You can refresh info or clear cache

4. **Generate Images with Payment**
   - Enter an image prompt (e.g., "A cat riding a horse")
   - Click "Generate Image"
   - Payment (~$0.05 USDC) is automatically processed
   - Image generation uses async polling (~10-30 seconds)
   - Generated images appear in the gallery below

5. **Check Console Log**
   - All actions, payments, and errors are logged to the on-page console
   - Also check your browser's developer console for additional details

### Testing Checklist

- [ ] Wallet connection works
- [ ] Network switching works (Mainnet/Testnet)
- [ ] Smart Wallet Mode initialization
- [ ] Direct Wallet Mode initialization
- [ ] ATXP client initialization
- [ ] Account info displays correctly
- [ ] Image generation with payment
- [ ] Payment success callbacks
- [ ] Generated images display in gallery
- [ ] Cache persistence (refresh page and see if account is remembered)
- [ ] Clear cache functionality
- [ ] Error handling (try with no USDC, reject approvals, etc.)

## React Component Testing

The `PolygonTestComponent.tsx` can be integrated into any React application for testing.

### Usage in a React App

1. Copy the component to your React app or import it:
```typescript
import { PolygonTestComponent } from '@atxp/polygon/test/browser/PolygonTestComponent';

function App() {
  return (
    <div>
      <PolygonTestComponent />
    </div>
  );
}
```

2. Make sure you have the necessary dependencies:
```bash
npm install react @atxp/polygon @atxp/common viem
```

3. The component is fully self-contained and manages its own state.

### Features

- Wallet connection and disconnection
- Mode selection (Smart Wallet vs Direct Wallet)
- Network selection (Mainnet vs Testnet)
- Configurable allowance and period
- ATXP client integration with Image MCP server
- Image generation with automatic payment processing
- Payment success/failure callbacks
- Real-time logging
- Account information display
- Cache management

### Testing Both Modes

**Smart Wallet Mode (Recommended for Production)**
- Single approval for multiple transactions
- Gasless transactions (no POL needed)
- Best user experience
- Uses Coinbase CDP for account abstraction

**Direct Wallet Mode**
- User signs each transaction
- Requires POL for gas
- Good for wallets that don't support smart contracts
- Full user control

## E2E Testing

For comprehensive end-to-end testing, use the manual HTML test page or React component integration. Automated browser testing with tools like Playwright can be added in the future if needed.

## Common Issues

### "No wallet provider found"
- Install MetaMask or Coinbase Wallet browser extension
- Make sure you're using a browser that supports wallet extensions

### "Module not found" errors
- Make sure you've built the package: `cd packages/atxp-polygon && npm run build`
- Check that you're serving from the monorepo root (not from a subdirectory)
- Verify the server is running: `npx -y http-server -p 8000 -c-1 --cors` from the monorepo root
- Don't open HTML directly - must be served via HTTP server

### Initialization fails
- Check that you're on the correct network in your wallet
- Make sure you have USDC balance (for testnet, get from faucet)
- For Direct Wallet Mode, ensure you have POL for gas
- Check browser console for detailed error messages

### Smart wallet deployment fails
- Make sure the Coinbase CDP bundler is accessible
- Check network connectivity
- Try again - sometimes network issues cause temporary failures

### Permission request not showing
- Some wallets don't support all EIP-1193 methods
- Try switching to Direct Wallet Mode
- Make sure wallet is unlocked

## Network Information

### Polygon Mainnet (Chain ID: 137)
- USDC Address: 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359
- RPC: https://polygon-rpc.com
- Explorer: https://polygonscan.com

### Polygon Amoy Testnet (Chain ID: 80002)
- USDC Address: 0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582
- RPC: https://rpc-amoy.polygon.technology
- Explorer: https://amoy.polygonscan.com
- Faucet: https://faucet.polygon.technology

## Support

For issues or questions:
- Check the main package README: `packages/atxp-polygon/README.md`
- Visit [ATXP Documentation](https://docs.atxp.ai/)
- Join the [Discord community](https://discord.gg/FuJXHhe9aW)
