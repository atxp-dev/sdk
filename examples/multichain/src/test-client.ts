/* eslint-disable no-console */
import { atxpClient, BaseAccount, SolanaAccount } from '@atxp/client';
import { PolygonAccount } from '@atxp/polygon';
import { ConsoleLogger, LogLevel } from '@atxp/common';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function testBasePayment() {
  console.log('\n=== Testing Base Chain Payment ===');

  const baseRpc = process.env.BASE_RPC;
  const basePrivateKey = process.env.BASE_PRIVATE_KEY;

  if (!baseRpc || !basePrivateKey) {
    console.log('Skipping Base test - BASE_RPC or BASE_PRIVATE_KEY not set');
    return;
  }

  try {
    const account = new BaseAccount(baseRpc, basePrivateKey as `0x${string}`);
    console.log('Using Base account:', account.accountId);

    const mcpClient = await atxpClient({
      mcpServer: 'http://localhost:3009',
      account,
      allowedAuthorizationServers: ['http://localhost:3010', 'https://auth.atxp.ai'],
      allowHttp: true,
      logger: new ConsoleLogger({level: LogLevel.INFO})
    });

    console.log('Calling multi-chain-tool with Base account...');
    const result = await mcpClient.callTool({
      name: 'multi-chain-tool',
      arguments: { message: 'Hello from Base chain!' }
    });

    console.log('Base payment result:', result);
  } catch (error) {
    console.error('Base payment failed:', error);
  }
}

async function testSolanaPayment() {
  console.log('\n=== Testing Solana Chain Payment ===');

  const solanaEndpoint = process.env.SOLANA_ENDPOINT;
  const solanaPrivateKey = process.env.SOLANA_PRIVATE_KEY;

  if (!solanaEndpoint || !solanaPrivateKey) {
    console.log('Skipping Solana test - SOLANA_ENDPOINT or SOLANA_PRIVATE_KEY not set');
    return;
  }

  try {
    const account = new SolanaAccount(solanaEndpoint, solanaPrivateKey);
    console.log('Using Solana account:', account.accountId);

    const mcpClient = await atxpClient({
      mcpServer: 'http://localhost:3009',
      account,
      allowedAuthorizationServers: ['http://localhost:3010', 'https://auth.atxp.ai'],
      allowHttp: true,
      logger: new ConsoleLogger({level: LogLevel.INFO})
    });

    console.log('Calling multi-chain-tool with Solana account...');
    const result = await mcpClient.callTool({
      name: 'multi-chain-tool',
      arguments: { message: 'Hello from Solana!' }
    });

    console.log('Solana payment result:', result);
  } catch (error) {
    console.error('Solana payment failed:', error);
  }
}

async function testPolygonAmoyPayment() {
  console.log('\n=== Testing Polygon Amoy Testnet Payment ===');

  const polygonRpc = process.env.POLYGON_AMOY_RPC || 'https://rpc-amoy.polygon.technology';
  const polygonPrivateKey = process.env.POLYGON_AMOY_PRIVATE_KEY;

  if (!polygonPrivateKey) {
    console.log('Skipping Polygon Amoy test - POLYGON_AMOY_PRIVATE_KEY not set');
    console.log('To test Polygon Amoy:');
    console.log('1. Get test MATIC from: https://faucets.chain.link/polygon-amoy');
    console.log('2. Get test USDC on Amoy testnet');
    console.log('3. Set POLYGON_AMOY_PRIVATE_KEY in .env');
    return;
  }

  try {
    const account = new PolygonAccount(polygonRpc, polygonPrivateKey as `0x${string}`, 80002);
    console.log('Using Polygon Amoy account:', account.accountId);
    console.log('Chain ID: 80002 (Polygon Amoy Testnet)');
    console.log('RPC:', polygonRpc);

    const mcpClient = await atxpClient({
      mcpServer: 'http://localhost:3009',
      account,
      allowedAuthorizationServers: ['http://localhost:3010', 'https://auth.atxp.ai'],
      allowHttp: true,
      logger: new ConsoleLogger({level: LogLevel.INFO})
    });

    console.log('Calling multi-chain-tool with Polygon Amoy account...');
    const result = await mcpClient.callTool({
      name: 'multi-chain-tool',
      arguments: { message: 'Hello from Polygon Amoy testnet!' }
    });

    console.log('Polygon Amoy payment result:', result);
    console.log('✅ Polygon Amoy testnet payment successful!');
  } catch (error) {
    console.error('Polygon Amoy payment failed:', error);
  }
}

async function main() {
  console.log('====================================');
  console.log('   Multichain Payment Test Client   ');
  console.log('====================================');
  console.log('\nThis test will demonstrate payments from different blockchain networks');
  console.log('to the same ATXP-enabled server.\n');

  console.log('Prerequisites:');
  console.log('1. Start the multichain server: npm start');
  console.log('2. Configure .env with your wallet private keys\n');

  // Test Base payment
  await testBasePayment();

  // Small delay between tests
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Test Solana payment
  await testSolanaPayment();

  // Small delay between tests
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Test Polygon Amoy payment
  await testPolygonAmoyPayment();

  console.log('\n====================================');
  console.log('        Test Complete!              ');
  console.log('====================================\n');
  console.log('The same server accepted payments from multiple chains:');
  console.log('- Base (mainnet)');
  console.log('- Solana (mainnet)');
  console.log('- Polygon Amoy (testnet)');
  console.log('\nCheck the accounts-mc service logs to see how it handled different chains.\n');
}

// Run the test
main().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});