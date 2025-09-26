# ATXP Base

ATXP is a framework for building and running agents that can interact with the world. See [docs.atxp.ai](https://docs.atxp.ai) for documentation and examples.

ATXP Base provides a `BaseAppAccount` implementation for using `@atxp/client` with [Base Mini Apps](https://www.base.org/build/mini-apps).

## Support

For detailed API documentation, configuration options, and advanced usage patterns, please refer to our [complete documentation](https://docs.atxp.ai/).

Have questions or need help? Join our [Discord community](https://discord.gg/FuJXHhe9aW) - we're happy to help!

## Initializing the account
In your Base Mini App's React code:
```
import { BaseAppAccount } from "@atxp/base";

// This example uses wagmi to fetch the user wallet address, but any 
// equivalent method that returns the address should work
import { useAccount } from "wagmi"; 
const { address } = useAccount();

// Base mini app API key from the Coinbase Developer Portal
const apiKey = process.env.NEXT_PUBLIC_ONCHAINKIT_API_KEY!;

const account = await BaseAppAccount.initialize({
  walletAddress: address,
  apiKey,
  appName: 'Mini App ATXP',
  useEphemeralWallet: false, // Temporary - see Non ephemeral wallet mode below
  // Parameters for the spend permission (see How it works below)
  allowance: BigInt('10000000'), // 10 USDC
  periodInDays: 30,
});

// Then, use the account as you would any other Account - see
// docs.atxp.ai for full docs and examples
const client = atxpClient({
  account,
  mcpServer: 'https://browse.mcp.atxp.ai/'
});
const res = await client.callTool({
  name: 'atxp_browse', 
  {query: 'How do I make a mini app?'}
);
```

## Non ephemeral wallet mode
You can disabled ephemeral wallets and use the user's main wallet for all actions by passing the parameter `useEphemeralWallet: false` to the `BaseAppAccount.initialize` call. If not provided, it defaults to `true`.

Note that the UX is degraded in this mode - users are prompted to verify every transaction, and every signature. So that's 1 verification on accessing the MCP server at all, and 2 more (transaction plus sign JWT) for each transaction. This mode is intended as an short-term unblock for dev shops building mini-apps while we sort out a longer-term strategy.


## Clearing state
You can reset the BaseAppAccount state for a user by:
```
BaseAppAccount.clearAllStoredData(address);
```

This will wipe any existing spend permission and ephemeral wallet for the given address. It will be automatically re-created the next time you call `BaseAppAccount.iniitalize` for that address.

**Note that this will change the accountId of the user in called MCP servers, so this is recommended mainly for development flows**

The ephemeral account does not store any tokens, so you shouldn't loose access to funds by doing this. There is a small ETH gas cost to creating the spend permission and ephemeral wallet, though. 


## How it works
When you call `BaseAppAccount.initialize` for the first time, it will:
1. Create a new ephemeral smart wallet for the user for this mini-app.
2. Create a new [Spend Permission](https://docs.base.org/base-account/improve-ux/spend-permissions) for the ephemeral wallet, and ask the user to approve it. (Using this approach means that the user only has to approve once up-front, instead of approving every single ATXP transaction as they occur)
3. Deploy the ephemeral wallet
4. Store the permission and wallet in LocalStorage for subsequent use

Subsequent calls to `BaseAppAccount.initialize` will load the stored Spend Permission and ephemeral wallet from LocalStorage so they don't need to be recreated.

When authenticating to an MCP server, `BaseAppAccount` will use the address of the ephemeral wallet.

When an MCP request requires payment, `BaseAppAccount` will:
1. Use the ephemeral wallet to make a payment from the user's wallet to the destiniation using the Spend Permission
2. It will use ATXP's paymaster, so all gas fees are paid by ATXP.

The ephemeral wallet never holds any ETH or USDC.
