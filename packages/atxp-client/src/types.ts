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

export interface PaymentMaker {
  makePayment: (amount: BigNumber, currency: Currency, receiver: string, memo: string) => Promise<string>;
  generateJWT: (params: {paymentRequestId: string, codeChallenge: string}) => Promise<string>;
}
