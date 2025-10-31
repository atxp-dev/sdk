/* eslint-disable no-console */
/**
 * Quick verification script to check Polygon wallet setup
 * Run: npx tsx verify-polygon-setup.ts
 */
import { PolygonServerAccount } from '@atxp/polygon';
import { POLYGON_MAINNET, getPolygonUSDCAddress } from '@atxp/client';
import dotenv from 'dotenv';
import { createPublicClient, http, formatUnits } from 'viem';
import { polygon } from 'viem/chains';

dotenv.config();

const USDC_ABI = [
  {
    constant: true,
    inputs: [{ name: '_owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: 'balance', type: 'uint256' }],
    type: 'function',
  },
] as const;

async function verifySetup() {
  console.log('========================================');
  console.log('   Polygon Wallet Setup Verification   ');
  console.log('========================================\n');

  // Check environment variables
  const polygonRpc = process.env.POLYGON_RPC || 'https://polygon-rpc.com';
  const polygonPrivateKey = process.env.POLYGON_PRIVATE_KEY;

  if (!polygonPrivateKey) {
    console.error('❌ POLYGON_PRIVATE_KEY not set in .env file');
    console.log('\nPlease add your private key to .env:');
    console.log('POLYGON_PRIVATE_KEY=0x_your_private_key_here\n');
    process.exit(1);
  }

  console.log('✅ Environment variables configured');
  console.log(`   RPC: ${polygonRpc}`);

  // Create account
  let account: PolygonServerAccount;
  try {
    account = new PolygonServerAccount(polygonRpc, polygonPrivateKey as `0x${string}`, 137);
    console.log(`✅ Polygon account created`);
    console.log(`   Account ID: ${account.accountId}\n`);
  } catch (error) {
    console.error('❌ Failed to create Polygon account:', error);
    process.exit(1);
  }

  // Get wallet address
  const sources = await account.getSources();
  if (sources.length === 0) {
    console.error('❌ No sources found');
    process.exit(1);
  }

  const walletAddress = sources[0].address as `0x${string}`;
  console.log('📍 Wallet Address:', walletAddress);
  console.log(`   View on PolygonScan: https://polygonscan.com/address/${walletAddress}\n`);

  // Check chain configuration
  console.log('🔗 Chain Configuration:');
  console.log(`   Network: ${POLYGON_MAINNET.name}`);
  console.log(`   Chain ID: ${POLYGON_MAINNET.id}`);
  console.log(`   Native Currency: ${POLYGON_MAINNET.nativeCurrency.symbol}`);
  console.log(`   Block Explorer: ${POLYGON_MAINNET.blockExplorers.default.url}\n`);

  // Create public client to check balances
  const publicClient = createPublicClient({
    chain: polygon,
    transport: http(polygonRpc),
  });

  // Check POL balance
  console.log('💰 Checking Balances...\n');
  try {
    const polBalance = await publicClient.getBalance({ address: walletAddress });
    const polFormatted = formatUnits(polBalance, 18);
    console.log(`   POL Balance: ${polFormatted} POL`);

    if (parseFloat(polFormatted) < 0.01) {
      console.log('   ⚠️  Warning: Low POL balance. You need POL for gas fees.');
      console.log('   💡 Get POL from an exchange or bridge');
    } else {
      console.log('   ✅ Sufficient POL for gas fees');
    }
  } catch (error) {
    console.error('   ❌ Failed to check POL balance:', error);
  }

  // Check USDC balance
  const usdcAddress = getPolygonUSDCAddress(137);
  console.log(`\n   USDC Contract: ${usdcAddress}`);

  try {
    const usdcBalance = await publicClient.readContract({
      address: usdcAddress as `0x${string}`,
      abi: USDC_ABI,
      functionName: 'balanceOf',
      args: [walletAddress],
    });

    const usdcFormatted = formatUnits(usdcBalance, 6); // USDC has 6 decimals
    console.log(`   USDC Balance: ${usdcFormatted} USDC`);

    if (parseFloat(usdcFormatted) < 1) {
      console.log('   ⚠️  Warning: Low or no USDC balance. You need USDC to make payments.');
      console.log('   💡 Get USDC from an exchange or bridge to Polygon');
    } else {
      console.log('   ✅ Sufficient USDC for payments');
    }
  } catch (error) {
    console.error('   ❌ Failed to check USDC balance:', error);
  }

  console.log('\n========================================');
  console.log('            Setup Summary               ');
  console.log('========================================\n');

  console.log('Next steps:');
  console.log('1. Make sure you have POL for gas fees');
  console.log('2. Make sure you have USDC for payments');
  console.log('3. Start the multichain server: npm start');
  console.log('4. Run the test client: npm run test-client\n');

  console.log('For testing, you only need small amounts:');
  console.log('- POL: 0.1-1 POL should be plenty');
  console.log('- USDC: 1-10 USDC for test payments\n');
}

verifySetup().catch((error) => {
  console.error('\n❌ Verification failed:', error);
  process.exit(1);
});
