import { BigNumber } from 'bignumber.js';

export const DEFAULT_AUTHORIZATION_SERVER = 'https://auth.atxp.ai';

export const DEFAULT_ATXP_ACCOUNTS_SERVER = 'https://accounts.atxp.ai';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export type Logger = {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

export type UrlString = `http://${string}` | `https://${string}`;
export type AuthorizationServerUrl = UrlString;

// Enums provide runtime access to valid values
export enum CurrencyEnum {
  USDC = 'USDC'
}
export type Currency = `${CurrencyEnum}`;

export enum NetworkEnum {
  Solana = 'solana',
  Base = 'base',
  World = 'world',
  BaseSepolia = 'base_sepolia',
  WorldSepolia = 'world_sepolia',
  ATXP = 'atxp'
}
export type Network = `${NetworkEnum}`;

export enum ChainEnum {
  Solana = 'solana',
  Base = 'base',
  World = 'world',
  BaseSepolia = 'base_sepolia',
  WorldSepolia = 'world_sepolia'
}
export type Chain = `${ChainEnum}`;

export enum WalletTypeEnum {
  EOA = 'eoa',
  Smart = 'smart'
}
export type WalletType = `${WalletTypeEnum}`;

// Globally unique account identifier format: network:address
export type AccountId = `${Network}:${string}`;

export type Source = {
  address: string;
  chain: Chain;
  walletType: WalletType;
}

export type PaymentRequestOption = {
  network: Network;
  currency: Currency;
  address: string;
  amount: BigNumber;
}

export type Destination = {
  chain: Chain;
  currency: Currency;
  address: string;
  amount: BigNumber;
}

export type PaymentRequestData = {
  // New multi-destination format
  destinations?: PaymentRequestOption[];
  // Legacy single destination fields (for backwards compatibility)
  amount?: BigNumber;
  currency?: Currency;
  network?: Network;
  destination?: string;
  // Common fields
  source: string;
  sourceAccountId?: AccountId | null;
  destinationAccountId?: AccountId | null;
  resource: URL;
  resourceName: string;
  payeeName?: string | null;
  iss: string;
}


export type CustomJWTPayload = {
  code_challenge?: string;
  payment_request_id?: string;
  account_id?: AccountId;
}

export type ClientCredentials = {
  clientId: string,
  clientSecret: string,
  redirectUri: string
};

export type PKCEValues = {
  codeVerifier: string,
  codeChallenge: string,
  resourceUrl: string,
  url: string
};

export type AccessToken = {
  accessToken: string,
  refreshToken?: string,
  expiresAt?: number,
  resourceUrl: string
};

export interface OAuthResourceDb {
  getClientCredentials(serverUrl: string): Promise<ClientCredentials | null>;
  saveClientCredentials(serverUrl: string, credentials: ClientCredentials): Promise<void>;
  close(): Promise<void>;
}

export interface OAuthDb extends OAuthResourceDb {
  getPKCEValues(userId: string, state: string): Promise<PKCEValues | null>;
  savePKCEValues(userId: string, state: string, values: PKCEValues): Promise<void>;
  getAccessToken(userId: string, url: string): Promise<AccessToken | null>;
  saveAccessToken(userId: string, url: string, token: AccessToken): Promise<void>;
}

export type TokenData = {
  active: boolean,
  scope?: string,
  sub?: string,
  aud?: string|string[],
}

// This should match MCP SDK's version, however they don't export it
export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

export type RequirePaymentConfig = {
  price: BigNumber;
  getExistingPaymentId?: () => Promise<string | null>;
}

export interface PaymentMaker {
  makePayment: (amount: BigNumber, currency: Currency, receiver: string, memo: string, paymentRequestId?: string) => Promise<string>;
  generateJWT: (params: {paymentRequestId: string, codeChallenge: string, accountId?: AccountId | null}) => Promise<string>;
  getSourceAddress: (params: {amount: BigNumber, currency: Currency, receiver: string, memo: string}) => string | Promise<string>;
}

export interface DestinationMaker {
  makeDestinations: (option: PaymentRequestOption, logger: Logger) => Promise<Destination[]>;
}

export type Account = {
  accountId: AccountId;
  paymentMakers: {[key: string]: PaymentMaker};
}

/**
 * Extract the address portion from a fully-qualified accountId
 * @param accountId - Format: network:address
 * @returns The address portion
 */
export function extractAddressFromAccountId(accountId: AccountId): string {
  const parts = accountId.split(':');
  if (parts.length !== 2) {
    throw new Error(`Invalid accountId format: ${accountId}. Expected format: network:address`);
  }
  return parts[1];
}

/**
 * Extract the network portion from a fully-qualified accountId
 * @param accountId - Format: network:address
 * @returns The network portion
 */
export function extractNetworkFromAccountId(accountId: AccountId): Network {
  const parts = accountId.split(':');
  if (parts.length !== 2) {
    throw new Error(`Invalid accountId format: ${accountId}. Expected format: network:address`);
  }
  return parts[0] as Network;
}
