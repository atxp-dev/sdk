# Architecture Document: AccountId-Based Balance Storage Refactor

**Author**: Claude Code (bc-architect)
**Date**: 2025-10-16
**Status**: Draft - Awaiting Approval

## Executive Summary

This document outlines the architecture for refactoring ATXP's balance storage from address-based to accountId-based to support Stripe integration and multi-chain payments. The current system stores balances as `{source address, destination address}` but needs to transition to `{source accountId, destination accountId}`.

## Scope: 3 Repositories

1. **SDK** (`/Users/bdj/pr0xy/sdk-worktree-balances-refactor`) - JWT generation, PaymentMakers
2. **Accounts** (`/Users/bdj/pr0xy/accounts-worktree-balances-refactor`) - `/sign` endpoint updates
3. **Auth** (`/Users/bdj/pr0xy/auth-worktree-balances-refactor`) - Balance storage, database schema

## Current System Analysis

### Account Interface (SDK)

```typescript
export type Account = {
  accountId: string;
  paymentMakers: {[key: string]: PaymentMaker};
}
```

**Account Implementations:**
- **BaseAccount**: `accountId = wallet.address`
- **SolanaAccount**: `accountId = publicKey.toBase58()`
- **ATXPAccount**: `accountId = "atxp:{uuid}"` or provided value
- **BaseAppAccount**: Uses accountId as authoritative
- **WorldchainAccount**: `accountId = wallet.address`

### Current JWT Payload Structure

**File**: `/Users/bdj/pr0xy/accounts-worktree-balances-refactor/services/payments.ts` (lines 31-46)

```typescript
export async function generateWalletJWT(
  wallet: WalletWithMetadata,
  controller: BlockchainController,
  params: { paymentRequestId?: string; codeChallenge?: string }
): Promise<string> {
  const headerObj = { alg: wallet.chainType === 'solana' ? 'EdDSA' : 'ES256K' };
  const payloadObj = {
    sub: wallet.address!,  // Always use the EOA address for signature verification
    iss: 'accounts.atxp.ai',
    aud: 'https://auth.atxp.ai',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
    ...(params.codeChallenge ? { code_challenge: params.codeChallenge } : {}),
    ...(params.paymentRequestId ? { payment_request_id: params.paymentRequestId } : {}),
  } as Record<string, unknown>;
  // ... signing logic
}
```

### Current Database Schema (Auth)

**File**: `/Users/bdj/pr0xy/auth-worktree-balances-refactor/models/migrations.ts` (lines 10-99)

```sql
CREATE TABLE IF NOT EXISTS balances (
  source TEXT NOT NULL,           -- Currently: wallet address
  destination TEXT NOT NULL,      -- Currently: wallet address
  currency TEXT NOT NULL,
  network TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY (source, destination, currency, network)
)

CREATE TABLE IF NOT EXISTS applied_payments (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  destination TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  network TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
)

CREATE UNIQUE INDEX IF NOT EXISTS applied_payments_transaction_id_uniq
  ON applied_payments (transaction_id)

CREATE TABLE IF NOT EXISTS payment_requests (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  resource TEXT NOT NULL,
  payee_name TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now()
)

CREATE TABLE IF NOT EXISTS payment_request_destinations (
  id SERIAL PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES payment_requests(id) ON DELETE CASCADE,
  network TEXT NOT NULL,
  currency TEXT NOT NULL,
  address TEXT NOT NULL,
  amount NUMERIC,
  UNIQUE(request_id, network, currency, address)
)
```

## Problem Statement

### Current Issues

1. **Stripe Integration Blocker**: Stripe uses common Base addresses (not owned by destination accounts), breaking the current 1:1 address-to-user assumption. Each payment could use a different address, and the same address could be used across multiple accounts.

2. **Multi-Chain Fragmentation**: The same user with both Solana and Base wallets appears as separate accounts with separate balances, even though to the MCP server they are the same accountId.

3. **AccountId Already Exists**: All Account implementations define `accountId`, but it's not being used in balance storage or JWTs.

### Why This Matters

- **Stripe payments would be lost or misapplied** - A user's payment might not be recognized as belonging to their account
- **Users lose balances when switching chains** - A user who pays with Base, then later with Solana, would have two separate balances
- **No path forward for new payment methods** - Any future payment method that doesn't use unique addresses per user will have the same problem

## Security Invariants (Must Maintain)

From the ATXP Security document, the following invariants are currently enforced and must be maintained:

1. ✅ **Payment Request Binding**: JWTs include `payment_request_id` in signed payload to prevent reuse across different payment requests
2. ✅ **Source Verification**: `auth.atxp.ai` verifies transaction source matches JWT `sub` field
3. ✅ **Transaction Replay Prevention**: `applied_payments` table's unique constraint on `transaction_id` prevents reuse
4. ✅ **Destination Integrity**: Payment requests store intended payee, only increase balance for that user
5. ✅ **Time-Based Validation**: Payment verifiers check transaction timestamps (5-minute window)
6. ✅ **Signature Authentication**: All JWTs verified using cryptographic signatures (EdDSA, ES256K, EIP1271)
7. 🆕 **AccountId-Address Consistency**: AccountId must be consistent across requests from the same user

### Security Verification

**How we maintain each invariant:**

1. **Payment Request Binding** - No changes to this mechanism; `payment_request_id` remains in JWT payload
2. **Source Verification** - Enhanced to verify BOTH address (existing) AND accountId (new) consistency
3. **Transaction Replay Prevention** - Database unique constraint unchanged
4. **Destination Integrity** - Enhanced by adding destinationAccountId tracking
5. **Time-Based Validation** - Unchanged; handled at transaction validation layer
6. **Signature Authentication** - Unchanged; accountId is added to payload but doesn't affect crypto verification
7. **AccountId Consistency** - NEW: Validate accountId is non-empty and consistent across user's requests

## Proposed Changes

### Phase 1: SDK Repository - JWT Enhancement

#### Core Type Updates

**File**: `packages/atxp-common/src/types.ts`
```typescript
export type CustomJWTPayload = {
  code_challenge?: string;
  payment_request_id?: string;
  account_id?: string;  // NEW: Add accountId to JWT payload
}
```

**File**: `packages/atxp-common/src/jwt.ts`
```typescript
export const generateJWT = async (
  walletId: string,
  privateKey: CryptoKey | Uint8Array,
  paymentRequestId: string,
  codeChallenge: string,
  accountId?: string  // NEW: Optional accountId parameter
): Promise<string> => {
  const payload: CustomJWTPayload = {
    code_challenge: codeChallenge,
  };
  if (paymentRequestId) payload.payment_request_id = paymentRequestId;
  if (codeChallenge) payload.code_challenge = codeChallenge;
  if (accountId) payload.account_id = accountId;  // NEW

  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(walletId)
    .setExpirationTime('2m')
    .sign(privateKey);
};
```

