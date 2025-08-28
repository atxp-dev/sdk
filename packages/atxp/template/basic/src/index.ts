#!/usr/bin/env node

import { atxpClient } from '@atxp/client';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
  try {
    // Check required environment variables
    const requiredEnvVars = ['SOLANA_ENDPOINT', 'SOLANA_PRIVATE_KEY'];
    const missing = requiredEnvVars.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      console.error('❌ Missing required environment variables:', missing.join(', '));
      console.error('Please set them in your .env file');
      process.exit(1);
    }

    console.log('🚀 Starting ATXP Client Demo...');
    console.log('📡 Solana Endpoint:', process.env.SOLANA_ENDPOINT);

    // Create ATXP client
    const client = atxpClient({
      account: 'atxp',
      paymentNetwork: 'solana',
      currency: 'usdc',
      authorizationServer: 'http://localhost:3010'
    });

    console.log('✅ ATXP client created successfully');
    console.log('\n📋 Available commands:');
    console.log('  npm run dev -- [server-url] [tool-name] [args...]');
    console.log('\nExample:');
    console.log('  npm run dev -- http://localhost:3009 hello_world name=Alice');
    
    // If command line arguments are provided, try to make a request
    const args = process.argv.slice(2);
    if (args.length >= 2) {
      const [serverUrl, toolName, ...toolArgs] = args;
      
      console.log(`\n🔗 Connecting to ${serverUrl}`);
      console.log(`🛠️  Calling tool: ${toolName}`);
      
      // Parse tool arguments
      const arguments: Record<string, any> = {};
      toolArgs.forEach(arg => {
        const [key, value] = arg.split('=');
        if (key && value) {
          arguments[key] = value;
        }
      });
      
      if (Object.keys(arguments).length > 0) {
        console.log(`📝 Arguments:`, arguments);
      }

      try {
        const result = await client.tools.call({
          name: toolName,
          arguments
        });
        
        console.log('\n✅ Tool call successful!');
        console.log('📄 Result:', result);
        
      } catch (error) {
        console.error('\n❌ Tool call failed:', error.message);
        if (error.message.includes('payment')) {
          console.log('💡 This might require a payment. Check the server logs for details.');
        }
      }
    } else {
      console.log('\n💡 No arguments provided. The client is ready to use!');
      console.log('   Try running with arguments to test a tool call.');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
