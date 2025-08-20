# @atxp/base

For use within [Base Mini Apps](https://docs.base.org/mini-apps/overview)

## Example

```
// Import the ATXP client SDK
import { atxpClient } from '@atxp/client';
import { BaseAppAccount } from '@atxp/base';
import { getCryptoKeyAccount } from "@base-org/account";

// (rate limited, use a different node in production)
const BASE_RPC_URL = 'https://mainnet.base.org';

// IMPORTANT:
// all of the following code requires the user to
// have connected their Base wallet to the app

const account = await getCryptoKeyAccount();
const userWalletAddress = account.account?.address
if (!userWalletAddress) {
  throw new Error("No user wallet address found—please ensure that the user's wallet is connected");
}

// this will prompt the user for a spend permission if
// none is found in local storage
const baseAppAccount = await BaseAppAccount.initialize
  BASE_RPC_URL,
  userWalletAddress,
  // optional config
  {
    appName: 'My Mini App', // displayed to the user when requesting spend permission
    allowance: 10n, // requesting 10 USDC for each period
    periodInDays: 7, // periods renew every 7 days
  }
);

// Now you can create an ATXP client which
// pulls funds from the user's wallet as needed
const client = await atxpClient({
  mcpServer: browseService.mcpServer,
  account: baseAppAccount,
});
```