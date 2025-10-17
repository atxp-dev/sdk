# Payment Maker Refactor - Architecture Document

## Executive Summary

This document outlines a comprehensive refactor of the Payment Maker architecture in the ATXP SDK. The refactor introduces a flexible, array-based PaymentMaker system with destination mapping capabilities that enables:

1. **Simplified Architecture**: Remove PaymentDestination classes from server packages
2. **Enhanced Flexibility**: Support multiple payment makers with ordered fallback
3. **Clean Stripe Integration**: Replace convoluted Stripe logic with generic destination mapping
4. **Better Separation of Concerns**: Destination mappers on client side handle dynamic address resolution
5. **Backward Compatibility**: Old clients continue to work with new servers

**Version Target**: Minor version bump (e.g., 0.7.x → 0.8.0)

**Critical Success Criteria**: The SDK server should NEVER call the account service. Server only provides account configuration. ALL account service calls happen in client SDK (via payment mappers).

### Key Architecture Decision: Three-Stage Flow

Payment processing follows a three-stage flow coordinated by ATXPFetcher:

**Stage 1: Source Address Collection**
- Iterate over payment makers
- Extract all source addresses from each maker using `getSourceAddresses()`
- Each maker returns array of `{network, address}` pairs

**Stage 2: Destination Mapping**
- Apply all payment mappers to destinations
- Pass collected source addresses to each mapper
- Mappers return destinations unchanged if they can't handle them (do NOT return null)
- Build largest possible array of concrete destinations

**Stage 3: Payment Execution**
- Iterate over payment makers with mapped destinations
- First maker that can handle a destination makes the payment
- Stop on first successful payment

This three-stage flow enables synthetic networks (like `atxp`) to be resolved before payment execution, with complete isolation between mappers and makers.

---

## 1. Current State Analysis

### 1.1 Current Server Architecture

**File**: `/Users/bdj/pr0xy/sdk/packages/atxp-server/src/paymentDestination.ts`

The server currently uses PaymentDestination classes:

```typescript
export interface PaymentDestination {
  destinations(fundingAmount: FundingAmount): Promise<PaymentAddress[]>;
}

export class ChainPaymentDestination implements PaymentDestination {
  // Returns a single fixed address/network
}

export class ATXPPaymentDestination implements PaymentDestination {
  // Calls /addresses endpoint on accounts server
  // Returns multiple payment addresses
}
```

**Issues**:
- Server does destination lookup (should be client responsibility)
- ATXPPaymentDestination has convoluted network mapping logic
- Tight coupling between server and accounts service
- Violates principle: protocol layer must not know about accounts server

### 1.2 Current Client Architecture

**File**: `/Users/bdj/pr0xy/sdk/packages/atxp-client/src/types.ts`

```typescript
export type Account = {
  accountId: string;
  paymentMakers: {[key: string]: PaymentMaker};  // Object keyed by network
}

export interface PaymentMaker {
  supportedNetworks?: Network[];
  makePayment: (amount, currency, receiver, memo, paymentRequestId?) => Promise<string>;
  generateJWT: (params) => Promise<string>;
  getSourceAddress: (params) => Promise<Array<{network: Network, address: string}>>;
}
```

**File**: `/Users/bdj/pr0xy/sdk/packages/atxp-client/src/atxpFetcher.ts`

Lines 220-314: `handleMultiDestinationPayment` method contains `resolveAtxpBaseDestination` logic (lines 130-218) that:
- Detects `atxp_base` network
- Calls `payment_info` endpoint on accounts server
- Maps to Stripe deposit address dynamically

**Issues**:
- `resolveAtxpBaseDestination` is convoluted logic that should be replaced with DestinationMapper
- PaymentMakers stored as object, not array (no ordering)
- No clean way to define fallback payment strategies
- Special-case logic for specific networks embedded in fetcher

### 1.3 Current Accounts Service

**Files**:
- `/Users/bdj/pr0xy/accounts/routes/address.ts`: Returns single address for specific network
- `/Users/bdj/pr0xy/accounts/routes/addresses.ts`: Returns all addresses for user
- `/Users/bdj/pr0xy/accounts/routes/paymentInfo.ts`: Dynamic Stripe deposit address creation