#### PaymentMaker Interface Update

**File**: `packages/atxp-client/src/types.ts`
```typescript
export interface PaymentMaker {
  makePayment: (
    amount: BigNumber,
    currency: Currency,
    receiver: string,
    memo: string,
    paymentRequestId?: string
  ) => Promise<string>;

  generateJWT: (params: {
    paymentRequestId: string,
    codeChallenge: string,
    accountId?: string  // NEW: Add accountId parameter
  }) => Promise<string>;

  getSourceAddress: (params: {
    amount: BigNumber,
    currency: Currency,
    receiver: string,
    memo: string
  }) => string | Promise<string>;
}
```

#### PaymentMaker Implementations (7 files)

All PaymentMaker implementations need to be updated to accept and pass accountId:

1. **File**: `packages/atxp-client/src/basePaymentMaker.ts`
   - Update `generateJWT()` to accept accountId parameter
   - Pass accountId to `generateJWT()` utility

2. **File**: `packages/atxp-client/src/solanaPaymentMaker.ts`
   - Update `generateJWT()` to accept accountId parameter
   - Pass accountId to `generateJWT()` utility

3. **File**: `packages/atxp-client/src/atxpAccount.ts`
   - Update `generateJWT()` to accept accountId parameter
   - Pass accountId to `/sign` endpoint (accounts repo)

4. **File**: `packages/atxp-base/src/baseAppPaymentMaker.ts`
   - Update `generateJWT()` to accept accountId parameter
   - Pass accountId to `generateJWT()` utility

5. **File**: `packages/atxp-base/src/mainWalletPaymentMaker.ts`
   - Update `generateJWT()` to accept accountId parameter
   - Pass accountId to `generateJWT()` utility

6. **File**: `packages/atxp-worldchain/src/worldchainPaymentMaker.ts`
   - Update `generateJWT()` to accept accountId parameter
   - Pass accountId to `generateJWT()` utility

7. **File**: `packages/atxp-worldchain/src/mainWalletPaymentMaker.ts`
   - Update `generateJWT()` to accept accountId parameter
   - Pass accountId to `generateJWT()` utility

#### ATXPFetcher Updates

**File**: `packages/atxp-client/src/atxpFetcher.ts`

Update lines ~280, ~426 to pass accountId when generating JWTs:

```typescript
const jwt = await paymentMaker.generateJWT({
  paymentRequestId,
  codeChallenge,
  accountId: this.accountId  // NEW: Pass accountId from account
});
```

### Phase 2: Accounts Repository - `/sign` Endpoint

**Location**: `/Users/bdj/pr0xy/accounts-worktree-balances-refactor/routes/sign.ts`

**Current Implementation** (lines 8-75):

```typescript
export default async function (req: AuthenticatedRequest, res: express.Response) {
  return withTrace('sign_route', async () => {
    try {
      const userId = req.user!.id;
      const { paymentRequestId = '', codeChallenge = '' } = (req.body ?? {}) as {
        paymentRequestId?: string;
        codeChallenge?: string
      };

      const wallet = await getPrimaryDelegatedWallet(userId);
      const controller = await getController(wallet.chainType, userId);

      const jwt = await generateWalletJWT(wallet, controller, {
        paymentRequestId,
        codeChallenge
      });

      posthog.capture('jwt_token_signed', userId, {
        wallet_address: wallet.address,
        chain_type: wallet.chainType,
        has_payment_request_id: Boolean(paymentRequestId),
        has_code_challenge: Boolean(codeChallenge)
      });

      res.status(200).json({ jwt });
    } catch (err) {
      // ... error handling
    }
  });
}
```

**Changes Needed:**

1. **Accept optional accountId in request body:**
```typescript
const { paymentRequestId = '', codeChallenge = '', accountId } = (req.body ?? {}) as {
  paymentRequestId?: string;
  codeChallenge?: string;
  accountId?: string;  // NEW - optional for backward compatibility
};
```

2. **Validate accountId if provided:**
```typescript
if (accountId !== undefined && accountId.trim() === '') {
  posthog.capture('jwt_signing_failed', userId, {
    reason: 'empty_account_id'
  });
  res.status(400).json({ error: 'accountId cannot be empty' });
  return;
}
```

3. **Pass accountId to generateWalletJWT:**
```typescript
const jwt = await generateWalletJWT(wallet, controller, {
  paymentRequestId,
  codeChallenge,
  accountId  // NEW: Pass accountId when provided
});
```

4. **Update JWT generation in services/payments.ts** (line 31):
```typescript
export async function generateWalletJWT(
  wallet: WalletWithMetadata,
  controller: BlockchainController,
  params: { paymentRequestId?: string; codeChallenge?: string; accountId?: string }  // ADD accountId
): Promise<string> {
  const payloadObj = {
    sub: wallet.address!,
    iss: 'accounts.atxp.ai',
    aud: 'https://auth.atxp.ai',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
    ...(params.codeChallenge ? { code_challenge: params.codeChallenge } : {}),
    ...(params.paymentRequestId ? { payment_request_id: params.paymentRequestId } : {}),
    ...(params.accountId ? { account_id: params.accountId } : {}),  // NEW
  } as Record<string, unknown>;
  // ... rest of signing logic
}
```

**Test File**: `/Users/bdj/pr0xy/accounts-worktree-balances-refactor/__tests__/routes/sign.test.ts`

**Backward Compatibility:**
- **CRITICAL**: Must support clients that don't provide accountId
- Support indefinitely (no planned deprecation)
- Old SDK versions must continue to work

### Phase 3: Auth Repository - Database Migration

**File**: `models/migrations.ts`

Add the following migration commands:

```sql
-- Add accountId columns to balances table
ALTER TABLE balances
  ADD COLUMN IF NOT EXISTS source_account_id TEXT,
  ADD COLUMN IF NOT EXISTS destination_account_id TEXT;

-- Add accountId columns to applied_payments table
ALTER TABLE applied_payments
  ADD COLUMN IF NOT EXISTS source_account_id TEXT,
  ADD COLUMN IF NOT EXISTS destination_account_id TEXT;

-- Add accountId columns to payment_requests table
ALTER TABLE payment_requests
  ADD COLUMN IF NOT EXISTS source_account_id TEXT,
  ADD COLUMN IF NOT EXISTS destination_account_id TEXT;

-- Add indexes for accountId lookups (performance)
CREATE INDEX IF NOT EXISTS balances_source_account_id_idx
  ON balances (source_account_id)
  WHERE source_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS balances_destination_account_id_idx
  ON balances (destination_account_id)
  WHERE destination_account_id IS NOT NULL;

-- Composite index for accountId-based balance queries
CREATE INDEX IF NOT EXISTS balances_account_id_composite_idx
  ON balances (source_account_id, destination_account_id, currency, network)
  WHERE source_account_id IS NOT NULL AND destination_account_id IS NOT NULL;
```

