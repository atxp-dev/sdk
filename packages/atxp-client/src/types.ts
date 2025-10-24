import { BigNumber } from "bignumber.js";
import { AuthorizationServerUrl, Currency, Logger, Network, OAuthDb, FetchLike, Account, PaymentMaker, AccountId, DestinationMaker } from "@atxp/common";
import { ClientOptions } from "@modelcontextprotocol/sdk/client/index.js";
import { Implementation } from "@modelcontextprotocol/sdk/types.js";

// Type definitions for hex strings
export type Hex = `0x${string}`;

type AccountPrefix = Network;
export type AccountIdString = `${AccountPrefix}${string}`;

export type ProspectivePayment = {
  accountId: AccountId;
  resourceUrl: string;
  resourceName: string;
  currency: Currency;
  amount: BigNumber;
  iss: string;
}

export type ClientConfig = {
  mcpServer: string;
  account: Account;
  atxpAccountsServer: string;
  destinationMakers: Map<Network, DestinationMaker>;
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

// ClientArgs for creating clients - required fields plus optional overrides
type RequiredClientConfigFields = 'mcpServer' | 'account';
type RequiredClientConfig = Pick<ClientConfig, RequiredClientConfigFields>;
type OptionalClientConfig = Omit<ClientConfig, RequiredClientConfigFields>;
export type ClientArgs = RequiredClientConfig & Partial<OptionalClientConfig>;

// Type for a fetch wrapper function that takes ClientArgs and returns wrapped fetch
export type FetchWrapper = (config: ClientArgs) => FetchLike;

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
    super(`Payment failed due to network error: ${message}`);
    this.name = 'PaymentNetworkError';
  }
}

// Re-export Account and PaymentMaker for backwards compatibility
export type { Account, PaymentMaker };
