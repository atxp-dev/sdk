import { BigNumber } from 'bignumber.js';

export const DEFAULT_AUTHORIZATION_SERVER = 'https://auth.atxp.ai';

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

export type Currency = 'USDC';
export type Network = 'solana' | 'base' | 'world' | 'base_sepolia' | 'world_sepolia' | 'atxp';

export type PaymentRequestDestination = {
  network: Network;
  currency: Currency;
  address: string;
  amount: BigNumber;
}

export type PaymentRequestData = {
  // New multi-destination format
  destinations?: PaymentRequestDestination[];
  // Legacy single destination fields (for backwards compatibility)
  amount?: BigNumber;
  currency?: Currency;
  network?: Network;
  destination?: string;
  // Common fields
  source: string;
  sourceAccountId?: string | null;
  destinationAccountId?: string | null;
  resource: URL;
  resourceName: string;
  payeeName?: string | null;
  iss: string;
}

export type CustomJWTPayload = {
  code_challenge?: string;
  payment_request_id?: string;
  account_id?: string;
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
  generateJWT: (params: {paymentRequestId: string, codeChallenge: string, accountId: string | null | undefined}) => Promise<string>;
  getSourceAddress: (params: {amount: BigNumber, currency: Currency, receiver: string, memo: string}) => string | Promise<string>;
}

export type Account = {
  accountId: string;
  paymentMakers: {[key: string]: PaymentMaker};
  network(): Network;
}