**Migration Strategy:**
- All changes are additive (no breaking changes)
- Columns are nullable for backward compatibility
- Indexes created with `IF NOT EXISTS` (idempotent)
- No data backfill required
- Existing balances remain accessible via address

**File**: `/Users/bdj/pr0xy/auth-worktree-balances-refactor/types.ts` (current implementation, lines 1-69)

**Current Types:**
```typescript
export type AcceptedCurrency = 'USDC';

export type PaymentRecord = {
  paymentId: string;
  source: string;
  destination: string;
  amount: BigNumber;
  currency: AcceptedCurrency;
}

export type BalanceRecord = Omit<PaymentRecord, 'paymentId'> & {network: string};
export type AppliedPaymentRecord = PaymentRecord & {network: string};

export type PaymentRequestDestination = {
  network: string;
  currency: AcceptedCurrency;
  address: string;
  amount: BigNumber;
};

export type PaymentRequest = {
  id: string;
  source: string;
  destinations: PaymentRequestDestination[];
  amount?: BigNumber;  // Optional - backwards compatibility
  resource: string;
  payeeName?: string | null;
  createdAt?: Date;
};

export interface BalanceStore {
  getBalance(balanceParams: Omit<BalanceRecord, 'amount'>): Promise<BigNumber>;
  checkAndDeductBalance(balanceParams: Omit<BalanceRecord, 'amount'>, amountToDeduct: BigNumber): Promise<{ success: boolean; newBalance: BigNumber }>;
  createPaymentRequest(request: Omit<PaymentRequest, 'id' | 'createdAt'>): Promise<string>;
  getPaymentRequest(id: string): Promise<PaymentRequest | null>;
  makePaymentForRequest(paymentRequestId: string, payment: AppliedPaymentRecord): Promise<void>;
}
```

**Required Changes - Add accountId fields:**
```typescript
export type BalanceRecord = Omit<PaymentRecord, 'paymentId'> & {
  network: string;
  sourceAccountId?: string;      // NEW
  destinationAccountId?: string; // NEW
};

export type AppliedPaymentRecord = PaymentRecord & {
  network: string;
  sourceAccountId?: string;      // NEW
  destinationAccountId?: string; // NEW
};

export type PaymentRequestDestination = {
  network: string;
  currency: AcceptedCurrency;
  address: string;
  accountId?: string;  // NEW
  amount: BigNumber;
};

export type PaymentRequest = {
  id: string;
  source: string;
  sourceAccountId?: string;      // NEW
  destinationAccountId?: string; // NEW - will become required after 3-6 months
  destinations: PaymentRequestDestination[];
  amount?: BigNumber;
  resource: string;
  payeeName?: string | null;
  createdAt?: Date;
};
```

### Phase 4: Auth Repository - JWT & Authentication

**File**: `/Users/bdj/pr0xy/auth-worktree-balances-refactor/jwt.ts` (current implementation, lines 13-21, 57-129)

**Current AuthData Type:**
```typescript
export type AuthData = {
  sub: string;
  iss: string;
  aud: string;
  iat?: number;  // Issued at timestamp
  exp?: number;  // Expiration timestamp
  code_challenge?: string;  // Added for replay protection
  payment_request_id?: string;  // Added for payment request binding
};
```

**Required Change - Add accountId:**
```typescript
export type AuthData = {
  sub: string;
  iss: string;
  aud: string;
  iat?: number;
  exp?: number;
  code_challenge?: string;
  payment_request_id?: string;
  account_id?: string;  // NEW: Add accountId to auth data
};
```

**Current JWT Verification** (lines 57-129):
```typescript
export async function verifyJWTToken(
  authToken: string,
  expectedCodeChallenge: string | undefined,
  expectedPaymentRequestId: string | undefined
): Promise<AuthData> {
  // ... parse and verify JWT signature ...

  // Common validation for all auth types
  if (!address) {
    throw new Error('Auth data address (sub)');
  }

  if (authData.aud !== AUDIENCE) {
    throw new Error(`Audience is not valid, expected: ${AUDIENCE}, got: ${authData.aud}`);
  }

  // Check code_challenge binding for replay protection
  if (expectedCodeChallenge && authData.code_challenge !== expectedCodeChallenge) {
    throw new Error('Code challenge does not match request');
  }

  // Check payment_request_id binding for payment request scoping
  if (expectedPaymentRequestId && authData.payment_request_id !== expectedPaymentRequestId) {
    throw new Error('Auth not valid for this payment request');
  }

  // Algorithm-specific signature verification (ES256, EdDSA, ES256K, EIP1271)
  // ... verification logic ...

  return authData;
}
```

**File**: `/Users/bdj/pr0xy/auth-worktree-balances-refactor/routes/auth.ts` (current implementation, lines 4-32)

**Current Implementation:**
```typescript
export async function sourceFromAuthToken(
    req: express.Request,
    res: express.Response,
    expectedCodeChallenge: string | undefined,
    expectedPaymentRequestId: string | undefined
) {
    const authToken = req.get('Authorization')?.split('Bearer ')[1];
    if (!authToken) {
        res.status(403).send('No auth token found');
        return null;
    }

    try {
        const payload = await verifyJWTToken(
            authToken,
            expectedCodeChallenge,
            expectedPaymentRequestId
        );
        if (!payload.sub) {
            res.status(403).send('Invalid auth token found');
            return null;
        }
        return payload.sub;  // Currently returns only address
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Invalid auth token found';
        res.status(403).send(errorMessage);
        return null;
    }
}
```

**Required Changes - Return both address and accountId:**
```typescript
export async function sourceFromAuthToken(
    req: express.Request,
    res: express.Response,
    expectedCodeChallenge: string | undefined,
    expectedPaymentRequestId: string | undefined
): Promise<{address: string, accountId: string | null} | null> {  // NEW: Return both
    const authToken = req.get('Authorization')?.split('Bearer ')[1];
    if (!authToken) {
        res.status(403).send('No auth token found');
        return null;
    }

    try {
        const payload = await verifyJWTToken(
            authToken,
            expectedCodeChallenge,
            expectedPaymentRequestId
        );
        if (!payload.sub) {
            res.status(403).send('Invalid auth token found');
            return null;
        }

        // NEW: Extract accountId from JWT and validate
        const accountId = payload.account_id || null;
        if (accountId !== null && accountId.trim() === '') {
            res.status(403).send('Invalid account_id in token');
            return null;
        }

        return {
            address: payload.sub,
            accountId: accountId
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Invalid auth token found';
        res.status(403).send(errorMessage);
        return null;
    }
}
```

