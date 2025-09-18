import { BigNumber } from "bignumber.js";
import { AuthorizationServerUrl, Currency, Logger, Network, OAuthDb, FetchLike } from "@atxp/common";
import { ClientOptions } from "@modelcontextprotocol/sdk/client/index.js";
import { Implementation } from "@modelcontextprotocol/sdk/types.js";

// Type definitions for hex strings
export type Hex = `0x${string}`;

type AccountPrefix = Network;
export type AccountIdString = `${AccountPrefix}${string}`;

export type Account = {
  accountId: string;
  paymentMakers: {[key: string]: PaymentMaker};
}

export type ProspectivePayment = {
  accountId: string;
  resourceUrl: string;
  resourceName: string;
  network: Network;
  currency: Currency;
  amount: BigNumber;
  iss: string;
}

export type ClientConfig = {
  mcpServer: string;
  account: Account;
  allowedAuthorizationServers: AuthorizationServerUrl[];
  approvePayment: (payment: ProspectivePayment) => Promise<boolean>;
  oAuthDb: OAuthDb;
  fetchFn: FetchLike;
  oAuthChannelFetch: FetchLike;
  allowHttp: boolean;
  logger: Logger;
  clientInfo: Implementation;
  clientOptions: ClientOptions;
  onAuthorize: (args: { authorizationServer: AuthorizationServerUrl, userId: string }) => Promise<void>;
  onAuthorizeFailure: (args: { authorizationServer: AuthorizationServerUrl, userId: string, error: Error }) => Promise<void>;
  onPayment: (args: { payment: ProspectivePayment }) => Promise<void>;
  onPaymentFailure: (args: { payment: ProspectivePayment, error: Error }) => Promise<void>;
}

export class InsufficientFundsError extends Error {
  constructor(
    public readonly currency: Currency,
    public readonly required: BigNumber,
    public readonly available?: BigNumber,
    public readonly network?: string
  ) {
    const availableText = available ? `, Available: ${available}` : '';
    const networkText = network ? ` on ${network}` : '';
    super(
      `Payment failed due to insufficient ${currency} funds${networkText}. ` +
      `Required: ${required}${availableText}. ` +
      `Please ensure your account has adequate balance before retrying.`
    );
    this.name = 'InsufficientFundsError';
  }
}

export class PaymentNetworkError extends Error {
  constructor(message: string, public readonly originalError?: Error) {
    super(`Payment failed due to network error: ${message}. Please check your network connection and try again.`);
    this.name = 'PaymentNetworkError';
  }
}

export type EIP3009Message = {
  // X402 wrapper fields
  x402Version: number;
  scheme: string;
  network: string;

  // EIP-3009 payload for "exact" scheme
  payload: {
    signature: string;
    authorization: {
      from: string;
      to: string;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: string;
    };
  };
}

export interface PaymentMaker {
  makePayment: (amount: BigNumber, currency: Currency, receiver: string, memo: string) => Promise<string>;
  createPaymentAuthorization: (amount: BigNumber, currency: Currency, receiver: string, memo: string) => Promise<EIP3009Message>;
  generateJWT: (params: {paymentRequestId: string, codeChallenge: string}) => Promise<string>;
}