**Key Logic**:
```typescript
// walletAddresses.ts lines 89-102
if (requestedNetwork === 'atxp_base' || requestedNetwork === 'atxp_base_sepolia') {
  const stripeConnection = await db.getStripeAccountConnection(userId);
  if (stripeConnection && stripeConnection.status === 'active') {
    return getAtxpBaseAddress(userId, requestedNetwork, currency);
  }
  // Fall back to regular base network
  requestedNetwork = requestedNetwork === 'atxp_base' ? 'base' : 'base_sepolia';
}
```

---

## 2. Roles & Responsibilities

### 2.1 MCP Server Role

**After Refactor**:
- Server provides simple server account array with static configuration
- Server NEVER calls external services for destination lookup
- Server is simplified to be purely a source of truth for payment destinations
- Configuration is declarative: `serverAccounts: [{network, address}, ...]`

**Key Improvement**: Server role properly constrained - it declares where payments should go but doesn't resolve dynamic addresses.

### 2.2 Fetcher Role

**After Refactor**:
- Fetcher orchestrates the three-stage payment flow:
  1. **Stage 1**: Collect source addresses from all payment makers
  2. **Stage 2**: Apply destination mappers (passing source addresses as parameter)
  3. **Stage 3**: Iterate through payment makers until one succeeds
- No special-case logic for specific networks
- Clean separation: routing logic vs. mapping logic vs. payment execution

**Key Improvement**: Fetcher is pure orchestrator using pluggable mappers and makers.

### 2.3 Payment Mapper Role

**After Refactor**:
- `DestinationMapper` is a first-class interface for mapping abstract destinations to concrete ones
- Generic interface that does NOT know about accounts service
- Implementations handle any network decomposition (1-to-many)
- **Critical**: Mapper receives source addresses as parameter (does NOT iterate over payment makers itself)
- **Critical**: Mapper does NOT return null when it can't handle destination - instead returns destination unchanged
- **Critical**: We iterate through ALL possible destination mappers to build largest possible array of destinations

**Key Improvement**: Payment mapping is a top-level, extensible pattern with 1-to-many decomposition support. The DestinationMapper interface itself is generic. Only specific implementations (like ATXPDestinationMapper) know about external services like accounts service - this is an implementation detail.

### 2.4 Payment Maker Role

**After Refactor**:
- `makePayment` now returns composite payment object:
  ```typescript
  {
    network: Network,
    address: string,
    amount: BigNumber,
    currency: Currency,
    transactionId: string
  }
  ```
- Method `getSourceAddress` renamed to `getSourceAddresses` (plural)
- Returns array of `{network, address}` pairs this maker can provide
- Single-network makers return array with one item
- Multi-network makers (like ATXP) return array with multiple items
- PaymentMakers stored as array with explicit ordering (priority/fallback)
- **Critical**: Single `makePayment` method receives list of destinations and chooses which to pay
- Returns null if it can't handle any of the destinations

**Key Improvement**: Payment Makers match role definition - receive a list, make single payment on any suitable network. Return value provides complete payment record, not just transaction ID.

### 2.5 ATXP Network Implementation

**Critical**: ATXP network is not a future implementation - we implement it NOW.

**Implementation**:
- Create an ATXP payment mapper now (in scope for this refactor)
- Encapsulates the call out to the account service to get addresses
- Removes logic currently in ATXPFetcher that should be in mapper
- Network name: `atxp` (NOT `atxp_base` or `atxp_base_sepolia`)
- After this refactor: NO `atxp_base` network should exist

**Key Improvement**: ATXP accounts treated as just another network with client-side mapping.

### 2.6 Accounts Server Role

**After Refactor**:
- SDK server (protocol layer) NEVER calls accounts server
- Server configuration just references accounts server URLs as addresses
- Client-side mapper calls accounts server as needed (not protocol layer)
- Accounts server is completely opaque to the protocol

**Key Improvement**: Protocol layer completely decoupled from accounts server - treats URLs as opaque strings.

### 2.7 Role Boundary Changes Summary

| Responsibility | Before | After | Rationale |
|---------------|--------|-------|-----------|
| Destination lookup | Server (via PaymentDestination) | Client (via DestinationMapper) | Client has the context to resolve dynamic addresses |
| Network decomposition | Hard-coded in Fetcher | DestinationMapper pattern | Extensible pattern for synthetic networks |
| Payment maker selection | Object lookup by network | Array iteration with fallback | Explicit ordering and multi-network support |
| ATXP account handling | Special case throughout | Just another network | Protocol should be agnostic |
| Accounts server coupling | Server knows about it | Only client mappers know | Protocol layer independence |

