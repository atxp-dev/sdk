/**
 * EIP-1193 compliant Ethereum provider interface
 * Used for browser wallet integrations
 */
export type Eip1193Provider = {
  request: (params: {
    method: string;
    params?: unknown[];
  }) => Promise<unknown>;
};
