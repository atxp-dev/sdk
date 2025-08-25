// import { 
//   http, 
//   createPublicClient, 
//   type Account,
//   type Address,
//   type LocalAccount,
// } from 'viem';
// import { base } from 'viem/chains';
// import { privateKeyToAccount } from 'viem/accounts';
// import { 
//   toCoinbaseSmartAccount,
//   createBundlerClient,
//   createPaymasterClient,
//   type BundlerClient,
//   type SmartAccount
// } from 'viem/account-abstraction';

// Coinbase CDP Paymaster and Bundler endpoints
// const COINBASE_BUNDLER_URL = 'https://api.developer.coinbase.com/rpc/v1/base';
// const COINBASE_PAYMASTER_URL = 'https://api.developer.coinbase.com/rpc/v1/base';

// export interface EphemeralSmartWallet {
//   address: Address;
//   client: BundlerClient;
//   account: SmartAccount;
//   signer: Account;
// }

// /**
//  * Creates an ephemeral smart wallet with paymaster support
//  */
// export async function toEphemeralSmartWallet(
//   privateKey: `0x${string}`,
//   apiKey: string
// ): Promise<EphemeralSmartWallet> {
//   const signer = privateKeyToAccount(privateKey);
//   
//   const publicClient = createPublicClient({
//     chain: base,
//     transport: http(`${COINBASE_BUNDLER_URL}/${apiKey}`)
//   });
//   
//   // Create the Coinbase smart wallet
//   const account = await toCoinbaseSmartAccount({
//     client: publicClient,
//     owners: [signer],
//     version: '1'
//   });
//   
//   // Create bundler client with paymaster support
//   const bundlerClient = createBundlerClient({
//     account,
//     client: publicClient,
//     transport: http(`${COINBASE_BUNDLER_URL}/${apiKey}`),
//     chain: base,
//     paymaster: true, // Enable paymaster sponsorship
//     paymasterContext: {
//       transport: http(`${COINBASE_PAYMASTER_URL}/${apiKey}`)
//     }
//   });
//   
//   return {
//     address: account.address,
//     client: bundlerClient,
//     account,
//     signer,
//   };
// }

// /**
//  * Gets the counterfactual address for a smart wallet without deploying it
//  */
// /*export async function getSmartWalletAddress(
//   signerOrPrivateKey: Address | `0x${string}`,
//   apiKey: string
// ): Promise<Address> {
//   const publicClient = createPublicClient({
//     chain: base,
//     transport: http(`${COINBASE_BUNDLER_URL}/${apiKey}`)
//   });
//   
//   // Check if we received a private key or just an address
//   let owner: LocalAccount;
//   if (signerOrPrivateKey.length === 66) {
//     // It's a private key
//     owner = privateKeyToAccount(signerOrPrivateKey as `0x${string}`);
//   } else {
//     // It's just an address - we need to return a placeholder
//     // since we can't create a valid account without a private key
//     // This is a limitation of the current Coinbase Smart Wallet implementation
//     console.warn('Cannot compute exact smart wallet address without private key. Using placeholder.');
//     // Return a deterministic but placeholder address
//     return `0x${'0'.repeat(38)}${signerOrPrivateKey.slice(-2)}` as Address;
//   }
//   
//   const smartAccount = await toCoinbaseSmartAccount({
//     client: publicClient,
//     owners: [owner],
//     version: '1'
//   });
//   
//   return smartAccount.address;
// }*/