---

## 3. Proposed Architecture

### 3.1 New Client-Side PaymentMaker Structure

**Change**: From object to array

```typescript
// BEFORE
export type Account = {
  accountId: string;
  paymentMakers: {[key: string]: PaymentMaker};
}

// AFTER
export type Account = {
  accountId: string;
  paymentMakers: PaymentMaker[];
}
```

**Key Changes**:
1. Array order defines priority (try first PaymentMaker first)
2. Each PaymentMaker can accept multiple destinations
3. PaymentMaker returns null if it can't handle the payment
4. Stop at first successful payment

### 3.2 Enhanced PaymentMaker Interface

**File**: `/Users/bdj/pr0xy/sdk/packages/atxp-client/src/types.ts`

```typescript
export type PaymentDestination = {
  network: Network;
  address: string;
  amount: BigNumber;
  currency: Currency;
  paymentRequestId?: string;
  accountId?: string;  // Optional: destination account ID, may be needed by mappers
}

export type PaymentObject = {
  network: Network;
  address: string;
  amount: BigNumber;
  currency: Currency;
  transactionId: string;
}

export interface PaymentMaker {
  makePayment: (
    destinations: PaymentDestination[],
    memo: string,
    paymentRequestId?: string
  ) => Promise<PaymentObject | null>;

  generateJWT: (params: {paymentRequestId: string, codeChallenge: string}) => Promise<string>;

  getSourceAddresses: (params: {
    amount: BigNumber,
    currency: Currency,
    receiver: string,
    memo: string
  }) => Promise<Array<{network: Network, address: string}>>;
}
```

**Key Changes**:
1. **makePayment return type**: Now returns `Promise<PaymentObject | null>` where PaymentObject is composite object with network, address, amount, currency, transactionId
2. **getSourceAddresses**: Returns array of {network, address} pairs this maker can provide
3. **Single makePayment method**: Takes destinations array, returns payment object or null

### 3.3 New DestinationMapper Concept

**Purpose**: Map abstract network destinations to concrete addresses on the client side (supports 1-to-many decomposition)

**CRITICAL REQUIREMENTS**:
1. Mapping happens BEFORE PaymentMakers are invoked
2. Mapper receives source addresses as parameter (does NOT iterate over makers itself)
3. Mapper returns destination UNCHANGED if it cannot handle it (does NOT return null)
4. DestinationMapper interface is GENERIC - does NOT know about accounts service
5. Only ATXPDestinationMapper implementation knows about accounts service (implementation detail)

**File**: `/Users/bdj/pr0xy/sdk/packages/atxp-client/src/destinationMapper.ts` (new)