### Phase 5: Auth Repository - Balance Store Updates

**Files**:
- `/Users/bdj/pr0xy/auth-worktree-balances-refactor/balanceStoreSqlite.ts`
- `/Users/bdj/pr0xy/auth-worktree-balances-refactor/balanceStorePostgres.ts`

**Current Method Signatures:**

From `balanceStoreSqlite.ts` (lines 180-193, 245-287, 309-341, 343-388, 390-433):
```typescript
getBalance = async (
  balanceParams: Omit<BalanceRecord, 'amount'>
): Promise<BigNumber>

checkAndDeductBalance = async (
  balanceParams: Omit<BalanceRecord, 'amount'>,
  amountToDeduct: BigNumber
): Promise<{ success: boolean; newBalance: BigNumber }>

createPaymentRequest = async (
  request: Omit<PaymentRequest, 'id' | 'createdAt'>
): Promise<string>

getPaymentRequest = async (id: string): Promise<PaymentRequest | null>

makePaymentForRequest = async (
  paymentRequestId: string,
  payment: AppliedPaymentRecord
): Promise<void>
```

**CRITICAL REQUIREMENT - AccountId Parameters Must Be REQUIRED but Nullable:**

The balance store methods must make accountId parameters **REQUIRED in the signature**, but they can be `null` or `undefined`. This forces callers to explicitly pass `null` or `undefined` if they don't have an accountId, rather than omitting the parameter entirely. This makes the code more explicit and prevents accidental omissions.

**Updated Method Signatures:**

```typescript
getBalance = async (balanceParams: {
  source: string;
  sourceAccountId: string | null | undefined;      // REQUIRED parameter (can be null/undefined)
  destination: string;
  destinationAccountId: string | null | undefined; // REQUIRED parameter (can be null/undefined)
  network: string;
  currency: string;
}): Promise<BigNumber>

checkAndDeductBalance = async (balanceParams: {
  source: string;
  sourceAccountId: string | null | undefined;      // REQUIRED parameter (can be null/undefined)
  destination: string;
  destinationAccountId: string | null | undefined; // REQUIRED parameter (can be null/undefined)
  network: string;
  currency: string;
}, amountToDeduct: BigNumber): Promise<{ success: boolean; newBalance: BigNumber }>

createPaymentRequest = async (request: {
  source: string;
  sourceAccountId: string | null | undefined;      // REQUIRED parameter (can be null/undefined)
  destinationAccountId: string | null | undefined; // REQUIRED parameter (can be null/undefined)
  destinations: PaymentRequestDestination[];
  amount?: BigNumber;
  resource: string;
  payeeName?: string | null;
}): Promise<string>

makePaymentForRequest = async (
  paymentRequestId: string,
  payment: {
    paymentId: string;
    source: string;
    sourceAccountId: string | null | undefined;      // REQUIRED parameter (can be null/undefined)
    destination: string;
    destinationAccountId: string | null | undefined; // REQUIRED parameter (can be null/undefined)
    currency: string;
    network: string;
    amount: BigNumber;
  }
): Promise<void>
```

**Why REQUIRED (but nullable)?**
- Forces explicit handling at call sites
- Prevents forgetting to pass accountId when it becomes available
- Makes code more maintainable and less error-prone
- TypeScript will error if parameter is omitted entirely
- Callers must explicitly pass `null` or `undefined` for backward compatibility cases

**Lookup Strategy** (for all balance queries):

1. **Prioritize accountId when available:**
   - If both source/destination accountIds provided → use accountId-based query
   - Provides consistent experience across chains

2. **Fallback to address-based lookup:**
   - If accountIds not provided → use existing address-based query
   - Maintains backward compatibility with old clients

3. **Store both in new records:**
   - All new balance records include both address and accountId
   - Enables gradual migration

**Example SQL for getBalance (PostgreSQL):**

```sql
SELECT amount FROM balances
WHERE
  (
    (source_account_id = $1 AND destination_account_id = $2)
    OR
    (source = $3 AND destination = $4)
  )
  AND currency = $5
  AND network = $6
LIMIT 1
```

### Phase 6: Auth Repository - Endpoint Updates

#### POST /payment-request

**File**: `routes/paymentRequestPost.ts`

```typescript
export default async function postPaymentRequestRoute(
  req: express.Request,
  res: express.Response
): Promise<void> {
  return withTrace('payment_request_create', async () => {
    try {
      const validationResult = balanceFieldsSchema.safeParse(req.body);
      if (!validationResult.success) {
        res.status(400).json({ error: validationResult.error });
        return;
      }

      const {
        source,
        sourceAccountId,        // NEW
        destinationAccountId,   // NEW (optional now, required in 3-6 months)
        destinations,
        resource,
        payeeName
      } = validationResult.data;

      // Validate destinationAccountId if provided
      if (destinationAccountId && destinationAccountId.trim() === '') {
        res.status(400).json({ error: 'destinationAccountId cannot be empty' });
        return;
      }

      const paymentRequestId = await BALANCE_STORE.createPaymentRequest({
        source,
        sourceAccountId: sourceAccountId || undefined,
        destinationAccountId: destinationAccountId || undefined,
        destinations,
        amount: totalAmount,
        resource,
        payeeName,
      });

      res.json({ paymentRequestId });
    } catch (error) {
      // ... error handling
    }
  }, {
    source_account_id: req.body.sourceAccountId || 'none',
    destination_account_id: req.body.destinationAccountId || 'none',
  });
}
```

#### PUT /payment-request/:id

**File**: `routes/paymentRequestPut.ts`

```typescript
export default async function putPaymentRequestRoute(
  req: express.Request,
  res: express.Response
): Promise<void> {
  return withTrace('payment_request_complete', async () => {
    try {
      const { id } = req.params;

      // NEW: Get both address and accountId from JWT
      const authResult = await sourceFromAuthToken(req, res, undefined, id);
      if (!authResult) return;

      const { address, accountId } = authResult;

      // ... existing payment verification logic ...

      // NEW: Store accountIds when processing payment
      await BALANCE_STORE.makePaymentForRequest(id, {
        ...paymentRecord,
        network,
        sourceAccountId: accountId || undefined,
        destinationAccountId: paymentRequest.destinationAccountId || undefined
      });

      res.json({ success: true });
    } catch (error) {
      // ... error handling
    }
  }, {
    payment_request_id: req.params.id,
    source_account_id: accountId || 'none',
  });
}
```

