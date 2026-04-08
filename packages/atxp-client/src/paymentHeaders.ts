import type { AuthorizeResult } from '@atxp/common';

// Re-export AuthorizeResult from common so existing imports keep working
export type { AuthorizeResult } from '@atxp/common';

/**
 * Build protocol-specific payment headers for retrying a request after authorization.
 *
 * @param result - The authorization result containing protocol and credential
 * @param originalHeaders - Optional original request headers to preserve
 * @returns New Headers object with protocol-specific payment headers added
 */
export function buildPaymentHeaders(result: AuthorizeResult, originalHeaders?: HeadersInit): Headers {
  let headers: Headers;
  if (originalHeaders instanceof Headers) {
    headers = new Headers(originalHeaders);
  } else if (originalHeaders) {
    headers = new Headers(originalHeaders as HeadersInit);
  } else {
    headers = new Headers();
  }

  switch (result.protocol) {
    case 'x402':
      headers.set('X-PAYMENT', result.credential);
      headers.set('Access-Control-Expose-Headers', 'X-PAYMENT-RESPONSE');
      break;
    case 'mpp':
      // Use X-MPP-Payment to carry the credential alongside the OAuth Bearer
      // token. Standard MPP uses Authorization: Payment, but the ATXP fetch
      // layer adds Authorization: Bearer for identity — using X-MPP-Payment
      // prevents the two from conflicting.
      headers.set('X-MPP-Payment', result.credential);
      break;
    case 'atxp':
      headers.set('X-ATXP-PAYMENT', result.credential);
      break;
  }

  return headers;
}
