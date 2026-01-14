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
  Polygon = 'polygon',
  BaseSepolia = 'base_sepolia',
  WorldSepolia = 'world_sepolia',
  PolygonAmoy = 'polygon_amoy',
  ATXP = 'atxp'
}
export type Network = `${NetworkEnum}`;

export enum ChainEnum {
  Solana = 'solana',
  Base = 'base',
  World = 'world',
  Polygon = 'polygon',
  BaseSepolia = 'base_sepolia',
  WorldSepolia = 'world_sepolia',
  PolygonAmoy = 'polygon_amoy'
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

export type Destination = {
  chain: Chain;
  currency: Currency;
  address: string;
  amount: BigNumber;
}

export type PaymentRequestOption = {
  network: Network;
  currency: Currency;
  address: string;
  amount: BigNumber;
}

export type PaymentRequest = {
  options: PaymentRequestOption[];
  sourceAccountId: AccountId;
  destinationAccountId: AccountId;
  resource: URL;
  payeeName: string | null;
  iss?: string;
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

export type PaymentIdentifier = {
  transactionId: string;
  transactionSubId?: string;
  chain: Chain;
  currency: Currency;
};

export interface PaymentMaker {
  makePayment: (destinations: Destination[], memo: string, paymentRequestId?: string) => Promise<PaymentIdentifier | null>;
  generateJWT: (params: {paymentRequestId: string, codeChallenge: string, accountId?: AccountId | null}) => Promise<string>;
  getSourceAddress: (params: {amount: BigNumber, currency: Currency, receiver: string, memo: string}) => string | Promise<string>;
}

export interface DestinationMaker {
  makeDestinations: (option: PaymentRequestOption, logger: Logger, paymentRequestId: string, sources: Source[]) => Promise<Destination[]>;
}

/**
 * Minimal interface for payment destinations.
 * Used by server middleware to identify where payments should be sent.
 * Does not require the ability to make payments (no paymentMakers needed).
 */
export interface PaymentDestination {
  getAccountId: () => Promise<AccountId>;
  getSources: () => Promise<Source[]>;
}

/**
 * Full account interface that can both receive and make payments.
 * Extends PaymentDestination so any Account can be used as a destination.
 */
export type Account = PaymentDestination & {
  paymentMakers: PaymentMaker[];
  /**
   * Create a spend permission for the given resource URL.
   * This allows pre-authorizing spending for a specific MCP server during OAuth authorization.
   *
   * @param resourceUrl - The MCP server URL to create a spend permission for
   * @returns The spend permission token, or null if this account type doesn't support spend permissions
   */
  createSpendPermission: (resourceUrl: string) => Promise<string | null>;
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
