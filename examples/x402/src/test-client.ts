#!/usr/bin/env node
import { atxpClient, ATXPAccount, RemoteSigner } from "@atxp/client";
import { wrapWithX402 } from "@atxp/x402";
import { ConsoleLogger, LogLevel } from '@atxp/common';
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  const serverUrl = process.env.X402_SERVER_URL || "http://localhost:3001";
  const signerUrl = process.env.ATXP_REMOTE_SIGNER_URL || "http://localhost:3002";

  console.log("🚀 X402 MCP Client Example");
  console.log(`📡 Server: ${serverUrl}`);

  // Create account with remote signer
  const remoteSigner = new RemoteSigner(signerUrl);
  const accountInfo = await remoteSigner.getAccountInfo();
  const account = new ATXPAccount({
    accountId: accountInfo.accountId,
    remoteSigner
  });

  // Create config
  const config = {
    mcpServer: serverUrl,
    account,
    logger: new ConsoleLogger({ prefix: '[X402]', level: LogLevel.INFO }),
    approvePayment: async () => {
      console.log(`💰 Auto-approving X402 payment...`);
      return true;
    }
  };

  // Create client with X402 wrapper for payment support
  const client = await atxpClient({
    ...config,
    fetchFn: wrapWithX402(config)
  });

  try {
    // Call the tool (will trigger X402 payment)
    const result = await client.callTool("get_data", { query: "blockchain metrics" });
    console.log(`\n📊 Result: ${result.content[0].text}`);
    console.log("\n✅ Success!");
  } finally {
    await client.close();
  }
}

main().catch(console.error);