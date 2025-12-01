import { TokenData, AccountId } from "@atxp/common";
import { ATXPConfig, TokenCheck } from "./types.js";
import { AsyncLocalStorage } from "async_hooks";

const contextStorage = new AsyncLocalStorage<ATXPContext | null>();

type ATXPContext = {
  token: string | null;
  tokenData: TokenData | null;
  config: ATXPConfig;
  resource: URL;
}

export function getATXPConfig(): ATXPConfig | null {
  const context = contextStorage.getStore();
  return context?.config ?? null;
}

export function getATXPResource(): URL | null {
  const context = contextStorage.getStore();
  return context?.resource ?? null;
}

// Helper function to get the current request's user
export function atxpAccountId(): AccountId | null {
  const context = contextStorage.getStore();
  return context?.tokenData?.sub as AccountId | null ?? null;
}

// Helper function to get the current request's token (for on-demand charging)
export function atxpToken(): string | null {
  const context = contextStorage.getStore();
  return context?.token ?? null;
}

// Helper function to run code within a user context
export async function withATXPContext(config: ATXPConfig, resource: URL, tokenInfo: Pick<TokenCheck, 'token' | 'data'> | null, next: () => void): Promise<void> {
  config.logger.debug(`Setting user context to ${tokenInfo?.data?.sub ?? 'null'}`);
  
  if(tokenInfo && tokenInfo.data?.sub) {
    if(tokenInfo.token) {
      const dbData = {
        accessToken: tokenInfo.token!,
        resourceUrl: ''
      };
      // Save the token to the oAuthDB so that other users of the DB can access it
      // if needed (ie, for token-exchange for downstream services)
      await config.oAuthDb.saveAccessToken(tokenInfo.data.sub, '', dbData);
    } else {
      config.logger.warn(`Setting user context with token data, but there was no token provided. This probably indicates a bug, since the data should be derived from the token`);
      config.logger.debug(`Token data: ${JSON.stringify(tokenInfo.data)}`);
    }
  }

  const ctx = {
    token: tokenInfo?.token || null,
    tokenData: tokenInfo?.data || null,
    config,
    resource
  };
  return contextStorage.run(ctx, next);
} 
