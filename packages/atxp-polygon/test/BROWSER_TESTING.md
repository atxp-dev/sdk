# Browser Testing Guide for @atxp/polygon

This guide covers how to test the browser functionality of the `@atxp/polygon` package, including both Smart Wallet and Direct Wallet modes.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Testing Approaches](#testing-approaches)
  - [Manual HTML Testing](#manual-html-testing)
  - [React Component Testing](#react-component-testing)
  - [Unit Testing](#unit-testing)
- [Testing Checklist](#testing-checklist)
- [Troubleshooting](#troubleshooting)
- [Network Information](#network-information)

## Overview

The `@atxp/polygon` package provides browser-based payment functionality with two modes:

1. **Smart Wallet Mode (Default)**: Uses Coinbase CDP for account abstraction with gasless transactions
2. **Direct Wallet Mode**: Direct wallet integration where users sign each transaction

Both modes need to be tested to ensure compatibility and proper functionality.

## Prerequisites

### Required Software

- Modern web browser (Chrome, Firefox, or Brave)
- Wallet extension (MetaMask, Coinbase Wallet, or similar)
- Node.js 16+ (for building and serving)

### Test Wallet Setup

You'll need a test wallet with:

**For Polygon Amoy Testnet (Recommended for Testing)**:
- Chain ID: 80002
- USDC tokens (get from faucet)
- POL tokens for gas (only needed for Direct Wallet Mode)
- Faucet: https://faucet.polygon.technology

**For Polygon Mainnet** (Production Testing):
- Chain ID: 137
- Real USDC tokens
- POL tokens for gas (only needed for Direct Wallet Mode)

### Add Amoy Testnet to Your Wallet

1. Open your wallet extension
2. Go to Settings > Networks > Add Network
3. Enter the following details:
   - **Network Name**: Polygon Amoy Testnet
   - **RPC URL**: https://rpc-amoy.polygon.technology
   - **Chain ID**: 80002
   - **Currency Symbol**: POL
   - **Block Explorer**: https://amoy.polygonscan.com

## Quick Start

**Important:** Browser tests must be run from the **top level of the monorepo** to properly serve all packages.

1. **Build the package**:
```bash
# From the monorepo root
cd packages/atxp-polygon
npm run build
cd ../..
```

2. **Start the test server from the monorepo root**:
```bash
# From the monorepo root (e.g., atxp-dev-sdk/)
npx -y http-server -p 8000 -c-1 --cors
```

3. **Open the test page**:
   - Navigate to: http://localhost:8000/packages/atxp-polygon/test/browser/manual-test.html

4. **Follow the on-page instructions** to test wallet connection and account initialization

**Why run from the monorepo root?** The test page uses import maps that reference packages with absolute paths like `/packages/atxp-polygon/dist/`. Running the server from the monorepo root ensures these paths resolve correctly.

## Testing Approaches

### Manual HTML Testing

The `test/browser/manual-test.html` file provides a comprehensive interactive testing interface.

#### Running the Manual Test

```bash
# Build the package first
cd packages/atxp-polygon
npm run build
cd ../..

# Start server from monorepo root
npx -y http-server -p 8000 -c-1 --cors
```

Then open http://localhost:8000/packages/atxp-polygon/test/browser/manual-test.html in your browser.

#### Test Flow

1. **Connect Wallet**
   - Click "Connect Wallet"
   - Approve the connection in your wallet extension
   - Verify wallet address is displayed

2. **Configure Account**
   - Select mode (Smart Wallet or Direct Wallet)
   - Choose network (Mainnet or Amoy Testnet)
   - Set allowance (e.g., 10 USDC)
   - Set period (e.g., 30 days)
   - Click "Initialize Account"

3. **Test Smart Wallet Mode**
   - Should create ephemeral wallet
   - Should request spend permission (one-time approval)
   - Should deploy smart wallet
   - Should cache the permission
   - Refresh page - should load from cache without new approvals

4. **Test Direct Wallet Mode**
   - Each operation should require user approval
   - JWT signing should prompt for signature
   - Transfers should require approval

5. **Test Cache Management**
   - Initialize account in Smart Wallet mode
   - Refresh page - should load from cache
   - Click "Clear Cache"
   - Refresh page - should require re-initialization

6. **Monitor Console**
   - All operations are logged in the on-page console
   - Check browser developer console for detailed logs

#### Features of Manual Test Page

- Visual mode selection (Smart vs Direct Wallet)
- Network switching (Mainnet/Testnet)
- Configurable allowance and period
- Real-time logging
- Account information display
- Cache management

### React Component Testing

The `test/browser/PolygonTestComponent.tsx` provides a React component for integration testing.

#### Integration into React App

```typescript
import { PolygonTestComponent } from '@atxp/polygon/test/browser/PolygonTestComponent';

function App() {
  return (
    <div>
      <h1>My App</h1>
      <PolygonTestComponent />
    </div>
  );
}
```

#### Component Features

- Full state management
- TypeScript support
- Error handling
- Real-time logging
- Account information display
- Mode switching
- Network selection
- Cache management

#### Testing in Your App

1. Import the component into your React application
2. Ensure dependencies are installed:
   ```bash
   npm install @atxp/polygon @atxp/common viem react
   ```
3. The component is self-contained and handles all state internally
4. Use it to verify integration with your app's styling and layout

### Unit Testing

The package includes Vitest unit tests that mock the browser environment.

#### Running Unit Tests

```bash
cd packages/atxp-polygon
npm test
```

#### What Unit Tests Cover

- Account initialization (both modes)
- Payment maker functionality
- Caching behavior
- Error handling
- Permission management
- Smart wallet deployment

Unit tests are located in:
- `src/polygonAccount.test.ts`
- `src/polygonPaymentMaker.test.ts`
- `src/mainWalletPaymentMaker.test.ts`

## Testing Checklist

Use this checklist to ensure comprehensive testing coverage:

### Smart Wallet Mode

- [ ] Connect wallet successfully
- [ ] Initialize account with Smart Wallet mode
- [ ] Spend permission request appears and can be approved
- [ ] Smart wallet deployment succeeds
- [ ] Permission is cached to browser storage
- [ ] After refresh, account loads from cache without new approvals
- [ ] Account info displays correct wallet type (Smart)
- [ ] Account ID format is correct (`polygon:0x...`)
- [ ] Sources show correct chain and wallet type
- [ ] Clear cache removes cached data
- [ ] After clearing cache, re-initialization works

### Direct Wallet Mode

- [ ] Connect wallet successfully
- [ ] Initialize account with Direct Wallet mode
- [ ] Account initializes without smart wallet deployment
- [ ] Account info displays correct wallet type (EOA)
- [ ] Account ID format is correct (`polygon:0x...`)
- [ ] Sources show correct chain and wallet type
- [ ] No caching behavior (always uses main wallet)

### Error Handling

- [ ] Error when no wallet extension installed
- [ ] Error when user rejects wallet connection
- [ ] Error when user rejects spend permission (Smart Wallet mode)
- [ ] Error when insufficient USDC balance
- [ ] Error when on wrong network
- [ ] Error messages are clear and actionable

### Network Switching

- [ ] Initialize on Polygon Mainnet (137)
- [ ] Initialize on Polygon Amoy Testnet (80002)
- [ ] Correct USDC addresses used for each network
- [ ] Wallet prompts to switch network if on wrong chain

### Cross-Browser Testing

- [ ] Chrome/Chromium browsers
- [ ] Firefox
- [ ] Brave
- [ ] Edge

### Wallet Compatibility

- [ ] MetaMask
- [ ] Coinbase Wallet
- [ ] WalletConnect
- [ ] Other EIP-1193 compatible wallets

## Troubleshooting

### Common Issues and Solutions

#### "No wallet provider found"

**Problem**: Browser extension not detected

**Solutions**:
- Install MetaMask or Coinbase Wallet extension
- Refresh the page after installation
- Check that extension is enabled
- Try a different browser

#### "Module not found" or Import Errors

**Problem**: ES modules not loading correctly

**Solutions**:
- Ensure you're serving files from the monorepo root (not a subdirectory)
- Build the package: `cd packages/atxp-polygon && npm run build`
- Check that `packages/atxp-polygon/dist/` directory exists
- Verify the server is running from monorepo root: `npx -y http-server -p 8000 -c-1 --cors`
- Don't open HTML directly - must be served via HTTP server
- Check browser console for the exact import path that's failing

#### Initialization Fails

**Problem**: Account initialization throws error

**Solutions**:
- Verify you're on the correct network in your wallet
- Check USDC balance (get testnet tokens from faucet)
- For Direct Wallet mode, ensure you have POL for gas
- Check browser console for detailed error messages
- Try switching to a different network and back

#### Smart Wallet Deployment Fails

**Problem**: Deployment transaction fails or times out

**Solutions**:
- Check network connectivity
- Verify Coinbase CDP bundler is accessible
- Try again (network issues can cause temporary failures)
- Check that Amoy testnet is not experiencing downtime

#### Permission Request Not Showing

**Problem**: Spend permission dialog doesn't appear

**Solutions**:
- Ensure wallet is unlocked
- Try refreshing the page
- Some wallets may not fully support all EIP-1193 methods
- Try Direct Wallet mode instead

#### Cache Not Working

**Problem**: Account doesn't load from cache after refresh

**Solutions**:
- Check browser local storage settings
- Ensure cookies/storage are enabled
- Try a different browser
- Check browser console for storage errors

#### Wrong Network

**Problem**: Wallet is on wrong network

**Solutions**:
- Manually switch network in wallet
- The wallet should prompt to switch automatically
- For Amoy testnet, add the network manually (see Prerequisites)

### Getting Testnet Tokens

**USDC on Amoy Testnet**:
1. Get POL from: https://faucet.polygon.technology
2. Get testnet USDC from Polygon faucet or bridge services
3. Alternatively, use a multi-chain faucet

**POL for Gas** (Direct Wallet Mode only):
1. Visit: https://faucet.polygon.technology
2. Enter your wallet address
3. Select Polygon Amoy testnet
4. Request POL tokens

## Network Information

### Polygon Mainnet (Chain ID: 137)

- **USDC Address**: `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359`
- **RPC URL**: `https://polygon-rpc.com`
- **Explorer**: https://polygonscan.com
- **Currency**: POL

### Polygon Amoy Testnet (Chain ID: 80002)

- **USDC Address**: `0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582`
- **RPC URL**: `https://rpc-amoy.polygon.technology`
- **Explorer**: https://amoy.polygonscan.com
- **Currency**: POL (testnet)
- **Faucet**: https://faucet.polygon.technology

## Best Practices

### Testing Strategy

1. **Start with Amoy Testnet**: Always test on testnet first
2. **Test Both Modes**: Ensure both Smart Wallet and Direct Wallet modes work
3. **Test Error Cases**: Intentionally trigger errors (reject approvals, wrong network, etc.)
4. **Clear Cache Between Tests**: Ensure clean state for each test run
5. **Test Cache Behavior**: Verify caching works correctly for Smart Wallet mode
6. **Cross-Browser Testing**: Test on multiple browsers
7. **Wallet Compatibility**: Test with different wallet extensions

### Security Considerations

- Never commit private keys or seed phrases
- Use testnet for all development and testing
- Only use small amounts on mainnet for testing
- Clear cache when done testing
- Use separate test wallets, not your main wallet

### Performance Testing

- Monitor transaction times
- Check gas usage (Direct Wallet mode)
- Verify smart wallet deployment time
- Test under different network conditions

## Support Resources

- **Package Documentation**: `packages/atxp-polygon/README.md`
- **ATXP Documentation**: https://docs.atxp.ai/
- **Discord Community**: https://discord.gg/FuJXHhe9aW
- **GitHub Issues**: https://github.com/atxp-dev/sdk/issues

## Additional Testing Files

- **HTML Test Page**: `test/browser/manual-test.html`
- **React Component**: `test/browser/PolygonTestComponent.tsx`
- **Browser Test README**: `test/browser/README.md`
- **Unit Tests**: `src/*.test.ts`

## Next Steps

After completing browser testing:

1. Integrate with your application
2. Test with real MCP server and tool calls
3. Implement proper error handling in your UI
4. Add loading states and user feedback
5. Test end-to-end payment flows
6. Monitor transaction success rates
7. Set up error logging and monitoring

For production deployment, refer to the main package README for best practices and configuration options.
