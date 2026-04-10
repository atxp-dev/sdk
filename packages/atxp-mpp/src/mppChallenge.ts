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
  /** ISO 8601 expiry. Set by the server for Tempo challenges; required by mppx verify. */
  expires?: string;
  /** Server-defined opaque data for identity recovery on MPP retry requests. */
  opaque?: Record<string, unknown>;
  /** Nested request object. mppx's createCredential reads amount/currency/recipient from here. */
  request?: Record<string, unknown>;
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
    ...(params.expires && { expires: params.expires }),
  };
}

/**
 * Parse a single MPP challenge object (validates required fields).
 */
function parseMppObject(obj: unknown): MPPChallenge | null {
  if (typeof obj !== 'object' || obj === null) return null;
  const mppObj = obj as Record<string, unknown>;
  for (const field of REQUIRED_FIELDS) {
    if (typeof mppObj[field] !== 'string') return null;
  }
  // Spread all fields from the server's challenge JSON, then overlay typed
  // assertions for known fields. This preserves unknown fields (e.g., new
  // server-side additions) so they reach downstream consumers like mppx,
  // while giving known fields their correct types. The MPPChallenge interface
  // does NOT have an index signature, so callers get type safety for known
  // fields and must cast if they need unknown ones.
  // Note: the HTTP header path (parseMPPHeader) can only extract string
  // fields, so complex objects like opaque/request only survive the JSON path.
  return {
    ...mppObj,
    id: mppObj.id as string,
    method: mppObj.method as string,
    intent: mppObj.intent as string,
    amount: mppObj.amount as string,
    currency: mppObj.currency as string,
    network: mppObj.network as string,
    recipient: mppObj.recipient as string,
  } as MPPChallenge;
}

/**
 * Parse MPP challenge from MCP JSON-RPC error data.
 * Returns the first valid challenge found.
 * data.mpp can be a single challenge object or an array of challenges.
 */
export function parseMPPFromMCPError(errorData: unknown): MPPChallenge | null {
  const challenges = parseMPPChallengesFromMCPError(errorData);
  return challenges.length > 0 ? challenges[0] : null;
}

/**
 * Parse ALL MPP challenges from MCP JSON-RPC error data.
 * data.mpp can be a single challenge object or an array of challenges.
 */
export function parseMPPChallengesFromMCPError(errorData: unknown): MPPChallenge[] {
  if (typeof errorData !== 'object' || errorData === null) {
    return [];
  }

  const data = errorData as Record<string, unknown>;
  const mpp = data.mpp;
  if (!mpp) return [];

  // Array of challenges (multi-chain)
  if (Array.isArray(mpp)) {
    const results: MPPChallenge[] = [];
    for (const item of mpp) {
      const parsed = parseMppObject(item);
      if (parsed) results.push(parsed);
    }
    return results;
  }

  // Single challenge (backwards compat)
  const parsed = parseMppObject(mpp);
  return parsed ? [parsed] : [];
}

/**
 * Parse ALL MPP challenges from a comma-separated WWW-Authenticate header value.
 * Per RFC 7235 §4.1, multiple challenges can be comma-separated.
 */
export function parseMPPHeaders(headerValue: string): MPPChallenge[] {
  if (!headerValue) return [];

  // Split on 'Payment' to handle multiple challenges:
  // "Payment method="solana",..., Payment method="tempo",..."
  const parts = headerValue.split(/,\s*(?=Payment\b)/).filter(Boolean);
  const results: MPPChallenge[] = [];
  for (const part of parts) {
    const parsed = parseMPPHeader(part.trim());
    if (parsed) results.push(parsed);
  }
  return results;
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