#### POST /charge

**File**: `routes/charge.ts`

```typescript
export default async function chargeRoute(
  req: express.Request,
  res: express.Response
): Promise<void> {
  try {
    // NEW: Extract accountId from authenticated token
    const authResult = await sourceFromAuthToken(req, res, undefined, undefined);
    if (!authResult) return;

    const { address, accountId } = authResult;

    const validationResult = chargeSchema.safeParse(req.body);
    if (!validationResult.success) {
      res.status(400).json({ error: validationResult.error });
      return;
    }

    const { destinations, resource } = validationResult.data;

    // NEW: Use accountId for balance lookups when available
    for (const dest of destinations) {
      await BALANCE_STORE.checkAndDeductBalance({
        source: address,
        sourceAccountId: accountId || undefined,
        destination: dest.address,
        destinationAccountId: dest.accountId || undefined,  // From client
        network: dest.network,
        currency: dest.currency,
        amount: dest.amount
      });
    }

    res.json({ success: true });
  } catch (error) {
    // ... error handling (402 if insufficient balance)
  }
}
```

**Note**: The charge endpoint needs the client to provide `destinationAccountId` in the request. This will require SDK changes to include it.

#### Validation Schema Updates

**File**: `validation/common.ts`

```typescript
export const balanceFieldsSchema = z.object({
  source: z.string().min(1),
  sourceAccountId: z.string().optional(),       // NEW
  destinationAccountId: z.string().optional(),  // NEW
  payeeName: z.string().optional(),
  destinations: z.array(destinationSchema).optional(),
  destination: z.string().min(1).optional(),
  network: networkSchema.optional(),
  currency: currencySchema.optional(),
  amount: amountSchema.optional(),
}).refine(/* existing validation logic */);

export const destinationSchema = z.object({
  address: z.string().min(1),
  accountId: z.string().optional(),  // NEW
  network: networkSchema,
  currency: currencySchema,
  amount: amountSchema,
});
```

### Phase 7: Monitoring & Observability

#### Analytics Updates

**File**: `/Users/bdj/pr0xy/auth-worktree-balances-refactor/analytics.ts` (current implementation, lines 19-40)

**Current Interface:**
```typescript
export interface PaymentRequestEvent {
  source: string;
  destination: string;
  amount: string;
  currency: string;
  network: string;
  paymentRequestId: string;
  success: boolean;
  error?: string;
}

export interface PaymentCompletionEvent {
  source: string;
  destination: string;
  amount: string;
  currency: string;
  network: string;
  transactionId: string;
  paymentRequestId: string;
  success: boolean;
  error?: string;
}
```

**Required Changes - Add accountId fields:**
```typescript
export interface PaymentRequestEvent {
  source: string;
  sourceAccountId?: string;      // NEW
  destination: string;
  destinationAccountId?: string; // NEW
  amount: string;
  currency: string;
  network: string;
  paymentRequestId: string;
  success: boolean;
  error?: string;
}

export interface PaymentCompletionEvent {
  source: string;
  sourceAccountId?: string;      // NEW
  destination: string;
  destinationAccountId?: string; // NEW
  amount: string;
  currency: string;
  network: string;
  transactionId: string;
  paymentRequestId: string;
  success: boolean;
  error?: string;
}
```

#### Tracing Updates

**File**: `/Users/bdj/pr0xy/auth-worktree-balances-refactor/tracing.ts` (current implementation with withTrace function at lines 37-124)

Add accountId attributes to trace spans in route handlers:

```typescript
// In routes/paymentRequestPost.ts (line 8+)
withTrace('payment_request_create', async () => {
  // ... logic ...
}, {
  source,
  source_account_id: accountId || 'none',        // NEW
  destination_account_id: destinationAccountId || 'none',  // NEW
  destinations: destinations.map(d =>
    `${d.network}:${d.currency}:${d.address}`
  ).join(','),
  amount: totalAmount.toString(),
});

// In routes/paymentRequestPut.ts (line 10+)
withTrace('payment_request_complete', async () => {
  // ... logic ...
}, {
  payment_request_id: id,
  source_account_id: accountId || 'none',  // NEW
  amount: paymentRecord.amount.toString(),
  network,
});
```

#### Technical Monitoring Metrics

Add the following metrics to dashboards (PostHog/Highlight):

1. **AccountId Adoption Rate**
   - Metric: `% of payments with accountId vs address-only`
   - Implementation: Count PostHog events with/without `sourceAccountId` field
   - Purpose: Track migration progress
   - Alert: If adoption rate decreases (regression indicator)

2. **AccountId Validation Failures**
   - Metric: `Count of 403 errors with "Invalid account_id in token" message`
   - Implementation: Track from auth route error responses
   - Purpose: Security monitoring - detect attack attempts or bugs
   - Alert: Spike >10 failures/hour

3. **Balance Query Performance**
   - Metric: `Query latency percentiles (p50, p95, p99)`
   - Implementation: Extract from `withTrace('balance_check_and_deduct')` spans
   - Breakdown: Tag with `has_account_id: true/false`
   - Alert: If p95 latency increases >10ms from baseline

4. **JWT Generation with AccountId**
   - Metric: `% of JWTs with account_id field`
   - Implementation: Track PostHog events in accounts repo `/sign` endpoint
   - Purpose: Track SDK version adoption
   - Directly measurable in code via `Boolean(accountId)` tracking

## Testing Strategy

### 4 Required Scenarios

#### 1. Base → Base Payment

**Setup:**
- Source: BaseAccount with accountId = wallet address
- Destination: BaseAccount with accountId = wallet address

**Test Steps:**
1. Create payment request with Base destination (include destinationAccountId)
2. Make payment using BasePaymentMaker
3. Verify JWT includes `account_id` matching source address
4. Verify balance stored with correct `sourceAccountId` and `destinationAccountId`
5. Query balance using accountId
6. Use /charge endpoint to deduct balance using accountId

**Expected Results:**
- JWT payload contains `account_id` field
- Database record has both `source`/`destination` AND `source_account_id`/`destination_account_id`
- Balance queries work with accountId
- /charge successfully deducts using accountId

**Test Files:**
- `packages/atxp-client/src/basePaymentMaker.test.ts`
- `packages/atxp-base/src/baseAppPaymentMaker.test.ts`
- `/Users/bdj/pr0xy/auth/__tests__/routes/paymentRequestPut.test.ts`
- `/Users/bdj/pr0xy/auth/__tests__/routes/charge.test.ts`

