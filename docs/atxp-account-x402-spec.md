# ATXPAccount X402 API Specification

## Overview

This specification defines the API changes needed for the ATXP Account service to support X402 payment protocol. The changes enable signing payment messages without immediate blockchain submission, which is required for X402's facilitator-based settlement model.

## Background

X402 requires clients to:
1. Sign a payment message locally
2. Send the signed message to the resource server
3. Let the facilitator verify and submit to blockchain

The current `/pay` endpoint signs and submits in one step. We need to separate these operations.

## New API Endpoints

### 1. `/sign-payment` - Create Signed Payment Message

**Method:** POST
**Authentication:** Basic Auth (connection token)

**Request Body:**
```json
{
  "amount": "1.00",        // String decimal amount
  "currency": "USDC",      // Currency code
  "receiver": "0x...",     // Recipient address
  "memo": "Payment for..." // Optional memo
}
```

**Response (200 OK):**
```json
{
  "data": "0x...",         // Encoded transaction data
  "signature": "0x...",    // Signed transaction
  "from": "0x...",         // Sender address
  "nonce": 123,            // Transaction nonce
  "gasPrice": "1000000000" // Gas price in wei
}
```

**Error Responses:**
- 400: Invalid parameters
- 401: Unauthorized
- 500: Signing failed

### 2. `/submit-payment` - Submit Pre-signed Payment

**Method:** POST
**Authentication:** Basic Auth (connection token)

**Request Body:**
```json
{
  "signature": "0x...",    // Signed transaction from /sign-payment
  "data": "0x...",         // Transaction data
  "from": "0x...",         // Must match account address
  "to": "0x...",           // Recipient
  "amount": "1.00",        // For validation
  "currency": "USDC",      // For validation
  "network": "base"        // Network identifier
}
```

**Response (200 OK):**
```json
{
  "txHash": "0x..."        // Transaction hash
}
```

**Error Responses:**
- 400: Invalid signature or parameters
- 401: Unauthorized
- 409: Transaction already submitted
- 500: Submission failed

## Implementation Notes

### Signing Without Submission

The `/sign-payment` endpoint should:
1. Validate the account has sufficient balance
2. Build the transaction (data, gas, nonce)
3. Sign the transaction locally
4. Return the signed transaction WITHOUT broadcasting

### Nonce Management

- Track pending nonces to prevent conflicts
- Increment nonce for each signed transaction
- Reset nonce tracking after submission or timeout

### Security Considerations

1. **Replay Protection:** Track submitted signatures to prevent replay
2. **Timeout:** Signed transactions should expire after 5 minutes
3. **Rate Limiting:** Limit signing requests per account
4. **Balance Check:** Always verify balance before signing

## Backwards Compatibility

The existing `/pay` endpoint remains unchanged and continues to sign+submit atomically. It can be implemented as:
```
/pay = /sign-payment + /submit-payment
```

## Migration Path

1. Deploy new endpoints alongside existing `/pay`
2. Update SDK to use new endpoints when X402 is detected
3. Monitor usage and deprecate `/pay` in future version

## Example Usage Flow

```typescript
// 1. Client requests signing
POST /sign-payment
{
  "amount": "0.01",
  "currency": "USDC",
  "receiver": "0x123...",
  "memo": "X402 payment"
}

// 2. Server returns signed message
{
  "signature": "0xabc...",
  "data": "0xdef...",
  "from": "0x456..."
}

// 3. Client sends to X402 server
// (X402 facilitator verifies and settles)

// 4. Optional: Client can also submit directly
POST /submit-payment
{
  "signature": "0xabc...",
  // ... rest of signed message
}
```

## Testing Requirements

1. Test signing without submission
2. Verify nonce increments correctly
3. Test replay protection
4. Verify timeout enforcement
5. Test concurrent signing requests
6. Validate balance checks

## Performance Targets

- `/sign-payment`: < 100ms
- `/submit-payment`: < 2s (includes blockchain confirmation)
- Support 100 concurrent signing operations per account

## Monitoring

Track:
- Signing success/failure rates
- Submission success/failure rates
- Expired signatures count
- Replay attempt count
- Average signing latency