```typescript
export interface DestinationMapper {
  /**
   * Maps an abstract destination (like atxp URL) to concrete destinations
   *
   * @param destination - The destination to map
   * @param sourceAddresses - Array of {network, address} pairs from all payment makers
   *
   * @returns Array of concrete destinations, or original destination unchanged if can't handle
   *
   * CRITICAL: Do NOT return null. If mapper can't handle destination, return original unchanged.
   * This allows all mappers to be tried to build largest possible destination array.
   */
  mapDestination(
    destination: PaymentDestination,
    sourceAddresses: Array<{network: Network, address: string}>
  ): Promise<PaymentDestination[]>;
}

export class ATXPDestinationMapper implements DestinationMapper {
  constructor(
    private fetchFn: FetchLike,
    private logger: Logger
  ) {}

  async mapDestination(
    destination: PaymentDestination,
    sourceAddresses: Array<{network: Network, address: string}>
  ): Promise<PaymentDestination[]> {

    const paymentInfoUrl = destination.address;

    // Check if address looks like ATXP accounts URL
    if (!paymentInfoUrl.includes('accounts.atxp.ai/a/')) {
      // Not an ATXP URL, return unchanged
      return [destination];
    }

    // Parse account ID from URL and construct payment_info endpoint
    // URL format: https://accounts.atxp.ai/a/${accountId}
    const accountId = paymentInfoUrl.split('/a/')[1];
    const paymentInfoEndpoint = `https://accounts.atxp.ai/payment_info/${accountId}`;

    // Build buyerAddresses object from sourceAddresses array
    const buyerAddresses: Record<string, string> = {};
    for (const {network, address} of sourceAddresses) {
      buyerAddresses[network] = address;
    }

    try {
      const response = await this.fetchFn(paymentInfoEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentRequestId: destination.paymentRequestId,
          buyerAddresses
        })
      });

      if (!response.ok) {
        this.logger.warn(`payment_info call failed: ${response.status}`);
        return [destination];  // Return unchanged, not null
      }

      const data = await response.json() as {
        destinations: Array<{
          network: Network;
          address: string;
          amount?: string;
          currency?: Currency;
        }>;
      };

      this.logger.info(`ATXP mapped to ${data.destinations.length} concrete destination(s)`);

      // Return all destinations (1-to-many mapping)
      // Accounts service decides what to return (Stripe base, direct base + solana, etc.)
      return data.destinations.map(dest => ({
        network: dest.network,
        address: dest.address,
        amount: dest.amount ? new BigNumber(dest.amount) : destination.amount,
        currency: dest.currency || destination.currency,
        paymentRequestId: destination.paymentRequestId,
        accountId: destination.accountId
      }));

    } catch (error) {
      this.logger.warn(`Error mapping ATXP destination: ${error}`);
      return [destination];  // Return unchanged on error
    }
  }
}
```

**Key Design Points**:
- **ATXPDestinationMapper knows about accounts service**: This is an implementation detail of the ATXP mapper
- **Receives source addresses as parameter**: Does NOT iterate over payment makers
- **Returns unchanged on failure**: Does NOT return null, returns original destination
- **Parses ATXP URL and calls appropriate endpoint**: Mapper extracts account ID and constructs payment_info endpoint
- **Accounts service driven**: Service decides what destinations to return
- **1-to-many support**: Can return multiple concrete destinations

### 3.4 ATXPFetcher Three-Stage Flow

**File**: `/Users/bdj/pr0xy/sdk/packages/atxp-client/src/atxpFetcher.ts`

The fetcher coordinates the three-stage flow:

```typescript
async handleMultiDestinationPayment(
  destinations: PaymentDestination[],
  memo: string
): Promise<PaymentObject> {

  // STAGE 1: ITERATE OVER PAYMENT MAKERS AND EXTRACT SOURCE ADDRESSES
  const sourceAddresses: Array<{network: Network, address: string}> = [];

  for (const maker of this.account.paymentMakers) {
    try {
      const addresses = await maker.getSourceAddresses({
        amount: destinations[0].amount,  // Use first destination for context
        currency: destinations[0].currency,
        receiver: destinations[0].address,
        memo
      });

      // Each maker returns array of {network, address}
      for (const addr of addresses) {
        // Avoid duplicates
        if (!sourceAddresses.find(a => a.network === addr.network && a.address === addr.address)) {
          sourceAddresses.push(addr);
        }
      }
    } catch (error) {
      this.logger.debug(`Failed to get source addresses from maker: ${error}`);
      // Continue with other makers
    }
  }

  this.logger.info(`Collected ${sourceAddresses.length} source addresses`);

  // STAGE 2: APPLY ALL PAYMENT MAPPERS (passing source addresses)
  let mappedDestinations: PaymentDestination[] = [];

  for (const destination of destinations) {
    let currentDest = destination;

    // Apply all mappers to this destination
    for (const mapper of this.destinationMappers) {
      const mapped = await mapper.mapDestination(currentDest, sourceAddresses);
      // Mapper returns array - take first element for next mapper
      // Or if multiple, add all to mappedDestinations
      if (mapped.length > 1) {
        // 1-to-many mapping
        mappedDestinations.push(...mapped);
        currentDest = null;  // Don't continue mapping
        break;
      } else {
        currentDest = mapped[0];
      }
    }

    if (currentDest !== null) {
      mappedDestinations.push(currentDest);
    }
  }

  this.logger.info(`After mapping: ${mappedDestinations.length} destination(s)`);

  // STAGE 3: ITERATE OVER PAYMENT MAKERS, PASSING DESTINATIONS, UNTIL ONE MAKES PAYMENT
  for (const maker of this.account.paymentMakers) {
    try {
      const result = await maker.makePayment(
        mappedDestinations,
        memo,
        destinations[0].paymentRequestId
      );

      if (result !== null) {
        this.logger.info(`Payment successful via maker on network ${result.network}`);
        return result;
      }
    } catch (error) {
      this.logger.warn(`Payment maker failed: ${error}`);
      // Continue with next maker
    }
  }

  throw new Error('No payment maker could handle the destinations');
}
```

**Key Flow Points**:
1. **Stage 1**: Extract ALL source addresses from ALL payment makers
2. **Stage 2**: Pass source addresses to mappers, build complete destination list
3. **Stage 3**: Iterate makers until one succeeds

### 3.5 New Server Architecture

**Change**: Remove PaymentDestination classes entirely

**File**: `/Users/bdj/pr0xy/sdk/packages/atxp-server/src/types.ts`

```typescript
// REMOVE: PaymentDestination interface and implementations

