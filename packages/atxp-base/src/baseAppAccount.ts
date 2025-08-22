import type { Account, PaymentMaker } from '@atxp/client';
import { USDC_CONTRACT_ADDRESS_BASE } from '@atxp/client';
import { BaseAppPaymentMaker } from './baseAppPaymentMaker.js';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import type { WalletClient } from 'viem';
import { getAddress } from 'viem';
import { base } from 'viem/chains';
import { SpendPermission } from './types.js';
import { IStorage, BrowserStorage, PermissionStorage } from './storage.js';
import { getSmartWalletAddress, createEphemeralSmartWallet, type SmartWalletConfig } from './smartWalletHelpers.js';

const DEFAULT_ALLOWANCE = 10n;
const DEFAULT_PERIOD_IN_DAYS = 7;

export class BaseAppAccount implements Account {
  accountId: string;
  paymentMakers: { [key: string]: PaymentMaker };

  static async initialize(
    baseRPCUrl: string, 
    userWalletAddress: string, 
    walletClient: WalletClient,
    config: {
      appName: string;
      allowance?: bigint;
      periodInDays?: number;
      storage?: IStorage<string>;
      smartWallet: SmartWalletConfig;
    }
  ): Promise<BaseAppAccount> {
    // Validate smart wallet configuration
    if (!config.smartWallet?.apiKey) {
      throw new Error(
        'Smart wallet API key is required. ' +
        'Get your API key from https://portal.cdp.coinbase.com/'
      );
    }
    
    // Initialize storage with type-safe wrapper
    const baseStorage = config?.storage || new BrowserStorage();
    const permissionStorage = new PermissionStorage(baseStorage);
    const storageKey = `atxp-base-permission-${userWalletAddress}`;
    
    // Try to load existing permission
    const storedData = permissionStorage.getPermission(storageKey);
    if (storedData) {
      // Check if permission is not expired
      const now = Math.floor(Date.now() / 1000);
      const permissionEnd = parseInt(storedData.permission.permission.end.toString());
      if (permissionEnd > now) {
        try {
          // IMPORTANT: Check if this is a smart wallet permission
          // In the old EOA approach, the spender was just the ephemeral private key's address
          // In the smart wallet approach, the spender should be a smart wallet address
          const ephemeralEOA = privateKeyToAccount(storedData.privateKey).address;
          const expectedSmartWallet = await getSmartWalletAddress(ephemeralEOA, config.smartWallet);
          
          if (storedData.permission.permission.spender.toLowerCase() === ephemeralEOA.toLowerCase()) {
            // This is an old EOA permission, invalidate it
            console.warn('Found legacy EOA spend permission, clearing it to use smart wallets');
            permissionStorage.removePermission(storageKey);
          } else if (storedData.permission.permission.spender.toLowerCase() === expectedSmartWallet.toLowerCase()) {
            // This is a valid smart wallet permission
            return new BaseAppAccount(baseRPCUrl, storedData.permission, storedData.privateKey, config.smartWallet);
          } else {
            // Unknown spender format, clear it to be safe
            console.warn('Found spend permission with unexpected spender address, clearing it');
            permissionStorage.removePermission(storageKey);
          }
        } catch (error) {
          // Failed to initialize with stored permission, will request new one
          // Permission might be invalid, remove it
          console.error('Failed to validate stored permission:', error);
          permissionStorage.removePermission(storageKey);
        }
      } else {
        // Permission expired, remove it and request new one
        permissionStorage.removePermission(storageKey);
      }
    }

    // this is an "ephemeral" wallet that only ever lives client-side
    // BaseAppPayementMaker uses it to pull funds from the user's wallet
    // and pass them along to the MCP server
    const privateKey = generatePrivateKey();
    
    // For smart wallets, we need to get the counterfactual address
    const signerAddress = privateKeyToAccount(privateKey).address;
    const spenderAddress = await getSmartWalletAddress(signerAddress, config.smartWallet);

    // Create spend permission using wagmi's signTypedData
    const now = Math.floor(Date.now() / 1000);
    const period = (config?.periodInDays ?? DEFAULT_PERIOD_IN_DAYS) * 24 * 60 * 60;
    const end = now + period;
    
    // EIP-712 domain and types for spend permission
    const domain = {
      name: 'SpendPermissionManager',
      version: '1',
      chainId: base.id,
      verifyingContract: getAddress('0xf85210B21cC50302F477BA56686d2019dC9b67Ad'), // SpendPermissionManager on Base
    };

    const types = {
      SpendPermission: [
        { name: 'account', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'token', type: 'address' },
        { name: 'allowance', type: 'uint160' },
        { name: 'period', type: 'uint48' },
        { name: 'start', type: 'uint48' },
        { name: 'end', type: 'uint48' },
        { name: 'salt', type: 'uint256' },
        { name: 'extraData', type: 'bytes' },
      ],
    };

    const permissionData = {
      account: userWalletAddress,
      spender: spenderAddress,
      token: USDC_CONTRACT_ADDRESS_BASE,
      allowance: (config?.allowance ?? DEFAULT_ALLOWANCE).toString(),
      period: period,
      start: now,
      end: end,
      salt: BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)).toString(),
      extraData: '0x',
    };

    // Sign the permission using wagmi wallet client
    const signature = await walletClient.signTypedData({
      account: userWalletAddress as `0x${string}`,
      domain,
      types,
      primaryType: 'SpendPermission',
      message: permissionData,
    });

    const permission: SpendPermission = {
      signature,
      permission: {
        ...permissionData,
        allowance: permissionData.allowance.toString(),
        period: permissionData.period,
        start: permissionData.start,
        end: permissionData.end,
        salt: permissionData.salt.toString(),
      },
      chainId: base.id,
      createdAt: now,
    };

    // store the permission using type-safe storage
    permissionStorage.setPermission(storageKey, {
      privateKey,
      permission,
    });

    // Deploy the smart wallet immediately after creating the spend permission
    // This ensures the smart wallet exists before any spend permission execution
    console.log('Deploying smart wallet to enable spend permissions...');
    try {
      const smartWallet = await createEphemeralSmartWallet(privateKey, config.smartWallet);
      console.log('Smart wallet created at address:', smartWallet.address);
      
      // Send a deployment transaction with a dummy call
      // The paymaster will cover the deployment cost
      // We need at least one call - send 0 ETH to self as a no-op
      console.log('Sending deployment UserOperation...');
      console.log('Bundler URL:', config.smartWallet.bundlerUrl || `https://api.developer.coinbase.com/rpc/v1/base/${config.smartWallet.apiKey}`);
      console.log('Paymaster URL:', config.smartWallet.paymasterUrl || `https://api.developer.coinbase.com/rpc/v1/base/${config.smartWallet.apiKey}`);
      
      const deployTx = await smartWallet.client.sendUserOperation({
        calls: [{
          to: smartWallet.address,
          value: 0n,
          data: '0x' as `0x${string}`
        }]
      });
      
      console.log('Smart wallet deployment UserOperation sent:', deployTx);
      
      // Wait for deployment
      const receipt = await smartWallet.client.waitForUserOperationReceipt({
        hash: deployTx
      });
      
      if (receipt.success) {
        console.log('✅ Smart wallet deployed successfully at:', smartWallet.address);
        console.log('Transaction hash:', receipt.receipt.transactionHash);
      } else {
        console.error('❌ Smart wallet deployment failed:', receipt);
        throw new Error(
          `Smart wallet deployment failed. Receipt: ${JSON.stringify(receipt)}`
        );
      }
    } catch (error) {
      console.error('❌ Failed to deploy smart wallet:', error);
      if (error instanceof Error) {
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        
        // Check for specific AA13 error
        if (error.message.includes('AA13')) {
          console.error('\n⚠️  AA13 Error - Common causes:');
          console.error('1. Paymaster configuration issues');
          console.error('2. Paymaster spending limits exceeded');
          console.error('3. API key invalid or expired');
          console.error('4. Issue with EntryPoint contract version mismatch');
          console.error('\nTo debug:');
          console.error('1. Double-check your paymaster settings at https://portal.cdp.coinbase.com/');
          console.error('   - Is "Allow any contract" actually enabled?');
          console.error('   - Are there any spending limits that might be exceeded?');
          console.error('   - Is the paymaster balance sufficient?');
          console.error('2. Check if your API key is for the correct environment (mainnet vs testnet)');
          console.error('3. Factory contract verified to exist at: 0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985');
          console.error('4. Try increasing gas limits if the issue persists');

        }
      }
      throw new Error(
        `Failed to deploy smart wallet. This is required for spend permissions to work. ` +
        `Original error: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // construct account with the permission
    return new BaseAppAccount(baseRPCUrl, permission, privateKey, config.smartWallet);
  }

  constructor(baseRPCUrl: string, spendPermission: SpendPermission, privateKey: `0x${string}`, smartWalletConfig: SmartWalletConfig) {
    if (!baseRPCUrl) {
      throw new Error('Base RPC URL is required');
    }
    if (!privateKey) {
      throw new Error('Private key (for ephemeral wallet) is required');
    }
    if (!spendPermission) {
      throw new Error('Spend permission is required');
    }
    if (!smartWalletConfig) {
      throw new Error('Smart wallet configuration is required');
    }

    // The accountId is the smart wallet address
    this.accountId = spendPermission.permission.spender;

    this.paymentMakers = {
      'base': new BaseAppPaymentMaker(baseRPCUrl, spendPermission, privateKey, smartWalletConfig),
    }
  }

  /**
   * Clear stored spend permission and ephemeral wallet data for a specific wallet
   * @param userWalletAddress The user's wallet address
   * @param storage Optional storage implementation (defaults to browser localStorage)
   */
  static clearStoredPermission(
    userWalletAddress: string,
    storage?: IStorage<string>
  ): void {
    const baseStorage = storage || new BrowserStorage();
    const permissionStorage = new PermissionStorage(baseStorage);
    const storageKey = `atxp-base-permission-${userWalletAddress}`;
    
    permissionStorage.removePermission(storageKey);
    console.log(`Cleared spend permission for wallet ${userWalletAddress}`);
  }

  /**
   * Clear all ATXP-related data from storage
   * This includes spend permissions and any OAuth tokens
   * @param storage Optional storage implementation (defaults to browser localStorage)
   */
  static clearAllStoredData(storage?: IStorage<string>): void {
    if (typeof window === 'undefined') {
      console.warn('clearAllStoredData is only available in browser environments');
      return;
    }

    const keysToRemove: string[] = [];
    
    // Find all ATXP-related keys
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.includes('atxp') || key.startsWith('0x'))) {
        keysToRemove.push(key);
      }
    }
    
    // Remove identified keys
    console.log(`Clearing ${keysToRemove.length} ATXP-related storage keys`);
    keysToRemove.forEach(key => {
      console.log('Removing:', key);
      localStorage.removeItem(key);
    });
    
    console.log('All ATXP-related data cleared from storage');
  }
}