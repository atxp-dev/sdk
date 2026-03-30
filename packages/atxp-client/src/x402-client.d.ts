// Type declarations for x402/client dynamic import
// The x402 package uses .mts types which require moduleResolution: "bundler"
// Since atxp-client uses moduleResolution: "node", we declare the types here
declare module 'x402/client' {
  export interface PaymentRequirements {
    network: string;
    scheme: string;
    payTo: string;
    maxAmountRequired: string | number;
    description?: string;
    [key: string]: unknown;
  }

  export function selectPaymentRequirements(
    accepts: unknown[],
    preferredNetwork: string,
    preferredScheme: string
  ): PaymentRequirements | null;

  export function createPaymentHeader(
    signer: unknown,
    version: number,
    requirements: PaymentRequirements
  ): Promise<string>;
}
