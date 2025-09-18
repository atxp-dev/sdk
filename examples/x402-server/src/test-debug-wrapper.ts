import { BaseAccount } from '@atxp/client';
import { ConsoleLogger, LogLevel } from '@atxp/common';
import { BigNumber } from 'bignumber.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function debugOurImplementation() {
  console.log('=== Debugging Our signTypedData Implementation ===\n');

  if (!process.env.BASE_RPC || !process.env.BASE_PRIVATE_KEY) {
    console.error('Missing BASE_RPC and/or BASE_PRIVATE_KEY');
    process.exit(1);
  }

  const account = new BaseAccount(
    process.env.BASE_RPC,
    process.env.BASE_PRIVATE_KEY
  );

  const logger = new ConsoleLogger({ prefix: '[Debug]', level: LogLevel.DEBUG });

  // Create the exact same authorization parameters that would be created
  const recipient = '0x3214218CdB6A0E5970677CdCa9EB65365eF587fD';
  const amount = new BigNumber('0.01');
  const currency = 'USDC';

  console.log('Creating EIP-3009 authorization with:');
  console.log('  Amount:', amount.toString(), currency);
  console.log('  Recipient:', recipient);
  console.log('  From:', account.accountId);

  // Get the payment maker to see exactly what it's doing
  const paymentMaker = account.paymentMakers['base'];

  try {
    // Create the authorization and log the exact parameters
    console.log('\nCalling createPaymentAuthorization...');
    const authorization = await paymentMaker.createPaymentAuthorization(
      amount,
      currency,
      recipient,
      ''
    );

    console.log('\n=== Authorization Result ===');
    console.log(JSON.stringify(authorization, null, 2));

    // Now let's also look at what parameters were used for signing
    // We'll need to check our BasePaymentMaker implementation
    console.log('\nKey parameters from our implementation:');
    console.log('- validAfter: now');
    console.log('- validBefore: now + 660 seconds (11 minutes)');
    console.log('- nonce: random 32 bytes');
    console.log('- value: amount * 10^6 (USDC decimals)');
    console.log('- chainId: 8453 (Base mainnet)');
    console.log('- verifyingContract: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 (USDC on Base)');
    console.log('- domain.name: "USD Coin"');
    console.log('- domain.version: "2"');

  } catch (error) {
    console.error('Error creating authorization:', error);
  }
}

debugOurImplementation().catch(console.error);