// NEW: Simple destination specification
export type ATXPConfig = {
  // Simple array of destinations (no ServerAccount interface needed)
  destinations: Array<{network: Network, address: string}>;

  mountPath: string;
  currency: Currency;  // Currency is at root level
  server: AuthorizationServerUrl;
  payeeName: string;
  resource: UrlString | null;
  allowHttp: boolean;
  logger: Logger;
  oAuthDb: OAuthDb;
  oAuthClient: OAuthResourceClient;
  paymentServer: PaymentServer;
  minimumPayment?: BigNumber;
}
```

**File**: `/Users/bdj/pr0xy/sdk/packages/atxp-server/src/requirePayment.ts`

```typescript
export async function requirePayment(paymentConfig: RequirePaymentConfig): Promise<void> {
  const config = getATXPConfig();
  // ... existing validation

  // Use configured destinations directly (no dynamic lookup)
  const paymentAddresses = config.destinations.map(dest => ({
    network: dest.network,
    currency: config.currency,
    address: dest.address,
    amount: paymentAmount
  }));

  // Create charge with destinations
  const charge = {
    destinations: paymentAddresses,
    source: user,
    payeeName: config.payeeName,
  };

  // ... rest of charging logic
}
```

### 3.6 Server Setup Example

**OLD**:
```typescript
import { ATXPPaymentDestination } from '@atxp/server';

const destination = new ATXPPaymentDestination(
  process.env.ATXP_CONNECTION_STRING
);

const config = atxpExpress({
  paymentDestination: destination,
  // ...
});
```

**NEW**:
```typescript
const accountId = process.env.ATXP_ACCOUNT_ID;

const config = atxpExpress({
  currency: 'usdc',  // Currency at root level
  destinations: [
    {
      network: 'atxp',
      address: `https://accounts.atxp.ai/a/${accountId}`
    }
  ],
  // ...
});
```

**Key Changes**:
- Use simple environment variable `ATXP_ACCOUNT_ID`
- Do NOT use connection string
- `destinations` array with plain objects (no ServerAccount interface)
- Currency at root level of config
- Use `https://accounts.atxp.ai/a/${accountId}` URL format
- Use `atxp` network name (NOT `atxp_base`)

---

## 4. Implementation Plan

**Tasks**:
1. Define new types in `atxp-client/src/types.ts`:
   - Update `PaymentMaker` interface
   - Add `PaymentObject` type
2. Create `DestinationMapper` interface in `atxp-client/src/destinationMapper.ts`
3. Implement `ATXPDestinationMapper` class
4. Remove `PaymentDestination` classes from `atxp-server`
5. Update `ATXPConfig` to use `destinations` array
6. Update `requirePayment` to use destinations directly
7. Update `Account` type to use `PaymentMaker[]` array
8. Update `ATXPFetcher` to implement three-stage flow
9. Remove `resolveAtxpBaseDestination` method
10. Update payment maker implementations to use new interface
11. Remove `atxp_base` and `atxp_base_sepolia` network references
12. Replace with single `atxp` network
13. Comprehensive integration tests
14. Migration guide for existing servers and clients

---

## 5. Breaking Changes & Migration

### 5.1 Breaking Changes

**Server-Side**:
1. `ATXPConfig.paymentDestination` → `ATXPConfig.destinations`
2. Remove `PaymentDestination` classes
3. Must use `destinations` array with plain objects
4. Currency moved to root level of config

**Client-Side**:
1. `Account.paymentMakers` changes from object to array
2. `PaymentMaker.makePayment` returns `PaymentObject | null` instead of `string`
3. `PaymentMaker.getSourceAddress` → `PaymentMaker.getSourceAddresses`

### 5.2 Migration Examples

