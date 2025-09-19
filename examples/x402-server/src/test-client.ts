import { atxpClient, ATXPAccount, RemoteSigner } from "@atxp/client";
import { wrapWithX402 } from "@atxp/x402";
import { ConsoleLogger, LogLevel } from '@atxp/common';
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function testMCPServer() {
  const serverUrl = process.env.X402_SERVER_URL || "http://localhost:3001";
  const signerUrl = process.env.ATXP_REMOTE_SIGNER_URL || "http://localhost:3002";

  console.log("Testing X402 MCP Server");
  console.log(`Server: ${serverUrl}`);
  console.log(`Signer: ${signerUrl}`);

  // Create account with remote signer
  const remoteSigner = new RemoteSigner(signerUrl);
  const accountInfo = await remoteSigner.getAccountInfo();
  const account = new ATXPAccount({
    accountId: accountInfo.accountId,
    remoteSigner
  });

  console.log(`Account: ${accountInfo.accountId}`);

  // Create config
  const config = {
    mcpServer: serverUrl,
    account,
    logger: new ConsoleLogger({ prefix: '[X402]', level: LogLevel.INFO }),
    approvePayment: async (payment: any) => {
      console.log(`💰 Approving ${payment.amount} ${payment.currency} to ${payment.iss}`);
      return true;
    }
  };

  // Create client with X402 wrapper
  const client = await atxpClient({
    ...config,
    fetchFn: wrapWithX402(config)
  });

  try {
    // Call the tool
    console.log("\n📊 Calling get_premium_data...");
    const result = await client.callTool("get_premium_data", { query: "blockchain metrics" });
    console.log(result.content[0].text);
    console.log("\n✅ Success!");
  } finally {
    await client.close();
  }
}

testMCPServer().catch(console.error);