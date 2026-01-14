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

/**
 * Rich context provided when a payment fails
 */
export interface PaymentFailureContext {
  /** The payment that failed */
  payment: ProspectivePayment;
  /** The error that caused the failure */
  error: Error;
  /** Networks that were attempted for payment */
  attemptedNetworks: string[];
  /** Map of network to error for each failed attempt */
  failureReasons: Map<string, Error>;
  /** Whether the payment can be retried */
  retryable: boolean;
  /** Timestamp when the failure occurred */
  timestamp: Date;
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
  onPayment: (args: { payment: ProspectivePayment, transactionHash: string, network: string }) => Promise<void>;
  onPaymentFailure: (context: PaymentFailureContext) => Promise<void>;
  /** Optional callback when a single payment attempt fails (before trying other networks) */
  onPaymentAttemptFailed?: (args: { network: string, error: Error, remainingNetworks: string[] }) => Promise<void>;
}

// ClientArgs for creating clients - required fields plus optional overrides
type RequiredClientConfigFields = 'mcpServer' | 'account';
type RequiredClientConfig = Pick<ClientConfig, RequiredClientConfigFields>;
type OptionalClientConfig = Omit<ClientConfig, RequiredClientConfigFields>;
export type ClientArgs = RequiredClientConfig & Partial<OptionalClientConfig>;

// Type for a fetch wrapper function that takes ClientArgs and returns wrapped fetch
export type FetchWrapper = (config: ClientArgs) => FetchLike;

// Re-export error classes from errors.ts
export {
  ATXPPaymentError,
  InsufficientFundsError,
  TransactionRevertedError,
  UnsupportedCurrencyError,
  GasEstimationError,
  RpcError,
  UserRejectedError,
  PaymentServerError,
  PaymentExpiredError,
  PaymentNetworkError
} from './errors.js';

// Re-export Account and PaymentMaker for backwards compatibility
export type { Account, PaymentMaker };