**Server Migration**:

```typescript
// BEFORE
import { ATXPPaymentDestination } from '@atxp/server';

const config = atxpExpress({
  paymentDestination: new ATXPPaymentDestination(
    process.env.ATXP_CONNECTION_STRING
  ),
  // ...
});

// AFTER
const config = atxpExpress({
  currency: 'usdc',
  destinations: [
    {
      network: 'atxp',
      address: `https://accounts.atxp.ai/a/${process.env.ATXP_ACCOUNT_ID}`
    }
  ],
  // ...
});
```

**Client Migration**:

```typescript
// BEFORE
const account: Account = {
  accountId: 'user123',
  paymentMakers: {
    'base': basePaymentMaker,
    'solana': solanaPaymentMaker
  }
};

// AFTER
const account: Account = {
  accountId: 'user123',
  paymentMakers: [
    basePaymentMaker,      // Try base first
    solanaPaymentMaker     // Fallback to solana
  ]
};
```

**PaymentMaker Implementation Migration**:

```typescript
// BEFORE
class BasePaymentMaker implements PaymentMaker {
  async makePayment(amount, currency, receiver, memo): Promise<string> {
    // ... make payment
    return transactionId;
  }

  async getSourceAddress(params): Promise<Array<{network, address}>> {
    return [{network: 'base', address: this.address}];
  }
}

// AFTER
class BasePaymentMaker implements PaymentMaker {
  async makePayment(
    destinations: PaymentDestination[],
    memo: string
  ): Promise<PaymentObject | null> {
    // Find compatible destination
    const dest = destinations.find(d => d.network === 'base');
    if (!dest) return null;

    // Make payment
    const txId = await this.sendTransaction(dest);

    // Return payment object
    return {
      network: 'base',
      address: dest.address,
      amount: dest.amount,
      currency: dest.currency,
      transactionId: txId
    };
  }

  async getSourceAddresses(params): Promise<Array<{network, address}>> {
    return [{network: 'base', address: this.address}];
  }
}
```

---

## 6. Accounts Service Changes

### 6.1 Payment Info Endpoint

**Purpose**: Accept buyer addresses for ALL networks at once, return appropriate destinations.

**Endpoint**: `POST /payment_info/:atxp_account_id`

**Request Body**:
```json
{
  "paymentRequestId": "pr_123",
  "buyerAddresses": {
    "base": "0x123...",
    "solana": "Sol456...",
    "ethereum": "0x789..."
  }
}
```

**Response**:
```json
{
  "destinations": [
    {
      "network": "base",
      "address": "0xStripe...",
      "amount": "100",
      "currency": "USDC"
    }
  ]
}
```

**Key Points**:
- Accepts buyer addresses for multiple networks
- Accounts service decides which destinations to return
- Could return Stripe base address, or multiple cross-chain addresses
- SDK mapper is generic - doesn't know or care what service returns

### 6.2 Accounts Service Changes

**Important**: Accounts service changes are ONLY needed within the ATXPDestinationMapper implementation on the client side. This is NOT part of the PaymentMaker interface or server configuration - it's an implementation detail of how the ATXP mapper resolves destinations.

**What changes**:
- The `payment_info` endpoint accepts `buyerAddresses` from all networks
- The accounts service determines what concrete destinations to return
- Could return Stripe deposit address on Base, or multiple cross-chain addresses
- Network name `atxp` used (not `atxp_base`)

**Where this happens**:
- Client-side only, inside ATXPDestinationMapper
- Server never calls accounts service
- PaymentMakers don't know about accounts service

---

## 7. Success Criteria

### 7.1 Functional Requirements

✅ Server uses simple `destinations` array with plain objects
✅ Server NEVER calls accounts service
✅ Client-side mappers handle all dynamic address resolution
✅ Three-stage flow implemented in ATXPFetcher
✅ ATXP mapper created and working
✅ `atxp` network used (NO `atxp_base`)
✅ PaymentMaker returns payment object (not just transaction ID)
✅ `getSourceAddresses` method returns array
✅ Backward compatibility maintained

### 7.2 Non-Functional Requirements

✅ Document is concise and non-repetitive
✅ Clear separation of concerns
✅ Extensible architecture for future networks
✅ Complete test coverage
✅ Migration guide provided

### 7.3 Testing Strategy

**Unit Tests**:
- ATXPDestinationMapper with various responses
- PaymentMaker implementations
- Three-stage flow in ATXPFetcher

**Integration Tests**:
- End-to-end payment flow
- Multiple payment makers with fallback
- ATXP destination mapping
- Error handling and edge cases

**Compatibility Tests**:
- Old clients with new servers
- New clients with old servers (where possible)

---

## 8. Out of Scope

The following items are explicitly OUT of scope for this refactor:

1. **Destination User ID Tracking**: Being developed in parallel
2. **Balance Server Integration**: Existing functionality only
3. **OAuth Flow Changes**: No changes to authentication
4. **Additional Network Support**: Only ATXP, Base, Solana initially
5. **Server-Side Validation Logic**: Maintain existing validation

---

## 9. Risk Mitigation

### 9.1 Breaking Changes

**Risk**: Major version bump could slow adoption

**Mitigation**:
- Provide clear migration guide
- Offer backward compatibility where possible
- Gradual rollout with feature flags

### 9.2 Accounts Service Coordination

**Risk**: Accounts service changes must coordinate with SDK

**Mitigation**:
- Define API contract clearly
- Implement accounts changes first
- Test with mock responses initially

### 9.3 Testing Complexity

**Risk**: Three-stage flow adds complexity

**Mitigation**:
- Comprehensive unit tests for each stage
- Integration tests for full flow
- Mock implementations for testing

---

## 10. Summary of Key Changes

### PaymentMaker Interface
- `makePayment` returns `PaymentObject | null` (not `string`)
- `getSourceAddresses` returns array of {network, address} pairs
- Single `makePayment` method takes destinations array

### Payment Mapper Behavior
- Returns destination unchanged if can't handle (not null)
- Receives source addresses as parameter (array, not Map)
- Does NOT iterate over payment makers itself
- DestinationMapper interface is generic (doesn't know about accounts service)
- ATXPDestinationMapper implementation calls accounts service (implementation detail)

### Three-Stage Flow
1. Collect source addresses from all makers
2. Apply mappers with source addresses
3. Execute payment with first compatible maker

### ATXP Network
- Create ATXP mapper NOW (in scope)
- Use `atxp` network (NOT `atxp_base`)
- Remove all `atxp_base` references

### Server Architecture
- Server NEVER calls accounts service
- Simple `destinations` array with plain objects (no ServerAccount interface needed)
- Currency at root level of config
- Static configuration only
- Use `https://accounts.atxp.ai/a/${accountId}` URL format

