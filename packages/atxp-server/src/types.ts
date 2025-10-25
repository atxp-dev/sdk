import { AuthorizationServerUrl, Currency, Logger, PaymentRequestData, UrlString, OAuthDb, TokenData, OAuthResourceClient, Account } from "@atxp/common";
import { BigNumber } from "bignumber.js";

// https://github.com/modelcontextprotocol/typescript-sdk/blob/c6ac083b1b37b222b5bfba5563822daa5d03372e/src/types.ts
// ctrl+f "method: z.literal(""
export enum McpMethodEnum {
  NotificationsCancelled = 'notifications/cancelled',
  Initialize = 'initialize',
  Ping = 'ping',
  NotificationsProgress = 'notifications/progress',
  ResourcesList = 'resources/list',
  ResourcesTemplatesList = 'resources/templates/list',
  ResourcesRead = 'resources/read',
  NotificationsResourcesListChanged = 'notifications/resources/list_changed',
  ResourcesSubscribe = 'resources/subscribe',
  ResourcesUnsubscribe = 'resources/unsubscribe',
  NotificationsResourcesUpdated = 'notifications/resources/updated',
  PromptsList = 'prompts/list',
  PromptsGet = 'prompts/get',
  NotificationsPromptsListChanged = 'notifications/prompts/list_changed',
  ToolsList = 'tools/list',
  ToolsCall = 'tools/call',
  NotificationsToolsListChanged = 'notifications/tools/list_changed',
  LoggingSetLevel = 'logging/setLevel',
  NotificationsMessage = 'notifications/message',
  SamplingCreateMessage = 'sampling/createMessage',
  ElicitationCreate = 'elicitation/create',
  CompletionComplete = 'completion/complete',
  RootsList = 'roots/list',
  NotificationsRootsListChanged = 'notifications/roots/list_changed'
}
export type McpMethod = `${McpMethodEnum}`;

export type McpName = string;
export type McpNamePattern = McpName | '*';
export type McpOperation = `${McpMethod}` | `${McpMethod}:${McpName}`;
export type McpOperationPattern = McpOperation | '*' | `${McpMethod}:*`;
export type RefundErrors = boolean | 'nonMcpOnly';

// When the server is talking to the ATXP Authorization Server, it doesn't need to provide
// the resource or resourceName - those are already known by the AS, and
// we shouldn't trust the RS to self-report them
export type Charge = Omit<PaymentRequestData, 'resource' | 'resourceName' | 'iss'>;

export type ChargeResponse = {
  success: boolean;
  requiredPayment: PaymentRequestData | null;
}

export type PaymentServer = {
  charge: (args: Charge) => Promise<ChargeResponse>;
  createPaymentRequest: (args: Charge) => Promise<string>;
  validateTransaction?: (
    accountId: string,
    paymentRequestId: string,
    transaction: {
      transactionHash: string;
      fromAddress: string;
      toAddress: string;
      amount: string;
      network: string;
      tokenAddress?: string;
      blockNumber?: number;
      timestamp?: number;
    }
  ) => Promise<{valid: boolean; error?: string; details?: any}>;
}

export type ATXPConfig = {
  destination: Account;
  mountPath: string;
  currency: Currency;
  server: AuthorizationServerUrl;
  payeeName: string;
  // If not provided, the resource will be inferred from the request URL
  resource: UrlString | null;
  allowHttp: boolean;
  //refundErrors: RefundErrors;
  logger: Logger;
  oAuthDb: OAuthDb;
  oAuthClient: OAuthResourceClient;
  paymentServer: PaymentServer;
  minimumPayment?: BigNumber;
}


export enum TokenProblem {
  NO_TOKEN = 'NO-TOKEN',
  NON_BEARER_AUTH_HEADER = 'NON-BEARER-AUTH-HEADER',
  INVALID_TOKEN = 'INVALID-TOKEN',
  INVALID_AUDIENCE = 'INVALID-AUDIENCE',
  NON_SUFFICIENT_FUNDS = 'NON-SUFFICIENT-FUNDS',
  INTROSPECT_ERROR = 'INTROSPECT-ERROR',
}

export type TokenCheckPass = {
  passes: true;
  token: string;
  data: TokenData;
}

export type TokenCheckFail = {
  passes: false;
  problem: TokenProblem;
  token: string | null;
  data: TokenData | null;
  resourceMetadataUrl: string | null;
}

export type TokenCheck = TokenCheckPass | TokenCheckFail;

export type ProtectedResourceMetadata = {
  resource: URL;
  resource_name: string;
  authorization_servers: string[];
  bearer_methods_supported: string[];
  scopes_supported: string[];
}