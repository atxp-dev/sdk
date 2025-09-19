import { atxpClient, ATXPAccount, RemoteSigner, type FetchWrapper, type ClientConfig, wrapWithATXP, type FetchLike } from "@atxp/client";
import { wrapWithX402 } from "@atxp/x402";
import { ConsoleLogger, LogLevel } from '@atxp/common';
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from current directory first, then from repo root
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function testMCPServer() {
  const serverUrl = process.env.X402_SERVER_URL || "http://localhost:3001/mcp";
  const signerUrl = process.env.ATXP_REMOTE_SIGNER_URL || "http://localhost:3002";

  console.log("Testing X402 MCP Server with ATXP Client");
  console.log(`Server URL: ${serverUrl}`);
  console.log(`Remote Signer URL: ${signerUrl}`);

  try {
    // Create a remote signer that delegates to accounts-x402
    const remoteSigner = new RemoteSigner(signerUrl);

    // Get account info from remote signer
    const accountInfo = await remoteSigner.getAccountInfo();
    console.log(`Using account: ${accountInfo.accountId}`);
    console.log(`Account address: ${accountInfo.address}`);

    // Create ATXP account with remote signer
    const account = new ATXPAccount({
      accountId: accountInfo.accountId,
      remoteSigner
    });

    // Create a logger
    const logger = new ConsoleLogger({ prefix: '[X402 MCP Client]', level: LogLevel.DEBUG });

    // Create base config
    const config: ClientConfig = {
      mcpServer: serverUrl,
      account,
      logger,
      fetchFn: fetch as FetchLike,
      oAuthChannelFetch: fetch as FetchLike,
      oAuthDb: undefined as any, // Will be set by buildClientConfig
      allowedAuthorizationServers: [],
      allowHttp: true, // Allow HTTP for local testing
      clientInfo: {
        name: "x402-test-client",
        version: "1.0.0"
      },
      clientOptions: {
        capabilities: {}
      },
      approvePayment: async (payment) => {
        console.log(`\n💰 Payment approval requested:`);
        console.log(`  Amount: ${payment.amount} ${payment.currency}`);
        console.log(`  To: ${payment.iss}`);
        console.log(`  Network: ${payment.network}`);
        console.log(`  Auto-approving payment...`);
        return true;
      },
      onAuthorize: async () => {},
      onAuthorizeFailure: async () => {},
      onPayment: async (args) => {
        console.log(`✅ Payment successful for ${args.payment.amount} ${args.payment.currency}`);
      },
      onPaymentFailure: async (args) => {
        console.error(`❌ Payment failed:`, args.error.message);
      }
    };

    // Compose the wrappers manually
    // First apply X402 wrapper, then ATXP wrapper
    let wrappedFetch: FetchLike = config.fetchFn;

    // Apply X402 wrapper first (handles 402 payment challenges)
    wrappedFetch = wrapWithX402({ ...config, fetchFn: wrappedFetch });

    // Apply ATXP wrapper next (handles OAuth and ATXP payments)
    wrappedFetch = wrapWithATXP({ ...config, fetchFn: wrappedFetch });

    // Create client with the composed wrapped fetch
    const client = await atxpClient({
      ...config,
      fetchFn: wrappedFetch
    });

    console.log("\n📡 Connected to MCP server");

    // List available tools
    console.log("\n🔧 Listing available tools...");
    const toolsResult = await client.listTools();
    console.log(`Available tools:`);
    for (const tool of toolsResult.tools) {
      console.log(`  - ${tool.name}: ${tool.description}`);
    }

    // Call the get_premium_data tool
    console.log("\n📊 Calling get_premium_data tool...");
    const dataResult = await client.callTool("get_premium_data", {
      query: "blockchain metrics"
    });
    console.log("Result:", dataResult.content[0].text);

    // Call the calculate_cost tool
    console.log("\n🧮 Calling calculate_cost tool...");
    const calcResult = await client.callTool("calculate_cost", {
      amount: 100,
      rate: 0.15
    });
    console.log("Result:", calcResult.content[0].text);

    console.log("\n✨ All tests completed successfully!");

    // Close the client
    await client.close();

  } catch (error) {
    console.error("\n❌ Error:", error);
    if (error instanceof Error && error.message.includes("402")) {
      console.error("Payment was required but failed. Check your account balance.");
    }
    process.exit(1);
  }
}

// Run the test
testMCPServer().catch(console.error);