### Success Criteria
- Server never needs to call account service
- Server only provides account configuration
- ALL account service calls in client SDK

---

## Appendix: Complete Type Definitions

```typescript
// Client-side types
export type Network = string;
export type Currency = string;

export type PaymentDestination = {
  network: Network;
  address: string;
  amount: BigNumber;
  currency: Currency;
  paymentRequestId?: string;
  accountId?: string;
}

export type PaymentObject = {
  network: Network;
  address: string;
  amount: BigNumber;
  currency: Currency;
  transactionId: string;
}

export interface PaymentMaker {
  makePayment: (
    destinations: PaymentDestination[],
    memo: string,
    paymentRequestId?: string
  ) => Promise<PaymentObject | null>;

  generateJWT: (params: {
    paymentRequestId: string,
    codeChallenge: string
  }) => Promise<string>;

  getSourceAddresses: (params: {
    amount: BigNumber,
    currency: Currency,
    receiver: string,
    memo: string
  }) => Promise<Array<{network: Network, address: string}>>;
}

export interface DestinationMapper {
  mapDestination(
    destination: PaymentDestination,
    sourceAddresses: Array<{network: Network, address: string}>
  ): Promise<PaymentDestination[]>;
}

export type Account = {
  accountId: string;
  paymentMakers: PaymentMaker[];
}

// Server-side types
export type ATXPConfig = {
  destinations: Array<{network: Network, address: string}>;
  mountPath: string;
  currency: Currency;
  server: AuthorizationServerUrl;
  payeeName: string;
  resource: UrlString | null;
  allowHttp: boolean;
  logger: Logger;
  oAuthDb: OAuthDb;
  oAuthClient: OAuthResourceClient;
  paymentServer: PaymentServer;
  minimumPayment?: BigNumber;
}
```

---

**Document Version**: 2.0 (Revised with user feedback)
**Last Updated**: 2025-10-16
**Status**: Ready for Implementation
