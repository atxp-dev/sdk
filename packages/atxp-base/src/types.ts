// source: https://github.com/base/account-sdk/blob/master/packages/account-sdk/src/core/rpc/coinbase_fetchSpendPermissions.ts

/**
 * Represents a spending permission with limits
 */
export type SpendPermission = {
  /** UTC timestamp for when the permission was granted */
  createdAt?: number;
  /** Hash of the permission in hex format */
  permissionHash?: string;
  /** Cryptographic signature in hex format */
  signature: string;
  /** Chain ID */
  chainId?: number;
  /** The permission details */
  permission: {
    /** Wallet address of the account */
    account: string;
    /** Address of the contract/entity allowed to spend */
    spender: string;
    /** Address of the token being spent */
    token: string;
    /** Maximum amount allowed as base 10 numeric string */
    allowance: string;
    /** Time period in seconds */
    period: number;
    /** Start time in unix seconds */
    start: number;
    /** Expiration time in unix seconds */
    end: number;
    /** Salt as base 10 numeric string */
    salt: string;
    /** Additional data in hex format */
    extraData: string;
  };
};

export type Eip1193Provider = {
  request: (params: {
    method: string;
    params?: any[];
  }) => Promise<any>;
};