#### 2. Base → ATXP Payment

**Setup:**
- Source: BaseAccount with accountId = wallet address
- Destination: ATXPAccount with accountId = "atxp:{uuid}"

**Test Steps:**
1. Create payment request with atxp_base destination, include destinationAccountId
2. Verify destination resolution to actual Base address
3. Make payment using BasePaymentMaker
4. Verify balance stored with mixed accountId types (address vs atxp:{uuid})
5. Query balance using destination accountId

**Expected Results:**
- Payment succeeds with different accountId formats
- Balance correctly associated with "atxp:{uuid}" destination
- Cross-account balance queries work

**Test Files:**
- `packages/atxp-client/src/atxpFetcher.atxpBase.test.ts`
- `/Users/bdj/pr0xy/auth/__tests__/routes/paymentRequestPut.test.ts`

#### 3. ATXP → Base Payment

**Setup:**
- Source: ATXPAccount with accountId = "atxp:{uuid}"
- Destination: BaseAccount with accountId = wallet address

**Test Steps:**
1. Create payment request from ATXP account
2. ATXP account makes payment to Base destination
3. Verify JWT from `/sign` endpoint includes `account_id`
4. Verify balance lookup works with ATXP accountId
5. Use /charge to deduct from ATXP account balance

**Expected Results:**
- Accounts repo `/sign` endpoint includes accountId in JWT
- Balance operations work with "atxp:{uuid}" accountId
- Cross-account type balance tracking works

**Test Files:**
- `packages/atxp-client/src/atxpFetcher.payment.test.ts`
- `/Users/bdj/pr0xy/auth/__tests__/routes/charge.test.ts`
- Accounts repo test files (TBD)

#### 4. ATXP → ATXP Payment

**Setup:**
- Source: ATXPAccount with accountId = "atxp:{uuid1}"
- Destination: ATXPAccount with accountId = "atxp:{uuid2}"

**Test Steps:**
1. Both parties using ATXP accounts
2. Create payment request with atxp_base destination
3. Verify destination resolution
4. Make payment
5. Verify balance storage with ATXP accountIds on both sides
6. Verify no address collision issues

**Expected Results:**
- Both source and destination use "atxp:{uuid}" format
- No confusion between different ATXP accounts
- Balance tracking works correctly

**Test Files:**
- `packages/atxp-client/src/atxpFetcher.payment.test.ts`
- `/Users/bdj/pr0xy/auth/__tests__/routes/paymentRequestPut.test.ts`

### Additional Test Coverage

#### 5. Backward Compatibility Tests

**Scenarios:**
- Old SDK (no accountId) creates payment request → succeeds
- Old SDK makes payment → balance stored with address only
- Old JWT without `account_id` validated → succeeds
- New system queries balance created by old system → succeeds
- Mix of old and new clients interacting

**Test Files:**
- Integration tests in all 3 repos

#### 6. Multi-Chain Scenario

**Setup:**
- User has both Solana and Base wallets
- Same accountId configured for both

**Test Steps:**
1. User makes Solana payment → balance stored with accountId
2. User later pays with Base from different address
3. Verify balances consolidate under single accountId
4. Verify /charge works across chains using accountId

**Expected Results:**
- Single accountId tracks balance across multiple chains/addresses
- User doesn't lose balance when switching chains

#### 7. Security & Validation Tests

**Scenarios:**
- Empty accountId rejected
- AccountId mismatch across requests logged/alerted
- JWT signature still validated correctly with accountId present
- All 7 security invariants tested explicitly

#### 8. Edge Cases

**Scenarios:**
- Very long accountId strings (performance)
- Special characters in accountId
- Case sensitivity (accountIds treated as case-sensitive)
- Race conditions in balance updates
- Transaction replay attempts with accountId

### Test Execution Plan

1. **Unit Tests**: Run during development for each file modified
2. **Integration Tests**: Run after each repository's changes are complete
3. **End-to-End Tests**: Run after all 3 repos deployed to staging
4. **Performance Tests**: Compare query times before/after
5. **Security Tests**: Verify all invariants with penetration testing

## Files to Modify

### SDK Repository (~15-18 files)

**Core Types & JWT:**
- `packages/atxp-common/src/types.ts`
- `packages/atxp-common/src/jwt.ts`
- `packages/atxp-client/src/types.ts`

**Client:**
- `packages/atxp-client/src/atxpFetcher.ts`

**PaymentMaker Implementations (7):**
- `packages/atxp-client/src/basePaymentMaker.ts`
- `packages/atxp-client/src/solanaPaymentMaker.ts`
- `packages/atxp-client/src/atxpAccount.ts`
- `packages/atxp-base/src/baseAppPaymentMaker.ts`
- `packages/atxp-base/src/mainWalletPaymentMaker.ts`
- `packages/atxp-worldchain/src/worldchainPaymentMaker.ts`
- `packages/atxp-worldchain/src/mainWalletPaymentMaker.ts`

**Tests (~5-7 files):**
- Corresponding `.test.ts` files for above implementations
- Integration tests

### Accounts Repository (~3-5 files)

**Endpoint:**
- `/sign` endpoint implementation (location TBD)

**Types/Validation:**
- Request/response types for accountId
- Validation logic for accountId

**Tests:**
- `/sign` endpoint tests
- Integration tests

### Auth Repository (~18-20 files)

**Core Types:**
- `types.ts`
- `jwt.ts`
- `routes/auth.ts`

**Database:**
- `models/migrations.ts`

**Balance Stores:**
- `balanceStoreSqlite.ts`
- `balanceStorePostgres.ts`

**Routes (3):**
- `routes/charge.ts`
- `routes/paymentRequestPost.ts`
- `routes/paymentRequestPut.ts`

**Validation:**
- `validation/common.ts`

**Observability (2):**
- `analytics.ts`
- `tracing.ts`

**Tests (~8-10 files):**
- `__tests__/jwt.test.ts`
- `__tests__/routes/charge.test.ts`
- `__tests__/routes/paymentRequestPost.test.ts`
- `__tests__/routes/paymentRequestPut.test.ts`
- `__tests__/balanceStoreSqlite.test.ts`
- `__tests__/balanceStorePostgres.test.ts`
- Integration tests

**Total: ~36-43 files across 3 repositories**

## Deployment Strategy

### Deployment Order

**Critical: Must deploy in this order to maintain backward compatibility**

1. **SDK** (deploy first)
   - Adds accountId to JWTs (optional field)
   - Backward compatible - old auth/accounts ignore unknown JWT fields
   - Can be deployed independently

