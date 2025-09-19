#!/usr/bin/env node
import { atxpClient, BaseAccount } from "@atxp/client";
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

  console.log("X402 Test Client (without payments)");
  console.log(`Server: ${serverUrl}`);

  //const account = new ATXPAccount(process.env.ATXP_CONNECTION_STRING!);
  const account = new BaseAccount(process.env.BASE_RPC!, process.env.BASE_PRIVATE_KEY! as `0x${string}`);
  const mcpClient = await atxpClient({
    mcpServer: serverUrl,
    account,
    allowedAuthorizationServers: ['http://localhost:3010', 'https://auth.atxp.ai', 'https://atxp-accounts-staging.onrender.com/'],
    allowHttp: true,
    logger: new ConsoleLogger({level: LogLevel.DEBUG})
  });
  const res = await mcpClient.callTool({
    name: "secure-data",
    arguments: { message: "blockchain metrics" }
  });
  
  console.log('Result:', res);

}

main().catch(console.error);