/**
 * MPP (Machine Payments Protocol) challenge parsing.
 *
 * MPP challenges come in two forms:
 * 1. HTTP level: HTTP 402 with WWW-Authenticate: Payment header
 * 2. MCP level: JSON-RPC error with code -32042 containing MPP data
 */

export const MPP_ERROR_CODE = -32042;

export interface MPPChallenge {
  id: string;
  method: string;
  intent: string;
  amount: string;
  currency: string;
  network: string;
  recipient: string;
}

const REQUIRED_FIELDS: (keyof MPPChallenge)[] = [
  'id', 'method', 'intent', 'amount', 'currency', 'network', 'recipient'
];

/**
 * Parse MPP challenge from WWW-Authenticate header.
 * Format: Payment method="tempo", intent="charge", id="ch_xxx", ...
 */
export function parseMPPHeader(headerValue: string): MPPChallenge | null {
  if (!headerValue || !headerValue.startsWith('Payment')) {
    return null;
  }

  // Strip leading "Payment" keyword
  const paramString = headerValue.slice('Payment'.length).trim();
  if (!paramString) {
    return null;
  }

  // Parse key="value" pairs
  const params: Record<string, string> = {};
  const regex = /(\w+)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(paramString)) !== null) {
    params[match[1]] = match[2];
  }

  // Validate all required fields are present
  for (const field of REQUIRED_FIELDS) {
    if (!params[field]) {
      return null;
    }
  }

  return {
    id: params.id,
    method: params.method,
    intent: params.intent,
    amount: params.amount,
    currency: params.currency,
    network: params.network,
    recipient: params.recipient,
  };
}

/**
 * Parse MPP challenge from MCP JSON-RPC error data.
 */
export function parseMPPFromMCPError(errorData: unknown): MPPChallenge | null {
  if (typeof errorData !== 'object' || errorData === null) {
    return null;
  }

  const data = errorData as Record<string, unknown>;
  const mpp = data.mpp;

  if (typeof mpp !== 'object' || mpp === null) {
    return null;
  }

  const mppObj = mpp as Record<string, unknown>;

  // Validate all required fields
  for (const field of REQUIRED_FIELDS) {
    if (typeof mppObj[field] !== 'string') {
      return null;
    }
  }

  return {
    id: mppObj.id as string,
    method: mppObj.method as string,
    intent: mppObj.intent as string,
    amount: mppObj.amount as string,
    currency: mppObj.currency as string,
    network: mppObj.network as string,
    recipient: mppObj.recipient as string,
  };
}

/**
 * Check if a Response has an MPP challenge (via WWW-Authenticate header).
 */
export function hasMPPChallenge(response: Response): boolean {
  const header = response.headers.get('WWW-Authenticate');
  if (!header) return false;
  return header.startsWith('Payment');
}

/**
 * Check if a Response body contains an MCP error with MPP data.
 * Clones the response so the original body is not consumed.
 */
export async function hasMPPMCPError(response: Response): Promise<boolean> {
  try {
    const cloned = response.clone();
    const body = await cloned.text();
    if (!body) return false;

    const parsed = JSON.parse(body);

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.error === 'object' &&
      parsed.error !== null &&
      parsed.error.code === MPP_ERROR_CODE
    ) {
      const challenge = parseMPPFromMCPError(parsed.error.data);
      return challenge !== null;
    }

    return false;
  } catch {
    return false;
  }
}