2. **Accounts** (deploy second)
   - Updates `/sign` to include accountId (if provided by client)
   - Backward compatible - works with and without accountId
   - Can be deployed independently

3. **Auth** (deploy last)
   - Database migration (additive columns)
   - Endpoint updates to read accountId
   - Depends on SDK/Accounts changes for full functionality
   - Backward compatible - works with and without accountId

### Rollback Strategy

**SDK Rollback:**
- Revert to previous version
- JWTs without `account_id` still valid
- No data loss
- Impact: Minimal (backward compatible)

**Accounts Rollback:**
- Revert `/sign` endpoint
- Old behavior restored (no accountId in JWT)
- No data loss
- Impact: Minimal (backward compatible)

**Auth Rollback:**
- Revert application code (keep database columns)
- Database columns remain but unused
- No data loss (new accountId data persists)
- Can re-deploy when ready
- Impact: Medium (new features disabled but no breakage)

**Full Rollback:**
- If critical issues, rollback all 3 in reverse order
- Database: Keep columns, just unused
- No data loss, clean rollback path

### Backward Compatibility Plan

**Phase 1: Optional AccountId (0-3 months)**
- accountId optional in all APIs
- Both address and accountId accepted
- Old clients continue to work
- Monitor adoption rate

**Phase 2: Encouraged AccountId (3-6 months)**
- Begin logging warnings for address-only requests
- Send migration guides to API users
- Monitor for users still on old SDK
- Consider SDK version deprecation notices

**Phase 3: Required DestinationAccountId (6+ months)**
- Make `destinationAccountId` required for new payment requests
- Old payment requests without it continue to work
- Force migration to accountId-aware clients
- This is the only breaking change planned

**Phase 4: Indefinite**
- Accounts `/sign` supports clients without accountId forever
- Some users may always use address-only flow
- Balance store maintains dual-mode support

## Data Migration

### Existing Balance Records

**Strategy: No Backfill**

- Existing balance records remain address-based
- New balance records include accountId when available
- Gradual migration as users transact
- No downtime or data transformation required

**Implications:**
- Users with existing balances: Balance accessible via address until next transaction
- After next transaction: Balance record updated with accountId
- Timeline: Natural migration over weeks/months based on activity

### Applied Payments

**Strategy: No Backfill**

- Historical payments remain address-based
- New payments include accountId
- No impact on transaction replay prevention (uses `transaction_id`)

### Payment Requests

**Strategy: No Backfill**

- Existing payment requests remain address-based
- New payment requests include `destinationAccountId` (when client provides it)
- Old payment requests still processable

### Future: User-Initiated Merge (Out of Scope)

In the future, we could provide an API for users to merge existing address-based balances:

```typescript
POST /api/merge-accounts
Authorization: Bearer {jwt_for_accountId}
{
  "additionalAddress": "0x...",
  "proof": "signed_message_from_additional_address"
}
```

This would require:
- User proves ownership of both addresses
- System consolidates balances under single accountId
- Migration of historical data

**Decision: Defer to post-launch enhancement**

## API Contract Changes

### JWT Structure (Enhanced, Backward Compatible)

**Before:**
```json
{
  "sub": "0x1234...",
  "iss": "atxp.ai",
  "aud": "https://auth.atxp.ai",
  "iat": 1234567890,
  "exp": 1234567890,
  "code_challenge": "abc123",
  "payment_request_id": "xyz789"
}
```

**After:**
```json
{
  "sub": "0x1234...",
  "iss": "atxp.ai",
  "aud": "https://auth.atxp.ai",
  "iat": 1234567890,
  "exp": 1234567890,
  "code_challenge": "abc123",
  "payment_request_id": "xyz789",
  "account_id": "0x1234..."
}
```

**Change**: Added optional `account_id` field

### POST /payment-request (Enhanced, Backward Compatible)

**Before:**
```json
{
  "source": "wallet_address",
  "destination": "destination_address",
  "network": "base",
  "currency": "USDC",
  "amount": "1.0"
}
```

**After:**
```json
{
  "source": "wallet_address",
  "sourceAccountId": "account_id",
  "destinationAccountId": "dest_account_id",
  "destinations": [{
    "address": "destination_address",
    "network": "base",
    "currency": "USDC",
    "amount": "1.0"
  }]
}
```

**Changes**:
- Added optional `sourceAccountId`
- Added optional `destinationAccountId` (will become required in 6+ months)

### POST /charge (Enhanced, Backward Compatible)

**Request**: Unchanged (accountId extracted from JWT, not request body)

**Response (402 Payment Required):**

**Before:**
```json
{
  "source": "wallet_address",
  "destinations": [{
    "network": "base",
    "currency": "USDC",
    "address": "destination_address",
    "amount": "0.5"
  }]
}
```

**After:**
```json
{
  "source": "wallet_address",
  "sourceAccountId": "account_id",
  "destinations": [{
    "network": "base",
    "currency": "USDC",
    "address": "destination_address",
    "accountId": "dest_account_id",
    "amount": "0.5"
  }]
}
```

**Changes**:
- Added `sourceAccountId` in response
- Added `accountId` to each destination

### Accounts /sign Endpoint (Enhanced, Backward Compatible)

**Before:**
```json
POST /sign
{
  "paymentRequestId": "xyz789",
  "codeChallenge": "abc123"
}

Response:
{
  "jwt": "eyJ..."
}
```

**After:**
```json
POST /sign
{
  "paymentRequestId": "xyz789",
  "codeChallenge": "abc123",
  "accountId": "atxp:user123"
}

Response:
{
  "jwt": "eyJ..."  // JWT now includes account_id field
}
```

**Changes**:
- Added optional `accountId` field in request
- JWT response includes `account_id` if provided

## Risks & Mitigations

### Risk 1: Deployment Coordination Across 3 Repos

**Risk**: Deploying 3 repos in sequence could cause temporary inconsistencies or breakage

**Impact**: High - Could affect production users

**Mitigation**:
- Strict deployment order (SDK → Accounts → Auth)
- Feature flags for critical paths
- Gradual rollout (% of traffic)
- Comprehensive testing in staging
- Quick rollback plan documented

### Risk 2: Legacy Client Support

**Risk**: Old SDK versions in the wild don't provide accountId

**Impact**: Medium - Could fragment user experience

**Mitigation**:
- Indefinite backward compatibility
- Both address and accountId accepted
- Monitor adoption rate
- Gradual migration messaging
- No forced upgrades for 6+ months

### Risk 3: Database Performance Degradation

**Risk**: Dual-mode lookups (accountId OR address) could slow queries

