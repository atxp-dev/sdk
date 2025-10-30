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

async function testPolygonPayment() {
  console.log('\n=== Testing Polygon Chain Payment ===');

  const polygonRpc = process.env.POLYGON_RPC || 'https://polygon-rpc.com';
  const polygonPrivateKey = process.env.POLYGON_PRIVATE_KEY;

  if (!polygonPrivateKey) {
    console.log('Skipping Polygon test - POLYGON_PRIVATE_KEY not set');
    return;
  }

  try {
    const account = new PolygonAccount(polygonRpc, polygonPrivateKey as `0x${string}`, 137);
    console.log('Using Polygon account:', account.accountId);

    const mcpClient = await atxpClient({
      mcpServer: 'http://localhost:3009',
      account,
      allowedAuthorizationServers: ['http://localhost:3010', 'https://auth.atxp.ai'],
      allowHttp: true,
      logger: new ConsoleLogger({level: LogLevel.INFO})
    });

    console.log('Calling multi-chain-tool with Polygon account...');
    const result = await mcpClient.callTool({
      name: 'multi-chain-tool',
      arguments: { message: 'Hello from Polygon!' }
    });

    console.log('Polygon payment result:', result);
  } catch (error) {
    console.error('Polygon payment failed:', error);
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

  // Test Polygon payment
  await testPolygonPayment();

  console.log('\n====================================');
  console.log('        Test Complete!              ');
  console.log('====================================\n');
  console.log('The same server accepted payments from multiple chains:');
  console.log('- Base (mainnet)');
  console.log('- Solana (mainnet)');
  console.log('- Polygon (mainnet)');
  console.log('\nCheck the accounts-mc service logs to see how it handled different chains.\n');
}

// Run the test
main().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});