**Impact**: Medium - Could affect user experience

**Mitigation**:
- Comprehensive indexing strategy
- Query performance testing before deployment
- Monitor p95/p99 latencies
- Optimize hot paths based on metrics
- Consider query plan analysis

### Risk 4: Data Inconsistency

**Risk**: Same user represented by multiple accountIds due to bugs

**Impact**: High - Could cause lost balances or security issues

**Mitigation**:
- Strict validation (non-empty accountId)
- Extensive testing (all scenarios)
- Monitoring for suspicious patterns
- Idempotent operations
- Clear audit trail in logs

### Risk 5: AccountId Spoofing

**Risk**: Malicious actor provides false accountId to access other users' balances

**Impact**: Critical - Security vulnerability

**Mitigation**:
- AccountId in signed JWT payload (can't be modified)
- JWT signature verification unchanged
- Address-accountId consistency monitoring
- Alert on validation failures
- Security review before deployment

### Risk 6: Migration Timeline Uncertainty

**Risk**: 2-3 week timeline may be optimistic

**Impact**: Low - Timeline slip, not functional issue

**Mitigation**:
- Break into smaller, testable increments
- Identify critical path early
- Buffer time in week 3 for issues
- Parallel work where possible (different repos)
- Daily progress check-ins

### Risk 7: Testing Coverage Gaps

**Risk**: Edge cases or integration issues not caught in testing

**Impact**: Medium - Bugs in production

**Mitigation**:
- Comprehensive test plan (8 scenario types)
- Both unit and integration tests
- Staging environment full test
- Gradual production rollout
- Enhanced monitoring during deployment

## Success Criteria

### Technical Metrics

- ✅ All 4 required test scenarios pass
- ✅ All 7 security invariants verified and passing
- ✅ Query latency increase <10ms (p95)
- ✅ 100% backward compatibility maintained
- ✅ Zero data loss during migration
- ✅ Database migration completes in <1 hour
- ✅ All 36+ files successfully modified
- ✅ Test coverage >80% for new code


## Architecture Decisions Record

### Decision 1: AccountId Format - Opaque Strings

**Decision**: AccountId treated as opaque, non-empty strings with no format validation

**Rationale**:
- Flexibility for future account types
- Stripe, ATXP, wallet addresses all have different formats
- Validation complexity not worth the benefit

**Tradeoffs**:
- Can't prevent nonsense accountIds
- Harder to debug (can't infer account type from ID)
- Mitigated by: Non-empty validation, monitoring

### Decision 2: No Data Backfill

**Decision**: Existing balance records remain address-based, no backfill script

**Rationale**:
- Simpler implementation
- Lower risk (no mass data transformation)
- Natural migration as users transact
- Dual-mode support allows gradual transition

**Tradeoffs**:
- Users must transact to get accountId benefits
- Mixed data in database for extended period
- Mitigated by: Dual-mode lookups, monitoring adoption

### Decision 3: DestinationAccountId in Payment Request Creation

**Decision**: Require destinationAccountId to be provided when creating payment request (after 3-6 months)

**Rationale**:
- No reliable way to lookup destination accountId from address in auth repo
- Accounts repo (future) will have mapping, but auth shouldn't depend on it
- Client knows destination accountId when creating request

**Tradeoffs**:
- Breaking change (delayed 6+ months)
- Requires SDK update
- Mitigated by: Long deprecation period, clear migration path

### Decision 4: Indefinite `/sign` Backward Compatibility

**Decision**: Accounts repo `/sign` endpoint supports clients without accountId forever

**Rationale**:
- Some integrations may never update
- Low maintenance cost (optional parameter)
- Better user experience than forced upgrades

**Tradeoffs**:
- Code complexity remains
- Can't fully optimize for accountId-only path
- Mitigated by: Clear code paths, monitoring

### Decision 5: Deployment Order SDK → Accounts → Auth

**Decision**: Deploy in strict sequence, not parallel

**Rationale**:
- SDK changes must land first (adds accountId to JWTs)
- Accounts needs SDK changes to receive accountId
- Auth needs Accounts changes to have accountId in ATXP JWTs

**Tradeoffs**:
- Slower deployment (can't parallelize)
- Coordination required
- Mitigated by: Backward compatibility, clear rollback plan

### Decision 6: Dual-Mode Balance Lookups

**Decision**: Balance store accepts both address and accountId, prioritizing accountId when available

**Rationale**:
- Enables gradual migration
- Supports old and new clients simultaneously
- No breaking changes

**Tradeoffs**:
- More complex queries
- Potential performance impact
- Mitigated by: Proper indexes, monitoring

## Open Questions for Review

### Critical Questions

1. **DestinationAccountId Source**: When SDK creates a payment request, where does it get the `destinationAccountId` from? Is this something the MCP server provides in its payment request response?

2. ✅ **Accounts Repo `/sign` Endpoint Location**: **RESOLVED** - Located at `/Users/bdj/pr0xy/accounts-worktree-balances-refactor/routes/sign.ts` (lines 8-75). JWT generation function at `services/payments.ts` (line 31).

3. **Database Size**: How many existing balance records exist? Affects index creation time and query optimization strategy.

4. **Staging Environment**: Do all 3 repos have staging environments for end-to-end testing?

### Non-Critical Questions

5. **Monitoring Tools**: Confirm we're using PostHog (accounts repo) and Highlight (auth repo) - this appears to be the case based on code analysis.

6. **CI/CD Pipeline**: Do all 3 repos have automated testing in CI?

7. **SDK Version Tracking**: How do we track which SDK versions are in use by customers?

## Approval Checklist

Please review and approve/provide feedback on:

- [ ] Overall architecture approach (3 repos, phased deployment)
- [ ] Security invariants verification
- [ ] Backward compatibility strategy
- [ ] Testing coverage (4 required + 4 additional scenarios)
- [ ] Timeline (2-3 weeks)
- [ ] Files to modify (~36-43 total)
- [ ] Deployment order and rollback plan
- [ ] Monitoring/observability additions
- [ ] API contract changes
- [ ] Risk mitigation strategies
- [ ] Success criteria
- [ ] Architecture decisions


## Document History

| Date | Author | Changes |
|------|--------|---------|
| 2025-10-16 | Claude Code (bc-architect) | Initial draft |

## References

- [Balances Refactor Design Doc](internal - provided by user)
- [ATXP Security Invariants](internal - provided by user)
- SDK Repository: `/Users/bdj/pr0xy/sdk`
- Accounts Repository: `/Users/bdj/pr0xy/accounts`
- Auth Repository: `/Users/bdj/pr0xy/auth`
